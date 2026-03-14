import { describe, it, expect } from "vitest";
import { DefaultSkillRegistry } from "../../src/skill/registry.js";
import type { Skill } from "../../src/skill/types.js";
import { DuplicateRegistrationError } from "../../src/errors.js";

function makeSkill(name: string, keywords: string[] = []): Skill {
  return {
    name,
    description: `Skill ${name}`,
    triggers: keywords.map((k) => ({ type: "keyword" as const, keyword: k })),
  };
}

describe("DefaultSkillRegistry", () => {
  it("registers and retrieves a skill", () => {
    const reg = new DefaultSkillRegistry();
    const skill = makeSkill("revit", ["wall"]);

    reg.register(skill);
    expect(reg.get("revit")).toBe(skill);
  });

  it("returns undefined for missing skill", () => {
    const reg = new DefaultSkillRegistry();
    expect(reg.get("nope")).toBeUndefined();
  });

  it("throws on duplicate registration", () => {
    const reg = new DefaultSkillRegistry();
    reg.register(makeSkill("revit"));
    expect(() => reg.register(makeSkill("revit"))).toThrow(
      DuplicateRegistrationError
    );
  });

  it("getAll() returns all skills", () => {
    const reg = new DefaultSkillRegistry();
    reg.register(makeSkill("a"));
    reg.register(makeSkill("b"));

    expect(reg.getAll()).toHaveLength(2);
  });

  it("getDescriptions() returns lightweight summaries", () => {
    const reg = new DefaultSkillRegistry();
    reg.register(makeSkill("revit", ["wall", "floor"]));

    const descs = reg.getDescriptions();
    expect(descs).toHaveLength(1);
    expect(descs[0].name).toBe("revit");
    expect(descs[0].description).toBe("Skill revit");
    expect(descs[0].triggers).toEqual(["wall", "floor"]);
  });

  it("getDescriptions() handles pattern and semantic triggers", () => {
    const reg = new DefaultSkillRegistry();
    reg.register({
      name: "mixed",
      description: "Mixed triggers",
      triggers: [
        { type: "keyword", keyword: "kw" },
        { type: "pattern", pattern: "create\\s+wall" },
        { type: "semantic", description: "wall creation" },
      ],
    });

    const descs = reg.getDescriptions();
    expect(descs[0].triggers).toEqual([
      "kw",
      "create\\s+wall",
      "wall creation",
    ]);
  });
});
