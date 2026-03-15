// use-agent-chat.ts
// The primary hook — manages chat state, transport, and streaming

import { useReducer, useRef, useCallback, useMemo } from "react";
import type { Transport, TransportMessage } from "./transport.js";
import type {
  UIMessage,
  ChatStatus,
  LoopPhase,
  PartResolver,
  TextPart,
} from "./types.js";
import { chatReducer, INITIAL_CHAT_STATE } from "./reducer.js";
import { generateId } from "./generate-id.js";

// ─── Options ────────────────────────────────────────────────────

export interface UseAgentChatOptions {
  /** Transport layer for sending messages and receiving events */
  readonly transport: Transport;
  /** Custom part resolvers for extending the part system */
  readonly partResolvers?: readonly PartResolver[];
  /** Called when an error occurs */
  readonly onError?: (error: string) => void;
  /** Called when the agent completes a response */
  readonly onDone?: () => void;
  /** Custom mapper from UIMessages to transport history format */
  readonly mapHistory?: (messages: readonly UIMessage[]) => readonly TransportMessage[];
}

// ─── Return Type ────────────────────────────────────────────────

export interface UseAgentChatReturn {
  /** Current list of messages (user + assistant, ordered) */
  readonly messages: readonly UIMessage[];
  /** High-level chat status */
  readonly status: ChatStatus;
  /** Current loop phase from the backend */
  readonly phase: LoopPhase;
  /** Last error message, or null */
  readonly error: string | null;
  /** Cumulative token usage */
  readonly usage: Readonly<{ input: number; output: number }>;
  /** Number of completed iterations */
  readonly iterations: number;
  /** Send a message. Resolves when the full response is done. */
  readonly send: (message: string) => Promise<void>;
  /** Abort the current response */
  readonly abort: () => void;
  /** Reset all state to initial */
  readonly reset: () => void;
  /** Whether a response is currently in progress */
  readonly isLoading: boolean;
}

// ─── Hook ───────────────────────────────────────────────────────

export function useAgentChat(options: UseAgentChatOptions): UseAgentChatReturn {
  const { transport, partResolvers = [], onError, onDone, mapHistory } = options;

  const [state, dispatch] = useReducer(chatReducer, INITIAL_CHAT_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Keep resolvers in ref to avoid re-creating send callback
  const resolversRef = useRef(partResolvers);
  resolversRef.current = partResolvers;

  const send = useCallback(
    async (message: string): Promise<void> => {
      // Abort any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const userMessage: UIMessage = {
        id: generateId(),
        role: "user",
        parts: [{ type: "text", text: message, status: "complete" }],
        createdAt: Date.now(),
      };

      dispatch({ type: "send", userMessage });

      try {
        // Build history from current state (before this message)
        const currentMessages = stateRef.current.messages;
        const history = mapHistory
          ? mapHistory(currentMessages)
          : defaultMapHistory(currentMessages);

        const stream = transport.send(message, {
          history,
          abort: controller.signal,
        });

        for await (const event of stream) {
          if (controller.signal.aborted) break;
          dispatch({
            type: "event",
            event,
            resolvers: resolversRef.current,
          });
        }

        onDone?.();
      } catch (err) {
        if (controller.signal.aborted) return; // Don't surface abort as error
        const msg = err instanceof Error ? err.message : String(err);
        dispatch({ type: "set_error", error: msg });
        onError?.(msg);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [transport, mapHistory, onError, onDone],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "reset" });
  }, []);

  const isLoading = state.status !== "idle" && state.status !== "error";

  return useMemo(
    () => ({
      messages: state.messages,
      status: state.status,
      phase: state.phase,
      error: state.error,
      usage: state.usage,
      iterations: state.iterations,
      send,
      abort,
      reset,
      isLoading,
    }),
    [state, send, abort, reset, isLoading],
  );
}

// ─── Default History Mapper ─────────────────────────────────────

function defaultMapHistory(
  messages: readonly UIMessage[],
): TransportMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.parts
      .filter((p): p is TextPart => p.type === "text")
      .map((p) => p.text)
      .join(""),
  }));
}

