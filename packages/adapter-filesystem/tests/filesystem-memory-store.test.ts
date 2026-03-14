import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFile, readdir } from "node:fs/promises";
import { FileSystemMemoryStore } from "../src/filesystem-memory-store.js";

// ─── Helpers ─────────────────────────────────────────────────

let testDir: string;
let store: FileSystemMemoryStore;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "fs-memory-"));
  store = new FileSystemMemoryStore({ directory: testDir });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ─── Tests ───────────────────────────────────────────────────

describe("FileSystemMemoryStore", () => {
  describe("save", () => {
    it("creates a JSON file with entry data", async () => {
      const entry = await store.save({
        type: "user",
        name: "role",
        content: "Senior TypeScript developer",
      });

      expect(entry.id).toBeDefined();
      expect(entry.createdAt).toBeGreaterThan(0);
      expect(entry.updatedAt).toBe(entry.createdAt);

      // Verify file exists on disk
      const raw = await readFile(join(testDir, `${entry.id}.json`), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.content).toBe("Senior TypeScript developer");
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
        content: "Launch on March 20",
        metadata: { priority: "high" },
      });

      expect(entry.metadata).toEqual({ priority: "high" });
    });

    it("creates directory if it does not exist", async () => {
      const nestedDir = join(testDir, "deep", "nested", "dir");
      const nestedStore = new FileSystemMemoryStore({ directory: nestedDir });

      await nestedStore.save({ type: "user", name: "test", content: "works" });

      const files = await readdir(nestedDir);
      expect(files).toHaveLength(1);
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

    it("returns empty array for empty directory", async () => {
      const all = await store.getAll();
      expect(all).toHaveLength(0);
    });

    it("skips malformed JSON files", async () => {
      await store.save({ type: "user", name: "valid", content: "ok" });
      // Write a broken file manually
      const { writeFile: wf } = await import("node:fs/promises");
      await wf(join(testDir, "broken.json"), "not valid json", "utf-8");

      const all = await store.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe("valid");
    });
  });

  describe("delete", () => {
    it("removes the file from disk", async () => {
      const entry = await store.save({ type: "user", name: "temp", content: "delete me" });

      await store.delete(entry.id);

      const all = await store.getAll();
      expect(all).toHaveLength(0);
    });

    it("is idempotent — no error on missing file", async () => {
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
      // Non-matching entries should have 0 relevance and be filtered out
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

      // Only the relevant one should pass threshold
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

    it("scores word-level overlap", async () => {
      await store.save({ type: "user", name: "dev", content: "frontend React developer" });

      const results = await store.search("React developer");

      expect(results).toHaveLength(1);
      expect(results[0].relevance).toBeGreaterThan(0);
    });
  });

  describe("custom extension", () => {
    it("uses custom file extension", async () => {
      const customStore = new FileSystemMemoryStore({
        directory: testDir,
        extension: ".mem",
      });

      const entry = await customStore.save({ type: "user", name: "test", content: "ok" });

      const files = await readdir(testDir);
      expect(files.some((f) => f.endsWith(".mem"))).toBe(true);

      // Should read back with same extension
      const all = await customStore.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(entry.id);
    });
  });
});
