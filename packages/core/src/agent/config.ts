// agent/config.ts
// AgentConfig builder — single responsibility: build + validate

import type { AgentConfig, PermissionRule } from "./types.js";

// ─── Builder ─────────────────────────────────────────────────

const DEFAULTS = {
  temperature: 0.7,
  maxIterations: 50,
} as const;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export class AgentConfigBuilder {
  private partial: Partial<Mutable<AgentConfig>> = {};

  id(id: string): this {
    this.partial.id = id;
    return this;
  }

  name(name: string): this {
    this.partial.name = name;
    return this;
  }

  prompt(prompt: string): this {
    this.partial.prompt = prompt;
    return this;
  }

  model(model: string): this {
    this.partial.model = model;
    return this;
  }

  temperature(temp: number): this {
    this.partial.temperature = temp;
    return this;
  }

  maxIterations(max: number): this {
    this.partial.maxIterations = max;
    return this;
  }

  maxSteps(max: number): this {
    this.partial.maxSteps = max;
    return this;
  }

  tools(tools: readonly string[]): this {
    this.partial.tools = tools;
    return this;
  }

  skills(skills: readonly string[]): this {
    this.partial.skills = skills;
    return this;
  }

  permissions(rules: readonly PermissionRule[]): this {
    this.partial.permissions = rules;
    return this;
  }

  build(): AgentConfig {
    if (!this.partial.id) throw new Error("AgentConfig requires id");
    if (!this.partial.name) throw new Error("AgentConfig requires name");
    if (!this.partial.prompt) throw new Error("AgentConfig requires prompt");

    return {
      id: this.partial.id,
      name: this.partial.name,
      prompt: this.partial.prompt,
      model: this.partial.model,
      temperature: this.partial.temperature ?? DEFAULTS.temperature,
      maxIterations: this.partial.maxIterations ?? DEFAULTS.maxIterations,
      maxSteps: this.partial.maxSteps,
      tools: this.partial.tools,
      skills: this.partial.skills,
      permissions: this.partial.permissions,
    };
  }
}

