// Simple CLI Agent — Node.js, zero extra dependencies
// Supports human-in-the-loop: type while agent is working

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

// ─── Message Queue (Human-in-the-loop) ──────────────────────

const pendingMessages: string[] = [];

// ─── Hooks ───────────────────────────────────────────────────

const hooks = new DefaultHookManager();

hooks.register({
  name: "inject-pending-messages",
  event: HookEvent.PreLLMCall,
  handler: async (payload) => {
    if (pendingMessages.length === 0) {
      return { action: "continue" as const };
    }

    const extra = pendingMessages.splice(0).join("\n");
    const request = payload.data.request;
    const updatedMessages: Message[] = [
      ...request.messages,
      { role: "user", content: `[User interjection]: ${extra}` },
    ];

    console.log(`\n  \x1b[90m(injecting your message into conversation)\x1b[0m`);

    return {
      action: "modify" as const,
      data: {
        request: { ...request, messages: updatedMessages },
      },
    };
  },
});

// ─── Loop Config ─────────────────────────────────────────────

const baseConfig = {
  llm,
  agent: {
    id: "cli-agent",
    name: "CLI Agent",
    prompt:
      "You are a helpful terminal assistant. You can read/write files, " +
      "list directories, and run commands. Be concise.\n\n" +
      "IMPORTANT: Call only ONE tool at a time. After each tool call, " +
      "briefly explain what you did and what you'll do next before calling " +
      "the next tool. This helps the user follow your progress.\n\n" +
      "If you receive a [User interjection], acknowledge it and adjust " +
      "your plan accordingly. The user is watching in real-time.",
    model,
    maxIterations: 15,
  },
  tools,
  executor: new DefaultToolExecutor(tools),
  hooks,
  context: new DefaultContextBuilder(),
};

// ─── Raw Input Handler ───────────────────────────────────────
// Reads keystrokes directly — allows typing while agent is running

let inputBuffer = "";
let agentRunning = false;
let history: Message[] = [];

function setupRawInput() {
  if (!process.stdin.isTTY) return;

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf-8");

  process.stdin.on("data", (key: string) => {
    // Ctrl+C
    if (key === "\x03") {
      console.log("\n");
      process.exit(0);
    }

    // Enter
    if (key === "\r" || key === "\n") {
      const text = inputBuffer.trim();
      inputBuffer = "";

      if (!text) {
        if (!agentRunning) showPrompt();
        return;
      }

      process.stdout.write("\n");

      if (text === "/exit") {
        process.exit(0);
      }
      if (text === "/clear") {
        history = [];
        pendingMessages.length = 0;
        console.log("  (conversation cleared)\n");
        showPrompt();
        return;
      }

      if (agentRunning) {
        // Queue message — will be injected via hook
        pendingMessages.push(text);
        console.log(`  \x1b[90m(queued: "${text}" — sending to agent next iteration)\x1b[0m`);
        return;
      }

      runAgent(text);
      return;
    }

    // Backspace
    if (key === "\x7f" || key === "\b") {
      if (inputBuffer.length > 0) {
        inputBuffer = inputBuffer.slice(0, -1);
        process.stdout.write("\b \b");
      }
      return;
    }

    // Escape sequences (arrows, etc.) — ignore
    if (key.startsWith("\x1b")) return;

    // Regular character
    inputBuffer += key;
    process.stdout.write(key);
  });
}

function showPrompt() {
  process.stdout.write("\x1b[32mYou:\x1b[0m ");
}

// ─── Agent Runner ────────────────────────────────────────────

async function runAgent(text: string) {
  agentRunning = true;
  process.stdout.write("\x1b[36mAgent:\x1b[0m ");

  let lastEventType = "";

  const onEvent = (event: LoopEvent) => {
    switch (event.type) {
      case "text:delta":
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
        lastEventType = "iteration:end";
        break;
    }
  };

  try {
    const config = { ...baseConfig, onEvent };
    const localLoop = new AgenticLoop(config);
    const result = await localLoop.run(text, "cli-session", { history });
    history = [...result.messages];

    if (!result.output.length) {
      process.stdout.write("(no response)");
    }

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

  agentRunning = false;
  console.log("\n");
  showPrompt();
}

// ─── Bootstrap ───────────────────────────────────────────────

console.log(`\n  awesome-agent CLI (${model})`);
console.log("  Type a message. /clear to reset, /exit or Ctrl+C to quit.");
console.log("  You can type while the agent is working — messages are queued.\n");

setupRawInput();
showPrompt();
