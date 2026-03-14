// JSON-RPC 2.0 client — sends requests, matches responses by ID

import type { MCPMessage } from "@awesome-agent/agent-core";
import { MCPRequestError, MCPConnectionError } from "@awesome-agent/agent-core";

// ─── Types ───────────────────────────────────────────────────

export interface PendingRequest {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
}

// ─── JSON-RPC Client ─────────────────────────────────────────

export class JsonRpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  /** Create a JSON-RPC request message */
  createRequest(method: string, params?: Record<string, unknown>): MCPMessage {
    const id = this.nextId++;
    return {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };
  }

  /** Register a pending request, returns a promise that resolves on response */
  waitForResponse(id: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  /** Handle an incoming message — resolves matching pending request */
  handleMessage(message: MCPMessage): void {
    if (message.id == null) return; // Notification, not a response

    const id = typeof message.id === "string" ? parseInt(message.id) : message.id;
    const pending = this.pending.get(id);
    if (!pending) return;

    this.pending.delete(id);

    if (message.error) {
      pending.reject(
        new MCPRequestError(message.error.code, message.error.message)
      );
    } else {
      pending.resolve(message.result);
    }
  }

  /** Send a request and wait for response */
  async request(
    method: string,
    params: Record<string, unknown> | undefined,
    send: (msg: MCPMessage) => Promise<void>
  ): Promise<unknown> {
    const msg = this.createRequest(method, params);
    const promise = this.waitForResponse(msg.id as number);
    await send(msg);
    return promise;
  }

  /** Clear all pending requests (on disconnect) */
  clear(): void {
    for (const [, pending] of this.pending) {
      pending.reject(new MCPConnectionError("Connection closed"));
    }
    this.pending.clear();
  }
}
