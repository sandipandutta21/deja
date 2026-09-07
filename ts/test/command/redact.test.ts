import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { CassetteReader, CassetteWriter } from "../../src/core/cassette.js";
import { cleanCassette, runClean, runScan, scanCassette } from "../../src/command/redact.js";
import { CassetteLine } from "../../src/core/types.js";

const testDir = resolve(process.cwd(), ".tmp-redact-command-test");

async function writeCassette(name: string, lines: CassetteLine[]): Promise<string> {
  const path = resolve(testDir, name);
  const writer = new CassetteWriter(path);
  for (const line of lines) writer.write(line);
  await writer.close();
  return path;
}

const header: CassetteLine = { type: "header", version: 1, recorded_at: "now", transport: "stdio" };

describe("redact", () => {
  beforeAll(async () => {
    if (!existsSync(testDir)) await mkdir(testDir);
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("scanCassette", () => {
    it("finds no hits in a properly redacted cassette", async () => {
      const path = await writeCassette("clean.jsonl", [
        header,
        { type: "frame", dir: "c2s", t_ms: 0, msg: { jsonrpc: "2.0", id: 1, method: "tools/list" } },
      ]);

      const report = await scanCassette(path);
      expect(report.hits).toHaveLength(0);
    });

    it("finds a hit when a frame still contains a raw secret pattern", async () => {
      const path = await writeCassette("dirty.jsonl", [
        header,
        {
          type: "frame",
          dir: "s2c",
          t_ms: 0,
          msg: { jsonrpc: "2.0", id: 1, result: { note: "token sk-abc123def456ghi789jkl012mno345pqr678stu901" } },
        },
      ]);

      const report = await scanCassette(path);
      expect(report.hits).toEqual([{ frameIndex: 0, rule: "sk" }]);
    });

    it("finds a hit when a sensitive key still holds a raw value", async () => {
      const path = await writeCassette("dirty-key.jsonl", [
        header,
        { type: "frame", dir: "c2s", t_ms: 0, msg: { jsonrpc: "2.0", id: 1, method: "auth", params: { apiKey: "raw-value" } } },
      ]);

      const report = await scanCassette(path);
      expect(report.hits.map((h) => h.rule)).toContain("key_match");
    });
  });

  describe("cleanCassette", () => {
    it("preserves header provenance while redacting frames", async () => {
      const path = await writeCassette("to-clean.jsonl", [
        { type: "header", version: 1, recorded_at: "2020-01-01T00:00:00Z", transport: "stdio", server_command: ["node", "server.js"] },
        { type: "frame", dir: "c2s", t_ms: 0, msg: { jsonrpc: "2.0", id: 1, method: "auth", params: { apiKey: "raw-value" } } },
      ]);
      const outPath = resolve(testDir, "cleaned.jsonl");

      const { framesRedacted } = await cleanCassette(path, outPath);
      expect(framesRedacted).toBe(1);

      const { header: cleanedHeader, frames } = await new CassetteReader(outPath).loadAll();
      expect(cleanedHeader.recorded_at).toBe("2020-01-01T00:00:00Z");
      expect(cleanedHeader.server_command).toEqual(["node", "server.js"]);
      expect((frames[0].msg.params as any).apiKey).toMatch(/\[REDACTED:key_match:[a-f0-9]{8}\]/);
    });

    it("is idempotent -- cleaning an already-clean cassette redacts zero frames", async () => {
      const path = await writeCassette("already-clean.jsonl", [
        header,
        { type: "frame", dir: "c2s", t_ms: 0, msg: { jsonrpc: "2.0", id: 1, method: "tools/list" } },
      ]);
      const outPath = resolve(testDir, "still-clean.jsonl");

      const { framesRedacted } = await cleanCassette(path, outPath);
      expect(framesRedacted).toBe(0);
    });
  });

  describe("runScan", () => {
    it("exits 0 and logs a pass when every cassette is clean", async () => {
      const path = await writeCassette("scan-clean.jsonl", [
        header,
        { type: "frame", dir: "c2s", t_ms: 0, msg: { jsonrpc: "2.0", id: 1, method: "tools/list" } },
      ]);

      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await runScan([path]);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("passed"));
    });

    it("exits 1 when a cassette still has an unredacted secret", async () => {
      const path = await writeCassette("scan-dirty.jsonl", [
        header,
        {
          type: "frame",
          dir: "s2c",
          t_ms: 0,
          msg: { jsonrpc: "2.0", id: 1, result: { note: "sk-abc123def456ghi789jkl012mno345pqr678stu901" } },
        },
      ]);

      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      vi.spyOn(console, "error").mockImplementation(() => {});

      await runScan([path]);

      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("runClean", () => {
    it("writes the cleaned cassette and logs a summary", async () => {
      const path = await writeCassette("run-clean-in.jsonl", [
        header,
        { type: "frame", dir: "c2s", t_ms: 0, msg: { jsonrpc: "2.0", id: 1, method: "auth", params: { apiKey: "raw-value" } } },
      ]);
      const outPath = resolve(testDir, "run-clean-out.jsonl");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await runClean(path, outPath);

      expect(existsSync(outPath)).toBe(true);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("1 frame(s) redacted"));
    });
  });
});
