# @awesome-agent/adapter-filesystem

File system memory store for [@awesome-agent/agent-core](../core).

Each memory entry is stored as a JSON file on disk. Zero external dependencies — uses only Node.js built-ins (`fs`, `path`, `crypto`).

Ideal for **local development**, **CLI tools**, and **debugging** — no database setup required.

## Installation

```bash
npm install @awesome-agent/agent-core @awesome-agent/adapter-filesystem
```

## Usage

```typescript
import { FileSystemMemoryStore } from "@awesome-agent/adapter-filesystem";

const memory = new FileSystemMemoryStore({
  directory: "./memories",
});

// Save a memory
const entry = await memory.save({
  type: "user",
  name: "language-pref",
  content: "User prefers TypeScript over JavaScript",
});

// Search by relevance
const results = await memory.search("TypeScript");
// [{ entry: { name: "language-pref", ... }, relevance: 0.85 }]

// Get all, optionally filtered by type
const feedback = await memory.getAll({ types: ["feedback"] });

// Delete
await memory.delete(entry.id);
```

## With AgenticLoop

```typescript
import { AgenticLoop, DefaultToolRegistry, DefaultToolExecutor,
  DefaultHookManager, DefaultContextBuilder } from "@awesome-agent/agent-core";
import { OpenAIAdapter } from "@awesome-agent/adapter-openai";
import { FileSystemMemoryStore } from "@awesome-agent/adapter-filesystem";

const memory = new FileSystemMemoryStore({ directory: "./.agent/memories" });

const loop = new AgenticLoop({
  llm: new OpenAIAdapter({ baseURL: "...", apiKey: "..." }),
  agent: { id: "my-agent", name: "Agent", prompt: "You are helpful." },
  tools: new DefaultToolRegistry(),
  executor: new DefaultToolExecutor(new DefaultToolRegistry()),
  hooks: new DefaultHookManager(),
  context: new DefaultContextBuilder(),
  memory, // Memories persist across sessions
});
```

## File Structure

```
./memories/
├── a1b2c3d4e5f6g7h8.json    # { id, type, name, content, createdAt, updatedAt }
├── i9j0k1l2m3n4o5p6.json
└── ...
```

Each file is human-readable JSON — you can inspect, edit, or commit them to git.

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `directory` | `string` | (required) | Path to store memory files |
| `extension` | `string` | `".json"` | File extension for memory files |

## License

Apache-2.0
