package dev.deja.core;

import dev.deja.core.cassette.CassetteContents;
import dev.deja.core.cassette.CassetteFrame;
import dev.deja.core.cassette.CassetteHeader;
import dev.deja.core.cassette.CassetteReader;
import dev.deja.core.cassette.CassetteWriter;
import dev.deja.core.cassette.Direction;
import dev.deja.core.cassette.JsonRpcMessage;
import dev.deja.core.cassette.TransportType;
import dev.deja.core.redact.Redact;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * Cross-language conformance: deja-core (Java) and the TypeScript implementation must read
 * and write byte-compatible cassettes -- same JSONL shape, same redaction placeholders for
 * the same secret. Fixtures live in a directory shared with the TS module ({@code
 * ../../conformance/} from this module's directory, a sibling of both {@code ts/} and {@code
 * java/}), not under either language's own test resources.
 *
 * <p>Each side both writes its own fixture (deterministically, safe to regenerate any time
 * the format changes) and reads + verifies whatever the other side most recently wrote. Run
 * both suites once, in either order, to refresh both fixture files; a single run of one side
 * still gets full mileage out of whatever the other side already committed.
 */
class ConformanceTest {

    private static final Path CONFORMANCE_DIR = Path.of("../../conformance");
    private static final Path JAVA_WRITTEN_PATH = CONFORMANCE_DIR.resolve("java-written.jsonl");
    private static final Path TS_WRITTEN_PATH = CONFORMANCE_DIR.resolve("ts-written.jsonl");

    // The same raw secret both languages redact independently -- proves the placeholder
    // (SHA-256 of the UTF-8 secret, first 8 hex characters) is byte-identical across
    // implementations, not just "some hash neither side can verify against the other."
    private static final String SHARED_SECRET = "sk-conformancetestsecret1234567890abcdefgh";

    @BeforeAll
    static void writeJavaFixture() throws IOException {
        Files.createDirectories(CONFORMANCE_DIR);

        try (CassetteWriter writer = new CassetteWriter(JAVA_WRITTEN_PATH)) {
            writer.write(CassetteHeader.of(
                    Instant.parse("2026-01-01T00:00:00.000Z").toString(),
                    TransportType.STDIO,
                    List.of("java", "Server.java"),
                    null));

            Map<String, Object> nested = new LinkedHashMap<>();
            nested.put("array", List.of(1, 2, 3));
            nested.put("flag", true);
            Map<String, Object> params = new LinkedHashMap<>();
            params.put("name", "fetch");
            params.put("url", "https://example.com/data");
            params.put("nested", nested);
            params.put("_meta", Map.of("progressToken", "abc"));

            writer.write(CassetteFrame.of(Direction.C2S, 0, JsonRpcMessage.request(1, "tools/call", params)));

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("ok", true);
            result.put("secretNote", "my key is " + SHARED_SECRET);
            JsonRpcMessage response = Redact.redactMessage(JsonRpcMessage.result(1, result));
            writer.write(CassetteFrame.of(Direction.S2C, 1, response));

            writer.write(CassetteFrame.of(Direction.C2S, 2, JsonRpcMessage.notification("notifications/initialized", null)));
        }
    }

    @Test
    void writesACassetteOtherImplementationsShouldBeAbleToRead() {
        CassetteContents contents = new CassetteReader(JAVA_WRITTEN_PATH).loadAll();
        assertThat(contents.header().transport()).isEqualTo(TransportType.STDIO);
        assertThat(contents.frames()).hasSize(3);
    }

    @Test
    void computesTheSameRedactionPlaceholderForASecretAsAnyOtherImplementationMust() {
        // Documents the exact algorithm contract: SHA-256 of the UTF-8 secret, first 8 hex
        // characters, in "[REDACTED:<rule>:<hash>]". The TS-written-cassette test below is
        // where this actually gets checked against the other language's own computation.
        assertThat(Redact.createPlaceholder("sk", SHARED_SECRET)).matches("\\[REDACTED:sk:[a-f0-9]{8}]");
    }

    @Test
    @SuppressWarnings("unchecked")
    void readsACassetteWrittenByTheTypeScriptImplementationAndValidatesItStructurally() {
        assumeTrue(Files.exists(TS_WRITTEN_PATH), "ts-written.jsonl not present -- run the TS conformance test first");

        CassetteContents contents = new CassetteReader(TS_WRITTEN_PATH).loadAll();
        assertThat(contents.header().transport()).isEqualTo(TransportType.STDIO);

        Optional<CassetteFrame> request = contents.frames().stream()
                .filter(f -> f.dir() == Direction.C2S && Integer.valueOf(1).equals(f.msg().id()))
                .findFirst();
        assertThat(request).isPresent();
        assertThat(request.get().msg().method()).isEqualTo("tools/call");
        Map<String, Object> nested = (Map<String, Object>) request.get().msg().params().get("nested");
        assertThat((List<Integer>) nested.get("array")).containsExactly(1, 2, 3);

        Optional<CassetteFrame> response = contents.frames().stream()
                .filter(f -> f.dir() == Direction.S2C && Integer.valueOf(1).equals(f.msg().id()))
                .findFirst();
        assertThat(response).isPresent();
        Map<String, Object> result = (Map<String, Object>) response.get().msg().result();
        String secretNote = (String) result.get("secretNote");
        // TypeScript independently computed this placeholder for the exact same raw secret --
        // if the hash algorithms ever diverged, this specific assertion is what would catch it.
        assertThat(secretNote).contains(Redact.createPlaceholder("sk", SHARED_SECRET));

        Optional<CassetteFrame> notification = contents.frames().stream()
                .filter(f -> f.dir() == Direction.C2S && f.msg().id() == null)
                .findFirst();
        assertThat(notification).isPresent();
        assertThat(notification.get().msg().method()).isEqualTo("notifications/initialized");
    }
}
