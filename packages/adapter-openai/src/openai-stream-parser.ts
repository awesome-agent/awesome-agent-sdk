// Parses OpenAI-compatible SSE stream chunks into agent-core StreamEvents

import type { StreamEvent, FinishReason } from "@awesome-agent/agent-core";
import { parseSSEStream } from "@awesome-agent/agent-core";

// ─── OpenAI Wire Format (response) ──────────────────────────

interface OpenAIStreamChunk {
  readonly choices?: readonly {
    readonly index: number;
    readonly delta: {
      readonly role?: string;
      readonly content?: string | null;
      readonly tool_calls?: readonly {
        readonly index: number;
        readonly id?: string;
        readonly type?: string;
        readonly function?: { readonly name?: string; readonly arguments?: string };
      }[];
    };
    readonly finish_reason: string | null;
  }[];
  readonly usage?: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
  };
}

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

export class OpenAIStreamParser {
  async *parse(
    body: ReadableStream<Uint8Array>
  ): AsyncIterable<StreamEvent> {
    const pendingToolCalls = new Map<
      number,
      { id: string; name: string; args: string }
    >();
    let finishReason = "stop";
    let finishEmitted = false;

    for await (const data of parseSSEStream(body)) {
      let chunk: OpenAIStreamChunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }

      yield* this.processChunkDelta(chunk, pendingToolCalls);

      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason;
      }

      if (chunk.usage) {
        finishEmitted = true;
        yield {
          type: "finish" as const,
          reason: mapFinishReason(finishReason),
          usage: {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
          },
        };
      }
    }

    if (!finishEmitted) {
      yield {
        type: "finish" as const,
        reason: mapFinishReason(finishReason),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
  }

  private *processChunkDelta(
    chunk: OpenAIStreamChunk,
    toolCalls: Map<number, { id: string; name: string; args: string }>
  ): Generator<StreamEvent> {
    const choice = chunk.choices?.[0];
    if (!choice?.delta) return;

    if (choice.delta.content) {
      yield { type: "text-delta", text: choice.delta.content };
    }

    if (choice.delta.tool_calls) {
      for (const tc of choice.delta.tool_calls) {
        if (tc.id) {
          toolCalls.set(tc.index, {
            id: tc.id,
            name: tc.function?.name ?? "",
            args: tc.function?.arguments ?? "",
          });
          yield {
            type: "tool-call-start",
            id: tc.id,
            name: tc.function?.name ?? "",
          };
        } else {
          const state = toolCalls.get(tc.index);
          if (state && tc.function?.arguments) {
            state.args += tc.function.arguments;
            yield {
              type: "tool-call-delta",
              id: state.id,
              args: tc.function.arguments,
            };
          }
        }
      }
    }

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
