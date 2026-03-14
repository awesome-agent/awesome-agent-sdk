// skill/registry.ts
// Default SkillRegistry — name-based lookup with progressive disclosure

import type {
  Skill,
  SkillRegistry,
  SkillDescription,
} from "./types.js";
import { DuplicateRegistrationError } from "../errors.js";

export class DefaultSkillRegistry implements SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  register(skill: Skill): void {
    if (this.skills.has(skill.name)) {
      throw new DuplicateRegistrationError("Skill", skill.name);
    }
    this.skills.set(skill.name, skill);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  getAll(): readonly Skill[] {
    return [...this.skills.values()];
  }

  getDescriptions(): readonly SkillDescription[] {
    return this.getAll().map((skill) => ({
      name: skill.name,
      description: skill.description,
      triggers: this.extractTriggerSummaries(skill),
    }));
  }

  private extractTriggerSummaries(skill: Skill): readonly string[] {
    return skill.triggers.map((t) => {
      switch (t.type) {
        case "keyword":
          return t.keyword;
        case "pattern":
          return t.pattern;
        case "semantic":
          return t.description;
      }
    });
  }
}
