// loop/gather.ts
// Phase: Gather — builds system prompt from context, skills, memory, and plan

import type { MemorySection } from "../context/types.js";
import { DEFAULT_MEMORY_MAX_RESULTS } from "../memory/utils.js";
import type { LoopConfig } from "./types.js";

const APPROVED_PLAN_INSTRUCTION =
  "Follow the approved plan above. Execute each step using tools.";

export async function gatherPhase(
  config: LoopConfig,
  input: string
): Promise<string> {
  const {
    agent, context, skills, skillDetector, skillLoader, memory, approvedPlan,
  } = config;

  const skillPrompts: Array<{ skillName: string; content: string }> = [];

  if (skills && skillDetector && skillLoader) {
    const match = await skillDetector.detect(input, skills.getAll());
    if (match) {
      const prompt = await skillLoader.loadPrompt(match.skill.name);
      skillPrompts.push({ skillName: match.skill.name, content: prompt });

      if (match.childSkill) {
        const childPrompt = await skillLoader.loadPrompt(
          match.childSkill.name
        );
        skillPrompts.push({
          skillName: match.childSkill.name,
          content: childPrompt,
        });
      }
    }
  }

  // Memory retrieval
  let memorySections: MemorySection[] | undefined;
  if (memory) {
    const results = await memory.search(input, {
      maxResults: config.memoryMaxResults ?? DEFAULT_MEMORY_MAX_RESULTS,
    });
    if (results.length > 0) {
      memorySections = results.map((r) => ({
        key: r.entry.name,
        content: r.entry.content,
        relevance: r.relevance,
      }));
    }
  }

  // Approved plan injection
  let agentPrompt = agent.prompt;
  if (approvedPlan) {
    agentPrompt +=
      "\n\n<approved-plan>\n" +
      approvedPlan +
      "\n</approved-plan>\n\n" +
      APPROVED_PLAN_INSTRUCTION;
  }

  return context.build({
    basePrompt: "",
    agentPrompt,
    skillPrompts,
    memorySections,
  });
}
