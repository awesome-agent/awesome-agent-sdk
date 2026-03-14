import { describe, it, expect, vi } from "vitest";
import { RetryLLMAdapter } from "../../src/llm/retry-adapter.js";
import { MockLLMAdapter } from "../../src/llm/mock-adapter.js";
import { LLMRequestError } from "../../src/errors.js";
import type { LLMAdapter, LLMRequest, LLMStream } from "../../src/llm/types.js";

// ─── Helpers ─────────────────────────────────────────────────

const baseRequest: LLMRequest = {
  model: "gpt-4o",
  systemPrompt: "test",
  messages: [{ role: "user", content: "hi" }],
};

/** LLM adapter that fails N times then succeeds.
 *  For HTTP errors, pass statusCode + body to throw LLMRequestError.
 *  For non-HTTP errors, pass statusCode = 0 to throw a plain Error with body as message. */
function makeFailingAdapter(
  failures: number,
  statusCode: number,
  body: string,
  successText = "ok"
): LLMAdapter {
  let callCount = 0;
  const mock = new MockLLMAdapter();
  mock.addResponse({ text: successText });

  return {
    stream: async (request: LLMRequest): Promise<LLMStream> => {
      callCount++;
      if (callCount <= failures) {
        if (statusCode > 0) {
          throw new LLMRequestError(statusCode, body);
        }
        throw new Error(body);
      }
      return mock.stream(request);
    },
  };
}

/** No-wait retry adapter for testing (overrides sleep) */
class TestRetryAdapter extends RetryLLMAdapter {
  protected override sleep(_ms: number): Promise<void> {
    return Promise.resolve(); // Skip real delays in tests
  }
}

// ─── Tests ───────────────────────────────────────────────────

describe("RetryLLMAdapter", () => {
  it("passes through on first success", async () => {
    const inner = new MockLLMAdapter();
    inner.addResponse({ text: "hello" });

    const adapter = new TestRetryAdapter(inner);
    const stream = await adapter.stream(baseRequest);

    let text = "";
    for await (const e of stream) {
      if (e.type === "text-delta") text += e.text;
    }

    expect(text).toBe("hello");
  });

  it("retries on 429 and succeeds", async () => {
    const inner = makeFailingAdapter(1, 429, "rate limited");
    const adapter = new TestRetryAdapter(inner);

    const stream = await adapter.stream(baseRequest);
    let text = "";
    for await (const e of stream) {
      if (e.type === "text-delta") text += e.text;
    }

    expect(text).toBe("ok");
  });

  it("retries on 500 and succeeds on third attempt", async () => {
    const inner = makeFailingAdapter(2, 500, "server error");
    const adapter = new TestRetryAdapter(inner);

    const stream = await adapter.stream(baseRequest);
    let text = "";
    for await (const e of stream) {
      if (e.type === "text-delta") text += e.text;
    }

    expect(text).toBe("ok");
  });

  it("throws after maxRetries exhausted", async () => {
    const inner = makeFailingAdapter(5, 500, "down");
    const adapter = new TestRetryAdapter(inner, { maxRetries: 2 });

    await expect(adapter.stream(baseRequest)).rejects.toThrow(
      "LLM request failed (500): down"
    );
  });

  it("does not retry non-retryable errors (400)", async () => {
    const inner = makeFailingAdapter(1, 400, "bad request");

    const retries: number[] = [];
    const adapter = new TestRetryAdapter(inner, {
      onRetry: (attempt) => retries.push(attempt),
    });

    await expect(adapter.stream(baseRequest)).rejects.toThrow(
      "LLM request failed (400): bad request"
    );
    expect(retries).toHaveLength(0);
  });

  it("does not retry errors without status code", async () => {
    const inner = makeFailingAdapter(1, 0, "Network error");
    const adapter = new TestRetryAdapter(inner);

    await expect(adapter.stream(baseRequest)).rejects.toThrow("Network error");
  });

  it("calls onRetry callback with correct info", async () => {
    const inner = makeFailingAdapter(2, 503, "unavailable");
    const retries: Array<{ attempt: number; delay: number }> = [];

    const adapter = new TestRetryAdapter(inner, {
      baseDelay: 100,
      onRetry: (attempt, _error, delay) => retries.push({ attempt, delay }),
    });

    await adapter.stream(baseRequest);

    expect(retries).toHaveLength(2);
    expect(retries[0].attempt).toBe(1);
    expect(retries[1].attempt).toBe(2);
    // Second delay should be larger (exponential)
    expect(retries[1].delay).toBeGreaterThan(retries[0].delay);
  });

  it("respects custom isRetryable predicate", async () => {
    const inner = makeFailingAdapter(1, 0, "custom error");

    const adapter = new TestRetryAdapter(inner, {
      isRetryable: (err) => err.message.includes("custom"),
    });

    const stream = await adapter.stream(baseRequest);
    let text = "";
    for await (const e of stream) {
      if (e.type === "text-delta") text += e.text;
    }

    expect(text).toBe("ok");
  });

  it("caps delay at maxDelay", async () => {
    const inner = makeFailingAdapter(3, 429, "slow down");
    const delays: number[] = [];

    const adapter = new TestRetryAdapter(inner, {
      baseDelay: 10000,
      maxDelay: 15000,
      onRetry: (_attempt, _error, delay) => delays.push(delay),
    });

    await adapter.stream(baseRequest);

    // All delays should be <= maxDelay
    for (const d of delays) {
      expect(d).toBeLessThanOrEqual(15000);
    }
  });

  it("retries on 503 from retryableStatuses", async () => {
    const inner = makeFailingAdapter(1, 503, "service unavailable");
    const adapter = new TestRetryAdapter(inner);

    const stream = await adapter.stream(baseRequest);
    let text = "";
    for await (const e of stream) {
      if (e.type === "text-delta") text += e.text;
    }

    expect(text).toBe("ok");
  });
});
