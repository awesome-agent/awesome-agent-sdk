# agent-core

A TypeScript library for building AI agents that can think, use tools, and loop until the job is done.

Zero runtime dependencies. Provider-agnostic — bring your own LLM adapter.

Part of the [awesome-agent-sdk](https://github.com/algomim/awesome-agent-sdk) monorepo.

Built on the standard agentic loop pattern — if you're familiar with tools like [Claude Code](https://docs.anthropic.com/en/docs/claude-code), you'll recognize the architecture.

## What Does It Do?

Think of ChatGPT or Claude — you send a message, you get a response. But what if the AI needs to **do things** in between? Read a file, run a command, call an API, then keep going based on the result?

That's what agent-core does. It runs a **loop**:

```
You say something
    ↓
Agent thinks (calls the LLM)
    ↓
LLM says "I need to read a file" → Agent reads the file → feeds result back to LLM
    ↓
LLM says "Now I need to run a command" → Agent runs it → feeds result back
    ↓
LLM says "Done, here's your answer"
    ↓
You get the final response
```

Each cycle is called an **iteration**. The agent keeps looping until the LLM decides it's done, hits a limit, or gets cancelled.

## Installation

```bash
npm install @algomim/agent-core
```

You'll also need an LLM adapter:

```bash
npm install @algomim/adapter-openai    # OpenAI, OpenRouter, Groq, Ollama
# or
npm install @algomim/adapter-anthropic  # Claude (coming soon)
```

You can import individual modules for tree-shaking:

```typescript
import { AgenticLoop } from "@algomim/agent-core/loop";
import { DefaultToolRegistry } from "@algomim/agent-core/tool";
```

## Quick Start

Here's the simplest possible agent — it connects to an LLM and can read files:

```typescript
import fs from "fs/promises";
import {
  AgenticLoop,
  DefaultToolRegistry,
  DefaultToolExecutor,
  DefaultHookManager,
  DefaultContextBuilder,
} from "@algomim/agent-core";
import { OpenAIAdapter } from "@algomim/adapter-openai";

// Step 1: Set up the LLM connection
// This works with OpenAI, but also Groq, Ollama, OpenRouter — anything
// that speaks the OpenAI chat completions protocol.
const llm = new OpenAIAdapter({
  baseURL: "https://api.openai.com/v1",
  apiKey: process.env.OPENAI_API_KEY,
});

// Step 2: Define tools the agent can use
// Tools are functions the LLM can call. You define what they do,
// the LLM decides when to call them.
const tools = new DefaultToolRegistry();

tools.register({
  name: "read_file",
  description: "Read a file from disk",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to read" },
    },
    required: ["path"],
  },
  execute: async (args) => {
    const content = await fs.readFile(args.path as string, "utf-8");
    return { success: true, content };
  },
});

// Step 3: Wire everything together and run
const loop = new AgenticLoop({
  llm,
  agent: {
    id: "my-agent",
    name: "My Agent",
    prompt: "You are a helpful assistant. Use tools when needed.",
  },
  tools,
  executor: new DefaultToolExecutor(tools),
  hooks: new DefaultHookManager(),
  context: new DefaultContextBuilder(),
});

const result = await loop.run("What's in package.json?", "session-1");
console.log(result.output);
// "The package.json contains a project called agent-core at version 0.1.0..."
```

**What happens under the hood:**
1. Your message goes to the LLM
2. LLM responds: "I'll read that file" + calls `read_file({ path: "package.json" })`
3. agent-core runs the tool, sends the file content back to the LLM
4. LLM reads the content and generates a human-friendly summary
5. Loop ends, you get `result.output`

## Examples

### 1. Coding Assistant (Read + Write + Shell)

An agent that can read files, write code, and run commands — like a mini Claude Code:

```typescript
import fs from "fs/promises";
import { execSync } from "child_process";

const tools = new DefaultToolRegistry();

// Tool 1: Read files
tools.register({
  name: "read_file",
  description: "Read a file's contents",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  execute: async (args) => {
    const content = await fs.readFile(args.path as string, "utf-8");
    return { success: true, content };
  },
});

// Tool 2: Write files
tools.register({
  name: "write_file",
  description: "Create or overwrite a file",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
  execute: async (args) => {
    await fs.writeFile(args.path as string, args.content as string);
    return { success: true, content: `Wrote ${args.path}` };
  },
});

// Tool 3: Run shell commands
tools.register({
  name: "run_command",
  description: "Run a shell command and return its output",
  parameters: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
  execute: async (args) => {
    try {
      const output = execSync(args.command as string, {
        encoding: "utf-8",
        timeout: 10_000,
      });
      return { success: true, content: output };
    } catch (err) {
      return { success: false, content: (err as Error).message };
    }
  },
});

// Create the agent
const loop = new AgenticLoop({
  llm,
  agent: {
    id: "coder",
    name: "Coding Assistant",
    prompt: "You are a coding assistant. Read files, write code, run commands.",
    maxIterations: 20, // Allow up to 20 think-execute cycles
  },
  tools,
  executor: new DefaultToolExecutor(tools),
  hooks: new DefaultHookManager(),
  context: new DefaultContextBuilder(),
});

// Ask it to do a multi-step task
const result = await loop.run(
  "Add a lint script to package.json using eslint, then install eslint",
  "session-1"
);

console.log(result.output);       // Agent's final message
console.log(result.iterations);   // e.g. 4 (read → write → run install → respond)
console.log(result.toolCalls);    // Full log of every tool call
```

The agent will:
1. Read package.json to see current scripts
2. Write an updated package.json with the lint script
3. Run `npm install eslint`
4. Report back what it did

### 2. Streaming to a UI

When building a chat interface, you want to show progress in real-time — not wait for the entire loop to finish. The `onEvent` callback fires on every meaningful event:

```typescript
const loop = new AgenticLoop({
  llm,
  agent: { id: "chat", name: "Chat", prompt: "You are helpful." },
  tools,
  executor: new DefaultToolExecutor(tools),
  hooks: new DefaultHookManager(),
  context: new DefaultContextBuilder(),

  // This callback fires throughout the loop
  onEvent: (event) => {
    switch (event.type) {
      // Text arrives token by token — stream it to the user
      case "text:delta":
        process.stdout.write(event.text);
        break;

      // Agent is about to use a tool
      case "tool:start":
        console.log(`\nUsing tool: ${event.name}`);
        console.log(`  Args: ${JSON.stringify(event.args)}`);
        break;

      // Tool finished
      case "tool:end":
        if (event.result.success) {
          console.log(`  Result: ${event.result.content.slice(0, 200)}`);
        } else {
          console.log(`  Error: ${event.result.content}`);
        }
        break;

      // Loop phase changed (thinking → executing → verifying)
      case "phase:change":
        console.log(`\n[${event.from} → ${event.to}]`);
        break;

      // One iteration complete — shows token usage
      case "iteration:end":
        console.log(`\n--- Iteration ${event.iteration} ---`);
        console.log(`  Tokens: ${event.usage.input} in / ${event.usage.output} out`);
        break;

      // Something went wrong
      case "error":
        console.error(`Error: ${event.error}`);
        break;
    }
  },
});

await loop.run("Explain the project structure", "session-1");
```

**Example output:**
```
[idle → gathering]
[gathering → thinking]
I'll read the project files to understand the structure.
[thinking → executing]
Using tool: read_file
  Args: {"path":"package.json"}
  Result: {"name":"agent-core","version":"0.1.0"...
[executing → verifying]
[verifying → thinking]
This is a TypeScript project with 8 modules...
--- Iteration 2 ---
  Tokens: 3200 in / 450 out
```

### 3. Safety Guardrails with Hooks

Hooks let you intercept the loop at key points. You can **block** actions, **modify** data, or just **observe**. Three hook actions:

- `"continue"` — do nothing, let it proceed
- `"block"` — stop this action with a reason
- `"modify"` — change the data before it proceeds

```typescript
import { DefaultHookManager, HookEvent } from "@algomim/agent-core";

const hooks = new DefaultHookManager();

// HOOK 1: Block dangerous commands
// Runs BEFORE every tool call. If the tool is "run_command" and the
// command looks destructive, block it.
hooks.register({
  name: "safety-guard",
  event: HookEvent.PreToolUse,
  priority: 1,  // Lower number = runs first
  handler: async (payload) => {
    const { toolCall } = payload.data;

    if (toolCall.name === "run_command") {
      const cmd = toolCall.args.command as string;
      const dangerous = /rm\s+-rf|drop\s+table|format\s+/i;
      if (dangerous.test(cmd)) {
        return {
          action: "block",
          reason: `Blocked dangerous command: ${cmd}`,
        };
      }
    }

    if (toolCall.name === "write_file") {
      const path = toolCall.args.path as string;
      if (path.includes(".env") || path.includes("credentials")) {
        return {
          action: "block",
          reason: "Cannot write to sensitive files",
        };
      }
    }

    return { action: "continue" };
  },
});

// HOOK 2: Inject extra rules into every LLM call
// Runs BEFORE each LLM request. Appends safety rules to the system prompt.
hooks.register({
  name: "inject-rules",
  event: HookEvent.PreLLMCall,
  handler: async (payload) => {
    const request = payload.data.request;
    return {
      action: "modify",
      data: {
        request: {
          ...request,
          systemPrompt:
            request.systemPrompt +
            "\n\nRULES:\n- Never delete files\n- Always explain before writing\n- Ask before bulk operations",
        },
      },
    };
  },
});

// HOOK 3: Log token usage after every LLM call
// Runs AFTER each LLM response. Just observes — doesn't change anything.
hooks.register({
  name: "usage-logger",
  event: HookEvent.PostLLMCall,
  handler: async (payload) => {
    const { usage, finishReason } = payload.data;
    console.log(`[LLM] ${usage.inputTokens} in, ${usage.outputTokens} out (${finishReason})`);
    return { action: "continue" };
  },
});

// Use these hooks in your loop
const loop = new AgenticLoop({
  llm,
  agent: { id: "safe-agent", name: "Safe Agent", prompt: "You are helpful." },
  tools,
  executor: new DefaultToolExecutor(tools),
  hooks,  // <-- pass your hooks here
  context: new DefaultContextBuilder(),
});
```

**Available hook events:**

| Event | When | Can block? | Can modify? |
|-------|------|-----------|-------------|
| `PreLLMCall` | Before each LLM request | Yes | Yes (modify request) |
| `PostLLMCall` | After each LLM response | No | No |
| `PreToolUse` | Before each tool execution | Yes | Yes (modify args) |
| `PostToolUse` | After each tool execution | No | No |
| `Stop` | When agent wants to finish | Yes (force continue) | No |
| `SessionStart` | Loop begins | No | No |
| `SessionEnd` | Loop ends | No | No |
| `Error` | On error | No | No |

### 4. Cancel a Running Agent

Pass an `AbortSignal` to stop the agent at any time:

```typescript
const controller = new AbortController();

// Option A: Cancel after 30 seconds
setTimeout(() => controller.abort(), 30_000);

// Option B: Cancel on Ctrl+C
process.on("SIGINT", () => controller.abort());

const result = await loop.run(
  "Analyze every file in this project",
  "session-1",
  controller.signal  // <-- third argument
);

// Check if it was cancelled
if (result.finishReason === "cancelled") {
  console.log("Agent was stopped early.");
  console.log("It completed", result.iterations, "iterations before cancellation.");
  console.log("Partial output:", result.output);
}
```

### 5. Tool Middleware

Middleware wraps **every** tool call with before/after logic. Unlike hooks (which are event-driven), middleware is a chain that processes each call sequentially.

Use cases: logging, timing, caching, arg sanitization, rate limiting.

```typescript
import { MiddlewarePipeline, DefaultToolExecutor } from "@algomim/agent-core";

const pipeline = new MiddlewarePipeline();

// Middleware 1: Time every tool call
pipeline.add({
  name: "timer",
  before: async (ctx) => {
    console.log(`[${ctx.toolCall.name}] Starting...`);
    // Store start time for the after phase
    (ctx as any)._start = Date.now();
    return { action: "continue" };
  },
  after: async (ctx) => {
    const ms = Date.now() - (ctx as any)._start;
    console.log(`[${ctx.toolCall.name}] Done in ${ms}ms`);
    return ctx.result;
  },
});

// Middleware 2: Redact sensitive args before execution
pipeline.add({
  name: "redact-secrets",
  before: async (ctx) => {
    const cleaned = { ...ctx.toolCall.args };
    for (const key of Object.keys(cleaned)) {
      if (/password|secret|token/i.test(key)) {
        cleaned[key] = "***";
      }
    }
    return { action: "modify", args: cleaned };
  },
});

// Pass the pipeline to the executor
const executor = new DefaultToolExecutor(tools, pipeline);
```

### 6. Skills — Load Knowledge on Demand

Without skills, every LLM call includes the same system prompt — even if the user asks about something the prompt doesn't cover. With skills, **specialized knowledge loads only when relevant**.

```typescript
import { DefaultSkillRegistry, DefaultSkillDetector } from "@algomim/agent-core";

const skills = new DefaultSkillRegistry();

// Each skill has triggers — keywords or regex patterns
skills.register({
  name: "database",
  description: "SQL queries, migrations, schema design",
  triggers: [
    { type: "keyword", keyword: "SQL" },
    { type: "keyword", keyword: "database" },
    { type: "pattern", pattern: /\b(SELECT|INSERT|CREATE TABLE|migration)\b/i },
  ],
});

skills.register({
  name: "docker",
  description: "Containers, Dockerfiles, compose, deployment",
  triggers: [
    { type: "keyword", keyword: "docker" },
    { type: "keyword", keyword: "container" },
    { type: "pattern", pattern: /\b(Dockerfile|docker-compose)\b/i },
  ],
});

const loop = new AgenticLoop({
  llm,
  agent: {
    id: "devops",
    name: "DevOps Agent",
    prompt: "You help with infrastructure and deployment.",
  },
  tools,
  executor: new DefaultToolExecutor(tools),
  hooks: new DefaultHookManager(),
  context: new DefaultContextBuilder(),

  // Enable the skill system
  skills,
  skillDetector: new DefaultSkillDetector(),
  skillLoader: {
    loadPrompt: async (name) => {
      // In practice, load from files or a database
      const prompts: Record<string, string> = {
        database:
          "You are an expert DBA.\n" +
          "- Always use parameterized queries to prevent SQL injection\n" +
          "- Prefer migrations over raw DDL statements\n" +
          "- Include rollback steps in every migration",
        docker:
          "You are a Docker expert.\n" +
          "- Use multi-stage builds to minimize image size\n" +
          "- Never run containers as root\n" +
          "- Pin image versions, don't use :latest in production",
      };
      return prompts[name] ?? "";
    },
  },
});

// When the user says: "Write a SQL migration for a users table"
//
// 1. Detector sees "SQL" and "migration" → matches "database" skill
// 2. Loader fetches the full database prompt
// 3. Context builder adds it to the system prompt for this call
// 4. LLM gets DBA expertise — writes proper migrations with rollbacks
//
// If the user then says: "Deploy it with Docker"
// → "database" skill unloads, "docker" skill loads instead
```

### 7. Long Conversations — Manage Context Size

LLMs have a context window (e.g., 128K tokens). Long conversations can exceed it. agent-core provides two strategies:

**Strategy A: Pruning** — Drop the oldest messages to stay under the limit. Fast but lossy.

```typescript
import { DefaultPruner } from "@algomim/agent-core";

const loop = new AgenticLoop({
  // ...other config...
  pruner: new DefaultPruner(),
  maxContextTokens: 128_000,
});

// Conversation with 200 messages? The pruner drops the oldest ones
// to stay under 128K tokens. System prompt and recent messages are preserved.
```

**Strategy B: Compaction** — Use the LLM to summarize old messages. Slower but preserves knowledge.

```typescript
import { LLMCompactor } from "@algomim/agent-core";

const loop = new AgenticLoop({
  // ...other config...
  compactor: new LLMCompactor(llm, {
    preserveLastN: 6,        // Always keep the last 6 messages untouched
    maxSummaryTokens: 1024,  // Budget for the summary
    model: "gpt-4o-mini",    // Use a cheap model for summarization
  }),
});

// Before compaction:
//   [msg1, msg2, msg3, msg4, msg5, msg6, msg7, msg8, msg9, msg10]
//
// After compaction (preserveLastN = 6):
//   [summary of msg1-msg4, msg5, msg6, msg7, msg8, msg9, msg10]
//
// The summary captures key decisions, tool results, and context
// from the old messages — so the agent doesn't lose track.
```

### 8. Understanding the Result

Every `loop.run()` returns a `LoopResult` with everything you need to know:

```typescript
const result = await loop.run("Fix the TypeScript errors", "session-1");

// --- Status ---
result.success;       // true if finishReason is "complete"
result.finishReason;  // "complete" | "max_iterations" | "blocked" | "error" | "cancelled"

// --- Output ---
result.output;        // The agent's final text response

// --- Diagnostics ---
result.iterations;    // How many think-execute cycles ran (e.g., 3)
result.totalTokens;   // { input: 45200, output: 3100 }

// --- Tool Call History ---
// Every tool the agent called, in order, with results:
result.toolCalls;
// [
//   { name: "read_file",    args: { path: "src/index.ts" },  result: "import ..." },
//   { name: "write_file",   args: { path: "src/index.ts", content: "..." },  result: "Wrote src/index.ts" },
//   { name: "run_command",  args: { command: "npx tsc --noEmit" },  result: "" },
// ]

// --- React to different outcomes ---
switch (result.finishReason) {
  case "complete":
    console.log("Done:", result.output);
    break;
  case "max_iterations":
    console.log("Agent ran out of steps. Partial result:", result.output);
    break;
  case "blocked":
    console.log("A hook blocked the agent.");
    break;
  case "cancelled":
    console.log("Agent was cancelled by AbortSignal.");
    break;
  case "error":
    console.log("Something went wrong.");
    break;
}
```

### 9. Processing Large Files (PDFs, Codebases, Logs)

A single LLM call can't process a 500-page PDF or a 10,000-line log file — it won't fit in the context window. But that's exactly what the agentic loop is designed for: **the agent breaks the task into chunks automatically**.

You provide the tools, the agent decides the strategy:

```typescript
import { readFile } from "fs/promises";

const tools = new DefaultToolRegistry();

// Tool: Read a specific page range from a PDF
// In practice, use a library like pdf-parse, pdfjs-dist, or an external API.
tools.register({
  name: "read_pdf",
  description: "Read specific pages from a PDF file. Returns the text content.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the PDF file" },
      startPage: { type: "number", description: "First page to read (1-based)" },
      endPage: { type: "number", description: "Last page to read (1-based)" },
    },
    required: ["path", "startPage", "endPage"],
  },
  execute: async (args) => {
    // Your PDF parsing logic here — returns text for the given page range.
    // The key: this tool reads a SLICE, not the whole file.
    const text = await extractPdfPages(
      args.path as string,
      args.startPage as number,
      args.endPage as number,
    );
    return { success: true, content: text };
  },
});

// Tool: Get PDF metadata (page count, title, table of contents)
tools.register({
  name: "pdf_info",
  description: "Get metadata about a PDF: total pages, title, and table of contents if available.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the PDF file" },
    },
    required: ["path"],
  },
  execute: async (args) => {
    const info = await getPdfMetadata(args.path as string);
    return { success: true, content: JSON.stringify(info) };
  },
});

// Tool: Write notes to a file (agent uses this to save intermediate results)
tools.register({
  name: "write_file",
  description: "Write text content to a file",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
  execute: async (args) => {
    await writeFile(args.path as string, args.content as string);
    return { success: true, content: `Wrote ${args.path}` };
  },
});

// Tool: Read a text file back
tools.register({
  name: "read_file",
  description: "Read a text file's contents",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  execute: async (args) => {
    const content = await readFile(args.path as string, "utf-8");
    return { success: true, content };
  },
});

const loop = new AgenticLoop({
  llm,
  agent: {
    id: "doc-analyst",
    name: "Document Analyst",
    prompt:
      "You analyze documents. When given a large file, first check its structure " +
      "(page count, table of contents), then read it in chunks. Save notes for " +
      "each section to files, then combine them into a final summary.",
    maxIterations: 30, // Large documents need more iterations
  },
  tools,
  executor: new DefaultToolExecutor(tools),
  hooks: new DefaultHookManager(),
  context: new DefaultContextBuilder(),
  pruner: new DefaultPruner(),
  maxContextTokens: 128_000,
});

const result = await loop.run(
  "Summarize the key findings from report.pdf",
  "session-1",
);
```

**What the agent does (you don't code this — the LLM decides):**

```
Iteration 1: "Let me check what I'm working with"
  → pdf_info({ path: "report.pdf" })
  ← { pages: 487, title: "Annual Report 2025", toc: ["Introduction", "Q1 Results", ...] }

Iteration 2: "487 pages. I'll read the introduction first"
  → read_pdf({ path: "report.pdf", startPage: 1, endPage: 15 })
  ← "Executive Summary: Revenue grew 23%..."

Iteration 3: "Let me save these notes and continue"
  → write_file({ path: "notes_intro.md", content: "# Introduction\n- Revenue grew 23%..." })
  → read_pdf({ path: "report.pdf", startPage: 16, endPage: 80 })
  ← "Q1 Results: The first quarter saw..."

Iteration 4-10: reads remaining sections, saves notes for each

Iteration 11: "I've read everything. Let me compile the summary"
  → read_file({ path: "notes_intro.md" })
  → read_file({ path: "notes_q1.md" })
  → read_file({ path: "notes_q2.md" })
  → ...
  ← Final summary combining all notes
```

**Why this works even with context limits:** The agent writes intermediate notes to files. When the context fills up (after reading hundreds of pages), the pruner drops old messages — but the notes are safe on disk. The agent reads them back when it's time to compile the final summary. This is the same pattern Claude Code uses when analyzing large codebases.

**The same approach works for any large input:**

- **Codebase analysis** — `list_files` to discover structure, `read_file` per file, `write_file` for notes
- **Log analysis** — `read_log({ start: 0, lines: 500 })` in chunks, filter as you go
- **Database exploration** — `run_query("SELECT COUNT(*) FROM ...")` first, then targeted queries
- **API crawling** — `fetch_page({ url, page: 1 })`, paginate through results

The pattern is always the same: **explore → chunk → process → save → combine**. You provide the tools, the agent figures out the strategy.

### 10. Subagents — Agents That Spawn Other Agents

Sometimes a single agent isn't enough. A complex task might require **multiple specialists** working in parallel, each with their own context and tools. That's what subagents do.

The parent agent delegates subtasks to child agents. Each child runs its own `AgenticLoop` with isolated context — they don't pollute the parent's conversation history, and they can run in parallel.

```typescript
import {
  AgenticLoop,
  DefaultToolRegistry, DefaultToolExecutor,
  DefaultHookManager, DefaultContextBuilder,
  DefaultSubagentRunner,
} from "@algomim/agent-core";
import type { SubagentConfig } from "@algomim/agent-core";
import { OpenAIAdapter } from "@algomim/adapter-openai";

const llm = new OpenAIAdapter({
  baseURL: "https://api.openai.com/v1",
  apiKey: process.env.OPENAI_API_KEY,
});

// A factory function that creates a loop for any subagent.
// Each subagent gets its own tools, hooks, and context — fully isolated.
function createSubagentLoop(config: SubagentConfig) {
  const tools = new DefaultToolRegistry();

  // Give each subagent the tools it needs based on its role
  tools.register({
    name: "read_file",
    description: "Read a file",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    execute: async (args) => {
      const content = await fs.readFile(args.path as string, "utf-8");
      return { success: true, content };
    },
  });

  tools.register({
    name: "write_file",
    description: "Write a file",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
    execute: async (args) => {
      await fs.writeFile(args.path as string, args.content as string);
      return { success: true, content: `Wrote ${args.path}` };
    },
  });

  return new AgenticLoop({
    llm,
    agent: config.agent,
    tools,
    executor: new DefaultToolExecutor(tools),
    hooks: new DefaultHookManager(),
    context: new DefaultContextBuilder(),
  });
}

// Create the subagent runner
const runner = new DefaultSubagentRunner(createSubagentLoop);
```

**Spawning a single subagent:**

```typescript
const result = await runner.spawn({
  agent: {
    id: "researcher",
    name: "Researcher",
    prompt: "You research topics by reading files. Be thorough and factual.",
  },
  task: "Read all .ts files in src/llm/ and document the public API",
  parentSessionId: "session-1",
  timeout: 60_000, // Kill after 60 seconds if still running
});

console.log(result.success);    // true
console.log(result.output);     // "The llm module exports: MockLLMAdapter, RetryLLMAdapter, ..."
console.log(result.iterations); // 5
console.log(result.tokenUsage); // { input: 12000, output: 3400 }
```

**Spawning multiple subagents in parallel:**

```typescript
// All three run at the same time — each in its own isolated context
const results = await runner.spawnParallel([
  {
    agent: {
      id: "api-researcher",
      name: "API Researcher",
      prompt: "You document APIs. Read source files and list all exports with descriptions.",
    },
    task: "Document the public API of src/tool/",
    parentSessionId: "session-1",
  },
  {
    agent: {
      id: "test-writer",
      name: "Test Writer",
      prompt: "You write unit tests. Read source files, then write comprehensive tests.",
    },
    task: "Write tests for src/context/pruner.ts",
    parentSessionId: "session-1",
  },
  {
    agent: {
      id: "reviewer",
      name: "Code Reviewer",
      prompt: "You review code for bugs, security issues, and style problems.",
    },
    task: "Review src/llm/openai-adapter.ts for potential issues",
    parentSessionId: "session-1",
  },
]);

// Each result is independent
for (const r of results) {
  console.log(`${r.success ? "OK" : "FAIL"} — ${r.iterations} iterations, ${r.tokenUsage.input + r.tokenUsage.output} tokens`);
  console.log(r.output.slice(0, 200));
  console.log("---");
}
```

**Using subagents as a tool (agent spawns agents):**

The most powerful pattern: make subagent spawning available as a tool. The parent agent decides *when* and *what* to delegate:

```typescript
const parentTools = new DefaultToolRegistry();

// The parent agent can spawn child agents via this tool
parentTools.register({
  name: "delegate",
  description:
    "Delegate a task to a specialist subagent. Use this for independent subtasks " +
    "that can run in isolation. Returns the subagent's output.",
  parameters: {
    type: "object",
    properties: {
      role: { type: "string", description: "Short role name (e.g. 'researcher', 'tester')" },
      expertise: { type: "string", description: "System prompt for the subagent" },
      task: { type: "string", description: "What the subagent should do" },
    },
    required: ["role", "expertise", "task"],
  },
  execute: async (args, context) => {
    const result = await runner.spawn({
      agent: {
        id: `sub-${args.role as string}`,
        name: args.role as string,
        prompt: args.expertise as string,
        maxIterations: 15,
      },
      task: args.task as string,
      parentSessionId: context.sessionId,
      timeout: 120_000,
    });

    if (!result.success) {
      return { success: false, content: `Subagent failed: ${result.output}` };
    }
    return { success: true, content: result.output };
  },
});

// Now create the parent agent — it decides when to delegate
const parentLoop = new AgenticLoop({
  llm,
  agent: {
    id: "orchestrator",
    name: "Orchestrator",
    prompt:
      "You are a project lead. Break complex tasks into subtasks and delegate them " +
      "to specialist subagents. Combine their results into a final deliverable. " +
      "Use the delegate tool for independent work that doesn't need your context.",
    maxIterations: 10,
  },
  tools: parentTools,
  executor: new DefaultToolExecutor(parentTools),
  hooks: new DefaultHookManager(),
  context: new DefaultContextBuilder(),
});

const result = await parentLoop.run(
  "Audit the entire codebase: check for bugs, write missing tests, and document the public API",
  "session-1",
);
```

**What happens:**

```
Parent (Orchestrator):
  "This is a big job. I'll split it into three parallel tasks."

  Iteration 1:
    → delegate({ role: "reviewer", expertise: "You find bugs...", task: "Review src/ for bugs" })
        ↓
        Child agent runs its own loop:
          → read_file("src/loop/loop.ts")
          → read_file("src/tool/executor.ts")
          → ... (5 iterations)
          ← "Found 2 potential issues: 1) Missing null check in..."
    ← "Found 2 potential issues..."

  Iteration 2:
    → delegate({ role: "tester", expertise: "You write tests...", task: "Write missing tests" })
        ↓
        Another child agent, own context:
          → read_file("src/context/pruner.ts")
          → write_file("tests/context/pruner-edge-cases.test.ts", "...")
          → ... (8 iterations)
          ← "Wrote 12 new test cases covering edge cases in..."
    ← "Wrote 12 new test cases..."

  Iteration 3:
    → delegate({ role: "documenter", expertise: "You write docs...", task: "Document public API" })
        ↓
        Third child agent:
          → read_file("src/index.ts")
          → read_file("src/llm/types.ts")
          → write_file("API.md", "...")
          ← "Documented 47 exports across 8 modules"
    ← "Documented 47 exports..."

  Iteration 4:
    Parent combines all results into a final report.
    ← "Audit complete. 2 bugs found, 12 tests added, API documented."
```

**Key properties of subagents:**

| Property | Description |
|----------|-------------|
| **Isolated context** | Each child has its own message history. Parent's context stays clean. |
| **Parallel execution** | `spawnParallel()` runs multiple children at the same time. |
| **Timeout support** | Set `timeout` to kill a child that takes too long. |
| **Abort propagation** | If the parent is cancelled, all children are cancelled too. |
| **Token tracking** | Each result includes `tokenUsage` — you know exactly what each child cost. |
| **Composable** | Children can spawn their own children (nested subagents). |

**When to use subagents vs. a single agent:**

| Use a single agent when... | Use subagents when... |
|---|---|
| Task is sequential (step A then step B) | Tasks are independent and can run in parallel |
| Context from step A is needed in step B | Each subtask is self-contained |
| Total work fits in one context window | Work would overflow a single context window |
| Simple task, few iterations | Complex task with multiple specialties |

### 11. Memory — Persistent Knowledge Across Conversations

Memory lets the agent remember things between conversations. You define **what** to store (user preferences, project facts, feedback), the agent decides **when** to recall it.

agent-core provides the `MemoryStore` interface — you implement the backend (Firestore, file system, SQLite, etc.).

```typescript
import type { MemoryStore, MemoryEntry, MemorySearchResult } from "@algomim/agent-core";

// Step 1: Implement the MemoryStore interface
// This example uses a simple in-memory Map. In production, use Firestore, SQLite, etc.
class MyMemoryStore implements MemoryStore {
  private entries = new Map<string, MemoryEntry>();
  private nextId = 1;

  async save(entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">): Promise<MemoryEntry> {
    const full: MemoryEntry = {
      ...entry,
      id: `mem_${this.nextId++}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.entries.set(full.id, full);
    return full;
  }

  async search(query: string, options?: { maxResults?: number }): Promise<readonly MemorySearchResult[]> {
    const results: MemorySearchResult[] = [];
    for (const entry of this.entries.values()) {
      // Simple keyword match — in production, use embeddings or full-text search
      const relevance = entry.content.toLowerCase().includes(query.toLowerCase()) ? 0.9 : 0.1;
      results.push({ entry, relevance });
    }
    return results
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, options?.maxResults ?? 10);
  }

  async delete(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async getAll(): Promise<readonly MemoryEntry[]> {
    return [...this.entries.values()];
  }
}

// Step 2: Pre-populate with some knowledge
const memory = new MyMemoryStore();

await memory.save({
  type: "user",
  name: "role",
  content: "Senior TypeScript developer, prefers functional style, uses Vitest for testing.",
});

await memory.save({
  type: "feedback",
  name: "no-classes",
  content: "User prefers plain functions over classes. Don't wrap everything in a class.",
});

await memory.save({
  type: "project",
  name: "stack",
  content: "Project uses React 19, TypeScript 5.5, Tailwind CSS, deployed on Vercel.",
});

// Step 3: Pass memory to the loop
const loop = new AgenticLoop({
  llm,
  agent: {
    id: "assistant",
    name: "Assistant",
    prompt: "You are a helpful coding assistant.",
  },
  tools,
  executor: new DefaultToolExecutor(tools),
  hooks: new DefaultHookManager(),
  context: new DefaultContextBuilder(),
  memory,  // <-- memories are searched and injected into the system prompt
});

// When the user says "Write a utility function for date formatting":
// 1. Memory is searched with the user's input
// 2. Relevant entries are found: "prefers functional style", "uses Vitest"
// 3. They're injected into the system prompt as <memory> sections
// 4. The LLM writes a plain function (not a class) with Vitest tests
const result = await loop.run("Write a utility function for date formatting", "session-1");
```

**Memory types:**

| Type | What it stores | Example |
|------|---------------|---------|
| `user` | Who the user is | "Senior developer, prefers terse responses" |
| `feedback` | Corrections from the user | "Don't use default exports — project convention" |
| `project` | Ongoing work context | "Auth rewrite is driven by compliance, not tech debt" |
| `reference` | External resource pointers | "Pipeline bugs tracked in Linear project INGEST" |

### 12. Plan Mode — Think Before Acting

For complex tasks, you might want the agent to **plan first** before executing anything. Plan mode makes the agent outline its approach, then waits for approval before proceeding.

This is a two-step process:

```typescript
// Step 1: Run with planMode — agent creates a plan but doesn't execute
const loop = new AgenticLoop({
  llm,
  agent: {
    id: "planner",
    name: "Planner",
    prompt: "You are a senior engineer. Plan carefully before making changes.",
  },
  tools,
  executor: new DefaultToolExecutor(tools),
  hooks: new DefaultHookManager(),
  context: new DefaultContextBuilder(),
  planMode: true,  // <-- enables planning phase
});

const planResult = await loop.run("Refactor the auth module to use JWT", "session-1");

// The agent returns a plan, NOT execution results
console.log(planResult.finishReason);  // "plan_pending"
console.log(planResult.output);
// "Step 1: Read the current auth module (src/auth/)
//  Step 2: Identify session-based code to replace
//  Step 3: Install jsonwebtoken package
//  Step 4: Create jwt.ts with sign/verify functions
//  Step 5: Update auth middleware to use JWT
//  Step 6: Update tests
//  Step 7: Run tests to verify"
console.log(planResult.iterations);    // 0 — no tool calls were made
```

```typescript
// Step 2: After reviewing the plan, run again with approvedPlan
const execLoop = new AgenticLoop({
  llm,
  agent: {
    id: "planner",
    name: "Planner",
    prompt: "You are a senior engineer.",
  },
  tools,
  executor: new DefaultToolExecutor(tools),
  hooks: new DefaultHookManager(),
  context: new DefaultContextBuilder(),
  planMode: true,
  approvedPlan: planResult.output,  // <-- inject the approved plan
});

const execResult = await execLoop.run("Refactor the auth module to use JWT", "session-1");

// Now the agent executes — following the plan step by step
console.log(execResult.finishReason);  // "complete"
console.log(execResult.iterations);    // 7
console.log(execResult.toolCalls);     // read_file, write_file, run_command, ...
```

**What happens under the hood:**

| Phase | `planMode: true` | `planMode: true` + `approvedPlan` |
|-------|------------------|-----------------------------------|
| Tools sent to LLM | None (forces text-only) | All tools available |
| System prompt | Adds "Create a step-by-step plan..." | Injects plan in `<approved-plan>` tags |
| Loop iterations | 0 (single LLM call) | Normal loop (think → execute → verify) |
| `finishReason` | `"plan_pending"` | `"complete"` |

**Listening for plan events:**

```typescript
const loop = new AgenticLoop({
  // ...config...
  planMode: true,
  onEvent: (event) => {
    if (event.type === "plan:ready") {
      console.log("Plan received:", event.plan);
      // Show to user for approval in your UI
    }
  },
});
```

### 13. MCP — Connect External Tool Servers

[Model Context Protocol (MCP)](https://modelcontextprotocol.io) is a standard for connecting AI agents to external tool servers. With MCP, your agent can use tools from **any MCP-compatible server** — without writing tool definitions by hand.

agent-core provides `MCPToolBridge` — it discovers tools from MCP servers and converts them to native agent-core tools automatically.

```typescript
import type { MCPClient } from "@algomim/agent-core";
import { MCPToolBridge, DefaultToolRegistry, AgenticLoop } from "@algomim/agent-core";

// Step 1: Create MCP clients
// You implement the MCPClient interface per transport (stdio, WebSocket, SSE).
// Here's what a connected client looks like:
const revitClient: MCPClient = {
  id: "revit",
  name: "Revit MCP Server",
  connect: async () => { /* connect via WebSocket */ },
  disconnect: async () => { /* cleanup */ },
  listTools: async () => [
    { name: "execute_script", description: "Run C# in Revit", inputSchema: { type: "object" } },
    { name: "search_api", description: "Search Revit API", inputSchema: { type: "object" } },
  ],
  callTool: async (name, args) => {
    // Forward the call to the MCP server
    return { content: [{ type: "text", text: "Script executed successfully" }] };
  },
};

const rhinoClient: MCPClient = {
  id: "rhino",
  name: "Rhino MCP Server",
  connect: async () => {},
  disconnect: async () => {},
  listTools: async () => [
    { name: "execute_script", description: "Run Python in Rhino", inputSchema: { type: "object" } },
  ],
  callTool: async (name, args) => {
    return { content: [{ type: "text", text: "ok" }] };
  },
};
```

```typescript
// Step 2a: Manual bridge — discover and register tools yourself
const registry = new DefaultToolRegistry();
const bridge = new MCPToolBridge(revitClient);
await bridge.registerAll(registry);

console.log(registry.has("revit_execute_script")); // true — prefixed with client ID
console.log(registry.has("revit_search_api"));     // true
```

```typescript
// Step 2b: Or use the loop's built-in MCP support — just pass clients
const loop = new AgenticLoop({
  llm,
  agent: {
    id: "architect",
    name: "Architect",
    prompt: "You help with BIM modeling across Revit and Rhino.",
  },
  tools: new DefaultToolRegistry(),  // starts empty
  executor: new DefaultToolExecutor(new DefaultToolRegistry()),
  hooks: new DefaultHookManager(),
  context: new DefaultContextBuilder(),
  mcpClients: [revitClient, rhinoClient],  // <-- auto-discovered at loop start
});

// At the start of loop.run():
// 1. MCPToolBridge.registerFromClients() discovers tools from both servers
// 2. "revit_execute_script", "revit_search_api", "rhino_execute_script" are registered
// 3. The agent can now use tools from both servers seamlessly

const result = await loop.run("Create a wall in Revit and export it to Rhino", "session-1");
```

**Tool naming:** MCP tools are prefixed with the client ID to avoid collisions. If both Revit and Rhino have `execute_script`, they become `revit_execute_script` and `rhino_execute_script`.

**Filtering tools:**

```typescript
// Custom prefix
const bridge = new MCPToolBridge(revitClient, {
  toolPrefix: "bim_",  // tools become "bim_execute_script", "bim_search_api"
});

// Include/exclude with glob patterns
const bridge = new MCPToolBridge(revitClient, {
  includeFilter: ["execute_*"],     // only tools matching this pattern
  excludeFilter: ["*_dangerous"],   // exclude tools matching this pattern
});
```

**Handling images from MCP tools:**

MCP tools can return images (e.g., viewport captures). These are automatically converted to `ToolFile` objects:

```typescript
// If an MCP tool returns an image:
// { content: [{ type: "image", data: "base64...", mimeType: "image/png" }] }
//
// The bridge converts it to:
// { success: true, content: "...", files: [{ name: "image", mimeType: "image/png", data: "base64..." }] }
```

## LLM Providers

Install an adapter package, then point it at your provider:

```bash
npm install @algomim/adapter-openai
```

```typescript
import { OpenAIAdapter } from "@algomim/adapter-openai";
// OpenAI
const llm = new OpenAIAdapter({
  baseURL: "https://api.openai.com/v1",
  apiKey: "sk-...",
});

// OpenRouter (access to Claude, Gemini, Llama, etc.)
const llm = new OpenAIAdapter({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: "or-...",
});

// Groq (fast inference)
const llm = new OpenAIAdapter({
  baseURL: "https://api.groq.com/openai/v1",
  apiKey: "gsk-...",
});

// Ollama (local, no API key needed)
const llm = new OpenAIAdapter({
  baseURL: "http://localhost:11434/v1",
});

// Any other OpenAI-compatible server
const llm = new OpenAIAdapter({
  baseURL: "https://your-server.com/v1",
  apiKey: "your-key",
  defaultHeaders: { "X-Custom-Header": "value" },
});
```

To add a completely custom provider, implement the `LLMAdapter` interface:

```typescript
import type { LLMAdapter, LLMRequest, LLMStream } from "@algomim/agent-core";

class MyCustomAdapter implements LLMAdapter {
  async stream(request: LLMRequest): Promise<LLMStream> {
    // Connect to your LLM, return a stream of events
    // See @algomim/adapter-openai source for a complete example
  }
}
```

## Architecture

```
src/
├── loop/       Core loop + state machine
│               AgenticLoop runs: gather → think → execute → verify → repeat
│
├── llm/        LLM interfaces + utilities (provider-agnostic)
│               LLMAdapter interface, DefaultLLMStream, SSE parser
│               MockLLMAdapter (testing), RetryLLMAdapter (decorator)
│
├── tool/       Tool system
│               DefaultToolRegistry (register/lookup tools by name)
│               DefaultToolExecutor (parallel execution)
│               MiddlewarePipeline (before/after hooks on every tool call)
│
├── hook/       Event hooks
│               DefaultHookManager (block, modify, or observe loop events)
│               Type-safe payloads per event
│
├── context/    Context management
│               DefaultContextBuilder (assembles system prompt + skills)
│               DefaultPruner (drop old messages when over token limit)
│               LLMCompactor (summarize old messages with LLM)
│
├── skill/      Skill system
│               DefaultSkillRegistry (register skills with triggers)
│               DefaultSkillDetector (match user input to skills)
│
├── agent/      Agent configuration
│               AgentConfigBuilder (fluent config API)
│               Permission matching (glob patterns)
│               DefaultSubagentRunner (spawn child agents)
│
├── memory/     Memory system (interface-only)
│               MemoryStore interface (save, search, delete, getAll)
│               Implementations live outside core (Firestore, file system, etc.)
│
├── mcp/        Model Context Protocol bridge
│               MCPToolBridge (convert MCP tools to native Tool format)
│               Auto-discovery via mcpClients config
│
└── schema/     JSON Schema types
```

## Development

```bash
npm install          # Install dependencies (TypeScript + Vitest only)
npm run build        # Compile to dist/
npm run dev          # Watch mode — recompile on save
npm test             # Run all 243 tests
npm run test:watch   # Interactive test mode
```

## Design Principles

- **Zero runtime dependencies** — Only TypeScript and Vitest (dev). No HTTP, database, or auth code.
- **Provider-agnostic** — Swap LLM providers by changing one URL. No vendor lock-in.
- **Minimal core** — The loop is simple. Complexity lives in hooks and middleware.
- **Immutable state** — Loop state changes through pure functions, never mutated directly.
- **Strict TypeScript** — Discriminated unions, exhaustive checks, full type safety.

## License

MIT
