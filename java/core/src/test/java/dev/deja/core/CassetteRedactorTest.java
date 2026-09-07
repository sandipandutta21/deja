package dev.deja.core;

import dev.deja.core.cassette.CassetteContents;
import dev.deja.core.cassette.CassetteFrame;
import dev.deja.core.cassette.CassetteHeader;
import dev.deja.core.cassette.CassetteReader;
import dev.deja.core.cassette.CassetteWriter;
import dev.deja.core.cassette.Direction;
import dev.deja.core.cassette.JsonRpcMessage;
import dev.deja.core.cassette.TransportType;
import dev.deja.core.redact.CassetteRedactor;
import dev.deja.core.redact.RedactScanReport;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class CassetteRedactorTest {

    @Test
    void findsNoHitsInAProperlyRedactedCassette(@TempDir Path tempDir) {
        Path path = tempDir.resolve("clean.jsonl");
        try (CassetteWriter writer = new CassetteWriter(path)) {
            writer.write(CassetteHeader.of("now", TransportType.STDIO, null, null));
            writer.write(CassetteFrame.of(Direction.C2S, 0, JsonRpcMessage.request(1, "tools/list", null)));
        }

        assertThat(CassetteRedactor.scan(path).hits()).isEmpty();
    }

    @Test
    void findsAHitWhenAFrameStillContainsARawSecretPattern(@TempDir Path tempDir) {
        Path path = tempDir.resolve("dirty.jsonl");
        try (CassetteWriter writer = new CassetteWriter(path)) {
            writer.write(CassetteHeader.of("now", TransportType.STDIO, null, null));
            writer.write(CassetteFrame.of(Direction.S2C, 0,
                    JsonRpcMessage.result(1, Map.of("note", "token sk-abc123def456ghi789jkl012mno345pqr678stu901"))));
        }

        RedactScanReport report = CassetteRedactor.scan(path);
        assertThat(report.hits()).hasSize(1);
        assertThat(report.hits().get(0).frameIndex()).isZero();
        assertThat(report.hits().get(0).rule()).isEqualTo("sk");
    }

    @Test
    void preservesHeaderProvenanceWhileRedactingFrames(@TempDir Path tempDir) {
        Path input = tempDir.resolve("to-clean.jsonl");
        try (CassetteWriter writer = new CassetteWriter(input)) {
            writer.write(CassetteHeader.of("2020-01-01T00:00:00Z", TransportType.STDIO, java.util.List.of("node", "server.js"), null));
            writer.write(CassetteFrame.of(Direction.C2S, 0, JsonRpcMessage.request(1, "auth", Map.of("apiKey", "raw-value"))));
        }
        Path output = tempDir.resolve("cleaned.jsonl");

        int framesRedacted = CassetteRedactor.clean(input, output);
        assertThat(framesRedacted).isEqualTo(1);

        CassetteContents cleaned = new CassetteReader(output).loadAll();
        assertThat(cleaned.header().recordedAt()).isEqualTo("2020-01-01T00:00:00Z");
        assertThat(cleaned.header().serverCommand()).containsExactly("node", "server.js");
        Map<String, Object> params = cleaned.frames().get(0).msg().params();
        assertThat((String) params.get("apiKey")).matches("\\[REDACTED:key_match:[a-f0-9]{8}]");
    }

    @Test
    void isIdempotentCleaningAnAlreadyCleanCassetteRedactsZeroFrames(@TempDir Path tempDir) {
        Path input = tempDir.resolve("already-clean.jsonl");
        try (CassetteWriter writer = new CassetteWriter(input)) {
            writer.write(CassetteHeader.of("now", TransportType.STDIO, null, null));
            writer.write(CassetteFrame.of(Direction.C2S, 0, JsonRpcMessage.request(1, "tools/list", null)));
        }
        Path output = tempDir.resolve("still-clean.jsonl");

        assertThat(CassetteRedactor.clean(input, output)).isZero();
    }
}
