// context/types.ts

import type { Message } from "../llm/types.js";

// ─── Prompt Assembly ─────────────────────────────────────────

export interface SystemPromptConfig {
  readonly basePrompt: string; // Static, KV-cacheable
  readonly agentPrompt?: string; // Agent-specific instructions
  readonly skillPrompts?: readonly SkillPromptEntry[]; // Activated skill content
  readonly memorySections?: readonly MemorySection[]; // Relevant memories
  readonly dynamicSections?: readonly DynamicSection[]; // Per-message (not cacheable)
}

export interface MemorySection {
  readonly key: string;
  readonly content: string;
  readonly relevance: number; // 0-1, higher = more relevant
}

export interface SkillPromptEntry {
  readonly skillName: string;
  readonly content: string;
  readonly priority?: number; // Lower = earlier in prompt
}

export interface DynamicSection {
  readonly key: string;
  readonly label: string;
  readonly content: string;
}

export interface ContextBuilder {
  build(config: SystemPromptConfig): string;
}

// ─── Token Estimation ───────────────────────────────────────

/** Strategy for estimating token counts before sending to LLM */
export interface TokenEstimator {
  /** Estimate total tokens for a set of messages */
  estimate(messages: readonly Message[]): number;
  /** Optional: learn from actual LLM usage to improve future estimates */
  calibrate?(actualInputTokens: number, messages: readonly Message[]): void;
}

// ─── Pruning ─────────────────────────────────────────────────

export interface PruneConfig {
  readonly maxTokens: number;
  readonly preserveSystemPrompt: boolean;
  readonly preserveLastN?: number; // Always keep last N messages
}

/** Strategy interface — swap pruning algorithms */
export interface Pruner {
  prune(messages: readonly Message[], config: PruneConfig): Message[];
  shouldPrune(messages: readonly Message[], maxTokens: number): boolean;
}

// ─── Compaction ──────────────────────────────────────────────

/** Summarizes old messages to reclaim context space */
export interface Compactor {
  compact(messages: readonly Message[], focusHint?: string): Promise<Message[]>;
}
