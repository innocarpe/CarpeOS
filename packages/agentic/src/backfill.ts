/**
 * Historical Evidence → agentic_capture_feed backfill (complete product loop residual).
 * Thin wrapper around LocalCaptureStore.backfillAgenticCaptureFeed.
 * No LLM. Capture path remains fail-open and independent.
 */

import type { AgenticFeedBackfillResult, LocalCaptureStore } from "@carpeos/local-store";

export type AgenticBackfillInput = {
  store: LocalCaptureStore;
  limit?: number;
  hookEventNames?: readonly string[];
};

export function backfillAgenticFeed(input: AgenticBackfillInput): AgenticFeedBackfillResult {
  return input.store.backfillAgenticCaptureFeed({
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.hookEventNames !== undefined ? { hookEventNames: input.hookEventNames } : {}),
  });
}
