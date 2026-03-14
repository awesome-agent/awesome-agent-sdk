# @awesome-agent/adapter-firestore

Firestore memory store for [@awesome-agent/agent-core](../core).

Production-ready, multi-user, cloud-native. Supports scoped collections for per-user memory isolation.

## Installation

```bash
npm install @awesome-agent/agent-core @awesome-agent/adapter-firestore firebase-admin
```

## Usage

```typescript
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { FirestoreMemoryStore } from "@awesome-agent/adapter-firestore";

// Initialize Firebase Admin
initializeApp({ credential: cert("./service-account.json") });

const memory = new FirestoreMemoryStore({
  firestore: getFirestore(),
});

// Save a memory
const entry = await memory.save({
  type: "user",
  name: "language-pref",
  content: "User prefers TypeScript over JavaScript",
});

// Search by relevance
const results = await memory.search("TypeScript");

// Get all, filtered by type (uses Firestore native where query)
const feedback = await memory.getAll({ types: ["feedback"] });

// Delete
await memory.delete(entry.id);
```

## Per-User Scoping

Isolate memories per user with `scopePath`:

```typescript
const userMemory = new FirestoreMemoryStore({
  firestore: getFirestore(),
  scopePath: `users/${userId}`,  // → users/{uid}/memories/{entryId}
});
```

Each user gets their own sub-collection — no data leakage between users.

## With AgenticLoop

```typescript
import { AgenticLoop, DefaultToolRegistry, DefaultToolExecutor,
  DefaultHookManager, DefaultContextBuilder } from "@awesome-agent/agent-core";
import { OpenAIAdapter } from "@awesome-agent/adapter-openai";
import { FirestoreMemoryStore } from "@awesome-agent/adapter-firestore";

const memory = new FirestoreMemoryStore({
  firestore: getFirestore(),
  scopePath: `users/${userId}`,
});

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
| `firestore` | `FirestoreInstance` | (required) | Firestore instance from firebase-admin |
| `collectionName` | `string` | `"memories"` | Collection name for entries |
| `scopePath` | `string` | (none) | Prefix path for per-user isolation |

## Firestore Interface

This adapter defines a minimal `FirestoreInstance` interface instead of importing `firebase-admin` types directly. This means:

- Your Firestore instance just needs `collection()` method
- Works with firebase-admin, Firestore emulator, or any compatible mock
- No deep dependency on firebase-admin type system

## License

Apache-2.0
