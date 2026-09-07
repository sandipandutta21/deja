package dev.deja.core;

import dev.deja.core.cassette.CassetteContents;
import dev.deja.core.cassette.CassetteFrame;
import dev.deja.core.cassette.CassetteHeader;
import dev.deja.core.cassette.CassetteReader;
import dev.deja.core.cassette.CassetteWriter;
import dev.deja.core.cassette.Direction;
import dev.deja.core.cassette.JsonRpcError;
import dev.deja.core.cassette.JsonRpcMessage;
import dev.deja.core.cassette.TransportType;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class CassetteTest {

    @Test
    void writesAndReadsFramesSequentially(@TempDir Path tempDir) {
        Path file = tempDir.resolve("test.jsonl");

        try (CassetteWriter writer = new CassetteWriter(file)) {
            writer.write(CassetteHeader.of("2026-09-06T00:00:00Z", TransportType.STDIO, java.util.List.of("node", "test"), null));
            writer.write(CassetteFrame.of(Direction.C2S, 10, JsonRpcMessage.request(1, "ping", null)));
        }

        CassetteContents contents = new CassetteReader(file).loadAll();

        assertThat(contents.header().version()).isEqualTo(1);
        assertThat(contents.frames()).hasSize(1);
        assertThat(contents.frames().get(0).msg().method()).isEqualTo("ping");
        assertThat(contents.frames().get(0).dir()).isEqualTo(Direction.C2S);
    }

    @Test
    void roundTripsAResponseWithResultAndErrorFields(@TempDir Path tempDir) {
        Path file = tempDir.resolve("round-trip.jsonl");

        try (CassetteWriter writer = new CassetteWriter(file)) {
            writer.write(CassetteHeader.of("now", TransportType.HTTP, null, "https://api.example.com"));
            writer.write(CassetteFrame.of(Direction.C2S, 0, JsonRpcMessage.request(1, "tools/call", Map.of("name", "fetch"))));
            writer.write(CassetteFrame.of(Direction.S2C, 1, JsonRpcMessage.result(1, Map.of("ok", true))));
            writer.write(CassetteFrame.of(Direction.S2C, 2, JsonRpcMessage.error(2, new JsonRpcError(-32603, "boom"))));
        }

        CassetteContents contents = new CassetteReader(file).loadAll();

        assertThat(contents.header().transport()).isEqualTo(TransportType.HTTP);
        assertThat(contents.header().target()).isEqualTo("https://api.example.com");
        assertThat(contents.frames()).hasSize(3);
        assertThat(contents.frames().get(1).msg().result()).isEqualTo(Map.of("ok", true));
        assertThat(contents.frames().get(2).msg().error().code()).isEqualTo(-32603);
        assertThat(contents.frames().get(2).msg().error().message()).isEqualTo("boom");
    }

    @Test
    void throwsOnACassetteWithNoHeader(@TempDir Path tempDir) {
        Path file = tempDir.resolve("no-header.jsonl");
        try (CassetteWriter writer = new CassetteWriter(file)) {
            writer.write(CassetteFrame.of(Direction.C2S, 0, JsonRpcMessage.request(1, "ping", null)));
        }

        assertThat(org.assertj.core.api.Assertions.catchThrowable(() -> new CassetteReader(file).loadAll()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("missing header");
    }
}
