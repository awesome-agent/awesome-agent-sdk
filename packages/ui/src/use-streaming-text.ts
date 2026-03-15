// use-streaming-text.ts
// Derived hook — extracts concatenated text + streaming status from a message

import { useMemo } from "react";
import type { UIMessage, TextPart } from "./types.js";

export interface StreamingTextResult {
  /** Concatenated text from all text parts */
  readonly text: string;
  /** Whether any text part is still streaming */
  readonly isStreaming: boolean;
}

/**
 * Extract the concatenated text content from a message,
 * with streaming awareness.
 *
 * @example
 * ```tsx
 * const lastMessage = messages[messages.length - 1];
 * const { text, isStreaming } = useStreamingText(lastMessage);
 * return <p>{text}{isStreaming && "▍"}</p>;
 * ```
 */
export function useStreamingText(
  message: UIMessage | undefined,
): StreamingTextResult {
  return useMemo(() => {
    if (!message) return { text: "", isStreaming: false };

    const textParts = message.parts.filter(
      (p): p is TextPart => p.type === "text",
    );

    const text = textParts.map((p) => p.text).join("");
    const isStreaming = textParts.some((p) => p.status === "streaming");

    return { text, isStreaming };
  }, [message]);
}
