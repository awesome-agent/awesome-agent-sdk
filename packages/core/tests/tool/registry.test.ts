import { describe, it, expect } from "vitest";
import { DefaultToolRegistry } from "../../src/tool/registry.js";
import { DuplicateRegistrationError } from "../../src/errors.js";
import { makeTool } from "../helpers/factories.js";

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

  it("throws DuplicateRegistrationError on duplicate registration", () => {
    const reg = new DefaultToolRegistry();
    reg.register(makeTool("read"));
    expect(() => reg.register(makeTool("read"))).toThrow(DuplicateRegistrationError);
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

  it("getDeferred() returns only shouldDefer tools", () => {
    const reg = new DefaultToolRegistry();
    reg.register(makeTool("normal"));
    reg.register({ ...makeTool("deferred1"), shouldDefer: true, searchHint: "search hint" });
    reg.register({ ...makeTool("deferred2"), shouldDefer: true });

    const deferred = reg.getDeferred();
    expect(deferred).toHaveLength(2);
    expect(deferred.map((d) => d.name)).toEqual(
      expect.arrayContaining(["deferred1", "deferred2"])
    );
    expect(deferred.find((d) => d.name === "deferred1")?.searchHint).toBe("search hint");
  });

  it("getNonDeferred() excludes deferred tools", () => {
    const reg = new DefaultToolRegistry();
    reg.register(makeTool("normal1"));
    reg.register(makeTool("normal2"));
    reg.register({ ...makeTool("deferred"), shouldDefer: true });

    const nonDeferred = reg.getNonDeferred();
    expect(nonDeferred).toHaveLength(2);
    expect(nonDeferred.map((t) => t.name)).toEqual(
      expect.arrayContaining(["normal1", "normal2"])
    );
  });

  it("getNonDeferred() returns all when none deferred", () => {
    const reg = new DefaultToolRegistry();
    reg.register(makeTool("a"));
    reg.register(makeTool("b"));

    expect(reg.getNonDeferred()).toHaveLength(2);
    expect(reg.getDeferred()).toHaveLength(0);
  });
});
