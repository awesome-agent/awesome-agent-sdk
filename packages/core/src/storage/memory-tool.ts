// storage/memory-tool.ts
// Built-in memory tools — persistent knowledge across conversations
// Each operation is a separate tool (ISP) to avoid LLM filling irrelevant parameters

import type { Tool } from "../tool/types.js";
import type { StorageBackend } from "./types.js";

const COLLECTION = "memories";

export const MEMORY_SYSTEM_PROMPT = [
  "## Memory",
  "You have persistent memory across conversations.",
  "Use memory_list to check stored memories when you need user context.",
  "Use memory_read to get a specific memory's content.",
  "Use memory_create to save important info (preferences, feedback, context).",
  "Use memory_update to modify existing memories.",
  "Use memory_delete to remove outdated memories.",
  "Only access memory when genuinely needed — not on every message.",
].join("\n");

export const MEMORY_TOOL_NAMES = [
  "memory_list",
  "memory_read",
  "memory_create",
  "memory_update",
  "memory_delete",
] as const;

/** @deprecated Use createMemoryTools instead */
export const MEMORY_TOOL_NAME = "memory_list";

export function createMemoryTools(backend: StorageBackend): readonly Tool[] {
  return [
    createListTool(backend),
    createReadTool(backend),
    createCreateTool(backend),
    createUpdateTool(backend),
    createDeleteTool(backend),
  ];
}

/** @deprecated Use createMemoryTools instead */
export function createMemoryTool(backend: StorageBackend): Tool {
  return createListTool(backend);
}

// ─── Individual Tools ────────────────────────────────────────

function createListTool(backend: StorageBackend): Tool {
  return {
    name: "memory_list",
    description: "List all stored memories with their full content.",
    parameters: { type: "object", properties: {} },
    execute: async (_args, _ctx) => {
      const records = await backend.read(COLLECTION);
      if (records.length === 0) {
        return { success: true, content: "No memories stored yet." };
      }
      return {
        success: true,
        content: records
          .map((r) => `### ${r.name} [${r.type ?? "user"}]\n${r.content}`)
          .join("\n\n"),
      };
    },
  };
}

function createReadTool(backend: StorageBackend): Tool {
  return {
    name: "memory_read",
    description: "Read a specific memory by name.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Exact memory name" },
      },
      required: ["name"],
    },
    execute: async (args, _ctx) => {
      const name = args.name as string;
      const records = await backend.read(COLLECTION, name);
      if (records.length === 0) {
        return { success: false, content: `Memory "${name}" not found.` };
      }
      const record = records[0];
      return { success: true, content: `[${record.type}] ${record.name}\n\n${record.content}` };
    },
  };
}

function createCreateTool(backend: StorageBackend): Tool {
  return {
    name: "memory_create",
    description: "Save a new memory for future conversations.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short descriptive name" },
        content: { type: "string", description: "Memory content" },
        type: {
          type: "string",
          enum: ["user", "feedback", "project", "reference"],
          description: "Memory type (default: user)",
        },
      },
      required: ["name", "content"],
    },
    execute: async (args, _ctx) => {
      const name = args.name as string;
      const content = args.content as string;
      const type = (args.type as string) ?? "user";
      const id = name.toLowerCase().replace(/\s+/g, "-");
      await backend.write(COLLECTION, id, { name, content, type });
      return { success: true, content: `Memory "${name}" created.` };
    },
  };
}

function createUpdateTool(backend: StorageBackend): Tool {
  return {
    name: "memory_update",
    description: "Update an existing memory by replacing text within it.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Exact memory name" },
        old_str: { type: "string", description: "Text to find" },
        new_str: { type: "string", description: "Replacement text" },
      },
      required: ["name", "old_str", "new_str"],
    },
    execute: async (args, _ctx) => {
      const name = args.name as string;
      const oldStr = args.old_str as string;
      const newStr = args.new_str as string;
      const records = await backend.read(COLLECTION, name);
      if (records.length === 0) {
        return { success: false, content: `Memory "${name}" not found.` };
      }
      const record = records[0];
      const currentContent = record.content as string;
      if (!currentContent.includes(oldStr)) {
        return { success: false, content: `old_str not found in memory "${name}".` };
      }
      await backend.write(COLLECTION, record.id, {
        ...record,
        content: currentContent.replace(oldStr, newStr),
      });
      return { success: true, content: `Memory "${name}" updated.` };
    },
  };
}

function createDeleteTool(backend: StorageBackend): Tool {
  return {
    name: "memory_delete",
    description: "Delete a memory by name.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Exact memory name" },
      },
      required: ["name"],
    },
    execute: async (args, _ctx) => {
      const name = args.name as string;
      const records = await backend.read(COLLECTION, name);
      if (records.length === 0) {
        return { success: false, content: `Memory "${name}" not found.` };
      }
      await backend.delete(COLLECTION, records[0].id);
      return { success: true, content: `Memory "${name}" deleted.` };
    },
  };
}
