// tool/types.ts
// Core tool data types — single concern: tool definition and data transfer

import type { JsonSchema } from "../schema/types.js";

// ─── Tool Definition ─────────────────────────────────────────

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  execute(
    input: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult>;
}

// ─── Tool Call & Result ──────────────────────────────────────

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
}

/**
 * Structured tool-output blocks. Tools that produce rich results (images,
 * resources, etc.) return an array of blocks; simple tools still return a
 * plain string via `ToolResult.content`. Consumers (stream events, LLM
 * adapters) can opt into block handling or fall back to a serialized string
 * via `serializeToolContent`.
 */
export type ToolContentBlock =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image";
      readonly url: string;
      /** Optional stable handle the UI can use to resolve a fresh URL after expiry. */
      readonly resourceId?: string;
    };

export interface ToolResult {
  readonly success: boolean;
  readonly content: string | readonly ToolContentBlock[];
  readonly files?: readonly ToolFile[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Flatten block content to a plain string — used when the downstream consumer
 * (LLM provider, legacy log) only accepts strings. Drops non-text blocks.
 */
export function serializeToolContent(
  content: string | readonly ToolContentBlock[]
): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is Extract<ToolContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

export interface ToolFile {
  readonly name: string;
  readonly mimeType: string;
  readonly url?: string;
  readonly data?: string; // base64
}

// ─── Progress (MCP-compatible) ──────────────────────────────

export interface ToolProgressData {
  /** Current progress value. MUST increase with each call. */
  readonly progress: number;
  /** Total value if known. Enables percentage calculation. */
  readonly total?: number;
  /** Human-readable description of current phase. */
  readonly message?: string;
}

// ─── Execution Context ───────────────────────────────────────

export interface ToolContext {
  readonly sessionId: string;
  readonly agentId: string;
  readonly abort?: AbortSignal;
  readonly extensions: Readonly<Record<string, unknown>>;
  /** Report progress for long-running operations (MCP-compatible). */
  readonly emitProgress?: (data: ToolProgressData) => void;
}
