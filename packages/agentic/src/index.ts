/**
 * @carpeos/agentic — Product 6 Agentic Layer (scaffold).
 *
 * ADR 0017: post-capture write-time knowledge formation.
 * Model freeze: deepseek-v4-flash only for real calls.
 * Implementation of jobs/orchestrator lands in V6-P1+.
 */

export * from "./types.js";
export * from "./gate.js";
export * from "./verify.js";

export const AGENTIC_PLANE = {
  schema: "carpeos.agentic.plane/v1",
  policy_version: "agentic_v1",
  model_id: "deepseek-v4-flash",
  capture_llm: false,
  auto_acceptance_decision: false,
} as const;
