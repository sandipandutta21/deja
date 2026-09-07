import { describe, it, expect } from "vitest";
import { sortKeysDeep, stableStringify } from "../../src/core/canon.js";

describe("canon", () => {
  describe("sortKeysDeep", () => {
    it("sorts top-level keys alphabetically", () => {
      const input = { b: 1, a: 2, c: 3 };
      expect(Object.keys(sortKeysDeep(input))).toEqual(["a", "b", "c"]);
    });

    it("sorts nested object keys recursively", () => {
      const input = { z: { d: 1, b: 2 }, a: 1 };
      const sorted = sortKeysDeep(input) as any;
      expect(Object.keys(sorted)).toEqual(["a", "z"]);
      expect(Object.keys(sorted.z)).toEqual(["b", "d"]);
    });

    it("preserves array order while sorting each element's keys", () => {
      const input = [{ b: 1, a: 2 }, { d: 3, c: 4 }];
      const sorted = sortKeysDeep(input) as any[];
      expect(Object.keys(sorted[0])).toEqual(["a", "b"]);
      expect(Object.keys(sorted[1])).toEqual(["c", "d"]);
    });

    it("leaves primitives and null untouched", () => {
      expect(sortKeysDeep(42)).toBe(42);
      expect(sortKeysDeep("hello")).toBe("hello");
      expect(sortKeysDeep(null)).toBe(null);
      expect(sortKeysDeep(true)).toBe(true);
    });
  });

  describe("stableStringify", () => {
    it("produces identical output regardless of key order", () => {
      const a = { name: "test", args: { x: 1, y: 2 } };
      const b = { args: { y: 2, x: 1 }, name: "test" };
      expect(stableStringify(a)).toBe(stableStringify(b));
    });

    it("still distinguishes genuinely different values", () => {
      const a = { name: "test", args: { x: 1 } };
      const b = { name: "test", args: { x: 2 } };
      expect(stableStringify(a)).not.toBe(stableStringify(b));
    });
  });
});
