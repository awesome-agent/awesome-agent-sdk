// agent/types.ts

// ─── Agent Definition (pure data — no I prefix) ─────────────

export interface AgentConfig {
  readonly id: string;
  readonly name: string;
  readonly prompt: string; // System prompt for this agent
  readonly model?: string; // Override model
  readonly temperature?: number; // Default: 0.7
  readonly maxIterations?: number; // Loop limit (default: 50)
  readonly maxSteps?: number; // After this, tools disabled
  readonly tools?: readonly string[]; // Tool whitelist (undefined = all)
  readonly skills?: readonly string[]; // Preloaded skills
  readonly permissions?: readonly PermissionRule[];
}

export interface PermissionRule {
  readonly tool: string; // Glob pattern: "*", "execute_*"
  readonly action: string; // Glob pattern: "*", "delete"
  readonly decision: "allow" | "deny" | "ask";
}

// ─── Subagent ────────────────────────────────────────────────

export interface SubagentConfig {
  readonly agent: AgentConfig;
  readonly task: string; // The prompt for the subagent
  readonly parentSessionId: string;
  readonly inheritTools?: boolean; // Inherit parent's tools (default: false)
  readonly inheritSkills?: readonly string[]; // Specific skills to pass down
  readonly timeout?: number; // ms
  readonly abort?: AbortSignal;
}

export interface SubagentResult {
  readonly success: boolean;
  readonly output: string; // Summary returned to parent
  readonly tokenUsage: Readonly<{ input: number; output: number }>;
  readonly iterations: number;
}

/** Spawns isolated subagent loops — own context, parallel capable */
export interface SubagentRunner {
  spawn(config: SubagentConfig): Promise<SubagentResult>;
  spawnParallel(configs: readonly SubagentConfig[]): Promise<SubagentResult[]>;
}
