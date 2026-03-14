import { describe, it, expect } from "vitest";
import { DefaultLLMStream } from "../../src/llm/stream.js";
import type { StreamEvent } from "../../src/llm/types.js";

async function* generate(
  events: StreamEvent[]
): AsyncIterable<StreamEvent> {
  for (const e of events) {
    yield e;
  }
}

describe("DefaultLLMStream", () => {
  it("iterates stream events", async () => {
    const events: StreamEvent[] = [
      { type: "text-delta", text: "hello" },
      { type: "text-delta", text: " world" },
      {
        type: "finish",
        reason: "stop",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ];

    const stream = new DefaultLLMStream(generate(events));
    const collected: StreamEvent[] = [];

    for await (const event of stream) {
      collected.push(event);
    }

    expect(collected).toHaveLength(3);
    expect(collected[0]).toEqual({ type: "text-delta", text: "hello" });
  });

  it("resolves usage and finishReason from finish event", async () => {
    const stream = new DefaultLLMStream(
      generate([
        { type: "text-delta", text: "hi" },
        {
          type: "finish",
          reason: "tool_calls",
          usage: { inputTokens: 50, outputTokens: 20 },
        },
      ])
    );

    // Consume stream
    for await (const _ of stream) {
      // drain
    }

    const usage = await stream.usage;
    const reason = await stream.finishReason;

    expect(usage).toEqual({ inputTokens: 50, outputTokens: 20 });
    expect(reason).toBe("tool_calls");
  });

  it("provides fallback defaults when no finish event", async () => {
    const stream = new DefaultLLMStream(
      generate([{ type: "text-delta", text: "no finish" }])
    );

    for await (const _ of stream) {
      // drain
    }

    const usage = await stream.usage;
    const reason = await stream.finishReason;

    expect(usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(reason).toBe("error");
  });

  it("throws on second iteration attempt", async () => {
    const stream = new DefaultLLMStream(
      generate([
        {
          type: "finish",
          reason: "stop",
          usage: { inputTokens: 0, outputTokens: 0 },
        },
      ])
    );

    // First iteration
    for await (const _ of stream) {
      // drain
    }

    // Second iteration should throw
    expect(() => {
      stream[Symbol.asyncIterator]();
    }).toThrow("LLMStream can only be iterated once");
  });
});
