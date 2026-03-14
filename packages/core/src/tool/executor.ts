// tool/executor.ts
// Default ToolExecutor — parallel execution with optional middleware pipeline

import type { ToolCall, ToolResult, ToolContext } from "./types.js";
import { ToolExecutionError } from "../errors.js";
import type {
  ToolRegistry,
  ToolExecutor,
  ToolExecutionResult,
  ToolError,
} from "./executor-types.js";
import type { ToolMiddlewarePipeline } from "./middleware-types.js";

export class DefaultToolExecutor implements ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly pipeline?: ToolMiddlewarePipeline
  ) {}

  async execute(
    calls: readonly ToolCall[],
    context: ToolContext
  ): Promise<ToolExecutionResult> {
    const results = new Map<string, ToolResult>();
    const errors: ToolError[] = [];
    let blocked = false;

    await Promise.all(
      calls.map(async (call) => {
        const tool = this.registry.get(call.name);

        if (!tool) {
          const error: ToolError = {
            callId: call.id,
            toolName: call.name,
            error: `Tool "${call.name}" not found`,
          };
          errors.push(error);
          results.set(call.id, { success: false, content: error.error });
          return;
        }

        try {
          let args = call.args;

          // Before middleware
          if (this.pipeline) {
            const beforeResult = await this.pipeline.runBefore({
              toolCall: call,
              tool,
              toolContext: context,
            });

            if (beforeResult.action === "block") {
              blocked = true;
              results.set(call.id, {
                success: false,
                content: `Blocked: ${beforeResult.reason}`,
              });
              return;
            }

            if (beforeResult.action === "modify") {
              args = beforeResult.args;
            }
          }

          // Execute tool
          let result = await tool.execute(args, context);

          // After middleware
          if (this.pipeline) {
            result = await this.pipeline.runAfter(
              { toolCall: call, tool, toolContext: context },
              result
            );
          }

          results.set(call.id, result);
        } catch (err) {
          const cause = err instanceof Error ? err.message : String(err);
          const typed = new ToolExecutionError(call.name, cause);
          errors.push({ callId: call.id, toolName: call.name, error: typed.message });
          results.set(call.id, { success: false, content: cause });
        }
      })
    );

    return { results, blocked, errors };
  }
}
