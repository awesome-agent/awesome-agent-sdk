// memory/search.ts
// Shared search logic for memory store adapters — avoids duplication across implementations

import type { MemoryEntry, MemorySearchOptions, MemorySearchResult } from "./types.js";
import { scoreRelevance } from "./relevance.js";
import { DEFAULT_MEMORY_MAX_RESULTS, DEFAULT_MEMORY_THRESHOLD } from "./utils.js";

/**
 * Score, filter, sort, and slice memory entries against a text query.
 * Used by both FileSystemMemoryStore and PostgresMemoryStore (and any future adapter).
 */
export function searchMemories(
  entries: readonly MemoryEntry[],
  query: string,
  options?: MemorySearchOptions
): readonly MemorySearchResult[] {
  const maxResults = options?.maxResults ?? DEFAULT_MEMORY_MAX_RESULTS;
  const threshold = options?.threshold ?? DEFAULT_MEMORY_THRESHOLD;
  const lowerQuery = query.toLowerCase();

  return entries
    .map((entry) => ({
      entry,
      relevance: scoreRelevance(entry, lowerQuery),
    }))
    .filter((r) => r.relevance > threshold)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, maxResults);
}
