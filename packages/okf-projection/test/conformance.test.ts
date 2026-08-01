import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkOkfConformance, type OkfBundleFile } from "../src/index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "minimal-accepted");

const goldenFiles: readonly OkfBundleFile[] = [
  "index.md",
  "log.md",
  "decisions/claim_alpha.md",
  "evidence/art_evidence001.md",
  "observations/obs_alpha.md",
].map((path) => ({ path, content: readFileSync(join(fixturesDir, path), "utf8") }));

describe("checkOkfConformance (K3)", () => {
  it("accepts the K1 golden bundle and pinned projection version", () => {
    expect(
      checkOkfConformance({
        files: goldenFiles,
        manifest: { okf_version: "0.2", projection_version: "okf-export/v1" },
      }),
    ).toEqual({
      valid: true,
      diagnostics: [],
    });
  });

  it("requires parseable frontmatter and a non-empty scalar type for concepts", () => {
    const result = checkOkfConformance({
      files: [
        ...requiredRoots(),
        { path: "missing.md", content: "# Missing frontmatter\n" },
        { path: "empty.md", content: "---\ntype: \n---\n" },
        { path: "invalid.md", content: "---\ntype: [Observation]\n---\n" },
        { path: "broken.md", content: '---\ntype: "Observation"\n' },
      ],
      projectionVersion: "okf-export/v1",
    });

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((entry) => [entry.path, entry.code])).toEqual([
      ["broken.md", "invalid_frontmatter"],
      ["empty.md", "missing_type"],
      ["invalid.md", "invalid_type"],
      ["missing.md", "missing_frontmatter"],
    ]);
  });

  it("enforces root index and log shapes plus pinned OKF and projection versions", () => {
    const result = checkOkfConformance({
      files: [
        { path: "index.md", content: '---\nokf_version: "0.1"\n---\nno heading\n' },
        { path: "log.md", content: "# Log\n" },
      ],
      projectionVersion: "okf-export/v2",
    });

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((entry) => entry.code)).toEqual([
      "unsupported_projection_version",
      "invalid_index",
      "unsupported_okf_version",
      "invalid_log",
      "invalid_log",
    ]);
  });

  it("rejects duplicate, unsafe, and nested reserved paths", () => {
    const result = checkOkfConformance({
      files: [
        ...requiredRoots(),
        concept("notes/one.md"),
        concept("notes/one.md"),
        concept("../escape.md"),
        concept("notes/index.md"),
        concept(".carpeos-okf-projection-manifest.json"),
        concept("/absolute.md"),
      ],
      projectionVersion: "okf-export/v1",
    });

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((entry) => [entry.path, entry.code])).toEqual([
      ["../escape.md", "invalid_path"],
      [".carpeos-okf-projection-manifest.json", "reserved_path"],
      ["/absolute.md", "invalid_path"],
      ["notes/index.md", "reserved_path"],
      ["notes/one.md", "duplicate_path"],
    ]);
  });

  it("soft-fails unresolved internal links but rejects links that escape the bundle", () => {
    const result = checkOkfConformance({
      files: [
        { path: "index.md", content: '---\nokf_version: "0.2"\n---\n# Bundle\n' },
        { path: "log.md", content: "# Directory Update Log\n\n## 2026-08-01\n" },
        {
          path: "notes/source.md",
          content:
            '---\ntype: "Observation"\n---\n[Missing](missing.md) [Escape](../../outside.md)\n',
        },
      ],
      projectionVersion: "okf-export/v1",
    });

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual([
      {
        code: "broken_internal_link",
        severity: "warning",
        path: "notes/source.md",
        link: "missing.md",
        message: "internal link does not resolve: missing.md",
      },
      {
        code: "escaping_internal_link",
        severity: "error",
        path: "notes/source.md",
        link: "../../outside.md",
        message: "internal link escapes the bundle: ../../outside.md",
      },
    ]);
  });
  it("requires root index.md", () => {
    expect(
      checkOkfConformance({
        files: [requiredRoots()[1]],
        projectionVersion: "okf-export/v1",
      }).diagnostics,
    ).toContainEqual({
      code: "invalid_index",
      severity: "error",
      path: "index.md",
      message: "root index.md is required",
    });
  });

  it("requires root log.md", () => {
    expect(
      checkOkfConformance({
        files: [requiredRoots()[0]],
        projectionVersion: "okf-export/v1",
      }).diagnostics,
    ).toContainEqual({
      code: "invalid_log",
      severity: "error",
      path: "log.md",
      message: "root log.md is required",
    });
  });

  it("requires projection version evidence", () => {
    expect(
      checkOkfConformance({
        files: requiredRoots(),
      }).diagnostics,
    ).toContainEqual({
      code: "unsupported_projection_version",
      severity: "error",
      path: ".carpeos-okf-projection-manifest.json",
      message: "projection version is required; expected okf-export/v1",
    });
  });

  it("rejects NUL-containing and non-Markdown concept paths", () => {
    const result = checkOkfConformance({
      files: [...requiredRoots(), concept("notes/\0invalid.md"), concept("notes/export.json")],
      projectionVersion: "okf-export/v1",
    });

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((entry) => [entry.path, entry.code])).toEqual([
      ["notes/\0invalid.md", "invalid_path"],
      ["notes/export.json", "invalid_path"],
    ]);
  });
});

function requiredRoots(): readonly [OkfBundleFile, OkfBundleFile] {
  return [
    { path: "index.md", content: '---\nokf_version: "0.2"\n---\n# Bundle\n' },
    { path: "log.md", content: "# Directory Update Log\n\n## 2026-08-01\n" },
  ];
}

function concept(path: string): OkfBundleFile {
  return { path, content: '---\ntype: "Observation"\n---\n# Observation\n' };
}
