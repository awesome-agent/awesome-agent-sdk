// llm/mock-adapter.ts
// Mock LLM adapter for testing — deterministic, no network calls

import type {
  LLMAdapter,
  LLMRequest,
  LLMStream,
  StreamEvent,
  Usage,
  FinishReason,
} from "./types.js";
import { DefaultLLMStream } from "./stream.js";

// ─── Mock Response Config ────────────────────────────────────

export interface MockResponse {
  readonly text?: string;
  readonly toolCalls?: readonly MockToolCall[];
  readonly usage?: Usage;
  readonly finishReason?: FinishReason;
}

export interface MockToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
}

// ─── Mock Adapter ────────────────────────────────────────────

export class MockLLMAdapter implements LLMAdapter {
  private readonly responses: MockResponse[] = [];
  private callIndex = 0;

  /** All requests received — useful for test assertions */
  readonly requests: LLMRequest[] = [];

  /** Queue a response. Returns this for fluent chaining. */
  addResponse(response: MockResponse): this {
    this.responses.push(response);
    return this;
  }

  async stream(request: LLMRequest): Promise<LLMStream> {
    this.requests.push(request);

    const response = this.responses[this.callIndex++];
    if (!response) {
      throw new Error(
        `MockLLMAdapter: no response queued at index ${this.callIndex - 1}`
      );
    }

    return new DefaultLLMStream(MockLLMAdapter.generate(response));
  }

  private static async *generate(
    response: MockResponse
  ): AsyncIterable<StreamEvent> {
    if (response.text) {
      yield { type: "text-delta", text: response.text };
    }

    if (response.toolCalls) {
      for (const tc of response.toolCalls) {
        yield { type: "tool-call", id: tc.id, name: tc.name, args: tc.args };
      }
    }

    yield {
      type: "finish",
      reason:
        response.finishReason ??
        (response.toolCalls?.length ? "tool_calls" : "stop"),
      usage: response.usage ?? { inputTokens: 0, outputTokens: 0 },
    };
  }
}
