// hook/manager.ts
// Default HookManager — sequential dispatch, priority ordering

import { HookEvent } from "./types.js";
import type {
  Hook,
  HookManager,
  HookPayload,
  HookPayloadMap,
  HookResult,
} from "./types.js";

const DEFAULT_HOOK_PRIORITY = 100;

export class DefaultHookManager implements HookManager {
  private readonly hooksByName = new Map<string, Hook>();
  private readonly hooksByEvent = new Map<HookEvent, Hook[]>();

  register<E extends HookEvent>(hook: Hook<E>): void {
    if (this.hooksByName.has(hook.name)) {
      throw new Error(`Hook "${hook.name}" is already registered`);
    }

    this.hooksByName.set(hook.name, hook as Hook);

    for (const event of this.normalizeEvents(hook.event)) {
      const list = this.hooksByEvent.get(event) ?? [];
      list.push(hook as Hook);
      list.sort((a, b) => (a.priority ?? DEFAULT_HOOK_PRIORITY) - (b.priority ?? DEFAULT_HOOK_PRIORITY));
      this.hooksByEvent.set(event, list);
    }
  }

  unregister(name: string): void {
    const hook = this.hooksByName.get(name);
    if (!hook) return;

    this.hooksByName.delete(name);

    for (const event of this.normalizeEvents(hook.event)) {
      const list = this.hooksByEvent.get(event);
      if (list) {
        this.hooksByEvent.set(
          event,
          list.filter((h) => h.name !== name)
        );
      }
    }
  }

  async dispatch<E extends HookEvent>(
    event: E,
    data: HookPayloadMap[E],
    sessionId: string
  ): Promise<HookResult<E>> {
    const hooks = this.hooksByEvent.get(event) ?? [];
    let lastModify: HookResult<E> | null = null;

    for (const hook of hooks) {
      const payload: HookPayload<E> = {
        event,
        sessionId,
        timestamp: Date.now(),
        data,
      };

      const result = (await hook.handler(payload)) as HookResult<E>;

      if (result.action === "block") {
        return result;
      }

      if (result.action === "modify") {
        lastModify = result;
      }
    }

    return lastModify ?? ({ action: "continue" } as HookResult<E>);
  }

  getHooks(event: HookEvent): Hook[] {
    return [...(this.hooksByEvent.get(event) ?? [])];
  }

  private normalizeEvents(event: HookEvent | HookEvent[]): HookEvent[] {
    return Array.isArray(event) ? event : [event];
  }
}
