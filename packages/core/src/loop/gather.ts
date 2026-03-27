// loop/gather.ts
// Phase: Gather — builds system prompt from context, skills, memory, and plan

import type { UserContent } from "../llm/types.js";
import type { MemorySection } from "../context/types.js";
import { MEMORY_SYSTEM_PROMPT } from "../storage/memory-tool.js";
import type { LoopConfig } from "./types.js";

const DEFAULT_MEMORY_MAX_RESULTS = 10;

const APPROVED_PLAN_INSTRUCTION =
  "Follow the approved plan above. Execute each step using available tools. Do not restate or summarize the plan — go directly to execution.";

function extractText(input: UserContent): string {
  if (typeof input === "string") return input;
  return input
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export async function gatherPhase(
  config: LoopConfig,
  input: UserContent
): Promise<string> {
  const {
    agent, context, skills, skillDetector, skillLoader, memory, approvedPlan,
  } = config;

  const inputText = extractText(input);

  const skillPrompts: Array<{ skillName: string; content: string }> = [];

  if (skills && skillDetector && skillLoader) {
    const match = await skillDetector.detect(inputText, skills.getAll());
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
    const results = await memory.search(inputText, {
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

  // Storage tool prompts
  let agentPrompt = agent.prompt;
  if (config.storage) {
    agentPrompt += "\n\n" + MEMORY_SYSTEM_PROMPT;
  }

  // Approved plan injection
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
