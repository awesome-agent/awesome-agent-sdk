// @awesome-agent/ui — Headless React hooks for agent chat UIs
// Zero styling, pluggable transport, extensible part system

// Types
export type {
  LoopEvent,
  LoopPhase,
  LoopResultSummary,
  UIMessage,
  MessagePart,
  TextPart,
  ToolCallPart,
  PlanPart,
  CustomPart,
  ToolContentBlock,
  MessagePartStatus,
  MessageRole,
  ChatStatus,
  ChatState,
  PartResolver,
} from "./types.js";

// Transport
export type {
  Transport,
  TransportSendOptions,
  TransportMessage,
} from "./transport.js";

// Hooks
export { useAgentChat } from "./use-agent-chat.js";
export type {
  UseAgentChatOptions,
  UseAgentChatReturn,
} from "./use-agent-chat.js";
export { useStreamingText } from "./use-streaming-text.js";
export type { StreamingTextResult } from "./use-streaming-text.js";
export { useToolStatus } from "./use-tool-status.js";
export type { ToolStatusResult } from "./use-tool-status.js";

// Part Registry
export { PartRegistry } from "./part-registry.js";

// Reducer (exported for advanced usage / testing)
export { chatReducer, INITIAL_CHAT_STATE } from "./reducer.js";
export type { ChatAction } from "./reducer.js";
