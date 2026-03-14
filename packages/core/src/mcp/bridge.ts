// mcp/bridge.ts
// Converts MCP tools into agent-core Tool format

import type { Tool, ToolResult } from "../tool/types.js";
import type { ToolRegistry } from "../tool/executor-types.js";
import { globMatch } from "../agent/permissions.js";
import type { MCPClient, MCPToolDefinition } from "./types.js";

// ─── Bridge Options ─────────────────────────────────────────

export interface MCPBridgeOptions {
  readonly toolPrefix?: string; // Default: "${client.id}_"
  readonly includeFilter?: readonly string[]; // Glob patterns to include
  readonly excludeFilter?: readonly string[]; // Glob patterns to exclude
}

// ─── Bridge ─────────────────────────────────────────────────

export class MCPToolBridge {
  private readonly client: MCPClient;
  private readonly prefix: string;
  private readonly include?: readonly string[];
  private readonly exclude?: readonly string[];

  constructor(client: MCPClient, options?: MCPBridgeOptions) {
    this.client = client;
    this.prefix = options?.toolPrefix ?? `${client.id}_`;
    this.include = options?.includeFilter;
    this.exclude = options?.excludeFilter;
  }

  /** Discover MCP tools and convert to agent-core Tool format */
  async discoverTools(): Promise<readonly Tool[]> {
    const mcpTools = await this.client.listTools();
    return mcpTools
      .filter((t) => this.shouldInclude(t.name))
      .map((t) => this.convertTool(t));
  }

  /** Convenience: discover and register all tools in one step */
  async registerAll(registry: ToolRegistry): Promise<void> {
    const tools = await this.discoverTools();
    for (const tool of tools) {
      if (!registry.has(tool.name)) {
        registry.register(tool);
      }
    }
  }

  /** Discover, convert, and register tools from multiple MCP clients */
  static async registerFromClients(
    clients: readonly MCPClient[],
    registry: ToolRegistry,
    options?: MCPBridgeOptions
  ): Promise<void> {
    for (const client of clients) {
      const bridge = new MCPToolBridge(client, options);
      await bridge.registerAll(registry);
    }
  }

  private convertTool(mcpTool: MCPToolDefinition): Tool {
    const client = this.client;
    const originalName = mcpTool.name;

    return {
      name: `${this.prefix}${originalName}`,
      description: mcpTool.description ?? "",
      parameters: mcpTool.inputSchema,
      execute: async (args, _context): Promise<ToolResult> => {
        const result = await client.callTool(originalName, args);

        const textParts = result.content
          .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
          .map((p) => p.text);

        const files = result.content
          .filter((p): p is Extract<typeof p, { type: "image" }> => p.type === "image")
          .map((p) => ({
            name: "image",
            mimeType: p.mimeType,
            data: p.data,
          }));

        return {
          success: !result.isError,
          content: textParts.join("\n") || (result.isError ? "MCP tool error" : ""),
          ...(files.length > 0 ? { files } : {}),
        };
      },
    };
  }

  private shouldInclude(name: string): boolean {
    if (this.exclude?.some((p) => globMatch(p, name))) return false;
    if (this.include && !this.include.some((p) => globMatch(p, name))) return false;
    return true;
  }
}
