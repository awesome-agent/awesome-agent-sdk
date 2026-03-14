// tool/middleware-types.ts
// Single concern: tool execution pipeline middleware

import type { Tool, ToolCall, ToolResult, ToolContext } from "./types.js";

// ─── Middleware Context ──────────────────────────────────────

export interface MiddlewareContext {
  readonly toolCall: ToolCall;
  readonly tool: Tool;
  readonly toolContext: ToolContext;
}

// ─── Middleware Result ───────────────────────────────────────

export type MiddlewareResult =
  | { readonly action: "continue" }
  | { readonly action: "block"; readonly reason: string }
  | { readonly action: "modify"; readonly args: Record<string, unknown> };

// ─── Middleware Interface ────────────────────────────────────

export interface Middleware {
  readonly name: string;
  before?(ctx: MiddlewareContext): Promise<MiddlewareResult>;
  after?(
    ctx: MiddlewareContext & { readonly result: ToolResult }
  ): Promise<ToolResult>;
}

// ─── Pipeline Interface (for DIP — consumers depend on this) ─

export interface ToolMiddlewarePipeline {
  runBefore(ctx: MiddlewareContext): Promise<MiddlewareResult>;
  runAfter(ctx: MiddlewareContext, result: ToolResult): Promise<ToolResult>;
}
