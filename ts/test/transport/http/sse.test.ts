import { describe, it, expect } from "vitest";
import { SseParser, extractJsonRpcFromSse, formatSseEvent } from "../../../src/transport/http/sse.js";

describe("SseParser", () => {
  it("parses a single complete event fed in one chunk", () => {
    const parser = new SseParser();
    const events = parser.feed('event: message\ndata: {"a":1}\n\n');

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("message");
    expect(events[0].data).toBe('{"a":1}');
  });

  it("parses an event split arbitrarily across multiple chunks", () => {
    const parser = new SseParser();
    const raw = 'event: message\ndata: {"hello":"world"}\n\n';

    const events: string[] = [];
    for (const char of raw) {
      events.push(...parser.feed(char).map((e) => e.data));
    }

    expect(events).toEqual(['{"hello":"world"}']);
  });

  it("joins multiple data: lines within one event with newlines", () => {
    const parser = new SseParser();
    const events = parser.feed("data: line1\ndata: line2\n\n");
    expect(events[0].data).toBe("line1\nline2");
  });

  it("ignores comment lines and blank lines", () => {
    const parser = new SseParser();
    const events = parser.feed(":this is a comment\ndata: real\n\n");
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("real");
  });

  it("captures the id field", () => {
    const parser = new SseParser();
    const events = parser.feed("id: 42\ndata: payload\n\n");
    expect(events[0].id).toBe("42");
  });

  it("normalizes CRLF line endings", () => {
    const parser = new SseParser();
    const events = parser.feed('event: message\r\ndata: {"a":1}\r\n\r\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('{"a":1}');
  });

  it("handles multiple events delivered in one chunk", () => {
    const parser = new SseParser();
    const events = parser.feed("data: first\n\ndata: second\n\n");
    expect(events.map((e) => e.data)).toEqual(["first", "second"]);
  });

  it("flush() recovers a trailing event with no closing blank line", () => {
    const parser = new SseParser();
    expect(parser.feed("data: unterminated")).toHaveLength(0);
    expect(parser.flush()).toEqual([{ event: undefined, data: "unterminated", id: undefined }]);
  });

  it("flush() on an empty buffer returns nothing", () => {
    const parser = new SseParser();
    expect(parser.flush()).toHaveLength(0);
  });

  it("a data-less event block produces no event", () => {
    const parser = new SseParser();
    const events = parser.feed("event: ping\n\n");
    expect(events).toHaveLength(0);
  });
});

describe("formatSseEvent", () => {
  it("formats a JSON-RPC payload as a single data: line terminated by a blank line", () => {
    const formatted = formatSseEvent({ jsonrpc: "2.0", id: 1, result: {} });
    expect(formatted).toBe('data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n');
  });

  it("includes event and id fields when provided", () => {
    const formatted = formatSseEvent({ ok: true }, { event: "message", id: "5" });
    expect(formatted).toBe('event: message\nid: 5\ndata: {"ok":true}\n\n');
  });

  it("round-trips through SseParser", () => {
    const payload = { jsonrpc: "2.0" as const, id: 7, result: { nested: { a: [1, 2, 3] } } };
    const formatted = formatSseEvent(payload);

    const parser = new SseParser();
    const events = parser.feed(formatted);
    expect(JSON.parse(events[0].data)).toEqual(payload);
  });
});

describe("extractJsonRpcFromSse", () => {
  it("extracts every JSON-RPC message from a complete SSE stream", () => {
    const sse = formatSseEvent({ jsonrpc: "2.0", id: 1, result: {} }) + formatSseEvent({ jsonrpc: "2.0", method: "notifications/x" });
    const messages = extractJsonRpcFromSse(sse);

    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe(1);
    expect(messages[1].method).toBe("notifications/x");
  });

  it("silently skips non-JSON SSE payloads (e.g. keepalive comments)", () => {
    const sse = ": keepalive\n\n" + formatSseEvent({ jsonrpc: "2.0", id: 1, result: {} });
    const messages = extractJsonRpcFromSse(sse);
    expect(messages).toHaveLength(1);
  });
});
