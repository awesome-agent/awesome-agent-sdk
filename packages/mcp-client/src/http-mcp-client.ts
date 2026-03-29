// HttpMCPClient — connects to a remote MCP server via Streamable HTTP (2025-03-26 spec)
// Used for: remote MCP servers, plugin proxies, any HTTP-accessible MCP endpoint

import type {
  MCPClient,
  MCPMessage,
  MCPToolDefinition,
  MCPToolCallResult,
} from "@awesome-agent/agent-core";
import { MCPConnectionError, MCPTimeoutError, MCPRequestError } from "./errors.js";
import { JSONRPC_VERSION } from "./json-rpc.js";

// ─── Configuration ───────────────────────────────────────────

export interface HttpMCPClientConfig {
  /** Unique identifier for this MCP server */
  readonly id: string;
  /** Display name */
  readonly name: string;
  /** MCP endpoint URL (e.g., "https://example.com/mcp") */
  readonly url: string;
  /** Authorization token (sent as Bearer header) */
  readonly authorizationToken?: string;
  /** Custom headers */
  readonly headers?: Readonly<Record<string, string>>;
  /** Timeout for requests in ms. Default: 30000 */
  readonly timeout?: number;
}

// ─── Constants ───────────────────────────────────────────────

const DEFAULT_TIMEOUT = 30_000;
const CLIENT_VERSION = "0.1.0";
const MCP_PROTOCOL_VERSION = "2025-03-26";
const MCP_METHOD_INITIALIZE = "initialize";
const MCP_METHOD_INITIALIZED = "notifications/initialized";
const MCP_METHOD_LIST_TOOLS = "tools/list";
const MCP_METHOD_CALL_TOOL = "tools/call";

// ─── Implementation ─────────────────────────────────────────

export class HttpMCPClient implements MCPClient {
  readonly id: string;
  readonly name: string;

  private readonly config: HttpMCPClientConfig;
  private nextId = 1;
  private sessionId: string | null = null;
  private connected = false;

  constructor(config: HttpMCPClientConfig) {
    this.id = config.id;
    this.name = config.name;
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const result = await this.request(MCP_METHOD_INITIALIZE, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: this.name, version: CLIENT_VERSION },
    });

    if (!result) {
      throw new MCPConnectionError("Initialize returned empty result");
    }

    await this.notify(MCP_METHOD_INITIALIZED);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    if (this.sessionId) {
      try {
        await fetch(this.config.url, {
          method: "DELETE",
          headers: this.buildHeaders(),
        });
      } catch {
        // Best effort
      }
    }

    this.sessionId = null;
    this.connected = false;
  }

  async listTools(): Promise<readonly MCPToolDefinition[]> {
    const result = (await this.request(MCP_METHOD_LIST_TOOLS, {})) as {
      tools: MCPToolDefinition[];
    };
    return result.tools ?? [];
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<MCPToolCallResult> {
    return (await this.request(MCP_METHOD_CALL_TOOL, {
      name,
      arguments: args,
    })) as MCPToolCallResult;
  }

  // ─── Private Helpers ──────────────────────────────────────

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      ...(this.config.headers ?? {}),
    };

    if (this.config.authorizationToken) {
      headers["Authorization"] = `Bearer ${this.config.authorizationToken}`;
    }

    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    return headers;
  }

  private async request(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    const id = this.nextId++;
    const body: MCPMessage = {
      jsonrpc: JSONRPC_VERSION,
      id,
      method,
      params,
    };

    const timeout = this.config.timeout ?? DEFAULT_TIMEOUT;
    const response = await fetch(this.config.url, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    }).catch((err: unknown) => {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new MCPTimeoutError(method);
      }
      throw new MCPConnectionError(
        err instanceof Error ? err.message : "HTTP request failed",
      );
    });

    // Extract session ID from response headers
    const newSessionId = response.headers.get("Mcp-Session-Id");
    if (newSessionId) {
      this.sessionId = newSessionId;
    }

    if (!response.ok) {
      throw new MCPRequestError(response.status, `HTTP ${String(response.status)}`);
    }

    const result = (await response.json()) as MCPMessage;

    if (result.error) {
      throw new MCPRequestError(result.error.code, result.error.message);
    }

    return result.result;
  }

  private async notify(method: string): Promise<void> {
    const body: MCPMessage = { jsonrpc: JSONRPC_VERSION, method };

    await fetch(this.config.url, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });
  }
}
