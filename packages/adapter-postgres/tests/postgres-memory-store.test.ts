import { describe, it, expect, beforeEach } from "vitest";
import { PostgresMemoryStore } from "../src/postgres-memory-store.js";
import type { PgClient } from "../src/postgres-memory-store.js";

// ─── In-Memory Postgres Mock ─────────────────────────────────

function createMockPgClient(): PgClient {
  const tables = new Map<string, Record<string, unknown>[]>();

  return {
    query: async (text: string, values?: unknown[]) => {
      const sql = text.trim();

      // CREATE TABLE / CREATE INDEX — no-op
      if (sql.startsWith("CREATE")) {
        return { rows: [] };
      }

      // INSERT
      if (sql.startsWith("INSERT")) {
        const v = values ?? [];
        const tableName = "default";
        if (!tables.has(tableName)) tables.set(tableName, []);
        tables.get(tableName)!.push({
          id: v[0],
          type: v[1],
          name: v[2],
          content: v[3],
          metadata: v[4],
          created_at: v[5],
          updated_at: v[6],
        });
        return { rows: [] };
      }

      // DELETE
      if (sql.startsWith("DELETE")) {
        const id = values?.[0] as string;
        const rows = tables.get("default") ?? [];
        const filtered = rows.filter((r) => r.id !== id);
        tables.set("default", filtered);
        return { rows: [] };
      }

      // SELECT
      if (sql.startsWith("SELECT")) {
        let rows = [...(tables.get("default") ?? [])];

        // WHERE type = ANY($1)
        if (sql.includes("ANY") && values?.[0]) {
          const types = values[0] as string[];
          rows = rows.filter((r) => types.includes(r.type as string));
        }

        // ORDER BY created_at DESC
        rows.sort(
          (a, b) => (b.created_at as number) - (a.created_at as number)
        );

        return { rows };
      }

      return { rows: [] };
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────

let store: PostgresMemoryStore;

beforeEach(() => {
  store = new PostgresMemoryStore({
    client: createMockPgClient(),
  });
});

describe("PostgresMemoryStore", () => {
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

    it("filters by type", async () => {
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

    it("returns empty array when table is empty", async () => {
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

  describe("auto-migrate", () => {
    it("creates table automatically on first operation", async () => {
      const queries: string[] = [];
      const mockClient: PgClient = {
        query: async (text: string, values?: unknown[]) => {
          queries.push(text.trim().split("\n")[0]);
          return createMockPgClient().query(text, values);
        },
      };

      const autoStore = new PostgresMemoryStore({ client: mockClient });
      await autoStore.save({ type: "user", name: "test", content: "ok" });

      expect(queries.some((q) => q.startsWith("CREATE TABLE"))).toBe(true);
      expect(queries.some((q) => q.startsWith("CREATE INDEX"))).toBe(true);
    });

    it("skips migration when autoMigrate is false", async () => {
      const queries: string[] = [];
      const mockClient: PgClient = {
        query: async (text: string) => {
          queries.push(text.trim().split("\n")[0]);
          return { rows: [] };
        },
      };

      const noMigrateStore = new PostgresMemoryStore({
        client: mockClient,
        autoMigrate: false,
      });
      await noMigrateStore.getAll();

      expect(queries.every((q) => !q.startsWith("CREATE"))).toBe(true);
    });
  });
});
