package dev.deja.core.match;

import dev.deja.core.cassette.JsonRpcMessage;
import lombok.Builder;
import lombok.Value;

import java.util.List;
import java.util.function.Function;

/** Input to {@link Match#findSemanticMatch}: a generic best-match search over any candidate
 *  type {@code T}, given a way to extract the {@link JsonRpcMessage} each candidate represents. */
@Value
@Builder
public class SemanticMatchOptions<T> {
    List<T> candidates;
    Function<T, JsonRpcMessage> messageExtractor;
    Double threshold;
    SemanticJudge judge;
}
