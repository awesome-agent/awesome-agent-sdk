import { describe, it, expect } from "vitest";
import { MockLLMAdapter } from "../../src/llm/mock-adapter.js";
import type { LLMRequest } from "../../src/llm/types.js";

const baseRequest: LLMRequest = {
  model: "test",
  systemPrompt: "sys",
  messages: [{ role: "user", content: "hi" }],
};

describe("MockLLMAdapter", () => {
  it("returns queued text response", async () => {
    const mock = new MockLLMAdapter();
    mock.addResponse({ text: "hello" });

    const stream = await mock.stream(baseRequest);
    const events = [];
    for await (const e of stream) {
      events.push(e);
    }

    expect(events[0]).toEqual({ type: "text-delta", text: "hello" });
    expect(events[1].type).toBe("finish");
  });

  it("returns queued tool call response", async () => {
    const mock = new MockLLMAdapter();
    mock.addResponse({
      toolCalls: [{ id: "tc1", name: "read", args: { path: "/a" } }],
    });

    const stream = await mock.stream(baseRequest);
    const events = [];
    for await (const e of stream) {
      events.push(e);
    }

    expect(events[0]).toEqual({
      type: "tool-call",
      id: "tc1",
      name: "read",
      args: { path: "/a" },
    });
  });

  it("finishReason defaults based on response content", async () => {
    const mock = new MockLLMAdapter();
    mock.addResponse({ text: "hi" });
    mock.addResponse({
      toolCalls: [{ id: "tc1", name: "t", args: {} }],
    });

    // Text-only → stop
    const s1 = await mock.stream(baseRequest);
    for await (const _ of s1) {}
    expect(await s1.finishReason).toBe("stop");

    // Tool calls → tool_calls
    const s2 = await mock.stream(baseRequest);
    for await (const _ of s2) {}
    expect(await s2.finishReason).toBe("tool_calls");
  });

  it("tracks all requests", async () => {
    const mock = new MockLLMAdapter();
    mock.addResponse({ text: "1" });
    mock.addResponse({ text: "2" });

    const req1 = { ...baseRequest, model: "model-a" };
    const req2 = { ...baseRequest, model: "model-b" };

    const s1 = await mock.stream(req1);
    for await (const _ of s1) {}
    const s2 = await mock.stream(req2);
    for await (const _ of s2) {}

    expect(mock.requests).toHaveLength(2);
    expect(mock.requests[0].model).toBe("model-a");
    expect(mock.requests[1].model).toBe("model-b");
  });

  it("throws when no response queued", async () => {
    const mock = new MockLLMAdapter();

    await expect(mock.stream(baseRequest)).rejects.toThrow(
      "MockLLMAdapter: no response queued at index 0"
    );
  });

  it("fluent addResponse chaining", () => {
    const mock = new MockLLMAdapter();
    const result = mock.addResponse({ text: "a" }).addResponse({ text: "b" });
    expect(result).toBe(mock);
  });

  it("custom usage and finishReason", async () => {
    const mock = new MockLLMAdapter();
    mock.addResponse({
      text: "hi",
      usage: { inputTokens: 100, outputTokens: 50 },
      finishReason: "length",
    });

    const stream = await mock.stream(baseRequest);
    for await (const _ of stream) {}

    expect(await stream.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(await stream.finishReason).toBe("length");
  });
});
