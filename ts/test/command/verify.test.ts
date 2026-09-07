import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { CassetteReader, CassetteWriter } from "../../src/core/cassette.js";
import { verifyCassette } from "../../src/command/verify.js";
import { CassetteLine } from "../../src/core/types.js";
import { writeScriptFile } from "../helpers/fakeServer.js";

const testDir = resolve(process.cwd(), ".tmp-verify-test");
let echoServerId = 0;

/** A fake MCP server: reads one JSON-RPC request per stdin line, replies with
 *  `{ jsonrpc, id, result: resultFn(request) }` on stdout. `resultFn` is inlined as source so
 *  each test can control exactly what the "live" server answers without a real MCP server. */
async function echoServerCommand(resultFnSource: string): Promise<string[]> {
  const script = [
    "const readline = require('node:readline');",
    "const rl = readline.createInterface({ input: process.stdin });",
    `const resultFn = ${resultFnSource};`,
    "rl.on('line', (line) => {",
    "  const req = JSON.parse(line);",
    "  const result = resultFn(req);",
    "  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\\n');",
    "});",
  ].join("\n");

  return writeScriptFile(testDir, `echo-server-${echoServerId++}.cjs`, script);
}

async function writeCassette(name: string, lines: CassetteLine[]): Promise<string> {
  const path = resolve(testDir, name);
  const writer = new CassetteWriter(path);
  for (const line of lines) writer.write(line);
  await writer.close();
  return path;
}

const header: CassetteLine = { type: "header", version: 1, recorded_at: "now", transport: "stdio" };

describe("verifyCassette", () => {
  beforeAll(async () => {
    if (!existsSync(testDir)) await mkdir(testDir);
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("reports zero differences when the live server matches the recording", async () => {
    const path = await writeCassette("no-drift.jsonl", [
      header,
      { type: "frame", dir: "c2s", t_ms: 0, msg: { jsonrpc: "2.0", id: 1, method: "check", params: {} } },
      { type: "frame", dir: "s2c", t_ms: 1, msg: { jsonrpc: "2.0", id: 1, result: { value: "stable", changed: "same" } } },
    ]);

    const command = await echoServerCommand("() => ({ value: 'stable', changed: 'same' })");
    const report = await verifyCassette(path, command);

    expect(report.totalRequests).toBe(1);
    expect(report.checked).toBe(1);
    expect(report.differences).toHaveLength(0);
  });

  it("reports a difference when the live server drifts", async () => {
    const path = await writeCassette("drift.jsonl", [
      header,
      { type: "frame", dir: "c2s", t_ms: 0, msg: { jsonrpc: "2.0", id: 1, method: "check", params: {} } },
      { type: "frame", dir: "s2c", t_ms: 1, msg: { jsonrpc: "2.0", id: 1, result: { value: "stable" } } },
    ]);

    const command = await echoServerCommand("() => ({ value: 'CHANGED' })");
    const report = await verifyCassette(path, command);

    expect(report.differences).toHaveLength(1);
    expect(report.differences[0].method).toBe("check");
    expect(report.differences[0].requestId).toBe(1);
  });

  it("ignores a top-level result field named in ignoreFields", async () => {
    const path = await writeCassette("ignore-field.jsonl", [
      header,
      { type: "frame", dir: "c2s", t_ms: 0, msg: { jsonrpc: "2.0", id: 1, method: "check", params: {} } },
      { type: "frame", dir: "s2c", t_ms: 1, msg: { jsonrpc: "2.0", id: 1, result: { requestId: "old-id", stable: "same" } } },
    ]);

    const command = await echoServerCommand("() => ({ requestId: 'new-id', stable: 'same' })");
    const report = await verifyCassette(path, command, { ignoreFields: ["requestId"] });

    expect(report.differences).toHaveLength(0);
  });

  it("ignores a nested field named via an ignorePaths JSONPath", async () => {
    const path = await writeCassette("ignore-path.jsonl", [
      header,
      { type: "frame", dir: "c2s", t_ms: 0, msg: { jsonrpc: "2.0", id: 1, method: "check", params: {} } },
      { type: "frame", dir: "s2c", t_ms: 1, msg: { jsonrpc: "2.0", id: 1, result: { metadata: { requestId: "old-id" }, stable: "same" } } },
    ]);

    const command = await echoServerCommand("() => ({ metadata: { requestId: 'new-id' }, stable: 'same' })");
    const report = await verifyCassette(path, command, { ignorePaths: ["$.result.metadata.requestId"] });

    expect(report.differences).toHaveLength(0);
  });

  it("excludes notifications from verification (they have no response to check)", async () => {
    const path = await writeCassette("notification.jsonl", [
      header,
      { type: "frame", dir: "c2s", t_ms: 0, msg: { jsonrpc: "2.0", method: "notifications/initialized" } },
      { type: "frame", dir: "c2s", t_ms: 1, msg: { jsonrpc: "2.0", id: 1, method: "check", params: {} } },
      { type: "frame", dir: "s2c", t_ms: 2, msg: { jsonrpc: "2.0", id: 1, result: { value: "stable" } } },
    ]);

    const command = await echoServerCommand("() => ({ value: 'stable' })");
    const report = await verifyCassette(path, command);

    expect(report.totalRequests).toBe(1); // the notification is not counted as a request
    expect(report.differences).toHaveLength(0);
  });

  it("rewrites the cassette with live responses when update is true, instead of comparing", async () => {
    const path = await writeCassette("update.jsonl", [
      header,
      { type: "frame", dir: "c2s", t_ms: 0, msg: { jsonrpc: "2.0", id: 1, method: "check", params: {} } },
      { type: "frame", dir: "s2c", t_ms: 1, msg: { jsonrpc: "2.0", id: 1, result: { value: "stale" } } },
    ]);

    const command = await echoServerCommand("() => ({ value: 'refreshed' })");
    const report = await verifyCassette(path, command, { update: true });

    expect(report.differences).toHaveLength(0); // update mode never populates differences

    const { header: rewrittenHeader, frames } = await new CassetteReader(path).loadAll();
    expect(rewrittenHeader.transport).toBe("stdio"); // header/provenance preserved
    expect(frames.find((f) => f.dir === "s2c")?.msg.result).toEqual({ value: "refreshed" });
  });
});
