import { describe, it, expect } from "vitest";
import { createInitialState, transition } from "../../src/loop/state.js";
import { LoopPhase } from "../../src/loop/types.js";

describe("createInitialState", () => {
  it("creates state with correct defaults", () => {
    const state = createInitialState(50);

    expect(state.phase).toBe(LoopPhase.Idle);
    expect(state.iteration).toBe(0);
    expect(state.maxIterations).toBe(50);
    expect(state.tokenUsage).toEqual({ input: 0, output: 0 });
    expect(state.toolCallCount).toBe(0);
    expect(state.blocked).toBe(false);
    expect(state.error).toBeUndefined();
  });
});

describe("transition", () => {
  const initial = createInitialState(10);

  it("next_phase — changes phase", () => {
    const next = transition(initial, {
      type: "next_phase",
      phase: LoopPhase.Thinking,
    });
    expect(next.phase).toBe(LoopPhase.Thinking);
    expect(next.iteration).toBe(0); // unchanged
  });

  it("increment_iteration — bumps by 1", () => {
    const next = transition(initial, { type: "increment_iteration" });
    expect(next.iteration).toBe(1);

    const next2 = transition(next, { type: "increment_iteration" });
    expect(next2.iteration).toBe(2);
  });

  it("add_tokens — accumulates usage", () => {
    const next = transition(initial, {
      type: "add_tokens",
      usage: { input: 100, output: 50 },
    });
    expect(next.tokenUsage).toEqual({ input: 100, output: 50 });

    const next2 = transition(next, {
      type: "add_tokens",
      usage: { input: 200, output: 100 },
    });
    expect(next2.tokenUsage).toEqual({ input: 300, output: 150 });
  });

  it("add_tool_calls — accumulates count", () => {
    const next = transition(initial, { type: "add_tool_calls", count: 3 });
    expect(next.toolCallCount).toBe(3);

    const next2 = transition(next, { type: "add_tool_calls", count: 2 });
    expect(next2.toolCallCount).toBe(5);
  });

  it("set_blocked — sets blocked + reason", () => {
    const next = transition(initial, {
      type: "set_blocked",
      reason: "Permission denied",
    });
    expect(next.blocked).toBe(true);
    expect(next.error).toBe("Permission denied");
  });

  it("set_error — sets error phase + message", () => {
    const next = transition(initial, {
      type: "set_error",
      error: "LLM call failed",
    });
    expect(next.phase).toBe(LoopPhase.Error);
    expect(next.error).toBe("LLM call failed");
  });

  it("reset_blocked — clears blocked + error", () => {
    const blocked = transition(initial, {
      type: "set_blocked",
      reason: "test",
    });
    const next = transition(blocked, { type: "reset_blocked" });
    expect(next.blocked).toBe(false);
    expect(next.error).toBeUndefined();
  });

  it("does not mutate original state", () => {
    const before = createInitialState(10);
    transition(before, { type: "increment_iteration" });
    expect(before.iteration).toBe(0);
  });
});
