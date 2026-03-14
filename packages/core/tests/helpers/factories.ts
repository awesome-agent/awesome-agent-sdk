// tests/helpers/factories.ts
// Shared factory functions for all test files — single source of truth

import { MockLLMAdapter } from "../../src/llm/mock-adapter.js";
import { DefaultHookManager } from "../../src/hook/manager.js";
import { DefaultToolRegistry } from "../../src/tool/registry.js";
import { DefaultToolExecutor } from "../../src/tool/executor.js";
import { DefaultContextBuilder } from "../../src/context/builder.js";
import type { LoopConfig } from "../../src/loop/types.js";
import type { AgentConfig } from "../../src/agent/types.js";
import type { Tool } from "../../src/tool/types.js";
import type { Message } from "../../src/llm/types.js";
import type {
  MCPClient,
  MCPToolDefinition,
  MCPToolCallResult,
} from "../../src/mcp/types.js";
import type {
  MemoryStore,
  MemoryEntry,
  MemorySearchResult,
} from "../../src/memory/types.js";

// ─── Message Helpers ─────────────────────────────────────────

export function userMsg(text: string): Message {
  return { role: "user", content: text };
}

export function assistantMsg(text: string): Message {
  return { role: "assistant", content: [{ type: "text", text }] };
}

export function systemMsg(text: string): Message {
  return { role: "system", content: text };
}

// ─── Agent & Tool ────────────────────────────────────────────

export function makeAgent(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    id: "test-agent",
    name: "Test",
    prompt: "You are a test assistant.",
    maxIterations: 10,
    ...overrides,
  };
}

export function makeTool(
  name: string,
  result = "ok",
  success = true
): Tool {
  return {
    name,
    description: `Tool ${name}`,
    parameters: { type: "object" },
    execute: async () => ({ success, content: result }),
  };
}

// ─── Loop Config ─────────────────────────────────────────────

export function makeLoopConfig(
  llm: MockLLMAdapter,
  overrides?: Partial<LoopConfig>
): LoopConfig {
  const tools = new DefaultToolRegistry();
  return {
    llm,
    agent: makeAgent(),
    tools,
    executor: new DefaultToolExecutor(tools),
    hooks: new DefaultHookManager(),
    context: new DefaultContextBuilder(),
    ...overrides,
  };
}

// ─── MCP Client ──────────────────────────────────────────────

export function makeMCPClient(
  id: string,
  toolDefs: MCPToolDefinition[],
  callResult?: MCPToolCallResult
): MCPClient {
  return {
    id,
    name: `Mock ${id}`,
    connect: async () => {},
    disconnect: async () => {},
    listTools: async () => toolDefs,
    callTool: async () =>
      callResult ?? { content: [{ type: "text", text: "mcp-ok" }] },
  };
}

// ─── Memory Store ────────────────────────────────────────────

export function makeMemoryEntry(
  overrides?: Partial<MemoryEntry>
): MemoryEntry {
  return {
    id: "mem_1",
    type: "user",
    name: "role",
    content: "Senior TypeScript developer",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

export function makeMemoryStore(entries: MemoryEntry[]): MemoryStore {
  return {
    save: async () => entries[0],
    delete: async () => {},
    getAll: async () => entries,
    search: async (query, options) => {
      const results: MemorySearchResult[] = entries.map((entry) => ({
        entry,
        relevance: entry.content.toLowerCase().includes(query.toLowerCase())
          ? 0.9
          : 0.1,
      }));
      results.sort((a, b) => b.relevance - a.relevance);
      return results.slice(0, options?.maxResults ?? results.length);
    },
  };
}
