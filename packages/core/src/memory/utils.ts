// memory/utils.ts
// Shared constants and utilities for memory store adapters

import { randomUUID } from "node:crypto";

// ─── Constants ───────────────────────────────────────────────

const ID_LENGTH = 16;

/** Default maximum results returned by search */
export const DEFAULT_MEMORY_MAX_RESULTS = 50;

/** Default relevance threshold for search (0 = return all scored entries) */
export const DEFAULT_MEMORY_THRESHOLD = 0;

// ─── Helpers ────────────────────────────────────────────────

/** Generate a short random memory ID */
export function generateMemoryId(): string {
  return randomUUID().slice(0, ID_LENGTH);
}
