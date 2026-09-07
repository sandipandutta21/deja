package dev.deja.core.redact;

import dev.deja.core.cassette.CassetteContents;
import dev.deja.core.cassette.CassetteFrame;
import dev.deja.core.cassette.CassetteReader;
import dev.deja.core.cassette.CassetteWriter;
import dev.deja.core.cassette.JsonRpcMessage;
import dev.deja.core.json.Canon;
import lombok.experimental.UtilityClass;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** Scans and cleans cassette files for unredacted secrets. Mirrors the TypeScript
 *  implementation's {@code redactCommand.ts}. */
@UtilityClass
public class CassetteRedactor {

    /** Scans a recorded cassette for any frame whose payload still contains an unredacted
     *  secret pattern. */
    public RedactScanReport scan(Path cassettePath) {
        List<CassetteFrame> frames = new CassetteReader(cassettePath).loadAll().frames();
        List<RedactScanHit> hits = new ArrayList<>();

        for (int i = 0; i < frames.size(); i++) {
            for (String rule : Redact.scanForSecrets(frames.get(i).msg())) {
                hits.add(new RedactScanHit(i, rule));
            }
        }

        return new RedactScanReport(cassettePath.toString(), hits);
    }

    /** Re-redacts an existing cassette under the current rule set, preserving header
     *  provenance -- for cleaning cassettes recorded before a rule existed. Idempotent:
     *  already-redacted frames pass through unchanged rather than being double-wrapped.
     *  Returns the number of frames actually changed. */
    public int clean(Path inputPath, Path outputPath) {
        CassetteContents contents = new CassetteReader(inputPath).loadAll();
        int framesRedacted = 0;

        try (CassetteWriter writer = new CassetteWriter(outputPath)) {
            writer.write(contents.header());

            for (CassetteFrame frame : contents.frames()) {
                JsonRpcMessage redactedMsg = Redact.redactMessage(frame.msg());
                if (!Canon.stableStringify(redactedMsg).equals(Canon.stableStringify(frame.msg()))) {
                    framesRedacted++;
                }
                writer.write(frame.withMsg(redactedMsg));
            }
        }

        return framesRedacted;
    }
}
