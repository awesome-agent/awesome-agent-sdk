import { describe, it, expect } from "vitest";
import { JsonRpcClient } from "../src/json-rpc.js";

describe("JsonRpcClient", () => {
  it("creates request with incrementing IDs", () => {
    const client = new JsonRpcClient();

    const req1 = client.createRequest("tools/list");
    const req2 = client.createRequest("tools/call", { name: "read" });

    expect(req1.jsonrpc).toBe("2.0");
    expect(req1.id).toBe(1);
    expect(req1.method).toBe("tools/list");

    expect(req2.id).toBe(2);
    expect(req2.params).toEqual({ name: "read" });
  });

  it("resolves pending request on matching response", async () => {
    const client = new JsonRpcClient();

    const promise = client.waitForResponse(1);

    client.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      result: { tools: ["read", "write"] },
    });

    const result = await promise;
    expect(result).toEqual({ tools: ["read", "write"] });
  });

  it("rejects pending request with MCPRequestError on error response", async () => {
    const { MCPRequestError } = await import("@awesome-agent/agent-core");
    const client = new JsonRpcClient();

    const promise = client.waitForResponse(1);

    client.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32600, message: "Invalid Request" },
    });

    try {
      await promise;
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(MCPRequestError);
      expect((e as InstanceType<typeof MCPRequestError>).code).toBe(-32600);
    }
  });

  it("ignores messages without matching ID", () => {
    const client = new JsonRpcClient();

    // Should not throw
    client.handleMessage({ jsonrpc: "2.0", id: 999, result: "orphan" });
    client.handleMessage({ jsonrpc: "2.0", method: "notification" }); // no id
  });

  it("handles string IDs", async () => {
    const client = new JsonRpcClient();

    const promise = client.waitForResponse(1);

    // Some servers return string IDs
    client.handleMessage({
      jsonrpc: "2.0",
      id: "1",
      result: "ok",
    });

    const result = await promise;
    expect(result).toBe("ok");
  });

  it("request() sends and waits for response", async () => {
    const client = new JsonRpcClient();
    const sent: unknown[] = [];

    const promise = client.request("tools/list", undefined, async (msg) => {
      sent.push(msg);
      // Simulate server response
      setTimeout(() => {
        client.handleMessage({
          jsonrpc: "2.0",
          id: msg.id,
          result: { tools: [] },
        });
      }, 0);
    });

    const result = await promise;
    expect(result).toEqual({ tools: [] });
    expect(sent).toHaveLength(1);
  });

  it("clear() rejects all pending requests with MCPConnectionError", async () => {
    const { MCPConnectionError } = await import("@awesome-agent/agent-core");
    const client = new JsonRpcClient();

    const p1 = client.waitForResponse(1);
    const p2 = client.waitForResponse(2);

    client.clear();

    await expect(p1).rejects.toBeInstanceOf(MCPConnectionError);
    await expect(p2).rejects.toBeInstanceOf(MCPConnectionError);
  });
});
