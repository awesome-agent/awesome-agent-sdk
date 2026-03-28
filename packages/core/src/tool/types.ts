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

export interface ToolResult {
  readonly success: boolean;
  readonly content: string;
  readonly files?: readonly ToolFile[];
  readonly metadata?: Readonly<Record<string, unknown>>;
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
