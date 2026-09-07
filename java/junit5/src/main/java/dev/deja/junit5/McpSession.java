package dev.deja.junit5;

import io.modelcontextprotocol.client.McpSyncClient;

import java.util.Map;

/**
 * A test-scoped handle to a cassette-backed (or, in record mode, live-recorded) MCP session,
 * injected as a test method parameter via {@link Cassette}.
 */
public interface McpSession {

    /** Sends a single request through the cassette (replay mode) or the live recorded server
     *  (record mode), returning its result.
     *
     *  @throws McpSessionException if the resolved response was a JSON-RPC error
     */
    Object request(String method, Map<String, Object> params);

    /** Connects the official MCP Java SDK's synchronous client -- already initialized --
     *  backed by this session's transport, so real client code runs completely unmodified. */
    McpSyncClient connect();
}
