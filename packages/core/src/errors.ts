// errors.ts
// Typed error hierarchy — catch by class, not by message string

// ─── Base Error ──────────────────────────────────────────────

/** Base class for all awesome-agent errors */
export class AgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentError";
  }
}

// ─── LLM Errors ─────────────────────────────────────────────

/** LLM HTTP request failed (429, 500, etc.) */
export class LLMRequestError extends AgentError {
  readonly statusCode: number;
  readonly responseBody: string;

  constructor(statusCode: number, responseBody: string) {
    super(`LLM request failed (${statusCode}): ${responseBody}`);
    this.name = "LLMRequestError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

/** LLM response body is null — streaming not supported */
export class LLMStreamError extends AgentError {
  constructor(message = "Response body is null — streaming not supported") {
    super(message);
    this.name = "LLMStreamError";
  }
}

/** LLM call blocked by hook */
export class LLMBlockedError extends AgentError {
  readonly reason: string;

  constructor(reason: string) {
    super(`LLM call blocked: ${reason}`);
    this.name = "LLMBlockedError";
    this.reason = reason;
  }
}

// ─── Tool Errors ─────────────────────────────────────────────

/** Tool execution threw an exception */
export class ToolExecutionError extends AgentError {
  readonly toolName: string;

  constructor(toolName: string, cause: string) {
    super(`Tool "${toolName}" failed: ${cause}`);
    this.name = "ToolExecutionError";
    this.toolName = toolName;
  }
}

// ─── MCP Errors ──────────────────────────────────────────────

/** MCP JSON-RPC error response */
export class MCPRequestError extends AgentError {
  readonly code: number;

  constructor(code: number, message: string) {
    super(`MCP error (${code}): ${message}`);
    this.name = "MCPRequestError";
    this.code = code;
  }
}

/** MCP client not connected */
export class MCPConnectionError extends AgentError {
  constructor(message = "MCP client not connected") {
    super(message);
    this.name = "MCPConnectionError";
  }
}

/** MCP request timed out */
export class MCPTimeoutError extends AgentError {
  readonly method: string;

  constructor(method: string) {
    super(`MCP request timed out: ${method}`);
    this.name = "MCPTimeoutError";
    this.method = method;
  }
}

// ─── Config Errors ───────────────────────────────────────────

/** Missing required configuration */
export class ConfigError extends AgentError {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

// ─── Registration Errors ─────────────────────────────────────

/** Duplicate registration (tool, hook, skill) */
export class DuplicateRegistrationError extends AgentError {
  readonly itemName: string;

  constructor(type: string, name: string) {
    super(`${type} "${name}" is already registered`);
    this.name = "DuplicateRegistrationError";
    this.itemName = name;
  }
}
