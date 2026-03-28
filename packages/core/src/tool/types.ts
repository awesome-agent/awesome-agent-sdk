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

// ─── Execution Context ───────────────────────────────────────

export interface ToolContext {
  readonly sessionId: string;
  readonly agentId: string;
  readonly abort?: AbortSignal;
  readonly extensions: Readonly<Record<string, unknown>>;
  readonly emitProgress?: (message: string) => void;
}
