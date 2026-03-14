import { describe, it, expect } from "vitest";
import { AgentConfigBuilder } from "../../src/agent/config.js";

describe("AgentConfigBuilder", () => {
  it("builds config with required fields", () => {
    const config = new AgentConfigBuilder()
      .id("agent-1")
      .name("Test Agent")
      .prompt("You are helpful.")
      .build();

    expect(config.id).toBe("agent-1");
    expect(config.name).toBe("Test Agent");
    expect(config.prompt).toBe("You are helpful.");
  });

  it("applies defaults — temperature=0.7, maxIterations=50", () => {
    const config = new AgentConfigBuilder()
      .id("a1")
      .name("A")
      .prompt("P")
      .build();

    expect(config.temperature).toBe(0.7);
    expect(config.maxIterations).toBe(50);
  });

  it("overrides defaults", () => {
    const config = new AgentConfigBuilder()
      .id("a1")
      .name("A")
      .prompt("P")
      .temperature(0.3)
      .maxIterations(100)
      .build();

    expect(config.temperature).toBe(0.3);
    expect(config.maxIterations).toBe(100);
  });

  it("sets optional fields", () => {
    const config = new AgentConfigBuilder()
      .id("a1")
      .name("A")
      .prompt("P")
      .model("gpt-4o")
      .maxSteps(20)
      .tools(["read", "write"])
      .skills(["revit"])
      .permissions([{ tool: "*", action: "*", decision: "allow" }])
      .build();

    expect(config.model).toBe("gpt-4o");
    expect(config.maxSteps).toBe(20);
    expect(config.tools).toEqual(["read", "write"]);
    expect(config.skills).toEqual(["revit"]);
    expect(config.permissions).toHaveLength(1);
  });

  it("throws when id missing", () => {
    expect(() =>
      new AgentConfigBuilder().name("A").prompt("P").build()
    ).toThrow("AgentConfig requires id");
  });

  it("throws when name missing", () => {
    expect(() =>
      new AgentConfigBuilder().id("a1").prompt("P").build()
    ).toThrow("AgentConfig requires name");
  });

  it("throws when prompt missing", () => {
    expect(() =>
      new AgentConfigBuilder().id("a1").name("A").build()
    ).toThrow("AgentConfig requires prompt");
  });

  it("fluent API returns this", () => {
    const builder = new AgentConfigBuilder();
    expect(builder.id("a1")).toBe(builder);
    expect(builder.name("A")).toBe(builder);
    expect(builder.prompt("P")).toBe(builder);
    expect(builder.model("m")).toBe(builder);
    expect(builder.temperature(0.5)).toBe(builder);
    expect(builder.maxIterations(10)).toBe(builder);
    expect(builder.maxSteps(5)).toBe(builder);
    expect(builder.tools([])).toBe(builder);
    expect(builder.skills([])).toBe(builder);
    expect(builder.permissions([])).toBe(builder);
  });
});
