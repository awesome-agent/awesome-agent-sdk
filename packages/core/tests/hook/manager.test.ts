import { describe, it, expect } from "vitest";
import { DefaultHookManager } from "../../src/hook/manager.js";
import { HookEvent } from "../../src/hook/types.js";
import type { Hook, HookResult } from "../../src/hook/types.js";
import { DuplicateRegistrationError } from "../../src/errors.js";

function makeHook(
  name: string,
  event: HookEvent,
  handler: Hook["handler"],
  priority?: number
): Hook {
  return { name, event, priority, handler };
}

describe("DefaultHookManager", () => {
  it("registers and retrieves hooks", () => {
    const mgr = new DefaultHookManager();
    const hook = makeHook("h1", HookEvent.SessionStart, async () => ({
      action: "continue" as const,
    }));

    mgr.register(hook);
    expect(mgr.getHooks(HookEvent.SessionStart)).toHaveLength(1);
    expect(mgr.getHooks(HookEvent.SessionEnd)).toHaveLength(0);
  });

  it("throws on duplicate hook name", () => {
    const mgr = new DefaultHookManager();
    const hook = makeHook("h1", HookEvent.SessionStart, async () => ({
      action: "continue" as const,
    }));

    mgr.register(hook);
    expect(() => mgr.register(hook)).toThrow(DuplicateRegistrationError);
  });

  it("unregisters hooks", () => {
    const mgr = new DefaultHookManager();
    const hook = makeHook("h1", HookEvent.SessionStart, async () => ({
      action: "continue" as const,
    }));

    mgr.register(hook);
    mgr.unregister("h1");
    expect(mgr.getHooks(HookEvent.SessionStart)).toHaveLength(0);
  });

  it("unregister non-existent does nothing", () => {
    const mgr = new DefaultHookManager();
    expect(() => mgr.unregister("nope")).not.toThrow();
  });

  it("dispatches and returns continue when no hooks", async () => {
    const mgr = new DefaultHookManager();
    const result = await mgr.dispatch(
      HookEvent.SessionStart,
      { agentId: "a1" },
      "s1"
    );
    expect(result.action).toBe("continue");
  });

  it("dispatches block — stops early", async () => {
    const mgr = new DefaultHookManager();
    const calls: string[] = [];

    mgr.register(
      makeHook("blocker", HookEvent.Stop, async () => {
        calls.push("blocker");
        return { action: "block", reason: "denied" };
      })
    );
    mgr.register(
      makeHook("after", HookEvent.Stop, async () => {
        calls.push("after");
        return { action: "continue" };
      })
    );

    const result = await mgr.dispatch(
      HookEvent.Stop,
      { output: "", finishReason: "stop" },
      "s1"
    );

    expect(result.action).toBe("block");
    expect(calls).toEqual(["blocker"]); // second hook not called
  });

  it("dispatches modify — returns last modify", async () => {
    const mgr = new DefaultHookManager();

    mgr.register(
      makeHook("m1", HookEvent.PreToolUse, async () => ({
        action: "modify" as const,
        data: { args: { x: 1 } },
      }))
    );
    mgr.register(
      makeHook("m2", HookEvent.PreToolUse, async () => ({
        action: "modify" as const,
        data: { args: { x: 2 } },
      }))
    );

    const result = await mgr.dispatch(
      HookEvent.PreToolUse,
      { toolCall: { id: "c1", name: "t1", args: {} } },
      "s1"
    );

    expect(result.action).toBe("modify");
    if (result.action === "modify") {
      expect(result.data.args).toEqual({ x: 2 });
    }
  });

  it("respects priority ordering — lower runs first", async () => {
    const mgr = new DefaultHookManager();
    const calls: string[] = [];

    mgr.register(
      makeHook(
        "low",
        HookEvent.SessionStart,
        async () => {
          calls.push("low");
          return { action: "continue" };
        },
        200
      )
    );
    mgr.register(
      makeHook(
        "high",
        HookEvent.SessionStart,
        async () => {
          calls.push("high");
          return { action: "continue" };
        },
        10
      )
    );

    await mgr.dispatch(HookEvent.SessionStart, { agentId: "a1" }, "s1");
    expect(calls).toEqual(["high", "low"]);
  });

  it("hook registered for multiple events", () => {
    const mgr = new DefaultHookManager();
    const hook: Hook = {
      name: "multi",
      event: [HookEvent.SessionStart, HookEvent.SessionEnd],
      handler: async () => ({ action: "continue" as const }),
    };

    mgr.register(hook);
    expect(mgr.getHooks(HookEvent.SessionStart)).toHaveLength(1);
    expect(mgr.getHooks(HookEvent.SessionEnd)).toHaveLength(1);
  });

  it("getHooks returns defensive copy", () => {
    const mgr = new DefaultHookManager();
    mgr.register(
      makeHook("h1", HookEvent.SessionStart, async () => ({
        action: "continue" as const,
      }))
    );

    const hooks = mgr.getHooks(HookEvent.SessionStart);
    hooks.length = 0; // mutate the returned array
    expect(mgr.getHooks(HookEvent.SessionStart)).toHaveLength(1);
  });
});
