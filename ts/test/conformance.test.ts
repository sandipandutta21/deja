import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { CassetteReader, CassetteWriter } from "../src/core/cassette.js";
import { createPlaceholder, redactObject } from "../src/core/redact.js";
import { JsonRpcMessage } from "../src/core/types.js";

// Cross-language conformance: deja-core (Java) and this TS implementation must read and
// write byte-compatible cassettes -- same JSONL shape, same redaction placeholders for the
// same secret. Fixtures live in a directory shared with the Java module (../conformance/,
// a sibling of both ts/ and java/), not under either language's own test resources.
//
// Each side both WRITES its own fixture (deterministically, safe to regenerate any time the
// format changes) and READS + VERIFIES whatever the other side most recently wrote. Run both
// suites once, in either order, to refresh both fixture files; a single run of one side still
// gets full mileage out of whatever the other side already committed.

const CONFORMANCE_DIR = resolve(process.cwd(), "../conformance");
const TS_WRITTEN_PATH = resolve(CONFORMANCE_DIR, "ts-written.jsonl");
const JAVA_WRITTEN_PATH = resolve(CONFORMANCE_DIR, "java-written.jsonl");

// The same raw secret both languages redact independently -- proves the placeholder (SHA-256
// of the UTF-8 secret, first 8 hex characters) is byte-identical across implementations, not
// just "some hash neither side can verify against the other."
const SHARED_SECRET = "sk-conformancetestsecret1234567890abcdefgh";

describe("cross-language conformance", () => {
  beforeAll(async () => {
    if (!existsSync(CONFORMANCE_DIR)) await mkdir(CONFORMANCE_DIR, { recursive: true });

    const writer = new CassetteWriter(TS_WRITTEN_PATH);
    writer.write({
      type: "header",
      version: 1,
      recorded_at: "2026-01-01T00:00:00.000Z",
      transport: "stdio",
      server_command: ["node", "server.js"],
    });
    writer.write({
      type: "frame",
      dir: "c2s",
      t_ms: 0,
      msg: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "fetch",
          url: "https://example.com/data",
          nested: { array: [1, 2, 3], flag: true },
          _meta: { progressToken: "abc" },
        },
      },
    });
    writer.write({
      type: "frame",
      dir: "s2c",
      t_ms: 1,
      msg: redactObject({
        jsonrpc: "2.0",
        id: 1,
        result: { ok: true, secretNote: `my key is ${SHARED_SECRET}` },
      }) as JsonRpcMessage,
    });
    writer.write({
      type: "frame",
      dir: "c2s",
      t_ms: 2,
      msg: { jsonrpc: "2.0", method: "notifications/initialized" },
    });
    await writer.close();
  });

  it("writes a cassette other implementations should be able to read", async () => {
    const { header, frames } = await new CassetteReader(TS_WRITTEN_PATH).loadAll();
    expect(header.transport).toBe("stdio");
    expect(frames).toHaveLength(3);
  });

  it("computes the same redaction placeholder for a given secret as any other implementation must", () => {
    // Not compared against Java directly here (that happens in deja-core's ConformanceTest,
    // reading this very file) -- this documents the exact algorithm contract: SHA-256 of the
    // UTF-8 secret, first 8 hex characters, in "[REDACTED:<rule>:<hash>]".
    const placeholder = createPlaceholder("sk", SHARED_SECRET);
    expect(placeholder).toMatch(/^\[REDACTED:sk:[a-f0-9]{8}]$/);
  });

  it.skipIf(!existsSync(JAVA_WRITTEN_PATH))("reads a cassette written by deja-core (Java) and validates it structurally", async () => {
    const { header, frames } = await new CassetteReader(JAVA_WRITTEN_PATH).loadAll();

    expect(header.transport).toBe("stdio");

    const request = frames.find((f) => f.dir === "c2s" && f.msg.id === 1);
    expect(request?.msg.method).toBe("tools/call");
    expect((request?.msg.params as any).nested.array).toEqual([1, 2, 3]);

    const response = frames.find((f) => f.dir === "s2c" && f.msg.id === 1);
    const secretNote = (response?.msg.result as any).secretNote as string;
    // Java independently computed this placeholder for the exact same raw secret -- if the
    // hash algorithms ever diverged, this specific assertion is what would catch it.
    expect(secretNote).toContain(createPlaceholder("sk", SHARED_SECRET));

    const notification = frames.find((f) => f.dir === "c2s" && f.msg.id === undefined);
    expect(notification?.msg.method).toBe("notifications/initialized");
  });
});
