// memory/relevance.ts
// Shared relevance scoring for memory search — used by all MemoryStore adapters

import type { MemoryEntry } from "./types.js";

/** Score how relevant a memory entry is to a query (0–1) */
export function scoreRelevance(entry: MemoryEntry, lowerQuery: string): number {
  if (!lowerQuery) return 0.5;

  const content = entry.content.toLowerCase();
  const name = entry.name.toLowerCase();

  // Exact name match
  if (name === lowerQuery) return 1.0;

  // Name contains query
  if (name.includes(lowerQuery)) return 0.9;

  // Content contains query — score by density
  if (content.includes(lowerQuery)) {
    const density = lowerQuery.length / content.length;
    return Math.min(0.85, 0.5 + density * 5);
  }

  // Word-level overlap
  const queryWords = lowerQuery.split(/\s+/);
  const contentWords = new Set(content.split(/\s+/));
  const matchCount = queryWords.filter((w) => contentWords.has(w)).length;

  if (matchCount > 0) {
    return Math.min(0.7, 0.2 + (matchCount / queryWords.length) * 0.5);
  }

  return 0;
}
