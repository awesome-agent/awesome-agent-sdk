// tool/pipeline.ts
// Middleware pipeline — runs before/after chains around tool execution

import type { ToolResult } from "./types.js";
import type {
  Middleware,
  MiddlewareContext,
  MiddlewareResult,
  ToolMiddlewarePipeline,
} from "./middleware-types.js";

export class MiddlewarePipeline implements ToolMiddlewarePipeline {
  private readonly middlewares: Middleware[] = [];

  add(middleware: Middleware): void {
    this.middlewares.push(middleware);
  }

  remove(name: string): void {
    const index = this.middlewares.findIndex((m) => m.name === name);
    if (index !== -1) {
      this.middlewares.splice(index, 1);
    }
  }

  /** Run all before() middlewares in order. First block wins, args accumulate. */
  async runBefore(ctx: MiddlewareContext): Promise<MiddlewareResult> {
    let currentArgs = ctx.toolCall.args;

    for (const mw of this.middlewares) {
      if (!mw.before) continue;

      const effectiveCtx: MiddlewareContext = {
        ...ctx,
        toolCall: { ...ctx.toolCall, args: currentArgs },
      };

      const result = await mw.before(effectiveCtx);

      if (result.action === "block") {
        return result;
      }

      if (result.action === "modify") {
        currentArgs = result.args;
      }
    }

    if (currentArgs !== ctx.toolCall.args) {
      return { action: "modify", args: currentArgs };
    }

    return { action: "continue" };
  }

  /** Run all after() middlewares in order. Each can transform the result. */
  async runAfter(
    ctx: MiddlewareContext,
    result: ToolResult
  ): Promise<ToolResult> {
    let current = result;

    for (const mw of this.middlewares) {
      if (!mw.after) continue;
      current = await mw.after({ ...ctx, result: current });
    }

    return current;
  }
}
