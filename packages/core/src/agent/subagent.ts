// agent/subagent.ts
// Default SubagentRunner — spawns isolated AgenticLoop instances

import type { SubagentConfig, SubagentResult, SubagentRunner } from "./types.js";
import type { LoopResult, RunnableLoop } from "../loop/types.js";

/** Factory that creates a RunnableLoop from a SubagentConfig */
export type LoopFactory = (config: SubagentConfig) => RunnableLoop;

export class DefaultSubagentRunner implements SubagentRunner {
  constructor(private readonly createLoop: LoopFactory) {}

  async spawn(config: SubagentConfig): Promise<SubagentResult> {
    const controller = new AbortController();

    // Link parent abort signal
    if (config.abort) {
      if (config.abort.aborted) {
        controller.abort();
      } else {
        config.abort.addEventListener(
          "abort",
          () => controller.abort(),
          { once: true }
        );
      }
    }

    // Timeout
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (config.timeout) {
      timeoutId = setTimeout(() => controller.abort(), config.timeout);
    }

    try {
      const loop = this.createLoop(config);
      const sessionId = `sub:${config.parentSessionId}:${Date.now().toString(36)}`;
      const result = await loop.run(config.task, sessionId, { abort: controller.signal });
      return this.toSubagentResult(result);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  async spawnParallel(
    configs: readonly SubagentConfig[]
  ): Promise<SubagentResult[]> {
    return Promise.all(configs.map((c) => this.spawn(c)));
  }

  private toSubagentResult(result: LoopResult): SubagentResult {
    return {
      success: result.success,
      output: result.output,
      tokenUsage: result.totalTokens,
      iterations: result.iterations,
    };
  }
}
