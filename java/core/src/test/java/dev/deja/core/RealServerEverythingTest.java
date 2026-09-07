package dev.deja.core;

import dev.deja.core.cassette.CassetteContents;
import dev.deja.core.cassette.CassetteReader;
import dev.deja.core.cassette.JsonRpcMessage;
import dev.deja.core.json.Canon;
import dev.deja.core.recorder.ProcessRecorder;
import dev.deja.core.redact.CassetteRedactor;
import dev.deja.core.redact.RedactScanReport;
import dev.deja.core.replay.ReplayEngine;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ExecutionException;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Validates deja-core end-to-end against a REAL MCP server -- the official reference
 * "Everything" server (installed as an npm devDependency of the sibling {@code ts/} module,
 * spawned here as a real Node.js subprocess) -- rather than hand-crafted fixtures or synthetic
 * Java fixture servers. Real servers behave in ways synthetic fixtures don't: they push
 * unsolicited notifications, and their responses aren't things we get to author ourselves.
 */
class RealServerEverythingTest {

    private static List<String> everythingServerCommand() {
        Path scriptPath = Path.of("../../ts/node_modules/@modelcontextprotocol/server-everything/dist/index.js");
        return List.of("node", scriptPath.toString(), "stdio");
    }

    @Test
    void recordsARealSessionAndReplaysItByteForByteIncludingAnUnsolicitedNotification(@TempDir Path tempDir) throws ExecutionException, InterruptedException {
        Path cassettePath = tempDir.resolve("everything.jsonl");

        try (ProcessRecorder recorder = new ProcessRecorder(everythingServerCommand(), cassettePath, true)) {
            JsonRpcMessage init = recorder.send("initialize", Map.of(
                    "protocolVersion", "2025-06-18", "capabilities", Map.of(),
                    "clientInfo", Map.of("name", "deja-test", "version", "1.0.0")));
            assertThat(init.error()).isNull();
            recorder.sendNotification("notifications/initialized", null);

            JsonRpcMessage echo = recorder.send("tools/call", Map.of("name", "echo", "arguments", Map.of("message", "hello-deja")));
            assertThat(resultText(echo)).isEqualTo("Echo: hello-deja");

            JsonRpcMessage sum = recorder.send("tools/call", Map.of("name", "get-sum", "arguments", Map.of("a", 7, "b", 5)));
            assertThat(resultText(sum)).isEqualTo("The sum of 7 and 5 is 12.");
        }

        CassetteContents contents = new CassetteReader(cassettePath).loadAll();

        // A real server pushes notifications the client never asked for -- prove those get
        // captured (correctly demuxed from the responses we were actually waiting for), not
        // just clean request/response pairs.
        assertThat(contents.frames()).anySatisfy(frame ->
                assertThat(frame.msg().method()).isEqualTo("notifications/tools/list_changed"));

        // Replay: re-send the exact same requests under different ids, entirely offline (no
        // server-everything involved), and expect byte-for-byte identical results.
        ReplayEngine engine = new ReplayEngine(contents.frames());

        Optional<JsonRpcMessage> replayedEcho = engine.resolve(
                JsonRpcMessage.request(101, "tools/call", Map.of("name", "echo", "arguments", Map.of("message", "hello-deja")))).get();
        assertThat(replayedEcho).isPresent();
        assertThat(replayedEcho.get().id()).isEqualTo(101);
        assertThat(resultText(replayedEcho.get())).isEqualTo("Echo: hello-deja");

        Optional<JsonRpcMessage> replayedSum = engine.resolve(
                JsonRpcMessage.request(102, "tools/call", Map.of("name", "get-sum", "arguments", Map.of("a", 7, "b", 5)))).get();
        assertThat(replayedSum).isPresent();
        assertThat(resultText(replayedSum.get())).isEqualTo("The sum of 7 and 5 is 12.");
    }

    @Test
    void redactsASecretEmbeddedInRealToolCallContentWithoutAlteringWhatTheLiveCallerSaw(@TempDir Path tempDir) {
        Path cassettePath = tempDir.resolve("redact.jsonl");
        String fakeSecret = "sk-fakefakefakefakefakefakefakefakefakefake123456";

        try (ProcessRecorder recorder = new ProcessRecorder(everythingServerCommand(), cassettePath, true)) {
            recorder.send("initialize", Map.of(
                    "protocolVersion", "2025-06-18", "capabilities", Map.of(),
                    "clientInfo", Map.of("name", "deja-test", "version", "1.0.0")));

            JsonRpcMessage echo = recorder.send("tools/call", Map.of("name", "echo", "arguments", Map.of("message", "my key is " + fakeSecret)));
            // The live round trip still carries the real value -- redaction only affects the cassette.
            assertThat(resultText(echo)).contains(fakeSecret);
        }

        RedactScanReport report = CassetteRedactor.scan(cassettePath);
        assertThat(report.hits()).isEmpty();

        CassetteContents contents = new CassetteReader(cassettePath).loadAll();
        boolean anyFrameStillHasRawSecret = contents.frames().stream()
                .anyMatch(f -> Canon.stableStringify(f.msg()).contains(fakeSecret));
        assertThat(anyFrameStillHasRawSecret).isFalse();
    }

    @SuppressWarnings("unchecked")
    private static String resultText(JsonRpcMessage msg) {
        Map<String, Object> result = (Map<String, Object>) msg.result();
        List<Map<String, Object>> content = (List<Map<String, Object>>) result.get("content");
        return (String) content.get(0).get("text");
    }
}
