// StdioMCPClient — spawns an MCP server as child process, communicates via stdin/stdout
// Used by: Claude Desktop, Cursor, Claude Code — the standard MCP transport

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import {
  MCPConnectionError,
  MCPTimeoutError,
} from "@awesome-agent/agent-core";
import type {
  MCPClient,
  MCPMessage,
  MCPToolDefinition,
  MCPToolCallResult,
} from "@awesome-agent/agent-core";
import { JsonRpcClient, JSONRPC_VERSION } from "./json-rpc.js";

// ─── Configuration ───────────────────────────────────────────

export interface StdioMCPClientConfig {
  /** Unique identifier for this MCP server */
  readonly id: string;
  /** Display name */
  readonly name: string;
  /** Command to run (e.g., "npx", "node", "python") */
  readonly command: string;
  /** Command arguments (e.g., ["-y", "mcp-fal"]) */
  readonly args?: readonly string[];
  /** Environment variables for the child process */
  readonly env?: Readonly<Record<string, string>>;
  /** Working directory */
  readonly cwd?: string;
  /** Timeout for requests in ms. Default: 30000 */
  readonly timeout?: number;
}

// ─── Constants ───────────────────────────────────────────────

const DEFAULT_TIMEOUT = 30_000;
const CLIENT_VERSION = "0.1.0";
const MCP_PROTOCOL_VERSION = "2024-11-05";
const MCP_METHOD_INITIALIZE = "initialize";
const MCP_METHOD_INITIALIZED = "notifications/initialized";
const MCP_METHOD_LIST_TOOLS = "tools/list";
const MCP_METHOD_CALL_TOOL = "tools/call";

// ─── Implementation ─────────────────────────────────────────

export class StdioMCPClient implements MCPClient {
  readonly id: string;
  readonly name: string;

  private readonly config: StdioMCPClientConfig;
  private readonly rpc = new JsonRpcClient();
  private process: ChildProcess | null = null;
  private connected = false;

  constructor(config: StdioMCPClientConfig) {
    this.id = config.id;
    this.name = config.name;
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.process = spawn(this.config.command, [...(this.config.args ?? [])], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.config.env },
      cwd: this.config.cwd,
    });

    // Read JSON-RPC responses from stdout (one JSON per line)
    const rl = createInterface({ input: this.process.stdout! });
    rl.on("line", (line) => {
      try {
        const message: MCPMessage = JSON.parse(line);
        this.rpc.handleMessage(message);
      } catch {
        // Non-JSON output — ignore (server logs, etc.)
      }
    });

    // Handle process exit
    this.process.on("exit", () => {
      this.connected = false;
      this.rpc.clear();
    });

    this.connected = true;

    // MCP initialization handshake
    await this.request(MCP_METHOD_INITIALIZE, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: this.name, version: CLIENT_VERSION },
    });

    await this.notify(MCP_METHOD_INITIALIZED);
  }

  async disconnect(): Promise<void> {
    if (!this.connected || !this.process) return;

    this.rpc.clear();
    this.process.kill();
    this.process = null;
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
    args: Record<string, unknown>
  ): Promise<MCPToolCallResult> {
    const result = (await this.request(MCP_METHOD_CALL_TOOL, {
      name,
      arguments: args,
    })) as MCPToolCallResult;
    return result;
  }

  // ─── Private Helpers ──────────────────────────────────────

  private ensureConnected(): void {
    if (!this.process?.stdin) {
      throw new MCPConnectionError();
    }
  }

  private sendMessage(msg: MCPMessage): void {
    this.process!.stdin!.write(JSON.stringify(msg) + "\n");
  }

  private async request(
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    this.ensureConnected();

    const timeout = this.config.timeout ?? DEFAULT_TIMEOUT;

    let timer: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new MCPTimeoutError(method)), timeout);
    });

    try {
      return await Promise.race([
        this.rpc.request(method, params, async (msg) => {
          this.sendMessage(msg);
        }),
        timeoutPromise,
      ]);
    } finally {
      clearTimeout(timer!);
    }
  }

  private async notify(method: string): Promise<void> {
    this.ensureConnected();

    const msg: MCPMessage = { jsonrpc: JSONRPC_VERSION, method };
    this.sendMessage(msg);
  }
}
