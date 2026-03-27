// loop/think.ts
// Phase: Think — sends messages to LLM, streams response, collects tool calls

import type {
  Message,
  LLMRequest,
  LLMToolDefinition,
  Usage,
  FinishReason,
} from "../llm/types.js";
import type { ToolCall } from "../tool/types.js";
import { HookEvent } from "../hook/types.js";
import type { LoopConfig, LoopEvent, LoopState } from "./types.js";

// ─── Result Type ─────────────────────────────────────────────

export interface ThinkResult {
  readonly text: string;
  readonly toolCalls: ToolCall[];
  readonly usage: Usage;
  readonly finishReason: FinishReason;
}

// ─── Phase Function ──────────────────────────────────────────

export async function thinkPhase(
  config: LoopConfig,
  emit: (event: LoopEvent) => void,
  systemPrompt: string,
  messages: readonly Message[],
  state: LoopState,
  sessionId: string,
  forceNoTools = false
): Promise<ThinkResult> {
  const { llm, agent, hooks, tools } = config;

  // Disable tools when max steps reached or forced (plan mode)
  const maxSteps = agent.maxSteps ?? state.maxIterations;
  const toolDefs: LLMToolDefinition[] =
    !forceNoTools && state.iteration <= maxSteps
      ? tools.getAll().map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }))
      : [];

  let request: LLMRequest = {
    model: agent.model ?? "default",
    systemPrompt,
    messages: [...messages],
    tools: toolDefs,
    temperature: agent.temperature ?? 0.7,
  };

  // PreLLMCall hook — can block or modify request
  const hookResult = await hooks.dispatch(
    HookEvent.PreLLMCall,
    { request },
    sessionId
  );
  if (hookResult.action === "block") {
    throw new Error(`LLM call blocked: ${hookResult.reason}`);
  }
  if (hookResult.action === "modify") {
    request = hookResult.data.request;
  }

  // Stream LLM response
  const stream = await llm.stream(request);

  let text = "";
  const toolCalls: ToolCall[] = [];

  for await (const event of stream) {
    switch (event.type) {
      case "text-delta":
        text += event.text;
        emit({ type: "text:delta", text: event.text });
        break;
      case "tool-call":
        toolCalls.push({
          id: event.id,
          name: event.name,
          args: event.args,
        });
        break;
    }
  }

  const usage = await stream.usage;
  const finishReason = await stream.finishReason;

  // PostLLMCall hook
  await hooks.dispatch(
    HookEvent.PostLLMCall,
    { text, usage, finishReason },
    sessionId
  );

  return { text, toolCalls, usage, finishReason };
}
