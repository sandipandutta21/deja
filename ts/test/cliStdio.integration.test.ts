import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { CassetteReader, CassetteWriter } from "../src/core/cassette.js";
import { CassetteLine } from "../src/core/types.js";
import { writeScriptFile } from "./helpers/fakeServer.js";
import { readOneLine, waitForExit } from "./helpers/process.js";

// These exercise the actual built CLI (dist/cli.js) in real child processes, so
// recordStdio's `process.exit()` call never touches the vitest worker itself -- the only
// safe way to test that code path for real. Requires `npm run build` to have run first.

const testDir = resolve(process.cwd(), ".tmp-cli-stdio-test");
const cliPath = resolve(process.cwd(), "dist/cli.js");

const fakeServerScriptSource = [
  "const readline = require('node:readline');",
  "const rl = readline.createInterface({ input: process.stdin });",
  "rl.on('line', (line) => {",
  "  const req = JSON.parse(line);",
  "  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { echoed: req.method } }) + '\\n');",
  "});",
  "rl.on('close', () => process.exit(0));",
].join("\n");

describe("deja record (stdio, built CLI)", () => {
  let fakeServerCommand: string[];

  beforeAll(async () => {
    if (!existsSync(testDir)) await mkdir(testDir);
    expect(existsSync(cliPath)).toBe(true);
    fakeServerCommand = await writeScriptFile(testDir, "fake-server.cjs", fakeServerScriptSource);
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("forwards traffic transparently and writes a redacted cassette", async () => {
    const cassettePath = resolve(testDir, "recorded.jsonl");

    const recorder = spawn(process.execPath, [cliPath, "record", "-o", cassettePath, "--", ...fakeServerCommand]);
    const exitPromise = waitForExit(recorder);

    const request = { jsonrpc: "2.0", id: 1, method: "tools/list", params: { note: "sk-abc123def456ghi789jkl012mno345pqr678stu901" } };
    recorder.stdin.write(JSON.stringify(request) + "\n");

    const responseLine = await readOneLine(recorder.stdout);
    expect(JSON.parse(responseLine)).toEqual({ jsonrpc: "2.0", id: 1, result: { echoed: "tools/list" } });

    recorder.stdin.end();
    const exitCode = await exitPromise;
    expect(exitCode).toBe(0);

    const { header, frames } = await new CassetteReader(cassettePath).loadAll();
    expect(header.transport).toBe("stdio");

    const c2s = frames.find((f) => f.dir === "c2s");
    expect(c2s?.msg.method).toBe("tools/list");
    // Redacted on disk even though the live response above carried the real secret.
    expect((c2s?.msg.params as any).note).toMatch(/\[REDACTED:sk:[a-f0-9]{8}\]/);

    const s2c = frames.find((f) => f.dir === "s2c");
    expect(s2c?.msg.result).toEqual({ echoed: "tools/list" });
  });

  it("--no-redact preserves the raw secret in the cassette", async () => {
    const cassettePath = resolve(testDir, "no-redact.jsonl");
    const recorder = spawn(process.execPath, [cliPath, "record", "-o", cassettePath, "--no-redact", "--", ...fakeServerCommand]);
    const exitPromise = waitForExit(recorder);

    const secret = "sk-abc123def456ghi789jkl012mno345pqr678stu901";
    recorder.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "check", params: { token: secret } }) + "\n");
    await readOneLine(recorder.stdout);

    recorder.stdin.end();
    await exitPromise;

    const { frames } = await new CassetteReader(cassettePath).loadAll();
    expect((frames.find((f) => f.dir === "c2s")?.msg.params as any).token).toBe(secret);
  });
});

describe("deja replay (stdio, built CLI)", () => {
  const header: CassetteLine = { type: "header", version: 1, recorded_at: "now", transport: "stdio" };

  beforeAll(async () => {
    if (!existsSync(testDir)) await mkdir(testDir);
  });

  it("answers a structurally-matching request from the cassette", async () => {
    const cassettePath = resolve(testDir, "for-replay.jsonl");
    const writer = new CassetteWriter(cassettePath);
    writer.write(header);
    writer.write({ type: "frame", dir: "c2s", t_ms: 0, msg: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} } });
    writer.write({ type: "frame", dir: "s2c", t_ms: 1, msg: { jsonrpc: "2.0", id: 1, result: { tools: [{ name: "fetch" }] } } });
    await writer.close();

    const replay = spawn(process.execPath, [cliPath, "replay", cassettePath]);

    replay.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 999, method: "tools/list", params: {} }) + "\n");
    const responseLine = await readOneLine(replay.stdout);

    expect(JSON.parse(responseLine)).toEqual({ jsonrpc: "2.0", id: 999, result: { tools: [{ name: "fetch" }] } });

    replay.kill();
  });

  it("returns a -32603 error for an unmatched request", async () => {
    const cassettePath = resolve(testDir, "for-replay-miss.jsonl");
    const writer = new CassetteWriter(cassettePath);
    writer.write(header);
    writer.write({ type: "frame", dir: "c2s", t_ms: 0, msg: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} } });
    writer.write({ type: "frame", dir: "s2c", t_ms: 1, msg: { jsonrpc: "2.0", id: 1, result: { tools: [] } } });
    await writer.close();

    const replay = spawn(process.execPath, [cliPath, "replay", cassettePath]);

    replay.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "resources/list" }) + "\n");
    const responseLine = await readOneLine(replay.stdout);
    const response = JSON.parse(responseLine);

    expect(response.error.code).toBe(-32603);

    replay.kill();
  });
});
