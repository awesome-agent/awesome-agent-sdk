// types.ts
// UI-facing types — mirrors the wire protocol from @awesome-agent/agent-core
// Intentionally decoupled: this package never imports from agent-core

/**
 * Mirror of `@awesome-agent/agent-core` ToolContentBlock — tools that produce
 * rich output (images, resources, etc.) return arrays of these; simple tools
 * still emit plain strings. Kept in sync by shape, not by import (package
 * is intentionally decoupled).
 */
export type ToolContentBlock =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image";
      readonly url: string;
      readonly resourceId?: string;
    };

// ─── Loop Event (wire protocol — what the transport delivers) ───

export type LoopPhase =
  | "idle"
  | "gathering"
  | "planning"
  | "thinking"
  | "executing"
  | "verifying"
  | "done"
  | "error";

export type LoopEvent =
  | { readonly type: "phase:change"; readonly from: LoopPhase; readonly to: LoopPhase }
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
  | { readonly type: "done"; readonly result: LoopResultSummary }
  | { readonly type: "error"; readonly error: string };

export interface LoopResultSummary {
  readonly success: boolean;
  readonly output: string;
  readonly iterations: number;
  readonly totalTokens: Readonly<{ input: number; output: number }>;
  readonly finishReason: string;
}

// ─── Message Parts (the UI's renderable unit) ──────────────────

export type MessagePartStatus = "streaming" | "complete" | "error";

export interface TextPart {
  readonly type: "text";
  readonly text: string;
  readonly status: MessagePartStatus;
}

export interface ToolCallPart {
  readonly type: "tool-call";
  readonly callId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly status: "pending" | "running" | "success" | "error";
  readonly result?: string;
  readonly progress?: number;
  readonly total?: number;
  readonly progressMessage?: string;
}

export interface PlanPart {
  readonly type: "plan";
  readonly plan: string;
}

export interface CustomPart {
  readonly type: "custom";
  readonly kind: string;
  readonly data: unknown;
}

export type MessagePart = TextPart | ToolCallPart | PlanPart | CustomPart;

// ─── UI Message ─────────────────────────────────────────────────

export type MessageRole = "user" | "assistant";

export interface UIMessage {
  readonly id: string;
  readonly role: MessageRole;
  readonly parts: readonly MessagePart[];
  readonly createdAt: number;
}

// ─── Chat Status ────────────────────────────────────────────────

export type ChatStatus =
  | "idle"
  | "connecting"
  | "streaming"
  | "tool-executing"
  | "error";

// ─── Chat State (managed by reducer) ────────────────────────────

export interface ChatState {
  readonly status: ChatStatus;
  readonly messages: readonly UIMessage[];
  readonly phase: LoopPhase;
  readonly error: string | null;
  readonly usage: Readonly<{ input: number; output: number }>;
  readonly iterations: number;
}

// ─── Part Resolver ──────────────────────────────────────────────

/**
 * Intercepts LoopEvents and optionally produces CustomParts.
 * Return a CustomPart to handle the event, or null to pass through.
 */
export interface PartResolver {
  resolve(event: LoopEvent): CustomPart | null;
}
