package dev.deja.core.cassette;

import java.util.List;

/** The fully-loaded contents of a cassette file. */
public record CassetteContents(CassetteHeader header, List<CassetteFrame> frames) {}
