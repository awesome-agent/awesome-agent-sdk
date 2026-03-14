import { describe, it, expect } from "vitest";
import { CharBasedEstimator, AdaptiveEstimator, DEFAULT_CHARS_PER_TOKEN } from "../../src/context/estimator.js";
import { userMsg, assistantMsg } from "../helpers/factories.js";
import type { Message } from "../../src/llm/types.js";

// ─── CharBasedEstimator ──────────────────────────────────────

describe("CharBasedEstimator", () => {
  it("estimates tokens as chars / 4 by default", () => {
    const estimator = new CharBasedEstimator();
    const messages = [userMsg("x".repeat(100))]; // 100 chars → 100/DEFAULT_CHARS_PER_TOKEN tokens

    expect(estimator.estimate(messages)).toBe(100 / DEFAULT_CHARS_PER_TOKEN);
  });

  it("accepts custom charsPerToken", () => {
    const estimator = new CharBasedEstimator(2);
    const messages = [userMsg("x".repeat(100))]; // 100 chars / 2 → 50 tokens

    expect(estimator.estimate(messages)).toBe(50);
  });

  it("counts assistant text and tool_call args", () => {
    const estimator = new CharBasedEstimator(4);
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "hello" }, // 5 chars
          { type: "tool_call", id: "tc1", name: "read", args: { p: 1 } }, // {"p":1} = 5 chars
        ],
      },
    ];

    // 10 chars / 4 = 2.5 → ceil = 3
    expect(estimator.estimate(messages)).toBe(3);
  });

  it("handles empty messages", () => {
    const estimator = new CharBasedEstimator();
    expect(estimator.estimate([])).toBe(0);
  });
});

// ─── AdaptiveEstimator ───────────────────────────────────────

describe("AdaptiveEstimator", () => {
  it("starts with default ratio (same as CharBased)", () => {
    const adaptive = new AdaptiveEstimator();
    const charBased = new CharBasedEstimator();
    const messages = [userMsg("x".repeat(200))];

    expect(adaptive.estimate(messages)).toBe(charBased.estimate(messages));
  });

  it("adjusts ratio after calibration", () => {
    const estimator = new AdaptiveEstimator({ alpha: 0.5 });
    const messages = [userMsg("x".repeat(400))]; // 400 chars

    const beforeEstimate = estimator.estimate(messages);

    // Real LLM returned 200 input tokens for these messages
    // Observed ratio = 400/200 = 2.0
    // New ratio = 0.5 * 2.0 + 0.5 * 4.0 = 3.0
    estimator.calibrate(200, messages);

    const afterEstimate = estimator.estimate(messages);
    expect(afterEstimate).toBeGreaterThan(beforeEstimate);
    expect(estimator.currentRatio).toBeCloseTo(3.0, 1);
  });

  it("converges toward real ratio over multiple calibrations", () => {
    const estimator = new AdaptiveEstimator({ alpha: 0.3 });
    const messages = [userMsg("x".repeat(300))]; // 300 chars

    // Real ratio is 3.0 (300 chars / 100 tokens)
    for (let i = 0; i < 20; i++) {
      estimator.calibrate(100, messages);
    }

    // After many calibrations, should converge near 3.0
    expect(estimator.currentRatio).toBeCloseTo(3.0, 0);
  });

  it("skips calibration when actual tokens is zero", () => {
    const estimator = new AdaptiveEstimator();
    const ratioBefore = estimator.currentRatio;

    estimator.calibrate(0, [userMsg("hello")]);

    expect(estimator.currentRatio).toBe(ratioBefore);
  });

  it("skips calibration when messages are empty", () => {
    const estimator = new AdaptiveEstimator();
    const ratioBefore = estimator.currentRatio;

    estimator.calibrate(100, []);

    expect(estimator.currentRatio).toBe(ratioBefore);
  });

  it("accepts custom initial ratio and alpha", () => {
    const estimator = new AdaptiveEstimator({
      initialCharsPerToken: 3,
      alpha: 0.1,
    });

    expect(estimator.currentRatio).toBe(3);

    const messages = [userMsg("x".repeat(300))]; // 300 chars
    // Real: 100 tokens → observed ratio 3.0
    // New: 0.1 * 3.0 + 0.9 * 3.0 = 3.0 (already at 3)
    estimator.calibrate(100, messages);
    expect(estimator.currentRatio).toBeCloseTo(3.0, 1);
  });
});
