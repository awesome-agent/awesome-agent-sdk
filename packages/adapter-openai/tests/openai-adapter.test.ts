import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAIAdapter } from "../src/openai-adapter.js";
import type { LLMRequest, StreamEvent } from "@algomim/agent-core";

function sseChunk(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function makeSSEBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function mockFetchResponse(
  chunks: string[],
  status = 200
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: makeSSEBody(chunks),
    text: async () => "error body",
    headers: new Headers(),
    redirected: false,
    statusText: "OK",
    type: "basic",
    url: "",
    clone: () => ({}) as Response,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    json: async () => ({}),
    bytes: async () => new Uint8Array(),
  } as Response;
}

const baseRequest: LLMRequest = {
  model: "gpt-4o",
  systemPrompt: "You are helpful.",
  messages: [{ role: "user", content: "hello" }],
  temperature: 0.7,
};

// ─── Tests ──────────────────────────────────────────────────

describe("OpenAIAdapter", () => {
  let adapter: OpenAIAdapter;

  beforeEach(() => {
    adapter = new OpenAIAdapter({
      baseURL: "https://api.test.com/v1",
      apiKey: "test-key",
    });
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it("streams text-delta events", async () => {
    const chunks = [
      sseChunk({
        choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
      }),
      sseChunk({
        choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }],
      }),
      sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      }),
      sseChunk({
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      "data: [DONE]\n\n",
    ];

    vi.stubGlobal("fetch", async () => mockFetchResponse(chunks));

    const stream = await adapter.stream(baseRequest);
    const events: StreamEvent[] = [];
    for await (const e of stream) {
      events.push(e);
    }

    expect(events[0]).toEqual({ type: "text-delta", text: "Hello" });
    expect(events[1]).toEqual({ type: "text-delta", text: " world" });

    const finish = events.find((e) => e.type === "finish")!;
    expect(finish.type).toBe("finish");
    if (finish.type === "finish") {
      expect(finish.reason).toBe("stop");
      expect(finish.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    }
  });

  it("streams tool-call events with argument accumulation", async () => {
    const chunks = [
      sseChunk({
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              id: "tc1",
              type: "function",
              function: { name: "read", arguments: '{"pa' },
            }],
          },
          finish_reason: null,
        }],
      }),
      sseChunk({
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: 'th":"/a"}' },
            }],
          },
          finish_reason: null,
        }],
      }),
      sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      }),
      sseChunk({
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      }),
    ];

    vi.stubGlobal("fetch", async () => mockFetchResponse(chunks));

    const stream = await adapter.stream(baseRequest);
    const events: StreamEvent[] = [];
    for await (const e of stream) {
      events.push(e);
    }

    // tool-call-start
    const start = events.find((e) => e.type === "tool-call-start");
    expect(start).toEqual({ type: "tool-call-start", id: "tc1", name: "read" });

    // tool-call (completed with accumulated args)
    const completed = events.find((e) => e.type === "tool-call");
    expect(completed).toEqual({
      type: "tool-call",
      id: "tc1",
      name: "read",
      args: { path: "/a" },
    });

    // finish reason
    const finish = events.find((e) => e.type === "finish")!;
    if (finish.type === "finish") {
      expect(finish.reason).toBe("tool_calls");
    }
  });

  it("sends correct request body", async () => {
    let capturedBody: Record<string, unknown> = {};

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return mockFetchResponse([
        sseChunk({
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        }),
        sseChunk({ usage: { prompt_tokens: 0, completion_tokens: 0 } }),
      ]);
    });

    const stream = await adapter.stream({
      ...baseRequest,
      tools: [{ name: "read", description: "Read file", parameters: { type: "object" } }],
      maxTokens: 1000,
    });
    for await (const _ of stream) {}

    expect(capturedBody.model).toBe("gpt-4o");
    expect(capturedBody.stream).toBe(true);
    expect(capturedBody.stream_options).toEqual({ include_usage: true });
    expect(capturedBody.tools).toHaveLength(1);
    expect(capturedBody.max_tokens).toBe(1000);
  });

  it("sends Authorization header with apiKey", async () => {
    let capturedHeaders: Record<string, string> = {};

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      capturedHeaders = Object.fromEntries(
        (init.headers as Record<string, string>) instanceof Headers
          ? (init.headers as Headers).entries()
          : Object.entries(init.headers as Record<string, string>)
      );
      return mockFetchResponse([
        sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
        sseChunk({ usage: { prompt_tokens: 0, completion_tokens: 0 } }),
      ]);
    });

    const s = await adapter.stream(baseRequest);
    for await (const _ of s) {}

    expect(capturedHeaders["Authorization"]).toBe("Bearer test-key");
  });

  it("throws on non-OK response", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    }));

    await expect(adapter.stream(baseRequest)).rejects.toThrow(
      "LLM request failed (429): rate limited"
    );
  });

  it("throws on null response body", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      body: null,
    }));

    await expect(adapter.stream(baseRequest)).rejects.toThrow(
      "Response body is null"
    );
  });

  it("emits fallback finish when no usage in stream", async () => {
    const chunks = [
      sseChunk({
        choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }],
      }),
      sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      }),
      "data: [DONE]\n\n",
      // No usage chunk
    ];

    vi.stubGlobal("fetch", async () => mockFetchResponse(chunks));

    const stream = await adapter.stream(baseRequest);
    const events: StreamEvent[] = [];
    for await (const e of stream) {
      events.push(e);
    }

    const finish = events.find((e) => e.type === "finish")!;
    if (finish.type === "finish") {
      expect(finish.reason).toBe("stop");
      expect(finish.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    }
  });

  it("converts internal messages to OpenAI format", async () => {
    let capturedBody: { messages: Array<Record<string, unknown>> } = { messages: [] };

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return mockFetchResponse([
        sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
        sseChunk({ usage: { prompt_tokens: 0, completion_tokens: 0 } }),
      ]);
    });

    const s = await adapter.stream({
      model: "gpt-4o",
      systemPrompt: "sys",
      messages: [
        { role: "user", content: "hello" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "I'll read" },
            { type: "tool_call", id: "tc1", name: "read", args: { path: "/a" } },
          ],
        },
        { role: "tool", toolCallId: "tc1", content: "file content" },
      ],
    });
    for await (const _ of s) {}

    const msgs = capturedBody.messages;
    // system + user + assistant + tool = 4
    expect(msgs).toHaveLength(4);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
    expect(msgs[2].role).toBe("assistant");
    expect(msgs[2].tool_calls).toHaveLength(1);
    expect(msgs[3].role).toBe("tool");
    expect(msgs[3].tool_call_id).toBe("tc1");
  });

  it("maps unknown finish_reason to error", async () => {
    const chunks = [
      sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "content_filter" }],
      }),
      sseChunk({ usage: { prompt_tokens: 0, completion_tokens: 0 } }),
    ];

    vi.stubGlobal("fetch", async () => mockFetchResponse(chunks));

    const stream = await adapter.stream(baseRequest);
    const events: StreamEvent[] = [];
    for await (const e of stream) {
      events.push(e);
    }

    const finish = events.find((e) => e.type === "finish")!;
    if (finish.type === "finish") {
      expect(finish.reason).toBe("error");
    }

  });
});
