// Strict integer parsing helpers for HTTP request inputs.
//
// Replaces ad-hoc `Number(x)` patterns in daemon handlers, where `Number("foo")`
// silently becomes `NaN` and downstream lookups behave oddly. Tightens audit
// finding M4 (loose number coercion) without changing the wire format.

export interface IntegerParseOptions {
  min?: number;
  max?: number;
  default?: number;
}

export function parseInteger(value: unknown, opts: IntegerParseOptions = {}): number {
  if (value === undefined || value === null || value === "") {
    if (opts.default !== undefined) return opts.default;
    throw new Error("integer is required");
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(n)) {
    // `Number.isSafeInteger` rejects NaN, Infinity, non-integers, and values
    // beyond ±(2^53-1) — covers `Number("1e308")` which `isInteger` accepts.
    throw new Error(`expected integer, got ${describe(value)}`);
  }
  if (opts.min !== undefined && n < opts.min) {
    throw new Error(`integer ${n} is below minimum ${opts.min}`);
  }
  if (opts.max !== undefined && n > opts.max) {
    throw new Error(`integer ${n} is above maximum ${opts.max}`);
  }
  return n;
}

export function parseIntegerArray(value: unknown, opts: IntegerParseOptions = {}): number[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("expected an array of integers");
  return value.map((item) => parseInteger(item, opts));
}

function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}
