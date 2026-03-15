// Mock transport for tests — yields queued events synchronously

import type { Transport, TransportSendOptions } from "../../src/transport.js";
import type { LoopEvent } from "../../src/types.js";

export class MockTransport implements Transport {
  private events: LoopEvent[] = [];
  public lastMessage = "";
  public lastOptions: TransportSendOptions | undefined;

  /** Queue events to be yielded on next send() */
  queueEvents(...events: LoopEvent[]): void {
    this.events.push(...events);
  }

  async *send(
    message: string,
    options?: TransportSendOptions,
  ): AsyncIterable<LoopEvent> {
    this.lastMessage = message;
    this.lastOptions = options;
    const events = [...this.events];
    this.events = [];
    for (const event of events) {
      yield event;
    }
  }
}
