// awesome-agent CLI — Ink-based terminal UI
// Fixed input at bottom, scrolling output above

import React, { useState, useCallback } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { sendMessage, queueMessage, clearHistory, model } from "./agent.js";
import type { LoopEvent, LoopResult } from "@awesome-agent/agent-core";

// ─── Types ───────────────────────────────────────────────────

interface LogEntry {
  type: "user" | "text" | "tool-start" | "tool-done" | "tool-fail" | "stats" | "queued" | "separator";
  content: string;
  detail?: string;
}

// ─── App ─────────────────────────────────────────────────────

function App() {
  const { exit } = useApp();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");

  const addLog = useCallback((entry: LogEntry) => {
    setLogs((prev) => [...prev, entry]);
  }, []);

  const handleSubmit = useCallback(async (text: string) => {
    setInput("");
    if (!text.trim()) return;

    if (text.trim() === "/exit") return exit();
    if (text.trim() === "/clear") {
      clearHistory();
      setLogs([]);
      setStreaming("");
      return;
    }

    // Queue if agent is busy
    if (busy) {
      queueMessage(text.trim());
      addLog({ type: "queued", content: text.trim() });
      return;
    }

    addLog({ type: "user", content: text.trim() });
    setBusy(true);
    setStreaming("");

    let streamText = "";
    const startTime = Date.now();

    const onEvent = (event: LoopEvent) => {
      switch (event.type) {
        case "text:delta":
          streamText += event.text;
          setStreaming(streamText);
          break;
        case "tool:start": {
          // Flush streaming text
          if (streamText) {
            const flushed = streamText;
            streamText = "";
            setStreaming("");
            addLog({ type: "text", content: flushed });
          }
          const args = Object.entries(event.args)
            .map(([k, v]) => `${k}=${typeof v === "string" && v.length > 30 ? v.slice(0, 30) + "…" : v}`)
            .join(", ");
          addLog({ type: "tool-start", content: event.name, detail: args });
          break;
        }
        case "tool:end": {
          const preview = event.result.content.split("\n")[0].slice(0, 50);
          if (event.result.success) {
            addLog({ type: "tool-done", content: "Done", detail: preview });
          } else {
            addLog({ type: "tool-fail", content: "Failed", detail: preview });
          }
          break;
        }
      }
    };

    try {
      const result = await sendMessage(text.trim(), onEvent);

      // Flush final streaming text
      if (streamText) {
        addLog({ type: "text", content: streamText });
        setStreaming("");
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const { input: ti, output: to } = result.totalTokens;
      addLog({
        type: "stats",
        content: `${result.iterations} iteration${result.iterations !== 1 ? "s" : ""} · ↑${ti} ↓${to} · ${ti + to} tokens · ${elapsed}s`,
      });
      // No separator between messages — only the fixed one above input bar
    } catch (err) {
      addLog({ type: "tool-fail", content: "Error", detail: err instanceof Error ? err.message : String(err) });
    }

    setBusy(false);
  }, [busy, addLog, exit]);

  // ESC to exit
  useInput((_, key) => {
    if (key.escape) exit();
  });

  return (
    <Box flexDirection="column" height={process.stdout.rows || 24}>
      {/* Header */}
      <Box paddingX={1}>
        <Text bold color="cyan">awesome-agent</Text>
        <Text color="gray"> ({model}) · /clear · /exit · ESC</Text>
      </Box>
      <Box paddingX={1}>
        <Text color="gray">{"─".repeat((process.stdout.columns || 80) - 2)}</Text>
      </Box>

      {/* Output area — grows to fill */}
      <Box flexDirection="column" flexGrow={1} paddingX={1} overflowY="hidden">
        {logs.map((log, i) => (
          <LogLine key={i} entry={log} />
        ))}
        {streaming && (
          <Text>{streaming}</Text>
        )}
        {busy && !streaming && logs[logs.length - 1]?.type !== "tool-start" && (
          <Text color="gray">Thinking…</Text>
        )}
      </Box>

      {/* Separator */}
      <Box paddingX={1}>
        <Text color="gray">{"─".repeat((process.stdout.columns || 80) - 2)}</Text>
      </Box>

      {/* Fixed input bar */}
      <Box paddingX={1}>
        <Text bold color="green">❯ </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={busy ? "type to queue a message…" : "type a message…"}
        />
      </Box>
    </Box>
  );
}

// ─── Log Line Component ──────────────────────────────────────

function LogLine({ entry }: { entry: LogEntry }) {
  switch (entry.type) {
    case "user":
      return <Text><Text bold color="green">You:</Text> {entry.content}</Text>;
    case "text":
      return <Text>{entry.content}</Text>;
    case "tool-start":
      return (
        <Text>
          {"  "}<Text color="green">●</Text> <Text bold>{entry.content}</Text>
          <Text color="gray">({entry.detail})</Text>
        </Text>
      );
    case "tool-done":
      return (
        <Text>
          {"  "}<Text color="gray">└</Text> <Text color="green">{entry.content}</Text>
          {entry.detail ? <Text color="gray"> ({entry.detail})</Text> : null}
        </Text>
      );
    case "tool-fail":
      return (
        <Text>
          {"  "}<Text color="gray">└</Text> <Text color="red">{entry.content}</Text>
          {entry.detail ? <Text color="gray"> ({entry.detail})</Text> : null}
        </Text>
      );
    case "stats":
      return <Text color="gray">  {entry.content}</Text>;
    case "queued":
      return <Text color="yellow">  ↳ queued: "{entry.content}"</Text>;
    case "separator":
      return <Text color="gray">{"─".repeat((process.stdout.columns || 80) - 2)}</Text>;
    default:
      return null;
  }
}

// ─── Render ──────────────────────────────────────────────────

render(<App />);
