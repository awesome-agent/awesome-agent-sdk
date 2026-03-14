// memory/types.ts
// Memory system — persistent knowledge across conversations

// ─── Memory Entry ───────────────────────────────────────────

export type MemoryType = "user" | "feedback" | "project" | "reference";

export interface MemoryEntry {
  readonly id: string;
  readonly type: MemoryType;
  readonly name: string;
  readonly content: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// ─── Search ─────────────────────────────────────────────────

export interface MemoryFilter {
  readonly types?: readonly MemoryType[];
}

export interface MemorySearchOptions extends MemoryFilter {
  readonly maxResults?: number;
  readonly threshold?: number; // Relevance threshold 0-1
}

export interface MemorySearchResult {
  readonly entry: MemoryEntry;
  readonly relevance: number; // 0-1
}

// ─── Store Interface ────────────────────────────────────────
// Implementation lives outside core (Firestore, file system, in-memory, etc.)

export interface MemoryStore {
  save(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">
  ): Promise<MemoryEntry>;
  search(
    query: string,
    options?: MemorySearchOptions
  ): Promise<readonly MemorySearchResult[]>;
  delete(id: string): Promise<void>;
  getAll(filter?: MemoryFilter): Promise<readonly MemoryEntry[]>;
}
