// Agent setup — configures the agentic loop with tools and LLM

import {
  AgenticLoop,
  DefaultToolRegistry,
  DefaultToolExecutor,
  DefaultHookManager,
  DefaultContextBuilder,
  RetryLLMAdapter,
} from "@awesome-agent/agent-core";
import type { LoopResult, LoopEvent, Message, RunOptions } from "@awesome-agent/agent-core";
import { OpenAIAdapter } from "@awesome-agent/adapter-openai";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { execSync } from "node:child_process";

// ─── LLM ─────────────────────────────────────────────────────

function createLLM() {
  const baseURL = process.env.OPENAI_BASE_URL ?? "https://openrouter.ai/api/v1";
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Set OPENAI_API_KEY or OPENROUTER_API_KEY environment variable"
    );
  }

  return new RetryLLMAdapter(
    new OpenAIAdapter({ baseURL, apiKey }),
    { maxRetries: 2 }
  );
}

// ─── Tools ───────────────────────────────────────────────────

function createTools(): DefaultToolRegistry {
  const tools = new DefaultToolRegistry();

  tools.register({
    name: "read_file",
    description: "Read a file from disk",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "File path to read" } },
      required: ["path"],
    },
    execute: async (args) => {
      try {
        const content = await readFile(args.path as string, "utf-8");
        return { success: true, content };
      } catch (e) {
        return { success: false, content: `Error: ${e}` };
      }
    },
  });

  tools.register({
    name: "write_file",
    description: "Write content to a file",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to write" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["path", "content"],
    },
    execute: async (args) => {
      try {
        await writeFile(args.path as string, args.content as string, "utf-8");
        return { success: true, content: `Written to ${args.path}` };
      } catch (e) {
        return { success: false, content: `Error: ${e}` };
      }
    },
  });

  tools.register({
    name: "list_dir",
    description: "List files in a directory",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Directory path" } },
      required: ["path"],
    },
    execute: async (args) => {
      try {
        const files = await readdir(args.path as string);
        return { success: true, content: files.join("\n") };
      } catch (e) {
        return { success: false, content: `Error: ${e}` };
      }
    },
  });

  tools.register({
    name: "run_command",
    description: "Run a shell command and return output",
    parameters: {
      type: "object",
      properties: { command: { type: "string", description: "Shell command" } },
      required: ["command"],
    },
    execute: async (args) => {
      try {
        const output = execSync(args.command as string, {
          encoding: "utf-8",
          timeout: 10_000,
        });
        return { success: true, content: output };
      } catch (e) {
        return { success: false, content: `Error: ${e}` };
      }
    },
  });

  return tools;
}

// ─── Agent ───────────────────────────────────────────────────

const tools = createTools();
const model = process.env.MODEL ?? "openai/gpt-4o";

const loop = new AgenticLoop({
  llm: createLLM(),
  agent: {
    id: "cli-agent",
    name: "CLI Agent",
    prompt:
      "You are a helpful terminal assistant. You can read/write files, " +
      "list directories, and run shell commands. Be concise.",
    model,
    maxIterations: 15,
  },
  tools,
  executor: new DefaultToolExecutor(tools),
  hooks: new DefaultHookManager(),
  context: new DefaultContextBuilder(),
});

// ─── Public API ──────────────────────────────────────────────

export type EventCallback = (event: LoopEvent) => void;

let history: Message[] = [];

export async function sendMessage(
  input: string,
  onEvent: EventCallback
): Promise<LoopResult> {
  const config = {
    ...loop["config"],
    onEvent,
  };

  const localLoop = new AgenticLoop(config);
  const result = await localLoop.run(input, "cli-session", { history });
  history = [...result.messages];
  return result;
}

export function clearHistory(): void {
  history = [];
}
