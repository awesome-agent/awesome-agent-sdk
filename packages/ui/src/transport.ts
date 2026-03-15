// transport.ts
// Pluggable transport — developer provides their own implementation
// Supports: WebSocket, SSE, fetch, mock (for tests)

import type { LoopEvent } from "./types.js";

export interface TransportSendOptions {
  readonly history?: readonly TransportMessage[];
  readonly abort?: AbortSignal;
}

export interface TransportMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/**
 * Transport delivers LoopEvents from backend to frontend.
 *
 * The transport is intentionally minimal — just a send method that
 * returns an async iterable of events. The hook handles all state management.
 *
 * @example WebSocket transport
 * ```ts
 * class WSTransport implements Transport {
 *   async *send(message, options) {
 *     ws.send(JSON.stringify({ message, history: options?.history }));
 *     for await (const raw of wsMessages(ws, options?.abort)) {
 *       yield JSON.parse(raw) as LoopEvent;
 *     }
 *   }
 * }
 * ```
 */
export interface Transport {
  send(
    message: string,
    options?: TransportSendOptions,
  ): AsyncIterable<LoopEvent>;
}
