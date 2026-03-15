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
  description: "Evaluate a math expression and return the result",
  parameters: {
    type: "object",
    properties: { expression: { type: "string", description: "Math expression to evaluate" } },
    required: ["expression"],
  },
  execute: async (args) => {
    try {
      const expr = String(args.expression);
      // Only allow numbers, operators, parentheses, whitespace, and decimal points
      if (!/^[\d+\-*/().%\s]+$/.test(expr)) {
        return { success: false, content: "Invalid expression: only numbers and math operators allowed" };
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
  description: "Get current weather for a city (mock data)",
  parameters: {
    type: "object",
    properties: { city: { type: "string", description: "City name" } },
    required: ["city"],
  },
  execute: async (args) => {
    const temps: Record<string, number> = {
      istanbul: 18, london: 12, tokyo: 22, "new york": 15, berlin: 10, paris: 14,
    };
    const city = (args.city as string).toLowerCase();
    const temp = temps[city] ?? Math.floor(Math.random() * 30);
    return { success: true, content: `${args.city}: ${temp}°C, partly cloudy` };
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
              "You are a helpful assistant in a web chat. You can calculate math " +
              "expressions and check weather. Be concise and friendly.",
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
