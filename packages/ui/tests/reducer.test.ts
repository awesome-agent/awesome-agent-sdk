import { describe, it, expect } from "vitest";
import { chatReducer, INITIAL_CHAT_STATE } from "../src/reducer.js";
import type { ChatAction } from "../src/reducer.js";
import type { ChatState, ToolCallPart, TextPart } from "../src/types.js";
import {
  textDelta,
  toolStart,
  toolEnd,
  phaseChange,
  iterationEnd,
  planReady,
  doneEvent,
  errorEvent,
  userMessage,
} from "./helpers/factories.js";

const NO_RESOLVERS: [] = [];

function dispatch(state: ChatState, action: ChatAction): ChatState {
  return chatReducer(state, action);
}

function applyEvent(state: ChatState, ...events: ReturnType<typeof textDelta>[]): ChatState {
  let s = state;
  for (const event of events) {
    s = dispatch(s, { type: "event", event, resolvers: NO_RESOLVERS });
  }
  return s;
}

describe("chatReducer", () => {
  it("has correct initial state", () => {
    expect(INITIAL_CHAT_STATE.status).toBe("idle");
    expect(INITIAL_CHAT_STATE.messages).toEqual([]);
    expect(INITIAL_CHAT_STATE.error).toBeNull();
    expect(INITIAL_CHAT_STATE.phase).toBe("idle");
    expect(INITIAL_CHAT_STATE.usage).toEqual({ input: 0, output: 0 });
    expect(INITIAL_CHAT_STATE.iterations).toBe(0);
  });

  it("send action adds user message and sets connecting status", () => {
    const msg = userMessage("hello");
    const state = dispatch(INITIAL_CHAT_STATE, { type: "send", userMessage: msg });

    expect(state.status).toBe("connecting");
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe("user");
    expect(state.error).toBeNull();
  });

  it("text:delta creates assistant message with streaming text part", () => {
    const state = applyEvent(INITIAL_CHAT_STATE, textDelta("Hello"));

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe("assistant");
    expect(state.messages[0].parts).toHaveLength(1);

    const part = state.messages[0].parts[0] as TextPart;
    expect(part.type).toBe("text");
    expect(part.text).toBe("Hello");
    expect(part.status).toBe("streaming");
  });

  it("multiple text:delta events accumulate in same text part", () => {
    const state = applyEvent(
      INITIAL_CHAT_STATE,
      textDelta("Hello "),
      textDelta("world"),
      textDelta("!"),
    );

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].parts).toHaveLength(1);

    const part = state.messages[0].parts[0] as TextPart;
    expect(part.text).toBe("Hello world!");
    expect(part.status).toBe("streaming");
  });

  it("tool:start creates a tool-call part with running status", () => {
    const state = applyEvent(
      INITIAL_CHAT_STATE,
      toolStart("t1", "read_file", { path: "/tmp/test" }),
    );

    expect(state.status).toBe("tool-executing");
    const part = state.messages[0].parts[0] as ToolCallPart;
    expect(part.type).toBe("tool-call");
    expect(part.callId).toBe("t1");
    expect(part.toolName).toBe("read_file");
    expect(part.args).toEqual({ path: "/tmp/test" });
    expect(part.status).toBe("running");
  });

  it("tool:start finalizes preceding streaming text part", () => {
    const state = applyEvent(
      INITIAL_CHAT_STATE,
      textDelta("Thinking..."),
      toolStart("t1", "read_file"),
    );

    const parts = state.messages[0].parts;
    expect(parts).toHaveLength(2);
    expect((parts[0] as TextPart).status).toBe("complete");
    expect((parts[1] as ToolCallPart).status).toBe("running");
  });

  it("tool:end updates matching tool-call part status", () => {
    const state = applyEvent(
      INITIAL_CHAT_STATE,
      toolStart("t1", "read_file"),
      toolEnd("t1", true, "file contents here"),
    );

    const part = state.messages[0].parts[0] as ToolCallPart;
    expect(part.status).toBe("success");
    expect(part.result).toBe("file contents here");
  });

  it("tool:end with failure sets error status on part", () => {
    const state = applyEvent(
      INITIAL_CHAT_STATE,
      toolStart("t1", "read_file"),
      toolEnd("t1", false, "ENOENT: file not found"),
    );

    const part = state.messages[0].parts[0] as ToolCallPart;
    expect(part.status).toBe("error");
    expect(part.result).toBe("ENOENT: file not found");
  });

  it("phase:change to thinking sets streaming status", () => {
    const state = applyEvent(
      INITIAL_CHAT_STATE,
      phaseChange("gathering", "thinking"),
    );
    expect(state.status).toBe("streaming");
    expect(state.phase).toBe("thinking");
  });

  it("phase:change to executing sets tool-executing status", () => {
    const state = applyEvent(
      INITIAL_CHAT_STATE,
      phaseChange("thinking", "executing"),
    );
    expect(state.status).toBe("tool-executing");
    expect(state.phase).toBe("executing");
  });

  it("plan:ready creates a plan part", () => {
    const state = applyEvent(
      INITIAL_CHAT_STATE,
      planReady("Step 1: Read file\nStep 2: Modify"),
    );

    expect(state.messages).toHaveLength(1);
    const part = state.messages[0].parts[0];
    expect(part.type).toBe("plan");
    if (part.type === "plan") {
      expect(part.plan).toBe("Step 1: Read file\nStep 2: Modify");
    }
  });

  it("done finalizes all streaming text parts and sets idle status", () => {
    const state = applyEvent(
      INITIAL_CHAT_STATE,
      textDelta("Hello world"),
      doneEvent(),
    );

    expect(state.status).toBe("idle");
    expect(state.phase).toBe("done");

    const part = state.messages[0].parts[0] as TextPart;
    expect(part.status).toBe("complete");
  });

  it("error event sets error status and message", () => {
    const state = applyEvent(
      INITIAL_CHAT_STATE,
      errorEvent("LLM request failed"),
    );

    expect(state.status).toBe("error");
    expect(state.error).toBe("LLM request failed");
    expect(state.phase).toBe("error");
  });

  it("iteration:end accumulates usage", () => {
    const state = applyEvent(
      INITIAL_CHAT_STATE,
      iterationEnd(1, 100, 50),
      iterationEnd(2, 200, 80),
    );

    expect(state.usage).toEqual({ input: 300, output: 130 });
    expect(state.iterations).toBe(2);
  });

  it("reset returns to initial state", () => {
    let state = applyEvent(
      INITIAL_CHAT_STATE,
      textDelta("some text"),
      errorEvent("fail"),
    );
    state = dispatch(state, { type: "reset" });
    expect(state).toEqual(INITIAL_CHAT_STATE);
  });

  it("does not mutate original state", () => {
    const original = { ...INITIAL_CHAT_STATE };
    applyEvent(INITIAL_CHAT_STATE, textDelta("Hello"));
    expect(INITIAL_CHAT_STATE).toEqual(original);
  });

  it("handles multiple tool calls in one assistant message", () => {
    const state = applyEvent(
      INITIAL_CHAT_STATE,
      textDelta("Let me check both files."),
      toolStart("t1", "read_file", { path: "a.txt" }),
      toolEnd("t1", true, "content A"),
      toolStart("t2", "read_file", { path: "b.txt" }),
      toolEnd("t2", true, "content B"),
      textDelta("Both files read."),
      doneEvent(),
    );

    const parts = state.messages[0].parts;
    expect(parts).toHaveLength(4);
    expect(parts[0].type).toBe("text");
    expect((parts[0] as TextPart).text).toBe("Let me check both files.");
    expect((parts[0] as TextPart).status).toBe("complete");
    expect(parts[1].type).toBe("tool-call");
    expect((parts[1] as ToolCallPart).callId).toBe("t1");
    expect(parts[2].type).toBe("tool-call");
    expect((parts[2] as ToolCallPart).callId).toBe("t2");
    expect(parts[3].type).toBe("text");
    expect((parts[3] as TextPart).text).toBe("Both files read.");
  });

  it("custom PartResolver intercepts events", () => {
    const resolver = {
      resolve: (event: any) => {
        if (event.type === "plan:ready") {
          return { type: "custom" as const, kind: "custom-plan", data: { plan: event.plan } };
        }
        return null;
      },
    };

    const state = chatReducer(INITIAL_CHAT_STATE, {
      type: "event",
      event: planReady("my plan"),
      resolvers: [resolver],
    });

    const part = state.messages[0].parts[0];
    expect(part.type).toBe("custom");
    if (part.type === "custom") {
      expect(part.kind).toBe("custom-plan");
    }
  });

  it("set_error action sets error status", () => {
    const state = dispatch(INITIAL_CHAT_STATE, {
      type: "set_error",
      error: "Connection lost",
    });

    expect(state.status).toBe("error");
    expect(state.error).toBe("Connection lost");
  });

  it("text after tool call creates a new text part", () => {
    const state = applyEvent(
      INITIAL_CHAT_STATE,
      textDelta("Before tool."),
      toolStart("t1", "test"),
      toolEnd("t1", true, "ok"),
      textDelta("After tool."),
    );

    const parts = state.messages[0].parts;
    expect(parts[0].type).toBe("text");
    expect((parts[0] as TextPart).text).toBe("Before tool.");
    expect((parts[0] as TextPart).status).toBe("complete");

    expect(parts[1].type).toBe("tool-call");

    expect(parts[2].type).toBe("text");
    expect((parts[2] as TextPart).text).toBe("After tool.");
    expect((parts[2] as TextPart).status).toBe("streaming");
  });
});
