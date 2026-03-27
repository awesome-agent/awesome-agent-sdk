// tool/executor-types.ts
// Single concern: tool registry and execution infrastructure

import type { Tool, ToolCall, ToolResult, ToolContext } from "./types.js";

// ─── Tool Registry ───────────────────────────────────────────

export interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  getAll(): readonly Tool[];
  has(name: string): boolean;
}

// ─── Tool Executor ───────────────────────────────────────────

export interface ToolExecutor {
  execute(
    calls: readonly ToolCall[],
    context: ToolContext
  ): Promise<ToolExecutionResult>;
}

export interface ToolExecutionResult {
  readonly results: ReadonlyMap<string, ToolResult>; // callId → result
  readonly blocked: boolean;
  readonly errors: readonly ToolError[];
}

export interface ToolError {
  readonly callId: string;
  readonly toolName: string;
  readonly error: string;
}
