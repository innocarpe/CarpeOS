import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { addDaySpend, daySpendExceeded, loadDaySpend, utcDayKey } from "../src/spend.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDb(): DatabaseSync {
  const dir = mkdtempSync(join(tmpdir(), "agentic-spend-"));
  dirs.push(dir);
  return new DatabaseSync(join(dir, "agentic.sqlite"));
}

describe("agentic day spend (ADR 0018 D5)", () => {
  it("persists and loads UTC day spend", () => {
    const db = makeDb();
    const now = new Date("2026-08-07T12:00:00Z");
    expect(loadDaySpend(db, utcDayKey(now))).toEqual({
      day_utc: "2026-08-07",
      spend_usd: 0,
      calls: 0,
    });
    addDaySpend(db, { spend_usd: 0.25, calls: 2 }, now);
    addDaySpend(db, { spend_usd: 0.1, calls: 1 }, now);
    expect(loadDaySpend(db, "2026-08-07")).toEqual({
      day_utc: "2026-08-07",
      spend_usd: 0.35,
      calls: 3,
    });
    db.close();
  });

  it("reports exceeded when spend or calls hit caps", () => {
    const db = makeDb();
    const now = new Date("2026-08-07T12:00:00Z");
    addDaySpend(db, { spend_usd: 5.0, calls: 0 }, now);
    expect(daySpendExceeded(db, { spend_cap_usd: 5.0, max_calls: 500 }, now)).toBe(true);
    const db2 = makeDb();
    addDaySpend(db2, { spend_usd: 0.01, calls: 500 }, now);
    expect(daySpendExceeded(db2, { spend_cap_usd: 5.0, max_calls: 500 }, now)).toBe(true);
    // Under product day caps, modest dogfood usage must not trip the gate.
    const db3 = makeDb();
    addDaySpend(db3, { spend_usd: 0.01, calls: 24 }, now);
    expect(daySpendExceeded(db3, { spend_cap_usd: 5.0, max_calls: 500 }, now)).toBe(false);
    db.close();
    db2.close();
    db3.close();
  });
});
