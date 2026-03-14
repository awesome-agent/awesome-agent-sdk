// llm/sse-parser.ts
// Generic SSE (Server-Sent Events) line parser — reusable across adapters

/**
 * Parses a ReadableStream of SSE data, yielding raw JSON strings
 * from "data: " lines. Skips "[DONE]" and non-data lines.
 */
const DATA_PREFIX = "data: ";
const DONE_MARKER = "[DONE]";

export async function* parseSSEStream(
  body: ReadableStream<Uint8Array>
): AsyncIterable<string> {
  const reader = body.getReader();
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
        if (!line.startsWith(DATA_PREFIX)) continue;
        const data = line.slice(DATA_PREFIX.length).trim();
        if (data === DONE_MARKER) continue;
        yield data;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
