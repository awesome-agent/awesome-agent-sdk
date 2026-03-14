// mcp/types.ts
// Model Context Protocol — external tool discovery and execution

import type { JsonSchema } from "../schema/types.js";

// ─── JSON-RPC 2.0 Transport ────────────────────────────────

export interface MCPMessage {
  readonly jsonrpc: "2.0";
  readonly id?: string | number;
  readonly method?: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly result?: unknown;
  readonly error?: MCPError;
}

export interface MCPError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

/** Low-level transport — stdio, SSE, WebSocket, etc. */
export interface MCPTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: MCPMessage): Promise<void>;
  onMessage(handler: (message: MCPMessage) => void): void;
}

// ─── MCP Tool Definitions ───────────────────────────────────

export interface MCPToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: JsonSchema;
}

// ─── MCP Content Types ──────────────────────────────────────

export type MCPContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string }
  | { readonly type: "resource"; readonly uri: string; readonly text?: string };

export interface MCPToolCallResult {
  readonly content: readonly MCPContentPart[];
  readonly isError?: boolean;
}

// ─── MCP Client Interface ───────────────────────────────────
// Implementation lives outside core (per transport type)

export interface MCPClient {
  readonly id: string;
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<readonly MCPToolDefinition[]>;
  callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<MCPToolCallResult>;
}
