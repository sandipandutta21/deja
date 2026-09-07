package dev.deja.junit5;

import dev.deja.core.cassette.JsonRpcMessage;

import dev.deja.core.recorder.ProcessRecorder;
import dev.deja.core.replay.ReplayEngine;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

/**
 * Resolves one incoming JSON-RPC message to the response {@link DejaMcpTransport} should
 * deliver back to the MCP SDK's session layer -- {@code Optional.empty()} only for a
 * notification, which never receives a response. {@link ReplayEngine#resolve}
 * already matches this exact shape, so a bare method reference plugs replay mode in directly;
 * record mode adapts {@link ProcessRecorder} to the same shape.
 */
@FunctionalInterface
public interface MessageResolver {
    CompletableFuture<Optional<JsonRpcMessage>> resolve(JsonRpcMessage incoming);
}
