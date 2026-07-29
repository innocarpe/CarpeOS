import type { OpenLoopItem } from "./open-loops.js";

export type DashboardProjection = {
  schema_version: "v1";
  record_type: "dashboard_projection";
  title: string;
  generated_at: string;
  open_loop_count: number;
  open_loops_by_kind: Record<string, number>;
  markdown: string;
  paths: string[];
  canonical_effect: "none";
};

const CLOSED_CATEGORIES = ["open_loop", "dashboard_index"] as const;

/**
 * Build a deterministic markdown dashboard index for open loops.
 * Path-safe closed categories only; never canonical authority.
 */
export function buildDashboardProjection(input: {
  title: string;
  generatedAt: string;
  openLoops: readonly OpenLoopItem[];
}): DashboardProjection {
  const open_loops_by_kind: Record<string, number> = {};
  for (const loop of input.openLoops) {
    open_loops_by_kind[loop.kind] = (open_loops_by_kind[loop.kind] ?? 0) + 1;
  }

  const lines = [
    "---",
    "canonical_effect: none",
    `category: ${CLOSED_CATEGORIES[1]}`,
    `title: ${JSON.stringify(input.title)}`,
    `generated_at: ${input.generatedAt}`,
    "---",
    "",
    `# ${input.title}`,
    "",
    "Generated non-authoritative CarpeOS dashboard. Editing has no canonical effect.",
    "",
    `Open loops: **${input.openLoops.length}**`,
    "",
    "## By kind",
    "",
  ];

  for (const kind of Object.keys(open_loops_by_kind).sort()) {
    lines.push(`- \`${kind}\`: ${open_loops_by_kind[kind]}`);
  }

  lines.push("", "## Open loops", "");
  if (input.openLoops.length === 0) {
    lines.push("_No open loops._", "");
  } else {
    for (const loop of input.openLoops) {
      lines.push(
        `### ${loop.kind}: ${loop.title}`,
        "",
        `- loop_id: \`${loop.loop_id}\``,
        `- subject: \`${loop.subject_ref}\``,
        `- sources: ${loop.source_event_ids.map((id) => `\`${id}\``).join(", ")}`,
        "",
      );
    }
  }

  const markdown = `${lines.join("\n").trimEnd()}\n`;
  return {
    schema_version: "v1",
    record_type: "dashboard_projection",
    title: input.title,
    generated_at: input.generatedAt,
    open_loop_count: input.openLoops.length,
    open_loops_by_kind,
    markdown,
    paths: [
      "dashboard/index.md",
      ...input.openLoops.map((loop) => `open-loops/${loop.loop_id}.md`),
    ],
    canonical_effect: "none",
  };
}

export function isClosedDashboardCategory(value: string): boolean {
  return (CLOSED_CATEGORIES as readonly string[]).includes(value);
}
