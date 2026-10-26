import { randomUUID } from "node:crypto";
import type { OperationLogEntry } from "@/lib/types";

const MAX_ENTRIES = 500;

// Kept on globalThis so the log survives Next.js module reloads in development.
const store = globalThis as typeof globalThis & { __gitHistoryOperations?: OperationLogEntry[] };

function entries(): OperationLogEntry[] {
  store.__gitHistoryOperations ??= [];
  return store.__gitHistoryOperations;
}

export function recordOperation(entry: Omit<OperationLogEntry, "id" | "at">): OperationLogEntry {
  const record: OperationLogEntry = { id: randomUUID(), at: new Date().toISOString(), ...entry };
  const log = entries();
  log.unshift(record);
  if (log.length > MAX_ENTRIES) log.length = MAX_ENTRIES;
  return record;
}

export function listOperations(repoId: string): OperationLogEntry[] {
  return entries().filter((entry) => entry.repoId === repoId);
}
