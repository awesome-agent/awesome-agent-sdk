// context/pruner.ts
// Default Pruner — delegates token estimation to TokenEstimator strategy

import type { Message } from "../llm/types.js";
import type { Pruner, PruneConfig, TokenEstimator } from "./types.js";
import { CharBasedEstimator } from "./estimator.js";

const DEFAULT_PRUNE_PRESERVE_LAST_N = 4;

export class DefaultPruner implements Pruner {
  private readonly estimator: TokenEstimator;

  constructor(estimator?: TokenEstimator) {
    this.estimator = estimator ?? new CharBasedEstimator();
  }

  /** Expose the estimator so the loop can call calibrate() */
  get tokenEstimator(): TokenEstimator {
    return this.estimator;
  }

  shouldPrune(messages: readonly Message[], maxTokens: number): boolean {
    return this.estimator.estimate(messages) > maxTokens;
  }

  prune(messages: readonly Message[], config: PruneConfig): Message[] {
    const preserveN = config.preserveLastN ?? DEFAULT_PRUNE_PRESERVE_LAST_N;
    const splitAt = Math.max(0, messages.length - preserveN);
    const tail = messages.slice(splitAt);
    const head = messages.slice(0, splitAt);

    // Separate system messages (always kept) from droppable messages
    const system: Message[] = [];
    const droppable: Message[] = [];

    for (const msg of head) {
      if (config.preserveSystemPrompt && msg.role === "system") {
        system.push(msg);
      } else {
        droppable.push(msg);
      }
    }

    // Drop oldest messages first until under token limit
    let dropCount = 0;
    while (dropCount < droppable.length) {
      const kept = [...system, ...droppable.slice(dropCount), ...tail];
      if (this.estimator.estimate(kept) <= config.maxTokens) break;
      dropCount++;
    }

    return [...system, ...droppable.slice(dropCount), ...tail];
  }
}
