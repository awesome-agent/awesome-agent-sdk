// storage/task-tool.ts
// Built-in task tool — plan and track work across conversations
// Uses StorageBackend for actual storage

import type { Tool } from "../tool/types.js";
import type { StorageBackend } from "./types.js";

const COLLECTION = "tasks";

export const TASK_TOOL_NAME = "task";

export const TASK_SYSTEM_PROMPT = [
  "## Planning",
  "For complex, multi-step tasks, use the `task` tool to create a plan before executing.",
  "1. Call task({ command: 'create', title: '...', steps: [...] }) to create a plan.",
  "2. STOP after creating the plan. Do NOT call any other tools or continue working.",
  "3. Wait for the user to approve, edit, or reject the plan.",
  "4. Once approved, follow the plan step by step, updating task status as you go.",
  "Use command 'update' to mark steps complete, 'list' to review progress.",
].join("\n");

export function createTaskTool(backend: StorageBackend): Tool {
  return {
    name: TASK_TOOL_NAME,
    description:
      "Plan and track tasks. Commands: create (new plan), list (show tasks), update (change status), delete.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          enum: ["create", "list", "update", "delete"],
          description: "Task command",
        },
        title: { type: "string", description: "Task/plan title (for create)" },
        steps: {
          type: "array",
          items: { type: "string" },
          description: "Step-by-step plan (for create)",
        },
        id: { type: "string", description: "Task ID (for update/delete)" },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed"],
          description: "New status (for update)",
        },
      },
      required: ["command"],
    },
    execute: async (args, _context) => {
      const command = args.command as string;
      try {
        if (command === "create") {
          return await createTask(backend, args);
        }
        if (command === "list") {
          return await listTasks(backend);
        }
        if (command === "update") {
          return await updateTask(backend, args);
        }
        if (command === "delete") {
          return await deleteTask(backend, args.id as string | undefined);
        }
        return { success: false, content: `Unknown command: ${command}` };
      } catch (err) {
        return { success: false, content: `Task error: ${err}` };
      }
    },
  };
}

async function createTask(
  backend: StorageBackend,
  args: Record<string, unknown>
) {
  const title = args.title as string | undefined;
  const steps = args.steps as string[] | undefined;
  if (!title) {
    return { success: false, content: "title is required for create." };
  }
  const id = Date.now().toString(36);
  await backend.write(COLLECTION, id, {
    title,
    steps: (steps ?? []).map((s, i) => ({ index: i, text: s, status: "pending" })),
    status: "pending",
    createdAt: Date.now(),
  });
  const planText = steps?.length
    ? `Plan "${title}" created:\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\nWaiting for user approval.`
    : `Task "${title}" created.`;
  return { success: true, content: planText };
}

async function listTasks(backend: StorageBackend) {
  const records = await backend.read(COLLECTION);
  if (records.length === 0) {
    return { success: true, content: "No tasks." };
  }
  const lines = records.map((r) => {
    const steps = r.steps as { status: string }[] | undefined;
    const progress = steps
      ? ` [${steps.filter((s) => s.status === "completed").length}/${steps.length}]`
      : "";
    return `- [${r.status}] ${r.title}${progress} (id: ${r.id})`;
  });
  return { success: true, content: `Tasks:\n${lines.join("\n")}` };
}

async function updateTask(
  backend: StorageBackend,
  args: Record<string, unknown>
) {
  const id = args.id as string | undefined;
  const status = args.status as string | undefined;
  if (!id || !status) {
    return { success: false, content: "id and status are required for update." };
  }
  const records = await backend.read(COLLECTION, id);
  if (records.length === 0) {
    return { success: false, content: `Task "${id}" not found.` };
  }
  await backend.write(COLLECTION, id, { ...records[0], status });
  return { success: true, content: `Task "${id}" updated to ${status}.` };
}

async function deleteTask(
  backend: StorageBackend,
  id: string | undefined
) {
  if (!id) {
    return { success: false, content: "id is required for delete." };
  }
  await backend.delete(COLLECTION, id);
  return { success: true, content: `Task "${id}" deleted.` };
}
