// loop/state.ts
// Pure state machine — no side effects, immutable transitions

import { LoopPhase } from "./types.js";
import type { LoopState, StateAction } from "./types.js";
import { AgentError } from "../errors.js";

/** Create initial loop state */
export function createInitialState(maxIterations: number): LoopState {
  return {
    phase: LoopPhase.Idle,
    iteration: 0,
    maxIterations,
    tokenUsage: { input: 0, output: 0 },
    toolCallCount: 0,
    blocked: false,
  };
}

/** Pure reducer — returns new state, never mutates input */
export function transition(state: LoopState, action: StateAction): LoopState {
  switch (action.type) {
    case "next_phase":
      return { ...state, phase: action.phase };

    case "increment_iteration":
      return { ...state, iteration: state.iteration + 1 };

    case "add_tokens":
      return {
        ...state,
        tokenUsage: {
          input: state.tokenUsage.input + action.usage.input,
          output: state.tokenUsage.output + action.usage.output,
        },
      };

    case "add_tool_calls":
      return { ...state, toolCallCount: state.toolCallCount + action.count };

    case "set_blocked":
      return { ...state, blocked: true, error: action.reason };

    case "set_error":
      return { ...state, phase: LoopPhase.Error, error: action.error };

    case "reset_blocked":
      return { ...state, blocked: false, error: undefined };

    default: {
      const _exhaustive: never = action;
      throw new AgentError(`Unknown state action: ${(_exhaustive as StateAction).type}`);
    }
  }
}
