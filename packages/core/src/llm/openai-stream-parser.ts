// llm/openai-stream-parser.ts
// Parses OpenAI-compatible SSE stream chunks into agent-core StreamEvents

import type { StreamEvent, FinishReason } from "./types.js";
import { parseSSEStream } from "./sse-parser.js";

// ─── Finish Reason Mapping ──────────────────────────────────

function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case "stop":
      return "stop";
    case "tool_calls":
      return "tool_calls";
    case "length":
      return "length";
    default:
      return "error";
  }
}

// ─── Stream Parser ──────────────────────────────────────────

interface ToolCallState {
  id: string;
  name: string;
  args: string;
}

export class OpenAIStreamParser {
  async *parse(body: ReadableStream<Uint8Array>): AsyncIterable<StreamEvent> {
    const pendingToolCalls = new Map<number, ToolCallState>();
    let finishReason = "stop";
    let finishEmitted = false;

    for await (const data of parseSSEStream(body)) {
      let chunk: Record<string, unknown>;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }

      // Process delta events
      yield* this.processChunkDelta(chunk, pendingToolCalls);

      // Track finish reason
      const choice = (chunk.choices as Record<string, unknown>[] | undefined)?.[0];
      if ((choice as Record<string, unknown> | undefined)?.finish_reason) {
        finishReason = (choice as Record<string, unknown>).finish_reason as string;
      }

      // Emit finish when usage arrives (stream_options.include_usage)
      if (chunk.usage) {
        finishEmitted = true;
        const usage = chunk.usage as Record<string, number>;
        yield {
          type: "finish",
          reason: mapFinishReason(finishReason),
          usage: {
            inputTokens: usage.prompt_tokens ?? 0,
            outputTokens: usage.completion_tokens ?? 0,
          },
        };
      }
    }

    // Fallback: provider didn't send usage (no stream_options support)
    if (!finishEmitted) {
      yield {
        type: "finish",
        reason: mapFinishReason(finishReason),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
  }

  private *processChunkDelta(
    chunk: Record<string, unknown>,
    toolCalls: Map<number, ToolCallState>
  ): Iterable<StreamEvent> {
    const choice = (chunk.choices as Record<string, unknown>[] | undefined)?.[0] as
      | Record<string, unknown>
      | undefined;
    if (!choice?.delta) return;

    const delta = choice.delta as Record<string, unknown>;

    // Text content
    if (delta.content) {
      yield { type: "text-delta", text: delta.content as string };
    }

    // Tool call deltas
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls as Record<string, unknown>[]) {
        if (tc.id) {
          // New tool call starting
          const fn = tc.function as Record<string, string> | undefined;
          toolCalls.set(tc.index as number, {
            id: tc.id as string,
            name: fn?.name ?? "",
            args: fn?.arguments ?? "",
          });
          yield {
            type: "tool-call-start",
            id: tc.id as string,
            name: fn?.name ?? "",
          };
        } else {
          // Argument chunk for existing tool call
          const state = toolCalls.get(tc.index as number);
          const fn = tc.function as Record<string, string> | undefined;
          if (state && fn?.arguments) {
            state.args += fn.arguments;
            yield {
              type: "tool-call-delta",
              id: state.id,
              args: fn.arguments,
            };
          }
        }
      }
    }

    // On finish_reason, emit completed tool-call events
    if (choice.finish_reason) {
      for (const [, state] of toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(state.args || "{}");
        } catch {
          // malformed args — keep empty
        }
        yield { type: "tool-call", id: state.id, name: state.name, args };
      }
      toolCalls.clear();
    }
  }
}
