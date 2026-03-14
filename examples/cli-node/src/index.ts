// awesome-agent CLI — Claude Code-style terminal interface

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
import { createInterface } from "node:readline";

// ─── Colors ──────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  red: "\x1b[31m",
};

function separator() {
  const w = process.stdout.columns || 80;
  console.log(`${c.gray}${"─".repeat(w)}${c.reset}`);
}

// ─── LLM ─────────────────────────────────────────────────────

const baseURL = process.env.OPENAI_BASE_URL ?? "https://openrouter.ai/api/v1";
const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  console.error("Set OPENAI_API_KEY or OPENROUTER_API_KEY in .env");
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
    try { const files = await readdir(args.path as string); return { success: true, content: files.join("\n") }; }
    catch (e) { return { success: false, content: `${e}` }; }
  },
});

tools.register({
  name: "run_command",
  description: "Run a shell command (10s timeout)",
  parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  execute: async (args) => {
    try { const o = execSync(args.command as string, { encoding: "utf-8", timeout: 10_000 }); return { success: true, content: o }; }
    catch (e) { return { success: false, content: `${e}` }; }
  },
});

// ─── Message Queue ───────────────────────────────────────────

const pendingMessages: string[] = [];

// ─── Hooks ───────────────────────────────────────────────────

const hooks = new DefaultHookManager();

hooks.register({
  name: "inject-pending-messages",
  event: HookEvent.PreLLMCall,
  handler: async (payload) => {
    if (pendingMessages.length === 0) return { action: "continue" as const };
    const extra = pendingMessages.splice(0).join("\n");
    const request = payload.data.request;
    console.log(`  ${c.yellow}↳ injecting your message${c.reset}`);
    return {
      action: "modify" as const,
      data: {
        request: {
          ...request,
          messages: [...request.messages, { role: "user" as const, content: `[User interjection]: ${extra}` }],
        },
      },
    };
  },
});

// ─── Config ──────────────────────────────────────────────────

const baseConfig = {
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
};

// ─── State ───────────────────────────────────────────────────

let history: Message[] = [];
let agentRunning = false;

// ─── Readline with concurrent input ─────────────────────────

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: `${c.bold}${c.green}❯${c.reset} `,
});

function ask() {
  rl.prompt();
}

function pausePrompt() {
  // Hide prompt while agent is working — prevent it mixing with output
  rl.pause();
}

function resumePrompt() {
  rl.resume();
  ask();
}

rl.on("line", async (input) => {
  const text = input.trim();
  if (!text) return ask();

  if (text === "/exit") {
    rl.close();
    process.exit(0);
  }

  if (text === "/clear") {
    history = [];
    pendingMessages.length = 0;
    console.log(`  ${c.gray}(cleared)${c.reset}\n`);
    return ask();
  }

  // Agent is busy — queue the message silently
  if (agentRunning) {
    pendingMessages.push(text);
    console.log(`\n  ${c.yellow}↳ queued:${c.reset} ${c.gray}"${text}" — will inject on next LLM call${c.reset}\n`);
    return;
  }

  pausePrompt();
  await runAgent(text);
  resumePrompt();
});

// ─── Agent Runner ────────────────────────────────────────────

async function runAgent(text: string) {
  agentRunning = true;
  const startTime = Date.now();
  let lastType = "";

  const onEvent = (event: LoopEvent) => {
    switch (event.type) {
      case "text:delta":
        if (lastType === "tool:end") process.stdout.write("\n\n");
        if (lastType !== "text:delta") process.stdout.write("");
        process.stdout.write(event.text);
        lastType = "text:delta";
        break;

      case "tool:start": {
        if (lastType === "text:delta") process.stdout.write("\n");
        const args = Object.entries(event.args)
          .map(([k, v]) => `${k}=${typeof v === "string" && v.length > 35 ? v.slice(0, 35) + "…" : v}`)
          .join(", ");
        console.log(`  ${c.green}●${c.reset} ${c.bold}${event.name}${c.reset}(${c.gray}${args}${c.reset})`);
        process.stdout.write(`  ${c.gray}└ Running…${c.reset}`);
        lastType = "tool:start";
        break;
      }

      case "tool:end":
        process.stdout.write("\r\x1b[K"); // clear Running… line
        if (event.result.success) {
          const preview = event.result.content.split("\n")[0].slice(0, 50);
          console.log(`  ${c.gray}└${c.reset} ${c.green}Done${c.reset}${preview ? ` ${c.gray}(${preview})${c.reset}` : ""}`);
        } else {
          const err = event.result.content.split("\n")[0].slice(0, 50);
          console.log(`  ${c.gray}└${c.reset} ${c.red}Failed${c.reset} ${c.gray}(${err})${c.reset}`);
        }
        lastType = "tool:end";
        break;

      case "iteration:end":
        lastType = "iteration:end";
        break;
    }
  };

  try {
    const config = { ...baseConfig, onEvent };
    const localLoop = new AgenticLoop(config);
    const result = await localLoop.run(text, "cli-session", { history });
    history = [...result.messages];

    if (!result.output.length) process.stdout.write(`${c.gray}(no response)${c.reset}`);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const { input: ti, output: to } = result.totalTokens;
    console.log(`\n\n  ${c.gray}${result.iterations} iteration${result.iterations !== 1 ? "s" : ""} · ↑ ${ti} · ↓ ${to} · ${ti + to} tokens · ${elapsed}s${c.reset}`);
  } catch (err) {
    console.log(`\n  ${c.red}Error: ${err instanceof Error ? err.message : String(err)}${c.reset}`);
  }

  agentRunning = false;
  console.log("");
  separator();
  console.log("");
}

// ─── Start ───────────────────────────────────────────────────

console.clear();
console.log("");
console.log(`  ${c.bold}${c.cyan}awesome-agent${c.reset} ${c.gray}(${model})${c.reset}`);
console.log(`  ${c.gray}/clear · /exit · type while agent works to queue${c.reset}`);
separator();
console.log("");

ask();
