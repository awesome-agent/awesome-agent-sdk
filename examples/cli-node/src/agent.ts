// Agent setup — separated from UI for clean SRP

import {
  AgenticLoop,
  DefaultToolRegistry,
  DefaultToolExecutor,
  DefaultHookManager,
  DefaultContextBuilder,
  RetryLLMAdapter,
  HookEvent,
} from "@awesome-agent/agent-core";
import type { Message, LoopEvent } from "@awesome-agent/agent-core";
import { OpenAIAdapter } from "@awesome-agent/adapter-openai";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { execSync } from "node:child_process";

// ─── LLM ─────────────────────────────────────────────────────

const baseURL = process.env.OPENAI_BASE_URL ?? "https://openrouter.ai/api/v1";
const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  console.error("Set OPENAI_API_KEY or OPENROUTER_API_KEY in .env");
  process.exit(1);
}

export const model = process.env.MODEL ?? "openai/gpt-4o";

const llm = new RetryLLMAdapter(
  new OpenAIAdapter({ baseURL, apiKey }),
  { maxRetries: 2 }
);

// ─── Tools ───────────────────────────────────────────────────

const tools = new DefaultToolRegistry();

tools.register({
  name: "read_file",
  description: "Read a file from disk",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  execute: async (args) => {
    try { return { success: true, content: await readFile(args.path as string, "utf-8") }; }
    catch (e) { return { success: false, content: `${e}` }; }
  },
});

tools.register({
  name: "write_file",
  description: "Write content to a file",
  parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
  execute: async (args) => {
    try { await writeFile(args.path as string, args.content as string, "utf-8"); return { success: true, content: `Written to ${args.path}` }; }
    catch (e) { return { success: false, content: `${e}` }; }
  },
});

tools.register({
  name: "list_dir",
  description: "List files in a directory",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  execute: async (args) => {
    try { return { success: true, content: (await readdir(args.path as string)).join("\n") }; }
    catch (e) { return { success: false, content: `${e}` }; }
  },
});

tools.register({
  name: "run_command",
  description: "Run a shell command (10s timeout)",
  parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  execute: async (args) => {
    try { return { success: true, content: execSync(args.command as string, { encoding: "utf-8", timeout: 10_000 }) }; }
    catch (e) { return { success: false, content: `${e}` }; }
  },
});

// ─── Hooks + Queue ───────────────────────────────────────────

const pendingMessages: string[] = [];
const hooks = new DefaultHookManager();

hooks.register({
  name: "inject-pending",
  event: HookEvent.PreLLMCall,
  handler: async (payload) => {
    if (pendingMessages.length === 0) return { action: "continue" as const };
    const extra = pendingMessages.splice(0).join("\n");
    const req = payload.data.request;
    return {
      action: "modify" as const,
      data: {
        request: {
          ...req,
          messages: [...req.messages, { role: "user" as const, content: `[User interjection]: ${extra}` }],
        },
      },
    };
  },
});

// ─── Public API ──────────────────────────────────────────────

let history: Message[] = [];

export function queueMessage(text: string) {
  pendingMessages.push(text);
}

export function clearHistory() {
  history = [];
  pendingMessages.length = 0;
}

export async function sendMessage(
  input: string,
  onEvent: (event: LoopEvent) => void
) {
  const config = {
    llm,
    agent: {
      id: "cli-agent",
      name: "CLI Agent",
      prompt:
        "You are a helpful terminal assistant. You can read/write files, " +
        "list directories, and run commands. Be concise.\n\n" +
        "IMPORTANT: Call only ONE tool at a time. After each tool call, " +
        "briefly explain what you did and what you'll do next.\n\n" +
        "If you receive a [User interjection], acknowledge it and adjust your plan.",
      model,
      maxIterations: 15,
    },
    tools,
    executor: new DefaultToolExecutor(tools),
    hooks,
    context: new DefaultContextBuilder(),
    onEvent,
  };

  const loop = new AgenticLoop(config);
  const result = await loop.run(input, "cli-session", { history });
  history = [...result.messages];
  return result;
}
