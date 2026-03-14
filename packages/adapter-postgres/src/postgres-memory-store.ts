// PostgreSQL memory store — production-ready, works with any Postgres-compatible DB
// Uses pg (node-postgres) — the most widely used Postgres client for Node.js

import {
  AgentError,
  generateMemoryId,
  searchMemories,
} from "@awesome-agent/agent-core";
import type {
  MemoryStore,
  MemoryEntry,
  MemoryFilter,
  MemorySearchOptions,
  MemorySearchResult,
  MemoryType,
} from "@awesome-agent/agent-core";

// ─── Database Client Interface ───────────────────────────────
// Minimal interface — accepts pg.Pool, pg.Client, or any compatible wrapper

export interface PgClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: T[] }>;
}

// ─── Configuration ───────────────────────────────────────────

export interface PostgresMemoryStoreConfig {
  /** pg.Pool or pg.Client instance */
  readonly client: PgClient;
  /** Table name for memory entries. Default: "memories" */
  readonly tableName?: string;
  /** Schema name. Default: "public" */
  readonly schema?: string;
  /** Auto-create table on first use. Default: true */
  readonly autoMigrate?: boolean;
}

// ─── Constants ───────────────────────────────────────────────

const DEFAULT_TABLE = "memories";
const DEFAULT_SCHEMA = "public";

// ─── Implementation ─────────────────────────────────────────

export class PostgresMemoryStore implements MemoryStore {
  private readonly client: PgClient;
  private readonly table: string;
  private readonly rawTableName: string;
  private readonly autoMigrate: boolean;
  private migrated = false;

  constructor(config: PostgresMemoryStoreConfig) {
    this.client = config.client;
    const schema = config.schema ?? DEFAULT_SCHEMA;
    const table = config.tableName ?? DEFAULT_TABLE;
    this.rawTableName = table;
    this.table = `"${schema}"."${table}"`;
    this.autoMigrate = config.autoMigrate ?? true;
  }

  async save(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">
  ): Promise<MemoryEntry> {
    await this.ensureTable();

    const now = Date.now();
    const id = generateMemoryId();

    try {
      await this.client.query(
        `INSERT INTO ${this.table} (id, type, name, content, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          entry.type,
          entry.name,
          entry.content,
          entry.metadata ? JSON.stringify(entry.metadata) : null,
          now,
          now,
        ]
      );
    } catch (err) {
      throw new AgentError(
        `Failed to save memory entry: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return { ...entry, id, createdAt: now, updatedAt: now };
  }

  async search(
    query: string,
    options?: MemorySearchOptions
  ): Promise<readonly MemorySearchResult[]> {
    const entries = await this.getAll(options);
    return searchMemories(entries, query, options);
  }

  async delete(id: string): Promise<void> {
    await this.ensureTable();

    try {
      await this.client.query(`DELETE FROM ${this.table} WHERE id = $1`, [id]);
    } catch (err) {
      throw new AgentError(
        `Failed to delete memory entry "${id}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async getAll(filter?: MemoryFilter): Promise<readonly MemoryEntry[]> {
    await this.ensureTable();

    let sql = `SELECT id, type, name, content, metadata, created_at, updated_at FROM ${this.table}`;
    const values: unknown[] = [];

    if (filter?.types?.length) {
      sql += ` WHERE type = ANY($1)`;
      values.push(filter.types);
    }

    sql += ` ORDER BY created_at DESC`;

    try {
      const result = await this.client.query(sql, values);
      return result.rows.map((row) => this.fromRow(row));
    } catch (err) {
      throw new AgentError(
        `Failed to query memory entries: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ─── Private Helpers ──────────────────────────────────────

  private fromRow(row: Record<string, unknown>): MemoryEntry {
    let metadata: Record<string, unknown> | undefined;

    if (row.metadata) {
      if (typeof row.metadata === "string") {
        try {
          metadata = JSON.parse(row.metadata);
        } catch {
          // Corrupt JSON in metadata column — fall back to empty object
          metadata = {};
        }
      } else {
        metadata = row.metadata as Record<string, unknown>;
      }
    }

    return {
      id: row.id as string,
      type: row.type as MemoryType,
      name: row.name as string,
      content: row.content as string,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      ...(metadata ? { metadata } : {}),
    };
  }

  private async ensureTable(): Promise<void> {
    if (!this.autoMigrate || this.migrated) return;
    this.migrated = true;

    await this.client.query(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        id VARCHAR(16) PRIMARY KEY,
        type VARCHAR(32) NOT NULL,
        name VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        metadata JSONB,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);

    // Index for type filtering — use configured table name, not the default
    const sanitizedTable = this.rawTableName.replace(/[^a-zA-Z0-9_]/g, "_");
    const indexName = `idx_${sanitizedTable}_type`;
    await this.client.query(`
      CREATE INDEX IF NOT EXISTS ${indexName} ON ${this.table} (type)
    `);
  }
}
