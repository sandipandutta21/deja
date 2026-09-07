package dev.deja.junit5;

import dev.deja.core.cassette.JsonRpcMessage;
import io.modelcontextprotocol.json.McpJsonDefaults;
import io.modelcontextprotocol.json.McpJsonMapper;
import io.modelcontextprotocol.json.TypeRef;
import io.modelcontextprotocol.spec.McpClientTransport;
import io.modelcontextprotocol.spec.McpSchema;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;

import dev.deja.core.recorder.ProcessRecorder;
import dev.deja.core.replay.ReplayEngine;
import java.util.function.Function;

/**
 * An {@link McpClientTransport} backed by a {@link MessageResolver} instead of a real wire --
 * the official MCP Java SDK's {@code McpClient} runs completely unmodified against it,
 * whether that resolver is {@link ReplayEngine#resolve} (replay mode) or an
 * adapter over {@link ProcessRecorder} (record mode).
 *
 * <p>Modeled directly on the SDK's own {@code StdioClientTransport}: {@link #sendMessage}
 * enqueues (here: kicks off resolution of) an outgoing message and returns immediately,
 * exactly as a real wire transport would; the response arrives independently, asynchronously,
 * on the same inbound sink {@link #connect} wires to the SDK's own dispatch handler. There is
 * no synchronous request/response coupling at this layer -- the SDK's session layer is what
 * correlates a response back to the call that's actually waiting for it, by JSON-RPC id.
 */
final class DejaMcpTransport implements McpClientTransport {

    private final MessageResolver resolver;
    private final McpJsonMapper jsonMapper;
    private final Sinks.Many<McpSchema.JSONRPCMessage> inboundSink = Sinks.many().unicast().onBackpressureBuffer();

    DejaMcpTransport(MessageResolver resolver) {
        this(resolver, McpJsonDefaults.getMapper());
    }

    DejaMcpTransport(MessageResolver resolver, McpJsonMapper jsonMapper) {
        this.resolver = resolver;
        this.jsonMapper = jsonMapper;
    }

    @Override
    public Mono<Void> connect(Function<Mono<McpSchema.JSONRPCMessage>, Mono<McpSchema.JSONRPCMessage>> handler) {
        return Mono.fromRunnable(() -> inboundSink.asFlux().flatMap(message -> Mono.just(message).transform(handler)).subscribe());
    }

    @Override
    public Mono<Void> sendMessage(McpSchema.JSONRPCMessage message) {
        return Mono.fromRunnable(() -> {
            JsonRpcMessage dejaMessage = McpSchemaConverter.toDeja(message, jsonMapper);
            resolver.resolve(dejaMessage).thenAccept(maybeResponse ->
                    maybeResponse.ifPresent(response -> inboundSink.tryEmitNext(McpSchemaConverter.toSdkResponse(response))));
        });
    }

    @Override
    public Mono<Void> closeGracefully() {
        return Mono.fromRunnable(inboundSink::tryEmitComplete);
    }

    @Override
    public <T> T unmarshalFrom(Object data, TypeRef<T> typeRef) {
        return jsonMapper.convertValue(data, typeRef);
    }
}
