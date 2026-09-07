package dev.deja.junit5;

import dev.deja.junit5.fixtures.MinimalMcpServerFixture;
import io.modelcontextprotocol.client.McpSyncClient;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Exercises {@link Cassette} end-to-end against a real MCP server ({@link
 * MinimalMcpServerFixture}), in both directions:
 *
 * <ul>
 *   <li>By default (replay mode), every request is answered from the checked-in fixture
 *       cassette at {@code src/test/resources/fixtures/session.jsonl} -- zero subprocess.
 *   <li>With {@code -DDEJA_MODE=record} (or {@code DEJA_MODE=record} in the environment),
 *       the identical test code below spawns {@link MinimalMcpServerFixture} for real and
 *       re-records that same fixture file -- this is how it was originally generated, and
 *       how it's refreshed if the fixture server's behavior ever changes.
 * </ul>
 *
 * <p>{@code connectsTheRealSdkClientAndListsTools} is the flagship proof: the official MCP
 * Java SDK's {@code McpSyncClient} -- unmodified -- runs its real {@code initialize()}/{@code
 * listTools()} calls through {@link DejaMcpTransport}.
 */
@Cassette(
        value = "src/test/resources/fixtures/session.jsonl",
        record = {"${sys:java.home}/bin/java", "-cp", "${sys:java.class.path}", "dev.deja.junit5.fixtures.MinimalMcpServerFixture"})
class CassetteMcpSessionTest {

    @Test
    void connectsTheRealSdkClientAndListsTools(McpSession session) {
        McpSyncClient client = session.connect();
        try {
            assertThat(client.getServerInfo().name()).isEqualTo("deja-fixture-server");
            assertThat(client.listTools().tools()).isEmpty();
        } finally {
            client.closeGracefully();
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    void requestSendsARawJsonRpcCallThroughTheSession(McpSession session) {
        Object result = session.request("tools/list", null);
        assertThat((Map<String, Object>) result).containsKey("tools");
    }
}
