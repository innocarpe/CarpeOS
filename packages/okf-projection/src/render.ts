import type { OkfConceptFile, OkfFrontmatter, OkfSourceEntry, OkfVerifiedEntry } from "./types.js";
import { assertNoProtectedPlaintext } from "./utils.js";

/**
 * Render a concept to OKF markdown (YAML frontmatter + body).
 * Key order is fixed for golden stability.
 */
export function renderOkfConcept(file: OkfConceptFile): string {
  const markdown = `---\n${renderFrontmatter(file.frontmatter)}---\n\n${file.body.trimEnd()}\n`;
  assertNoProtectedPlaintext(markdown);
  return markdown;
}

export function renderFrontmatter(fm: OkfFrontmatter): string {
  const lines: string[] = [];
  lines.push(`type: ${yamlString(fm.type)}`);
  lines.push(`title: ${yamlString(fm.title)}`);
  if (fm.description !== undefined) {
    lines.push(`description: ${yamlString(fm.description)}`);
  }
  if (fm.tags !== undefined && fm.tags.length > 0) {
    lines.push(`tags: [${fm.tags.map((tag) => yamlString(tag)).join(", ")}]`);
  }
  if (fm.status !== undefined) {
    lines.push(`status: ${yamlString(fm.status)}`);
  }
  if (fm.generated !== undefined) {
    lines.push(
      `generated: { by: ${yamlString(fm.generated.by)}, at: ${yamlString(fm.generated.at)} }`,
    );
  }
  if (fm.verified !== undefined && fm.verified.length > 0) {
    lines.push("verified:");
    for (const entry of fm.verified) {
      lines.push(renderVerifiedLine(entry));
    }
  }
  if (fm.sources !== undefined && fm.sources.length > 0) {
    lines.push("sources:");
    for (const source of fm.sources) {
      lines.push(...renderSourceLines(source));
    }
  }
  lines.push(`carpeos_projection: true`);
  lines.push(`canonical_effect: ${yamlString(fm.canonical_effect)}`);
  lines.push(`carpeos_event_id: ${yamlString(fm.carpeos_event_id)}`);
  lines.push(`carpeos_event_type: ${yamlString(fm.carpeos_event_type)}`);
  lines.push(`carpeos_trust_zone_id: ${yamlString(fm.carpeos_trust_zone_id)}`);
  if (fm.carpeos_claim_id !== undefined) {
    lines.push(`carpeos_claim_id: ${yamlString(fm.carpeos_claim_id)}`);
  }
  if (fm.carpeos_observation_id !== undefined) {
    lines.push(`carpeos_observation_id: ${yamlString(fm.carpeos_observation_id)}`);
  }
  if (fm.carpeos_artifact_id !== undefined) {
    lines.push(`carpeos_artifact_id: ${yamlString(fm.carpeos_artifact_id)}`);
  }
  if (fm.carpeos_decision_id !== undefined) {
    lines.push(`carpeos_decision_id: ${yamlString(fm.carpeos_decision_id)}`);
  }
  if (fm.carpeos_supersession_id !== undefined) {
    lines.push(`carpeos_supersession_id: ${yamlString(fm.carpeos_supersession_id)}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderVerifiedLine(entry: OkfVerifiedEntry): string {
  return `  - { by: ${yamlString(entry.by)}, at: ${yamlString(entry.at)} }`;
}

function renderSourceLines(source: OkfSourceEntry): string[] {
  const lines = [
    `  - id: ${yamlString(source.id)}`,
    `    resource: ${yamlString(source.resource)}`,
  ];
  if (source.title !== undefined) {
    lines.push(`    title: ${yamlString(source.title)}`);
  }
  if (source.author !== undefined) {
    lines.push(`    author: ${yamlString(source.author)}`);
  }
  return lines;
}

/** YAML double-quoted string with minimal escapes. */
export function yamlString(value: string): string {
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");
  return `"${escaped}"`;
}

export function renderRootIndex(input: {
  okfVersion: string;
  concepts: readonly OkfConceptFile[];
}): string {
  const lines = [
    "---",
    `okf_version: ${yamlString(input.okfVersion)}`,
    "---",
    "",
    "# CarpeOS OKF export",
    "",
    "Non-authoritative projection. Editing these files has no canonical effect.",
    "",
  ];

  const byPrefix = new Map<string, OkfConceptFile[]>();
  for (const concept of input.concepts) {
    const prefix = concept.path.includes("/") ? concept.path.split("/")[0]! : "root";
    const list = byPrefix.get(prefix) ?? [];
    list.push(concept);
    byPrefix.set(prefix, list);
  }

  for (const prefix of [...byPrefix.keys()].sort()) {
    lines.push(`# ${prefix}`);
    lines.push("");
    for (const concept of (byPrefix.get(prefix) ?? []).slice().sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    )) {
      const desc = concept.frontmatter.description ?? concept.frontmatter.type;
      lines.push(`* [${concept.frontmatter.title}](${concept.path}) - ${desc}`);
    }
    lines.push("");
  }

  const markdown = `${lines.join("\n").trimEnd()}\n`;
  assertNoProtectedPlaintext(markdown);
  return markdown;
}

export function renderRootLog(input: {
  generatedAt: string;
  conceptCount: number;
  note?: string;
}): string {
  const day = input.generatedAt.slice(0, 10);
  const note = input.note ?? "CarpeOS OKF export projection";
  const markdown = [
    "# Directory Update Log",
    "",
    `## ${day}`,
    `* **Export**: ${note} (${input.conceptCount} concepts).`,
    "",
  ].join("\n");
  assertNoProtectedPlaintext(markdown);
  return markdown;
}
