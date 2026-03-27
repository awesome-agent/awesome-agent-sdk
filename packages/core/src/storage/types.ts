// storage/types.ts
// Abstract storage backend — developer provides implementation
// (HTTP, MCP, Firestore, file system, PostgreSQL, etc.)
//
// Agent tools use this interface for persistence.
// Core SDK never knows where data lives.

export interface StorageRecord {
  readonly id: string;
  readonly [key: string]: unknown;
}

export interface StorageBackend {
  read(collection: string, id?: string): Promise<readonly StorageRecord[]>;
  write(collection: string, id: string, data: Record<string, unknown>): Promise<void>;
  delete(collection: string, id: string): Promise<void>;
}
