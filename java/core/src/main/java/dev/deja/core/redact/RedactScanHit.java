package dev.deja.core.redact;

/** One frame that still contains an unredacted secret. */
public record RedactScanHit(int frameIndex, String rule) {}
