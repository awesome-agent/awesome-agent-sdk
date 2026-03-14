// hook/types.ts
// Event-driven extensibility with fully type-safe payloads and modify results

import type { LLMRequest, Usage, FinishReason } from "../llm/types.js";
import type { ToolCall, ToolResult } from "../tool/types.js";

// ─── Hook Events ─────────────────────────────────────────────

export enum HookEvent {
  SessionStart = "session:start",
  SessionEnd = "session:end",

  PreLLMCall = "llm:before",
  PostLLMCall = "llm:after",

  PreToolUse = "tool:before",
  PostToolUse = "tool:after",

  PreCompact = "context:before-compact",
  PostCompact = "context:after-compact",

  Stop = "loop:stop",
  Error = "loop:error",
}

// ─── Type-Safe Payload Map ───────────────────────────────────
// Each event has its own payload type — no Record<string, unknown>

export interface HookPayloadMap {
  [HookEvent.SessionStart]: { readonly agentId: string };
  [HookEvent.SessionEnd]: { readonly reason: string };

  [HookEvent.PreLLMCall]: { readonly request: LLMRequest };
  [HookEvent.PostLLMCall]: {
    readonly text: string;
    readonly usage: Usage;
    readonly finishReason: FinishReason;
  };

  [HookEvent.PreToolUse]: { readonly toolCall: ToolCall };
  [HookEvent.PostToolUse]: {
    readonly toolCall: ToolCall;
    readonly result: ToolResult;
  };

  [HookEvent.PreCompact]: { readonly messageCount: number };
  [HookEvent.PostCompact]: {
    readonly before: number;
    readonly after: number;
  };

  [HookEvent.Stop]: {
    readonly output: string;
    readonly finishReason: FinishReason;
  };
  [HookEvent.Error]: { readonly error: string };
}

// ─── Type-Safe Modify Map ────────────────────────────────────
// Only specific events support "modify" — others get never

export interface HookModifyMap {
  [HookEvent.PreToolUse]: { readonly args: Record<string, unknown> };
  [HookEvent.PreLLMCall]: { readonly request: LLMRequest };
}

/** Events that support the "modify" action */
type ModifiableEvent = keyof HookModifyMap;

// ─── Hook Payload ────────────────────────────────────────────

export interface HookPayload<E extends HookEvent = HookEvent> {
  readonly event: E;
  readonly sessionId: string;
  readonly timestamp: number;
  readonly data: HookPayloadMap[E];
}

// ─── Hook Result (type-safe per event) ───────────────────────

type ContinueResult = { readonly action: "continue" };
type BlockResult = { readonly action: "block"; readonly reason: string };
type ModifyResult<E extends HookEvent> = E extends ModifiableEvent
  ? { readonly action: "modify"; readonly data: HookModifyMap[E] }
  : never;

export type HookResult<E extends HookEvent = HookEvent> =
  | ContinueResult
  | BlockResult
  | ModifyResult<E>;

// ─── Hook Definition ─────────────────────────────────────────

export interface Hook<E extends HookEvent = HookEvent> {
  readonly name: string;
  readonly event: E | E[];
  readonly priority?: number; // Lower runs first, default 100
  handler(payload: HookPayload<E>): Promise<HookResult<E>>;
}

// ─── Hook Manager Interface ──────────────────────────────────

export interface HookManager {
  register<E extends HookEvent>(hook: Hook<E>): void;
  unregister(name: string): void;
  dispatch<E extends HookEvent>(
    event: E,
    data: HookPayloadMap[E],
    sessionId: string
  ): Promise<HookResult<E>>;
  getHooks(event: HookEvent): Hook[];
}
