import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AnthropicAdapter } from "../src/anthropic-adapter.js";
import { sseEvent, makeSSEBody } from "./helpers/sse.js";
import type { LLMRequest, StreamEvent } from "@awesome-agent/agent-core";

function mockFetchResponse(chunks: string[], status = 200): Response {
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
  model: "claude-sonnet-4-20250514",
  systemPrompt: "You are helpful.",
  messages: [{ role: "user", content: "hello" }],
  temperature: 0.7,
};

describe("AnthropicAdapter", () => {
  let adapter: AnthropicAdapter;

  beforeEach(() => {
    adapter = new AnthropicAdapter({ apiKey: "test-key" });
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it("streams text response", async () => {
    const chunks = [
      sseEvent({ type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 0 } } }),
      sseEvent({ type: "content_block_start", index: 0, content_block: { type: "text" } }),
      sseEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } }),
      sseEvent({ type: "content_block_stop", index: 0 }),
      sseEvent({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } }),
      sseEvent({ type: "message_stop" }),
    ];

    vi.stubGlobal("fetch", async () => mockFetchResponse(chunks));

    const stream = await adapter.stream(baseRequest);
    const events: StreamEvent[] = [];
    for await (const e of stream) { events.push(e); }

    expect(events[0]).toEqual({ type: "text-delta", text: "Hi" });

    const finish = events.find((e) => e.type === "finish")!;
    if (finish.type === "finish") {
      expect(finish.reason).toBe("stop");
      expect(finish.usage).toEqual({ inputTokens: 10, outputTokens: 3 });
    }
  });

  it("sends correct request body", async () => {
    let capturedBody: Record<string, unknown> = {};

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return mockFetchResponse([
        sseEvent({ type: "message_start", message: { usage: { input_tokens: 0, output_tokens: 0 } } }),
        sseEvent({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 0 } }),
        sseEvent({ type: "message_stop" }),
      ]);
    });

    const stream = await adapter.stream({
      ...baseRequest,
      tools: [{ name: "read", description: "Read file", parameters: { type: "object" } }],
      maxTokens: 1000,
    });
    for await (const _ of stream) {}

    expect(capturedBody.model).toBe("claude-sonnet-4-20250514");
    expect(capturedBody.system).toBe("You are helpful.");
    expect(capturedBody.stream).toBe(true);
    expect(capturedBody.max_tokens).toBe(1000);
    expect(capturedBody.tools).toHaveLength(1);
    // System should NOT be in messages
    const msgs = capturedBody.messages as Array<Record<string, unknown>>;
    expect(msgs.every((m) => m.role !== "system")).toBe(true);
  });

  it("sends x-api-key and anthropic-version headers", async () => {
    let capturedHeaders: Record<string, string> = {};

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      capturedHeaders = Object.fromEntries(
        Object.entries(init.headers as Record<string, string>)
      );
      return mockFetchResponse([
        sseEvent({ type: "message_start", message: { usage: { input_tokens: 0, output_tokens: 0 } } }),
        sseEvent({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 0 } }),
        sseEvent({ type: "message_stop" }),
      ]);
    });

    const s = await adapter.stream(baseRequest);
    for await (const _ of s) {}

    expect(capturedHeaders["x-api-key"]).toBe("test-key");
    expect(capturedHeaders["anthropic-version"]).toBe("2023-06-01");
  });

  it("throws LLMRequestError on non-OK response", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    }));

    const { LLMRequestError } = await import("@awesome-agent/agent-core");
    try {
      await adapter.stream(baseRequest);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(LLMRequestError);
      expect((e as InstanceType<typeof LLMRequestError>).statusCode).toBe(429);
    }
  });

  it("converts tool messages to tool_result format", async () => {
    let capturedBody: { messages: Array<Record<string, unknown>> } = { messages: [] };

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return mockFetchResponse([
        sseEvent({ type: "message_start", message: { usage: { input_tokens: 0, output_tokens: 0 } } }),
        sseEvent({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 0 } }),
        sseEvent({ type: "message_stop" }),
      ]);
    });

    const s = await adapter.stream({
      model: "claude-sonnet-4-20250514",
      systemPrompt: "sys",
      messages: [
        { role: "user", content: "read file" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "I'll read it" },
            { type: "tool_call", id: "tc1", name: "read", args: { path: "/a" } },
          ],
        },
        { role: "tool", toolCallId: "tc1", content: "file content" },
      ],
    });
    for await (const _ of s) {}

    const msgs = capturedBody.messages;
    // user + assistant + tool_result(as user) = 3
    expect(msgs).toHaveLength(3);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
    // Tool result is a user message in Anthropic format
    expect(msgs[2].role).toBe("user");
    const content = msgs[2].content as Array<Record<string, unknown>>;
    expect(content[0].type).toBe("tool_result");
    expect(content[0].tool_use_id).toBe("tc1");
  });

  it("uses custom baseURL", async () => {
    let capturedUrl = "";

    vi.stubGlobal("fetch", async (url: string) => {
      capturedUrl = url;
      return mockFetchResponse([
        sseEvent({ type: "message_start", message: { usage: { input_tokens: 0, output_tokens: 0 } } }),
        sseEvent({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 0 } }),
        sseEvent({ type: "message_stop" }),
      ]);
    });

    const customAdapter = new AnthropicAdapter({
      apiKey: "key",
      baseURL: "https://my-proxy.com",
    });

    const s = await customAdapter.stream(baseRequest);
    for await (const _ of s) {}

    expect(capturedUrl).toBe("https://my-proxy.com/v1/messages");
  });
});
