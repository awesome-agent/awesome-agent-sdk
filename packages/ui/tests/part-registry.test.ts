import { describe, it, expect } from "vitest";
import { PartRegistry } from "../src/part-registry.js";
import type { PartResolver, LoopEvent } from "../src/types.js";

describe("PartRegistry", () => {
  it("registers and retrieves resolvers", () => {
    const registry = new PartRegistry();
    const resolver: PartResolver = { resolve: () => null };

    registry.register(resolver);
    expect(registry.getResolvers()).toHaveLength(1);
    expect(registry.getResolvers()[0]).toBe(resolver);
  });

  it("unregisters a resolver", () => {
    const registry = new PartRegistry();
    const resolver: PartResolver = { resolve: () => null };

    registry.register(resolver);
    registry.unregister(resolver);
    expect(registry.getResolvers()).toHaveLength(0);
  });

  it("unregister on non-existent resolver is a no-op", () => {
    const registry = new PartRegistry();
    const resolver: PartResolver = { resolve: () => null };

    registry.unregister(resolver);
    expect(registry.getResolvers()).toHaveLength(0);
  });

  it("maintains registration order", () => {
    const registry = new PartRegistry();
    const r1: PartResolver = { resolve: () => null };
    const r2: PartResolver = { resolve: () => null };
    const r3: PartResolver = { resolve: () => null };

    registry.register(r1);
    registry.register(r2);
    registry.register(r3);

    const resolvers = registry.getResolvers();
    expect(resolvers[0]).toBe(r1);
    expect(resolvers[1]).toBe(r2);
    expect(resolvers[2]).toBe(r3);
  });

  it("resolver can return a CustomPart", () => {
    const resolver: PartResolver = {
      resolve: (event: LoopEvent) => {
        if (event.type === "text:delta") {
          return { type: "custom", kind: "highlight", data: { text: event.text } };
        }
        return null;
      },
    };

    const result = resolver.resolve({ type: "text:delta", text: "important" });
    expect(result).toEqual({
      type: "custom",
      kind: "highlight",
      data: { text: "important" },
    });
  });

  it("resolver returns null for unhandled events", () => {
    const resolver: PartResolver = {
      resolve: (event: LoopEvent) => {
        if (event.type === "plan:ready") {
          return { type: "custom", kind: "plan", data: {} };
        }
        return null;
      },
    };

    const result = resolver.resolve({ type: "text:delta", text: "hello" });
    expect(result).toBeNull();
  });
});
