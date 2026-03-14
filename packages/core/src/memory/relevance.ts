// memory/relevance.ts
// Shared relevance scoring for memory search — used by all MemoryStore adapters

import type { MemoryEntry } from "./types.js";

// ─── Scoring Constants ───────────────────────────────────────

const EXACT_NAME_SCORE = 1.0;
const NAME_CONTAINS_SCORE = 0.9;
const MAX_CONTENT_SCORE = 0.85;
const BASE_CONTENT_SCORE = 0.5;
const DENSITY_MULTIPLIER = 5;
const MAX_WORD_OVERLAP_SCORE = 0.7;
const BASE_WORD_OVERLAP_SCORE = 0.2;
const WORD_OVERLAP_FACTOR = 0.5;
const EMPTY_QUERY_SCORE = 0.5;

// ─── Scoring Function ───────────────────────────────────────

/** Score how relevant a memory entry is to a query (0–1) */
export function scoreRelevance(entry: MemoryEntry, lowerQuery: string): number {
  if (!lowerQuery) return EMPTY_QUERY_SCORE;

  const content = entry.content.toLowerCase();
  const name = entry.name.toLowerCase();

  // Exact name match
  if (name === lowerQuery) return EXACT_NAME_SCORE;

  // Name contains query
  if (name.includes(lowerQuery)) return NAME_CONTAINS_SCORE;

  // Content contains query — score by density
  if (content.includes(lowerQuery)) {
    const density = lowerQuery.length / content.length;
    return Math.min(MAX_CONTENT_SCORE, BASE_CONTENT_SCORE + density * DENSITY_MULTIPLIER);
  }

  // Word-level overlap
  const queryWords = lowerQuery.split(/\s+/);
  const contentWords = new Set(content.split(/\s+/));
  const matchCount = queryWords.filter((w) => contentWords.has(w)).length;

  if (matchCount > 0) {
    return Math.min(
      MAX_WORD_OVERLAP_SCORE,
      BASE_WORD_OVERLAP_SCORE + (matchCount / queryWords.length) * WORD_OVERLAP_FACTOR
    );
  }

  return 0;
}
