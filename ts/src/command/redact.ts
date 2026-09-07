import { CassetteReader, CassetteWriter } from "../core/cassette.js";
import { redactObject, scanForSecrets } from "../core/redact.js";
import { CassetteFrame, RedactScanReport } from "../core/types.js";

/** Scans a recorded cassette for any frame whose payload still contains an unredacted secret
 *  pattern. The primitive behind `deja redact --scan`, a CI tripwire on committed fixtures. */
export async function scanCassette(cassettePath: string): Promise<RedactScanReport> {
    const { frames } = await new CassetteReader(cassettePath).loadAll();
    const hits: RedactScanReport["hits"] = [];

    frames.forEach((frame, frameIndex) => {
        for (const rule of scanForSecrets(frame.msg)) {
            hits.push({ frameIndex, rule });
        }
    });

    return { file: cassettePath, hits };
}

/** Runs `deja redact --scan` over one or more cassettes: prints every hit, exits 1 if any file
 *  has one. Designed to sit in CI so an unredacted fixture can never merge silently. */
export async function runScan(cassettePaths: string[]): Promise<void> {
    let totalHits = 0;

    for (const path of cassettePaths) {
        const report = await scanCassette(path);
        for (const hit of report.hits) {
            console.error(`[SECRET] ${path}: frame #${hit.frameIndex} matched rule "${hit.rule}"`);
            totalHits++;
        }
    }

    if (totalHits > 0) {
        console.error(`\nRedact scan failed: ${totalHits} unredacted secret(s) found across ${cassettePaths.length} file(s).`);
        process.exit(1);
        return; // belt-and-suspenders: don't rely solely on process.exit to stop control flow
    }

    console.log(`Redact scan passed: 0 unredacted secrets across ${cassettePaths.length} file(s).`);
}

/** Re-redacts an existing cassette under the current rule set, preserving header provenance
 *  (recorded_at, transport, server_command/target) -- for cleaning cassettes recorded before
 *  a rule existed, or recorded with --no-redact. Idempotent: already-redacted frames pass
 *  through unchanged rather than being double-wrapped. */
export async function cleanCassette(inputPath: string, outputPath: string): Promise<{ framesRedacted: number }> {
    const { header, frames } = await new CassetteReader(inputPath).loadAll();
    const writer = new CassetteWriter(outputPath);
    writer.write(header);

    let framesRedacted = 0;
    for (const frame of frames) {
        const redactedMsg = redactObject(frame.msg);
        if (JSON.stringify(redactedMsg) !== JSON.stringify(frame.msg)) framesRedacted++;
        writer.write({ ...frame, msg: redactedMsg } as CassetteFrame);
    }

    await writer.close();
    return { framesRedacted };
}

export async function runClean(inputPath: string, outputPath: string): Promise<void> {
    const { framesRedacted } = await cleanCassette(inputPath, outputPath);
    console.log(`Deja: wrote ${outputPath} (${framesRedacted} frame(s) redacted)`);
}
