import { describe, it, expect } from "vitest";
import { thinkPhase } from "../../src/loop/think.js";
import { MockLLMAdapter } from "../../src/llm/mock-adapter.js";
import { DefaultHookManager } from "../../src/hook/manager.js";
import { DefaultToolRegistry } from "../../src/tool/registry.js";
import { DefaultToolExecutor } from "../../src/tool/executor.js";
import { HookEvent } from "../../src/hook/types.js";
import { LoopPhase } from "../../src/loop/types.js";
import { makeAgent, makeTool, makeLoopConfig } from "../helpers/factories.js";
import type { LoopConfig, LoopEvent, LoopState } from "../../src/loop/types.js";

// ─── Factories ───────────────────────────────────────────────

function makeState(overrides?: Partial<LoopState>): LoopState {
  return {
    phase: LoopPhase.Thinking,
    iteration: 1,
    maxIterations: 10,
    tokenUsage: { input: 0, output: 0 },
    toolCallCount: 0,
    blocked: false,
    ...overrides,
  };
}

function makeConfig(
  llm: MockLLMAdapter,
  overrides?: Partial<LoopConfig>
): LoopConfig {
  return makeLoopConfig(llm, overrides);
}

function noopEmit(_event: LoopEvent): void {}

// ─── Tests ───────────────────────────────────────────────────

describe("thinkPhase", () => {
  it("returns text from LLM stream", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "Hello world" });

    const result = await thinkPhase(
      makeConfig(llm), noopEmit, "system", [], makeState(), "s1"
    );

    expect(result.text).toBe("Hello world");
    expect(result.finishReason).toBe("stop");
  });

  it("returns tool calls from LLM stream", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({
      toolCalls: [{ id: "tc1", name: "read", args: { path: "/a" } }],
    });

    const result = await thinkPhase(
      makeConfig(llm), noopEmit, "system", [], makeState(), "s1"
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("read");
    expect(result.toolCalls[0].args).toEqual({ path: "/a" });
    expect(result.finishReason).toBe("tool_calls");
  });

  it("emits text:delta events", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "Hi" });

    const events: LoopEvent[] = [];
    await thinkPhase(
      makeConfig(llm), (e) => events.push(e), "system", [], makeState(), "s1"
    );

    const deltas = events.filter((e) => e.type === "text:delta");
    expect(deltas).toHaveLength(1);
    expect(deltas[0].type === "text:delta" && deltas[0].text).toBe("Hi");
  });

  it("sends tool definitions to LLM", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "ok" });

    const tools = new DefaultToolRegistry();
    tools.register(makeTool("read_file"));
    tools.register(makeTool("write_file"));

    await thinkPhase(
      makeConfig(llm, { tools, executor: new DefaultToolExecutor(tools) }),
      noopEmit, "system", [], makeState(), "s1"
    );

    const request = llm.requests[0];
    expect(request.tools).toHaveLength(2);
    expect(request.tools![0].name).toBe("read_file");
    expect(request.tools![1].name).toBe("write_file");
  });

  it("sends empty tools when forceNoTools is true", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "plan" });

    const tools = new DefaultToolRegistry();
    tools.register(makeTool("read_file"));

    await thinkPhase(
      makeConfig(llm, { tools, executor: new DefaultToolExecutor(tools) }),
      noopEmit, "system", [], makeState(), "s1",
      true // forceNoTools
    );

    const request = llm.requests[0];
    expect(request.tools).toHaveLength(0);
  });

  it("disables tools when iteration exceeds maxSteps", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "final" });

    const tools = new DefaultToolRegistry();
    tools.register(makeTool("read"));

    const state = makeState({ iteration: 6, maxIterations: 10 });
    const agent = makeAgent({ maxSteps: 5 });

    await thinkPhase(
      makeConfig(llm, { agent, tools, executor: new DefaultToolExecutor(tools) }),
      noopEmit, "system", [], state, "s1"
    );

    const request = llm.requests[0];
    expect(request.tools).toHaveLength(0);
  });

  it("PreLLMCall hook can block the call", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "should not reach" });

    const hooks = new DefaultHookManager();
    hooks.register({
      name: "blocker",
      event: HookEvent.PreLLMCall,
      handler: async () => ({ action: "block" as const, reason: "rate limit" }),
    });

    const { LLMBlockedError } = await import("../../src/errors.js");
    try {
      await thinkPhase(
        makeConfig(llm, { hooks }), noopEmit, "system", [], makeState(), "s1"
      );
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(LLMBlockedError);
      expect((e as InstanceType<typeof LLMBlockedError>).reason).toBe("rate limit");
    }
  });

  it("PreLLMCall hook can modify request", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "modified" });

    const hooks = new DefaultHookManager();
    hooks.register({
      name: "modifier",
      event: HookEvent.PreLLMCall,
      handler: async (payload) => {
        const original = payload.data.request;
        return {
          action: "modify" as const,
          data: {
            request: { ...original, temperature: 0.1 },
          },
        };
      },
    });

    await thinkPhase(
      makeConfig(llm, { hooks }), noopEmit, "system", [], makeState(), "s1"
    );

    expect(llm.requests[0].temperature).toBe(0.1);
  });

  it("uses default model and temperature from agent config", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "ok" });

    const agent = makeAgent({ model: "gpt-4o", temperature: 0.3 });
    await thinkPhase(
      makeConfig(llm, { agent }), noopEmit, "system", [], makeState(), "s1"
    );

    expect(llm.requests[0].model).toBe("gpt-4o");
    expect(llm.requests[0].temperature).toBe(0.3);
  });

  it("returns usage from LLM stream", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({
      text: "ok",
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const result = await thinkPhase(
      makeConfig(llm), noopEmit, "system", [], makeState(), "s1"
    );

    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(50);
  });
});
