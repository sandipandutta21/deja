package dev.deja.core.redact;

import java.util.List;

/** The result of scanning a cassette for unredacted secrets -- the primitive behind a CI
 *  tripwire on committed fixtures (empty {@link #hits()} means clean). */
public record RedactScanReport(String file, List<RedactScanHit> hits) {}
