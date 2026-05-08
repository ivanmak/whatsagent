/**
 * Compat coverage for the role-shape shim in `src/db.ts` (`listAgents`,
 * `getRoleByName`, `getMainAgent`, `roleSelectSql`).
 *
 * Workspace decoupling moved `path` / `git_root` / `missing_at` off `roles`
 * onto `workspace_repos`. The shim projects the new schema into the legacy
 * `AgentRow` shape so the snapshot/runner-reconcile/messaging paths keep
 * working without an in-place rewrite. EP-DEC-2 (WA-066) replaces these
 * callers with `RoleWithDisplayRow`-based queries.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";

import { listAgents, getRoleByName } from "../src/db.ts";
import { seedTestWorkspace, tmpDaemonHome, tmpRepoDir, type TestDaemonHome } from "./helpers/seed-workspace.ts";

let env: TestDaemonHome;

beforeEach(async () => {
  env = await tmpDaemonHome();
});

afterEach(async () => {
  await env.cleanup();
});

describe("legacy roles compat shim", () => {
  test("listAgents returns AgentRow shape sourced from workspace_repos", async () => {
    const repoDir = await tmpRepoDir();
    const ws = await seedTestWorkspace(env.home, env.daemonDb, {
      name: "alpha",
      repos: [
        { absolutePath: repoDir, name: "alpha", roles: [{ name: "dev" }, { name: "ranger" }] },
      ],
    });
    try {
      const rows = listAgents(ws.workspaceDb);
      expect(rows.map((r) => r.name).sort()).toEqual(["dev", "ranger"]);
      // path now points at the repo's absolute path (legacy callers used
      // `${ws.path}/${role.path}` for cwd; shim makes that effectively
      // become the repo path).
      for (const row of rows) {
        expect(row.path).toBe(repoDir);
        expect(row.git_root).toBeNull(); // tmp repo dir has no .git
        expect(row.missing_at).toBeNull();
        expect(row.last_discovered_at).toBeNull();
        expect(row.repo_id).toBeTruthy();
        expect(row.repo_name).toBe("alpha");
        expect(row.display_id).toBe(`alpha:${row.name}`);
      }
    } finally {
      ws.workspaceDb.close();
    }
  });

  test("getRoleByName returns first match across repos for ambiguous names", async () => {
    const repoA = await tmpRepoDir();
    const repoB = await tmpRepoDir();
    const ws = await seedTestWorkspace(env.home, env.daemonDb, {
      name: "ws",
      repos: [
        { absolutePath: repoA, name: "alpha", roles: [{ name: "dev" }] },
        { absolutePath: repoB, name: "beta",  roles: [{ name: "dev" }] },
      ],
    });
    try {
      const found = getRoleByName(ws.workspaceDb, "dev");
      expect(found).not.toBeNull();
      // Sorted by repo name → alpha wins.
      expect(found!.repo_name).toBe("alpha");
      expect(found!.display_id).toBe("alpha:dev");
    } finally {
      ws.workspaceDb.close();
    }
  });

  test("missing_at flows from the repo onto every role under it", async () => {
    const repoDir = await tmpRepoDir();
    const ws = await seedTestWorkspace(env.home, env.daemonDb, {
      name: "ws",
      repos: [{ absolutePath: repoDir, name: "alpha", roles: [{ name: "dev" }] }],
    });
    try {
      // Mark repo missing → listAgents should reflect that on the role row.
      const repoId = ws.repos[0]!.id;
      const ts = new Date().toISOString();
      ws.workspaceDb.run("UPDATE workspace_repos SET missing_at = ? WHERE id = ?", [ts, repoId]);
      const rows = listAgents(ws.workspaceDb);
      expect(rows[0]?.missing_at).toBe(ts);
    } finally {
      ws.workspaceDb.close();
      // sanity: temp dir intentionally still exists; cleanup handles it
      expect(existsSync(repoDir)).toBe(true);
    }
  });
});
