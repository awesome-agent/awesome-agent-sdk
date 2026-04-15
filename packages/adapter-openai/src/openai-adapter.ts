// OpenAI-compatible adapter — works with OpenRouter, OpenAI, Groq, Together, Ollama, etc.
// Responsibility: HTTP communication + request building. Parsing delegated to OpenAIStreamParser.

import type {
  LLMAdapter,
  LLMRequest,
  LLMStream,
  LLMToolDefinition,
} from "@awesome-agent/agent-core";
import { DefaultLLMStream, LLMRequestError, LLMStreamError } from "@awesome-agent/agent-core";
import { OpenAIStreamParser } from "./openai-stream-parser.js";

// ─── Config ──────────────────────────────────────────────────

export interface OpenAIAdapterConfig {
  readonly baseURL: string;
  readonly apiKey?: string;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
  /**
   * Extra fields merged into every request body (OpenRouter-style provider
   * options, reasoning toggles, response_format, etc.). Values in `extraBody`
   * override adapter-generated fields of the same name.
   */
  readonly extraBody?: Readonly<Record<string, unknown>>;
}

// ─── OpenAI Wire Format (request) ───────────────────────────

interface OpenAIMessage {
  readonly role: string;
  readonly content?: string | null;
  tool_calls?: readonly {
    readonly id: string;
    readonly type: "function";
    readonly function: { readonly name: string; readonly arguments: string };
  }[];
  readonly tool_call_id?: string;
}

// ─── Constants ──────────────────────────────────────────────

const CHAT_COMPLETIONS_PATH = "/chat/completions";
const AUTH_SCHEME = "Bearer";

// ─── Adapter ─────────────────────────────────────────────────

export class OpenAIAdapter implements LLMAdapter {
  private readonly config: OpenAIAdapterConfig;
  private readonly parser = new OpenAIStreamParser();

  constructor(config: OpenAIAdapterConfig) {
    this.config = config;
  }

  async stream(request: LLMRequest): Promise<LLMStream> {
    const body = this.buildBody(request);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.defaultHeaders,
    };
    if (this.config.apiKey) {
      headers["Authorization"] = `${AUTH_SCHEME} ${this.config.apiKey}`;
    }

    const response = await fetch(
      `${this.config.baseURL}${CHAT_COMPLETIONS_PATH}`,
      { method: "POST", headers, body: JSON.stringify(body) }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new LLMRequestError(response.status, text);
    }

    if (!response.body) {
      throw new LLMStreamError();
    }

    return new DefaultLLMStream(this.parser.parse(response.body));
  }

  // ─── Request Build ──────────────────────────────────────────

  private buildBody(request: LLMRequest): Record<string, unknown> {
    const messages = this.convertMessages(request);

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens;
    }
    if (request.tools?.length) {
      body.tools = request.tools.map(this.convertTool);
    }

    if (this.config.extraBody) {
      Object.assign(body, this.config.extraBody);
    }

    return body;
  }

  private convertMessages(request: LLMRequest): OpenAIMessage[] {
    const out: OpenAIMessage[] = [];

    if (request.systemPrompt) {
      out.push({ role: "system", content: request.systemPrompt });
    }

    for (const msg of request.messages) {
      switch (msg.role) {
        case "system":
          out.push({ role: "system", content: msg.content });
          break;

        case "user":
          out.push({ role: "user", content: msg.content });
          break;

        case "assistant": {
          const text = msg.content
            .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
            .map((p) => p.text)
            .join("");

          const toolCalls = msg.content
            .filter((p): p is Extract<typeof p, { type: "tool_call" }> => p.type === "tool_call")
            .map((p) => ({
              id: p.id,
              type: "function" as const,
              function: { name: p.name, arguments: JSON.stringify(p.args) },
            }));

          const m: OpenAIMessage = {
            role: "assistant",
            content: text || null,
          };
          if (toolCalls.length > 0) {
            m.tool_calls = toolCalls;
          }
          out.push(m);
          break;
        }

        case "tool":
          out.push({
            role: "tool",
            tool_call_id: msg.toolCallId,
            content: msg.content,
          });
          break;
      }
    }

    return out;
  }

  private convertTool(
    tool: LLMToolDefinition
  ): { type: "function"; function: Record<string, unknown> } {
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    };
  }
}
