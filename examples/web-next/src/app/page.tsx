"use client";

import { useState, useRef, useEffect } from "react";
import { useAgentChat, useStreamingText, useToolStatus } from "@awesome-agent/ui";
import type { UIMessage, TextPart, ToolCallPart, PlanPart } from "@awesome-agent/ui";
import { SSETransport } from "@/lib/sse-transport";

const transport = new SSETransport();

export default function TerminalPage() {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { messages, status, send, abort, reset, isLoading, usage, iterations } =
    useAgentChat({
      transport,
      onError: (err) => console.error("Agent error:", err),
    });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, [isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    if (text === "/clear") {
      reset();
      return;
    }
    if (isLoading) return;
    send(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && isLoading) {
      abort();
    }
  };

  return (
    <div
      className="flex flex-col h-screen bg-[#0d1117] text-[#c9d1d9] font-mono text-sm"
      onClick={() => inputRef.current?.focus()}
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-[#58a6ff] font-bold">awesome-agent</span>
          <span className="text-[#484f58]">({status})</span>
          {messages.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); reset(); }}
              className="ml-auto text-[#484f58] hover:text-[#c9d1d9] text-xs"
            >
              /clear
            </button>
          )}
        </div>
        <div className="text-[#484f58] text-xs mt-1">ESC to abort · /clear to reset</div>
      </div>

      <div className="border-t border-[#21262d]" />

      {/* Terminal output */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="text-[#484f58] mt-8">
            <p>Type a message to start.</p>
            <p className="mt-1">Try: &quot;What&apos;s the weather in Istanbul?&quot;</p>
            <p>     &quot;Calculate 42 * 17 + 100&quot;</p>
          </div>
        )}

        {messages.map((msg) => (
          <LogEntry key={msg.id} message={msg} />
        ))}

        {isLoading && <ThinkingIndicator messages={messages} />}

        {/* Stats line */}
        {!isLoading && iterations > 0 && (
          <div className="text-[#484f58] mt-1">
            {"  "}{iterations} iter · ↑{usage.input} ↓{usage.output} · {usage.input + usage.output} tokens
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input prompt */}
      <div className="border-t border-[#21262d]" />
      <form onSubmit={handleSubmit} className="flex items-center px-4 py-3">
        <span className="text-[#3fb950] font-bold mr-2">❯</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className={`flex-1 bg-transparent outline-none placeholder-[#484f58] caret-[#58a6ff] ${
            input.startsWith("/") ? "text-[#d29922]" : "text-[#c9d1d9]"
          }`}
          placeholder="message..."
          disabled={isLoading}
          autoFocus
        />
        {isLoading && (
          <button
            type="button"
            onClick={abort}
            className="text-[#f85149] text-xs hover:underline ml-2"
          >
            abort
          </button>
        )}
      </form>
    </div>
  );
}

// ─── Log Entry ──────────────────────────────────────────────────

function LogEntry({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  if (isUser) {
    const text = message.parts
      .filter((p): p is TextPart => p.type === "text")
      .map((p) => p.text)
      .join("");
    return (
      <div className="mt-3">
        <span className="text-[#3fb950] font-bold">You:</span>{" "}
        <span className="text-[#c9d1d9]">{text}</span>
      </div>
    );
  }

  // Assistant message — render parts sequentially
  return (
    <div className="mt-1">
      {message.parts.map((part, i) => (
        <PartLine key={i} part={part} />
      ))}
    </div>
  );
}

// ─── Part Line ──────────────────────────────────────────────────

function PartLine({ part }: { part: UIMessage["parts"][number] }) {
  switch (part.type) {
    case "text": {
      const tp = part as TextPart;
      return (
        <div className="whitespace-pre-wrap leading-relaxed">
          {tp.text}
          {tp.status === "streaming" && (
            <span className="inline-block w-2 h-4 bg-[#58a6ff] animate-pulse ml-0.5 align-middle" />
          )}
        </div>
      );
    }

    case "tool-call": {
      const tc = part as ToolCallPart;
      const args = Object.entries(tc.args)
        .map(([k, v]) => {
          const val = typeof v === "string" && v.length > 40 ? v.slice(0, 40) + "…" : String(v);
          return `${k}=${val}`;
        })
        .join(", ");

      const statusIcon =
        tc.status === "running" ? "●" :
        tc.status === "success" ? "✓" :
        tc.status === "error" ? "✗" : "○";

      const statusColor =
        tc.status === "running" ? "text-[#d29922]" :
        tc.status === "success" ? "text-[#3fb950]" :
        tc.status === "error" ? "text-[#f85149]" : "text-[#484f58]";

      return (
        <div>
          <div className="text-[#484f58]">
            {"  "}<span className={statusColor}>{statusIcon}</span>{" "}
            <span className="text-[#c9d1d9] font-bold">{tc.toolName}</span>
            <span className="text-[#484f58]">({args})</span>
          </div>
          {tc.result && (
            <div className="text-[#484f58]">
              {"  "}└{" "}
              <span className={tc.status === "error" ? "text-[#f85149]" : "text-[#3fb950]"}>
                {tc.status === "error" ? "Failed" : "Done"}
              </span>
              {" "}
              <span className="text-[#484f58]">
                ({tc.result.length > 60 ? tc.result.slice(0, 60) + "…" : tc.result})
              </span>
            </div>
          )}
        </div>
      );
    }

    case "plan":
      return (
        <div className="text-[#d29922] mt-1">
          {"  "}📋 Plan:
          <pre className="text-[#484f58] whitespace-pre-wrap ml-4 text-xs">
            {(part as PlanPart).plan}
          </pre>
        </div>
      );

    default:
      return null;
  }
}

// ─── Thinking Indicator ─────────────────────────────────────────

function ThinkingIndicator({ messages }: { messages: readonly UIMessage[] }) {
  const lastMsg = messages[messages.length - 1];
  const { isStreaming } = useStreamingText(
    lastMsg?.role === "assistant" ? lastMsg : undefined,
  );
  const { isExecuting, pending } = useToolStatus(messages);

  if (isStreaming) return null; // Cursor already visible in text
  if (isExecuting) return null; // Tool status already visible

  return (
    <div className="text-[#484f58] animate-pulse mt-1">Thinking…</div>
  );
}
