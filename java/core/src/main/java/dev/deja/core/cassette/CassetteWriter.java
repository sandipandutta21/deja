package dev.deja.core.cassette;

import dev.deja.core.json.Json;

import java.io.BufferedWriter;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/** Writes a cassette JSONL file one line at a time: one {@link CassetteHeader} followed by
 *  any number of {@link CassetteFrame} lines. {@link #write} is synchronized: {@code
 *  ProcessRecorder} (in the sibling {@code recorder} package) calls it from both the thread
 *  driving {@code ProcessRecorder.send} and its own background reader thread (for unsolicited
 *  server traffic), and an unsynchronized
 *  {@link BufferedWriter} offers no protection against those interleaving mid-line. */
public final class CassetteWriter implements AutoCloseable {

    private final BufferedWriter writer;

    public CassetteWriter(Path path) {
        try {
            this.writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to open cassette for writing: " + path, e);
        }
    }

    public synchronized void write(CassetteLine line) {
        try {
            writer.write(Json.MAPPER.writeValueAsString(line));
            writer.write("\n");
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to write cassette line", e);
        }
    }

    @Override
    public synchronized void close() {
        try {
            writer.close();
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to close cassette writer", e);
        }
    }
}
