// Simple CLI Agent — Node.js, zero extra dependencies
// Uses readline for input, stdout for streaming output

import { createInterface } from "node:readline";
import {
  AgenticLoop,
  DefaultToolRegistry,
  DefaultToolExecutor,
  DefaultHookManager,
  DefaultContextBuilder,
  RetryLLMAdapter,
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
  console.error("cp .env.example .env  # then fill in your key");
  process.exit(1);
}

const model = process.env.MODEL ?? "openai/gpt-4o";

const llm = new RetryLLMAdapter(
  new OpenAIAdapter({ baseURL, apiKey }),
  { maxRetries: 2 }
);

// ─── Tools ───────────────────────────────────────────────────

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
      return { success: true, content: await readFile(args.path as string, "utf-8") };
    } catch (e) {
      return { success: false, content: `${e}` };
    }
  },
});

tools.register({
  name: "write_file",
  description: "Write content to a file",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
  execute: async (args) => {
    try {
      await writeFile(args.path as string, args.content as string, "utf-8");
      return { success: true, content: `Written to ${args.path}` };
    } catch (e) {
      return { success: false, content: `${e}` };
    }
  },
});

tools.register({
  name: "list_dir",
  description: "List files in a directory",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  execute: async (args) => {
    try {
      const files = await readdir(args.path as string);
      return { success: true, content: files.join("\n") };
    } catch (e) {
      return { success: false, content: `${e}` };
    }
  },
});

tools.register({
  name: "run_command",
  description: "Run a shell command (10s timeout)",
  parameters: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
  execute: async (args) => {
    try {
      const output = execSync(args.command as string, { encoding: "utf-8", timeout: 10_000 });
      return { success: true, content: output };
    } catch (e) {
      return { success: false, content: `${e}` };
    }
  },
});

// ─── Loop ────────────────────────────────────────────────────

const loop = new AgenticLoop({
  llm,
  agent: {
    id: "cli-agent",
    name: "CLI Agent",
    prompt:
      "You are a helpful terminal assistant. You can read/write files, " +
      "list directories, and run commands. Be concise.\n\n" +
      "IMPORTANT: Call only ONE tool at a time. After each tool call, " +
      "briefly explain what you did and what you'll do next before calling " +
      "the next tool. This helps the user follow your progress.",
    model,
    maxIterations: 15,
  },
  tools,
  executor: new DefaultToolExecutor(tools),
  hooks: new DefaultHookManager(),
  context: new DefaultContextBuilder(),
});

// ─── Chat Loop ───────────────────────────────────────────────

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

let history: Message[] = [];

console.log(`\n  awesome-agent CLI (${model})`);
console.log("  Type a message. /clear to reset, /exit to quit.\n");

function prompt() {
  rl.question("\x1b[32mYou:\x1b[0m ", async (input) => {
    const text = input.trim();

    if (!text) return prompt();
    if (text === "/exit") return rl.close();
    if (text === "/clear") {
      history = [];
      console.log("  (conversation cleared)\n");
      return prompt();
    }

    process.stdout.write("\x1b[36mAgent:\x1b[0m ");

    let lastEventType = "";

    const onEvent = (event: LoopEvent) => {
      switch (event.type) {
        case "text:delta":
          // Add newline before text if previous event was a tool
          if (lastEventType === "tool:end") {
            process.stdout.write("\n\n\x1b[36mAgent:\x1b[0m ");
          }
          process.stdout.write(event.text);
          lastEventType = "text:delta";
          break;
        case "tool:start":
          process.stdout.write(`\n  \x1b[33m→ ${event.name}\x1b[0m `);
          lastEventType = "tool:start";
          break;
        case "tool:end":
          process.stdout.write(event.result.success ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m");
          lastEventType = "tool:end";
          break;
        case "iteration:end":
          // Separate iterations visually
          lastEventType = "iteration:end";
          break;
      }
    };

    try {
      const config = { ...loop["config"], onEvent };
      const localLoop = new AgenticLoop(config);
      const result = await localLoop.run(text, "cli-session", { history });
      history = [...result.messages];

      // If streaming didn't print the output, print it now
      if (!result.output.length) {
        process.stdout.write("(no response)");
      }

      // Token usage stats
      const { input: tokIn, output: tokOut } = result.totalTokens;
      console.log(
        `\n\n  \x1b[90m${result.iterations} iteration${result.iterations !== 1 ? "s" : ""} · ` +
        `${tokIn} in / ${tokOut} out · ` +
        `${tokIn + tokOut} total tokens\x1b[0m`
      );
    } catch (err) {
      process.stdout.write(
        `\x1b[31mError: ${err instanceof Error ? err.message : String(err)}\x1b[0m`
      );
    }

    console.log("\n");
    prompt();
  });
}

prompt();
