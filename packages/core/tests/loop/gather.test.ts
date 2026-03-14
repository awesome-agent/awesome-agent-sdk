import { describe, it, expect } from "vitest";
import { gatherPhase } from "../../src/loop/gather.js";
import { DefaultSkillRegistry } from "../../src/skill/registry.js";
import { DefaultSkillDetector } from "../../src/skill/detector.js";
import { MockLLMAdapter } from "../../src/llm/mock-adapter.js";
import { makeAgent, makeLoopConfig, makeMemoryStore, makeMemoryEntry } from "../helpers/factories.js";
import type { LoopConfig } from "../../src/loop/types.js";

function makeConfig(overrides?: Partial<LoopConfig>): LoopConfig {
  const llm = new MockLLMAdapter();
  return makeLoopConfig(llm, overrides);
}

// ─── Tests ───────────────────────────────────────────────────

describe("gatherPhase", () => {
  it("builds system prompt with agent prompt", async () => {
    const config = makeConfig({
      agent: makeAgent({ prompt: "You are a coding assistant." }),
    });

    const result = await gatherPhase(config, "hello");

    expect(result).toContain("You are a coding assistant.");
  });

  it("detects skills and injects skill prompts", async () => {
    const skills = new DefaultSkillRegistry();
    skills.register({
      name: "revit",
      description: "Revit BIM skill",
      triggers: [{ type: "keyword", keyword: "wall" }],
    });

    const config = makeConfig({
      skills,
      skillDetector: new DefaultSkillDetector(),
      skillLoader: {
        loadPrompt: async (name) => `<${name}-skill-content>`,
      },
    });

    const result = await gatherPhase(config, "create a wall");

    expect(result).toContain("revit-skill-content");
  });

  it("detects child skills and injects both prompts", async () => {
    const skills = new DefaultSkillRegistry();
    skills.register({
      name: "revit",
      description: "Revit skill",
      triggers: [{ type: "keyword", keyword: "wall" }],
      children: [
        {
          name: "revit-placement",
          description: "Placement sub-skill",
          triggers: [{ type: "keyword", keyword: "wall" }],
        },
      ],
    });

    const loaded: string[] = [];
    const config = makeConfig({
      skills,
      skillDetector: new DefaultSkillDetector(),
      skillLoader: {
        loadPrompt: async (name) => {
          loaded.push(name);
          return `<${name}>`;
        },
      },
    });

    await gatherPhase(config, "create a wall");

    expect(loaded).toContain("revit");
    expect(loaded).toContain("revit-placement");
  });

  it("retrieves memory and passes as sections", async () => {
    const entry = makeMemoryEntry({ content: "User prefers TypeScript" });
    const memory = makeMemoryStore([entry]);

    const config = makeConfig({ memory });
    const result = await gatherPhase(config, "TypeScript");

    expect(result).toContain("User prefers TypeScript");
  });

  it("skips memory sections when search returns empty", async () => {
    const memory = makeMemoryStore([]);

    const config = makeConfig({ memory });
    const result = await gatherPhase(config, "nothing");

    // Should still build a valid prompt without memory
    expect(typeof result).toBe("string");
    expect(result).toContain("You are a test assistant.");
  });

  it("injects approved plan into agent prompt", async () => {
    const config = makeConfig({
      approvedPlan: "Step 1: Read\nStep 2: Write",
    });

    const result = await gatherPhase(config, "go");

    expect(result).toContain("<approved-plan>");
    expect(result).toContain("Step 1: Read");
    expect(result).toContain("Step 2: Write");
    expect(result).toContain("Follow the approved plan above");
  });

  it("works without optional dependencies", async () => {
    const config = makeConfig();
    // No skills, no memory, no approvedPlan

    const result = await gatherPhase(config, "hello");

    expect(typeof result).toBe("string");
    expect(result).toContain("You are a test assistant.");
  });

  it("does not inject skill prompts when skillDetector finds no match", async () => {
    const skills = new DefaultSkillRegistry();
    skills.register({
      name: "revit",
      description: "Revit",
      triggers: [{ type: "keyword", keyword: "wall" }],
    });

    const config = makeConfig({
      skills,
      skillDetector: new DefaultSkillDetector(),
      skillLoader: {
        loadPrompt: async () => "<should-not-appear>",
      },
    });

    const result = await gatherPhase(config, "unrelated input");

    expect(result).not.toContain("should-not-appear");
  });
});
