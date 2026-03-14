// Shared SSE helpers for Anthropic adapter tests
// Anthropic format: event: type\ndata: json\n\n
// parseSSEStream only reads data: lines, so we include both

export function sseEvent(data: Record<string, unknown>): string {
  const type = data.type as string;
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function makeSSEBody(chunks: string[]): ReadableStream<Uint8Array> {
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
