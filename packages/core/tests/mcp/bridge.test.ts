import { describe, it, expect } from "vitest";
import { MCPToolBridge } from "../../src/mcp/bridge.js";
import { DefaultToolRegistry } from "../../src/tool/registry.js";
import { makeMCPClient } from "../helpers/factories.js";

describe("MCPToolBridge", () => {
  it("discovers and converts MCP tools to agent-core format", async () => {
    const client = makeMCPClient("server1", [
      { name: "read", description: "Read a file", inputSchema: { type: "object" } },
      { name: "write", description: "Write a file", inputSchema: { type: "object" } },
    ]);

    const bridge = new MCPToolBridge(client);
    const tools = await bridge.discoverTools();

    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe("server1_read");
    expect(tools[0].description).toBe("Read a file");
    expect(tools[1].name).toBe("server1_write");
  });

  it("applies custom tool prefix", async () => {
    const client = makeMCPClient("s1", [
      { name: "read", inputSchema: { type: "object" } },
    ]);

    const bridge = new MCPToolBridge(client, { toolPrefix: "revit_" });
    const tools = await bridge.discoverTools();

    expect(tools[0].name).toBe("revit_read");
  });

  it("filters tools with include/exclude patterns", async () => {
    const client = makeMCPClient("s1", [
      { name: "read_file", inputSchema: { type: "object" } },
      { name: "write_file", inputSchema: { type: "object" } },
      { name: "delete_file", inputSchema: { type: "object" } },
    ]);

    const bridge = new MCPToolBridge(client, {
      includeFilter: ["*_file"],
      excludeFilter: ["delete_*"],
    });
    const tools = await bridge.discoverTools();

    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toEqual(["s1_read_file", "s1_write_file"]);
  });

  it("executes tool via MCP client and returns ToolResult", async () => {
    const client = makeMCPClient("s1", [
      { name: "echo", inputSchema: { type: "object" } },
    ], {
      content: [{ type: "text", text: "hello world" }],
    });

    const bridge = new MCPToolBridge(client);
    const tools = await bridge.discoverTools();
    const result = await tools[0].execute({ msg: "hi" }, {} as any);

    expect(result.success).toBe(true);
    expect(result.content).toBe("hello world");
  });

  it("handles MCP error responses", async () => {
    const client = makeMCPClient("s1", [
      { name: "fail", inputSchema: { type: "object" } },
    ], {
      content: [{ type: "text", text: "something went wrong" }],
      isError: true,
    });

    const bridge = new MCPToolBridge(client);
    const tools = await bridge.discoverTools();
    const result = await tools[0].execute({}, {} as any);

    expect(result.success).toBe(false);
    expect(result.content).toBe("something went wrong");
  });

  it("converts image content parts to ToolFile", async () => {
    const client = makeMCPClient("s1", [
      { name: "capture", inputSchema: { type: "object" } },
    ], {
      content: [
        { type: "text", text: "captured" },
        { type: "image", data: "base64data", mimeType: "image/png" },
      ],
    });

    const bridge = new MCPToolBridge(client);
    const tools = await bridge.discoverTools();
    const result = await tools[0].execute({}, {} as any);

    expect(result.success).toBe(true);
    expect(result.content).toBe("captured");
    expect(result.files).toHaveLength(1);
    expect(result.files![0].mimeType).toBe("image/png");
    expect(result.files![0].data).toBe("base64data");
  });

  it("registers tools into a ToolRegistry", async () => {
    const client = makeMCPClient("s1", [
      { name: "read", inputSchema: { type: "object" } },
      { name: "write", inputSchema: { type: "object" } },
    ]);

    const registry = new DefaultToolRegistry();
    const bridge = new MCPToolBridge(client);
    await bridge.registerAll(registry);

    expect(registry.has("s1_read")).toBe(true);
    expect(registry.has("s1_write")).toBe(true);
    expect(registry.getAll()).toHaveLength(2);
  });

  it("skips already registered tools in registerAll", async () => {
    const client = makeMCPClient("s1", [
      { name: "read", inputSchema: { type: "object" } },
    ]);

    const registry = new DefaultToolRegistry();
    const bridge = new MCPToolBridge(client);
    await bridge.registerAll(registry);
    // Second call should not throw
    await bridge.registerAll(registry);

    expect(registry.getAll()).toHaveLength(1);
  });

  it("registerFromClients handles multiple clients", async () => {
    const client1 = makeMCPClient("revit", [
      { name: "execute_script", inputSchema: { type: "object" } },
    ]);
    const client2 = makeMCPClient("rhino", [
      { name: "execute_script", inputSchema: { type: "object" } },
    ]);

    const registry = new DefaultToolRegistry();
    await MCPToolBridge.registerFromClients([client1, client2], registry);

    expect(registry.has("revit_execute_script")).toBe(true);
    expect(registry.has("rhino_execute_script")).toBe(true);
    expect(registry.getAll()).toHaveLength(2);
  });

  it("handles tool with missing description", async () => {
    const client = makeMCPClient("s1", [
      { name: "no_desc", inputSchema: { type: "object" } },
    ]);

    const bridge = new MCPToolBridge(client);
    const tools = await bridge.discoverTools();

    expect(tools[0].description).toBe("");
  });
});
