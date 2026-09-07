package dev.deja.core.cassette;

import dev.deja.core.json.Json;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

/** Reads a cassette JSONL file: one leading {@link CassetteHeader} followed by any number of
 *  {@link CassetteFrame} lines. Deliberately blocking (plain {@link BufferedReader}, no async
 *  machinery) -- reading a local file synchronously is the idiomatic, appropriate choice on
 *  the JVM, unlike Node's event-loop-constrained I/O model. */
public final class CassetteReader {

    private final Path path;

    public CassetteReader(Path path) {
        this.path = path;
    }

    /** Streams every non-blank line of the cassette, parsed and dispatched to {@link
     *  CassetteHeader} or {@link CassetteFrame} by its {@code type} discriminator. The
     *  returned stream must be closed (e.g. via try-with-resources) to release the underlying
     *  file handle. */
    public Stream<CassetteLine> stream() {
        BufferedReader reader;
        try {
            reader = Files.newBufferedReader(path, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to open cassette for reading: " + path, e);
        }

        return reader.lines()
                .onClose(() -> closeQuietly(reader))
                .filter(line -> !line.isBlank())
                .map(this::parseLine);
    }

    private CassetteLine parseLine(String line) {
        try {
            return Json.MAPPER.readValue(line, CassetteLine.class);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to parse cassette line: " + line, e);
        }
    }

    private static void closeQuietly(BufferedReader reader) {
        try {
            reader.close();
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to close cassette reader", e);
        }
    }

    /** Reads the entire cassette into memory. */
    public CassetteContents loadAll() {
        try (Stream<CassetteLine> lines = stream()) {
            CassetteHeader header = null;
            List<CassetteFrame> frames = new ArrayList<>();

            for (CassetteLine line : lines.toList()) {
                if (line instanceof CassetteHeader h) {
                    header = h;
                } else if (line instanceof CassetteFrame f) {
                    frames.add(f);
                }
            }

            if (header == null) {
                throw new IllegalStateException("Invalid cassette: missing header in " + path);
            }

            return new CassetteContents(header, frames);
        }
    }
}
