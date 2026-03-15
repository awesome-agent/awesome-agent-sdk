import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useStreamingText } from "../src/use-streaming-text.js";
import type { UIMessage } from "../src/types.js";

describe("useStreamingText", () => {
  it("returns empty for undefined message", () => {
    const { result } = renderHook(() => useStreamingText(undefined));
    expect(result.current.text).toBe("");
    expect(result.current.isStreaming).toBe(false);
  });

  it("concatenates text from multiple text parts", () => {
    const message: UIMessage = {
      id: "1",
      role: "assistant",
      createdAt: Date.now(),
      parts: [
        { type: "text", text: "Hello ", status: "complete" },
        { type: "tool-call", callId: "t1", toolName: "test", args: {}, status: "success" },
        { type: "text", text: "world!", status: "complete" },
      ],
    };

    const { result } = renderHook(() => useStreamingText(message));
    expect(result.current.text).toBe("Hello world!");
    expect(result.current.isStreaming).toBe(false);
  });

  it("detects streaming status from any text part", () => {
    const message: UIMessage = {
      id: "1",
      role: "assistant",
      createdAt: Date.now(),
      parts: [
        { type: "text", text: "Done. ", status: "complete" },
        { type: "text", text: "Still going", status: "streaming" },
      ],
    };

    const { result } = renderHook(() => useStreamingText(message));
    expect(result.current.text).toBe("Done. Still going");
    expect(result.current.isStreaming).toBe(true);
  });

  it("returns empty for message with no text parts", () => {
    const message: UIMessage = {
      id: "1",
      role: "assistant",
      createdAt: Date.now(),
      parts: [
        { type: "tool-call", callId: "t1", toolName: "test", args: {}, status: "running" },
      ],
    };

    const { result } = renderHook(() => useStreamingText(message));
    expect(result.current.text).toBe("");
    expect(result.current.isStreaming).toBe(false);
  });
});
