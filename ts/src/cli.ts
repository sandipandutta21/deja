#!/usr/bin/env node
import { parseArgs } from "node:util";
import { diffCassettes } from "./command/diff.js";
import { recordHttp, recordStdio } from "./command/record.js";
import { runClean, runScan } from "./command/redact.js";
import { replayHttp, replayStdio } from "./command/replay.js";
import { DiffReport, VerifyReport } from "./core/types.js";
import { verifyCassette } from "./command/verify.js";

const args = process.argv.slice(2);

function printUsage(): void {
    console.error("Usage: deja <command> [options]");
    console.error("Commands: record, replay, verify, diff, redact");
}

if (args.length === 0) {
    printUsage();
    process.exit(1);
}

const command = args[0];
const commandArgs = args.slice(1);

/** Splits `... --flag value -- server cmd args` into the deja-facing flags and the
 *  passthrough command, the convention every subcommand that spawns a server shares. */
function splitOnDashDash(rawArgs: string[]): { before: string[]; after: string[] } {
    const index = rawArgs.indexOf("--");
    if (index === -1) return { before: rawArgs, after: [] };
    return { before: rawArgs.slice(0, index), after: rawArgs.slice(index + 1) };
}

function printVerifyReport(report: VerifyReport, updated: boolean): void {
    console.log(`Deja: checked ${report.checked}/${report.totalRequests} recorded request(s) against the live
  server.`);

    for (const diff of report.differences) {
        console.error(`\n[DIFF] request id ${JSON.stringify(diff.requestId)} (${diff.method ?? "unknown method"})`);
        console.error("  expected:", JSON.stringify(diff.expected));
        console.error("  received:", JSON.stringify(diff.received));
    }

    if (updated) {
        console.log(`Deja: cassette updated with ${report.checked} live response(s).`);
    } else if (report.differences.length > 0) {
        console.error(`\nVerify failed: ${report.differences.length} difference(s) found.`);
    } else {
        console.log("Verify passed: zero structural drift detected.");
    }
}

function printDiffReport(report: DiffReport): void {
    for (const change of report.changes) {
        console.log(`[${change.severity.toUpperCase()}] ${change.message}`);
    }
    console.log(`\nResult: ${report.breakingCount} breaking, ${report.minorCount} minor`);
}

async function main(): Promise<void> {
    switch (command) {
        case "record": {
            const { before, after } = splitOnDashDash(commandArgs);
            const { values } = parseArgs({
                args: before,
                options: {
                    output: { type: "string", short: "o" },
                    target: { type: "string" },
                    port: { type: "string" },
                    "no-redact": { type: "boolean" },
                },
                allowPositionals: true,
            });

            const out = values.output || "session.cassette.jsonl";
            const noRedact = !!values["no-redact"];
            const port = values.port ? Number(values.port) : undefined;

            if (values.target) {
                await recordHttp(values.target, out, { port, noRedact });
            } else if (after.length > 0) {
                await recordStdio(after, out, noRedact);
            } else {
                console.error("Error: Provide a server command after '--' " +
                    "(e.g., deja record -o out.jsonl -- nodeserver.js)");
                console.error("       or --target <url> to record a Streamable HTTP server instead.");
                process.exit(1);
            }
            break;
        }
        case "replay": {
            const { values, positionals } = parseArgs({
                args: commandArgs,
                options: {
                    semantic: { type: "boolean" },
                    port: { type: "string" },
                },
                allowPositionals: true,
            });

            const cassettePath = positionals[0];
            if (!cassettePath) {
                console.error("Error: Provide a cassette path (e.g., deja replay session.cassette.jsonl)");
                process.exit(1);
            }

            const semantic = !!values.semantic;

            // Presence of --port picks the HTTP replay server; its absence means stdio --
            // independent of how the cassette was originally recorded (cross-transport replay).
            if (values.port !== undefined) {
                await replayHttp(cassettePath, { semantic, port: Number(values.port) });
            } else {
                await replayStdio(cassettePath, { semantic });
            }
            break;
        }
        case "verify": {
            const { before, after } = splitOnDashDash(commandArgs);
            const { values, positionals } = parseArgs({
                args: before,
                options: {
                    "ignore-fields": { type: "string", multiple: true },
                    "ignore-paths": { type: "string", multiple: true },
                    update: { type: "boolean" },
                },
                allowPositionals: true,
            });

            const cassettePath = positionals[0];
            if (!cassettePath) {
                console.error("Error: Provide a cassette path " +
                    "(e.g., deja verify session.cassette.jsonl -- nodeserver.js)");
                process.exit(1);
            }

            const update = !!values.update;
            const report = await verifyCassette(cassettePath, after, {
                ignoreFields: values["ignore-fields"] ?? [],
                ignorePaths: values["ignore-paths"] ?? [],
                update,
            });

            printVerifyReport(report, update);
            if (!update && report.differences.length > 0) process.exit(1);
            break;
        }
        case "diff": {
            const { values, positionals } = parseArgs({
                args: commandArgs,
                options: {
                    "fail-on-breaking": { type: "boolean" },
                },
                allowPositionals: true,
            });

            if (positionals.length < 2) {
                console.error("Error: Provide two cassette paths to diff (e.g., deja diff v1.jsonl v2.jsonl)");
                process.exit(1);
            }

            const report = await diffCassettes(positionals[0], positionals[1]);
            printDiffReport(report);
            if (values["fail-on-breaking"] && report.breakingCount > 0) process.exit(1);
            break;
        }
        case "redact": {
            const { values, positionals } = parseArgs({
                args: commandArgs,
                options: {
                    scan: { type: "boolean" },
                    output: { type: "string", short: "o" },
                },
                allowPositionals: true,
            });

            if (values.scan) {
                if (positionals.length === 0) {
                    console.error("Error: Provide one or more cassette paths to scan " +
                        "(e.g., deja redact --scansession.cassette.jsonl)");
                    process.exit(1);
                }
                await runScan(positionals);
            } else {
                const input = positionals[0];
                if (!input || !values.output) {
                    console.error("Error: Provide an input cassette and -o <output> " +
                        "(e.g., deja redact -o clean.jsonlsession.cassette.jsonl)");
                    process.exit(1);
                }
                await runClean(input, values.output);
            }
            break;
        }
        default:
            console.error(`Unknown command: ${command}`);
            printUsage();
            process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});