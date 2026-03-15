// Factory functions for creating test events and messages

import type { LoopEvent, LoopPhase, UIMessage } from "../../src/types.js";

export function textDelta(text: string): LoopEvent {
  return { type: "text:delta", text };
}

export function toolStart(
  callId: string,
  name: string,
  args: Record<string, unknown> = {},
): LoopEvent {
  return { type: "tool:start", callId, name, args };
}

export function toolEnd(
  callId: string,
  success: boolean,
  content: string,
): LoopEvent {
  return { type: "tool:end", callId, result: { success, content } };
}

export function phaseChange(from: LoopPhase, to: LoopPhase): LoopEvent {
  return { type: "phase:change", from, to };
}

export function iterationEnd(
  iteration: number,
  input: number,
  output: number,
): LoopEvent {
  return { type: "iteration:end", iteration, usage: { input, output } };
}

export function planReady(plan: string): LoopEvent {
  return { type: "plan:ready", plan };
}

export function doneEvent(output = ""): LoopEvent {
  return {
    type: "done",
    result: {
      success: true,
      output,
      iterations: 1,
      totalTokens: { input: 0, output: 0 },
      finishReason: "complete",
    },
  };
}

export function errorEvent(error: string): LoopEvent {
  return { type: "error", error };
}

export function userMessage(text: string, id = "test-user-1"): UIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text, status: "complete" }],
    createdAt: Date.now(),
  };
}
