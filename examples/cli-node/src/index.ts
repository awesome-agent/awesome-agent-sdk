// awesome-agent CLI — Claude Code-style terminal interface
// Fixed input bar at bottom, scrolling output above

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

const ESC = "\x1b";
const c = {
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  cyan: `${ESC}[36m`,
  gray: `${ESC}[90m`,
  red: `${ESC}[31m`,
  white: `${ESC}[37m`,
};

// Terminal dimensions
function getRows(): number { return process.stdout.rows || 24; }
function getCols(): number { return process.stdout.columns || 80; }

// Move cursor, clear, scroll region
function moveTo(row: number, col: number) { process.stdout.write(`${ESC}[${row};${col}H`); }
function clearLine() { process.stdout.write(`${ESC}[2K`); }
function saveCursor() { process.stdout.write(`${ESC}7`); }
function restoreCursor() { process.stdout.write(`${ESC}8`); }

function setScrollRegion(top: number, bottom: number) {
  process.stdout.write(`${ESC}[${top};${bottom}r`);
}

function resetScrollRegion() {
  process.stdout.write(`${ESC}[r`);
}

// ─── Screen Layout ───────────────────────────────────────────
// Row 1...(rows-2): scrollable output
// Row (rows-1): separator
// Row rows: input bar

function drawSeparator() {
  const row = getRows() - 1;
  saveCursor();
  moveTo(row, 1);
  clearLine();
  process.stdout.write(`${c.gray}${"─".repeat(getCols())}${c.reset}`);
  restoreCursor();
}

function drawInputBar() {
  const row = getRows();
  saveCursor();
  moveTo(row, 1);
  clearLine();
  if (agentRunning) {
    process.stdout.write(`${c.bold}${c.green}❯${c.reset} ${c.gray}${inputBuffer}${c.reset}`);
  } else {
    process.stdout.write(`${c.bold}${c.green}❯${c.reset} ${inputBuffer}`);
  }
  restoreCursor();
}

function writeOutput(text: string) {
  // Write to scroll region (cursor stays in output area)
  saveCursor();
  const outputBottom = getRows() - 2;
  moveTo(outputBottom, 1);
  process.stdout.write(text);
  restoreCursor();
}

function printLine(text: string) {
  // Move to bottom of scroll region and print (auto-scrolls)
  const outputBottom = getRows() - 2;
  setScrollRegion(1, outputBottom);
  moveTo(outputBottom, 1);
  console.log(text);
  // Reset and redraw fixed elements
  drawSeparator();
  drawInputBar();
}

function printInline(text: string) {
  const outputBottom = getRows() - 2;
  setScrollRegion(1, outputBottom);
  moveTo(outputBottom, 1);
  process.stdout.write(text);
  drawSeparator();
  drawInputBar();
}

// ─── LLM ─────────────────────────────────────────────────────

const baseURL = process.env.OPENAI_BASE_URL ?? "https://openrouter.ai/api/v1";
const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  console.error(`Set OPENAI_API_KEY or OPENROUTER_API_KEY in .env`);
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
    try { const output = execSync(args.command as string, { encoding: "utf-8", timeout: 10_000 }); return { success: true, content: output }; }
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
    const updatedMessages: Message[] = [
      ...request.messages,
      { role: "user", content: `[User interjection]: ${extra}` },
    ];

    printLine(`  ${c.yellow}↳ injecting your message into conversation${c.reset}`);

    return {
      action: "modify" as const,
      data: { request: { ...request, messages: updatedMessages } },
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
      "the next tool.\n\n" +
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

let inputBuffer = "";
let agentRunning = false;
let history: Message[] = [];
let streamBuffer = "";

// ─── Input Handler ───────────────────────────────────────────

function setupInput() {
  if (!process.stdin.isTTY) return;

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf-8");

  process.stdin.on("data", (key: string) => {
    if (key === "\x03") { // Ctrl+C
      resetScrollRegion();
      moveTo(getRows(), 1);
      console.log("");
      process.exit(0);
    }

    if (key === "\r" || key === "\n") {
      const text = inputBuffer.trim();
      inputBuffer = "";
      drawInputBar();

      if (!text) return;

      if (text === "/exit") {
        resetScrollRegion();
        moveTo(getRows(), 1);
        console.log("");
        process.exit(0);
      }

      if (text === "/clear") {
        history = [];
        pendingMessages.length = 0;
        printLine(`  ${c.gray}(conversation cleared)${c.reset}`);
        return;
      }

      if (agentRunning) {
        pendingMessages.push(text);
        printLine(`  ${c.gray}(queued: "${text}")${c.reset}`);
        return;
      }

      printLine(`${c.bold}${c.green}You:${c.reset} ${text}`);
      runAgent(text);
      return;
    }

    if (key === "\x7f" || key === "\b") {
      if (inputBuffer.length > 0) {
        inputBuffer = inputBuffer.slice(0, -1);
        drawInputBar();
      }
      return;
    }

    if (key.startsWith("\x1b")) return;

    inputBuffer += key;
    drawInputBar();
  });
}

// ─── Agent Runner ────────────────────────────────────────────

async function runAgent(text: string) {
  agentRunning = true;
  drawInputBar();

  let lastEventType = "";
  const startTime = Date.now();
  streamBuffer = "";

  const onEvent = (event: LoopEvent) => {
    switch (event.type) {
      case "text:delta":
        if (lastEventType !== "text:delta") {
          if (streamBuffer) {
            printLine(streamBuffer);
            streamBuffer = "";
          }
          streamBuffer = "";
        }
        streamBuffer += event.text;
        // Print complete lines, keep partial in buffer
        const lines = streamBuffer.split("\n");
        while (lines.length > 1) {
          printLine(lines.shift()!);
        }
        streamBuffer = lines[0];
        lastEventType = "text:delta";
        break;

      case "tool:start": {
        if (streamBuffer) {
          printLine(streamBuffer);
          streamBuffer = "";
        }
        const args = Object.entries(event.args)
          .map(([k, v]) => {
            const val = typeof v === "string" && v.length > 40 ? v.slice(0, 40) + "…" : String(v);
            return `${k}=${val}`;
          })
          .join(", ");
        printLine(`  ${c.green}●${c.reset} ${c.bold}${event.name}${c.reset}(${c.gray}${args}${c.reset})`);
        printLine(`  ${c.gray}└ Running…${c.reset}`);
        lastEventType = "tool:start";
        break;
      }

      case "tool:end":
        if (event.result.success) {
          const preview = event.result.content.split("\n")[0].slice(0, 50);
          printLine(`  ${c.gray}└ ${c.green}Done${c.reset}${preview ? ` ${c.gray}(${preview})${c.reset}` : ""}`);
        } else {
          const err = event.result.content.split("\n")[0].slice(0, 50);
          printLine(`  ${c.gray}└ ${c.red}Failed${c.reset} ${c.gray}(${err})${c.reset}`);
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

    // Flush remaining stream buffer
    if (streamBuffer) {
      printLine(streamBuffer);
      streamBuffer = "";
    }

    if (!result.output.length) {
      printLine(`${c.gray}(no response)${c.reset}`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const { input: tokIn, output: tokOut } = result.totalTokens;
    printLine("");
    printLine(
      `  ${c.gray}${result.iterations} iteration${result.iterations !== 1 ? "s" : ""} · ` +
      `↑ ${tokIn} · ↓ ${tokOut} · ` +
      `${tokIn + tokOut} tokens · ${elapsed}s${c.reset}`
    );
  } catch (err) {
    printLine(`  ${c.red}Error: ${err instanceof Error ? err.message : String(err)}${c.reset}`);
  }

  agentRunning = false;
  printLine(`${c.gray}${"─".repeat(getCols())}${c.reset}`);
  drawInputBar();
}

// ─── Bootstrap ───────────────────────────────────────────────

process.stdout.write(`${ESC}[2J${ESC}[H`); // Clear screen

// Header
console.log("");
console.log(`  ${c.bold}${c.cyan}awesome-agent${c.reset} ${c.gray}(${model})${c.reset}`);
console.log(`  ${c.gray}/clear · /exit · Ctrl+C · type while agent works${c.reset}`);
console.log(`${c.gray}${"─".repeat(getCols())}${c.reset}`);
console.log("");

// Set up scroll region (output area = row 1 to rows-2)
setScrollRegion(1, getRows() - 2);
moveTo(getRows() - 2, 1);

// Draw fixed bottom elements
drawSeparator();
drawInputBar();

// Handle terminal resize
process.stdout.on("resize", () => {
  setScrollRegion(1, getRows() - 2);
  drawSeparator();
  drawInputBar();
});

setupInput();
