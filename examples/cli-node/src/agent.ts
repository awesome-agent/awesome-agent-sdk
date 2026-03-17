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

tools.register({
  name: "get_weather",
  description: "Get current real weather for a city",
  parameters: {
    type: "object",
    properties: { city: { type: "string", description: "City name (e.g. Istanbul, London, Tokyo)" } },
    required: ["city"],
  },
  execute: async (args) => {
    try {
      const city = encodeURIComponent(args.city as string);
      const res = await fetch(`https://wttr.in/${city}?format=%C+%t+%h+%w&lang=en`);
      if (!res.ok) return { success: false, content: `Weather API error: ${res.status}` };
      const text = await res.text();
      return { success: true, content: `${args.city}: ${text.trim()}` };
    } catch (e) { return { success: false, content: `${e}` }; }
  },
});

tools.register({
  name: "web_search",
  description: "Search the web and return top results with titles, URLs and snippets",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "Search query" } },
    required: ["query"],
  },
  execute: async (args) => {
    try {
      const q = encodeURIComponent(args.query as string);
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
        headers: { "User-Agent": "awesome-agent/0.1" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { success: false, content: `Search error: ${res.status}` };
      const html = await res.text();
      // Extract results from DDG HTML
      const results: string[] = [];
      const regex = /<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>(.+?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      let match;
      while ((match = regex.exec(html)) !== null && results.length < 5) {
        const url = match[1].replace(/.*uddg=([^&]+).*/, (_, u) => decodeURIComponent(u));
        const title = match[2].replace(/<[^>]+>/g, "").trim();
        const snippet = match[3].replace(/<[^>]+>/g, "").trim();
        results.push(`${title}\n${url}\n${snippet}`);
      }
      if (results.length === 0) return { success: false, content: "No results found" };
      return { success: true, content: results.join("\n\n") };
    } catch (e) { return { success: false, content: `${e}` }; }
  },
});

tools.register({
  name: "web_fetch",
  description: "Fetch a URL and return the text content (max 5000 chars)",
  parameters: {
    type: "object",
    properties: { url: { type: "string", description: "URL to fetch" } },
    required: ["url"],
  },
  execute: async (args) => {
    try {
      const res = await fetch(args.url as string, {
        headers: { "User-Agent": "awesome-agent/0.1" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { success: false, content: `HTTP ${res.status}` };
      const text = await res.text();
      return { success: true, content: text.slice(0, 5000) };
    } catch (e) { return { success: false, content: `${e}` }; }
  },
});

tools.register({
  name: "calculate",
  description: "Evaluate a math expression (e.g. 42 * 17 + 100)",
  parameters: {
    type: "object",
    properties: { expression: { type: "string", description: "Math expression" } },
    required: ["expression"],
  },
  execute: async (args) => {
    try {
      const expr = String(args.expression);
      if (!/^[\d+\-*/().%\s]+$/.test(expr)) {
        return { success: false, content: "Invalid: only numbers and math operators allowed" };
      }
      const result = new Function(`"use strict"; return (${expr})`)();
      return { success: true, content: String(result) };
    } catch (e) { return { success: false, content: `${e}` }; }
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
  onEvent: (event: LoopEvent) => void,
  abort?: AbortSignal
) {
  const config = {
    llm,
    agent: {
      id: "cli-agent",
      name: "CLI Agent",
      prompt:
        "You are a helpful terminal assistant. You can read/write files, " +
        "list directories, run commands, check real weather, search the web, " +
        "fetch web pages, and calculate math. Be concise.\n\n" +
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
  const result = await loop.run(input, "cli-session", { history, abort });
  history = [...result.messages];
  return result;
}
