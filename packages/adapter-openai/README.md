# @algomim/adapter-openai

OpenAI-compatible LLM adapter for [@algomim/agent-core](../core).

Works with **any provider** that speaks the OpenAI chat completions protocol: OpenAI, OpenRouter, Groq, Ollama, Together, and more.

## Installation

```bash
npm install @algomim/agent-core @algomim/adapter-openai
```

## Usage

```typescript
import { OpenAIAdapter } from "@algomim/adapter-openai";

const llm = new OpenAIAdapter({
  baseURL: "https://api.openai.com/v1",
  apiKey: process.env.OPENAI_API_KEY,
});
```

### With OpenRouter

```typescript
const llm = new OpenAIAdapter({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
```

### With Groq

```typescript
const llm = new OpenAIAdapter({
  baseURL: "https://api.groq.com/openai/v1",
  apiKey: process.env.GROQ_API_KEY,
});
```

### With Ollama (local)

```typescript
const llm = new OpenAIAdapter({
  baseURL: "http://localhost:11434/v1",
});
```

### With Retry

Wrap with `RetryLLMAdapter` for automatic retry on 429/500/503:

```typescript
import { RetryLLMAdapter } from "@algomim/agent-core";
import { OpenAIAdapter } from "@algomim/adapter-openai";

const llm = new RetryLLMAdapter(
  new OpenAIAdapter({
    baseURL: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY,
  }),
  { maxRetries: 3, baseDelay: 1000 }
);
```

### Custom Headers

```typescript
const llm = new OpenAIAdapter({
  baseURL: "https://your-proxy.com/v1",
  apiKey: "your-key",
  defaultHeaders: {
    "X-Custom-Header": "value",
  },
});
```

## Full Example with AgenticLoop

```typescript
import {
  AgenticLoop,
  DefaultToolRegistry,
  DefaultToolExecutor,
  DefaultHookManager,
  DefaultContextBuilder,
} from "@algomim/agent-core";
import { OpenAIAdapter } from "@algomim/adapter-openai";

const llm = new OpenAIAdapter({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const tools = new DefaultToolRegistry();
const loop = new AgenticLoop({
  llm,
  agent: { id: "my-agent", name: "Agent", prompt: "You are helpful." },
  tools,
  executor: new DefaultToolExecutor(tools),
  hooks: new DefaultHookManager(),
  context: new DefaultContextBuilder(),
});

const result = await loop.run("Hello!", "session-1");
console.log(result.output);
```

## Exports

| Export | Description |
|--------|-------------|
| `OpenAIAdapter` | LLMAdapter implementation for OpenAI-compatible APIs |
| `OpenAIAdapterConfig` | Configuration type (baseURL, apiKey, defaultHeaders) |
| `OpenAIStreamParser` | SSE stream parser (advanced: use directly for custom streaming) |

## License

MIT
