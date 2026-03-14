// context/transcript.ts
// Shared utility — converts messages to plain text transcript for summarization

import type { Message } from "../llm/types.js";

/** Converts a message array to a readable transcript string */
export function buildTranscript(messages: readonly Message[]): string {
  return messages
    .map((m) => {
      if (m.role === "assistant") {
        const text = m.content
          .filter(
            (p): p is Extract<typeof p, { type: "text" }> => p.type === "text"
          )
          .map((p) => p.text)
          .join("");
        return `Assistant: ${text}`;
      }
      return `${m.role}: ${m.content}`;
    })
    .join("\n");
}
