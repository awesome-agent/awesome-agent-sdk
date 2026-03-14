import { describe, it, expect } from "vitest";
import { LLMCompactor } from "../../src/context/compactor.js";
import { MockLLMAdapter } from "../../src/llm/mock-adapter.js";
import { userMsg, assistantMsg } from "../helpers/factories.js";
import type { Message } from "../../src/llm/types.js";

describe("LLMCompactor", () => {
  it("returns messages as-is when count <= preserveLastN", async () => {
    const llm = new MockLLMAdapter();
    const compactor = new LLMCompactor(llm, { preserveLastN: 4 });

    const messages: Message[] = [userMsg("a"), assistantMsg("b")];
    const result = await compactor.compact(messages);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(messages[0]);
    expect(llm.requests).toHaveLength(0); // no LLM call
  });

  it("compacts old messages into summary + keeps recent", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "Summary of old conversation." });

    const compactor = new LLMCompactor(llm, { preserveLastN: 2 });
    const messages: Message[] = [
      userMsg("old message 1"),
      assistantMsg("old reply 1"),
      userMsg("old message 2"),
      assistantMsg("old reply 2"),
      userMsg("recent question"),
      assistantMsg("recent answer"),
    ];

    const result = await compactor.compact(messages);

    // 1 summary system message + 2 preserved
    expect(result).toHaveLength(3);
    expect(result[0].role).toBe("system");
    expect((result[0] as { content: string }).content).toContain(
      "Summary of old conversation."
    );
    expect(result[1]).toEqual(messages[4]); // recent question
    expect(result[2]).toEqual(messages[5]); // recent answer
  });

  it("sends transcript to LLM for summarization", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "summary" });

    const compactor = new LLMCompactor(llm, { preserveLastN: 1 });
    const messages: Message[] = [
      userMsg("hello"),
      assistantMsg("hi there"),
      userMsg("latest"),
    ];

    await compactor.compact(messages);

    expect(llm.requests).toHaveLength(1);
    const req = llm.requests[0];
    expect(req.systemPrompt).toContain("summarizer");
    expect(req.messages[0].content).toContain("hello");
    expect(req.messages[0].content).toContain("hi there");
  });

  it("includes focusHint in summarization prompt", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "focused summary" });

    const compactor = new LLMCompactor(llm, { preserveLastN: 1 });
    const messages: Message[] = [
      userMsg("setup"),
      userMsg("latest"),
    ];

    await compactor.compact(messages, "wall creation");

    const prompt = llm.requests[0].messages[0].content as string;
    expect(prompt).toContain("wall creation");
  });

  it("uses default preserveLastN=6 when no config", async () => {
    const llm = new MockLLMAdapter();
    const compactor = new LLMCompactor(llm);

    const messages: Message[] = Array.from({ length: 6 }, (_, i) =>
      userMsg(`msg ${i}`)
    );

    const result = await compactor.compact(messages);
    expect(result).toHaveLength(6); // 6 <= 6, no compaction
    expect(llm.requests).toHaveLength(0);
  });

  it("respects custom model and maxSummaryTokens", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "s" });

    const compactor = new LLMCompactor(llm, {
      model: "gpt-4o-mini",
      maxSummaryTokens: 512,
      preserveLastN: 1,
    });

    await compactor.compact([userMsg("a"), userMsg("b")]);

    expect(llm.requests[0].model).toBe("gpt-4o-mini");
    expect(llm.requests[0].maxTokens).toBe(512);
  });

  it("formats tool messages in transcript", async () => {
    const llm = new MockLLMAdapter();
    llm.addResponse({ text: "s" });

    const compactor = new LLMCompactor(llm, { preserveLastN: 1 });
    const messages: Message[] = [
      { role: "tool", toolCallId: "tc1", content: "tool result" },
      userMsg("latest"),
    ];

    await compactor.compact(messages);

    const prompt = llm.requests[0].messages[0].content as string;
    expect(prompt).toContain("tool: tool result");
  });
});
