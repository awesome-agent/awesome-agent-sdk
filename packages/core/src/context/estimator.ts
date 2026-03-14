// context/estimator.ts
// Token estimation strategies — from simple heuristic to adaptive learning

import type { Message } from "../llm/types.js";
import type { TokenEstimator } from "./types.js";

// ─── Shared Utility ──────────────────────────────────────────

function countChars(messages: readonly Message[]): number {
  let chars = 0;

  for (const msg of messages) {
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") {
          chars += part.text.length;
        } else if (part.type === "tool_call") {
          chars += JSON.stringify(part.args).length;
        }
      }
    } else {
      chars += msg.content.length;
    }
  }

  return chars;
}

// ─── CharBasedEstimator ──────────────────────────────────────

export const DEFAULT_CHARS_PER_TOKEN = 4;

/** Simple heuristic: total characters / charsPerToken */
export class CharBasedEstimator implements TokenEstimator {
  private readonly charsPerToken: number;

  constructor(charsPerToken = DEFAULT_CHARS_PER_TOKEN) {
    this.charsPerToken = charsPerToken;
  }

  estimate(messages: readonly Message[]): number {
    return Math.ceil(countChars(messages) / this.charsPerToken);
  }
}

// ─── AdaptiveEstimator ───────────────────────────────────────

export const DEFAULT_ALPHA = 0.3;

/** Learns from real LLM usage data via Exponential Moving Average */
export class AdaptiveEstimator implements TokenEstimator {
  private charsPerToken: number;
  private readonly alpha: number;

  constructor(config?: {
    readonly initialCharsPerToken?: number;
    readonly alpha?: number;
  }) {
    this.charsPerToken = config?.initialCharsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
    this.alpha = config?.alpha ?? DEFAULT_ALPHA;
  }

  estimate(messages: readonly Message[]): number {
    return Math.ceil(countChars(messages) / this.charsPerToken);
  }

  calibrate(actualInputTokens: number, messages: readonly Message[]): void {
    if (actualInputTokens <= 0) return;

    const chars = countChars(messages);
    if (chars <= 0) return;

    const observedRatio = chars / actualInputTokens;
    this.charsPerToken =
      this.alpha * observedRatio + (1 - this.alpha) * this.charsPerToken;
  }

  /** Current chars-per-token ratio (for debugging/testing) */
  get currentRatio(): number {
    return this.charsPerToken;
  }
}
