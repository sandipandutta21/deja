package dev.deja.core;

import dev.deja.core.cassette.CassetteContents;
import dev.deja.core.cassette.CassetteReader;
import dev.deja.core.cassette.JsonRpcMessage;
import dev.deja.core.recorder.ProcessRecorder;
import dev.deja.core.replay.ReplayEngine;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ExecutionException;

import static org.assertj.core.api.Assertions.assertThat;

/** Validates deja-core against the real MCP Filesystem reference server: redaction of a
 *  secret embedded in real file content, and that structural replay correctly reproduces the
 *  (redacted) content for the exact same request. */
class RealServerFilesystemTest {

    private static Path allowedDir;
    private static final String FAKE_SECRET = "sk-fakefakefakefakefakefakefakefakefakefake654321";

    @BeforeAll
    static void writeFixtureFile(@TempDir Path tempDir) throws IOException {
        allowedDir = tempDir;
        Files.writeString(tempDir.resolve("config.txt"), "API_KEY=" + FAKE_SECRET + "\nother=fine\n");
    }

    private static List<String> filesystemServerCommand() {
        Path scriptPath = Path.of("../../ts/node_modules/@modelcontextprotocol/server-filesystem/dist/index.js");
        return List.of("node", scriptPath.toString(), allowedDir.toString());
    }

    @SuppressWarnings("unchecked")
    private static String fileContentText(JsonRpcMessage msg) {
        Map<String, Object> result = (Map<String, Object>) msg.result();
        List<Map<String, Object>> content = (List<Map<String, Object>>) result.get("content");
        return (String) content.get(0).get("text");
    }

    @Test
    void redactsASecretEmbeddedInRealFileContentAndReplaysTheRedactedContentStructurally(@TempDir Path outputDir)
            throws ExecutionException, InterruptedException, IOException {
        Path cassettePath = outputDir.resolve("read.jsonl");
        String filePath = allowedDir.resolve("config.txt").toString().replace('\\', '/');

        try (ProcessRecorder recorder = new ProcessRecorder(filesystemServerCommand(), cassettePath, true)) {
            recorder.send("initialize", Map.of(
                    "protocolVersion", "2025-06-18", "capabilities", Map.of(),
                    "clientInfo", Map.of("name", "deja-test", "version", "1.0.0")));

            JsonRpcMessage read = recorder.send("tools/call", Map.of("name", "read_text_file", "arguments", Map.of("path", filePath)));
            // Live caller still sees the real secret -- only the cassette is redacted.
            assertThat(fileContentText(read)).contains(FAKE_SECRET);
        }

        String raw = Files.readString(cassettePath);
        assertThat(raw).doesNotContain(FAKE_SECRET);
        assertThat(raw).matches("(?s).*\\[REDACTED:sk:[a-f0-9]{8}].*");

        CassetteContents contents = new CassetteReader(cassettePath).loadAll();
        ReplayEngine engine = new ReplayEngine(contents.frames());

        Optional<JsonRpcMessage> replayed = engine.resolve(
                JsonRpcMessage.request(55, "tools/call", Map.of("name", "read_text_file", "arguments", Map.of("path", filePath)))).get();

        assertThat(replayed).isPresent();
        assertThat(replayed.get().id()).isEqualTo(55);
        assertThat(fileContentText(replayed.get())).doesNotContain(FAKE_SECRET);
        assertThat(fileContentText(replayed.get())).matches("(?s).*\\[REDACTED:sk:[a-f0-9]{8}].*");
    }
}
