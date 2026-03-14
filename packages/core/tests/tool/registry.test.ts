import { describe, it, expect } from "vitest";
import { DefaultToolRegistry } from "../../src/tool/registry.js";
import type { Tool } from "../../src/tool/types.js";

function makeTool(name: string): Tool {
  return {
    name,
    description: `Tool ${name}`,
    parameters: { type: "object" },
    execute: async () => ({ success: true, content: "ok" }),
  };
}

describe("DefaultToolRegistry", () => {
  it("registers and retrieves a tool", () => {
    const reg = new DefaultToolRegistry();
    const tool = makeTool("read");

    reg.register(tool);
    expect(reg.get("read")).toBe(tool);
  });

  it("returns undefined for missing tool", () => {
    const reg = new DefaultToolRegistry();
    expect(reg.get("nope")).toBeUndefined();
  });

  it("throws on duplicate registration", () => {
    const reg = new DefaultToolRegistry();
    reg.register(makeTool("read"));
    expect(() => reg.register(makeTool("read"))).toThrow(
      'Tool "read" is already registered'
    );
  });

  it("has() returns correct boolean", () => {
    const reg = new DefaultToolRegistry();
    reg.register(makeTool("read"));

    expect(reg.has("read")).toBe(true);
    expect(reg.has("nope")).toBe(false);
  });

  it("getAll() returns all registered tools", () => {
    const reg = new DefaultToolRegistry();
    reg.register(makeTool("a"));
    reg.register(makeTool("b"));
    reg.register(makeTool("c"));

    const all = reg.getAll();
    expect(all).toHaveLength(3);
    expect(all.map((t) => t.name)).toEqual(
      expect.arrayContaining(["a", "b", "c"])
    );
  });
});
