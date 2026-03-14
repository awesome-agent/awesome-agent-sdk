import { describe, it, expect } from "vitest";
import { matchPermission, globMatch } from "../../src/agent/permissions.js";
import type { PermissionRule } from "../../src/agent/types.js";

describe("globMatch", () => {
  it("exact match", () => {
    expect(globMatch("read", "read")).toBe(true);
    expect(globMatch("read", "write")).toBe(false);
  });

  it("wildcard * matches any chars", () => {
    expect(globMatch("execute_*", "execute_script")).toBe(true);
    expect(globMatch("execute_*", "execute_")).toBe(true);
    expect(globMatch("execute_*", "read")).toBe(false);
  });

  it("wildcard ? matches single char", () => {
    expect(globMatch("rea?", "read")).toBe(true);
    expect(globMatch("rea?", "rea")).toBe(false);
    expect(globMatch("rea?", "reads")).toBe(false);
  });

  it("* matches everything", () => {
    expect(globMatch("*", "anything")).toBe(true);
    expect(globMatch("*", "")).toBe(true);
  });

  it("escapes regex special chars", () => {
    expect(globMatch("file.txt", "file.txt")).toBe(true);
    expect(globMatch("file.txt", "filextxt")).toBe(false);
  });
});

describe("matchPermission", () => {
  it("returns ask when no rules", () => {
    expect(matchPermission([], "read", "execute")).toBe("ask");
  });

  it("first matching rule wins", () => {
    const rules: PermissionRule[] = [
      { tool: "read", action: "*", decision: "deny" },
      { tool: "*", action: "*", decision: "allow" },
    ];
    expect(matchPermission(rules, "read", "execute")).toBe("deny");
  });

  it("falls through to wildcard", () => {
    const rules: PermissionRule[] = [
      { tool: "read", action: "*", decision: "deny" },
      { tool: "*", action: "*", decision: "allow" },
    ];
    expect(matchPermission(rules, "write", "execute")).toBe("allow");
  });

  it("returns ask when nothing matches", () => {
    const rules: PermissionRule[] = [
      { tool: "read", action: "delete", decision: "deny" },
    ];
    expect(matchPermission(rules, "write", "execute")).toBe("ask");
  });

  it("matches by action pattern", () => {
    const rules: PermissionRule[] = [
      { tool: "*", action: "delete*", decision: "deny" },
    ];
    expect(matchPermission(rules, "file", "delete_all")).toBe("deny");
    expect(matchPermission(rules, "file", "read")).toBe("ask");
  });
});
