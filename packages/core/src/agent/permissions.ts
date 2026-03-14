// agent/permissions.ts
// Permission rule matching — separated from config builder (SRP)

import type { PermissionRule } from "./types.js";

/**
 * Match a tool+action against permission rules.
 * First matching rule wins. Default: "ask".
 */
export function matchPermission(
  rules: readonly PermissionRule[],
  toolName: string,
  action: string
): "allow" | "deny" | "ask" {
  for (const rule of rules) {
    if (globMatch(rule.tool, toolName) && globMatch(rule.action, action)) {
      return rule.decision;
    }
  }
  return "ask";
}

/** Simple glob match — supports * (any chars) and ? (single char) */
export function globMatch(pattern: string, value: string): boolean {
  const regex = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".") +
      "$"
  );
  return regex.test(value);
}
