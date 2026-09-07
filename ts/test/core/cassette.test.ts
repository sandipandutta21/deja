import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CassetteWriter, CassetteReader } from "../../src/core/cassette.js";
import { resolve } from "node:path";
import { rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

describe("Cassette I/O", () => {
  const testDir = resolve(process.cwd(), ".tmp-test");
  const testFile = resolve(testDir, "test.jsonl");

  beforeAll(async () => {
    if (!existsSync(testDir)) {
      await mkdir(testDir);
    }
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("writes and reads frames sequentially", async () => {
    const writer = new CassetteWriter(testFile);
    
    writer.write({
      type: "header",
      version: 1,
      recorded_at: "2026-09-06T00:00:00Z",
      transport: "stdio",
      server_command: ["node", "test"]
    });
    
    writer.write({
      type: "frame",
      dir: "c2s",
      t_ms: 10,
      msg: { jsonrpc: "2.0", id: 1, method: "ping" }
    });

    await writer.close();

    const reader = new CassetteReader(testFile);
    const { header, frames } = await reader.loadAll();

    expect(header.version).toBe(1);
    expect(frames).toHaveLength(1);
    expect(frames[0].msg.method).toBe("ping");
    expect(frames[0].dir).toBe("c2s");
  });
});