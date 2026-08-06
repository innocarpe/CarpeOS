import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { digestSha256, jcs } from "../src/jcs.js";
import { redactVector, type RedactVectorInput } from "../src/redaction.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const vectors = JSON.parse(
  readFileSync(join(ROOT, "fixtures/v5/m0/redact_v1_vectors.json"), "utf8"),
) as RedactVectorInput[];

describe("redact_v1 vectors", () => {
  it("loads exactly 24 literal vectors", () => {
    expect(vectors).toHaveLength(24);
  });

  it("recomputes exact-array JCS digest", () => {
    expect(digestSha256(vectors)).toBe(
      "sha256:a020e5cbb35a3249c0e5060e2094aa225a14f99a193673249f6a461a5dfd6eeb",
    );
  });

  for (const vector of vectors) {
    it(`matches expected for ${vector.id}`, () => {
      const result = redactVector(vector);
      const expected = (
        vector as RedactVectorInput & {
          expected: unknown;
        }
      ).expected as { ok: boolean; error?: unknown; pack?: unknown; records?: unknown };

      expect(result.ok).toBe(expected.ok);
      if (!expected.ok && !result.ok) {
        expect(result.error).toEqual(expected.error);
      } else if (expected.ok && result.ok) {
        expect(result.pack).toEqual(expected.pack);
        expect(result.records).toEqual(expected.records);
      }
    });
  }

  it("does not reconstruct wrappers for JCS input", () => {
    // Hash is over the literal array as loaded, not re-encoded envelopes
    const again = JSON.parse(jcs(vectors));
    expect(again).toHaveLength(24);
  });
});
