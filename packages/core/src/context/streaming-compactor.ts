// context/streaming-compactor.ts
// Incremental compaction — maintains a rolling summary, merging new messages progressively

import type { Message, LLMAdapter } from "../llm/types.js";
import type { Compactor } from "./types.js";
import { buildTranscript } from "./transcript.js";
import { streamSummary } from "./summarize.js";
import {
  DEFAULT_COMPACTOR_PRESERVE_LAST_N,
  DEFAULT_COMPACTOR_MAX_SUMMARY_TOKENS,
  DEFAULT_COMPACTOR_TEMPERATURE,
} from "./compactor-defaults.js";

// ─── Configuration ───────────────────────────────────────────

const DEFAULT_COMPACT_THRESHOLD = 10;

export interface StreamingCompactorConfig {
  readonly model?: string;
  readonly preserveLastN?: number; // Default: 6
  readonly maxSummaryTokens?: number; // Default: 1024
  readonly compactThreshold?: number; // Default: 10 — min new messages before compaction
  readonly temperature?: number; // Default: 0.3
}

// ─── Streaming Compactor ─────────────────────────────────────

export class StreamingCompactor implements Compactor {
  private existingSummary = "";
  private summarizedCount = 0;

  constructor(
    private readonly llm: LLMAdapter,
    private readonly config?: StreamingCompactorConfig
  ) {}

  async compact(
    messages: readonly Message[],
    focusHint?: string
  ): Promise<Message[]> {
    const preserveN = this.config?.preserveLastN ?? DEFAULT_COMPACTOR_PRESERVE_LAST_N;
    const threshold = this.config?.compactThreshold ?? DEFAULT_COMPACT_THRESHOLD;

    if (messages.length <= preserveN) {
      return [...messages];
    }

    const toKeep = messages.slice(-preserveN);
    const older = messages.slice(0, -preserveN);

    // How many new messages since last compaction?
    const newMessages = older.slice(this.summarizedCount);

    if (newMessages.length < threshold) {
      // Not enough new messages — return with existing summary if available
      if (this.existingSummary) {
        return [
          { role: "system", content: `[Conversation summary]\n${this.existingSummary}` },
          ...older.slice(this.summarizedCount),
          ...toKeep,
        ];
      }
      return [...messages];
    }

    // Incrementally summarize: merge existing summary + new messages
    this.existingSummary = await this.summarizeIncremental(newMessages, focusHint);
    this.summarizedCount = older.length;

    return [
      { role: "system", content: `[Conversation summary]\n${this.existingSummary}` },
      ...toKeep,
    ];
  }

  /** Reset internal state (e.g., for a new conversation) */
  reset(): void {
    this.existingSummary = "";
    this.summarizedCount = 0;
  }

  private async summarizeIncremental(
    newMessages: readonly Message[],
    focusHint?: string
  ): Promise<string> {
    const transcript = buildTranscript(newMessages);

    let userPrompt: string;
    if (this.existingSummary) {
      userPrompt =
        `Existing summary:\n${this.existingSummary}\n\n` +
        `New conversation to integrate:\n${transcript}\n\n` +
        "Update the summary to include the new information. Keep it concise.";
    } else {
      userPrompt =
        "Summarize the following conversation. " +
        "Preserve key decisions, tool results, and important context.\n\n" +
        transcript;
    }

    if (focusHint) {
      userPrompt += `\n\nFocus especially on: ${focusHint}`;
    }

    return streamSummary({
      llm: this.llm,
      model: this.config?.model ?? "default",
      systemPrompt:
        "You are a conversation summarizer. Produce concise, factual summaries. " +
        "When given an existing summary and new conversation, merge them into one updated summary.",
      userPrompt,
      temperature: this.config?.temperature ?? DEFAULT_COMPACTOR_TEMPERATURE,
      maxTokens: this.config?.maxSummaryTokens ?? DEFAULT_COMPACTOR_MAX_SUMMARY_TOKENS,
    });
  }
}
