package dev.deja.junit5;

import dev.deja.core.cassette.JsonRpcMessage;
import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;

import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;

final class DejaSession implements McpSession {

    private final MessageResolver resolver;
    private long nextId = 1;

    DejaSession(MessageResolver resolver) {
        this.resolver = resolver;
    }

    @Override
    public synchronized Object request(String method, Map<String, Object> params) {
        JsonRpcMessage incoming = JsonRpcMessage.request(nextId++, method, params);
        Optional<JsonRpcMessage> response = await(resolver.resolve(incoming));
        JsonRpcMessage msg = response.orElseThrow(() -> new IllegalStateException("Deja: no response for request '" + method + "'"));

        if (msg.error() != null) {
            throw new McpSessionException(msg.error());
        }
        return msg.result();
    }

    @Override
    public McpSyncClient connect() {
        DejaMcpTransport transport = new DejaMcpTransport(resolver);
        McpSyncClient client = McpClient.sync(transport).build();
        client.initialize();
        return client;
    }

    private <T> T await(CompletableFuture<T> future) {
        try {
            return future.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException(e);
        } catch (ExecutionException e) {
            throw new RuntimeException(e.getCause());
        }
    }
}
