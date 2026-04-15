# @awesome-agent/adapter-anthropic

Anthropic adapter for [@awesome-agent/agent-core](../core).

Uses the native [Anthropic Messages API](https://docs.anthropic.com/en/api/messages) — not the OpenAI compatibility layer. Supports streaming, tool use, and all Anthropic models.

## Installation

```bash
npm install @awesome-agent/agent-core @awesome-agent/adapter-anthropic
```

## Usage

```typescript
import { AnthropicAdapter } from "@awesome-agent/adapter-anthropic";

const llm = new AnthropicAdapter({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});
```

### With Custom Base URL (proxy)

```typescript
const llm = new AnthropicAdapter({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  baseURL: "https://my-proxy.com",
});
```

### With Retry

```typescript
import { RetryLLMAdapter } from "@awesome-agent/agent-core";
import { AnthropicAdapter } from "@awesome-agent/adapter-anthropic";

const llm = new RetryLLMAdapter(
  new AnthropicAdapter({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  { maxRetries: 3 }
);
```

## Full Example with AgenticLoop

```typescript
import {
  AgenticLoop, DefaultToolRegistry, DefaultToolExecutor,
  DefaultHookManager, DefaultContextBuilder,
} from "@awesome-agent/agent-core";
import { AnthropicAdapter } from "@awesome-agent/adapter-anthropic";

const llm = new AnthropicAdapter({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const tools = new DefaultToolRegistry();
const loop = new AgenticLoop({
  llm,
  agent: {
    id: "anthropic-agent",
    name: "Anthropic Agent",
    prompt: "You are a helpful assistant.",
    model: "<model-id>",
  },
  tools,
  executor: new DefaultToolExecutor(tools),
  hooks: new DefaultHookManager(),
  context: new DefaultContextBuilder(),
});

const result = await loop.run("Hello!", "session-1");
console.log(result.output);
```

## API Differences from OpenAI

This adapter handles Anthropic's unique API format automatically:

| Feature | OpenAI | Anthropic (handled by adapter) |
|---------|--------|-------------------------------|
| System prompt | Message with `role: "system"` | Top-level `system` parameter |
| Tool calls | `function` type | `tool_use` type |
| Tool results | `role: "tool"` message | `tool_result` content block in user message |
| Streaming events | `choices[0].delta` | `content_block_delta`, `message_delta` |
| Stop reason | `finish_reason: "stop"` | `stop_reason: "end_turn"` |

You don't need to handle any of this — just use the adapter like any other `LLMAdapter`.

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | (required) | Anthropic API key |
| `baseURL` | `string` | `"https://api.anthropic.com"` | API base URL |
| `apiVersion` | `string` | `"2023-06-01"` | `anthropic-version` header |
| `defaultHeaders` | `Record<string, string>` | `{}` | Extra headers |

## Exports

| Export | Description |
|--------|-------------|
| `AnthropicAdapter` | LLMAdapter implementation for Anthropic Messages API |
| `AnthropicAdapterConfig` | Configuration type |
| `AnthropicStreamParser` | SSE parser for Anthropic stream format (advanced) |

## License

Apache-2.0
