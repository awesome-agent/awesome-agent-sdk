# @awesome-agent/mcp-client

MCP (Model Context Protocol) transport clients for [@awesome-agent/agent-core](../core).

Connect to **any MCP server** — fal.ai, GitHub, Slack, filesystem, databases, and hundreds more from the [MCP ecosystem](https://modelcontextprotocol.io).

## Installation

```bash
npm install @awesome-agent/agent-core @awesome-agent/mcp-client
```

## Usage — Stdio Transport

Most MCP servers run as child processes communicating via stdin/stdout:

```typescript
import { StdioMCPClient } from "@awesome-agent/mcp-client";

// fal.ai — image & video generation
const fal = new StdioMCPClient({
  id: "fal",
  name: "fal.ai",
  command: "npx",
  args: ["-y", "mcp-fal"],
  env: { FAL_KEY: process.env.FAL_KEY },
});

// GitHub — repos, issues, PRs
const github = new StdioMCPClient({
  id: "github",
  name: "GitHub",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN },
});

// Filesystem — read/write files
const fs = new StdioMCPClient({
  id: "fs",
  name: "Filesystem",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"],
});
```

## With AgenticLoop

Tools are auto-discovered and registered:

```typescript
import {
  AgenticLoop, DefaultToolRegistry, DefaultToolExecutor,
  DefaultHookManager, DefaultContextBuilder,
} from "@awesome-agent/agent-core";
import { OpenAIAdapter } from "@awesome-agent/adapter-openai";
import { StdioMCPClient } from "@awesome-agent/mcp-client";

const tools = new DefaultToolRegistry();

const loop = new AgenticLoop({
  llm: new OpenAIAdapter({ baseURL: "...", apiKey: "..." }),
  agent: { id: "agent", name: "Agent", prompt: "You can use tools." },
  tools,
  executor: new DefaultToolExecutor(tools),
  hooks: new DefaultHookManager(),
  context: new DefaultContextBuilder(),
  mcpClients: [
    new StdioMCPClient({
      id: "fal",
      name: "fal.ai",
      command: "npx",
      args: ["-y", "mcp-fal"],
      env: { FAL_KEY: process.env.FAL_KEY },
    }),
  ],
  // Tools auto-discovered: fal_generate_image, fal_generate_video, etc.
});

const result = await loop.run("Generate an image of a sunset", "s1");
```

## Multiple MCP Servers

Connect as many servers as you need — tools are prefixed with the server ID:

```typescript
const loop = new AgenticLoop({
  ...config,
  mcpClients: [
    new StdioMCPClient({ id: "fal", name: "fal.ai", command: "npx", args: ["-y", "mcp-fal"] }),
    new StdioMCPClient({ id: "github", name: "GitHub", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] }),
    new StdioMCPClient({ id: "fs", name: "FS", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] }),
  ],
});

// Available tools: fal_generate_image, github_create_issue, fs_read_file, ...
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `string` | (required) | Unique server ID (used as tool prefix) |
| `name` | `string` | (required) | Display name |
| `command` | `string` | (required) | Command to spawn (npx, node, python) |
| `args` | `string[]` | `[]` | Command arguments |
| `env` | `Record<string, string>` | `{}` | Environment variables |
| `cwd` | `string` | (process cwd) | Working directory |
| `timeout` | `number` | `30000` | Request timeout in ms |

## How It Works

```
Your app                        MCP Server (child process)
   │                                    │
   │── spawn("npx mcp-fal") ──────────►│ (process starts)
   │── stdin: initialize ─────────────►│
   │◄── stdout: { capabilities } ──────│
   │── stdin: tools/list ─────────────►│
   │◄── stdout: { tools: [...] } ──────│
   │── stdin: tools/call ─────────────►│
   │◄── stdout: { result: "..." } ─────│
   │── kill() ─────────────────────────►│ (process ends)
```

## Exports

| Export | Description |
|--------|-------------|
| `StdioMCPClient` | Stdio transport — spawns MCP server as child process |
| `StdioMCPClientConfig` | Configuration type |
| `JsonRpcClient` | Low-level JSON-RPC 2.0 client (advanced) |

## License

Apache-2.0
