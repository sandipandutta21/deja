import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { CassetteWriter } from "../../src/core/cassette.js";
import { diffCassettes } from "../../src/command/diff.js";
import { CassetteLine } from "../../src/core/types.js";

const testDir = resolve(process.cwd(), ".tmp-diff-test");

async function writeCassette(name: string, lines: CassetteLine[]): Promise<string> {
  const path = resolve(testDir, name);
  const writer = new CassetteWriter(path);
  for (const line of lines) writer.write(line);
  await writer.close();
  return path;
}

const header: CassetteLine = { type: "header", version: 1, recorded_at: "now", transport: "stdio" };

describe("diffCassettes", () => {
  beforeAll(async () => {
    if (!existsSync(testDir)) await mkdir(testDir);
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("reports no changes for two identical cassettes", async () => {
    const lines: CassetteLine[] = [
      header,
      { type: "frame", dir: "c2s", t_ms: 0, msg: { jsonrpc: "2.0", id: 1, method: "tools/list" } },
      { type: "frame", dir: "s2c", t_ms: 1, msg: { jsonrpc: "2.0", id: 1, result: { tools: [{ name: "fetch", inputSchema: { required: ["url"] } }] } } },
    ];
    const v1 = await writeCassette("identical-v1.jsonl", lines);
    const v2 = await writeCassette("identical-v2.jsonl", lines);

    const report = await diffCassettes(v1, v2);
    expect(report.breakingCount).toBe(0);
    expect(report.minorCount).toBe(0);
  });

  it("flags a removed tool as breaking", async () => {
    const v1 = await writeCassette("tool-removed-v1.jsonl", [
      header,
      { type: "frame", dir: "s2c", t_ms: 0, msg: { jsonrpc: "2.0", id: 1, result: { tools: [{ name: "fetch", inputSchema: {} }] } } },
    ]);
    const v2 = await writeCassette("tool-removed-v2.jsonl", [
      header,
      { type: "frame", dir: "s2c", t_ms: 0, msg: { jsonrpc: "2.0", id: 1, result: { tools: [] } } },
    ]);

    const report = await diffCassettes(v1, v2);
    expect(report.breakingCount).toBe(1);
    expect(report.changes[0]).toMatchObject({ severity: "breaking", category: "tool-removed", tool: "fetch" });
  });

  it("flags an added tool as minor", async () => {
    const v1 = await writeCassette("tool-added-v1.jsonl", [
      header,
      { type: "frame", dir: "s2c", t_ms: 0, msg: { jsonrpc: "2.0", id: 1, result: { tools: [] } } },
    ]);
    const v2 = await writeCassette("tool-added-v2.jsonl", [
      header,
      { type: "frame", dir: "s2c", t_ms: 0, msg: { jsonrpc: "2.0", id: 1, result: { tools: [{ name: "new_tool", inputSchema: {} }] } } },
    ]);

    const report = await diffCassettes(v1, v2);
    expect(report.minorCount).toBe(1);
    expect(report.changes[0]).toMatchObject({ severity: "minor", category: "tool-added", tool: "new_tool" });
  });

  it("flags a newly-required parameter as breaking", async () => {
    const v1 = await writeCassette("param-required-v1.jsonl", [
      header,
      { type: "frame", dir: "s2c", t_ms: 0, msg: { jsonrpc: "2.0", id: 1, result: { tools: [{ name: "fetch", inputSchema: { required: ["url"] } }] } } },
    ]);
    const v2 = await writeCassette("param-required-v2.jsonl", [
      header,
      { type: "frame", dir: "s2c", t_ms: 0, msg: { jsonrpc: "2.0", id: 1, result: { tools: [{ name: "fetch", inputSchema: { required: ["url", "timeout"] } }] } } },
    ]);

    const report = await diffCassettes(v1, v2);
    expect(report.changes).toContainEqual(
      expect.objectContaining({ severity: "breaking", category: "param-now-required", tool: "fetch", field: "timeout" })
    );
  });

  it("flags a result<->error flip as breaking, for the same recorded call", async () => {
    const request = { jsonrpc: "2.0" as const, id: 1, method: "tools/call", params: { name: "fetch", url: "https://a.test" } };

    const v1 = await writeCassette("flip-v1.jsonl", [
      header,
      { type: "frame", dir: "c2s", t_ms: 0, msg: request },
      { type: "frame", dir: "s2c", t_ms: 1, msg: { jsonrpc: "2.0", id: 1, result: { ok: true } } },
    ]);
    const v2 = await writeCassette("flip-v2.jsonl", [
      header,
      { type: "frame", dir: "c2s", t_ms: 0, msg: { ...request, id: 99 } },
      { type: "frame", dir: "s2c", t_ms: 1, msg: { jsonrpc: "2.0", id: 99, error: { code: -32000, message: "boom" } } },
    ]);

    const report = await diffCassettes(v1, v2);
    expect(report.breakingCount).toBe(1);
    expect(report.changes[0].category).toBe("result-error-flip");
  });

  it("flags a removed result field as breaking, for the same recorded call", async () => {
    const request = { jsonrpc: "2.0" as const, id: 1, method: "tools/call", params: { name: "fetch", url: "https://a.test" } };

    const v1 = await writeCassette("field-removed-v1.jsonl", [
      header,
      { type: "frame", dir: "c2s", t_ms: 0, msg: request },
      { type: "frame", dir: "s2c", t_ms: 1, msg: { jsonrpc: "2.0", id: 1, result: { status: "ok", latencyMs: 42 } } },
    ]);
    const v2 = await writeCassette("field-removed-v2.jsonl", [
      header,
      { type: "frame", dir: "c2s", t_ms: 0, msg: { ...request, id: 2 } },
      { type: "frame", dir: "s2c", t_ms: 1, msg: { jsonrpc: "2.0", id: 2, result: { status: "ok" } } },
    ]);

    const report = await diffCassettes(v1, v2);
    expect(report.changes).toContainEqual(
      expect.objectContaining({ severity: "breaking", category: "field-removed", field: "latencyMs" })
    );
  });

  it("does not attempt field-diffing when there is no structurally-matching counterpart request", async () => {
    const v1 = await writeCassette("no-counterpart-v1.jsonl", [
      header,
      { type: "frame", dir: "c2s", t_ms: 0, msg: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "fetch", url: "https://a.test" } } },
      { type: "frame", dir: "s2c", t_ms: 1, msg: { jsonrpc: "2.0", id: 1, result: { ok: true } } },
    ]);
    const v2 = await writeCassette("no-counterpart-v2.jsonl", [
      header,
      { type: "frame", dir: "c2s", t_ms: 0, msg: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "fetch", url: "https://totally-different.test" } } },
      { type: "frame", dir: "s2c", t_ms: 1, msg: { jsonrpc: "2.0", id: 1, result: { ok: true } } },
    ]);

    const report = await diffCassettes(v1, v2);
    expect(report.changes).toHaveLength(0);
  });
});
