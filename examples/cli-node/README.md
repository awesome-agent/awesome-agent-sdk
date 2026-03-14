# CLI Agent (Node.js)

Simple terminal AI agent — Node.js only, zero extra dependencies.

## Setup

```bash
cd examples/cli-node
npm install
cp .env.example .env   # Fill in your API key
```

## Run

```bash
npm run dev
```

Or step by step:

```bash
npm run build
node --env-file=.env dist/index.js
```

## .env

```env
# OpenRouter (recommended)
OPENROUTER_API_KEY=or-...

# Or OpenAI directly
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1

# Model (optional)
MODEL=openai/gpt-4o
```

## Commands

| Command | Action |
|---------|--------|
| Type + Enter | Send message |
| `/clear` | Reset conversation |
| `/exit` | Quit |

## Tools

- **read_file** — Read any file
- **write_file** — Create or overwrite files
- **list_dir** — List directory contents
- **run_command** — Execute shell commands (10s timeout)

## Example

```
  awesome-agent CLI (openai/gpt-4o)
  Type a message. /clear to reset, /exit to quit.

You: What files are in the current directory?
Agent:
  [list_dir] done
Here are the files: package.json, src/, tsconfig.json, README.md, .env.example

You: Read package.json
Agent:
  [read_file] done
The package.json contains @awesome-agent/agent-core and @awesome-agent/adapter-openai as dependencies.
```
