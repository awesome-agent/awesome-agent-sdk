import { describe, it, expect } from "vitest";
import { DefaultSubagentRunner } from "../../src/agent/subagent.js";
import type { SubagentConfig } from "../../src/agent/types.js";
import type { RunnableLoop, LoopResult } from "../../src/loop/types.js";

function makeLoopResult(overrides?: Partial<LoopResult>): LoopResult {
  return {
    success: true,
    output: "done",
    iterations: 3,
    totalTokens: { input: 100, output: 50 },
    toolCalls: [],
    finishReason: "complete",
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<SubagentConfig>): SubagentConfig {
  return {
    agent: { id: "sub", name: "Sub", prompt: "Do stuff" },
    task: "test task",
    parentSessionId: "parent-1",
    ...overrides,
  };
}

describe("DefaultSubagentRunner", () => {
  it("spawns a subagent and returns result", async () => {
    const mockLoop: RunnableLoop = {
      run: async () => makeLoopResult(),
    };

    const runner = new DefaultSubagentRunner(() => mockLoop);
    const result = await runner.spawn(makeConfig());

    expect(result.success).toBe(true);
    expect(result.output).toBe("done");
    expect(result.tokenUsage).toEqual({ input: 100, output: 50 });
    expect(result.iterations).toBe(3);
  });

  it("passes task and sessionId to loop", async () => {
    let capturedInput = "";
    let capturedSessionId = "";

    const mockLoop: RunnableLoop = {
      run: async (input, sessionId) => {
        capturedInput = input;
        capturedSessionId = sessionId;
        return makeLoopResult();
      },
    };

    const runner = new DefaultSubagentRunner(() => mockLoop);
    await runner.spawn(makeConfig({ task: "my task" }));

    expect(capturedInput).toBe("my task");
    expect(capturedSessionId).toMatch(/^sub:parent-1:/);
  });

  it("propagates parent abort signal", async () => {
    const parentController = new AbortController();
    let receivedSignal: AbortSignal | undefined;

    const mockLoop: RunnableLoop = {
      run: async (_input, _sessionId, abort) => {
        receivedSignal = abort;
        return makeLoopResult();
      },
    };

    const runner = new DefaultSubagentRunner(() => mockLoop);
    await runner.spawn(makeConfig({ abort: parentController.signal }));

    expect(receivedSignal).toBeDefined();

    // Aborting parent should propagate
    parentController.abort();
    expect(receivedSignal!.aborted).toBe(true);
  });

  it("spawns parallel subagents", async () => {
    const results = [
      makeLoopResult({ output: "result-a" }),
      makeLoopResult({ output: "result-b" }),
    ];
    let callIndex = 0;

    const runner = new DefaultSubagentRunner(() => ({
      run: async () => results[callIndex++],
    }));

    const parallel = await runner.spawnParallel([
      makeConfig({ task: "task-a" }),
      makeConfig({ task: "task-b" }),
    ]);

    expect(parallel).toHaveLength(2);
    expect(parallel[0].output).toBe("result-a");
    expect(parallel[1].output).toBe("result-b");
  });

  it("handles loop failure", async () => {
    const mockLoop: RunnableLoop = {
      run: async () =>
        makeLoopResult({
          success: false,
          output: "error occurred",
          finishReason: "error",
        }),
    };

    const runner = new DefaultSubagentRunner(() => mockLoop);
    const result = await runner.spawn(makeConfig());

    expect(result.success).toBe(false);
    expect(result.output).toBe("error occurred");
  });
});
