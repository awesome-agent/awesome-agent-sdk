# awesome-agent-sdk

A modular TypeScript SDK for building AI agents that think, use tools, and loop until the job is done.

Built on the standard **agentic loop** pattern (gather context → take action → verify results → repeat). Extensible by design — if you're familiar with tools like [Claude Code](https://docs.anthropic.com/en/docs/claude-code), you'll recognize the architecture. Zero lock-in — bring your own LLM, storage, and tools.

```
                        ┌─────────────────────────────────────────┐
                        │             agentic loop                │
                        │                                         │
Your prompt ──────────► │  Gather ───► Act ───► Verify ──────┐    │ ──────► Done
                        │    ▲                               │    │
                        │    └─────── loop back ◄────────────┘    │
                        │                                         │
                        └─────────────────────────────────────────┘
```

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| [@awesome-agent/agent-core](packages/core) | Agentic loop engine — interfaces, state machine, hooks, tools, skills, memory, MCP | Stable |
| [@awesome-agent/adapter-openai](packages/adapter-openai) | OpenAI-compatible adapter (OpenAI, OpenRouter, Groq, Ollama, Together) | Stable |
| @awesome-agent/adapter-anthropic | Claude API adapter | Coming soon |
| @awesome-agent/adapter-firestore | Firestore memory & chat store | Coming soon |
| [@awesome-agent/adapter-filesystem](packages/adapter-filesystem) | File system memory store (local dev, CLI, debugging) | Stable |

## Quick Start

```bash
npm install @awesome-agent/agent-core @awesome-agent/adapter-openai
```

```typescript
import {
  AgenticLoop,
  DefaultToolRegistry,
  DefaultToolExecutor,
  DefaultHookManager,
  DefaultContextBuilder,
} from "@awesome-agent/agent-core";
import { OpenAIAdapter } from "@awesome-agent/adapter-openai";

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
│  Adapters (@awesome-agent/adapter-*)              │
│  OpenAI, Anthropic, Firestore, FileSystem   │
├─────────────────────────────────────────────┤
│  @awesome-agent/agent-core                        │
│  Loop, Tools, Hooks, Context, Skills,       │
│  Memory, MCP, State Machine                 │
└─────────────────────────────────────────────┘
```

**Core** defines interfaces. **Adapters** implement them. Your app composes both.

## Examples

### 1. Multi-Tool Agent

An agent that can read files and run shell commands, then reasons about the results:

```typescript
import fs from "fs/promises";
import { execSync } from "child_process";
import {
  AgenticLoop, DefaultToolRegistry, DefaultToolExecutor,
  DefaultHookManager, DefaultContextBuilder,
} from "@awesome-agent/agent-core";
import { OpenAIAdapter } from "@awesome-agent/adapter-openai";

const llm = new OpenAIAdapter({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const tools = new DefaultToolRegistry();

tools.register({
  name: "read_file",
  description: "Read a file from disk",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  execute: async (args) => {
    try {
      const content = await fs.readFile(args.path as string, "utf-8");
      return { success: true, content };
    } catch (e) {
      return { success: false, content: `Error: ${e}` };
    }
  },
});

tools.register({
  name: "run_command",
  description: "Run a shell command",
  parameters: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
  execute: async (args) => {
    try {
      const output = execSync(args.command as string, { encoding: "utf-8" });
      return { success: true, content: output };
    } catch (e) {
      return { success: false, content: `Error: ${e}` };
    }
  },
});

const loop = new AgenticLoop({
  llm,
  agent: {
    id: "dev-agent",
    name: "Dev Agent",
    prompt: "You are a developer assistant. Use tools to help the user.",
  },
  tools,
  executor: new DefaultToolExecutor(tools),
  hooks: new DefaultHookManager(),
  context: new DefaultContextBuilder(),
});

const result = await loop.run("Read package.json and tell me the version", "s1");
console.log(result.output);
// "The version in package.json is 0.1.0"
console.log(result.toolCalls);
// [{ name: "read_file", args: { path: "package.json" }, result: "..." }]
```

### 2. Hooks — Block Dangerous Tools

Use hooks to enforce safety rules. This blocks any tool call to `delete_file`:

```typescript
import { DefaultHookManager, HookEvent } from "@awesome-agent/agent-core";

const hooks = new DefaultHookManager();

hooks.register({
  name: "safety-guard",
  event: HookEvent.PreToolUse,
  handler: async (payload) => {
    if (payload.data.toolCall.name === "delete_file") {
      return { action: "block", reason: "File deletion is not allowed" };
    }
    return { action: "continue" };
  },
});

// Pass hooks to AgenticLoop — any delete_file call will be blocked
const loop = new AgenticLoop({ llm, agent, tools, executor, hooks, context });
```

### 3. Retry + Backoff for Production

Wrap any LLM adapter with automatic retry on transient errors:

```typescript
import { RetryLLMAdapter } from "@awesome-agent/agent-core";
import { OpenAIAdapter } from "@awesome-agent/adapter-openai";

const llm = new RetryLLMAdapter(
  new OpenAIAdapter({
    baseURL: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY,
  }),
  {
    maxRetries: 3,
    baseDelay: 1000,      // 1s, 2s, 4s (exponential)
    maxDelay: 30_000,     // Cap at 30s
    onRetry: (attempt, error, delay) => {
      console.log(`Retry ${attempt}: ${error.message} (waiting ${delay}ms)`);
    },
  }
);
```

### 4. Plan Mode — Think Before Acting

Generate a plan first, review it, then execute:

```typescript
// Step 1: Generate plan (no tools executed)
const planLoop = new AgenticLoop({
  llm, agent, tools, executor, hooks, context,
  planMode: true,
});
const planResult = await planLoop.run("Refactor the auth module", "s1");
console.log(planResult.output);
// "Step 1: Read auth.ts\nStep 2: Extract validation logic\nStep 3: ..."
console.log(planResult.finishReason); // "plan_pending"

// Step 2: Approve and execute (tools run this time)
const execLoop = new AgenticLoop({
  llm, agent, tools, executor, hooks, context,
  planMode: true,
  approvedPlan: planResult.output,
});
const execResult = await execLoop.run("Refactor the auth module", "s2");
console.log(execResult.finishReason); // "complete"
```

### 5. Streaming Events

Subscribe to real-time events for SSE/WebSocket integration:

```typescript
const loop = new AgenticLoop({
  llm, agent, tools, executor, hooks, context,
  onEvent: (event) => {
    switch (event.type) {
      case "text:delta":
        process.stdout.write(event.text); // Stream text as it arrives
        break;
      case "tool:start":
        console.log(`Calling ${event.name}...`);
        break;
      case "tool:end":
        console.log(`${event.result.success ? "Done" : "Failed"}`);
        break;
      case "phase:change":
        console.log(`${event.from} → ${event.to}`);
        break;
    }
  },
});
```

### 6. Skill Detection

Automatically inject relevant prompts based on user input:

```typescript
import {
  DefaultSkillRegistry, DefaultSkillDetector,
} from "@awesome-agent/agent-core";

const skills = new DefaultSkillRegistry();
skills.register({
  name: "sql-expert",
  description: "SQL query writing and optimization",
  triggers: [
    { type: "keyword", keyword: "SQL" },
    { type: "keyword", keyword: "query" },
    { type: "pattern", pattern: "SELECT.*FROM" },
  ],
});

const loop = new AgenticLoop({
  llm, agent, tools, executor, hooks, context,
  skills,
  skillDetector: new DefaultSkillDetector(),
  skillLoader: {
    loadPrompt: async (name) => {
      // Load skill-specific instructions
      return `You are an expert in ${name}. Always explain your queries.`;
    },
  },
});

// "sql-expert" skill auto-detected and injected into system prompt
await loop.run("Write a SQL query to find top 10 customers", "s1");
```

### 7. MCP — Connect External Tool Servers

Discover and use tools from Model Context Protocol servers:

```typescript
import { AgenticLoop } from "@awesome-agent/agent-core";
import type { MCPClient } from "@awesome-agent/agent-core";

// Your MCP client implementation
const revitClient: MCPClient = {
  id: "revit",
  name: "Revit BIM Server",
  connect: async () => { /* WebSocket connect */ },
  disconnect: async () => { /* cleanup */ },
  listTools: async () => [
    { name: "execute_script", inputSchema: { type: "object" } },
    { name: "search_api", inputSchema: { type: "object" } },
  ],
  callTool: async (name, args) => {
    // Forward to MCP server
    return { content: [{ type: "text", text: "result" }] };
  },
};

const loop = new AgenticLoop({
  llm, agent, tools, executor, hooks, context,
  mcpClients: [revitClient], // Auto-discovered as revit_execute_script, revit_search_api
});
```

### 8. Adaptive Token Estimation

Token counting that learns from real LLM usage:

```typescript
import { AdaptiveEstimator, DefaultPruner } from "@awesome-agent/agent-core";

const estimator = new AdaptiveEstimator({
  initialCharsPerToken: 4,  // Start with rough estimate
  alpha: 0.3,               // EMA learning rate
});

const pruner = new DefaultPruner(estimator);

const loop = new AgenticLoop({
  llm, agent, tools, executor, hooks, context,
  pruner,
  tokenEstimator: estimator, // Loop auto-calibrates after each LLM call
  maxContextTokens: 128_000,
});

// After a few iterations, estimator.currentRatio converges to real chars/token
```

### 9. Using Everything Together

A production-ready agent combining all features:

```typescript
import {
  AgenticLoop,
  DefaultToolRegistry, DefaultToolExecutor,
  DefaultHookManager, DefaultContextBuilder,
  DefaultSkillRegistry, DefaultSkillDetector,
  RetryLLMAdapter, AdaptiveEstimator, DefaultPruner,
  StreamingCompactor, HookEvent,
} from "@awesome-agent/agent-core";
import { OpenAIAdapter } from "@awesome-agent/adapter-openai";

// LLM with retry
const llm = new RetryLLMAdapter(
  new OpenAIAdapter({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
  }),
  { maxRetries: 3 }
);

// Tools
const tools = new DefaultToolRegistry();
tools.register({ /* your tools */ });

// Skills
const skills = new DefaultSkillRegistry();
skills.register({ /* your skills */ });

// Hooks
const hooks = new DefaultHookManager();
hooks.register({
  name: "cost-tracker",
  event: HookEvent.PostLLMCall,
  handler: async (payload) => {
    const { usage } = payload.data;
    console.log(`Tokens: ${usage.inputTokens} in / ${usage.outputTokens} out`);
    return { action: "continue" };
  },
});

// Context management
const estimator = new AdaptiveEstimator();
const pruner = new DefaultPruner(estimator);
const compactor = new StreamingCompactor(llm, {
  preserveLastN: 6,
  compactThreshold: 10,
});

// Run
const loop = new AgenticLoop({
  llm,
  agent: {
    id: "production-agent",
    name: "Production Agent",
    prompt: "You are a helpful assistant.",
    maxIterations: 20,
  },
  tools,
  executor: new DefaultToolExecutor(tools),
  hooks,
  context: new DefaultContextBuilder(),
  skills,
  skillDetector: new DefaultSkillDetector(),
  skillLoader: { loadPrompt: async (name) => `Expert in ${name}.` },
  pruner,
  compactor,
  tokenEstimator: estimator,
  maxContextTokens: 128_000,
  onEvent: (e) => {
    if (e.type === "text:delta") process.stdout.write(e.text);
  },
});

const result = await loop.run("Help me build a REST API", "session-1");
```

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

Apache License 2.0 — see [LICENSE](LICENSE) for details.
