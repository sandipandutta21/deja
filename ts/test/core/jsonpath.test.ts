import { describe, it, expect } from "vitest";
import { IGNORED_SENTINEL, maskPath } from "../../src/core/jsonpath.js";

describe("jsonpath", () => {
  it("masks a simple dotted path", () => {
    const obj = { result: { metadata: { requestId: "abc-123", other: "keep" } } };
    maskPath(obj, "$.result.metadata.requestId");
    expect(obj.result.metadata.requestId).toBe(IGNORED_SENTINEL);
    expect(obj.result.metadata.other).toBe("keep");
  });

  it("masks a specific array index", () => {
    const obj = { result: { items: ["a", "b", "c"] } };
    maskPath(obj, "$.result.items[1]");
    expect(obj.result.items).toEqual(["a", IGNORED_SENTINEL, "c"]);
  });

  it("masks a field across every array element via wildcard", () => {
    const obj = { result: { items: [{ id: 1, name: "x" }, { id: 2, name: "y" }] } };
    maskPath(obj, "$.result.items[*].id");
    expect(obj.result.items[0].id).toBe(IGNORED_SENTINEL);
    expect(obj.result.items[1].id).toBe(IGNORED_SENTINEL);
    expect(obj.result.items[0].name).toBe("x");
    expect(obj.result.items[1].name).toBe("y");
  });

  it("is a silent no-op for a path that doesn't resolve", () => {
    const obj = { result: { metadata: { requestId: "abc" } } };
    expect(() => maskPath(obj, "$.result.metadata.nonexistent.deep")).not.toThrow();
    expect(obj.result.metadata.requestId).toBe("abc");
  });

  it("is a no-op when the array index is out of range", () => {
    const obj = { result: { items: ["a"] } };
    maskPath(obj, "$.result.items[5]");
    expect(obj.result.items).toEqual(["a"]);
  });

  it("masks the whole value when the path has a single segment", () => {
    const obj = { token: "secret" };
    maskPath(obj, "$.token");
    expect(obj.token).toBe(IGNORED_SENTINEL);
  });

  it("does not throw when the path targets a primitive along the way", () => {
    const obj = { result: "just a string" };
    expect(() => maskPath(obj, "$.result.nested")).not.toThrow();
  });
});
