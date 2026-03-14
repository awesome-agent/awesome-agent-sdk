// CLI Agent — Terminal AI assistant powered by awesome-agent-sdk + OpenTUI

import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { useState, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { sendMessage, clearHistory } from "./agent.js";
import type { LoopEvent } from "@awesome-agent/agent-core";

// ─── Types ───────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
}

// ─── Chat Component ──────────────────────────────────────────

function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [loading, setLoading] = useState(false);
  const [toolStatus, setToolStatus] = useState("");

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    // Special commands
    if (text === "/clear") {
      setMessages([]);
      clearHistory();
      setInput("");
      return;
    }
    if (text === "/exit") {
      process.exit(0);
    }

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    setStreaming("");
    setToolStatus("");

    let streamedText = "";

    const onEvent = (event: LoopEvent) => {
      switch (event.type) {
        case "text:delta":
          streamedText += event.text;
          setStreaming(streamedText);
          break;
        case "tool:start":
          setToolStatus(`Running ${event.name}...`);
          break;
        case "tool:end":
          setToolStatus(
            event.result.success
              ? `${toolStatus} done`
              : `${toolStatus} failed`
          );
          break;
      }
    };

    try {
      const result = await sendMessage(text, onEvent);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: result.output },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    }

    setStreaming("");
    setToolStatus("");
    setLoading(false);
  }, [input, loading]);

  useKeyboard((event) => {
    if (event.key === "escape") {
      process.exit(0);
    }
  });

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Header */}
      <box padding={1} borderStyle="rounded" borderColor="#555">
        <text fg="#00BFFF">
          awesome-agent CLI
        </text>
        <text fg="#888">
          {"  "}Model: {process.env.MODEL ?? "openai/gpt-4o"} | /clear to reset | /exit or ESC to quit
        </text>
      </box>

      {/* Messages */}
      <scrollbox flexGrow={1} padding={1}>
        {messages.map((msg, i) => (
          <box key={i} marginBottom={1}>
            <text fg={msg.role === "user" ? "#00FF00" : msg.role === "tool" ? "#FFAA00" : "#FFFFFF"}>
              {msg.role === "user" ? "You: " : "Agent: "}
              {msg.content}
            </text>
          </box>
        ))}
        {streaming && (
          <box marginBottom={1}>
            <text fg="#AAAAFF">Agent: {streaming}</text>
          </box>
        )}
        {toolStatus && (
          <box>
            <text fg="#FFAA00">  {toolStatus}</text>
          </box>
        )}
      </scrollbox>

      {/* Input */}
      <box borderStyle="single" borderColor={loading ? "#555" : "#00BFFF"} padding={1}>
        <text fg="#888">{loading ? "Thinking..." : "> "}</text>
        <input
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          disabled={loading}
          autoFocus
        />
      </box>
    </box>
  );
}

// ─── Bootstrap ───────────────────────────────────────────────

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
});

createRoot(renderer).render(<Chat />);
