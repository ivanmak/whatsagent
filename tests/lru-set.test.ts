import { expect, test } from "bun:test";

import { LruSet, defaultPushSeenCapacity } from "../src/integrations/lru-set.ts";

test("LruSet stores keys and reports membership", () => {
  const set = new LruSet(5);
  set.add("a");
  set.add("b");
  expect(set.has("a")).toBe(true);
  expect(set.has("b")).toBe(true);
  expect(set.has("c")).toBe(false);
  expect(set.size).toBe(2);
});

test("LruSet evicts oldest entry when capacity is exceeded", () => {
  const set = new LruSet(3);
  set.add("a");
  set.add("b");
  set.add("c");
  set.add("d"); // evicts "a"
  expect(set.has("a")).toBe(false);
  expect(set.has("b")).toBe(true);
  expect(set.has("c")).toBe(true);
  expect(set.has("d")).toBe(true);
  expect(set.size).toBe(3);
});

test("LruSet refreshes recency on re-add so frequently-touched keys survive", () => {
  const set = new LruSet(3);
  set.add("a");
  set.add("b");
  set.add("c");
  set.add("a"); // moves "a" to tail (now b is oldest)
  set.add("d"); // should evict "b", not "a"
  expect(set.has("a")).toBe(true);
  expect(set.has("b")).toBe(false);
  expect(set.has("c")).toBe(true);
  expect(set.has("d")).toBe(true);
});

test("LruSet stress: adding 2000 keys with capacity 1000 keeps newest 1000", () => {
  const set = new LruSet(1000);
  for (let i = 0; i < 2000; i++) set.add(`key-${i}`);
  expect(set.size).toBe(1000);
  expect(set.has("key-0")).toBe(false);
  expect(set.has("key-999")).toBe(false);
  expect(set.has("key-1000")).toBe(true);
  expect(set.has("key-1999")).toBe(true);
});

test("LruSet rejects invalid capacities", () => {
  expect(() => new LruSet(0)).toThrow(/positive integer/);
  expect(() => new LruSet(-5)).toThrow(/positive integer/);
  expect(() => new LruSet(1.5)).toThrow(/positive integer/);
});

test("LruSet supports delete", () => {
  const set = new LruSet(3);
  set.add("a");
  expect(set.delete("a")).toBe(true);
  expect(set.has("a")).toBe(false);
  expect(set.delete("a")).toBe(false);
});

test("defaultPushSeenCapacity falls back to 1000 and respects env override", () => {
  const previous = process.env.WHATSAGENT_PUSH_SEEN_CAP;
  try {
    delete process.env.WHATSAGENT_PUSH_SEEN_CAP;
    expect(defaultPushSeenCapacity()).toBe(1000);
    process.env.WHATSAGENT_PUSH_SEEN_CAP = "250";
    expect(defaultPushSeenCapacity()).toBe(250);
    process.env.WHATSAGENT_PUSH_SEEN_CAP = "0";
    expect(defaultPushSeenCapacity()).toBe(1000);
    process.env.WHATSAGENT_PUSH_SEEN_CAP = "abc";
    expect(defaultPushSeenCapacity()).toBe(1000);
  } finally {
    if (previous === undefined) delete process.env.WHATSAGENT_PUSH_SEEN_CAP;
    else process.env.WHATSAGENT_PUSH_SEEN_CAP = previous;
  }
});
