/**
 * Persistent day spend caps for always-on agentic Flash (ADR 0018 D5).
 */

import type { SqlDatabase } from "./sql.js";

/** Product defaults: allow a full day of 30m batches + manual flush dogfood. */
export const AGENTIC_DAY_SPEND_CAP_USD = 5.0;
/** Each SessionEnd may use 2 Flash calls (triage+extract); ~250 items/day headroom. */
export const AGENTIC_DAY_MAX_CALLS = 500;
/** Single processAgenticOnce run headroom (not the day total). */
export const AGENTIC_RUN_MAX_CALLS = 64;

export type DaySpendRow = {
  day_utc: string;
  spend_usd: number;
  calls: number;
};

export function migrateAgenticSpend(db: SqlDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agentic_day_spend (
      day_utc TEXT PRIMARY KEY,
      spend_usd REAL NOT NULL,
      calls INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export function utcDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function loadDaySpend(db: SqlDatabase, day_utc = utcDayKey()): DaySpendRow {
  migrateAgenticSpend(db);
  const row = db
    .prepare(`SELECT day_utc, spend_usd, calls FROM agentic_day_spend WHERE day_utc = ?`)
    .get(day_utc) as { day_utc: string; spend_usd: number; calls: number } | undefined;
  if (row === undefined) {
    return { day_utc, spend_usd: 0, calls: 0 };
  }
  return {
    day_utc: row.day_utc,
    spend_usd: Number(row.spend_usd),
    calls: Number(row.calls),
  };
}

export function addDaySpend(
  db: SqlDatabase,
  delta: { spend_usd: number; calls: number },
  now = new Date(),
): DaySpendRow {
  migrateAgenticSpend(db);
  const day = utcDayKey(now);
  const prev = loadDaySpend(db, day);
  const next = {
    day_utc: day,
    spend_usd: prev.spend_usd + Math.max(0, delta.spend_usd),
    calls: prev.calls + Math.max(0, Math.floor(delta.calls)),
  };
  db.prepare(
    `
      INSERT INTO agentic_day_spend (day_utc, spend_usd, calls, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(day_utc) DO UPDATE SET
        spend_usd = excluded.spend_usd,
        calls = excluded.calls,
        updated_at = excluded.updated_at
    `,
  ).run(next.day_utc, next.spend_usd, next.calls, now.toISOString());
  return next;
}

export function daySpendExceeded(
  db: SqlDatabase,
  caps: { spend_cap_usd: number; max_calls: number },
  now = new Date(),
): boolean {
  const row = loadDaySpend(db, utcDayKey(now));
  return row.spend_usd >= caps.spend_cap_usd || row.calls >= caps.max_calls;
}
