import { describe, it, expect } from "vitest";
import { OpenAIStreamParser } from "../src/openai-stream-parser.js";
import type { StreamEvent } from "@algomim/agent-core";

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

async function collectEvents(
  chunks: string[]
): Promise<StreamEvent[]> {
  const parser = new OpenAIStreamParser();
  const events: StreamEvent[] = [];
  for await (const e of parser.parse(makeSSEBody(chunks))) {
    events.push(e);
  }
  return events;
}

// ─── Tests ───────────────────────────────────────────────────

describe("OpenAIStreamParser", () => {
  it("parses text-delta events", async () => {
    const events = await collectEvents([
      sseChunk({
        choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
      }),
      sseChunk({
        choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }],
      }),
      sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      }),
      sseChunk({ usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    ]);

    const deltas = events.filter((e) => e.type === "text-delta");
    expect(deltas).toHaveLength(2);
    expect(deltas[0].type === "text-delta" && deltas[0].text).toBe("Hello");
    expect(deltas[1].type === "text-delta" && deltas[1].text).toBe(" world");
  });

  it("parses tool-call with argument accumulation", async () => {
    const events = await collectEvents([
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
      sseChunk({ usage: { prompt_tokens: 20, completion_tokens: 10 } }),
    ]);

    const start = events.find((e) => e.type === "tool-call-start");
    expect(start).toEqual({ type: "tool-call-start", id: "tc1", name: "read" });

    const delta = events.find((e) => e.type === "tool-call-delta");
    expect(delta).toBeDefined();
    if (delta?.type === "tool-call-delta") {
      expect(delta.id).toBe("tc1");
      expect(delta.args).toBe('th":"/a"}');
    }

    const completed = events.find((e) => e.type === "tool-call");
    expect(completed).toEqual({
      type: "tool-call",
      id: "tc1",
      name: "read",
      args: { path: "/a" },
    });
  });

  it("handles multiple simultaneous tool calls", async () => {
    const events = await collectEvents([
      sseChunk({
        choices: [{
          index: 0,
          delta: {
            tool_calls: [
              { index: 0, id: "tc1", type: "function", function: { name: "read", arguments: '{"p":1}' } },
              { index: 1, id: "tc2", type: "function", function: { name: "write", arguments: '{"p":2}' } },
            ],
          },
          finish_reason: null,
        }],
      }),
      sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      }),
      sseChunk({ usage: { prompt_tokens: 0, completion_tokens: 0 } }),
    ]);

    const completed = events.filter((e) => e.type === "tool-call");
    expect(completed).toHaveLength(2);
    expect(completed[0]).toMatchObject({ name: "read", args: { p: 1 } });
    expect(completed[1]).toMatchObject({ name: "write", args: { p: 2 } });
  });

  it("maps finish reasons correctly", async () => {
    const testCases: Array<{ reason: string; expected: string }> = [
      { reason: "stop", expected: "stop" },
      { reason: "tool_calls", expected: "tool_calls" },
      { reason: "length", expected: "length" },
      { reason: "content_filter", expected: "error" },
      { reason: "unknown", expected: "error" },
    ];

    for (const { reason, expected } of testCases) {
      const events = await collectEvents([
        sseChunk({
          choices: [{ index: 0, delta: {}, finish_reason: reason }],
        }),
        sseChunk({ usage: { prompt_tokens: 0, completion_tokens: 0 } }),
      ]);

      const finish = events.find((e) => e.type === "finish");
      expect(finish).toBeDefined();
      if (finish?.type === "finish") {
        expect(finish.reason).toBe(expected);
      }
    }
  });

  it("emits finish with usage data", async () => {
    const events = await collectEvents([
      sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      }),
      sseChunk({ usage: { prompt_tokens: 150, completion_tokens: 80 } }),
    ]);

    const finish = events.find((e) => e.type === "finish");
    expect(finish).toBeDefined();
    if (finish?.type === "finish") {
      expect(finish.usage).toEqual({ inputTokens: 150, outputTokens: 80 });
    }
  });

  it("emits fallback finish when no usage chunk received", async () => {
    const events = await collectEvents([
      sseChunk({
        choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }],
      }),
      sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      }),
      "data: [DONE]\n\n",
    ]);

    const finish = events.find((e) => e.type === "finish");
    expect(finish).toBeDefined();
    if (finish?.type === "finish") {
      expect(finish.reason).toBe("stop");
      expect(finish.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    }
  });

  it("handles malformed JSON gracefully", async () => {
    const events = await collectEvents([
      "data: {invalid json}\n\n",
      sseChunk({
        choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }],
      }),
      sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      }),
      sseChunk({ usage: { prompt_tokens: 0, completion_tokens: 0 } }),
    ]);

    // Should skip malformed chunk and continue
    const deltas = events.filter((e) => e.type === "text-delta");
    expect(deltas).toHaveLength(1);
    expect(deltas[0].type === "text-delta" && deltas[0].text).toBe("ok");
  });

  it("handles malformed tool-call arguments", async () => {
    const events = await collectEvents([
      sseChunk({
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              id: "tc1",
              type: "function",
              function: { name: "broken", arguments: "{not valid json" },
            }],
          },
          finish_reason: null,
        }],
      }),
      sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      }),
      sseChunk({ usage: { prompt_tokens: 0, completion_tokens: 0 } }),
    ]);

    const completed = events.find((e) => e.type === "tool-call");
    expect(completed).toBeDefined();
    if (completed?.type === "tool-call") {
      // Malformed args fall back to empty object
      expect(completed.args).toEqual({});
    }
  });

  it("skips chunks without choices", async () => {
    const events = await collectEvents([
      sseChunk({}), // no choices
      sseChunk({
        choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }],
      }),
      sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      }),
      sseChunk({ usage: { prompt_tokens: 0, completion_tokens: 0 } }),
    ]);

    const deltas = events.filter((e) => e.type === "text-delta");
    expect(deltas).toHaveLength(1);
  });

  it("handles [DONE] marker", async () => {
    const events = await collectEvents([
      sseChunk({
        choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }],
      }),
      sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      }),
      sseChunk({ usage: { prompt_tokens: 5, completion_tokens: 3 } }),
      "data: [DONE]\n\n",
    ]);

    const finish = events.find((e) => e.type === "finish");
    expect(finish).toBeDefined();
    if (finish?.type === "finish") {
      expect(finish.reason).toBe("stop");
    }
  });
});
