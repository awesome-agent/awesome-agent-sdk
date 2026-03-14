// awesome-agent CLI — simple Ink UI

import React, { useState, useCallback, useRef } from "react";
import { render, Box, Text, Static, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { sendMessage, queueMessage, clearHistory, model } from "./agent.js";
import type { LoopEvent } from "@awesome-agent/agent-core";

// ─── Types ───────────────────────────────────────────────────

interface LogEntry {
  id: number;
  type: "user" | "text" | "tool-start" | "tool-done" | "tool-fail" | "stats" | "queued";
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
  const abortRef = useRef<AbortController | null>(null);

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
    const controller = new AbortController();
    abortRef.current = controller;

    let streamText = "";
    const startTime = Date.now();

    const onEvent = (event: LoopEvent) => {
      switch (event.type) {
        case "text:delta":
          streamText += event.text;
          setStreaming(streamText);
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
          break;
        }
        case "tool:end": {
          const preview = event.result.content.split("\n")[0].slice(0, 50);
          addLog(event.result.success ? "tool-done" : "tool-fail", event.result.success ? "Done" : "Failed", preview);
          break;
        }
      }
    };

    try {
      const result = await sendMessage(text, onEvent, controller.signal);
      if (streamText) { addLog("text", streamText); setStreaming(""); }
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const { input: ti, output: to } = result.totalTokens;
      addLog("stats", `${result.iterations} iter · ↑${ti} ↓${to} · ${ti + to} tokens · ${elapsed}s`);
    } catch (err) {
      addLog("tool-fail", "Error", err instanceof Error ? err.message : String(err));
    }

    setBusy(false);
    abortRef.current = null;
  }, [busy, addLog, exit]);

  useInput((_, key) => {
    if (key.escape) {
      if (busy && abortRef.current) {
        // Agent running — abort it
        abortRef.current.abort();
        addLog("tool-fail", "Cancelled", "ESC pressed");
      } else {
        // Idle — exit app
        exit();
      }
    }
  });

  return (
    <>
      <Static items={logs}>
        {(log) => <LogLine key={log.id} entry={log} />}
      </Static>

      {streaming && <Text wrap="wrap">{streaming}</Text>}
      {busy && !streaming && <Text color="gray">Thinking…</Text>}

      <Box marginTop={1}>
        <Text bold color="green">❯ </Text>
        <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} placeholder="message…" />
      </Box>
    </>
  );
}

// ─── Log Line ────────────────────────────────────────────────

function LogLine({ entry }: { entry: LogEntry }) {
  switch (entry.type) {
    case "user":
      return <Box marginTop={1}><Text><Text bold color="green">You:</Text> {entry.content}</Text></Box>;
    case "text":
      return <Text wrap="wrap">{entry.content}</Text>;
    case "tool-start":
      return <Text>  <Text color="green">●</Text> <Text bold>{entry.content}</Text><Text color="gray">({entry.detail})</Text></Text>;
    case "tool-done":
      return <Text>  <Text color="gray">└</Text> <Text color="green">{entry.content}</Text>{entry.detail ? <Text color="gray"> ({entry.detail})</Text> : null}</Text>;
    case "tool-fail":
      return <Text>  <Text color="gray">└</Text> <Text color="red">{entry.content}</Text>{entry.detail ? <Text color="gray"> ({entry.detail})</Text> : null}</Text>;
    case "stats":
      return <Text color="gray">  {entry.content}</Text>;
    case "queued":
      return <Text color="yellow">  ↳ queued: "{entry.content}"</Text>;
    default:
      return null;
  }
}

// ─── Render ──────────────────────────────────────────────────

console.clear();
console.log(`  \x1b[1m\x1b[36mawesome-agent\x1b[0m \x1b[90m(${model})\x1b[0m`);
console.log(`  \x1b[90m/clear · /exit · ESC\x1b[0m\n`);

render(<App />);
