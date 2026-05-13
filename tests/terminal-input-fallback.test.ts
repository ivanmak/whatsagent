import { expect, test } from "bun:test";

import { enqueueTerminalInputFallback } from "../src/web/client/terminal-input-fallback.ts";
import type { SerialQueueMap } from "../src/web/client/serial-queue.ts";

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for condition");
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}

test("WA-227 HTTP fallback drops queued input after workspace generation changes", async () => {
  const queue: SerialQueueMap = Object.create(null);
  let workspaceGeneration = 1;
  const first = deferred();
  const calls: Array<{ workspaceId: string; roleId: string; data: string }> = [];
  const rejected: unknown[] = [];

  const p1 = enqueueTerminalInputFallback(queue, {
    activeRole: () => "repo:worker",
    currentWorkspaceId: () => "ws-a",
    workspaceGeneration: () => workspaceGeneration,
    runnerFor: () => ({ session_id: "session-a" }),
    roleByAddress: () => ({ id: "role-a" }),
    postInput: async (workspaceId, roleId, data) => {
      calls.push({ workspaceId, roleId, data });
      if (data === "a") await first.promise;
      return new Response("{}", { status: 200 });
    },
    onRejected: (_role, body) => rejected.push(body),
    newline: "\n",
  }, "a", true);
  const p2 = enqueueTerminalInputFallback(queue, {
    activeRole: () => "repo:worker",
    currentWorkspaceId: () => "ws-a",
    workspaceGeneration: () => workspaceGeneration,
    runnerFor: () => ({ session_id: "session-a" }),
    roleByAddress: () => ({ id: "role-a" }),
    postInput: async (workspaceId, roleId, data) => {
      calls.push({ workspaceId, roleId, data });
      return new Response("{}", { status: 200 });
    },
    onRejected: (_role, body) => rejected.push(body),
    newline: "\n",
  }, "b", true);
  const p3 = enqueueTerminalInputFallback(queue, {
    activeRole: () => "repo:worker",
    currentWorkspaceId: () => "ws-a",
    workspaceGeneration: () => workspaceGeneration,
    runnerFor: () => ({ session_id: "session-a" }),
    roleByAddress: () => ({ id: "role-a" }),
    postInput: async (workspaceId, roleId, data) => {
      calls.push({ workspaceId, roleId, data });
      return new Response("{}", { status: 200 });
    },
    onRejected: (_role, body) => rejected.push(body),
    newline: "\n",
  }, "c", true);

  await waitUntil(() => calls.length === 1);
  workspaceGeneration = 2;
  first.resolve();
  await Promise.all([p1, p2, p3]);

  expect(calls).toEqual([{ workspaceId: "ws-a", roleId: "role-a", data: "a" }]);
  expect(rejected).toEqual([]);
});

test("WA-227 HTTP fallback drops queued input after runner session changes and lets the new session queue proceed", async () => {
  const queue: SerialQueueMap = Object.create(null);
  let sessionId = "session-a";
  const first = deferred();
  const calls: string[] = [];

  const deps = {
    activeRole: () => "repo:worker",
    currentWorkspaceId: () => "ws-a",
    workspaceGeneration: () => 1,
    runnerFor: () => ({ session_id: sessionId }),
    roleByAddress: () => ({ id: "role-a" }),
    postInput: async (_workspaceId: string, _roleId: string, data: string) => {
      calls.push(data);
      if (data === "a") await first.promise;
      return new Response("{}", { status: 200 });
    },
    onRejected: () => undefined,
    newline: "\n",
  };

  const p1 = enqueueTerminalInputFallback(queue, deps, "a", true);
  const p2 = enqueueTerminalInputFallback(queue, deps, "b", true);
  const p3 = enqueueTerminalInputFallback(queue, deps, "c", true);

  await waitUntil(() => calls.length === 1);
  sessionId = "session-b";
  first.resolve();
  await Promise.all([p1, p2, p3]);
  await enqueueTerminalInputFallback(queue, deps, "d", true);

  expect(calls).toEqual(["a", "d"]);
});
