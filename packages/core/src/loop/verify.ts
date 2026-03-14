// loop/verify.ts
// Phase: Verify — checks if loop should continue or stop

import type { FinishReason } from "../llm/types.js";
import { HookEvent } from "../hook/types.js";
import type { LoopConfig } from "./types.js";

export async function verifyPhase(
  config: LoopConfig,
  output: string,
  finishReason: FinishReason,
  sessionId: string
): Promise<boolean> {
  const hookResult = await config.hooks.dispatch(
    HookEvent.Stop,
    { output, finishReason },
    sessionId
  );

  // Stop hook "block" = prevent exit → continue looping
  return hookResult.action === "block";
}
