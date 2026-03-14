// tool/registry.ts
// Default ToolRegistry — name-uniqueness enforced, Map-based storage

import type { Tool } from "./types.js";
import type { ToolRegistry } from "./executor-types.js";
import { DuplicateRegistrationError } from "../errors.js";

export class DefaultToolRegistry implements ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new DuplicateRegistrationError("Tool", tool.name);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): readonly Tool[] {
    return [...this.tools.values()];
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}
