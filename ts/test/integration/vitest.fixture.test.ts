import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { useCassette } from "../../src/integration/vitest.js";
import { CassetteWriter } from "../../src/core/cassette.js";
import { resolve } from "node:path";
import { rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

describe("useCassette Fixture", () => {
  const testDir = resolve(process.cwd(), ".tmp-fixture-test");
  const fixturePath = resolve(testDir, "fixture.jsonl");

  beforeAll(async () => {
    if (!existsSync(testDir)) await mkdir(testDir);

    const writer = new CassetteWriter(fixturePath);
    writer.write({ type: "header", version: 1, recorded_at: "now", transport: "stdio" });
    writer.write({ type: "frame", dir: "c2s", t_ms: 0, msg: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    writer.write({ type: "frame", dir: "s2c", t_ms: 5, msg: { jsonrpc: "2.0", id: 1, result: { tools: [{ name:
                "test-tool" }] } } });
    await writer.close();
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("handles offline replay transparently, with no race against cassette loading", async () => {
    vi.stubEnv("DEJA_MODE", "replay");

    const mcp = useCassette(fixturePath, { record: { command: ["dummy"] } });
    // No artificial delay: request() awaits the cassette load internally now.
    const result = await mcp.request("tools/list");
    expect(result.tools[0].name).toBe("test-tool");

    vi.unstubAllEnvs();
  });

  it("throws on missing structural match in strict mode", async () => {
    vi.stubEnv("DEJA_MODE", "replay");
    const mcp = useCassette(fixturePath, { record: { command: ["dummy"] } });

    await expect(mcp.request("tools/call", { name: "missing" })).rejects.toThrow(/No matching recorded request/);

    vi.unstubAllEnvs();
  });
});