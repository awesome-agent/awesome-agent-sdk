// Firestore memory store — production-ready, multi-user, cloud-native
// Requires firebase-admin SDK initialized externally

import type {
  MemoryStore,
  MemoryEntry,
  MemoryFilter,
  MemorySearchOptions,
  MemorySearchResult,
  MemoryType,
} from "@awesome-agent/agent-core";

// ─── Firestore Types (minimal — avoid deep firebase-admin import) ────

/** Minimal Firestore interface — accepts firebase-admin's Firestore instance */
export interface FirestoreInstance {
  collection(path: string): FirestoreCollectionRef;
}

export interface FirestoreCollectionRef {
  doc(id?: string): FirestoreDocRef;
  where(field: string, op: string, value: unknown): FirestoreQuery;
  get(): Promise<FirestoreQuerySnapshot>;
}

export interface FirestoreQuery {
  get(): Promise<FirestoreQuerySnapshot>;
}

export interface FirestoreQuerySnapshot {
  readonly docs: readonly FirestoreDocSnapshot[];
  readonly empty: boolean;
}

export interface FirestoreDocSnapshot {
  readonly id: string;
  readonly exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface FirestoreDocRef {
  set(data: Record<string, unknown>): Promise<unknown>;
  delete(): Promise<unknown>;
}

// ─── Configuration ───────────────────────────────────────────

export interface FirestoreMemoryStoreConfig {
  /** Firestore instance (from firebase-admin) */
  readonly firestore: FirestoreInstance;
  /** Collection name for memory entries. Default: "memories" */
  readonly collectionName?: string;
  /** Scope memories per user/session. Prepended to collection path. */
  readonly scopePath?: string;
}

// ─── Constants ───────────────────────────────────────────────

const DEFAULT_COLLECTION = "memories";
const DEFAULT_MAX_RESULTS = 50;
const DEFAULT_THRESHOLD = 0;

// ─── Implementation ─────────────────────────────────────────

export class FirestoreMemoryStore implements MemoryStore {
  private readonly firestore: FirestoreInstance;
  private readonly collectionPath: string;

  constructor(config: FirestoreMemoryStoreConfig) {
    this.firestore = config.firestore;
    const collection = config.collectionName ?? DEFAULT_COLLECTION;
    this.collectionPath = config.scopePath
      ? `${config.scopePath}/${collection}`
      : collection;
  }

  async save(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">
  ): Promise<MemoryEntry> {
    const now = Date.now();
    const id = this.generateId();

    const full: MemoryEntry = {
      ...entry,
      id,
      createdAt: now,
      updatedAt: now,
    };

    await this.collection().doc(id).set(this.toFirestoreDoc(full));
    return full;
  }

  async search(
    query: string,
    options?: MemorySearchOptions
  ): Promise<readonly MemorySearchResult[]> {
    const entries = await this.getAll(options);
    const maxResults = options?.maxResults ?? DEFAULT_MAX_RESULTS;
    const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
    const lowerQuery = query.toLowerCase();

    return entries
      .map((entry) => ({
        entry,
        relevance: this.scoreRelevance(entry, lowerQuery),
      }))
      .filter((r) => r.relevance > threshold)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, maxResults);
  }

  async delete(id: string): Promise<void> {
    await this.collection().doc(id).delete();
  }

  async getAll(filter?: MemoryFilter): Promise<readonly MemoryEntry[]> {
    let query: FirestoreCollectionRef | FirestoreQuery = this.collection();

    // Firestore native type filter — avoids reading all docs
    if (filter?.types?.length) {
      query = this.collection().where("type", "in", [...filter.types]);
    }

    const snapshot = await query.get();
    if (snapshot.empty) return [];

    const entries: MemoryEntry[] = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (!data) continue;

      const entry = this.fromFirestoreDoc(doc.id, data);
      if (entry) entries.push(entry);
    }

    return entries;
  }

  // ─── Private Helpers ──────────────────────────────────────

  private collection(): FirestoreCollectionRef {
    return this.firestore.collection(this.collectionPath);
  }

  private generateId(): string {
    // 16-char hex — matches filesystem adapter's UUID slice
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  private scoreRelevance(entry: MemoryEntry, lowerQuery: string): number {
    if (!lowerQuery) return 0.5;

    const content = entry.content.toLowerCase();
    const name = entry.name.toLowerCase();

    if (name === lowerQuery) return 1.0;
    if (name.includes(lowerQuery)) return 0.9;

    if (content.includes(lowerQuery)) {
      const density = lowerQuery.length / content.length;
      return Math.min(0.85, 0.5 + density * 5);
    }

    const queryWords = lowerQuery.split(/\s+/);
    const contentWords = new Set(content.split(/\s+/));
    const matchCount = queryWords.filter((w) => contentWords.has(w)).length;

    if (matchCount > 0) {
      return Math.min(0.7, 0.2 + (matchCount / queryWords.length) * 0.5);
    }

    return 0;
  }

  private toFirestoreDoc(entry: MemoryEntry): Record<string, unknown> {
    return {
      type: entry.type,
      name: entry.name,
      content: entry.content,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      ...(entry.metadata ? { metadata: entry.metadata } : {}),
    };
  }

  private fromFirestoreDoc(
    id: string,
    data: Record<string, unknown>
  ): MemoryEntry | null {
    if (!data.type || !data.name || !data.content) return null;

    return {
      id,
      type: data.type as MemoryType,
      name: data.name as string,
      content: data.content as string,
      createdAt: (data.createdAt as number) ?? 0,
      updatedAt: (data.updatedAt as number) ?? 0,
      ...(data.metadata
        ? { metadata: data.metadata as Record<string, unknown> }
        : {}),
    };
  }
}
