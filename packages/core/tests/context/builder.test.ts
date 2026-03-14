import { describe, it, expect } from "vitest";
import { DefaultContextBuilder } from "../../src/context/builder.js";

describe("DefaultContextBuilder", () => {
  const builder = new DefaultContextBuilder();

  it("builds from base prompt only", () => {
    const result = builder.build({ basePrompt: "You are helpful." });
    expect(result).toBe("You are helpful.");
  });

  it("combines base + agent prompt", () => {
    const result = builder.build({
      basePrompt: "Base.",
      agentPrompt: "Agent.",
    });
    expect(result).toBe("Base.\n\nAgent.");
  });

  it("skips empty base prompt", () => {
    const result = builder.build({
      basePrompt: "",
      agentPrompt: "Agent only.",
    });
    expect(result).toBe("Agent only.");
  });

  it("includes skill prompts wrapped in tags", () => {
    const result = builder.build({
      basePrompt: "Base.",
      skillPrompts: [
        { skillName: "revit", content: "Revit instructions" },
      ],
    });
    expect(result).toContain('<skill name="revit">');
    expect(result).toContain("Revit instructions");
    expect(result).toContain("</skill>");
  });

  it("sorts skill prompts by priority (lower first)", () => {
    const result = builder.build({
      basePrompt: "",
      skillPrompts: [
        { skillName: "low", content: "Low priority", priority: 200 },
        { skillName: "high", content: "High priority", priority: 10 },
      ],
    });

    const highIdx = result.indexOf("High priority");
    const lowIdx = result.indexOf("Low priority");
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it("skills without priority get default (100)", () => {
    const result = builder.build({
      basePrompt: "",
      skillPrompts: [
        { skillName: "after", content: "After", priority: 200 },
        { skillName: "default", content: "Default" }, // priority=100
      ],
    });

    const defaultIdx = result.indexOf("Default");
    const afterIdx = result.indexOf("After");
    expect(defaultIdx).toBeLessThan(afterIdx);
  });

  it("includes dynamic sections wrapped in custom tags", () => {
    const result = builder.build({
      basePrompt: "Base.",
      dynamicSections: [
        { key: "env", label: "environment", content: "Windows 11" },
      ],
    });
    expect(result).toContain("<environment>");
    expect(result).toContain("Windows 11");
    expect(result).toContain("</environment>");
  });

  it("full prompt assembly order: base → agent → skills → dynamic", () => {
    const result = builder.build({
      basePrompt: "BASE",
      agentPrompt: "AGENT",
      skillPrompts: [{ skillName: "s1", content: "SKILL" }],
      dynamicSections: [{ key: "d1", label: "dyn", content: "DYNAMIC" }],
    });

    const baseIdx = result.indexOf("BASE");
    const agentIdx = result.indexOf("AGENT");
    const skillIdx = result.indexOf("SKILL");
    const dynIdx = result.indexOf("DYNAMIC");

    expect(baseIdx).toBeLessThan(agentIdx);
    expect(agentIdx).toBeLessThan(skillIdx);
    expect(skillIdx).toBeLessThan(dynIdx);
  });
});
