import { describe, it, expect } from "vitest";
import { AgenticLoop } from "../../src/loop/loop.js";
import { MockLLMAdapter } from "../../src/llm/mock-adapter.js";
import { DefaultToolRegistry } from "../../src/tool/registry.js";
import { DefaultToolExecutor } from "../../src/tool/executor.js";
import { makeLoopConfig } from "../helpers/factories.js";
import type { LoopEvent } from "../../src/loop/types.js";

describe("Plan Mode", () => {
  it("returns plan_pending when planMode is true", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "Step 1: Read files\nStep 2: Analyze\nStep 3: Report" });

    const loop = new AgenticLoop(
      makeLoopConfig(llm, { planMode: true })
    );
    const result = await loop.run("Analyze the codebase", "session-1");

    expect(result.finishReason).toBe("plan_pending");
    expect(result.output).toContain("Step 1");
    expect(result.output).toContain("Step 2");
    expect(result.iterations).toBe(0);
  });

  it("emits plan:ready event", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "My plan is..." });

    const events: LoopEvent[] = [];
    const loop = new AgenticLoop(
      makeLoopConfig(llm, {
        planMode: true,
        onEvent: (e) => events.push(e),
      })
    );
    await loop.run("Do something", "session-1");

    const planEvent = events.find((e) => e.type === "plan:ready");
    expect(planEvent).toBeDefined();
    if (planEvent?.type === "plan:ready") {
      expect(planEvent.plan).toBe("My plan is...");
    }
  });

  it("sends no tools to LLM during planning", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "Plan without tools" });

    const tools = new DefaultToolRegistry();
    tools.register({
      name: "read_file",
      description: "Read file",
      parameters: { type: "object" },
      execute: async () => ({ success: true, content: "data" }),
    });

    const loop = new AgenticLoop(
      makeLoopConfig(llm, {
        planMode: true,
        tools,
        executor: new DefaultToolExecutor(tools),
      })
    );
    await loop.run("Plan this", "session-1");

    // LLM request should have empty tools (plan mode forces no tools)
    const request = llm.requests[0];
    expect(request.tools ?? []).toHaveLength(0);
  });

  it("executes normally with approvedPlan (skips planning)", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "Done! I followed the plan." });

    const loop = new AgenticLoop(
      makeLoopConfig(llm, {
        planMode: true,
        approvedPlan: "Step 1: Do X\nStep 2: Do Y",
      })
    );
    const result = await loop.run("Execute the plan", "session-1");

    expect(result.finishReason).toBe("complete");
    expect(result.output).toBe("Done! I followed the plan.");
    expect(result.iterations).toBe(1);
  });

  it("injects approved plan into system prompt", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "Following plan." });

    const loop = new AgenticLoop(
      makeLoopConfig(llm, {
        planMode: true,
        approvedPlan: "Step 1: Read\nStep 2: Write",
      })
    );
    await loop.run("Go", "session-1");

    const request = llm.requests[0];
    expect(request.systemPrompt).toContain("Step 1: Read");
    expect(request.systemPrompt).toContain("approved-plan");
  });

  it("tracks token usage during planning", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({
      text: "Plan here",
      usage: { inputTokens: 500, outputTokens: 200 },
    });

    const loop = new AgenticLoop(
      makeLoopConfig(llm, { planMode: true })
    );
    const result = await loop.run("Plan", "session-1");

    expect(result.totalTokens.input).toBe(500);
    expect(result.totalTokens.output).toBe(200);
  });

  it("runs normally when planMode is false", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "Normal response" });

    const loop = new AgenticLoop(
      makeLoopConfig(llm, { planMode: false })
    );
    const result = await loop.run("Hello", "session-1");

    expect(result.finishReason).toBe("complete");
    expect(result.output).toBe("Normal response");
  });
});
