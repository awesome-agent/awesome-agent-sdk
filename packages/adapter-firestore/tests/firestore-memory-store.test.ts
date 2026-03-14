import { describe, it, expect, beforeEach } from "vitest";
import { FirestoreMemoryStore } from "../src/firestore-memory-store.js";
import type {
  FirestoreInstance,
  FirestoreCollectionRef,
  FirestoreDocRef,
  FirestoreQuery,
  FirestoreQuerySnapshot,
  FirestoreDocSnapshot,
} from "../src/firestore-memory-store.js";

// ─── In-Memory Firestore Mock ────────────────────────────────

function createMockFirestore(): FirestoreInstance {
  const store = new Map<string, Map<string, Record<string, unknown>>>();

  function getCollection(path: string): Map<string, Record<string, unknown>> {
    if (!store.has(path)) store.set(path, new Map());
    return store.get(path)!;
  }

  return {
    collection(path: string): FirestoreCollectionRef {
      const col = getCollection(path);

      const makeSnapshot = (
        docs: Map<string, Record<string, unknown>>
      ): FirestoreQuerySnapshot => ({
        empty: docs.size === 0,
        docs: [...docs.entries()].map(
          ([id, data]): FirestoreDocSnapshot => ({
            id,
            exists: true,
            data: () => ({ ...data }),
          })
        ),
      });

      return {
        doc(id?: string): FirestoreDocRef {
          const docId = id ?? Math.random().toString(36).slice(2, 10);
          return {
            set: async (data: Record<string, unknown>) => {
              col.set(docId, { ...data });
            },
            delete: async () => {
              col.delete(docId);
            },
          };
        },
        where(field: string, _op: string, value: unknown): FirestoreQuery {
          return {
            get: async () => {
              const values = value as string[];
              const filtered = new Map<string, Record<string, unknown>>();
              for (const [id, data] of col) {
                if (values.includes(data[field] as string)) {
                  filtered.set(id, data);
                }
              }
              return makeSnapshot(filtered);
            },
          };
        },
        get: async () => makeSnapshot(col),
      };
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────

let store: FirestoreMemoryStore;

beforeEach(() => {
  store = new FirestoreMemoryStore({
    firestore: createMockFirestore(),
  });
});

describe("FirestoreMemoryStore", () => {
  describe("save", () => {
    it("saves and returns entry with generated ID and timestamps", async () => {
      const entry = await store.save({
        type: "user",
        name: "role",
        content: "Senior TypeScript developer",
      });

      expect(entry.id).toBeDefined();
      expect(entry.id.length).toBe(16);
      expect(entry.type).toBe("user");
      expect(entry.content).toBe("Senior TypeScript developer");
      expect(entry.createdAt).toBeGreaterThan(0);
      expect(entry.updatedAt).toBe(entry.createdAt);
    });

    it("assigns unique IDs", async () => {
      const a = await store.save({ type: "user", name: "a", content: "first" });
      const b = await store.save({ type: "user", name: "b", content: "second" });

      expect(a.id).not.toBe(b.id);
    });

    it("preserves metadata", async () => {
      const entry = await store.save({
        type: "project",
        name: "deadline",
        content: "Launch March 20",
        metadata: { priority: "high" },
      });

      expect(entry.metadata).toEqual({ priority: "high" });
    });
  });

  describe("getAll", () => {
    it("returns all saved entries", async () => {
      await store.save({ type: "user", name: "a", content: "first" });
      await store.save({ type: "feedback", name: "b", content: "second" });

      const all = await store.getAll();
      expect(all).toHaveLength(2);
    });

    it("filters by type using Firestore where query", async () => {
      await store.save({ type: "user", name: "a", content: "user info" });
      await store.save({ type: "feedback", name: "b", content: "feedback info" });
      await store.save({ type: "project", name: "c", content: "project info" });

      const feedback = await store.getAll({ types: ["feedback"] });
      expect(feedback).toHaveLength(1);
      expect(feedback[0].type).toBe("feedback");
    });

    it("filters by multiple types", async () => {
      await store.save({ type: "user", name: "a", content: "user" });
      await store.save({ type: "feedback", name: "b", content: "feedback" });
      await store.save({ type: "project", name: "c", content: "project" });

      const result = await store.getAll({ types: ["user", "project"] });
      expect(result).toHaveLength(2);
    });

    it("returns empty array when collection is empty", async () => {
      const all = await store.getAll();
      expect(all).toHaveLength(0);
    });
  });

  describe("delete", () => {
    it("removes entry", async () => {
      const entry = await store.save({ type: "user", name: "temp", content: "delete me" });

      await store.delete(entry.id);

      const all = await store.getAll();
      expect(all).toHaveLength(0);
    });

    it("does not throw on missing entry", async () => {
      await expect(store.delete("nonexistent")).resolves.toBeUndefined();
    });
  });

  describe("search", () => {
    it("ranks by content relevance", async () => {
      await store.save({ type: "user", name: "role", content: "TypeScript developer" });
      await store.save({ type: "project", name: "goal", content: "Build a Python CLI" });

      const results = await store.search("TypeScript");

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].entry.content).toContain("TypeScript");
      expect(results.every((r) => r.relevance > 0)).toBe(true);
    });

    it("exact name match scores highest", async () => {
      await store.save({ type: "user", name: "TypeScript", content: "some content" });
      await store.save({ type: "user", name: "other", content: "TypeScript is great" });

      const results = await store.search("TypeScript");

      expect(results[0].entry.name).toBe("TypeScript");
      expect(results[0].relevance).toBe(1.0);
    });

    it("respects maxResults", async () => {
      for (let i = 0; i < 10; i++) {
        await store.save({ type: "user", name: `item-${i}`, content: `content ${i}` });
      }

      const results = await store.search("content", { maxResults: 3 });
      expect(results).toHaveLength(3);
    });

    it("respects threshold", async () => {
      await store.save({ type: "user", name: "relevant", content: "TypeScript developer" });
      await store.save({ type: "user", name: "irrelevant", content: "completely unrelated" });

      const results = await store.search("TypeScript", { threshold: 0.3 });
      expect(results.every((r) => r.relevance > 0.3)).toBe(true);
    });

    it("filters by type during search", async () => {
      await store.save({ type: "user", name: "a", content: "TypeScript user" });
      await store.save({ type: "feedback", name: "b", content: "TypeScript feedback" });

      const results = await store.search("TypeScript", { types: ["feedback"] });

      expect(results).toHaveLength(1);
      expect(results[0].entry.type).toBe("feedback");
    });

    it("returns equal relevance for empty query", async () => {
      await store.save({ type: "user", name: "a", content: "first" });
      await store.save({ type: "user", name: "b", content: "second" });

      const results = await store.search("");

      expect(results).toHaveLength(2);
      expect(results[0].relevance).toBe(results[1].relevance);
    });
  });

  describe("scopePath", () => {
    it("scopes entries to a sub-collection", async () => {
      const firestore = createMockFirestore();

      const user1 = new FirestoreMemoryStore({
        firestore,
        scopePath: "users/user1",
      });
      const user2 = new FirestoreMemoryStore({
        firestore,
        scopePath: "users/user2",
      });

      await user1.save({ type: "user", name: "pref", content: "TypeScript" });
      await user2.save({ type: "user", name: "pref", content: "Python" });

      const user1Entries = await user1.getAll();
      const user2Entries = await user2.getAll();

      expect(user1Entries).toHaveLength(1);
      expect(user1Entries[0].content).toBe("TypeScript");
      expect(user2Entries).toHaveLength(1);
      expect(user2Entries[0].content).toBe("Python");
    });
  });

  describe("custom collection name", () => {
    it("uses custom collection name", async () => {
      const firestore = createMockFirestore();
      const customStore = new FirestoreMemoryStore({
        firestore,
        collectionName: "agent_memories",
      });

      await customStore.save({ type: "user", name: "test", content: "ok" });

      const all = await customStore.getAll();
      expect(all).toHaveLength(1);
    });
  });
});
