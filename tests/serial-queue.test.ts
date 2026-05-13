import { describe, expect, test } from "bun:test";

import { enqueueSerial, type SerialQueueMap } from "../src/web/client/serial-queue.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("enqueueSerial", () => {
  test("runs jobs for the same key one at a time in enqueue order", async () => {
    const queue: SerialQueueMap = Object.create(null);
    const started: string[] = [];
    const completed: string[] = [];
    let active = 0;
    let maxActive = 0;
    const submit = (value: string, ms: number) => enqueueSerial(queue, "role", async () => {
      started.push(value);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(ms);
      active -= 1;
      completed.push(value);
    });

    await Promise.all([
      submit("a", 60),
      submit("b", 20),
      submit("c", 0),
    ]);

    expect(started).toEqual(["a", "b", "c"]);
    expect(completed).toEqual(["a", "b", "c"]);
    expect(maxActive).toBe(1);
    expect(queue.role).toBeUndefined();
  });

  test("continues after a failed job and keeps different keys independent", async () => {
    const queue: SerialQueueMap = Object.create(null);
    const events: string[] = [];
    let active = 0;
    let maxActive = 0;
    const tracked = (key: string, value: string, ms: number, fail = false) => enqueueSerial(queue, key, async () => {
      events.push(value + ":start");
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(ms);
      active -= 1;
      events.push(value + ":end");
      if (fail) throw new Error("boom");
    });

    await Promise.all([
      tracked("same", "a", 20, true),
      tracked("same", "b", 0),
      tracked("other", "x", 0),
    ]);

    expect(events).toEqual(["a:start", "x:start", "x:end", "a:end", "b:start", "b:end"]);
    expect(maxActive).toBe(2);
    expect(queue.same).toBeUndefined();
    expect(queue.other).toBeUndefined();
  });
});
