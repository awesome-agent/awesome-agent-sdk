import { describe, it, expect } from "vitest";
import type {
  MemoryStore,
  MemoryEntry,
  MemorySearchResult,
} from "../../src/memory/types.js";

// In-memory implementation for testing
class InMemoryStore implements MemoryStore {
  private entries = new Map<string, MemoryEntry>();
  private nextId = 1;

  async save(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">
  ): Promise<MemoryEntry> {
    const full: MemoryEntry = {
      ...entry,
      id: `mem_${this.nextId++}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.entries.set(full.id, full);
    return full;
  }

  async search(
    query: string,
    options?: { maxResults?: number; types?: readonly string[] }
  ): Promise<readonly MemorySearchResult[]> {
    const results: MemorySearchResult[] = [];
    for (const entry of this.entries.values()) {
      if (options?.types && !options.types.includes(entry.type)) continue;
      const relevance = entry.content.toLowerCase().includes(query.toLowerCase())
        ? 0.9
        : 0.1;
      results.push({ entry, relevance });
    }
    results.sort((a, b) => b.relevance - a.relevance);
    return results.slice(0, options?.maxResults ?? results.length);
  }

  async delete(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async getAll(
    filter?: { types?: readonly string[] }
  ): Promise<readonly MemoryEntry[]> {
    const all = [...this.entries.values()];
    if (!filter?.types) return all;
    return all.filter((e) => filter.types!.includes(e.type));
  }
}

describe("MemoryStore (InMemoryStore)", () => {
  it("saves and retrieves entries", async () => {
    const store = new InMemoryStore();

    const entry = await store.save({
      type: "user",
      name: "role",
      content: "Senior TypeScript developer",
    });

    expect(entry.id).toBeDefined();
    expect(entry.type).toBe("user");
    expect(entry.content).toBe("Senior TypeScript developer");
    expect(entry.createdAt).toBeGreaterThan(0);

    const all = await store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(entry.id);
  });

  it("searches by query relevance", async () => {
    const store = new InMemoryStore();
    await store.save({ type: "user", name: "role", content: "TypeScript developer" });
    await store.save({ type: "project", name: "goal", content: "Build a Python CLI" });

    const results = await store.search("TypeScript");
    expect(results[0].relevance).toBeGreaterThan(results[1].relevance);
    expect(results[0].entry.content).toContain("TypeScript");
  });

  it("respects maxResults in search", async () => {
    const store = new InMemoryStore();
    await store.save({ type: "user", name: "a", content: "first" });
    await store.save({ type: "user", name: "b", content: "second" });
    await store.save({ type: "user", name: "c", content: "third" });

    const results = await store.search("anything", { maxResults: 2 });
    expect(results).toHaveLength(2);
  });

  it("filters by type in search", async () => {
    const store = new InMemoryStore();
    await store.save({ type: "user", name: "role", content: "developer" });
    await store.save({ type: "feedback", name: "style", content: "be concise" });

    const results = await store.search("", { types: ["feedback"] });
    expect(results.every((r) => r.entry.type === "feedback")).toBe(true);
  });

  it("deletes entries", async () => {
    const store = new InMemoryStore();
    const entry = await store.save({ type: "user", name: "temp", content: "delete me" });

    await store.delete(entry.id);

    const all = await store.getAll();
    expect(all).toHaveLength(0);
  });

  it("filters getAll by type", async () => {
    const store = new InMemoryStore();
    await store.save({ type: "user", name: "a", content: "user info" });
    await store.save({ type: "project", name: "b", content: "project info" });
    await store.save({ type: "reference", name: "c", content: "ref info" });

    const projects = await store.getAll({ types: ["project"] });
    expect(projects).toHaveLength(1);
    expect(projects[0].type).toBe("project");
  });

  it("assigns unique IDs", async () => {
    const store = new InMemoryStore();
    const a = await store.save({ type: "user", name: "a", content: "first" });
    const b = await store.save({ type: "user", name: "b", content: "second" });

    expect(a.id).not.toBe(b.id);
  });
});
