// context/streaming-compactor.ts
// Incremental compaction — maintains a rolling summary, merging new messages progressively

import type { Message, LLMAdapter } from "../llm/types.js";
import type { Compactor } from "./types.js";
import { buildTranscript } from "./transcript.js";

// ─── Configuration ───────────────────────────────────────────

const DEFAULT_PRESERVE_LAST_N = 6;
const DEFAULT_MAX_SUMMARY_TOKENS = 1024;
const DEFAULT_COMPACT_THRESHOLD = 10;
const DEFAULT_SUMMARY_TEMPERATURE = 0.3;

export interface StreamingCompactorConfig {
  readonly model?: string;
  readonly preserveLastN?: number;
  readonly maxSummaryTokens?: number;
  readonly compactThreshold?: number;
  readonly temperature?: number;
}

// ─── Streaming Compactor ─────────────────────────────────────

export class StreamingCompactor implements Compactor {
  private existingSummary = "";
  private summarizedCount = 0;

  constructor(
    private readonly llm: LLMAdapter,
    private readonly config?: StreamingCompactorConfig,
  ) {}

  async compact(messages: readonly Message[], focusHint?: string): Promise<Message[]> {
    const preserveN = this.config?.preserveLastN ?? DEFAULT_PRESERVE_LAST_N;
    const threshold = this.config?.compactThreshold ?? DEFAULT_COMPACT_THRESHOLD;

    if (messages.length <= preserveN) {
      return [...messages];
    }

    const toKeep = messages.slice(-preserveN);
    const older = messages.slice(0, -preserveN);
    const newMessages = older.slice(this.summarizedCount);

    if (newMessages.length < threshold) {
      if (this.existingSummary) {
        return [
          { role: "system", content: `[Conversation summary]\n${this.existingSummary}` },
          ...older.slice(this.summarizedCount),
          ...toKeep,
        ];
      }
      return [...messages];
    }

    this.existingSummary = await this.summarizeIncremental(newMessages, focusHint);
    this.summarizedCount = older.length;

    return [
      { role: "system", content: `[Conversation summary]\n${this.existingSummary}` },
      ...toKeep,
    ];
  }

  reset(): void {
    this.existingSummary = "";
    this.summarizedCount = 0;
  }

  private async summarizeIncremental(newMessages: readonly Message[], focusHint?: string): Promise<string> {
    const transcript = buildTranscript(newMessages);

    let prompt: string;
    if (this.existingSummary) {
      prompt =
        `Existing summary:\n${this.existingSummary}\n\n` +
        `New conversation to integrate:\n${transcript}\n\n` +
        "Update the summary to include the new information. Keep it concise.";
    } else {
      prompt =
        "Summarize the following conversation. " +
        "Preserve key decisions, tool results, and important context.\n\n" +
        transcript;
    }

    if (focusHint) {
      prompt += `\n\nFocus especially on: ${focusHint}`;
    }

    const stream = await this.llm.stream({
      model: this.config?.model ?? "default",
      systemPrompt:
        "You are a conversation summarizer. Produce concise, factual summaries. " +
        "When given an existing summary and new conversation, merge them into one updated summary.",
      messages: [{ role: "user", content: prompt }],
      temperature: this.config?.temperature ?? DEFAULT_SUMMARY_TEMPERATURE,
      maxTokens: this.config?.maxSummaryTokens ?? DEFAULT_MAX_SUMMARY_TOKENS,
    });

    let text = "";
    for await (const event of stream) {
      if (event.type === "text-delta") {
        text += event.text;
      }
    }
    return text;
  }
}
