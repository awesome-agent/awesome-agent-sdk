import { describe, it, expect } from "vitest";
import {
  AgentError,
  LLMRequestError,
  LLMStreamError,
  LLMBlockedError,
  ToolExecutionError,
  MCPRequestError,
  MCPConnectionError,
  MCPTimeoutError,
  ConfigError,
  DuplicateRegistrationError,
} from "../src/errors.js";

describe("Typed Errors", () => {
  it("all errors extend AgentError", () => {
    const errors = [
      new LLMRequestError(429, "rate limited"),
      new LLMStreamError(),
      new LLMBlockedError("forbidden"),
      new ToolExecutionError("read_file", "not found"),
      new MCPRequestError(-32600, "Invalid Request"),
      new MCPConnectionError(),
      new MCPTimeoutError("tools/list"),
      new ConfigError("missing id"),
      new DuplicateRegistrationError("Tool", "read"),
    ];

    for (const err of errors) {
      expect(err).toBeInstanceOf(AgentError);
      expect(err).toBeInstanceOf(Error);
    }
  });

  describe("LLMRequestError", () => {
    it("exposes statusCode and responseBody", () => {
      const err = new LLMRequestError(429, "rate limited");
      expect(err.statusCode).toBe(429);
      expect(err.responseBody).toBe("rate limited");
      expect(err.message).toContain("429");
      expect(err.name).toBe("LLMRequestError");
    });
  });

  describe("LLMStreamError", () => {
    it("has default message", () => {
      const err = new LLMStreamError();
      expect(err.message).toContain("null");
      expect(err.name).toBe("LLMStreamError");
    });
  });

  describe("LLMBlockedError", () => {
    it("exposes reason", () => {
      const err = new LLMBlockedError("rate limit");
      expect(err.reason).toBe("rate limit");
      expect(err.message).toContain("rate limit");
      expect(err.name).toBe("LLMBlockedError");
    });
  });

  describe("ToolExecutionError", () => {
    it("exposes toolName", () => {
      const err = new ToolExecutionError("read_file", "file not found");
      expect(err.toolName).toBe("read_file");
      expect(err.message).toContain("read_file");
      expect(err.name).toBe("ToolExecutionError");
    });
  });

  describe("MCPRequestError", () => {
    it("exposes code", () => {
      const err = new MCPRequestError(-32600, "Invalid Request");
      expect(err.code).toBe(-32600);
      expect(err.message).toContain("-32600");
      expect(err.name).toBe("MCPRequestError");
    });
  });

  describe("MCPConnectionError", () => {
    it("has default message", () => {
      const err = new MCPConnectionError();
      expect(err.message).toContain("not connected");
      expect(err.name).toBe("MCPConnectionError");
    });
  });

  describe("MCPTimeoutError", () => {
    it("exposes method", () => {
      const err = new MCPTimeoutError("tools/list");
      expect(err.method).toBe("tools/list");
      expect(err.message).toContain("tools/list");
      expect(err.name).toBe("MCPTimeoutError");
    });
  });

  describe("ConfigError", () => {
    it("has custom message", () => {
      const err = new ConfigError("AgentConfig requires id");
      expect(err.message).toBe("AgentConfig requires id");
      expect(err.name).toBe("ConfigError");
    });
  });

  describe("DuplicateRegistrationError", () => {
    it("exposes itemName", () => {
      const err = new DuplicateRegistrationError("Tool", "read_file");
      expect(err.itemName).toBe("read_file");
      expect(err.message).toContain("Tool");
      expect(err.message).toContain("read_file");
      expect(err.name).toBe("DuplicateRegistrationError");
    });
  });
});
