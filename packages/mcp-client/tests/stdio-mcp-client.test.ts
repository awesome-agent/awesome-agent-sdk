import { describe, it, expect, vi, afterEach } from "vitest";
import { StdioMCPClient } from "../src/stdio-mcp-client.js";

// ─── Note ────────────────────────────────────────────────────
// StdioMCPClient spawns real child processes. These tests verify
// configuration and error handling without requiring an actual
// MCP server. Integration tests with real servers belong in examples/.
//
// Tests for connect(), listTools(), and callTool() with a live server
// are intentionally omitted here. They require a running MCP server
// process, making them integration tests rather than unit tests.
// See examples/ for end-to-end usage.

describe("StdioMCPClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes id and name from config", () => {
    const client = new StdioMCPClient({
      id: "fal",
      name: "fal.ai",
      command: "npx",
      args: ["-y", "mcp-fal"],
    });

    expect(client.id).toBe("fal");
    expect(client.name).toBe("fal.ai");
  });

  it("throws MCPConnectionError when calling listTools before connect", async () => {
    const { MCPConnectionError } = await import("@awesome-agent/agent-core");
    const client = new StdioMCPClient({
      id: "test",
      name: "Test",
      command: "echo",
    });

    await expect(client.listTools()).rejects.toBeInstanceOf(MCPConnectionError);
  });

  it("throws MCPConnectionError when calling callTool before connect", async () => {
    const { MCPConnectionError } = await import("@awesome-agent/agent-core");
    const client = new StdioMCPClient({
      id: "test",
      name: "Test",
      command: "echo",
    });

    await expect(client.callTool("read", {})).rejects.toBeInstanceOf(MCPConnectionError);
  });

  it("disconnect is safe to call without connect", async () => {
    const client = new StdioMCPClient({
      id: "test",
      name: "Test",
      command: "echo",
    });

    await expect(client.disconnect()).resolves.toBeUndefined();
  });

  it("accepts environment variables in config", () => {
    const client = new StdioMCPClient({
      id: "fal",
      name: "fal.ai",
      command: "npx",
      args: ["-y", "mcp-fal"],
      env: { FAL_KEY: "test-key" },
      cwd: "/tmp",
      timeout: 5000,
    });

    // Config is stored — verified by id/name access
    expect(client.id).toBe("fal");
  });
});
