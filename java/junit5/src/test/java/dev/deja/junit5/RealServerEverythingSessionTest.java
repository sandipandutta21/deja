package dev.deja.junit5;

import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.spec.McpSchema;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The flagship proof for deja-junit5: the official MCP Java SDK's {@code McpSyncClient} --
 * completely unmodified -- runs its real {@code initialize()}/{@code listTools()}/{@code
 * callTool()} calls through {@link DejaMcpTransport} against the REAL reference "Everything"
 * MCP server (an npm devDependency of the sibling {@code ts/} module, spawned as a real
 * Node.js subprocess in record mode), not a synthetic Java fixture.
 *
 * <p>By default (replay mode), every call is answered from the checked-in fixture cassette --
 * zero subprocess, zero Node.js. With {@code DEJA_MODE=record} in the environment, the
 * identical test code below re-records that same fixture against the live server.
 */
@Cassette(
        value = "src/test/resources/fixtures/everything-session.jsonl",
        record = {"node", "../../ts/node_modules/@modelcontextprotocol/server-everything/dist/index.js", "stdio"})
class RealServerEverythingSessionTest {

    @Test
    void connectsTheRealSdkClientToTheRealEverythingServerAndCallsATool(McpSession session) {
        McpSyncClient client = session.connect();
        try {
            assertThat(client.getServerInfo().name()).isEqualTo("mcp-servers/everything");

            McpSchema.ListToolsResult tools = client.listTools();
            assertThat(tools.tools()).extracting(McpSchema.Tool::name).contains("echo", "get-sum");

            McpSchema.CallToolResult result = client.callTool(new McpSchema.CallToolRequest("echo", Map.of("message", "hello-deja"), null));
            assertThat(result.isError()).isNotEqualTo(Boolean.TRUE);
            assertThat(result.content()).isNotEmpty();
        } finally {
            client.closeGracefully();
        }
    }
}
