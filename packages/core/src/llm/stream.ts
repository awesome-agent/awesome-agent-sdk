// llm/stream.ts
// LLMStream helper — wraps async event source, resolves usage/finishReason promises

import { AgentError } from "../errors.js";
import type {
  LLMStream,
  StreamEvent,
  Usage,
  FinishReason,
} from "./types.js";

export class DefaultLLMStream implements LLMStream {
  readonly usage: Promise<Usage>;
  readonly finishReason: Promise<FinishReason>;

  private resolveUsage!: (usage: Usage) => void;
  private resolveFinishReason!: (reason: FinishReason) => void;
  private readonly source: AsyncIterable<StreamEvent>;
  private consumed = false;

  constructor(source: AsyncIterable<StreamEvent>) {
    this.source = source;
    this.usage = new Promise((resolve) => {
      this.resolveUsage = resolve;
    });
    this.finishReason = new Promise((resolve) => {
      this.resolveFinishReason = resolve;
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
    if (this.consumed) {
      throw new AgentError("LLMStream can only be iterated once");
    }
    this.consumed = true;
    return this.iterate();
  }

  private async *iterate(): AsyncGenerator<StreamEvent> {
    try {
      for await (const event of this.source) {
        if (event.type === "finish") {
          this.resolveUsage(event.usage);
          this.resolveFinishReason(event.reason);
        }
        yield event;
      }
    } finally {
      // Ensure promises resolve even if stream ends without finish event
      this.resolveUsage({ inputTokens: 0, outputTokens: 0 });
      this.resolveFinishReason("error");
    }
  }
}
