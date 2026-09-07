package dev.deja.junit5;

import dev.deja.core.cassette.JsonRpcError;

/** Thrown by {@link McpSession#request} when the resolved response was a JSON-RPC error. */
public final class McpSessionException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final transient JsonRpcError error;

    public McpSessionException(JsonRpcError error) {
        super("Deja: request failed: [" + error.code() + "] " + error.message());
        this.error = error;
    }

    public JsonRpcError error() {
        return error;
    }
}
