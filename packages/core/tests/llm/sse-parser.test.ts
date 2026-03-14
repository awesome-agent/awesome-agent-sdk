import { describe, it, expect } from "vitest";
import { parseSSEStream } from "../../src/llm/sse-parser.js";

function toStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function toChunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const results: string[] = [];
  for await (const data of parseSSEStream(stream)) {
    results.push(data);
  }
  return results;
}

describe("parseSSEStream", () => {
  it("yields data from SSE lines", async () => {
    const stream = toStream('data: {"text":"hello"}\n\ndata: {"text":"world"}\n\n');
    const results = await collect(stream);

    expect(results).toEqual(['{"text":"hello"}', '{"text":"world"}']);
  });

  it("skips [DONE] marker", async () => {
    const stream = toStream('data: {"a":1}\n\ndata: [DONE]\n\n');
    const results = await collect(stream);

    expect(results).toEqual(['{"a":1}']);
  });

  it("skips non-data lines (comments, empty)", async () => {
    const stream = toStream(': comment\n\nevent: ping\n\ndata: {"ok":true}\n\n');
    const results = await collect(stream);

    expect(results).toEqual(['{"ok":true}']);
  });

  it("handles data split across chunks", async () => {
    const stream = toChunkedStream([
      'data: {"pa',
      'rt":"1"}\n\ndata: {"part":"2"}\n\n',
    ]);
    const results = await collect(stream);

    expect(results).toEqual(['{"part":"1"}', '{"part":"2"}']);
  });

  it("returns empty for empty stream", async () => {
    const stream = toStream("");
    const results = await collect(stream);

    expect(results).toEqual([]);
  });

  it("trims whitespace from data values", async () => {
    const stream = toStream('data:   {"trimmed":true}  \n\n');
    const results = await collect(stream);

    expect(results).toEqual(['{"trimmed":true}']);
  });

  it("handles stream with no trailing newline", async () => {
    const stream = toStream('data: {"last":true}\n');
    const results = await collect(stream);

    expect(results).toEqual(['{"last":true}']);
  });
});
