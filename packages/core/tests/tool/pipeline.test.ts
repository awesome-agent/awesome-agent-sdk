import { describe, it, expect } from "vitest";
import { MiddlewarePipeline } from "../../src/tool/pipeline.js";
import type { Middleware, MiddlewareContext } from "../../src/tool/middleware-types.js";

const baseCtx: MiddlewareContext = {
  toolCall: { id: "c1", name: "test", args: { x: 1 } },
  tool: {
    name: "test",
    description: "Test tool",
    parameters: { type: "object" },
    execute: async () => ({ success: true, content: "ok" }),
  },
  toolContext: { sessionId: "s1", agentId: "a1", extensions: {} },
};

describe("MiddlewarePipeline", () => {
  describe("runBefore", () => {
    it("returns continue when no middlewares", async () => {
      const pipeline = new MiddlewarePipeline();
      const result = await pipeline.runBefore(baseCtx);
      expect(result.action).toBe("continue");
    });

    it("first block wins", async () => {
      const pipeline = new MiddlewarePipeline();
      const calls: string[] = [];

      pipeline.add({
        name: "blocker",
        before: async () => {
          calls.push("blocker");
          return { action: "block", reason: "denied" };
        },
      });
      pipeline.add({
        name: "after",
        before: async () => {
          calls.push("after");
          return { action: "continue" };
        },
      });

      const result = await pipeline.runBefore(baseCtx);
      expect(result.action).toBe("block");
      expect(calls).toEqual(["blocker"]); // second not called
    });

    it("accumulates arg modifications across middlewares", async () => {
      const pipeline = new MiddlewarePipeline();

      pipeline.add({
        name: "m1",
        before: async () => ({
          action: "modify",
          args: { x: 1, added1: true },
        }),
      });
      pipeline.add({
        name: "m2",
        before: async (ctx) => ({
          action: "modify",
          args: { ...ctx.toolCall.args, added2: true },
        }),
      });

      const result = await pipeline.runBefore(baseCtx);
      expect(result.action).toBe("modify");
      if (result.action === "modify") {
        expect(result.args).toEqual({ x: 1, added1: true, added2: true });
      }
    });

    it("returns continue when all middlewares continue (no arg change)", async () => {
      const pipeline = new MiddlewarePipeline();
      pipeline.add({
        name: "noop",
        before: async () => ({ action: "continue" }),
      });

      const result = await pipeline.runBefore(baseCtx);
      expect(result.action).toBe("continue");
    });

    it("skips middlewares without before()", async () => {
      const pipeline = new MiddlewarePipeline();
      pipeline.add({
        name: "after-only",
        after: async (_ctx) => ({ success: true, content: "ok" }),
      });

      const result = await pipeline.runBefore(baseCtx);
      expect(result.action).toBe("continue");
    });
  });

  describe("runAfter", () => {
    it("returns original result when no middlewares", async () => {
      const pipeline = new MiddlewarePipeline();
      const result = await pipeline.runAfter(baseCtx, {
        success: true,
        content: "original",
      });
      expect(result.content).toBe("original");
    });

    it("chains result transformations", async () => {
      const pipeline = new MiddlewarePipeline();

      pipeline.add({
        name: "m1",
        after: async (ctx) => ({
          ...ctx.result,
          content: ctx.result.content + "+m1",
        }),
      });
      pipeline.add({
        name: "m2",
        after: async (ctx) => ({
          ...ctx.result,
          content: ctx.result.content + "+m2",
        }),
      });

      const result = await pipeline.runAfter(baseCtx, {
        success: true,
        content: "base",
      });
      expect(result.content).toBe("base+m1+m2");
    });

    it("skips middlewares without after()", async () => {
      const pipeline = new MiddlewarePipeline();
      pipeline.add({
        name: "before-only",
        before: async () => ({ action: "continue" }),
      });

      const result = await pipeline.runAfter(baseCtx, {
        success: true,
        content: "unchanged",
      });
      expect(result.content).toBe("unchanged");
    });
  });

  describe("remove", () => {
    it("removes middleware by name", async () => {
      const pipeline = new MiddlewarePipeline();
      pipeline.add({
        name: "m1",
        before: async () => ({ action: "block", reason: "blocked" }),
      });
      pipeline.remove("m1");

      const result = await pipeline.runBefore(baseCtx);
      expect(result.action).toBe("continue");
    });

    it("remove non-existent does nothing", () => {
      const pipeline = new MiddlewarePipeline();
      expect(() => pipeline.remove("nope")).not.toThrow();
    });
  });
});
