// Anthropic Claude adapter — native Messages API
// Responsibility: HTTP communication + request building. Parsing delegated to AnthropicStreamParser.

import type {
  LLMAdapter,
  LLMRequest,
  LLMStream,
  LLMToolDefinition,
  Message,
} from "@awesome-agent/agent-core";
import { DefaultLLMStream, LLMRequestError, LLMStreamError } from "@awesome-agent/agent-core";
import { AnthropicStreamParser } from "./anthropic-stream-parser.js";

// ─── Config ──────────────────────────────────────────────────

export interface AnthropicAdapterConfig {
  readonly apiKey: string;
  readonly baseURL?: string;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
  /** API version header. Default: "2023-06-01" */
  readonly apiVersion?: string;
}

// ─── Anthropic Wire Format (request) ────────────────────────

interface AnthropicMessage {
  readonly role: "user" | "assistant";
  readonly content: AnthropicContent[];
}

type AnthropicContent =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "tool_use";
      readonly id: string;
      readonly name: string;
      readonly input: Record<string, unknown>;
    }
  | {
      readonly type: "tool_result";
      readonly tool_use_id: string;
      readonly content: string;
      readonly is_error?: boolean;
    };

// ─── Constants ──────────────────────────────────────────────

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const MESSAGES_PATH = "/v1/messages";
const DEFAULT_API_VERSION = "2023-06-01";
const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;

// ─── Adapter ─────────────────────────────────────────────────

export class AnthropicAdapter implements LLMAdapter {
  private readonly config: AnthropicAdapterConfig;
  private readonly parser = new AnthropicStreamParser();

  constructor(config: AnthropicAdapterConfig) {
    this.config = config;
  }

  async stream(request: LLMRequest): Promise<LLMStream> {
    const body = this.buildBody(request);
    const baseURL = this.config.baseURL ?? DEFAULT_BASE_URL;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": this.config.apiKey,
      "anthropic-version": this.config.apiVersion ?? DEFAULT_API_VERSION,
      ...this.config.defaultHeaders,
    };

    const response = await fetch(`${baseURL}${MESSAGES_PATH}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

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
    const messages = this.convertMessages(request.messages);

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      stream: true,
      max_tokens: request.maxTokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS,
    };

    // Anthropic: system is a top-level parameter, not a message
    if (request.systemPrompt) {
      body.system = request.systemPrompt;
    }

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    if (request.tools?.length) {
      body.tools = request.tools.map(this.convertTool);
    }

    return body;
  }

  private convertMessages(messages: readonly Message[]): AnthropicMessage[] {
    const out: AnthropicMessage[] = [];

    for (const msg of messages) {
      switch (msg.role) {
        case "system":
          // System messages handled as top-level parameter — skip here
          break;

        case "user":
          out.push({
            role: "user",
            content: [{ type: "text", text: msg.content }],
          });
          break;

        case "assistant": {
          const content: AnthropicContent[] = [];
          for (const part of msg.content) {
            if (part.type === "text") {
              content.push({ type: "text", text: part.text });
            } else if (part.type === "tool_call") {
              content.push({
                type: "tool_use",
                id: part.id,
                name: part.name,
                input: part.args,
              });
            }
          }
          if (content.length > 0) {
            out.push({ role: "assistant", content });
          }
          break;
        }

        case "tool":
          // Anthropic: tool results are user messages with tool_result content
          out.push({
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: msg.toolCallId,
                content: msg.content,
                ...(msg.isError ? { is_error: true } : {}),
              },
            ],
          });
          break;
      }
    }

    return out;
  }

  private convertTool(
    tool: LLMToolDefinition
  ): { name: string; description: string; input_schema: Record<string, unknown> } {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters as Record<string, unknown>,
    };
  }
}
