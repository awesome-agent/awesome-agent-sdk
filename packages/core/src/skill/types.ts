// skill/types.ts

import type { Message } from "../llm/types.js";

// ─── Skill Definition (pure data) ───────────────────────────

export interface Skill {
  readonly name: string;
  readonly description: string; // Always loaded (progressive disclosure)
  readonly triggers: readonly SkillTrigger[];
  readonly children?: readonly Skill[];
  readonly toolFilter?: readonly string[]; // Glob patterns: "revit_*"
}

// ─── Skill Triggers (discriminated union) ────────────────────

export type SkillTrigger =
  | {
      readonly type: "keyword";
      readonly keyword: string;
      readonly weight?: number;
    }
  | {
      readonly type: "pattern";
      readonly pattern: string;
      readonly flags?: string;
      readonly weight?: number;
    }
  | {
      readonly type: "semantic";
      readonly description: string;
      readonly weight?: number;
    };

// ─── Skill Detection ─────────────────────────────────────────

export interface SkillMatch {
  readonly skill: Skill;
  readonly childSkill?: Skill;
  readonly confidence: number; // 0-1
  readonly method: "keyword" | "pattern" | "llm";
}

/** Strategy interface — swap detection algorithms without changing core */
export interface SkillDetector {
  detect(
    input: string,
    skills: readonly Skill[],
    context?: DetectorContext
  ): Promise<SkillMatch | null>;
}

export interface DetectorContext {
  readonly chatHistory?: readonly Message[];
  readonly activeTools?: readonly string[];
  readonly previousSkill?: string;
}

// ─── Skill Loader (behavior, separate from data) ────────────

/** Lazy-loads skill prompts — keeps Skill as pure data */
export interface SkillLoader {
  loadPrompt(skillName: string): Promise<string>;
}

// ─── Skill Registry Interface ────────────────────────────────

export interface SkillRegistry {
  register(skill: Skill): void;
  get(name: string): Skill | undefined;
  getAll(): readonly Skill[];

  /** Lightweight summaries for prompt injection (progressive disclosure) */
  getDescriptions(): readonly SkillDescription[];
}

export interface SkillDescription {
  readonly name: string;
  readonly description: string;
  readonly triggers: readonly string[];
}
