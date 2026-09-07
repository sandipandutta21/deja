package dev.deja.core.match;

import lombok.Builder;

/**
 * Configuration for the semantic matching tier.
 *
 * @param threshold minimum deterministic similarity score to accept a match, in {@code [0, 1]};
 *                  {@code null} means {@link #DEFAULT_THRESHOLD}
 * @param judge     optional LLM fallback for the uncertain band just below the threshold
 */
@Builder
public record SemanticConfig(Double threshold, SemanticJudge judge) {

    public static final double DEFAULT_THRESHOLD = 0.75;

    public double thresholdOrDefault() {
        return threshold != null ? threshold : DEFAULT_THRESHOLD;
    }
}
