import { describe, it, expect } from "vitest";
import { StreamingCompactor } from "../../src/context/streaming-compactor.js";
import { MockLLMAdapter } from "../../src/llm/mock-adapter.js";
import { userMsg, assistantMsg } from "../helpers/factories.js";
import type { Message } from "../../src/llm/types.js";

function makeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) =>
    i % 2 === 0 ? userMsg(`user-${i}`) : assistantMsg(`assistant-${i}`)
  );
}

// ─── Tests ───────────────────────────────────────────────────

describe("StreamingCompactor", () => {
  it("returns messages as-is when count <= preserveLastN", async () => {
    const llm = new MockLLMAdapter();
    const compactor = new StreamingCompactor(llm, { preserveLastN: 6 });

    const messages = makeMessages(4);
    const result = await compactor.compact(messages);

    expect(result).toHaveLength(4);
  });

  it("no-op when new messages below threshold", async () => {
    const llm = new MockLLMAdapter();
    const compactor = new StreamingCompactor(llm, {
      preserveLastN: 4,
      compactThreshold: 20, // High threshold — won't trigger
    });

    const messages = makeMessages(10);
    const result = await compactor.compact(messages);

    // Should return original messages (no compaction)
    expect(result).toHaveLength(10);
    expect(llm.requests).toHaveLength(0); // No LLM call
  });

  it("compacts when new messages exceed threshold", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "Summary of conversation." });

    const compactor = new StreamingCompactor(llm, {
      preserveLastN: 4,
      compactThreshold: 3,
    });

    const messages = makeMessages(12);
    const result = await compactor.compact(messages);

    // summary system message + 4 preserved = 5
    expect(result).toHaveLength(5);
    expect(result[0].role).toBe("system");
    expect((result[0] as { content: string }).content).toContain("Summary of conversation.");
    expect(llm.requests).toHaveLength(1);
  });

  it("performs incremental compaction on second call", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "First summary." });
    llm.addResponse({ text: "Updated summary." });

    const compactor = new StreamingCompactor(llm, {
      preserveLastN: 2,
      compactThreshold: 3,
    });

    // First compaction
    const messages1 = makeMessages(8);
    await compactor.compact(messages1);

    // Add more messages and compact again
    const messages2 = [...messages1, ...makeMessages(6)];
    const result = await compactor.compact(messages2);

    expect(llm.requests).toHaveLength(2);
    // Second LLM request should include existing summary
    const secondRequest = llm.requests[1];
    expect(secondRequest.messages[0].content).toContain("Existing summary:");
    expect(secondRequest.messages[0].content).toContain("First summary.");

    // Result: summary + preserved
    expect(result[0].role).toBe("system");
    expect((result[0] as { content: string }).content).toContain("Updated summary.");
  });

  it("reset clears internal state", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "Summary 1" });
    llm.addResponse({ text: "Summary 2" });

    const compactor = new StreamingCompactor(llm, {
      preserveLastN: 2,
      compactThreshold: 3,
    });

    await compactor.compact(makeMessages(8));
    compactor.reset();

    // After reset, should behave as fresh — no "Existing summary" in prompt
    const messages2 = makeMessages(8);
    await compactor.compact(messages2);

    const secondRequest = llm.requests[1];
    expect(secondRequest.messages[0].content).not.toContain("Existing summary:");
  });

  it("passes focusHint to LLM prompt", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "Focused summary." });

    const compactor = new StreamingCompactor(llm, {
      preserveLastN: 2,
      compactThreshold: 2,
    });

    await compactor.compact(makeMessages(8), "Revit wall placement");

    const request = llm.requests[0];
    expect(request.messages[0].content).toContain("Focus especially on: Revit wall placement");
  });

  it("returns existing summary for messages below threshold", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "Existing summary here." });

    const compactor = new StreamingCompactor(llm, {
      preserveLastN: 4,
      compactThreshold: 3,
    });

    // First: compact with enough messages
    const messages1 = makeMessages(10);
    await compactor.compact(messages1);

    // Second: add only 1 new message (below threshold)
    const messages2 = [...messages1, userMsg("one more")];
    const result = await compactor.compact(messages2);

    // Should use existing summary without new LLM call
    expect(llm.requests).toHaveLength(1); // Only first call
    expect(result[0].role).toBe("system");
    expect((result[0] as { content: string }).content).toContain("Existing summary here.");
  });
});
