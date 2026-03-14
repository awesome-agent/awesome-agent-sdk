import { describe, it, expect } from "vitest";
import { DefaultToolExecutor } from "../../src/tool/executor.js";
import { DefaultToolRegistry } from "../../src/tool/registry.js";
import { makeTool } from "../helpers/factories.js";
import type { ToolCall, ToolContext } from "../../src/tool/types.js";
import type { ToolMiddlewarePipeline } from "../../src/tool/middleware-types.js";

const ctx: ToolContext = {
  sessionId: "s1",
  agentId: "a1",
  extensions: {},
};

describe("DefaultToolExecutor", () => {
  it("executes a single tool call", async () => {
    const reg = new DefaultToolRegistry();
    reg.register(makeTool("echo", "hello"));
    const exec = new DefaultToolExecutor(reg);

    const calls: ToolCall[] = [{ id: "c1", name: "echo", args: {} }];
    const result = await exec.execute(calls, ctx);

    expect(result.results.get("c1")).toEqual({
      success: true,
      content: "hello",
    });
    expect(result.blocked).toBe(false);
    expect(result.errors).toHaveLength(0);
  });

  it("executes multiple tool calls in parallel", async () => {
    const reg = new DefaultToolRegistry();
    reg.register(makeTool("a", "result-a"));
    reg.register(makeTool("b", "result-b"));
    const exec = new DefaultToolExecutor(reg);

    const calls: ToolCall[] = [
      { id: "c1", name: "a", args: {} },
      { id: "c2", name: "b", args: {} },
    ];
    const result = await exec.execute(calls, ctx);

    expect(result.results.get("c1")?.content).toBe("result-a");
    expect(result.results.get("c2")?.content).toBe("result-b");
    expect(result.errors).toHaveLength(0);
  });

  it("handles unknown tool gracefully", async () => {
    const reg = new DefaultToolRegistry();
    const exec = new DefaultToolExecutor(reg);

    const calls: ToolCall[] = [{ id: "c1", name: "missing", args: {} }];
    const result = await exec.execute(calls, ctx);

    expect(result.results.get("c1")?.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].toolName).toBe("missing");
  });

  it("catches tool execution errors", async () => {
    const reg = new DefaultToolRegistry();
    reg.register({
      name: "boom",
      description: "Throws",
      parameters: { type: "object" },
      execute: async () => {
        throw new Error("kaboom");
      },
    });
    const exec = new DefaultToolExecutor(reg);

    const calls: ToolCall[] = [{ id: "c1", name: "boom", args: {} }];
    const result = await exec.execute(calls, ctx);

    expect(result.results.get("c1")?.success).toBe(false);
    expect(result.results.get("c1")?.content).toBe("kaboom");
    expect(result.errors).toHaveLength(1);
  });

  it("runs middleware before — block", async () => {
    const reg = new DefaultToolRegistry();
    reg.register(makeTool("echo"));

    const pipeline: ToolMiddlewarePipeline = {
      runBefore: async () => ({ action: "block", reason: "nope" }),
      runAfter: async (_ctx, r) => r,
    };
    const exec = new DefaultToolExecutor(reg, pipeline);

    const result = await exec.execute(
      [{ id: "c1", name: "echo", args: {} }],
      ctx
    );

    expect(result.blocked).toBe(true);
    expect(result.results.get("c1")?.success).toBe(false);
    expect(result.results.get("c1")?.content).toContain("Blocked");
  });

  it("runs middleware before — modify args", async () => {
    const reg = new DefaultToolRegistry();
    const receivedArgs: Record<string, unknown>[] = [];
    reg.register({
      name: "echo",
      description: "Echo",
      parameters: { type: "object" },
      execute: async (args) => {
        receivedArgs.push(args);
        return { success: true, content: "ok" };
      },
    });

    const pipeline: ToolMiddlewarePipeline = {
      runBefore: async () => ({
        action: "modify",
        args: { injected: true },
      }),
      runAfter: async (_ctx, r) => r,
    };
    const exec = new DefaultToolExecutor(reg, pipeline);

    await exec.execute([{ id: "c1", name: "echo", args: { original: true } }], ctx);

    expect(receivedArgs[0]).toEqual({ injected: true });
  });

  it("runs middleware after — transforms result", async () => {
    const reg = new DefaultToolRegistry();
    reg.register(makeTool("echo", "original"));

    const pipeline: ToolMiddlewarePipeline = {
      runBefore: async () => ({ action: "continue" }),
      runAfter: async () => ({ success: true, content: "transformed" }),
    };
    const exec = new DefaultToolExecutor(reg, pipeline);

    const result = await exec.execute(
      [{ id: "c1", name: "echo", args: {} }],
      ctx
    );
    expect(result.results.get("c1")?.content).toBe("transformed");
  });
});
