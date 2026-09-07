package dev.deja.core.cassette;

/** A recorded client request paired with the response the cassette will replay for it. */
public record Interaction(CassetteFrame request, CassetteFrame response) {}
