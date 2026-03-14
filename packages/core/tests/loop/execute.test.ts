import { describe, it, expect } from "vitest";
import { executePhase } from "../../src/loop/execute.js";
import { DefaultHookManager } from "../../src/hook/manager.js";
import { DefaultToolRegistry } from "../../src/tool/registry.js";
import { DefaultToolExecutor } from "../../src/tool/executor.js";
import { MockLLMAdapter } from "../../src/llm/mock-adapter.js";
import { HookEvent } from "../../src/hook/types.js";
import { makeTool, makeLoopConfig } from "../helpers/factories.js";
import type { LoopConfig, LoopEvent, ToolCallLog } from "../../src/loop/types.js";
import type { Message } from "../../src/llm/types.js";
import type { ToolCall, Tool } from "../../src/tool/types.js";

// ─── Factories ───────────────────────────────────────────────

function makeConfig(
  registeredTools: Tool[] = [],
  overrides?: Partial<LoopConfig>
): LoopConfig {
  const tools = new DefaultToolRegistry();
  for (const t of registeredTools) {
    tools.register(t);
  }
  const llm = new MockLLMAdapter();
  return makeLoopConfig(llm, {
    tools,
    executor: new DefaultToolExecutor(tools),
    ...overrides,
  });
}

function makeToolCall(overrides?: Partial<ToolCall>): ToolCall {
  return {
    id: "tc1",
    name: "echo",
    args: { msg: "test" },
    ...overrides,
  };
}

function noopEmit(_event: LoopEvent): void {}

// ─── Tests ───────────────────────────────────────────────────

describe("executePhase", () => {
  it("adds assistant message with text and tool calls to history", async () => {
    const messages: Message[] = [];
    const config = makeConfig([makeTool("echo")]);

    await executePhase(
      config, noopEmit,
      "I'll run echo",
      [makeToolCall()],
      messages, [], "s1"
    );

    const assistant = messages.find((m) => m.role === "assistant");
    expect(assistant).toBeDefined();
    if (assistant?.role === "assistant") {
      expect(assistant.content).toHaveLength(2); // text + tool_call
      expect(assistant.content[0].type).toBe("text");
      expect(assistant.content[1].type).toBe("tool_call");
    }
  });

  it("adds tool result messages to history", async () => {
    const messages: Message[] = [];
    const config = makeConfig([makeTool("echo", "hello")]);

    await executePhase(
      config, noopEmit,
      "", [makeToolCall()],
      messages, [], "s1"
    );

    const toolMsg = messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    if (toolMsg?.role === "tool") {
      expect(toolMsg.toolCallId).toBe("tc1");
      expect(toolMsg.content).toBe("hello");
      expect(toolMsg.isError).toBe(false);
    }
  });

  it("emits tool:start and tool:end events", async () => {
    const events: LoopEvent[] = [];
    const config = makeConfig([makeTool("echo")]);

    await executePhase(
      config, (e) => events.push(e),
      "", [makeToolCall()],
      [], [], "s1"
    );

    const start = events.find((e) => e.type === "tool:start");
    expect(start).toBeDefined();
    if (start?.type === "tool:start") {
      expect(start.name).toBe("echo");
      expect(start.callId).toBe("tc1");
    }

    const end = events.find((e) => e.type === "tool:end");
    expect(end).toBeDefined();
    if (end?.type === "tool:end") {
      expect(end.result.success).toBe(true);
      expect(end.result.content).toBe("ok");
    }
  });

  it("logs tool calls to toolCallLogs", async () => {
    const logs: ToolCallLog[] = [];
    const config = makeConfig([makeTool("echo", "result-text")]);

    await executePhase(
      config, noopEmit,
      "", [makeToolCall()],
      [], logs, "s1"
    );

    expect(logs).toHaveLength(1);
    expect(logs[0].name).toBe("echo");
    expect(logs[0].args).toEqual({ msg: "test" });
    expect(logs[0].result).toBe("result-text");
    expect(logs[0].error).toBeUndefined();
  });

  it("logs error for failed tool execution", async () => {
    const logs: ToolCallLog[] = [];
    const config = makeConfig([makeTool("fail", "something broke", false)]);

    await executePhase(
      config, noopEmit,
      "", [makeToolCall({ name: "fail" })],
      [], logs, "s1"
    );

    expect(logs[0].error).toBe("something broke");
    expect(logs[0].result).toBeUndefined();
  });

  it("PreToolUse hook can block execution", async () => {
    const hooks = new DefaultHookManager();
    hooks.register({
      name: "blocker",
      event: HookEvent.PreToolUse,
      handler: async () => ({
        action: "block" as const,
        reason: "forbidden tool",
      }),
    });

    const messages: Message[] = [];
    const config = makeConfig([makeTool("echo")], { hooks });

    const result = await executePhase(
      config, noopEmit,
      "", [makeToolCall()],
      messages, [], "s1"
    );

    expect(result.blocked).toBe(true);

    const blocked = messages.find(
      (m) => m.role === "tool" && m.content.includes("Blocked")
    );
    expect(blocked).toBeDefined();
    if (blocked?.role === "tool") {
      expect(blocked.isError).toBe(true);
    }
  });

  it("PreToolUse hook can modify args", async () => {
    const hooks = new DefaultHookManager();
    hooks.register({
      name: "modifier",
      event: HookEvent.PreToolUse,
      handler: async () => ({
        action: "modify" as const,
        data: { args: { msg: "modified" } },
      }),
    });

    let receivedArgs: Record<string, unknown> = {};
    const tool: Tool = {
      name: "echo",
      description: "Echo",
      parameters: { type: "object" },
      execute: async (args) => {
        receivedArgs = args;
        return { success: true, content: "ok" };
      },
    };

    const config = makeConfig([tool], { hooks });
    await executePhase(
      config, noopEmit,
      "", [makeToolCall()],
      [], [], "s1"
    );

    expect(receivedArgs).toEqual({ msg: "modified" });
  });

  it("executes multiple tool calls", async () => {
    const logs: ToolCallLog[] = [];
    const config = makeConfig([
      makeTool("read", "file content"),
      makeTool("write", "written"),
    ]);

    await executePhase(
      config, noopEmit,
      "",
      [
        makeToolCall({ id: "tc1", name: "read", args: { path: "/a" } }),
        makeToolCall({ id: "tc2", name: "write", args: { path: "/b" } }),
      ],
      [], logs, "s1"
    );

    expect(logs).toHaveLength(2);
    expect(logs[0].name).toBe("read");
    expect(logs[1].name).toBe("write");
  });

  it("omits text part from assistant message when empty", async () => {
    const messages: Message[] = [];
    const config = makeConfig([makeTool("echo")]);

    await executePhase(
      config, noopEmit,
      "", // empty text
      [makeToolCall()],
      messages, [], "s1"
    );

    const assistant = messages.find((m) => m.role === "assistant");
    if (assistant?.role === "assistant") {
      // Only tool_call part, no text part
      expect(assistant.content).toHaveLength(1);
      expect(assistant.content[0].type).toBe("tool_call");
    }
  });

  it("returns blocked:false on successful execution", async () => {
    const config = makeConfig([makeTool("echo")]);

    const result = await executePhase(
      config, noopEmit,
      "", [makeToolCall()],
      [], [], "s1"
    );

    expect(result.blocked).toBe(false);
  });
});
