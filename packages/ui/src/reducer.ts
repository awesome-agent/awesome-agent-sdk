// reducer.ts
// Pure state reducer — no side effects, immutable transitions
// Pattern: identical to core/loop/state.ts

import type {
  ChatState,
  ChatStatus,
  LoopEvent,
  LoopPhase,
  UIMessage,
  MessagePart,
  TextPart,
  ToolCallPart,
  PartResolver,
  CustomPart,
} from "./types.js";
import { generateId } from "./generate-id.js";

// ─── Actions ────────────────────────────────────────────────────

export type ChatAction =
  | { readonly type: "send"; readonly userMessage: UIMessage }
  | { readonly type: "event"; readonly event: LoopEvent; readonly resolvers: readonly PartResolver[] }
  | { readonly type: "reset" }
  | { readonly type: "set_error"; readonly error: string };

// ─── Initial State ──────────────────────────────────────────────

export const INITIAL_CHAT_STATE: ChatState = {
  status: "idle",
  messages: [],
  phase: "idle",
  error: null,
  usage: { input: 0, output: 0 },
  iterations: 0,
};

// ─── Reducer ────────────────────────────────────────────────────

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send":
      return {
        ...state,
        status: "connecting",
        error: null,
        messages: [...state.messages, action.userMessage],
      };

    case "event":
      return applyLoopEvent(state, action.event, action.resolvers);

    case "reset":
      return INITIAL_CHAT_STATE;

    case "set_error":
      return { ...state, status: "error", error: action.error };

    default: {
      const _exhaustive: never = action;
      return state;
    }
  }
}

// ─── Event Application ──────────────────────────────────────────

function applyLoopEvent(
  state: ChatState,
  event: LoopEvent,
  resolvers: readonly PartResolver[],
): ChatState {
  // Check custom resolvers first
  for (const resolver of resolvers) {
    const custom = resolver.resolve(event);
    if (custom) return appendPartToAssistant(state, custom);
  }

  switch (event.type) {
    case "phase:change":
      return applyPhaseChange(state, event.to);

    case "text:delta":
      return applyTextDelta(state, event.text);

    case "tool:start":
      return applyToolStart(state, event.callId, event.name, event.args);

    case "tool:end":
      return applyToolEnd(state, event.callId, event.result);

    case "iteration:end":
      return {
        ...state,
        usage: {
          input: state.usage.input + event.usage.input,
          output: state.usage.output + event.usage.output,
        },
        iterations: event.iteration,
      };

    case "plan:ready":
      return appendPartToAssistant(state, { type: "plan", plan: event.plan });

    case "done":
      return applyDone(state);

    case "error":
      return { ...state, status: "error", error: event.error, phase: "error" };
  }
}

// ─── Phase → Status Mapping ─────────────────────────────────────

const PHASE_TO_STATUS: Partial<Record<LoopPhase, ChatStatus>> = {
  thinking: "streaming",
  executing: "tool-executing",
  done: "idle",
  error: "error",
};

function applyPhaseChange(state: ChatState, to: LoopPhase): ChatState {
  const status = PHASE_TO_STATUS[to] ?? state.status;
  return { ...state, phase: to, status };
}

// ─── Text Delta (streaming accumulator) ─────────────────────────

function applyTextDelta(state: ChatState, text: string): ChatState {
  const messages = [...state.messages];
  const lastMsg = messages[messages.length - 1];

  // Ensure we have an assistant message
  if (!lastMsg || lastMsg.role !== "assistant") {
    const newMsg: UIMessage = {
      id: generateId(),
      role: "assistant",
      parts: [{ type: "text", text, status: "streaming" }],
      createdAt: Date.now(),
    };
    return { ...state, status: "streaming", messages: [...messages, newMsg] };
  }

  const parts = [...lastMsg.parts];
  const lastPart = parts[parts.length - 1];

  if (lastPart && lastPart.type === "text" && lastPart.status === "streaming") {
    // Append to existing streaming text part
    parts[parts.length - 1] = { ...lastPart, text: lastPart.text + text };
  } else {
    // Start a new text part
    parts.push({ type: "text", text, status: "streaming" });
  }

  messages[messages.length - 1] = { ...lastMsg, parts };
  return { ...state, status: "streaming", messages };
}

// ─── Tool Start ─────────────────────────────────────────────────

function applyToolStart(
  state: ChatState,
  callId: string,
  name: string,
  args: Record<string, unknown>,
): ChatState {
  let messages = [...state.messages];
  let lastMsg = messages[messages.length - 1];

  // Ensure assistant message exists
  if (!lastMsg || lastMsg.role !== "assistant") {
    lastMsg = {
      id: generateId(),
      role: "assistant",
      parts: [],
      createdAt: Date.now(),
    };
    messages.push(lastMsg);
  }

  const parts = [...lastMsg.parts];

  // Finalize any streaming text part
  const lastPart = parts[parts.length - 1];
  if (lastPart && lastPart.type === "text" && lastPart.status === "streaming") {
    parts[parts.length - 1] = { ...lastPart, status: "complete" };
  }

  // Add tool call part
  const toolPart: ToolCallPart = {
    type: "tool-call",
    callId,
    toolName: name,
    args,
    status: "running",
  };
  parts.push(toolPart);

  messages[messages.length - 1] = { ...lastMsg, parts };
  return { ...state, status: "tool-executing", messages };
}

// ─── Tool End ───────────────────────────────────────────────────

function applyToolEnd(
  state: ChatState,
  callId: string,
  result: Readonly<{ success: boolean; content: string }>,
): ChatState {
  const messages = [...state.messages];
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || lastMsg.role !== "assistant") return state;

  const parts = lastMsg.parts.map((part) => {
    if (part.type === "tool-call" && part.callId === callId) {
      return {
        ...part,
        status: result.success ? "success" : "error",
        result: result.content,
      } as ToolCallPart;
    }
    return part;
  });

  messages[messages.length - 1] = { ...lastMsg, parts };
  return { ...state, messages };
}

// ─── Done ───────────────────────────────────────────────────────

function applyDone(state: ChatState): ChatState {
  // Finalize all streaming text parts
  const messages = state.messages.map((msg) => {
    if (msg.role !== "assistant") return msg;
    const hasStreaming = msg.parts.some(
      (p) => p.type === "text" && p.status === "streaming",
    );
    if (!hasStreaming) return msg;
    return {
      ...msg,
      parts: msg.parts.map((p) =>
        p.type === "text" && p.status === "streaming"
          ? { ...p, status: "complete" as const }
          : p,
      ),
    };
  });

  return { ...state, status: "idle", phase: "done", messages };
}

// ─── Helpers ────────────────────────────────────────────────────

function appendPartToAssistant(state: ChatState, part: MessagePart): ChatState {
  const messages = [...state.messages];
  const lastMsg = messages[messages.length - 1];

  if (lastMsg && lastMsg.role === "assistant") {
    messages[messages.length - 1] = {
      ...lastMsg,
      parts: [...lastMsg.parts, part],
    };
  } else {
    messages.push({
      id: generateId(),
      role: "assistant",
      parts: [part],
      createdAt: Date.now(),
    });
  }

  return { ...state, messages };
}

