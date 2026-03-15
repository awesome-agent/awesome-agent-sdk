// use-tool-status.ts
// Derived hook — queries tool call lifecycle across messages

import { useMemo } from "react";
import type { UIMessage, ToolCallPart } from "./types.js";

export interface ToolStatusResult {
  /** All tool call parts across all messages */
  readonly toolCalls: readonly ToolCallPart[];
  /** Tool calls currently pending or running */
  readonly pending: readonly ToolCallPart[];
  /** Whether any tool is currently running */
  readonly isExecuting: boolean;
}

/**
 * Extract tool call status from the message list.
 *
 * @example
 * ```tsx
 * const { messages } = useAgentChat({ transport });
 * const { pending, isExecuting } = useToolStatus(messages);
 * if (isExecuting) return <Spinner tools={pending} />;
 * ```
 */
export function useToolStatus(
  messages: readonly UIMessage[],
): ToolStatusResult {
  return useMemo(() => {
    const toolCalls: ToolCallPart[] = [];

    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type === "tool-call") {
          toolCalls.push(part);
        }
      }
    }

    const pending = toolCalls.filter(
      (tc) => tc.status === "pending" || tc.status === "running",
    );

    return {
      toolCalls,
      pending,
      isExecuting: pending.length > 0,
    };
  }, [messages]);
}
