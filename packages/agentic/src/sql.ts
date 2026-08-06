/**
 * Minimal SQLite surface for agentic job store (node:sqlite DatabaseSync compatible).
 * Same contract pattern as packages/retrieval local-index.
 */

export type SqlStatement = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};

export type SqlDatabase = {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
};
