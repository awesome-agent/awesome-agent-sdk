# CLI Agent Example

Terminal AI assistant powered by [awesome-agent-sdk](../../) + [OpenTUI](https://opentui.com).

![Terminal chat interface with tool use]

## Prerequisites

- [Bun](https://bun.sh) (OpenTUI requires Bun runtime)
- An API key (OpenAI, OpenRouter, or any OpenAI-compatible provider)

## Setup

```bash
cd examples/cli
bun install
```

## Run

```bash
# With OpenRouter (recommended — access to all models)
OPENROUTER_API_KEY=or-... bun dev

# With OpenAI
OPENAI_API_KEY=sk-... OPENAI_BASE_URL=https://api.openai.com/v1 bun dev

# Custom model
MODEL=anthropic/claude-sonnet-4-20250514 OPENROUTER_API_KEY=or-... bun dev
```

## Commands

| Command | Action |
|---------|--------|
| Type + Enter | Send message |
| `/clear` | Reset conversation |
| `/exit` or `ESC` | Quit |

## Available Tools

The agent can:
- **read_file** — Read any file from disk
- **write_file** — Create or overwrite files
- **list_dir** — List directory contents
- **run_command** — Execute shell commands (10s timeout)

## Example

```
> What's in the current directory?
Agent: Let me check...
  Running list_dir... done
Agent: The directory contains: package.json, src/, tsconfig.json, README.md

> Read package.json and tell me the dependencies
Agent: Reading the file...
  Running read_file... done
Agent: The dependencies are:
  - @opentui/core
  - @opentui/react
  - @awesome-agent/agent-core
  - @awesome-agent/adapter-openai
  - react

> Create a hello.txt file with "Hello from the agent!"
Agent: Writing the file...
  Running write_file... done
Agent: Done! Created hello.txt with the content.
```

## Architecture

```
index.tsx  → OpenTUI React UI (chat interface)
agent.ts   → AgenticLoop setup (LLM + tools + multi-turn history)
```

The UI streams text deltas in real-time and shows tool execution status. Conversation history persists across messages within the session.
