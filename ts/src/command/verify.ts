import {ChildProcessByStdio, spawn} from "node:child_process";
import { createInterface, Interface } from "node:readline";
import { ChildProcessWithoutNullStreams } from "node:child_process";
import { CassetteReader, CassetteWriter } from "../core/cassette.js";
import { stableStringify } from "../core/canon.js";
import { maskPath } from "../core/jsonpath.js";
import { CassetteFrame, JsonRpcMessage, VerifyDifference, VerifyOptions, VerifyReport } from "../core/types.js";
import {Readable, Writable} from "node:stream";

/** Strips fields both tiers of ignore config agree should never cause a diff: MCP's own
 *  `_meta` (always volatile), caller-specified top-level result fields, then caller-specified
 *  JSONPath locations anywhere in the message. */
function cleanPayload(msg: JsonRpcMessage, ignoreFields: string[], ignorePaths: string[]): Record<string, unknown> {
    const clone = JSON.parse(JSON.stringify(msg)) as Record<string, any>;

    if (clone.result?._meta) delete clone.result._meta;

    for (const field of ignoreFields) {
        if (clone.result && field in clone.result) delete clone.result[field];
    }

    for (const path of ignorePaths) {
        maskPath(clone, path);
    }

    return clone;
}

function sendAndAwaitResponse(
    child: ChildProcessByStdio<Writable, Readable, null>,
    rlOut: Interface,
    msg: JsonRpcMessage
): Promise<JsonRpcMessage> {
    return new Promise((resolve, reject) => {
        const onLine = (line: string): void => {
            let parsed: JsonRpcMessage;
            try {
                parsed = JSON.parse(line) as JsonRpcMessage;
            } catch (err) {
                rlOut.off("line", onLine);
                reject(err);
                return;
            }

            // Real servers can interleave unsolicited notifications (progress, list_changed,
            // logging) between a request and its actual response -- keep reading until the
            // line whose id actually matches what we just asked for, instead of assuming the
            // very next line on the wire is always the answer.
            if (parsed.id !== msg.id) return;

            rlOut.off("line", onLine);
            resolve(parsed);
        };

        rlOut.on("line", onLine);
        child.stdin.write(JSON.stringify(msg) + "\n");
    });
}

/**
 * Replays every recorded client *request* (notifications have no response to check, so
 * they're excluded) at a live server and diffs the live response against the recorded one.
 * With `options.update`, live responses are written back into the cassette instead of
 * compared -- refreshing goldens after an intentional server change.
 *
 * Pure: returns a report rather than printing or exiting. The CLI layer owns presentation
 * and exit codes; a caller embedding deja gets a structured result either way.
 */
export async function verifyCassette(
    cassettePath: string,
    command: string[],
    options: VerifyOptions = {}
): Promise<VerifyReport> {
    const ignoreFields = options.ignoreFields ?? [];
    const ignorePaths = options.ignorePaths ?? [];

    const { header, frames } = await new CassetteReader(cassettePath).loadAll();

    // Only actual requests (an `id` present) can be verified -- a notification has no
    // recorded response to compare against, and JSON-RPC guarantees it never gets one live.
    const c2sFrames = frames.filter((f) => f.dir === "c2s" && f.msg.id !== undefined);
    const responseById = new Map(
        frames.filter((f) => f.dir === "s2c" && f.msg.id !== undefined).map((f) => [f.msg.id as string | number, f] as
            const)
    );

    const child = spawn(command[0], command.slice(1), { stdio: ["pipe", "pipe", "inherit"] });
    const rlOut = createInterface({ input: child.stdout });

    const differences: VerifyDifference[] = [];
    const updatedFrames: CassetteFrame[] = [...frames];
    let checked = 0;

    for (const reqFrame of c2sFrames) {
        const recordedFrame = responseById.get(reqFrame.msg.id as string | number);
        if (!recordedFrame) continue;
        checked++;

        const liveRes = await sendAndAwaitResponse(child, rlOut, reqFrame.msg);

        if (options.update) {
            const index = updatedFrames.indexOf(recordedFrame);
            updatedFrames[index] = { ...recordedFrame, msg: { ...liveRes, id: reqFrame.msg.id } };
            continue;
        }

        const cleanRecorded = cleanPayload(recordedFrame.msg, ignoreFields, ignorePaths);
        const cleanLive = cleanPayload(liveRes, ignoreFields, ignorePaths);

        if (stableStringify(cleanRecorded) !== stableStringify(cleanLive)) {
            differences.push({
                requestId: reqFrame.msg.id,
                method: reqFrame.msg.method,
                expected: cleanRecorded,
                received: cleanLive,
            });
        }
    }

    rlOut.close();
    child.stdin.end();
    child.kill();

    if (options.update) {
        const writer = new CassetteWriter(cassettePath);
        writer.write(header);
        for (const frame of updatedFrames) writer.write(frame);
        await writer.close();
    }

    return { totalRequests: c2sFrames.length, checked, differences };
}