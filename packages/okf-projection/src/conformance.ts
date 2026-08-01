export const OKF_VERSION = "0.2";
export const OKF_PROJECTION_VERSION = "okf-export/v1";
export const OKF_MANIFEST_PATH = ".carpeos-okf-projection-manifest.json";

export type OkfConformanceSeverity = "error" | "warning";

export type OkfConformanceDiagnosticCode =
  | "duplicate_path"
  | "invalid_path"
  | "reserved_path"
  | "missing_frontmatter"
  | "invalid_frontmatter"
  | "missing_type"
  | "invalid_type"
  | "invalid_index"
  | "invalid_log"
  | "unsupported_okf_version"
  | "unsupported_projection_version"
  | "escaping_internal_link"
  | "broken_internal_link";

export interface OkfBundleFile {
  path: string;
  content: string;
}

/**
 * A filesystem-independent description of an OKF export. `projectionVersion`
 * is supplied by the owning manifest when one is available.
 */
export interface OkfConformanceInput {
  files: readonly OkfBundleFile[];
  /** K2 rebuild-plan manifest. */
  manifest?: OkfConformanceManifest;
  /** Convenience for callers that have only the manifest version. */
  projectionVersion?: string;
}

export interface OkfConformanceManifest {
  okf_version: string;
  projection_version: string;
}

export interface OkfConformanceDiagnostic {
  code: OkfConformanceDiagnosticCode;
  severity: OkfConformanceSeverity;
  path: string;
  message: string;
  link?: string;
}

export interface OkfConformanceResult {
  valid: boolean;
  diagnostics: readonly OkfConformanceDiagnostic[];
}

interface ParsedFrontmatter {
  values: ReadonlyMap<string, string>;
  body: string;
}

/**
 * Checks a planned OKF bundle without reading or writing the filesystem.
 * Unresolved internal links are warnings: OKF permits them, while links that
 * escape the bundle are errors.
 */
export function checkOkfConformance(input: OkfConformanceInput): OkfConformanceResult {
  const diagnostics: OkfConformanceDiagnostic[] = [];
  const files = input.files.slice().sort(compareFiles);
  const paths = new Set<string>();
  const uniqueFiles: OkfBundleFile[] = [];

  const projectionVersion = input.manifest?.projection_version ?? input.projectionVersion;
  if (projectionVersion === undefined) {
    diagnostics.push(
      diagnostic(
        "unsupported_projection_version",
        "error",
        OKF_MANIFEST_PATH,
        `projection version is required; expected ${OKF_PROJECTION_VERSION}`,
      ),
    );
  } else if (projectionVersion !== OKF_PROJECTION_VERSION) {
    diagnostics.push(
      diagnostic(
        "unsupported_projection_version",
        "error",
        OKF_MANIFEST_PATH,
        `expected projection version ${OKF_PROJECTION_VERSION}, received ${projectionVersion}`,
      ),
    );
  }
  if (input.manifest !== undefined && input.manifest.okf_version !== OKF_VERSION) {
    diagnostics.push(
      diagnostic(
        "unsupported_okf_version",
        "error",
        OKF_MANIFEST_PATH,
        `expected OKF version ${OKF_VERSION}, received ${input.manifest.okf_version}`,
      ),
    );
  }

  for (const file of files) {
    if (!isSafeBundlePath(file.path)) {
      diagnostics.push(
        diagnostic("invalid_path", "error", file.path, "path must be a safe relative bundle path"),
      );
      continue;
    }
    if (paths.has(file.path)) {
      diagnostics.push(
        diagnostic("duplicate_path", "error", file.path, "path appears more than once"),
      );
      continue;
    }
    paths.add(file.path);
    if (isReservedManagedPath(file.path)) {
      diagnostics.push(
        diagnostic(
          "reserved_path",
          "error",
          file.path,
          "path is reserved for projection-managed output",
        ),
      );
    } else if (!file.path.endsWith(".md")) {
      diagnostics.push(
        diagnostic("invalid_path", "error", file.path, "concept paths must be Markdown files"),
      );
    }
    uniqueFiles.push(file);
  }
  if (!paths.has("index.md")) {
    diagnostics.push(diagnostic("invalid_index", "error", "index.md", "root index.md is required"));
  }
  if (!paths.has("log.md")) {
    diagnostics.push(diagnostic("invalid_log", "error", "log.md", "root log.md is required"));
  }

  for (const file of uniqueFiles) {
    if (file.path === "index.md") {
      checkIndex(file, diagnostics);
    } else if (file.path === "log.md") {
      checkLog(file, diagnostics);
    } else if (file.path.endsWith(".md")) {
      checkConcept(file, diagnostics);
    }
    checkInternalLinks(file, paths, diagnostics);
  }

  diagnostics.sort(compareDiagnostics);
  return {
    valid: !diagnostics.some((entry) => entry.severity === "error"),
    diagnostics,
  };
}

function checkConcept(file: OkfBundleFile, diagnostics: OkfConformanceDiagnostic[]): void {
  const frontmatter = parseFrontmatter(file.content);
  if (frontmatter === undefined) {
    diagnostics.push(
      diagnostic(
        "missing_frontmatter",
        "error",
        file.path,
        "concept Markdown requires YAML frontmatter",
      ),
    );
    return;
  }
  if (frontmatter === null) {
    diagnostics.push(
      diagnostic("invalid_frontmatter", "error", file.path, "frontmatter is not parseable YAML"),
    );
    return;
  }
  const type = frontmatter.values.get("type");
  if (type === undefined || type.trim() === "") {
    diagnostics.push(
      diagnostic(
        "missing_type",
        "error",
        file.path,
        "concept frontmatter requires a non-empty type",
      ),
    );
  } else if (!isValidType(type)) {
    diagnostics.push(
      diagnostic(
        "invalid_type",
        "error",
        file.path,
        "concept frontmatter type must be a scalar string",
      ),
    );
  }
}

function checkIndex(file: OkfBundleFile, diagnostics: OkfConformanceDiagnostic[]): void {
  const frontmatter = parseFrontmatter(file.content);
  if (frontmatter === undefined || frontmatter === null) {
    diagnostics.push(
      diagnostic(
        "invalid_index",
        "error",
        file.path,
        "root index.md requires parseable YAML frontmatter",
      ),
    );
    return;
  }
  if (frontmatter.values.get("okf_version") !== OKF_VERSION) {
    diagnostics.push(
      diagnostic(
        "unsupported_okf_version",
        "error",
        file.path,
        `root index.md must declare okf_version: ${OKF_VERSION}`,
      ),
    );
  }
  if (!/^#\s+\S/m.test(frontmatter.body)) {
    diagnostics.push(
      diagnostic("invalid_index", "error", file.path, "root index.md requires a Markdown heading"),
    );
  }
}

function checkLog(file: OkfBundleFile, diagnostics: OkfConformanceDiagnostic[]): void {
  if (!/^# Directory Update Log\s*$/m.test(file.content)) {
    diagnostics.push(
      diagnostic(
        "invalid_log",
        "error",
        file.path,
        "root log.md must contain the Directory Update Log heading",
      ),
    );
  }
  if (!/^## \d{4}-\d{2}-\d{2}\s*$/m.test(file.content)) {
    diagnostics.push(
      diagnostic(
        "invalid_log",
        "error",
        file.path,
        "root log.md requires at least one dated update section",
      ),
    );
  }
}

function checkInternalLinks(
  file: OkfBundleFile,
  paths: ReadonlySet<string>,
  diagnostics: OkfConformanceDiagnostic[],
): void {
  for (const link of markdownLinks(file.content)) {
    const target = internalLinkTarget(link);
    if (target === undefined) {
      continue;
    }
    const resolved = resolveBundlePath(file.path, target);
    if (resolved === undefined) {
      diagnostics.push(
        diagnostic(
          "escaping_internal_link",
          "error",
          file.path,
          `internal link escapes the bundle: ${link}`,
          link,
        ),
      );
    } else if (!paths.has(resolved)) {
      diagnostics.push(
        diagnostic(
          "broken_internal_link",
          "warning",
          file.path,
          `internal link does not resolve: ${link}`,
          link,
        ),
      );
    }
  }
}

function parseFrontmatter(markdown: string): ParsedFrontmatter | null | undefined {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  if (lines[0] !== "---") {
    return undefined;
  }
  const closing = lines.indexOf("---", 1);
  if (closing === -1) {
    return null;
  }
  const values = new Map<string, string>();
  for (const line of lines.slice(1, closing)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      continue;
    }
    if (/^\s/.test(line)) {
      continue;
    }
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(?:\s(.*)|\s*)$/.exec(line);
    if (match === null) {
      return null;
    }
    const key = match[1];
    if (key === undefined) {
      return null;
    }
    const value = match[2] ?? "";
    if (key === "okf_version" && !isValidYamlScalar(value)) {
      return null;
    }
    values.set(key, yamlScalarValue(value));
  }
  return { values, body: lines.slice(closing + 1).join("\n") };
}

function isValidYamlScalar(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") {
    return true;
  }
  if (trimmed.startsWith('"')) {
    return (
      trimmed.length >= 2 &&
      trimmed.endsWith('"') &&
      !endsWithUnescapedBackslash(trimmed.slice(0, -1))
    );
  }
  if (trimmed.startsWith("'")) {
    return trimmed.length >= 2 && trimmed.endsWith("'");
  }
  return !/[[\]{}|>]/.test(trimmed);
}

function yamlScalarValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function endsWithUnescapedBackslash(value: string): boolean {
  let count = 0;
  for (let index = value.length - 1; index >= 0 && value[index] === "\\"; index -= 1) {
    count += 1;
  }
  return count % 2 === 1;
}

function isValidType(value: string): boolean {
  return value.trim() !== "" && !/[\r\n[\]{}]/.test(value);
}

function isSafeBundlePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.includes("\0") &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

function isReservedManagedPath(path: string): boolean {
  return path === OKF_MANIFEST_PATH || path.endsWith("/index.md") || path.endsWith("/log.md");
}

function markdownLinks(markdown: string): readonly string[] {
  const links: string[] = [];
  const expression = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of markdown.matchAll(expression)) {
    const link = match[1];
    if (link !== undefined) {
      links.push(link.trim());
    }
  }
  return links;
}

function internalLinkTarget(link: string): string | undefined {
  const destination = link.startsWith("<")
    ? link.slice(1, link.indexOf(">"))
    : link.split(/\s+/, 1)[0];
  if (
    destination === undefined ||
    destination === "" ||
    destination.startsWith("#") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(destination) ||
    destination.startsWith("//")
  ) {
    return undefined;
  }
  return destination.split(/[?#]/, 1)[0] ?? "";
}

function resolveBundlePath(sourcePath: string, target: string): string | undefined {
  if (target.startsWith("/")) {
    return undefined;
  }
  const resolved = sourcePath.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (resolved.length === 0) {
        return undefined;
      }
      resolved.pop();
    } else {
      resolved.push(segment);
    }
  }
  return resolved.join("/");
}

function diagnostic(
  code: OkfConformanceDiagnosticCode,
  severity: OkfConformanceSeverity,
  path: string,
  message: string,
  link?: string,
): OkfConformanceDiagnostic {
  return link === undefined
    ? { code, severity, path, message }
    : { code, severity, path, message, link };
}

function compareFiles(left: OkfBundleFile, right: OkfBundleFile): number {
  return left.path < right.path
    ? -1
    : left.path > right.path
      ? 1
      : left.content < right.content
        ? -1
        : left.content > right.content
          ? 1
          : 0;
}

function compareDiagnostics(
  left: OkfConformanceDiagnostic,
  right: OkfConformanceDiagnostic,
): number {
  return left.path < right.path
    ? -1
    : left.path > right.path
      ? 1
      : left.code < right.code
        ? -1
        : left.code > right.code
          ? 1
          : (left.link ?? "") < (right.link ?? "")
            ? -1
            : (left.link ?? "") > (right.link ?? "")
              ? 1
              : 0;
}
