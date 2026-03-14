// File system memory store — each entry is a JSON file on disk
// Zero dependencies beyond Node.js built-ins

import { readdir, readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  scoreRelevance,
} from "@awesome-agent/agent-core";
import type {
  MemoryStore,
  MemoryEntry,
  MemoryFilter,
  MemorySearchOptions,
  MemorySearchResult,
} from "@awesome-agent/agent-core";

// ─── Configuration ───────────────────────────────────────────

export interface FileSystemMemoryStoreConfig {
  /** Directory to store memory files. Created automatically if missing. */
  readonly directory: string;
  /** File extension for memory files. Default: ".json" */
  readonly extension?: string;
}

// ─── Constants ───────────────────────────────────────────────

const DEFAULT_EXTENSION = ".json";
const DEFAULT_MAX_RESULTS = 50;
const DEFAULT_THRESHOLD = 0;

// ─── Implementation ─────────────────────────────────────────

export class FileSystemMemoryStore implements MemoryStore {
  private readonly directory: string;
  private readonly extension: string;
  private initialized = false;

  constructor(config: FileSystemMemoryStoreConfig) {
    this.directory = config.directory;
    this.extension = config.extension ?? DEFAULT_EXTENSION;
  }

  async save(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">
  ): Promise<MemoryEntry> {
    await this.ensureDirectory();

    const now = Date.now();
    const full: MemoryEntry = {
      ...entry,
      id: randomUUID().slice(0, 16),
      createdAt: now,
      updatedAt: now,
    };

    await writeFile(this.filePath(full.id), JSON.stringify(full, null, 2), "utf-8");
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

    const results: MemorySearchResult[] = entries
      .map((entry) => ({
        entry,
        relevance: scoreRelevance(entry, lowerQuery),
      }))
      .filter((r) => r.relevance > threshold)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, maxResults);

    return results;
  }

  async delete(id: string): Promise<void> {
    try {
      await unlink(this.filePath(id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      // File already gone — idempotent delete
    }
  }

  async getAll(filter?: MemoryFilter): Promise<readonly MemoryEntry[]> {
    await this.ensureDirectory();

    let files: string[];
    try {
      files = await readdir(this.directory);
    } catch {
      return [];
    }

    const entries: MemoryEntry[] = [];

    for (const file of files) {
      if (!file.endsWith(this.extension)) continue;

      try {
        const raw = await readFile(join(this.directory, file), "utf-8");
        const entry: MemoryEntry = JSON.parse(raw);

        if (filter?.types && !filter.types.includes(entry.type)) continue;
        entries.push(entry);
      } catch {
        // Skip malformed files
        continue;
      }
    }

    return entries;
  }

  // ─── Private Helpers ──────────────────────────────────────

  private filePath(id: string): string {
    return join(this.directory, `${id}${this.extension}`);
  }

  private async ensureDirectory(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await mkdir(this.directory, { recursive: true });
  }
}
