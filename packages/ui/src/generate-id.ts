// generate-id.ts
// Single source of truth for ID generation — prevents collision across modules

let idCounter = 0;

/** Generates a unique ID. Uses crypto.randomUUID when available, falls back to counter. */
export function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `msg-${++idCounter}-${Date.now()}`;
}
