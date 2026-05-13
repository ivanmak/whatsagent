import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { insertMessage, listMessages } from "../src/db.ts";
import { seedTestWorkspace, tmpDaemonHome, tmpRepoDir, type TestDaemonHome } from "./helpers/seed-workspace.ts";

let env: TestDaemonHome;

beforeEach(async () => {
  env = await tmpDaemonHome();
});

afterEach(async () => {
  await env.cleanup();
});

async function setup() {
  const repoA = await tmpRepoDir();
  const repoB = await tmpRepoDir();
  return seedTestWorkspace(env.home, env.daemonDb, {
    name: "ws",
    repos: [
      { absolutePath: repoA, name: "alpha", roles: [{ name: "main" }] },
      { absolutePath: repoB, name: "beta", roles: [{ name: "agent" }] },
    ],
  });
}

describe("listMessages", () => {
  test("returns the latest limited messages in ascending order by default", async () => {
    const ws = await setup();
    try {
      const main = ws.repos[0]!.roles[0]!;
      const agent = ws.repos[1]!.roles[0]!;
      for (let i = 1; i <= 5; i += 1) {
        insertMessage(ws.workspaceDb, {
          threadId: "alpha-beta",
          fromRoleId: main.id,
          toRoleId: agent.id,
          fromSessionId: null,
          toSessionId: null,
          body: `m${i}`,
          state: "delivered",
        });
      }

      const all = listMessages(ws.workspaceDb, { limit: 10, latest: false });
      const beforeM5 = all.find((row) => row.body === "m5")!.id;

      expect(listMessages(ws.workspaceDb, { limit: 3 }).map((row) => row.body)).toEqual(["m3", "m4", "m5"]);
      expect(listMessages(ws.workspaceDb, { limit: 3, latest: false }).map((row) => row.body)).toEqual(["m1", "m2", "m3"]);
      expect(listMessages(ws.workspaceDb, { beforeId: beforeM5, limit: 2 }).map((row) => row.body)).toEqual(["m3", "m4"]);
    } finally {
      ws.workspaceDb.close();
    }
  });

  test("applies latest ordering inside the roleId-filtered branch", async () => {
    const ws = await setup();
    try {
      const main = ws.repos[0]!.roles[0]!;
      const agent = ws.repos[1]!.roles[0]!;
      const add = (body: string, toRoleId: string) => insertMessage(ws.workspaceDb, {
        threadId: body,
        fromRoleId: main.id,
        toRoleId,
        fromSessionId: null,
        toSessionId: null,
        body,
        state: "delivered",
      });

      add("agent-1", agent.id);
      add("other-1", "human-web");
      add("agent-2", agent.id);
      add("other-2", "human-web");
      add("agent-3", agent.id);
      const agent4 = add("agent-4", agent.id);

      expect(listMessages(ws.workspaceDb, { roleId: agent.id, limit: 2 }).map((row) => row.body)).toEqual(["agent-3", "agent-4"]);
      expect(listMessages(ws.workspaceDb, { roleId: agent.id, limit: 2, latest: false }).map((row) => row.body)).toEqual(["agent-1", "agent-2"]);
      expect(listMessages(ws.workspaceDb, { roleId: agent.id, beforeId: agent4.id, limit: 2 }).map((row) => row.body)).toEqual(["agent-2", "agent-3"]);
    } finally {
      ws.workspaceDb.close();
    }
  });
});
