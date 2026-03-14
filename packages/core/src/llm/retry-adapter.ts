// llm/retry-adapter.ts
// Decorator that adds exponential backoff retry to any LLMAdapter

import type { LLMAdapter, LLMRequest, LLMStream } from "./types.js";

// ─── Configuration ───────────────────────────────────────────

export interface RetryConfig {
  readonly maxRetries?: number; // Default: 3
  readonly baseDelay?: number; // Default: 1000 (ms)
  readonly maxDelay?: number; // Default: 30000 (ms)
  readonly retryableStatuses?: readonly number[]; // Default: [429, 500, 503]
  readonly isRetryable?: (error: Error) => boolean;
  readonly onRetry?: (attempt: number, error: Error, delay: number) => void;
}

// ─── Defaults ────────────────────────────────────────────────

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY = 1000;
const DEFAULT_MAX_DELAY = 30_000;
const DEFAULT_RETRYABLE_STATUSES: readonly number[] = [429, 500, 503];
const STATUS_CODE_PATTERN = /\((\d+)\)/;
const JITTER_MIN = 0.85;
const JITTER_RANGE = 0.3; // Jitter multiplier range: 0.85–1.15

// ─── Retry Adapter ───────────────────────────────────────────

export class RetryLLMAdapter implements LLMAdapter {
  private readonly inner: LLMAdapter;
  private readonly maxRetries: number;
  private readonly baseDelay: number;
  private readonly maxDelay: number;
  private readonly retryableStatuses: readonly number[];
  private readonly isRetryable?: (error: Error) => boolean;
  private readonly onRetry?: (attempt: number, error: Error, delay: number) => void;

  constructor(inner: LLMAdapter, config?: RetryConfig) {
    this.inner = inner;
    this.maxRetries = config?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelay = config?.baseDelay ?? DEFAULT_BASE_DELAY;
    this.maxDelay = config?.maxDelay ?? DEFAULT_MAX_DELAY;
    this.retryableStatuses = config?.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES;
    this.isRetryable = config?.isRetryable;
    this.onRetry = config?.onRetry;
  }

  async stream(request: LLMRequest): Promise<LLMStream> {
    let lastError!: Error;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.inner.stream(request);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt === this.maxRetries || !this.shouldRetry(lastError)) {
          throw lastError;
        }

        const delay = this.calculateDelay(attempt);
        this.onRetry?.(attempt + 1, lastError, delay);
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private shouldRetry(error: Error): boolean {
    if (this.isRetryable) {
      return this.isRetryable(error);
    }

    const match = error.message.match(STATUS_CODE_PATTERN);
    if (!match) return false;
    return this.retryableStatuses.includes(parseInt(match[1]));
  }

  private calculateDelay(attempt: number): number {
    const jitter = JITTER_MIN + Math.random() * JITTER_RANGE;
    const delay = this.baseDelay * Math.pow(2, attempt) * jitter;
    return Math.min(delay, this.maxDelay);
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
