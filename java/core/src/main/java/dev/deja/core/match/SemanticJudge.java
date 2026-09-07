package dev.deja.core.match;

import dev.deja.core.cassette.JsonRpcMessage;

import java.util.concurrent.CompletableFuture;

/**
 * An optional LLM fallback consulted only for the "uncertain band" just under the semantic
 * threshold -- a tiebreaker, never the primary matcher. Returns a future so a real judge
 * (an HTTP call to a model) never blocks a calling thread.
 */
@FunctionalInterface
public interface SemanticJudge {
    CompletableFuture<JudgeVerdict> evaluate(JsonRpcMessage incoming, JsonRpcMessage recorded);
}
