// awesome-agent CLI — Ink-based terminal UI
// Static logs scroll up, input bar stays at bottom

import React, { useState, useCallback } from "react";
import { render, Box, Text, Static, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { sendMessage, queueMessage, clearHistory, model } from "./agent.js";
import type { LoopEvent } from "@awesome-agent/agent-core";

// ─── Types ───────────────────────────────────────────────────

interface LogEntry {
  id: number;
  type: "user" | "text" | "tool-start" | "tool-done" | "tool-fail" | "stats" | "queued" | "info";
  content: string;
  detail?: string;
}

let nextId = 0;

// ─── App ─────────────────────────────────────────────────────

function App() {
  const { exit } = useApp();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [status, setStatus] = useState("");

  const addLog = useCallback((type: LogEntry["type"], content: string, detail?: string) => {
    setLogs((prev) => [...prev, { id: nextId++, type, content, detail }]);
  }, []);

  const handleSubmit = useCallback(async (value: string) => {
    const text = value.trim();
    setInput("");
    if (!text) return;

    if (text === "/exit") return exit();
    if (text === "/clear") {
      clearHistory();
      setLogs([]);
      setStreaming("");
      setStatus("");
      return;
    }

    if (busy) {
      queueMessage(text);
      addLog("queued", text);
      return;
    }

    addLog("user", text);
    setBusy(true);
    setStreaming("");
    setStatus("Thinking…");

    let streamText = "";
    const startTime = Date.now();

    const onEvent = (event: LoopEvent) => {
      switch (event.type) {
        case "text:delta":
          streamText += event.text;
          setStreaming(streamText);
          setStatus("");
          break;
        case "tool:start": {
          if (streamText) {
            addLog("text", streamText);
            streamText = "";
            setStreaming("");
          }
          const args = Object.entries(event.args)
            .map(([k, v]) => `${k}=${typeof v === "string" && v.length > 30 ? v.slice(0, 30) + "…" : v}`)
            .join(", ");
          addLog("tool-start", event.name, args);
          setStatus(`Running ${event.name}…`);
          break;
        }
        case "tool:end": {
          const preview = event.result.content.split("\n")[0].slice(0, 50);
          if (event.result.success) {
            addLog("tool-done", "Done", preview);
          } else {
            addLog("tool-fail", "Failed", preview);
          }
          setStatus("Thinking…");
          break;
        }
      }
    };

    try {
      const result = await sendMessage(text, onEvent);

      if (streamText) {
        addLog("text", streamText);
        setStreaming("");
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const { input: ti, output: to } = result.totalTokens;
      addLog("stats", `${result.iterations} iter · ↑${ti} ↓${to} · ${ti + to} tokens · ${elapsed}s`);
    } catch (err) {
      addLog("tool-fail", "Error", err instanceof Error ? err.message : String(err));
    }

    setBusy(false);
    setStatus("");
  }, [busy, addLog, exit]);

  useInput((_, key) => {
    if (key.escape) exit();
  });

  return (
    <>
      {/* Static area — completed logs, scrolls up naturally */}
      <Static items={logs}>
        {(log) => <LogLine key={log.id} entry={log} />}
      </Static>

      {/* Live area — stays at bottom */}
      <Box flexDirection="column" marginTop={1}>
        {streaming && <Text wrap="wrap">{streaming}</Text>}
        {status && <Text color="gray">{status}</Text>}

        <Box>
          <Text color="gray">{"─".repeat(Math.min(process.stdout.columns || 80, 120))}</Text>
        </Box>

        <Box>
          <Text bold color="green">❯ </Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder={busy ? "type to queue…" : "message…"}
          />
          {busy && <Text color="gray"> (working)</Text>}
        </Box>
      </Box>
    </>
  );
}

// ─── Log Line ────────────────────────────────────────────────

function LogLine({ entry }: { entry: LogEntry }) {
  switch (entry.type) {
    case "user":
      return (
        <Box marginTop={1}>
          <Text><Text bold color="green">You:</Text> {entry.content}</Text>
        </Box>
      );
    case "text":
      return <Text wrap="wrap">{entry.content}</Text>;
    case "tool-start":
      return (
        <Text>
          {"  "}<Text color="green">●</Text>{" "}
          <Text bold>{entry.content}</Text>
          <Text color="gray">({entry.detail})</Text>
        </Text>
      );
    case "tool-done":
      return (
        <Text>
          {"  "}<Text color="gray">└</Text>{" "}
          <Text color="green">{entry.content}</Text>
          {entry.detail ? <Text color="gray"> ({entry.detail})</Text> : null}
        </Text>
      );
    case "tool-fail":
      return (
        <Text>
          {"  "}<Text color="gray">└</Text>{" "}
          <Text color="red">{entry.content}</Text>
          {entry.detail ? <Text color="gray"> ({entry.detail})</Text> : null}
        </Text>
      );
    case "stats":
      return (
        <Box marginBottom={1}>
          <Text color="gray">  {entry.content}</Text>
        </Box>
      );
    case "queued":
      return <Text color="yellow">  ↳ queued: "{entry.content}"</Text>;
    case "info":
      return <Text color="gray">  {entry.content}</Text>;
    default:
      return null;
  }
}

// ─── Render ──────────────────────────────────────────────────

console.clear();
console.log(`  \x1b[1m\x1b[36mawesome-agent\x1b[0m \x1b[90m(${model})\x1b[0m`);
console.log(`  \x1b[90m/clear · /exit · ESC · type while agent works\x1b[0m\n`);

render(<App />);
