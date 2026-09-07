import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CassetteReader } from "../../src/core/cassette.js";
import { readOneLine, readUntilId, waitForExit } from "../helpers/process.js";
import { CLI_PATH, filesystemServerCommand, initializeRequest, INITIALIZED_NOTIFICATION } from "./helpers.js";

// Validates deja against the real MCP Filesystem reference server: redaction of secrets
// embedded in real file content, and that the semantic matching tier has high precision --
// it must NOT confidently return the wrong file's content for a path that was never recorded.

const testDir = resolve(process.cwd(), ".tmp-filesystem-test");
const allowedDir = resolve(testDir, "allowed");
const TIMEOUT = 30_000;

describe("deja vs. the real MCP Filesystem server", () => {
    beforeAll(async () => {
        if (!existsSync(allowedDir)) await mkdir(allowedDir, { recursive: true });
        await writeFile(resolve(allowedDir, "config.txt"), "API_KEY=sk-fakefakefakefakefakefakefakefakefakefake654321\nother=fine\n", "utf8");
        await writeFile(resolve(allowedDir, "other.txt"), "nothing sensitive here\n", "utf8");
    });

    afterAll(async () => {
        await rm(testDir, { recursive: true, force: true });
    });

    it(
        "redacts a secret embedded in real file content, and replays the (redacted) content structurally",
        async () => {
            const cassettePath = resolve(testDir, "read.jsonl");
            const filePath = resolve(allowedDir, "config.txt").replace(/\\/g, "/");

            const recorder = spawn(process.execPath, [CLI_PATH, "record", "-o", cassettePath, "--", ...filesystemServerCommand(allowedDir)]);
            const exitPromise = waitForExit(recorder);

            recorder.stdin.write(JSON.stringify(initializeRequest(1)) + "\n");
            await readUntilId(recorder.stdout, 1);
            recorder.stdin.write(JSON.stringify(INITIALIZED_NOTIFICATION) + "\n");

            recorder.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "read_text_file", arguments: { path: filePath } } }) + "\n");
            const readResult = (await readUntilId(recorder.stdout, 2)).match;
            // Live client still sees the real secret -- only the cassette is redacted.
            expect(readResult.result.content[0].text).toContain("sk-fakefakefakefakefakefakefakefakefakefake654321");

            recorder.stdin.end();
            expect(await exitPromise).toBe(0);

            const raw = await readFile(cassettePath, "utf8");
            expect(raw).not.toContain("sk-fakefakefakefakefakefakefakefakefakefake654321");
            expect(raw).toMatch(/\[REDACTED:sk:[a-f0-9]{8}\]/);

            // Replay: the exact same request should structurally match and return the
            // (redacted) recorded content -- proving redaction doesn't corrupt replay.
            const replay = spawn(process.execPath, [CLI_PATH, "replay", cassettePath]);
            replay.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 55, method: "tools/call", params: { name: "read_text_file", arguments: { path: filePath } } }) + "\n");
            const replayed = JSON.parse(await readOneLine(replay.stdout));

            expect(replayed.id).toBe(55);
            expect(replayed.result.content[0].text).toMatch(/\[REDACTED:sk:[a-f0-9]{8}\]/);
            expect(replayed.result.content[0].text).not.toContain("sk-fakefakefakefakefakefakefakefakefakefake654321");

            replay.kill();
        },
        TIMEOUT
    );

    it(
        "semantic matching has high precision: a request for a different, never-recorded file is not falsely matched",
        async () => {
            const cassettePath = resolve(testDir, "precision.jsonl");
            const recordedPath = resolve(allowedDir, "config.txt").replace(/\\/g, "/");
            const differentPath = resolve(allowedDir, "other.txt").replace(/\\/g, "/");

            const recorder = spawn(process.execPath, [CLI_PATH, "record", "-o", cassettePath, "--", ...filesystemServerCommand(allowedDir)]);
            const exitPromise = waitForExit(recorder);

            recorder.stdin.write(JSON.stringify(initializeRequest(1)) + "\n");
            await readUntilId(recorder.stdout, 1);
            recorder.stdin.write(JSON.stringify(INITIALIZED_NOTIFICATION) + "\n");

            recorder.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "read_text_file", arguments: { path: recordedPath } } }) + "\n");
            await readUntilId(recorder.stdout, 2);

            recorder.stdin.end();
            await exitPromise;

            // Replay with the semantic tier enabled -- a genuinely different file path must
            // still fail to match. A matcher tuned for high recall at the expense of precision
            // would be actively dangerous here: it would hand back one file's contents in
            // response to a request for a completely different file.
            const replay = spawn(process.execPath, [CLI_PATH, "replay", "--semantic", cassettePath]);
            replay.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 77, method: "tools/call", params: { name: "read_text_file", arguments: { path: differentPath } } }) + "\n");
            const response = JSON.parse(await readOneLine(replay.stdout));

            expect(response.error?.code).toBe(-32603);
            replay.kill();
        },
        TIMEOUT
    );
});
