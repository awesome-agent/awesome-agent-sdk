import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useToolStatus } from "../src/use-tool-status.js";
import type { UIMessage } from "../src/types.js";

describe("useToolStatus", () => {
  it("returns empty for no messages", () => {
    const { result } = renderHook(() => useToolStatus([]));
    expect(result.current.toolCalls).toHaveLength(0);
    expect(result.current.pending).toHaveLength(0);
    expect(result.current.isExecuting).toBe(false);
  });

  it("collects tool calls across multiple messages", () => {
    const messages: UIMessage[] = [
      {
        id: "1",
        role: "assistant",
        createdAt: Date.now(),
        parts: [
          { type: "tool-call", callId: "t1", toolName: "read_file", args: {}, status: "success" },
        ],
      },
      {
        id: "2",
        role: "assistant",
        createdAt: Date.now(),
        parts: [
          { type: "tool-call", callId: "t2", toolName: "write_file", args: {}, status: "running" },
        ],
      },
    ];

    const { result } = renderHook(() => useToolStatus(messages));
    expect(result.current.toolCalls).toHaveLength(2);
    expect(result.current.toolCalls[0].callId).toBe("t1");
    expect(result.current.toolCalls[1].callId).toBe("t2");
  });

  it("filters pending/running tool calls", () => {
    const messages: UIMessage[] = [
      {
        id: "1",
        role: "assistant",
        createdAt: Date.now(),
        parts: [
          { type: "tool-call", callId: "t1", toolName: "read_file", args: {}, status: "success" },
          { type: "tool-call", callId: "t2", toolName: "write_file", args: {}, status: "running" },
          { type: "tool-call", callId: "t3", toolName: "list_dir", args: {}, status: "pending" },
        ],
      },
    ];

    const { result } = renderHook(() => useToolStatus(messages));
    expect(result.current.pending).toHaveLength(2);
    expect(result.current.pending[0].callId).toBe("t2");
    expect(result.current.pending[1].callId).toBe("t3");
    expect(result.current.isExecuting).toBe(true);
  });

  it("isExecuting is false when all tools are complete", () => {
    const messages: UIMessage[] = [
      {
        id: "1",
        role: "assistant",
        createdAt: Date.now(),
        parts: [
          { type: "tool-call", callId: "t1", toolName: "test", args: {}, status: "success" },
          { type: "tool-call", callId: "t2", toolName: "test", args: {}, status: "error" },
        ],
      },
    ];

    const { result } = renderHook(() => useToolStatus(messages));
    expect(result.current.isExecuting).toBe(false);
  });

  it("ignores non-tool-call parts", () => {
    const messages: UIMessage[] = [
      {
        id: "1",
        role: "assistant",
        createdAt: Date.now(),
        parts: [
          { type: "text", text: "Hello", status: "complete" },
          { type: "plan", plan: "Step 1" },
        ],
      },
    ];

    const { result } = renderHook(() => useToolStatus(messages));
    expect(result.current.toolCalls).toHaveLength(0);
  });
});
