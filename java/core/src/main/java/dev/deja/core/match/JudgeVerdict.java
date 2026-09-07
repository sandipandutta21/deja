package dev.deja.core.match;

/** The outcome of escalating an uncertain semantic match to an LLM judge. */
public record JudgeVerdict(boolean equivalent) {}
