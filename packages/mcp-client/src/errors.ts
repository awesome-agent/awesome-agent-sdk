export class MCPRequestError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "MCPRequestError";
    this.code = code;
  }
}

export class MCPConnectionError extends Error {
  constructor(message = "MCP client not connected") {
    super(message);
    this.name = "MCPConnectionError";
  }
}

export class MCPTimeoutError extends Error {
  readonly method: string;
  constructor(method: string) {
    super(`MCP request timed out: ${method}`);
    this.name = "MCPTimeoutError";
    this.method = method;
  }
}
