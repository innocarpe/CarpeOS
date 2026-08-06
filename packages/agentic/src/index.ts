/**
 * @carpeos/agentic — Product 6 Agentic Layer.
 *
 * ADR 0017: post-capture write-time knowledge formation.
 * Model freeze: deepseek-v4-flash only for real calls.
 * P1a: durable job store + lease state machine + stage digests.
 */

export * from "./admit.js";
export * from "./digest.js";
export * from "./gate.js";
export * from "./jobs.js";
export * from "./pack.js";
export type { SqlDatabase, SqlStatement } from "./sql.js";
export * from "./stages.js";
export * from "./types.js";
export * from "./verify.js";

export const AGENTIC_PLANE = {
  schema: "carpeos.agentic.plane/v1",
  policy_version: "agentic_v1",
  model_id: "deepseek-v4-flash",
  capture_llm: false,
  auto_acceptance_decision: false,
} as const;
