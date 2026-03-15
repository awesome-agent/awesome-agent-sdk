// part-registry.ts
// Extensible part resolution — developers register custom resolvers

import type { PartResolver } from "./types.js";

/**
 * Registry for custom PartResolvers.
 * Resolvers are called in registration order for each LoopEvent.
 * First resolver to return a non-null CustomPart wins.
 */
export class PartRegistry {
  private readonly resolvers: PartResolver[] = [];

  register(resolver: PartResolver): void {
    this.resolvers.push(resolver);
  }

  unregister(resolver: PartResolver): void {
    const idx = this.resolvers.indexOf(resolver);
    if (idx !== -1) this.resolvers.splice(idx, 1);
  }

  getResolvers(): readonly PartResolver[] {
    return this.resolvers;
  }
}
