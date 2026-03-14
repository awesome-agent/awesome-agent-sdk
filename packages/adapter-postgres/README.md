# @awesome-agent/adapter-postgres

PostgreSQL memory store for [@awesome-agent/agent-core](../core).

Production-ready. Uses [pg](https://node-postgres.com/) (node-postgres) — the most widely used Postgres client for Node.js.

## Installation

```bash
npm install @awesome-agent/agent-core @awesome-agent/adapter-postgres pg
```

## Usage

```typescript
import pg from "pg";
import { PostgresMemoryStore } from "@awesome-agent/adapter-postgres";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const memory = new PostgresMemoryStore({
  client: pool,
});

// Save a memory
const entry = await memory.save({
  type: "user",
  name: "language-pref",
  content: "User prefers TypeScript over JavaScript",
});

// Search by relevance
const results = await memory.search("TypeScript");

// Get all, filtered by type (uses SQL WHERE type = ANY(...))
const feedback = await memory.getAll({ types: ["feedback"] });

// Delete
await memory.delete(entry.id);
```

## Auto-Migration

The table is created automatically on first use:

```sql
CREATE TABLE IF NOT EXISTS "public"."memories" (
  id VARCHAR(16) PRIMARY KEY,
  type VARCHAR(32) NOT NULL,
  name VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_type ON "public"."memories" (type);
```

Disable with `autoMigrate: false` if you manage your own schema.

## With AgenticLoop

```typescript
import pg from "pg";
import { AgenticLoop, DefaultToolRegistry, DefaultToolExecutor,
  DefaultHookManager, DefaultContextBuilder } from "@awesome-agent/agent-core";
import { OpenAIAdapter } from "@awesome-agent/adapter-openai";
import { PostgresMemoryStore } from "@awesome-agent/adapter-postgres";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const memory = new PostgresMemoryStore({ client: pool });

const loop = new AgenticLoop({
  llm: new OpenAIAdapter({ baseURL: "...", apiKey: "..." }),
  agent: { id: "my-agent", name: "Agent", prompt: "You are helpful." },
  tools: new DefaultToolRegistry(),
  executor: new DefaultToolExecutor(new DefaultToolRegistry()),
  hooks: new DefaultHookManager(),
  context: new DefaultContextBuilder(),
  memory,
});
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `client` | `PgClient` | (required) | pg.Pool or pg.Client instance |
| `tableName` | `string` | `"memories"` | Table name |
| `schema` | `string` | `"public"` | Schema name |
| `autoMigrate` | `boolean` | `true` | Auto-create table on first use |

## PgClient Interface

This adapter defines a minimal `PgClient` interface (just `query()`). Works with:
- `pg.Pool` (recommended — connection pooling)
- `pg.Client` (single connection)
- Any wrapper with a compatible `query()` method
- Test mocks (no real database needed)

## License

Apache-2.0
