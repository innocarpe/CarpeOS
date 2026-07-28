import type { LocalCaptureStore, LocalStoreSqlDatabase } from "./store.js";

export type LocalRetrievalDatabase = LocalStoreSqlDatabase;

export function withLocalRetrievalDatabase<T>(
  store: LocalCaptureStore,
  callback: (db: LocalRetrievalDatabase) => T,
): T {
  return store.withRetrievalDatabase(callback);
}
