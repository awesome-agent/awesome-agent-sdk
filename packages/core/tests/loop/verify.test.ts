import { describe, it, expect } from "vitest";
import { verifyPhase } from "../../src/loop/verify.js";
import { DefaultHookManager } from "../../src/hook/manager.js";
import { MockLLMAdapter } from "../../src/llm/mock-adapter.js";
import { HookEvent } from "../../src/hook/types.js";
import { makeLoopConfig } from "../helpers/factories.js";
import type { LoopConfig } from "../../src/loop/types.js";

// ─── Factory ─────────────────────────────────────────────────

function makeConfig(overrides?: Partial<LoopConfig>): LoopConfig {
  const llm = new MockLLMAdapter();
  return makeLoopConfig(llm, overrides);
}

// ─── Tests ───────────────────────────────────────────────────

describe("verifyPhase", () => {
  it("returns false (stop loop) when no hooks registered", async () => {
    const config = makeConfig();

    const shouldContinue = await verifyPhase(config, "output", "stop", "s1");

    expect(shouldContinue).toBe(false);
  });

  it("returns false when hook action is continue", async () => {
    const hooks = new DefaultHookManager();
    hooks.register({
      name: "observer",
      event: HookEvent.Stop,
      handler: async () => ({ action: "continue" as const }),
    });

    const config = makeConfig({ hooks });
    const shouldContinue = await verifyPhase(config, "output", "stop", "s1");

    expect(shouldContinue).toBe(false);
  });

  it("returns true (continue loop) when hook blocks exit", async () => {
    const hooks = new DefaultHookManager();
    hooks.register({
      name: "force-continue",
      event: HookEvent.Stop,
      handler: async () => ({
        action: "block" as const,
        reason: "not done yet",
      }),
    });

    const config = makeConfig({ hooks });
    const shouldContinue = await verifyPhase(config, "partial", "stop", "s1");

    expect(shouldContinue).toBe(true);
  });

  it("dispatches Stop event with correct payload", async () => {
    let receivedOutput = "";
    let receivedReason = "";

    const hooks = new DefaultHookManager();
    hooks.register({
      name: "spy",
      event: HookEvent.Stop,
      handler: async (payload) => {
        receivedOutput = payload.data.output;
        receivedReason = payload.data.finishReason;
        return { action: "continue" as const };
      },
    });

    const config = makeConfig({ hooks });
    await verifyPhase(config, "final answer", "stop", "s1");

    expect(receivedOutput).toBe("final answer");
    expect(receivedReason).toBe("stop");
  });

  it("handles tool_calls finish reason", async () => {
    let receivedReason = "";

    const hooks = new DefaultHookManager();
    hooks.register({
      name: "spy",
      event: HookEvent.Stop,
      handler: async (payload) => {
        receivedReason = payload.data.finishReason;
        return { action: "continue" as const };
      },
    });

    const config = makeConfig({ hooks });
    await verifyPhase(config, "", "tool_calls", "s1");

    expect(receivedReason).toBe("tool_calls");
  });
});
