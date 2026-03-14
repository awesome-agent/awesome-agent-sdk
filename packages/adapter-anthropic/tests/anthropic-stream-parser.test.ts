import { describe, it, expect } from "vitest";
import { AnthropicStreamParser } from "../src/anthropic-stream-parser.js";
import { sseEvent, makeSSEBody } from "./helpers/sse.js";
import type { StreamEvent } from "@awesome-agent/agent-core";

async function collectEvents(chunks: string[]): Promise<StreamEvent[]> {
  const parser = new AnthropicStreamParser();
  const events: StreamEvent[] = [];
  for await (const e of parser.parse(makeSSEBody(chunks))) {
    events.push(e);
  }
  return events;
}

describe("AnthropicStreamParser", () => {
  it("parses text-delta events", async () => {
    const events = await collectEvents([
      sseEvent({
        type: "message_start",
        message: { usage: { input_tokens: 10, output_tokens: 0 } },
      }),
      sseEvent({ type: "content_block_start", index: 0, content_block: { type: "text" } }),
      sseEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } }),
      sseEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } }),
      sseEvent({ type: "content_block_stop", index: 0 }),
      sseEvent({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }),
      sseEvent({ type: "message_stop" }),
    ]);

    const deltas = events.filter((e) => e.type === "text-delta");
    expect(deltas).toHaveLength(2);
    expect(deltas[0].type === "text-delta" && deltas[0].text).toBe("Hello");
    expect(deltas[1].type === "text-delta" && deltas[1].text).toBe(" world");
  });

  it("parses tool-call with argument accumulation", async () => {
    const events = await collectEvents([
      sseEvent({
        type: "message_start",
        message: { usage: { input_tokens: 20, output_tokens: 0 } },
      }),
      sseEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tc1", name: "read_file" },
      }),
      sseEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"pa' },
      }),
      sseEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: 'th":"/a"}' },
      }),
      sseEvent({ type: "content_block_stop", index: 0 }),
      sseEvent({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 10 } }),
      sseEvent({ type: "message_stop" }),
    ]);

    const start = events.find((e) => e.type === "tool-call-start");
    expect(start).toEqual({ type: "tool-call-start", id: "tc1", name: "read_file" });

    const completed = events.find((e) => e.type === "tool-call");
    expect(completed).toEqual({
      type: "tool-call",
      id: "tc1",
      name: "read_file",
      args: { path: "/a" },
    });
  });

  it("maps stop reasons correctly", async () => {
    const testCases = [
      { stop: "end_turn", expected: "stop" },
      { stop: "tool_use", expected: "tool_calls" },
      { stop: "max_tokens", expected: "length" },
      { stop: "unknown", expected: "error" },
    ];

    for (const { stop, expected } of testCases) {
      const events = await collectEvents([
        sseEvent({ type: "message_start", message: { usage: { input_tokens: 0, output_tokens: 0 } } }),
        sseEvent({ type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 0 } }),
        sseEvent({ type: "message_stop" }),
      ]);

      const finish = events.find((e) => e.type === "finish");
      expect(finish).toBeDefined();
      if (finish?.type === "finish") {
        expect(finish.reason).toBe(expected);
      }
    }
  });

  it("tracks usage from message_start and message_delta", async () => {
    const events = await collectEvents([
      sseEvent({
        type: "message_start",
        message: { usage: { input_tokens: 150, output_tokens: 0 } },
      }),
      sseEvent({ type: "content_block_start", index: 0, content_block: { type: "text" } }),
      sseEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } }),
      sseEvent({ type: "content_block_stop", index: 0 }),
      sseEvent({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 80 } }),
      sseEvent({ type: "message_stop" }),
    ]);

    const finish = events.find((e) => e.type === "finish");
    if (finish?.type === "finish") {
      expect(finish.usage.inputTokens).toBe(150);
      expect(finish.usage.outputTokens).toBe(80);
    }
  });

  it("handles multiple tool calls", async () => {
    const events = await collectEvents([
      sseEvent({ type: "message_start", message: { usage: { input_tokens: 0, output_tokens: 0 } } }),
      sseEvent({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tc1", name: "read" } }),
      sseEvent({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"p":1}' } }),
      sseEvent({ type: "content_block_stop", index: 0 }),
      sseEvent({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tc2", name: "write" } }),
      sseEvent({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"p":2}' } }),
      sseEvent({ type: "content_block_stop", index: 1 }),
      sseEvent({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 0 } }),
      sseEvent({ type: "message_stop" }),
    ]);

    const completed = events.filter((e) => e.type === "tool-call");
    expect(completed).toHaveLength(2);
    expect(completed[0]).toMatchObject({ name: "read", args: { p: 1 } });
    expect(completed[1]).toMatchObject({ name: "write", args: { p: 2 } });
  });

  it("handles malformed tool-call arguments", async () => {
    const events = await collectEvents([
      sseEvent({ type: "message_start", message: { usage: { input_tokens: 0, output_tokens: 0 } } }),
      sseEvent({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tc1", name: "broken" } }),
      sseEvent({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{bad json" } }),
      sseEvent({ type: "content_block_stop", index: 0 }),
      sseEvent({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 0 } }),
      sseEvent({ type: "message_stop" }),
    ]);

    const completed = events.find((e) => e.type === "tool-call");
    if (completed?.type === "tool-call") {
      expect(completed.args).toEqual({});
    }
  });

  it("handles malformed JSON gracefully", async () => {
    const events = await collectEvents([
      "data: {invalid json}\n\n",
      sseEvent({ type: "message_start", message: { usage: { input_tokens: 0, output_tokens: 0 } } }),
      sseEvent({ type: "content_block_start", index: 0, content_block: { type: "text" } }),
      sseEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } }),
      sseEvent({ type: "content_block_stop", index: 0 }),
      sseEvent({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 0 } }),
      sseEvent({ type: "message_stop" }),
    ]);

    const deltas = events.filter((e) => e.type === "text-delta");
    expect(deltas).toHaveLength(1);
  });
});
