import { describe, it, expect } from "vitest";
import { AgenticLoop } from "../../src/loop/loop.js";
import { MockLLMAdapter } from "../../src/llm/mock-adapter.js";
import { DefaultToolRegistry } from "../../src/tool/registry.js";
import { DefaultToolExecutor } from "../../src/tool/executor.js";
import { DefaultSkillRegistry } from "../../src/skill/registry.js";
import { DefaultSkillDetector } from "../../src/skill/detector.js";
import { makeAgent, makeTool, makeLoopConfig } from "../helpers/factories.js";
import type { LoopConfig, LoopEvent } from "../../src/loop/types.js";

describe("AgenticLoop", () => {
  it("completes with text-only response", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "Hello! How can I help?" });

    const loop = new AgenticLoop(makeLoopConfig(llm));
    const result = await loop.run("hi", "session-1");

    expect(result.success).toBe(true);
    expect(result.output).toBe("Hello! How can I help?");
    expect(result.finishReason).toBe("complete");
    expect(result.iterations).toBe(1);
  });

  it("executes tool calls then completes", async () => {
    const llm = new MockLLMAdapter();

    // First response: tool call
    llm.addResponse({
      toolCalls: [{ id: "tc1", name: "echo", args: { msg: "test" } }],
    });
    // Second response: final text
    llm.addResponse({ text: "Done! I ran the tool." });

    const tools = new DefaultToolRegistry();
    tools.register(makeTool("echo", "echo result"));

    const loop = new AgenticLoop(
      makeLoopConfig(llm, {
        tools,
        executor: new DefaultToolExecutor(tools),
      })
    );
    const result = await loop.run("run echo", "session-1");

    expect(result.success).toBe(true);
    expect(result.output).toBe("Done! I ran the tool.");
    expect(result.iterations).toBe(2);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("echo");
  });

  it("respects maxIterations", async () => {
    const llm = new MockLLMAdapter();
    // Queue enough tool-call responses to exceed max
    for (let i = 0; i < 5; i++) {
      llm.addResponse({
        toolCalls: [{ id: `tc${i}`, name: "echo", args: {} }],
      });
    }

    const tools = new DefaultToolRegistry();
    tools.register(makeTool("echo"));

    const loop = new AgenticLoop(
      makeLoopConfig(llm, {
        agent: makeAgent({ maxIterations: 3 }),
        tools,
        executor: new DefaultToolExecutor(tools),
      })
    );

    const result = await loop.run("keep going", "session-1");

    expect(result.finishReason).toBe("max_iterations");
    expect(result.iterations).toBe(3);
  });

  it("handles abort signal", async () => {
    const controller = new AbortController();
    controller.abort(); // pre-abort

    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "should not reach" });

    const loop = new AgenticLoop(makeLoopConfig(llm));
    const result = await loop.run("hi", "session-1", { abort: controller.signal });

    expect(result.finishReason).toBe("cancelled");
    expect(result.success).toBe(false);
  });

  it("emits events via onEvent callback", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "hi" });

    const events: LoopEvent[] = [];
    const loop = new AgenticLoop(
      makeLoopConfig(llm, {
        onEvent: (e) => events.push(e),
      })
    );

    await loop.run("test", "session-1");

    const types = events.map((e) => e.type);
    expect(types).toContain("phase:change");
    expect(types).toContain("text:delta");
    expect(types).toContain("iteration:end");
    expect(types).toContain("done");
  });

  it("handles LLM error gracefully", async () => {
    const llm = new MockLLMAdapter(); // no responses queued → will throw

    const events: LoopEvent[] = [];
    const loop = new AgenticLoop(
      makeLoopConfig(llm, {
        onEvent: (e) => events.push(e),
      })
    );

    const result = await loop.run("hi", "session-1");

    expect(result.finishReason).toBe("error");
    expect(result.success).toBe(false);
    expect(events.some((e) => e.type === "error")).toBe(true);
  });

  it("tracks token usage across iterations", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({
      text: "step 1",
      toolCalls: [{ id: "tc1", name: "echo", args: {} }],
      usage: { inputTokens: 100, outputTokens: 50 },
      finishReason: "tool_calls",
    });
    llm.addResponse({
      text: "step 2",
      usage: { inputTokens: 200, outputTokens: 100 },
    });

    const tools = new DefaultToolRegistry();
    tools.register(makeTool("echo"));

    const loop = new AgenticLoop(
      makeLoopConfig(llm, {
        tools,
        executor: new DefaultToolExecutor(tools),
      })
    );
    const result = await loop.run("test", "session-1");

    expect(result.totalTokens.input).toBe(300);
    expect(result.totalTokens.output).toBe(150);
  });

  it("skill detection injects skill prompt into context", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "I'll help with Revit." });

    const skillReg = new DefaultSkillRegistry();
    skillReg.register({
      name: "revit",
      description: "Revit skill",
      triggers: [{ type: "keyword", keyword: "wall" }],
    });

    const loop = new AgenticLoop(
      makeLoopConfig(llm, {
        skills: skillReg,
        skillDetector: new DefaultSkillDetector(),
        skillLoader: {
          loadPrompt: async (name) => `<${name} instructions>`,
        },
      })
    );

    await loop.run("create a wall", "session-1");

    // Verify the system prompt in the LLM request contains skill content
    const request = llm.requests[0];
    expect(request.systemPrompt).toContain("revit instructions");
  });
});
