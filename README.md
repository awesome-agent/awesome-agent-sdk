# awesome-agent-sdk

A modular TypeScript SDK for building AI agents that think, use tools, and loop until the job is done.

Inspired by [Claude Code](https://docs.anthropic.com/en/docs/claude-code)'s architecture. Zero lock-in — bring your own LLM, storage, and tools.

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| [@algomim/agent-core](packages/core) | Agentic loop engine — interfaces, state machine, hooks, tools, skills, memory, MCP | Stable |
| [@algomim/adapter-openai](packages/adapter-openai) | OpenAI-compatible adapter (OpenAI, OpenRouter, Groq, Ollama, Together) | Stable |
| @algomim/adapter-anthropic | Claude API adapter | Coming soon |
| @algomim/adapter-firestore | Firestore memory & chat store | Coming soon |
| @algomim/adapter-filesystem | File system memory store (local dev) | Coming soon |

## Quick Start

```bash
npm install @algomim/agent-core @algomim/adapter-openai
```

```typescript
import {
  AgenticLoop,
  DefaultToolRegistry,
  DefaultToolExecutor,
  DefaultHookManager,
  DefaultContextBuilder,
} from "@algomim/agent-core";
import { OpenAIAdapter } from "@algomim/adapter-openai";

// 1. Connect to any OpenAI-compatible provider
const llm = new OpenAIAdapter({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

// 2. Register tools the agent can use
const tools = new DefaultToolRegistry();
tools.register({
  name: "get_weather",
  description: "Get current weather for a city",
  parameters: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
  execute: async (args) => ({
    success: true,
    content: `Weather in ${args.city}: 22°C, sunny`,
  }),
});

// 3. Run the agent
const loop = new AgenticLoop({
  llm,
  agent: { id: "weather-bot", name: "Weather Bot", prompt: "You help with weather." },
  tools,
  executor: new DefaultToolExecutor(tools),
  hooks: new DefaultHookManager(),
  context: new DefaultContextBuilder(),
});

const result = await loop.run("What's the weather in Istanbul?", "session-1");
console.log(result.output);
// "The weather in Istanbul is 22°C and sunny."
```

## Architecture

```
┌─────────────────────────────────────────────┐
│  Your Application                           │
├─────────────────────────────────────────────┤
│  Adapters (@algomim/adapter-*)              │
│  OpenAI, Anthropic, Firestore, FileSystem   │
├─────────────────────────────────────────────┤
│  @algomim/agent-core                        │
│  Loop, Tools, Hooks, Context, Skills,       │
│  Memory, MCP, State Machine                 │
└─────────────────────────────────────────────┘
```

**Core** defines interfaces. **Adapters** implement them. Your app composes both.

## Key Features

- **Agentic Loop** — Gather context, think (LLM), execute tools, verify results, repeat
- **Tool System** — Registry, parallel execution, middleware pipeline
- **Hook System** — Block, modify, or observe any loop event (type-safe)
- **Skill Detection** — Keyword + pattern matching, progressive disclosure
- **Memory** — Interface-only in core, implementations in adapters
- **MCP Bridge** — Connect external tool servers via Model Context Protocol
- **Plan Mode** — Think before acting: generate plan, approve, then execute
- **Token Estimation** — Adaptive learning from real LLM usage (EMA)
- **Context Management** — Pruning + streaming compaction for long conversations
- **Retry/Backoff** — Exponential backoff with jitter for LLM errors
- **Provider Agnostic** — Works with OpenAI, Claude, Groq, Ollama, or any custom LLM

## Development

```bash
# Install all workspace dependencies
npm install

# Build all packages
npm run build -ws

# Test all packages
npm test -ws

# Build/test a specific package
npm run build -w packages/core
npm test -w packages/adapter-openai
```

## License

MIT
