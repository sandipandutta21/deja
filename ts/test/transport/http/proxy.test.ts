import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { CassetteReader } from "../../../src/core/cassette.js";
import { startHttpRecordProxy } from "../../../src/transport/http/proxy.js";

const testDir = resolve(process.cwd(), ".tmp-http-proxy-test");

function startUpstream(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; port: number; url: string }> {
  return new Promise((resolvePromise) => {
    const server = createServer(handler);
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolvePromise({ server, port, url: `http://localhost:${port}` });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise) => server.close(() => resolvePromise()));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

describe("startHttpRecordProxy", () => {
  beforeAll(async () => {
    if (!existsSync(testDir)) await mkdir(testDir);
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("forwards a JSON request/response and records both directions", async () => {
    const upstream = await startUpstream(async (req, res) => {
      const msg = JSON.parse(await readBody(req));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { echoedMethod: msg.method } }));
    });

    const cassettePath = resolve(testDir, "basic.jsonl");
    const proxy = await startHttpRecordProxy(upstream.url, cassettePath);

    const res = await fetch(`http://localhost:${proxy.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jsonrpc: "2.0", id: 1, result: { echoedMethod: "tools/list" } });

    await proxy.close();
    await closeServer(upstream.server);

    const { header, frames } = await new CassetteReader(cassettePath).loadAll();
    expect(header.transport).toBe("http");
    expect(header.target).toBe(upstream.url);

    expect(frames.find((f) => f.dir === "c2s")?.msg.method).toBe("tools/list");
    expect(frames.find((f) => f.dir === "s2c")?.msg.result).toEqual({ echoedMethod: "tools/list" });
  });

  it("forwards headers (auth, custom response headers) untouched in both directions", async () => {
    let seenAuthHeader: string | undefined;
    const upstream = await startUpstream(async (req, res) => {
      seenAuthHeader = req.headers["authorization"];
      const msg = JSON.parse(await readBody(req));
      res.writeHead(200, { "content-type": "application/json", "x-upstream-marker": "present" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));
    });

    const cassettePath = resolve(testDir, "headers.jsonl");
    const proxy = await startHttpRecordProxy(upstream.url, cassettePath);

    const res = await fetch(`http://localhost:${proxy.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer live-secret-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });

    expect(seenAuthHeader).toBe("Bearer live-secret-token");
    expect(res.headers.get("x-upstream-marker")).toBe("present");

    await proxy.close();
    await closeServer(upstream.server);
  });

  it("redacts what's written to the cassette without altering what the live client receives", async () => {
    const secret = "sk-abc123def456ghi789jkl012mno345pqr678stu901";
    const upstream = await startUpstream(async (req, res) => {
      const msg = JSON.parse(await readBody(req));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { note: secret } }));
    });

    const cassettePath = resolve(testDir, "redacted.jsonl");
    const proxy = await startHttpRecordProxy(upstream.url, cassettePath);

    const res = await fetch(`http://localhost:${proxy.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    const body = await res.json();
    expect(body.result.note).toBe(secret); // the live client sees the real value

    await proxy.close();
    await closeServer(upstream.server);

    const { frames } = await new CassetteReader(cassettePath).loadAll();
    const recordedNote = (frames.find((f) => f.dir === "s2c")?.msg.result as any).note;
    expect(recordedNote).not.toBe(secret);
    expect(recordedNote).toMatch(/\[REDACTED:sk:[a-f0-9]{8}\]/);
  });

  it("records the raw value when noRedact is set", async () => {
    const secret = "sk-abc123def456ghi789jkl012mno345pqr678stu901";
    const upstream = await startUpstream(async (req, res) => {
      const msg = JSON.parse(await readBody(req));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { note: secret } }));
    });

    const cassettePath = resolve(testDir, "no-redact.jsonl");
    const proxy = await startHttpRecordProxy(upstream.url, cassettePath, { noRedact: true });

    await fetch(`http://localhost:${proxy.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });

    await proxy.close();
    await closeServer(upstream.server);

    const { frames } = await new CassetteReader(cassettePath).loadAll();
    expect((frames.find((f) => f.dir === "s2c")?.msg.result as any).note).toBe(secret);
  });

  it("extracts and records JSON-RPC messages delivered over SSE, passing raw bytes through unchanged", async () => {
    const upstream = await startUpstream(async (req, res) => {
      await readBody(req);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } })}\n\n`);
      res.end();
    });

    const cassettePath = resolve(testDir, "sse.jsonl");
    const proxy = await startHttpRecordProxy(upstream.url, cassettePath);

    const res = await fetch(`http://localhost:${proxy.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "fetch" } }),
    });

    expect(await res.text()).toContain('"ok":true');

    await proxy.close();
    await closeServer(upstream.server);

    const { frames } = await new CassetteReader(cassettePath).loadAll();
    expect(frames.find((f) => f.dir === "s2c")?.msg.result).toEqual({ ok: true });
  });

  it("records every message in a client-sent JSON-RPC batch", async () => {
    const upstream = await startUpstream(async (req, res) => {
      const messages = JSON.parse(await readBody(req));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(messages.map((m: any) => ({ jsonrpc: "2.0", id: m.id, result: {} }))));
    });

    const cassettePath = resolve(testDir, "batch.jsonl");
    const proxy = await startHttpRecordProxy(upstream.url, cassettePath);

    await fetch(`http://localhost:${proxy.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([
        { jsonrpc: "2.0", id: 1, method: "a" },
        { jsonrpc: "2.0", id: 2, method: "b" },
      ]),
    });

    await proxy.close();
    await closeServer(upstream.server);

    const { frames } = await new CassetteReader(cassettePath).loadAll();
    expect(frames.filter((f) => f.dir === "c2s").map((f) => f.msg.method)).toEqual(["a", "b"]);
  });

  it("responds 502 when the upstream is unreachable", async () => {
    // Start a server, grab its port, then close it immediately -- guarantees ECONNREFUSED
    // on that port without depending on any specific "known unused" port number.
    const deadUpstream = await startUpstream((_req, res) => res.end());
    await closeServer(deadUpstream.server);

    const cassettePath = resolve(testDir, "unreachable.jsonl");
    const proxy = await startHttpRecordProxy(deadUpstream.url, cassettePath);

    const res = await fetch(`http://localhost:${proxy.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });

    expect(res.status).toBe(502);
    await proxy.close();
  });
});
