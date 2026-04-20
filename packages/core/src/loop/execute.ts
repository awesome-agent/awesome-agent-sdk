// loop/execute.ts
// Phase: Execute — runs tool calls, processes results, dispatches hooks

import type { Message } from "../llm/types.js";
import type { ToolCall } from "../tool/types.js";
import { serializeToolContent } from "../tool/types.js";
import { HookEvent } from "../hook/types.js";
import type { LoopConfig, LoopEvent, ToolCallLog } from "./types.js";

// ─── Result Type ─────────────────────────────────────────────

export interface ExecuteResult {
  readonly blocked: boolean;
}

// ─── Phase Function ──────────────────────────────────────────

export async function executePhase(
  config: LoopConfig,
  emit: (event: LoopEvent) => void,
  assistantText: string,
  toolCalls: readonly ToolCall[],
  messages: Message[],
  toolCallLogs: ToolCallLog[],
  sessionId: string,
  abort?: AbortSignal
): Promise<ExecuteResult> {
  const { hooks, executor, agent } = config;

  // Add assistant message (text + tool calls) to history
  const contentParts = [
    ...(assistantText
      ? [{ type: "text" as const, text: assistantText }]
      : []),
    ...toolCalls.map((tc) => ({
      type: "tool_call" as const,
      id: tc.id,
      name: tc.name,
      args: tc.args,
    })),
  ];
  messages.push({ role: "assistant", content: contentParts });

  // PreToolUse hooks — can block or modify args
  const resolvedCalls: ToolCall[] = [];
  for (const tc of toolCalls) {
    emit({
      type: "tool:start",
      callId: tc.id,
      name: tc.name,
      args: tc.args,
    });

    const hookResult = await hooks.dispatch(
      HookEvent.PreToolUse,
      { toolCall: tc },
      sessionId
    );

    if (hookResult.action === "block") {
      messages.push({
        role: "tool",
        toolCallId: tc.id,
        content: `Blocked: ${hookResult.reason}`,
        isError: true,
      });
      return { blocked: true };
    }

    if (hookResult.action === "modify") {
      resolvedCalls.push({ ...tc, args: hookResult.data.args });
    } else {
      resolvedCalls.push(tc);
    }
  }

  // Execute tools
  const toolContext = {
    sessionId,
    agentId: agent.id,
    abort,
    extensions: config.toolExtensions ?? {},
  };

  const execResult = await executor.execute(resolvedCalls, toolContext, (callId, data) => {
    emit({ type: "tool:progress", callId, progress: data.progress, total: data.total, message: data.message });
  });

  // Process results
  for (const tc of resolvedCalls) {
    const result = execResult.results.get(tc.id);
    if (!result) continue;

    // LLM provider messages carry tool results as strings (OpenAI-compatible).
    // Block-array content (e.g. image blocks) is serialized to text here;
    // downstream UI receives the full structured content via the tool:end
    // event below.
    const serializedForLLM = serializeToolContent(result.content);

    messages.push({
      role: "tool",
      toolCallId: tc.id,
      content: serializedForLLM,
      isError: !result.success,
    });

    emit({
      type: "tool:end",
      callId: tc.id,
      result: { success: result.success, content: result.content },
    });

    toolCallLogs.push({
      name: tc.name,
      args: tc.args,
      ...(result.success
        ? { result: serializedForLLM }
        : { error: serializedForLLM }),
    });

    // PostToolUse hook
    await hooks.dispatch(
      HookEvent.PostToolUse,
      { toolCall: tc, result },
      sessionId
    );
  }

  return { blocked: execResult.blocked };
}
