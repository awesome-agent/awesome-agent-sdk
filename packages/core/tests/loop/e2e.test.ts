import { describe, it, expect } from "vitest";
import { AgenticLoop } from "../../src/loop/loop.js";
import { MockLLMAdapter } from "../../src/llm/mock-adapter.js";
import { DefaultToolRegistry } from "../../src/tool/registry.js";
import { DefaultToolExecutor } from "../../src/tool/executor.js";
import { DefaultSkillRegistry } from "../../src/skill/registry.js";
import { DefaultSkillDetector } from "../../src/skill/detector.js";
import { DefaultHookManager } from "../../src/hook/manager.js";
import { HookEvent } from "../../src/hook/types.js";
import { makeAgent, makeTool, makeLoopConfig, makeMCPClient, makeMemoryStore } from "../helpers/factories.js";
import type { LoopConfig, LoopEvent } from "../../src/loop/types.js";

function makeConfig(
  llm: MockLLMAdapter,
  overrides?: Partial<LoopConfig>
): LoopConfig {
  return makeLoopConfig(llm, overrides);
}

// ─── E2E Scenarios ───────────────────────────────────────────

describe("E2E Integration", () => {
  it("multi-step tool chain: read → analyze → respond", async () => {
    const llm = new MockLLMAdapter();

    // Step 1: LLM calls read_file
    llm.addResponse({
      toolCalls: [{ id: "tc1", name: "read_file", args: { path: "/data.json" } }],
    });
    // Step 2: LLM calls analyze
    llm.addResponse({
      toolCalls: [{ id: "tc2", name: "analyze", args: { data: "raw" } }],
    });
    // Step 3: LLM produces final text
    llm.addResponse({ text: "Analysis complete. Found 3 issues." });

    const tools = new DefaultToolRegistry();
    tools.register(makeTool("read_file", '{"items": [1,2,3]}'));
    tools.register(makeTool("analyze", "3 issues found"));

    const events: LoopEvent[] = [];
    const loop = new AgenticLoop(
      makeConfig(llm, {
        tools,
        executor: new DefaultToolExecutor(tools),
        onEvent: (e) => events.push(e),
      })
    );

    const result = await loop.run("Analyze data.json", "s1");

    expect(result.success).toBe(true);
    expect(result.output).toBe("Analysis complete. Found 3 issues.");
    expect(result.iterations).toBe(3);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].name).toBe("read_file");
    expect(result.toolCalls[1].name).toBe("analyze");

    // Verify events: 2 tool:start + 2 tool:end
    const toolStarts = events.filter((e) => e.type === "tool:start");
    const toolEnds = events.filter((e) => e.type === "tool:end");
    expect(toolStarts).toHaveLength(2);
    expect(toolEnds).toHaveLength(2);
  });

  it("plan mode → approve → execute with tools", async () => {
    const llm = new MockLLMAdapter();

    // Phase 1: Planning
    llm.addResponse({ text: "Step 1: Read file\nStep 2: Process" });

    const planLoop = new AgenticLoop(
      makeConfig(llm, { planMode: true })
    );
    const planResult = await planLoop.run("Process data", "s1");

    expect(planResult.finishReason).toBe("plan_pending");
    expect(planResult.output).toContain("Step 1: Read file");
    expect(planResult.toolCalls).toHaveLength(0);

    // Phase 2: Execution with approved plan
    const llm2 = new MockLLMAdapter();
    llm2.addResponse({
      toolCalls: [{ id: "tc1", name: "read", args: {} }],
    });
    llm2.addResponse({ text: "Done following the plan." });

    const tools = new DefaultToolRegistry();
    tools.register(makeTool("read", "file data"));

    const execLoop = new AgenticLoop(
      makeConfig(llm2, {
        planMode: true,
        approvedPlan: planResult.output,
        tools,
        executor: new DefaultToolExecutor(tools),
      })
    );
    const execResult = await execLoop.run("Process data", "s2");

    expect(execResult.finishReason).toBe("complete");
    expect(execResult.output).toBe("Done following the plan.");
    expect(execResult.toolCalls).toHaveLength(1);

    // Verify plan was injected into system prompt
    expect(llm2.requests[0].systemPrompt).toContain("approved-plan");
    expect(llm2.requests[0].systemPrompt).toContain("Step 1: Read file");
  });

  it("memory-informed response", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "I see you prefer TypeScript." });

    const memory = makeMemoryStore([
      {
        id: "m1",
        type: "user",
        name: "language-pref",
        content: "User prefers TypeScript over JavaScript",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    const loop = new AgenticLoop(
      makeConfig(llm, { memory })
    );
    const result = await loop.run("What language should I use?", "s1");

    expect(result.success).toBe(true);
    // Memory content should appear in system prompt
    expect(llm.requests[0].systemPrompt).toContain("TypeScript over JavaScript");
  });

  it("MCP tool discovery and execution", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({
      toolCalls: [{ id: "tc1", name: "revit_execute_script", args: { code: "test" } }],
    });
    llm.addResponse({ text: "Script executed successfully." });

    const mcpClient = makeMCPClient(
      "revit",
      [{ name: "execute_script", inputSchema: { type: "object" } }],
      { content: [{ type: "text", text: "script output" }] }
    );

    const tools = new DefaultToolRegistry();
    const loop = new AgenticLoop(
      makeConfig(llm, {
        tools,
        executor: new DefaultToolExecutor(tools),
        mcpClients: [mcpClient],
      })
    );

    const result = await loop.run("Run a script", "s1");

    expect(result.success).toBe(true);
    expect(tools.has("revit_execute_script")).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("revit_execute_script");
  });

  it("error recovery: tool fails, LLM adjusts", async () => {
    const llm = new MockLLMAdapter();

    // First: LLM calls a tool that fails
    llm.addResponse({
      toolCalls: [{ id: "tc1", name: "risky_op", args: {} }],
    });
    // Second: LLM sees error and responds with fallback
    llm.addResponse({ text: "The operation failed. Here's an alternative approach." });

    const tools = new DefaultToolRegistry();
    tools.register(makeTool("risky_op", "Permission denied", false));

    const loop = new AgenticLoop(
      makeConfig(llm, {
        tools,
        executor: new DefaultToolExecutor(tools),
      })
    );

    const result = await loop.run("Do risky operation", "s1");

    expect(result.success).toBe(true);
    expect(result.output).toContain("alternative approach");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].error).toBe("Permission denied");
  });

  it("abort mid-execution", async () => {
    const controller = new AbortController();

    const llm = new MockLLMAdapter();
    llm.addResponse({
      toolCalls: [{ id: "tc1", name: "slow", args: {} }],
    });
    llm.addResponse({ text: "should not reach" });

    const tools = new DefaultToolRegistry();
    tools.register({
      name: "slow",
      description: "Slow tool",
      parameters: { type: "object" },
      execute: async () => {
        // Abort during tool execution
        controller.abort();
        return { success: true, content: "done" };
      },
    });

    const loop = new AgenticLoop(
      makeConfig(llm, {
        tools,
        executor: new DefaultToolExecutor(tools),
      })
    );

    const result = await loop.run("Run slow", "s1", { abort: controller.signal });

    expect(result.finishReason).toBe("cancelled");
    expect(result.success).toBe(false);
  });

  it("hook blocks a specific tool", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({
      toolCalls: [{ id: "tc1", name: "delete_all", args: {} }],
    });

    const tools = new DefaultToolRegistry();
    tools.register(makeTool("delete_all"));

    const hooks = new DefaultHookManager();
    hooks.register({
      name: "safety-guard",
      event: HookEvent.PreToolUse,
      handler: async (payload) => {
        if (payload.data.toolCall.name === "delete_all") {
          return { action: "block" as const, reason: "Destructive operation blocked" };
        }
        return { action: "continue" as const };
      },
    });

    const loop = new AgenticLoop(
      makeConfig(llm, {
        tools,
        executor: new DefaultToolExecutor(tools),
        hooks,
      })
    );

    const result = await loop.run("Delete everything", "s1");

    expect(result.finishReason).toBe("blocked");
    expect(result.success).toBe(false);
  });

  it("max iterations with endless tool calls", async () => {
    const llm = new MockLLMAdapter();
    for (let i = 0; i < 5; i++) {
      llm.addResponse({
        toolCalls: [{ id: `tc${i}`, name: "loop_tool", args: {} }],
      });
    }

    const tools = new DefaultToolRegistry();
    tools.register(makeTool("loop_tool"));

    const loop = new AgenticLoop(
      makeConfig(llm, {
        agent: makeAgent({ maxIterations: 3 }),
        tools,
        executor: new DefaultToolExecutor(tools),
      })
    );

    const result = await loop.run("Keep going", "s1");

    expect(result.finishReason).toBe("max_iterations");
    expect(result.iterations).toBe(3);
  });

  it("skill detection + tool chain", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({
      toolCalls: [{ id: "tc1", name: "create_wall", args: { height: 3 } }],
    });
    llm.addResponse({ text: "Wall created at 3m height." });

    const skills = new DefaultSkillRegistry();
    skills.register({
      name: "revit",
      description: "Revit BIM",
      triggers: [{ type: "keyword", keyword: "wall" }],
    });

    const tools = new DefaultToolRegistry();
    tools.register(makeTool("create_wall", "wall-id-123"));

    const loop = new AgenticLoop(
      makeConfig(llm, {
        skills,
        skillDetector: new DefaultSkillDetector(),
        skillLoader: {
          loadPrompt: async () => "Use Revit API for BIM operations.",
        },
        tools,
        executor: new DefaultToolExecutor(tools),
      })
    );

    const result = await loop.run("Create a wall", "s1");

    expect(result.success).toBe(true);
    expect(result.output).toBe("Wall created at 3m height.");
    // Skill prompt injected
    expect(llm.requests[0].systemPrompt).toContain("Revit API for BIM");
    // Tool executed
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].result).toBe("wall-id-123");
  });

  it("token tracking across full conversation", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({
      text: "",
      toolCalls: [{ id: "tc1", name: "read", args: {} }],
      usage: { inputTokens: 200, outputTokens: 50 },
    });
    llm.addResponse({
      text: "Final answer.",
      usage: { inputTokens: 400, outputTokens: 100 },
    });

    const tools = new DefaultToolRegistry();
    tools.register(makeTool("read", "data"));

    const loop = new AgenticLoop(
      makeConfig(llm, {
        tools,
        executor: new DefaultToolExecutor(tools),
      })
    );

    const result = await loop.run("Analyze", "s1");

    expect(result.totalTokens.input).toBe(600);
    expect(result.totalTokens.output).toBe(150);
    expect(result.iterations).toBe(2);
  });
});
