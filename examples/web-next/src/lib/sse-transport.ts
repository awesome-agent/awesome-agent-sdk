// SSE Transport — connects to Next.js API route via fetch streaming

import type { Transport, TransportSendOptions, LoopEvent } from "@awesome-agent/ui";

export class SSETransport implements Transport {
  constructor(private readonly endpoint: string = "/api/chat") {}

  async *send(
    message: string,
    options?: TransportSendOptions,
  ): AsyncIterable<LoopEvent> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        history: options?.history,
        sessionId: "web-session",
      }),
      signal: options?.abort,
    });

    if (!res.ok) {
      throw new Error(`Server error: ${res.status}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") return;

          try {
            yield JSON.parse(data) as LoopEvent;
          } catch {
            // Skip malformed events
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
