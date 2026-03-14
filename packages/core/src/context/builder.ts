// context/builder.ts
// Default ContextBuilder — assembles system prompt from static + dynamic sections

import type { ContextBuilder, SystemPromptConfig } from "./types.js";

const DEFAULT_SKILL_PRIORITY = 100;

export class DefaultContextBuilder implements ContextBuilder {
  build(config: SystemPromptConfig): string {
    const sections: string[] = [];

    // Base prompt (static, KV-cacheable)
    if (config.basePrompt) {
      sections.push(config.basePrompt);
    }

    // Agent-specific prompt
    if (config.agentPrompt) {
      sections.push(config.agentPrompt);
    }

    // Skill prompts (sorted by priority — lower = earlier)
    if (config.skillPrompts?.length) {
      const sorted = [...config.skillPrompts].sort(
        (a, b) => (a.priority ?? DEFAULT_SKILL_PRIORITY) - (b.priority ?? DEFAULT_SKILL_PRIORITY)
      );

      for (const sp of sorted) {
        sections.push(
          `<skill name="${sp.skillName}">\n${sp.content}\n</skill>`
        );
      }
    }

    // Memory sections (sorted by relevance — highest first)
    if (config.memorySections?.length) {
      const sorted = [...config.memorySections].sort(
        (a, b) => b.relevance - a.relevance
      );

      for (const ms of sorted) {
        sections.push(
          `<memory key="${ms.key}">\n${ms.content}\n</memory>`
        );
      }
    }

    // Dynamic sections (per-message, not cacheable)
    if (config.dynamicSections?.length) {
      for (const ds of config.dynamicSections) {
        sections.push(`<${ds.label}>\n${ds.content}\n</${ds.label}>`);
      }
    }

    return sections.join("\n\n");
  }
}
