import { describe, it, expect } from "vitest";
import {
  DefaultSkillDetector,
  DEFAULT_KEYWORD_EXACT_SCORE,
  DEFAULT_KEYWORD_PARTIAL_SCORE,
  DEFAULT_PATTERN_SCORE,
} from "../../src/skill/detector.js";
import type { Skill } from "../../src/skill/types.js";

function makeSkill(
  name: string,
  triggers: Skill["triggers"],
  children?: Skill[]
): Skill {
  return {
    name,
    description: `Skill ${name}`,
    triggers,
    children,
  };
}

describe("DefaultSkillDetector", () => {
  const detector = new DefaultSkillDetector();

  it("returns null when no skills match", async () => {
    const skills = [
      makeSkill("revit", [{ type: "keyword", keyword: "wall" }]),
    ];
    const result = await detector.detect("hello world", skills);
    expect(result).toBeNull();
  });

  it("matches keyword trigger (exact word)", async () => {
    const skills = [
      makeSkill("revit", [{ type: "keyword", keyword: "wall" }]),
    ];
    const result = await detector.detect("create a wall", skills);

    expect(result).not.toBeNull();
    expect(result!.skill.name).toBe("revit");
    expect(result!.confidence).toBe(DEFAULT_KEYWORD_EXACT_SCORE);
    expect(result!.method).toBe("keyword");
  });

  it("matches keyword trigger (substring — lower score)", async () => {
    const skills = [
      makeSkill("revit", [{ type: "keyword", keyword: "wall" }]),
    ];
    const result = await detector.detect("drywall installation", skills);

    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(DEFAULT_KEYWORD_PARTIAL_SCORE);
  });

  it("keyword matching is case-insensitive", async () => {
    const skills = [
      makeSkill("revit", [{ type: "keyword", keyword: "Wall" }]),
    ];
    const result = await detector.detect("create a WALL", skills);
    expect(result).not.toBeNull();
  });

  it("matches pattern trigger", async () => {
    const skills = [
      makeSkill("sheets", [
        { type: "pattern", pattern: "create\\s+sheet" },
      ]),
    ];
    const result = await detector.detect("please create sheet A101", skills);

    expect(result).not.toBeNull();
    expect(result!.skill.name).toBe("sheets");
    expect(result!.confidence).toBe(DEFAULT_PATTERN_SCORE);
    expect(result!.method).toBe("pattern");
  });

  it("pattern trigger uses custom flags", async () => {
    const skills = [
      makeSkill("test", [
        { type: "pattern", pattern: "^EXACT$", flags: "" }, // no 'i' flag
      ]),
    ];

    expect(await detector.detect("EXACT", skills)).not.toBeNull();
    expect(await detector.detect("exact", skills)).toBeNull();
  });

  it("selects highest scoring skill", async () => {
    const skills = [
      makeSkill("low", [{ type: "keyword", keyword: "create" }]),
      makeSkill("high", [{ type: "pattern", pattern: "create\\s+wall" }]),
    ];
    const result = await detector.detect("create wall", skills);

    expect(result!.skill.name).toBe("high"); // pattern > keyword
  });

  it("respects trigger weight", async () => {
    const skills = [
      makeSkill("weighted", [
        { type: "keyword", keyword: "wall", weight: 0.5 },
      ]),
      makeSkill("normal", [{ type: "keyword", keyword: "wall" }]),
    ];
    const result = await detector.detect("build a wall", skills);

    expect(result!.skill.name).toBe("normal"); // KEYWORD_EXACT_SCORE*1 > KEYWORD_EXACT_SCORE*0.5
  });

  it("detects child skills", async () => {
    const child = makeSkill("revit-sheets", [
      { type: "keyword", keyword: "sheet" },
    ]);
    const parent = makeSkill(
      "revit",
      [{ type: "keyword", keyword: "revit" }],
      [child]
    );

    const result = await detector.detect("revit create sheet", [parent]);

    expect(result).not.toBeNull();
    expect(result!.skill.name).toBe("revit");
    expect(result!.childSkill?.name).toBe("revit-sheets");
    expect(result!.confidence).toBeGreaterThan(DEFAULT_KEYWORD_EXACT_SCORE); // parent + child weight
  });

  it("child confidence capped at 1", async () => {
    const child = makeSkill("child", [
      { type: "pattern", pattern: "exact match" },
    ]);
    const parent = makeSkill(
      "parent",
      [{ type: "pattern", pattern: "exact match" }],
      [child]
    );

    const result = await detector.detect("exact match", [parent]);
    expect(result!.confidence).toBeLessThanOrEqual(1);
  });

  it("semantic triggers return 0 (not supported in default detector)", async () => {
    const skills = [
      makeSkill("semantic", [
        { type: "semantic", description: "anything about walls" },
      ]),
    ];
    const result = await detector.detect("wall", skills);
    expect(result).toBeNull();
  });

  it("method reflects primary trigger type", async () => {
    const patternSkill = makeSkill("p", [
      { type: "keyword", keyword: "test" },
      { type: "pattern", pattern: "test" },
    ]);
    const result = await detector.detect("test", [patternSkill]);
    expect(result!.method).toBe("pattern"); // pattern takes precedence
  });
});
