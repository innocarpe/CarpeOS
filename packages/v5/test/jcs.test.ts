import { describe, expect, it } from "vitest";
import { auditFree, digestSha256, jcs, sha256Hex, sha256Jcs } from "../src/jcs.js";

describe("JCS canonicalization", () => {
  it("sorts object keys and omits whitespace", () => {
    expect(jcs({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(jcs([1, { z: true, a: null }])).toBe('[1,{"a":null,"z":true}]');
  });

  it("rejects non-finite numbers", () => {
    expect(() => jcs(Number.NaN)).toThrow(/non-finite/);
    expect(() => jcs(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
  });

  it("hashes JCS deterministically", () => {
    const digest = sha256Jcs({ pack_id: "p1", n: 1 });
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digestSha256({ pack_id: "p1", n: 1 })).toBe(`sha256:${digest}`);
    expect(sha256Hex("abc")).toHaveLength(64);
  });

  it("strips audit_envelope recursively without mutating other keys", () => {
    const input = {
      keep: 1,
      audit_envelope: { created_at: "x" },
      nested: {
        value: "y",
        audit_envelope: { updated_at: "z" },
        arr: [{ audit_envelope: { a: 1 }, ok: true }],
      },
    };
    expect(auditFree(input)).toEqual({
      keep: 1,
      nested: {
        value: "y",
        arr: [{ ok: true }],
      },
    });
  });
});
