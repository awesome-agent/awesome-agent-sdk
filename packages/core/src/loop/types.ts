// loop/types.ts
// Orchestrator types — depends only on interfaces (DIP compliant)

import type { LLMAdapter, Message, UserContent } from "../llm/types.js";
import type { ToolRegistry, ToolExecutor } from "../tool/executor-types.js";
import type { ToolContentBlock } from "../tool/types.js";
import type { HookManager } from "../hook/types.js";
import type { ContextBuilder, Pruner, Compactor, TokenEstimator } from "../context/types.js";
import type {
  SkillRegistry,
  SkillDetector,
  SkillLoader,
} from "../skill/types.js";
import type { AgentConfig, SubagentRunner } from "../agent/types.js";
import type { MemoryStore } from "../memory/types.js";
import type { MCPClient } from "../mcp/types.js";
import type { StorageBackend } from "../storage/types.js";

// ─── Run Options ────────────────────────────────────────────

export interface RunOptions {
  /** Abort signal for cancellation */
  readonly abort?: AbortSignal;
  /** Previous messages to continue a conversation (multi-turn) */
  readonly history?: readonly Message[];
}

// ─── Runnable Loop Interface (for DIP — SubagentRunner etc.) ─

export interface RunnableLoop {
  run(
    input: UserContent,
    sessionId: string,
    options?: RunOptions
  ): Promise<LoopResult>;
}

// ─── Loop Configuration ──────────────────────────────────────
// This is a flat config object, not a service interface. 13 of 19 fields are
// optional with sensible defaults. Splitting into sub-configs (LLMServices,
// ContextServices, etc.) would add indirection without reducing coupling —
// the orchestrator needs all of them regardless.

export interface LoopConfig {
  // Required
  readonly llm: LLMAdapter;
  readonly agent: AgentConfig;
  readonly tools: ToolRegistry;
  readonly executor: ToolExecutor;
  readonly hooks: HookManager;
  readonly context: ContextBuilder;

  // Optional
  readonly pruner?: Pruner;
  readonly compactor?: Compactor;
  readonly skills?: SkillRegistry;
  readonly skillDetector?: SkillDetector;
  readonly skillLoader?: SkillLoader;
  readonly subagentRunner?: SubagentRunner;
  readonly memory?: MemoryStore;
  readonly storage?: StorageBackend;
  readonly mcpClients?: readonly MCPClient[];
  readonly tokenEstimator?: TokenEstimator;
  readonly maxContextTokens?: number; // Default: 128_000
  readonly prunePreserveLastN?: number; // Default: 4 (from DefaultPruner)
  readonly memoryMaxResults?: number; // Default: 10

  // Plan mode: true = always plan first, false/undefined = normal
  readonly planMode?: boolean;
  readonly approvedPlan?: string; // Pre-approved plan — skips planning phase

  // Custom data passed to ToolContext.extensions (e.g. userId, serviceConfig)
  readonly toolExtensions?: Readonly<Record<string, unknown>>;

  // Event callback — server layer consumes this for SSE/WebSocket
  readonly onEvent?: (event: LoopEvent) => void;
}

// ─── State Machine ───────────────────────────────────────────

export enum LoopPhase {
  Idle = "idle",
  Gathering = "gathering", // Building context, detecting skills
  Planning = "planning", // Generating plan (no tools)
  Thinking = "thinking", // LLM is generating
  Executing = "executing", // Tools are running
  Verifying = "verifying", // Checking results, deciding next step
  Done = "done",
  Error = "error",
}

/** Immutable state — changes only via transition() function */
export interface LoopState {
  readonly phase: LoopPhase;
  readonly iteration: number;
  readonly maxIterations: number;
  readonly tokenUsage: Readonly<{ input: number; output: number }>;
  readonly toolCallCount: number;
  readonly blocked: boolean;
  readonly error?: string;
}

/** Actions that can transition state */
export type StateAction =
  | { readonly type: "next_phase"; readonly phase: LoopPhase }
  | { readonly type: "increment_iteration" }
  | {
      readonly type: "add_tokens";
      readonly usage: Readonly<{ input: number; output: number }>;
    }
  | { readonly type: "add_tool_calls"; readonly count: number }
  | { readonly type: "set_blocked"; readonly reason: string }
  | { readonly type: "set_error"; readonly error: string }
  | { readonly type: "reset_blocked" };

// ─── Loop Events ─────────────────────────────────────────────
// Server layer subscribes to these for SSE streaming, logging, etc.

export type LoopEvent =
  | {
      readonly type: "phase:change";
      readonly from: LoopPhase;
      readonly to: LoopPhase;
    }
  | { readonly type: "text:delta"; readonly text: string }
  | {
      readonly type: "tool:start";
      readonly callId: string;
      readonly name: string;
      readonly args: Record<string, unknown>;
    }
  | {
      readonly type: "tool:end";
      readonly callId: string;
      readonly result: Readonly<{
        success: boolean;
        content: string | readonly ToolContentBlock[];
      }>;
    }
  | {
      readonly type: "tool:progress";
      readonly callId: string;
      readonly progress: number;
      readonly total?: number;
      readonly message?: string;
    }
  | {
      readonly type: "iteration:end";
      readonly iteration: number;
      readonly usage: Readonly<{ input: number; output: number }>;
    }
  | { readonly type: "plan:ready"; readonly plan: string }
  | { readonly type: "done"; readonly result: LoopResult }
  | { readonly type: "error"; readonly error: string };

// ─── Loop Result ─────────────────────────────────────────────

export interface ToolCallLog {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly result?: string;
  readonly error?: string;
}

export interface LoopResult {
  readonly success: boolean;
  readonly output: string;
  readonly iterations: number;
  readonly totalTokens: Readonly<{ input: number; output: number }>;
  readonly toolCalls: readonly ToolCallLog[];
  readonly finishReason:
    | "complete"
    | "max_iterations"
    | "blocked"
    | "error"
    | "cancelled"
    | "plan_pending";
}
