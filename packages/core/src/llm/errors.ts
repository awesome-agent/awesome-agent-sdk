// llm/errors.ts
// Error types for LLM adapters

export class LLMRequestError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`LLM request failed with status ${status}: ${body}`);
    this.name = "LLMRequestError";
    this.status = status;
    this.body = body;
  }
}

export class LLMStreamError extends Error {
  constructor(message = "LLM stream failed") {
    super(message);
    this.name = "LLMStreamError";
  }
}
