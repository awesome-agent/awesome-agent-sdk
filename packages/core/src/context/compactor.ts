// context/compactor.ts
// LLM-based context compaction — summarizes old messages to reclaim token space

import type { Message, LLMAdapter } from "../llm/types.js";
import type { Compactor } from "./types.js";
import { buildTranscript } from "./transcript.js";
import { streamSummary } from "./summarize.js";

const DEFAULT_PRESERVE_LAST_N = 6;
const DEFAULT_MAX_SUMMARY_TOKENS = 1024;
const DEFAULT_SUMMARY_TEMPERATURE = 0.3;

export interface CompactorConfig {
  readonly model?: string;
  readonly preserveLastN?: number; // Default: 6
  readonly maxSummaryTokens?: number; // Default: 1024
  readonly temperature?: number; // Default: 0.3
}

export class LLMCompactor implements Compactor {
  constructor(
    private readonly llm: LLMAdapter,
    private readonly config?: CompactorConfig
  ) {}

  async compact(
    messages: readonly Message[],
    focusHint?: string
  ): Promise<Message[]> {
    const preserveN = this.config?.preserveLastN ?? DEFAULT_PRESERVE_LAST_N;

    if (messages.length <= preserveN) {
      return [...messages];
    }

    const toCompact = messages.slice(0, -preserveN);
    const toKeep = messages.slice(-preserveN);

    const summary = await this.summarize(toCompact, focusHint);

    return [
      {
        role: "system" as const,
        content: `[Previous conversation summary]\n${summary}`,
      },
      ...toKeep,
    ];
  }

  private async summarize(
    messages: readonly Message[],
    focusHint?: string
  ): Promise<string> {
    const transcript = buildTranscript(messages);

    let userPrompt =
      "Summarize the following conversation. " +
      "Preserve key decisions, tool results, and important context.\n\n" +
      transcript;

    if (focusHint) {
      userPrompt += `\n\nFocus especially on: ${focusHint}`;
    }

    return streamSummary({
      llm: this.llm,
      model: this.config?.model ?? "default",
      systemPrompt:
        "You are a conversation summarizer. Produce concise, factual summaries.",
      userPrompt,
      temperature: this.config?.temperature ?? DEFAULT_SUMMARY_TEMPERATURE,
      maxTokens: this.config?.maxSummaryTokens ?? DEFAULT_MAX_SUMMARY_TOKENS,
    });
  }
}
