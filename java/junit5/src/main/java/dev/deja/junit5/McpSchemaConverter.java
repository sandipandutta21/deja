package dev.deja.junit5;

import dev.deja.core.cassette.JsonRpcError;
import dev.deja.core.cassette.JsonRpcMessage;
import io.modelcontextprotocol.json.McpJsonMapper;
import io.modelcontextprotocol.spec.McpSchema;
import lombok.experimental.UtilityClass;

import dev.deja.core.replay.ReplayEngine;
import java.util.Map;

/**
 * Converts between deja-core's transport-agnostic {@link JsonRpcMessage} (a single flattened
 * record, matching the cassette format) and the MCP Java SDK's own {@code
 * McpSchema.JSONRPCMessage} hierarchy (three separate records: {@code JSONRPCRequest}, {@code
 * JSONRPCNotification}, {@code JSONRPCResponse}). Package-private: an implementation detail of
 * {@link DejaMcpTransport}, not part of deja-junit5's public API.
 */
@UtilityClass
class McpSchemaConverter {

    /**
     * The SDK's own client code constructs outgoing requests with {@code params} already
     * holding a strongly-typed record (e.g. {@code McpSchema.InitializeRequest}), not a plain
     * {@code Map} -- so a naive {@code instanceof Map} check silently drops those params
     * entirely. Converting through the SDK's own {@link McpJsonMapper} (not deja-core's
     * Jackson 2 mapper, which has no reason to understand the SDK's own annotations or
     * whichever Jackson major version it's actually backed by) handles every shape correctly.
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> paramsAsMap(Object params, McpJsonMapper jsonMapper) {
        if (params == null) {
            return null;
        }
        if (params instanceof Map<?, ?> map) {
            return (Map<String, Object>) map;
        }
        return jsonMapper.convertValue(params, Map.class);
    }

    /** Converts an SDK message (as sent by the SDK's own session layer) to deja-core's shape. */
    JsonRpcMessage toDeja(McpSchema.JSONRPCMessage message, McpJsonMapper jsonMapper) {
        if (message instanceof McpSchema.JSONRPCRequest request) {
            return JsonRpcMessage.request(request.id(), request.method(), paramsAsMap(request.params(), jsonMapper));
        }
        if (message instanceof McpSchema.JSONRPCNotification notification) {
            return JsonRpcMessage.notification(notification.method(), paramsAsMap(notification.params(), jsonMapper));
        }
        if (message instanceof McpSchema.JSONRPCResponse response) {
            if (response.error() != null) {
                McpSchema.JSONRPCResponse.JSONRPCError error = response.error();
                return JsonRpcMessage.error(response.id(), new JsonRpcError(error.code(), error.message(), error.data()));
            }
            return JsonRpcMessage.result(response.id(), response.result());
        }
        throw new IllegalArgumentException("Unknown McpSchema.JSONRPCMessage implementation: " + message.getClass());
    }

    /** Converts a deja-core response message back to the SDK's shape -- always a {@code
     *  JSONRPCResponse}, since this direction only ever carries what {@link
     *  ReplayEngine#resolve}/record mode hand back to the transport. */
    McpSchema.JSONRPCMessage toSdkResponse(JsonRpcMessage message) {
        if (message.error() != null) {
            JsonRpcError error = message.error();
            return McpSchema.JSONRPCResponse.error(message.id(),
                    new McpSchema.JSONRPCResponse.JSONRPCError(error.code(), error.message(), error.data()));
        }
        return McpSchema.JSONRPCResponse.result(message.id(), message.result());
    }
}
