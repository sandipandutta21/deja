import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { CassetteReader, CassetteWriter } from "../../src/core/cassette.js";
import { scanCassette } from "../../src/command/redact.js";
import { verifyCassette } from "../../src/command/verify.js";
import { diffCassettes } from "../../src/command/diff.js";
import { readOneLine, readUntilId, waitForExit } from "../helpers/process.js";
import { CLI_PATH, everythingServerCommand, initializeRequest, INITIALIZED_NOTIFICATION } from "./helpers.js";

// These validate deja end-to-end against a REAL MCP server -- the official reference
// "Everything" server -- rather than hand-crafted fixtures. Real servers behave in ways
// synthetic fixtures don't: they interleave unsolicited notifications, carry deeply nested
// JSON-Schema tool definitions, and their responses aren't things we get to author ourselves.
// Requires `npm run build` to have run first (spawns the built dist/cli.js).

const testDir = resolve(process.cwd(), ".tmp-everything-test");
const TIMEOUT = 30_000;

describe("deja vs. the real MCP Everything server", () => {
    beforeAll(async () => {
        if (!existsSync(testDir)) await mkdir(testDir);
        expect(existsSync(CLI_PATH)).toBe(true);
    });

    afterAll(async () => {
        await rm(testDir, { recursive: true, force: true });
    });

    it(
        "records a real stdio session and replays it byte-for-byte, including a server-initiated notification with no paired request",
        async () => {
            const cassettePath = resolve(testDir, "basic.jsonl");
            const recorder = spawn(process.execPath, [CLI_PATH, "record", "-o", cassettePath, "--", ...everythingServerCommand()]);
            const exitPromise = waitForExit(recorder);

            recorder.stdin.write(JSON.stringify(initializeRequest(1)) + "\n");
            const { match: initResponse } = await readUntilId(recorder.stdout, 1);
            expect(initResponse.result.serverInfo.name).toBe("mcp-servers/everything");

            recorder.stdin.write(JSON.stringify(INITIALIZED_NOTIFICATION) + "\n");

            recorder.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "echo", arguments: { message: "hello-deja" } } }) + "\n");
            const echo = (await readUntilId(recorder.stdout, 2)).match;
            expect(echo.result.content[0].text).toBe("Echo: hello-deja");

            recorder.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get-sum", arguments: { a: 7, b: 5 } } }) + "\n");
            const sum = (await readUntilId(recorder.stdout, 3)).match;
            expect(sum.result.content[0].text).toBe("The sum of 7 and 5 is 12.");

            recorder.stdin.end();
            expect(await exitPromise).toBe(0);

            const { frames } = await new CassetteReader(cassettePath).loadAll();

            // A real server pushes notifications the client never asked for -- prove those
            // get captured too, not just clean request/response pairs.
            expect(frames.some((f) => f.dir === "s2c" && f.msg.method === "notifications/tools/list_changed")).toBe(true);

            // Replay: re-send the exact same requests under different ids and expect
            // byte-for-byte identical results, entirely offline (no server-everything involved).
            const replay = spawn(process.execPath, [CLI_PATH, "replay", cassettePath]);

            replay.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 101, method: "tools/call", params: { name: "echo", arguments: { message: "hello-deja" } } }) + "\n");
            const replayedEcho = JSON.parse(await readOneLine(replay.stdout));
            expect(replayedEcho.id).toBe(101);
            expect(replayedEcho.result.content[0].text).toBe("Echo: hello-deja");

            replay.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 102, method: "tools/call", params: { name: "get-sum", arguments: { a: 7, b: 5 } } }) + "\n");
            const replayedSum = JSON.parse(await readOneLine(replay.stdout));
            expect(replayedSum.result.content[0].text).toBe("The sum of 7 and 5 is 12.");

            replay.kill();
        },
        TIMEOUT
    );

    it(
        "redacts a secret embedded in real tool-call content, without altering what the live client saw",
        async () => {
            const cassettePath = resolve(testDir, "redact.jsonl");
            const fakeSecret = "sk-fakefakefakefakefakefakefakefakefakefake123456";

            const recorder = spawn(process.execPath, [CLI_PATH, "record", "-o", cassettePath, "--", ...everythingServerCommand()]);
            const exitPromise = waitForExit(recorder);

            recorder.stdin.write(JSON.stringify(initializeRequest(1)) + "\n");
            await readUntilId(recorder.stdout, 1);
            recorder.stdin.write(JSON.stringify(INITIALIZED_NOTIFICATION) + "\n");

            recorder.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "echo", arguments: { message: `my key is ${fakeSecret}` } } }) + "\n");
            const echo = (await readUntilId(recorder.stdout, 2)).match;
            // The live round trip still carries the real value -- redaction must never touch that.
            expect(echo.result.content[0].text).toContain(fakeSecret);

            recorder.stdin.end();
            await exitPromise;

            const raw = await readFile(cassettePath, "utf8");
            expect(raw).not.toContain(fakeSecret);
            expect(raw).toMatch(/\[REDACTED:sk:[a-f0-9]{8}\]/);

            const scanReport = await scanCassette(cassettePath);
            expect(scanReport.hits).toHaveLength(0);
        },
        TIMEOUT
    );

    it(
        "verify catches a deliberately-introduced difference against the real live server",
        async () => {
            const cassettePath = resolve(testDir, "verify.jsonl");
            const recorder = spawn(process.execPath, [CLI_PATH, "record", "-o", cassettePath, "--", ...everythingServerCommand()]);
            const exitPromise = waitForExit(recorder);

            recorder.stdin.write(JSON.stringify(initializeRequest(1)) + "\n");
            await readUntilId(recorder.stdout, 1);
            recorder.stdin.write(JSON.stringify(INITIALIZED_NOTIFICATION) + "\n");

            recorder.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get-sum", arguments: { a: 10, b: 15 } } }) + "\n");
            await readUntilId(recorder.stdout, 2);

            recorder.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { message: "stable" } } }) + "\n");
            await readUntilId(recorder.stdout, 3);

            recorder.stdin.end();
            await exitPromise;

            // Simulate drift: pretend the recording captured a different answer than the live
            // server actually gives -- e.g. "this cassette predates a bug fix".
            const { header, frames } = await new CassetteReader(cassettePath).loadAll();
            const mutatedFrames = frames.map((frame) => {
                if (frame.dir === "s2c" && frame.msg.id === 2) {
                    const mutatedMsg = JSON.parse(JSON.stringify(frame.msg));
                    mutatedMsg.result.content[0].text = "The sum of 10 and 15 is 999.";
                    return { ...frame, msg: mutatedMsg };
                }
                return frame;
            });

            const writer = new CassetteWriter(cassettePath);
            writer.write(header);
            for (const frame of mutatedFrames) writer.write(frame);
            await writer.close();

            const report = await verifyCassette(cassettePath, everythingServerCommand());

            expect(report.totalRequests).toBe(3); // initialize, get-sum, echo
            expect(report.differences).toHaveLength(1);
            expect(report.differences[0].requestId).toBe(2);
            expect(report.differences[0].method).toBe("tools/call");
        },
        TIMEOUT
    );

    it(
        "diff detects a removed tool and a newly-required parameter in real tool schemas",
        async () => {
            const v1Path = resolve(testDir, "diff-v1.jsonl");
            const recorder = spawn(process.execPath, [CLI_PATH, "record", "-o", v1Path, "--", ...everythingServerCommand()]);
            const exitPromise = waitForExit(recorder);

            recorder.stdin.write(JSON.stringify(initializeRequest(1)) + "\n");
            await readUntilId(recorder.stdout, 1);
            recorder.stdin.write(JSON.stringify(INITIALIZED_NOTIFICATION) + "\n");

            recorder.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
            await readUntilId(recorder.stdout, 2);

            recorder.stdin.end();
            await exitPromise;

            // Build a "v2" by mutating the real, complex tool schemas server-everything
            // returned -- removing one tool and adding a newly-required parameter to another --
            // proving diff isn't confused by the extra nested fields (annotations, execution,
            // $schema) real schemas carry that hand-written unit fixtures never included.
            const { header, frames } = await new CassetteReader(v1Path).loadAll();
            const v2Frames = frames.map((frame) => {
                if (frame.dir === "s2c" && frame.msg.id === 2) {
                    const mutated = JSON.parse(JSON.stringify(frame.msg));
                    const tools = mutated.result.tools as any[];
                    const withoutEcho = tools.filter((t) => t.name !== "echo");
                    const sumTool = withoutEcho.find((t) => t.name === "get-sum");
                    sumTool.inputSchema.required = [...(sumTool.inputSchema.required ?? []), "precision"];
                    mutated.result.tools = withoutEcho;
                    return { ...frame, msg: mutated };
                }
                return frame;
            });

            const v2Path = resolve(testDir, "diff-v2.jsonl");
            const writer = new CassetteWriter(v2Path);
            writer.write(header);
            for (const frame of v2Frames) writer.write(frame);
            await writer.close();

            const report = await diffCassettes(v1Path, v2Path);

            expect(report.changes).toContainEqual(expect.objectContaining({ severity: "breaking", category: "tool-removed", tool: "echo" }));
            expect(report.changes).toContainEqual(
                expect.objectContaining({ severity: "breaking", category: "param-now-required", tool: "get-sum", field: "precision" })
            );
            expect(report.breakingCount).toBeGreaterThanOrEqual(2);
        },
        TIMEOUT
    );
});
