// Parses Anthropic SSE stream events into agent-core StreamEvents

import type { StreamEvent, FinishReason } from "@awesome-agent/agent-core";
import { parseSSEStream } from "@awesome-agent/agent-core";

// ─── Anthropic Wire Format (response events) ────────────────

interface AnthropicEvent {
  readonly type: string;
  readonly index?: number;
  readonly content_block?: {
    readonly type: string;
    readonly id?: string;
    readonly name?: string;
    readonly input?: Record<string, unknown>;
  };
  readonly delta?: {
    readonly type: string;
    readonly text?: string;
    readonly partial_json?: string;
    readonly stop_reason?: string;
  };
  readonly message?: {
    readonly usage?: { readonly input_tokens: number; readonly output_tokens: number };
    readonly stop_reason?: string;
  };
  readonly usage?: {
    readonly input_tokens: number;
    readonly output_tokens: number;
  };
}

// ─── Finish Reason Mapping ──────────────────────────────────

function mapStopReason(reason: string | undefined): FinishReason {
  switch (reason) {
    case "end_turn":
      return "stop";
    case "tool_use":
      return "tool_calls";
    case "max_tokens":
      return "length";
    default:
      return "error";
  }
}

// ─── Stream Parser ──────────────────────────────────────────

export class AnthropicStreamParser {
  async *parse(
    body: ReadableStream<Uint8Array>
  ): AsyncIterable<StreamEvent> {
    const pendingToolCalls = new Map<
      number,
      { id: string; name: string; args: string }
    >();
    let stopReason: string | undefined;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for await (const data of parseSSEStream(body)) {
      let event: AnthropicEvent;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }

      switch (event.type) {
        // Message start — capture initial usage
        case "message_start": {
          if (event.message?.usage) {
            totalInputTokens += event.message.usage.input_tokens;
            totalOutputTokens += event.message.usage.output_tokens;
          }
          break;
        }

        // Content block start — text or tool_use
        case "content_block_start": {
          const block = event.content_block;
          if (block?.type === "tool_use" && block.id && block.name != null) {
            const index = event.index ?? 0;
            pendingToolCalls.set(index, {
              id: block.id,
              name: block.name,
              args: "",
            });
            yield { type: "tool-call-start", id: block.id, name: block.name };
          }
          break;
        }

        // Content delta — text chunk or tool input chunk
        case "content_block_delta": {
          const delta = event.delta;
          if (!delta) break;

          if (delta.type === "text_delta" && delta.text) {
            yield { type: "text-delta", text: delta.text };
          }

          if (delta.type === "input_json_delta" && delta.partial_json) {
            const index = event.index ?? 0;
            const state = pendingToolCalls.get(index);
            if (state) {
              state.args += delta.partial_json;
              yield { type: "tool-call-delta", id: state.id, args: delta.partial_json };
            }
          }
          break;
        }

        // Content block stop — emit completed tool call
        case "content_block_stop": {
          const index = event.index ?? 0;
          const state = pendingToolCalls.get(index);
          if (state) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(state.args || "{}");
            } catch {
              // malformed args — keep empty
            }
            yield { type: "tool-call", id: state.id, name: state.name, args };
            pendingToolCalls.delete(index);
          }
          break;
        }

        // Message delta — stop reason + output token count
        case "message_delta": {
          if (event.delta?.stop_reason) {
            stopReason = event.delta.stop_reason;
          }
          if (event.usage) {
            totalOutputTokens += event.usage.output_tokens;
          }
          break;
        }

        // Message stop — emit finish
        case "message_stop": {
          yield {
            type: "finish" as const,
            reason: mapStopReason(stopReason),
            usage: {
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
            },
          };
          break;
        }
      }
    }
  }
}
