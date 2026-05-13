import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { listChannelMessagesByRoots, postChannelMessage } from "../src/db.ts";
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

function rootIds(rows: Array<{ id: number; parent_message_id: number | null }>): number[] {
  return rows.filter((row) => row.parent_message_id === null).map((row) => row.id);
}

describe("listChannelMessagesByRoots", () => {
  test("hydrates roots for a hot thread whose latest rows are all replies", async () => {
    const ws = await setup();
    try {
      const main = ws.repos[0]!.roles[0]!;
      const agent = ws.repos[1]!.roles[0]!;
      const root = postChannelMessage(ws.workspaceDb, { fromRoleId: main.id, fromSessionId: null, body: "hot root" });
      for (let i = 1; i <= 500; i += 1) {
        postChannelMessage(ws.workspaceDb, { fromRoleId: agent.id, fromSessionId: null, parentMessageId: root.id, body: `reply-${i}` });
      }

      const rows = listChannelMessagesByRoots(ws.workspaceDb, { rootLimit: 20 });
      expect(rows).toHaveLength(501);
      expect(rootIds(rows)).toEqual([root.id]);
      expect(rows[0]!.body).toBe("hot root");
      expect(rows.at(-1)?.body).toBe("reply-500");
    } finally {
      ws.workspaceDb.close();
    }
  });

  test("returns latest roots plus their replies while older roots are absent", async () => {
    const ws = await setup();
    try {
      const main = ws.repos[0]!.roles[0]!;
      const agent = ws.repos[1]!.roles[0]!;
      const roots = [] as Array<{ id: number; body: string }>;
      for (let i = 1; i <= 30; i += 1) {
        const root = postChannelMessage(ws.workspaceDb, { fromRoleId: main.id, fromSessionId: null, body: `root-${i}` });
        roots.push({ id: root.id, body: root.body });
        if (i % 3 === 0) postChannelMessage(ws.workspaceDb, { fromRoleId: agent.id, fromSessionId: null, parentMessageId: root.id, body: `reply-${i}` });
      }

      const rows = listChannelMessagesByRoots(ws.workspaceDb, { rootLimit: 20 });
      const returnedRoots = rootIds(rows);
      expect(returnedRoots).toEqual(roots.slice(10).map((root) => root.id));
      expect(returnedRoots).not.toContain(roots[9]!.id);
      expect(rows.some((row) => row.body === "reply-9")).toBe(false);
      expect(rows.some((row) => row.body === "reply-30")).toBe(true);
    } finally {
      ws.workspaceDb.close();
    }
  });

  test("rootBeforeId returns the next older root page", async () => {
    const ws = await setup();
    try {
      const main = ws.repos[0]!.roles[0]!;
      const agent = ws.repos[1]!.roles[0]!;
      const root1 = postChannelMessage(ws.workspaceDb, { fromRoleId: main.id, fromSessionId: null, body: "root-1" });
      postChannelMessage(ws.workspaceDb, { fromRoleId: agent.id, fromSessionId: null, parentMessageId: root1.id, body: "reply-1" });
      const root2 = postChannelMessage(ws.workspaceDb, { fromRoleId: main.id, fromSessionId: null, body: "root-2" });
      postChannelMessage(ws.workspaceDb, { fromRoleId: agent.id, fromSessionId: null, parentMessageId: root2.id, body: "reply-2" });
      const root3 = postChannelMessage(ws.workspaceDb, { fromRoleId: main.id, fromSessionId: null, body: "root-3" });

      const latest = listChannelMessagesByRoots(ws.workspaceDb, { rootLimit: 2 });
      expect(rootIds(latest)).toEqual([root2.id, root3.id]);
      expect(latest.map((row) => row.body)).toEqual(["root-2", "reply-2", "root-3"]);

      const older = listChannelMessagesByRoots(ws.workspaceDb, { rootLimit: 2, rootBeforeId: root2.id });
      expect(rootIds(older)).toEqual([root1.id]);
      expect(older.every((row) => row.parent_message_id === null || rootIds(older).includes(row.root_message_id!))).toBe(true);
      expect(older.map((row) => row.body)).toEqual(["root-1", "reply-1"]);
    } finally {
      ws.workspaceDb.close();
    }
  });
});
