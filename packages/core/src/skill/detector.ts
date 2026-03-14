// skill/detector.ts
// Default SkillDetector — keyword + pattern matching with confidence scoring

import type {
  Skill,
  SkillMatch,
  SkillDetector,
  SkillTrigger,
  DetectorContext,
} from "./types.js";

// ─── Configuration ───────────────────────────────────────────

export interface DetectorConfig {
  readonly keywordExactScore?: number; // Default: 0.8
  readonly keywordPartialScore?: number; // Default: 0.5
  readonly patternScore?: number; // Default: 0.9
  readonly childSkillWeight?: number; // Default: 0.5
}

export const DEFAULT_KEYWORD_EXACT_SCORE = 0.8;
export const DEFAULT_KEYWORD_PARTIAL_SCORE = 0.5;
export const DEFAULT_PATTERN_SCORE = 0.9;
export const DEFAULT_CHILD_SKILL_WEIGHT = 0.5;

// ─── Detector ────────────────────────────────────────────────

export class DefaultSkillDetector implements SkillDetector {
  private readonly keywordExactScore: number;
  private readonly keywordPartialScore: number;
  private readonly patternScore: number;
  private readonly childSkillWeight: number;

  constructor(config?: DetectorConfig) {
    this.keywordExactScore = config?.keywordExactScore ?? DEFAULT_KEYWORD_EXACT_SCORE;
    this.keywordPartialScore = config?.keywordPartialScore ?? DEFAULT_KEYWORD_PARTIAL_SCORE;
    this.patternScore = config?.patternScore ?? DEFAULT_PATTERN_SCORE;
    this.childSkillWeight = config?.childSkillWeight ?? DEFAULT_CHILD_SKILL_WEIGHT;
  }

  async detect(
    input: string,
    skills: readonly Skill[],
    _context?: DetectorContext
  ): Promise<SkillMatch | null> {
    const lowerInput = input.toLowerCase();
    let bestMatch: SkillMatch | null = null;

    for (const skill of skills) {
      const score = this.scoreSkill(skill, lowerInput, input);
      if (score <= 0) continue;
      if (bestMatch && score <= bestMatch.confidence) continue;

      const childMatch = skill.children?.length
        ? this.findBestChild(skill, lowerInput, input)
        : undefined;

      bestMatch = {
        skill,
        childSkill: childMatch?.skill,
        confidence: childMatch
          ? Math.min(1, score + childMatch.confidence * this.childSkillWeight)
          : score,
        method: this.getPrimaryMethod(skill.triggers),
      };
    }

    return bestMatch;
  }

  private scoreSkill(
    skill: Skill,
    lowerInput: string,
    rawInput: string
  ): number {
    let maxScore = 0;

    for (const trigger of skill.triggers) {
      const score = this.scoreTrigger(trigger, lowerInput, rawInput);
      if (score > maxScore) {
        maxScore = score;
      }
    }

    return maxScore;
  }

  private scoreTrigger(
    trigger: SkillTrigger,
    lowerInput: string,
    rawInput: string
  ): number {
    const weight = trigger.weight ?? 1;

    switch (trigger.type) {
      case "keyword": {
        const keyword = trigger.keyword.toLowerCase();
        if (!lowerInput.includes(keyword)) return 0;

        // Exact word match scores higher than substring match
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const wordBoundary = new RegExp(`\\b${escaped}\\b`, "i");
        const exactWord = wordBoundary.test(rawInput);
        return (exactWord ? this.keywordExactScore : this.keywordPartialScore) * weight;
      }

      case "pattern": {
        const regex = new RegExp(trigger.pattern, trigger.flags ?? "i");
        return regex.test(rawInput) ? this.patternScore * weight : 0;
      }

      case "semantic":
        // Semantic triggers require LLM — not supported in default detector
        return 0;
    }
  }

  private findBestChild(
    parent: Skill,
    lowerInput: string,
    rawInput: string
  ): { skill: Skill; confidence: number } | undefined {
    if (!parent.children?.length) return undefined;

    let best: { skill: Skill; confidence: number } | undefined;

    for (const child of parent.children) {
      const score = this.scoreSkill(child, lowerInput, rawInput);
      if (score > 0 && (!best || score > best.confidence)) {
        best = { skill: child, confidence: score };
      }
    }

    return best;
  }

  private getPrimaryMethod(
    triggers: readonly SkillTrigger[]
  ): SkillMatch["method"] {
    for (const t of triggers) {
      if (t.type === "pattern") return "pattern";
    }
    return "keyword";
  }
}
