import { describe, it, expect } from "vitest";
import { DefaultPruner } from "../../src/context/pruner.js";
import { userMsg, assistantMsg, systemMsg } from "../helpers/factories.js";
import type { Message } from "../../src/llm/types.js";

describe("DefaultPruner", () => {
  const pruner = new DefaultPruner();

  describe("shouldPrune", () => {
    it("returns false when under token limit", () => {
      const messages: Message[] = [userMsg("hi")];
      expect(pruner.shouldPrune(messages, 100_000)).toBe(false);
    });

    it("returns true when over token limit", () => {
      // 4 chars per token → 100 chars ≈ 25 tokens
      const longMsg = "x".repeat(400); // ~100 tokens
      const messages: Message[] = [userMsg(longMsg)];
      expect(pruner.shouldPrune(messages, 50)).toBe(true);
    });
  });

  describe("prune", () => {
    it("preserves last N messages", () => {
      // Each message ~50 tokens (200 chars / 4)
      const pad = "x".repeat(200);
      const messages: Message[] = [
        userMsg("old1" + pad),
        assistantMsg("old2" + pad),
        userMsg("old3" + pad),
        assistantMsg("old4" + pad),
        userMsg("recent1" + pad),
        assistantMsg("recent2" + pad),
      ];

      const result = pruner.prune(messages, {
        maxTokens: 110, // fits ~2 messages
        preserveSystemPrompt: false,
        preserveLastN: 2,
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(messages[4]);
      expect(result[1]).toBe(messages[5]);
    });

    it("preserves system messages when configured", () => {
      const messages: Message[] = [
        systemMsg("system prompt"),
        userMsg("old message with lots of content ".repeat(50)),
        userMsg("recent"),
      ];

      const result = pruner.prune(messages, {
        maxTokens: 30,
        preserveSystemPrompt: true,
        preserveLastN: 1,
      });

      expect(result.some((m) => m.role === "system")).toBe(true);
      expect(result[result.length - 1]).toBe(messages[2]);
    });

    it("drops oldest droppable messages first", () => {
      const pad = "x".repeat(200); // ~50 tokens each
      const messages: Message[] = [
        userMsg("oldest" + pad),
        userMsg("middle" + pad),
        userMsg("newest" + pad),
      ];

      const result = pruner.prune(messages, {
        maxTokens: 55, // fits ~1 message
        preserveSystemPrompt: false,
        preserveLastN: 1,
      });

      // Should only have newest
      expect(result).toHaveLength(1);
      expect((result[0] as { content: string }).content).toBe("newest" + pad);
    });

    it("returns all if already under limit", () => {
      const messages: Message[] = [userMsg("short"), assistantMsg("msg")];

      const result = pruner.prune(messages, {
        maxTokens: 100_000,
        preserveSystemPrompt: false,
        preserveLastN: 4,
      });

      expect(result).toHaveLength(2);
    });

    it("defaults preserveLastN to 4", () => {
      const messages: Message[] = Array.from({ length: 8 }, (_, i) =>
        userMsg("x".repeat(200))
      );

      const result = pruner.prune(messages, {
        maxTokens: 300,
        preserveSystemPrompt: false,
        // no preserveLastN → defaults to 4
      });

      // Last 4 should always be present
      expect(result.slice(-4)).toEqual(messages.slice(-4));
    });
  });
});
