import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { listWorkspaces } from "../../src/daemon-db.ts";
import { getSetting } from "../../src/db.ts";
import { listAgentsByWorkspace, listRepos } from "../../src/workspace-decoupling-dao.ts";

import { seedTestWorkspace, tmpDaemonHome, tmpRepoDir, type TestDaemonHome } from "./seed-workspace.ts";

let env: TestDaemonHome;

beforeEach(async () => {
  env = await tmpDaemonHome();
});

afterEach(async () => {
  await env.cleanup();
});

describe("seedTestWorkspace helper", () => {
  test("creates a single empty workspace", async () => {
    const ws = await seedTestWorkspace(env.home, env.daemonDb, { name: "alpha" });
    try {
      const all = listWorkspaces(env.daemonDb);
      expect(all).toHaveLength(1);
      expect(all[0]?.id).toBe(ws.workspaceId);
      expect(all[0]?.name).toBe("alpha");
      expect(all[0]?.status).toBe("active");
      // Slot dir laid down.
      const slotDir = join(env.paths.workspacesDir, ws.workspaceId);
      expect(existsSync(slotDir)).toBe(true);
      expect(existsSync(join(slotDir, "whatsagent.sqlite"))).toBe(true);
      expect(ws.repos).toHaveLength(0);
    } finally {
      ws.workspaceDb.close();
    }
  });

  test("kanbanPrefix surfaces via per-workspace settings", async () => {
    const ws = await seedTestWorkspace(env.home, env.daemonDb, {
      name: "alpha",
      kanbanPrefix: "ZZZ",
    });
    try {
      expect(getSetting(ws.workspaceDb, "kanban.task_id_prefix")).toBe("ZZZ");
    } finally {
      ws.workspaceDb.close();
    }
  });

  test("seeds repos + roles, returns ids + display ids", async () => {
    const repoA = await tmpRepoDir();
    const repoB = await tmpRepoDir();
    // Add a .git marker on A so git_root gets detected.
    await mkdir(join(repoA, ".git"));

    const ws = await seedTestWorkspace(env.home, env.daemonDb, {
      name: "ws-ms",
      repos: [
        { absolutePath: repoA, name: "alpha", roles: [{ name: "dev" }, { name: "ranger" }] },
        { absolutePath: repoB, name: "beta", roles: [{ name: "dev", host: "opencode" }] },
      ],
    });

    try {
      expect(ws.repos.map((r) => r.name).sort()).toEqual(["alpha", "beta"]);
      const allRoles = listAgentsByWorkspace(ws.workspaceDb);
      expect(allRoles.map((r) => r.display_id).sort()).toEqual([
        "alpha:dev", "alpha:ranger", "beta:dev",
      ]);
      // repo A had .git → git_root populated.
      const repoARow = listRepos(ws.workspaceDb).find((r) => r.name === "alpha");
      expect(repoARow?.git_root).toBe(repoA);
      // repo B had no marker → git_root NULL.
      const repoBRow = listRepos(ws.workspaceDb).find((r) => r.name === "beta");
      expect(repoBRow?.git_root).toBeNull();
    } finally {
      ws.workspaceDb.close();
    }
  });

  test("multiple workspaces in same daemon home are isolated", async () => {
    const a = await seedTestWorkspace(env.home, env.daemonDb, { name: "ws-a" });
    const b = await seedTestWorkspace(env.home, env.daemonDb, { name: "ws-b" });
    try {
      expect(listWorkspaces(env.daemonDb).map((w) => w.name).sort()).toEqual(["ws-a", "ws-b"]);
      // Distinct slot dirs.
      expect(a.workspaceId).not.toBe(b.workspaceId);
      expect(existsSync(join(env.paths.workspacesDir, a.workspaceId))).toBe(true);
      expect(existsSync(join(env.paths.workspacesDir, b.workspaceId))).toBe(true);
    } finally {
      a.workspaceDb.close();
      b.workspaceDb.close();
    }
  });
});
