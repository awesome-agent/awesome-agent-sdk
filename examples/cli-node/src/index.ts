// awesome-agent CLI — Claude Code-style terminal interface
// Raw ANSI rendering, no framework dependency

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

// ─── ANSI Helpers ────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  red: "\x1b[31m",
  bgGreen: "\x1b[42m",
  bgRed: "\x1b[41m",
  bgCyan: "\x1b[46m",
  bgYellow: "\x1b[43m",
  black: "\x1b[30m",
};

function separator() {
  const width = process.stdout.columns || 80;
  console.log(`${c.gray}${"─".repeat(width)}${c.reset}`);
}

// ─── LLM ─────────────────────────────────────────────────────

const baseURL = process.env.OPENAI_BASE_URL ?? "https://openrouter.ai/api/v1";
const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  console.error(`${c.red}Set OPENAI_API_KEY or OPENROUTER_API_KEY in .env${c.reset}`);
  console.error(`${c.gray}cp .env.example .env  # then fill in your key${c.reset}`);
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

    console.log(`\n  ${c.yellow}↳ injecting your message${c.reset}`);

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
      "your plan accordingly.",
    model,
    maxIterations: 15,
  },
  tools,
  executor: new DefaultToolExecutor(tools),
  hooks,
  context: new DefaultContextBuilder(),
};

// ─── Raw Input Handler ───────────────────────────────────────

let inputBuffer = "";
let agentRunning = false;
let history: Message[] = [];

function setupRawInput() {
  if (!process.stdin.isTTY) return;

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf-8");

  process.stdin.on("data", (key: string) => {
    if (key === "\x03") { // Ctrl+C
      console.log("\n");
      process.exit(0);
    }

    if (key === "\r" || key === "\n") { // Enter
      const text = inputBuffer.trim();
      inputBuffer = "";
      process.stdout.write("\n");

      if (!text) {
        if (!agentRunning) showPrompt();
        return;
      }

      if (text === "/exit") process.exit(0);
      if (text === "/clear") {
        history = [];
        pendingMessages.length = 0;
        console.log(`  ${c.gray}(conversation cleared)${c.reset}\n`);
        showPrompt();
        return;
      }

      if (agentRunning) {
        pendingMessages.push(text);
        console.log(`  ${c.gray}(queued: "${text}")${c.reset}`);
        return;
      }

      runAgent(text);
      return;
    }

    if (key === "\x7f" || key === "\b") { // Backspace
      if (inputBuffer.length > 0) {
        inputBuffer = inputBuffer.slice(0, -1);
        process.stdout.write("\b \b");
      }
      return;
    }

    if (key === "\x1b") return; // Escape
    if (key.startsWith("\x1b[")) return; // Arrow keys

    inputBuffer += key;
    process.stdout.write(key);
  });
}

function showPrompt() {
  process.stdout.write(`${c.bold}${c.green}❯${c.reset} `);
}

// ─── Agent Runner ────────────────────────────────────────────

async function runAgent(text: string) {
  agentRunning = true;

  let lastEventType = "";
  let currentToolName = "";
  const startTime = Date.now();

  const onEvent = (event: LoopEvent) => {
    switch (event.type) {
      case "text:delta":
        if (lastEventType === "tool:end" || lastEventType === "iteration:end") {
          process.stdout.write("\n");
        }
        if (lastEventType !== "text:delta") {
          process.stdout.write(`\n`);
        }
        process.stdout.write(event.text);
        lastEventType = "text:delta";
        break;

      case "tool:start":
        currentToolName = event.name;
        const args = Object.entries(event.args)
          .map(([k, v]) => {
            const val = typeof v === "string" && v.length > 40
              ? v.slice(0, 40) + "…"
              : String(v);
            return `${k}=${val}`;
          })
          .join(", ");
        console.log(`\n  ${c.green}●${c.reset} ${c.bold}${event.name}${c.reset}(${c.gray}${args}${c.reset})`);
        process.stdout.write(`  ${c.gray}└ Running…${c.reset}`);
        lastEventType = "tool:start";
        break;

      case "tool:end":
        // Clear "Running…" line
        process.stdout.write("\r\x1b[K");
        if (event.result.success) {
          const preview = event.result.content.split("\n")[0].slice(0, 60);
          console.log(`  ${c.gray}└ ${c.green}Done${c.reset}${preview ? ` ${c.gray}(${preview}${event.result.content.length > 60 ? "…" : ""})${c.reset}` : ""}`);
        } else {
          const errPreview = event.result.content.split("\n")[0].slice(0, 60);
          console.log(`  ${c.gray}└ ${c.red}Failed${c.reset} ${c.gray}(${errPreview})${c.reset}`);
        }
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
      process.stdout.write(`\n${c.gray}(no response)${c.reset}`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const { input: tokIn, output: tokOut } = result.totalTokens;

    console.log(`\n`);
    console.log(
      `  ${c.gray}${result.iterations} iteration${result.iterations !== 1 ? "s" : ""} · ` +
      `↑ ${tokIn} · ↓ ${tokOut} · ` +
      `${tokIn + tokOut} tokens · ` +
      `${elapsed}s${c.reset}`
    );
  } catch (err) {
    console.log(
      `\n  ${c.red}Error: ${err instanceof Error ? err.message : String(err)}${c.reset}`
    );
  }

  agentRunning = false;
  console.log("");
  separator();
  console.log("");
  showPrompt();
}

// ─── Bootstrap ───────────────────────────────────────────────

console.clear();
console.log("");
console.log(`  ${c.bold}${c.cyan}awesome-agent${c.reset} ${c.gray}(${model})${c.reset}`);
console.log(`  ${c.gray}/clear to reset · /exit or Ctrl+C to quit${c.reset}`);
console.log(`  ${c.gray}Type while agent works to queue messages${c.reset}`);
console.log("");
separator();
console.log("");

setupRawInput();
showPrompt();
