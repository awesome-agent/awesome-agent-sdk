// POST /api/chat — runs AgenticLoop and streams LoopEvents via SSE

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

// ─── Config ─────────────────────────────────────────────────────

const baseURL = process.env.OPENAI_BASE_URL ?? "https://openrouter.ai/api/v1";
const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY ?? "";
const model = process.env.MODEL ?? "openai/gpt-4o";

const llm = new RetryLLMAdapter(
  new OpenAIAdapter({ baseURL, apiKey }),
  { maxRetries: 2 },
);

// ─── Tools ──────────────────────────────────────────────────────

const tools = new DefaultToolRegistry();

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
    } catch (e) {
      return { success: false, content: `${e}` };
    }
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

// ─── Session History (in-memory for demo) ───────────────────────

const sessions = new Map<string, Message[]>();

// ─── Route Handler ──────────────────────────────────────────────

export async function POST(req: Request) {
  const body = await req.json();
  const { message, sessionId = "default" } = body;

  if (!message) {
    return new Response(JSON.stringify({ error: "message required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "API key not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const history = sessions.get(sessionId) ?? [];

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const onEvent = (event: LoopEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const config = {
          llm,
          agent: {
            id: "web-agent",
            name: "Web Agent",
            prompt:
              "You are a helpful assistant in a web chat. You can calculate math, " +
              "check real weather, search the web, and fetch web pages. Be concise and friendly.",
            model,
            maxIterations: 10,
          },
          tools,
          executor: new DefaultToolExecutor(tools),
          hooks: new DefaultHookManager(),
          context: new DefaultContextBuilder(),
          onEvent,
        };

        const loop = new AgenticLoop(config);
        const result = await loop.run(message, sessionId, { history });
        sessions.set(sessionId, [...result.messages]);

        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", error })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
