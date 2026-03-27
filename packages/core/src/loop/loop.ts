// loop/loop.ts
// Pure orchestrator — coordinates phases, delegates to extracted phase handlers
//
//   Gather → [ Think → Execute → Verify ] → Done
//                 ↑                  │
//                 └── loop back ─────┘

import type { Message, ContentPart, Usage, UserContent } from "../llm/types.js";
import { HookEvent } from "../hook/types.js";
import { MCPToolBridge } from "../mcp/bridge.js";
import { createMemoryTools } from "../storage/memory-tool.js";
import { LoopPhase } from "./types.js";
import type {
  LoopConfig,
  LoopEvent,
  LoopResult,
  LoopState,
  RunOptions,
  RunnableLoop,
  ToolCallLog,
} from "./types.js";
import { createInitialState, transition } from "./state.js";
import { gatherPhase } from "./gather.js";
import { thinkPhase } from "./think.js";
import { executePhase } from "./execute.js";
import { verifyPhase } from "./verify.js";

// ─── Constants ───────────────────────────────────────────────

const DEFAULT_MAX_ITERATIONS = 50;
const DEFAULT_MAX_CONTEXT_TOKENS = 128_000;
const PLAN_MODE_INSTRUCTION =
  "Create a step-by-step plan for the following task. Do not execute anything yet. " +
  "List the steps you will take, the tools you will use, and any assumptions.";

// ─── Pure Helpers ────────────────────────────────────────────

function mapUsage(usage: Usage): Readonly<{ input: number; output: number }> {
  return { input: usage.inputTokens, output: usage.outputTokens };
}

function determineFinishReason(
  state: LoopState
): LoopResult["finishReason"] {
  if (state.error === "cancelled") return "cancelled";
  if (state.phase === LoopPhase.Error) return "error";
  if (state.blocked) return "blocked";
  if (state.iteration >= state.maxIterations) return "max_iterations";
  return "complete";
}

function buildLoopResult(
  state: LoopState,
  messages: readonly Message[],
  toolCallLogs: readonly ToolCallLog[]
): LoopResult {
  const lastAssistant = [...messages]
    .reverse()
    .find(
      (m): m is Extract<Message, { role: "assistant" }> =>
        m.role === "assistant"
    );

  const output = lastAssistant
    ? lastAssistant.content
        .filter(
          (p): p is Extract<ContentPart, { type: "text" }> =>
            p.type === "text"
        )
        .map((p) => p.text)
        .join("")
    : "";

  const finishReason = determineFinishReason(state);

  return {
    success: finishReason === "complete",
    output,
    iterations: state.iteration,
    totalTokens: state.tokenUsage,
    toolCalls: toolCallLogs,
    finishReason,
  };
}

// ─── Orchestrator ────────────────────────────────────────────

export class AgenticLoop implements RunnableLoop {
  private readonly config: LoopConfig;
  private initialized = false;

  constructor(config: LoopConfig) {
    this.config = config;
  }

  async run(
    input: UserContent,
    sessionId: string,
    options?: RunOptions
  ): Promise<LoopResult> {
    const { agent, hooks } = this.config;
    const abort = options?.abort;
    const maxIterations = agent.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    let state = createInitialState(maxIterations);
    // Messages are intentionally mutable. The state machine (LoopState) is
    // immutable, but messages use in-place mutation to avoid copying the full
    // array on every iteration — a deliberate performance trade-off for long
    // conversations with large tool results.
    const messages: Message[] = [];
    const toolCallLogs: ToolCallLog[] = [];
    const emit = (e: LoopEvent): void => this.emit(e);

    try {
      await this.initialize();

      // ── Gather ────────────────────────────────────
      state = this.phaseTransition(state, LoopPhase.Gathering);
      const systemPrompt = await gatherPhase(this.config, input);
      if (options?.history) {
        messages.push(...options.history);
      }
      messages.push({ role: "user", content: input });
      await hooks.dispatch(
        HookEvent.SessionStart,
        { agentId: agent.id },
        sessionId
      );

      // ── Plan Mode ──────────────────────────────────
      if (this.config.planMode && !this.config.approvedPlan) {
        const planResult = await this.runPlanMode(
          state, messages, emit, systemPrompt, sessionId
        );
        this.emit({ type: "done", result: planResult });
        return planResult;
      }

      // ── Main Loop ─────────────────────────────────
      state = await this.runIterations(
        state, messages, toolCallLogs, emit, systemPrompt, sessionId, abort
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      state = transition(state, { type: "set_error", error: msg });
      this.emit({ type: "error", error: msg });
      await hooks.dispatch(HookEvent.Error, { error: msg }, sessionId);
    }

    return this.finalize(state, messages, toolCallLogs, sessionId);
  }

  // ─── Lifecycle ─────────────────────────────────────────────

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    if (this.config.storage) {
      for (const tool of createMemoryTools(this.config.storage)) {
        this.config.tools.register(tool);
      }
    }

    if (this.config.mcpClients?.length) {
      await MCPToolBridge.registerFromClients(
        this.config.mcpClients,
        this.config.tools
      );
    }
  }

  private async finalize(
    state: LoopState,
    messages: readonly Message[],
    toolCallLogs: readonly ToolCallLog[],
    sessionId: string
  ): Promise<LoopResult> {
    const result = buildLoopResult(state, messages, toolCallLogs);
    this.emit({ type: "done", result });
    await this.config.hooks.dispatch(
      HookEvent.SessionEnd,
      { reason: result.finishReason },
      sessionId
    );
    return result;
  }

  // ─── Plan Mode ─────────────────────────────────────────────

  private async runPlanMode(
    state: LoopState,
    messages: readonly Message[],
    emit: (e: LoopEvent) => void,
    systemPrompt: string,
    sessionId: string
  ): Promise<LoopResult> {
    state = this.phaseTransition(state, LoopPhase.Planning);
    const planResult = await thinkPhase(
      this.config,
      emit,
      systemPrompt + "\n\n" + PLAN_MODE_INSTRUCTION,
      messages,
      state,
      sessionId,
      true // forceNoTools
    );
    const tokens = mapUsage(planResult.usage);
    state = transition(state, { type: "add_tokens", usage: tokens });
    this.emit({ type: "plan:ready", plan: planResult.text });

    return {
      success: true,
      output: planResult.text,
      iterations: 0,
      totalTokens: state.tokenUsage,
      toolCalls: [],
      finishReason: "plan_pending",
    };
  }

  // ─── Main Iteration Loop ──────────────────────────────────
  // Note: This method is intentionally kept as a single while loop rather than
  // splitting into per-iteration methods. Each phase call is already delegated
  // to its own module (think.ts, execute.ts, verify.ts). Further decomposition
  // would scatter the loop flow across files without reducing complexity.

  private async runIterations(
    state: LoopState,
    messages: Message[],
    toolCallLogs: ToolCallLog[],
    emit: (e: LoopEvent) => void,
    systemPrompt: string,
    sessionId: string,
    abort?: AbortSignal
  ): Promise<LoopState> {
    while (state.iteration < state.maxIterations && !state.blocked) {
      if (abort?.aborted) {
        return transition(state, { type: "set_error", error: "cancelled" });
      }

      state = transition(state, { type: "increment_iteration" });
      await this.compactAndPruneIfNeeded(messages);

      // Think
      state = this.phaseTransition(state, LoopPhase.Thinking);
      const thought = await thinkPhase(
        this.config, emit, systemPrompt, messages, state, sessionId
      );
      const tokens = mapUsage(thought.usage);
      state = transition(state, { type: "add_tokens", usage: tokens });
      this.config.tokenEstimator?.calibrate?.(
        thought.usage.inputTokens, messages
      );
      this.emit({
        type: "iteration:end",
        iteration: state.iteration,
        usage: tokens,
      });

      // Execute (if LLM requested tool calls)
      if (thought.toolCalls.length > 0 && thought.finishReason === "tool_calls") {
        state = this.phaseTransition(state, LoopPhase.Executing);
        const execResult = await executePhase(
          this.config, emit, thought.text, thought.toolCalls,
          messages, toolCallLogs, sessionId, abort
        );
        state = transition(state, {
          type: "add_tool_calls",
          count: thought.toolCalls.length,
        });

        if (execResult.blocked) {
          return transition(state, {
            type: "set_blocked",
            reason: "Tool execution blocked",
          });
        }

        state = this.phaseTransition(state, LoopPhase.Verifying);
        continue;
      }

      // No tool calls → check if done
      state = this.phaseTransition(state, LoopPhase.Verifying);
      if (thought.text) {
        messages.push({
          role: "assistant",
          content: [{ type: "text", text: thought.text }],
        });
      }

      const shouldContinue = await verifyPhase(
        this.config, thought.text, thought.finishReason, sessionId
      );
      if (!shouldContinue) {
        return this.phaseTransition(state, LoopPhase.Done);
      }
    }

    return state;
  }

  // ─── Orchestrator Helpers ──────────────────────────────────

  private phaseTransition(state: LoopState, phase: LoopPhase): LoopState {
    const from = state.phase;
    const next = transition(state, { type: "next_phase", phase });
    this.emit({ type: "phase:change", from, to: phase });
    return next;
  }

  private emit(event: LoopEvent): void {
    this.config.onEvent?.(event);
  }

  private async compactAndPruneIfNeeded(messages: Message[]): Promise<void> {
    const { pruner, compactor } = this.config;
    if (!pruner) return;

    const maxTokens = this.config.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS;
    if (!pruner.shouldPrune(messages, maxTokens)) return;

    if (compactor) {
      const compacted = await compactor.compact(messages);
      messages.length = 0;
      messages.push(...compacted);
    }

    if (pruner.shouldPrune(messages, maxTokens)) {
      const pruned = pruner.prune(messages, {
        maxTokens,
        preserveSystemPrompt: true,
        preserveLastN: this.config.prunePreserveLastN,
      });
      messages.length = 0;
      messages.push(...pruned);
    }
  }
}
