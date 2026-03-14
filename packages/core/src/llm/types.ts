// llm/types.ts
// LLM communication protocol types

import type { JsonSchema } from "../schema/types.js";

// ─── Content Parts ───────────────────────────────────────────

export interface TextContent {
  readonly type: "text";
  readonly text: string;
}

export interface ToolCallContent {
  readonly type: "tool_call";
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
}

export type ContentPart = TextContent | ToolCallContent;

// ─── Messages (discriminated union) ─────────────────────────

export type Message =
  | { readonly role: "system"; readonly content: string }
  | { readonly role: "user"; readonly content: string }
  | { readonly role: "assistant"; readonly content: readonly ContentPart[] }
  | {
      readonly role: "tool";
      readonly toolCallId: string;
      readonly content: string;
      readonly isError?: boolean;
    };

// ─── Stream Events ───────────────────────────────────────────

export type StreamEvent =
  | { readonly type: "text-delta"; readonly text: string }
  | {
      readonly type: "tool-call-start";
      readonly id: string;
      readonly name: string;
    }
  | { readonly type: "tool-call-delta"; readonly id: string; readonly args: string }
  | {
      readonly type: "tool-call";
      readonly id: string;
      readonly name: string;
      readonly args: Record<string, unknown>;
    }
  | {
      readonly type: "finish";
      readonly reason: FinishReason;
      readonly usage: Usage;
    };

export type FinishReason = "stop" | "tool_calls" | "length" | "error";

export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

// ─── LLM Request ────────────────────────────────────────────

export interface LLMRequest {
  readonly model: string;
  readonly systemPrompt: string;
  readonly messages: readonly Message[];
  readonly tools?: readonly LLMToolDefinition[];
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface LLMToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
}

// ─── LLM Adapter Interface ──────────────────────────────────

/** Streamable LLM response — iterate for events, await for final result */
export interface LLMStream {
  [Symbol.asyncIterator](): AsyncIterator<StreamEvent>;
  readonly usage: Promise<Usage>;
  readonly finishReason: Promise<FinishReason>;
}

/** Provider-agnostic LLM adapter — implement per provider */
export interface LLMAdapter {
  stream(request: LLMRequest): Promise<LLMStream>;
}
