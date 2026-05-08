// Bounded LRU set for the MCP push controllers' seen / pushed / nudged
// trackers. Plain `Set<string>` grows unbounded across a long-running session
// (audit P2) — every delivered message id is stored forever. This wrapper
// caps the number of retained keys and evicts the oldest on overflow.
//
// Backed by a Map<string, true> so insertion order is JS-spec-defined and
// lookup stays O(1). On re-add, the key is moved to the tail so still-active
// messages don't get evicted by an unrelated burst.

export class LruSet {
  private readonly map = new Map<string, true>();

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`LruSet capacity must be a positive integer; got ${capacity}`);
    }
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  add(key: string): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, true);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }
}

// Cap the seen / pushed / nudged trackers in claude-mcp and opencode-plugin.
// Override via env if a deployment really needs to retain more (the cap is
// pure memory; oldest entries simply get retired and risk being re-pushed).
export function defaultPushSeenCapacity(): number {
  const override = Number(process.env.WHATSAGENT_PUSH_SEEN_CAP);
  return Number.isInteger(override) && override > 0 ? override : 1000;
}
