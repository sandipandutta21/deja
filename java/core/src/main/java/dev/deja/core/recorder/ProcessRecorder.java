package dev.deja.core.recorder;

import dev.deja.core.cassette.CassetteFrame;
import dev.deja.core.cassette.CassetteHeader;
import dev.deja.core.cassette.CassetteWriter;
import dev.deja.core.cassette.Direction;
import dev.deja.core.cassette.JsonRpcMessage;
import dev.deja.core.cassette.TransportType;
import dev.deja.core.json.Json;
import dev.deja.core.redact.Redact;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.UncheckedIOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Spawns a real MCP server over stdio and records every request/response exchanged with it
 * into a cassette -- the primitive backing {@code deja-junit5}'s record mode. Mirrors the
 * TypeScript implementation's {@code record.ts}/{@code RecordingSession}.
 *
 * <p>A dedicated reader thread continuously drains the server's stdout and demuxes by JSON-RPC
 * id: a line matching a pending {@link #send} call resolves it; anything else -- an unsolicited
 * notification, or a response nobody is waiting for -- is recorded directly. This matters
 * because real servers do send unsolicited traffic between a request and its actual response
 * (e.g. the MCP reference "Everything" server pushes {@code notifications/tools/list_changed}
 * right after connecting); a naive "read exactly one line after writing one" implementation
 * would misread that notification as the response and corrupt the recording.
 */
public final class ProcessRecorder implements AutoCloseable {

    private final Process process;
    private final Writer serverIn;
    private final CassetteWriter writer;
    private final boolean redact;
    private final long startTimeMs;
    private final AtomicLong nextId = new AtomicLong(1);
    private final ConcurrentHashMap<Object, CompletableFuture<JsonRpcMessage>> pending = new ConcurrentHashMap<>();
    private final Thread readerThread;
    private volatile boolean closing = false;

    public ProcessRecorder(List<String> command, Path cassettePath, boolean redact) {
        this.redact = redact;
        this.writer = new CassetteWriter(cassettePath);
        this.startTimeMs = System.currentTimeMillis();

        List<String> headerCommand = redact ? Redact.redactCommand(command) : command;
        writer.write(CassetteHeader.of(Instant.now().toString(), TransportType.STDIO, headerCommand, null));

        BufferedReader serverOut;
        try {
            ProcessBuilder builder = new ProcessBuilder(command);
            builder.redirectError(ProcessBuilder.Redirect.INHERIT);
            this.process = builder.start();
            this.serverIn = new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8);
            serverOut = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
        } catch (IOException e) {
            writer.close();
            throw new UncheckedIOException("Failed to start recorded process: " + command, e);
        }

        this.readerThread = new Thread(() -> readLoop(serverOut), "deja-process-recorder-reader");
        this.readerThread.setDaemon(true);
        this.readerThread.start();
    }

    private void readLoop(BufferedReader serverOut) {
        try {
            String line;
            while (!closing && (line = serverOut.readLine()) != null) {
                if (line.isBlank()) {
                    continue;
                }

                JsonRpcMessage message;
                try {
                    message = Json.MAPPER.readValue(line, JsonRpcMessage.class);
                } catch (IOException e) {
                    continue; // not JSON-RPC -- nothing to do with it
                }

                CompletableFuture<JsonRpcMessage> waiting = message.id() != null ? pending.remove(normalizeId(message.id())) : null;
                if (waiting != null) {
                    waiting.complete(message);
                } else {
                    record(Direction.S2C, message);
                }
            }
        } catch (IOException e) {
            // The process ended or its stream closed -- nothing more to read.
        } finally {
            IllegalStateException closed = new IllegalStateException("Recorded process's stdout closed before responding");
            pending.forEach((id, future) -> future.completeExceptionally(closed));
            pending.clear();
        }
    }

    private void writeToServer(JsonRpcMessage message) throws IOException {
        synchronized (serverIn) {
            serverIn.write(Json.MAPPER.writeValueAsString(message));
            serverIn.write("\n");
            serverIn.flush();
        }
    }

    /** Sends a notification -- no id, no response expected or waited for -- and records it.
     *  Real MCP sessions always include at least one of these ({@code
     *  notifications/initialized}, completing the handshake after {@link #send}ing {@code
     *  initialize}); some servers only reveal behavior (e.g. pushing their own follow-up
     *  notifications) once they've received it. */
    public void sendNotification(String method, Map<String, Object> params) {
        JsonRpcMessage notification = JsonRpcMessage.notification(method, params);
        try {
            writeToServer(notification);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to send notification to recorded process", e);
        }
        record(Direction.C2S, notification);
    }

    /** Sends {@code method}/{@code params} to the server, blocks for its matching response
     *  (correctly ignoring any unsolicited notifications the server interleaves first),
     *  records both directions to the cassette, and returns the response. */
    public JsonRpcMessage send(String method, Map<String, Object> params) {
        long id = nextId.getAndIncrement();
        JsonRpcMessage request = JsonRpcMessage.request(id, method, params);
        CompletableFuture<JsonRpcMessage> future = new CompletableFuture<>();
        pending.put(normalizeId(id), future);

        try {
            writeToServer(request);
        } catch (IOException e) {
            pending.remove(normalizeId(id));
            throw new UncheckedIOException("Failed to communicate with recorded process", e);
        }

        record(Direction.C2S, request);

        JsonRpcMessage response;
        try {
            // A generous but finite bound: a test suite should never hang indefinitely on
            // process I/O, however wrong the reasoning behind "this will definitely respond"
            // turns out to be.
            response = future.get(30, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException(e);
        } catch (ExecutionException e) {
            throw new RuntimeException(e.getCause());
        } catch (TimeoutException e) {
            pending.remove(normalizeId(id));
            throw new IllegalStateException("Deja: no response for '" + method + "' within 30s", e);
        }

        record(Direction.S2C, response);
        return response;
    }

    /** {@link #pending} is keyed by JSON-RPC id, and ids round-trip through two different
     *  numeric representations: {@code long} here (autoboxed to {@code Long}), but whatever
     *  boxed type Jackson happens to deserialize a small JSON number into (typically {@code
     *  Integer}) when a response comes back off the wire. {@code Long.valueOf(1).equals(
     *  Integer.valueOf(1))} is {@code false} in Java even though JSON (and JSON-RPC) has
     *  exactly one numeric type -- without normalizing both sides to the same boxed type, a
     *  response would never match its pending request, and {@link #send} would block forever. */
    private static Object normalizeId(Object id) {
        return id instanceof Number number ? number.longValue() : id;
    }

    private void record(Direction dir, JsonRpcMessage msg) {
        JsonRpcMessage toWrite = redact ? Redact.redactMessage(msg) : msg;
        writer.write(CassetteFrame.of(dir, System.currentTimeMillis() - startTimeMs, toWrite));
    }

    @Override
    public void close() {
        closing = true;
        try {
            serverIn.close();
        } catch (IOException ignored) {
            // Best-effort: the process is being torn down regardless.
        }
        process.destroy();
        readerThread.interrupt();
        writer.close();
    }
}
