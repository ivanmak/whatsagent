/**
 * HTTP coverage for the repo + scan-dir endpoints landed by WA-064 + WA-065.
 * Boots a real daemon, seeds an empty workspace, then exercises:
 *   - GET / POST / PATCH / DELETE /api/v1/workspaces/:id/repos[/{:repoId}]
 *   - POST /api/v1/workspaces/:id/repos/:repoId/refresh
 *   - GET / POST / PATCH / DELETE /api/v1/workspaces/:id/scan-dirs[/{:scanId}]
 *   - POST /api/v1/workspaces/:id/scan-dirs/:scanId/scan
 *
 * Cascade-stop runners on repo delete is exercised in a follow-up suite
 * once the launch flow is rebased onto the new role-by-id surface (WA-066).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setCurrentWorkspaceId, getWorkspace } from "../src/daemon-db.ts";
import { createWorkspace } from "../src/config.ts";
import { activeWorkspacePaths } from "../src/paths.ts";
import { startDaemon, type StartedDaemon } from "../src/server/daemon.ts";
import { loadWorkspaceState } from "../src/server/workspace-state.ts";
import { insertScanDir } from "../src/workspace-decoupling-dao.ts";
import { seedTestWorkspace, tmpDaemonHome } from "./helpers/seed-workspace.ts";
import { authedFetchHeaders, seedAuthSessionCookieInDb } from "./helpers/auth.ts";

let daemonHome: string;
let daemon: StartedDaemon | null = null;
let authCookie = "";
const nativeFetch = globalThis.fetch.bind(globalThis);

async function startAuthedDaemon(): Promise<StartedDaemon> {
  const started = await startDaemon({ port: 0, consoleLogs: false, daemonHome });
  authCookie = await seedAuthSessionCookieInDb(started.state.daemonDb);
  return started;
}

beforeEach(async () => {
  // EP-DEC-3 (WA-070) dropped fleet-root TOML reading; daemon-home is the
  // only on-disk surface boot needs.
  daemonHome = await mkdtemp(join(tmpdir(), "wa-home-"));
  globalThis.fetch = ((input, init = {}) => {
    const headers = authedFetchHeaders(init.headers, authCookie, init.method);
    return nativeFetch(input, { ...init, headers });
  }) as typeof fetch;
});

afterEach(async () => {
  if (daemon) {
    daemon.stop();
    daemon = null;
  }
  await rm(daemonHome, { recursive: true, force: true });
  authCookie = "";
  globalThis.fetch = nativeFetch;
});

async function startWithEmptyWorkspace(): Promise<{ wsId: string; base: string }> {
  daemon = await startAuthedDaemon();
  const row = await createWorkspace(daemon.state.daemonDb, daemon.state.daemonHome, { name: "ws" });
  daemon.state.workspaces.set(row.id, loadWorkspaceState(daemon.state.daemonHome, getWorkspace(daemon.state.daemonDb, row.id)!));
  setCurrentWorkspaceId(daemon.state.daemonDb, row.id);
  daemon.state.currentWorkspaceId = row.id;
  return { wsId: row.id, base: `${daemon!.url}/api/v1/workspaces/${row.id}` };
}

describe("repo HTTP endpoints (WA-064)", () => {
  test("POST /repos — add, list, refresh, rename, delete (without runner)", async () => {
    const { base } = await startWithEmptyWorkspace();
    const repoDir = await mkdtemp(join(tmpdir(), "wa-repo-"));
    try {
      // Initially empty.
      const list0 = await fetch(`${base}/repos`).then((r) => r.json()) as { repos: unknown[] };
      expect(list0.repos).toHaveLength(0);

      // Add.
      const addRes = await fetch(`${base}/repos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: repoDir, name: "alpha" }),
      });
      expect(addRes.status).toBe(200);
      const addBody = await addRes.json() as { ok: boolean; repo: { id: string; name: string; absolutePath: string; gitRoot: string | null; missingAt: string | null; roleCount: number } };
      expect(addBody.repo.name).toBe("alpha");
      expect(addBody.repo.gitRoot).toBeNull();
      expect(addBody.repo.missingAt).toBeNull();
      expect(addBody.repo.roleCount).toBe(0);

      // Path collision.
      const collideRes = await fetch(`${base}/repos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: repoDir, name: "beta" }),
      });
      expect(collideRes.status).toBe(409);

      // Missing path.
      const missingRes = await fetch(`${base}/repos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: join(tmpdir(), "wa-no-such-dir-12345") }),
      });
      expect(missingRes.status).toBe(400);

      // Refresh after creating .git on disk → gitRoot populated.
      await mkdir(join(repoDir, ".git"));
      const refreshRes = await fetch(`${base}/repos/${addBody.repo.id}/refresh`, { method: "POST" });
      expect(refreshRes.status).toBe(200);
      const refreshBody = await refreshRes.json() as { repo: { gitRoot: string | null } };
      expect(refreshBody.repo.gitRoot).toBe(repoDir);

      // Rename.
      const renameRes = await fetch(`${base}/repos/${addBody.repo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "renamed" }),
      });
      expect(renameRes.status).toBe(200);
      const renameBody = await renameRes.json() as { repo: { name: string } };
      expect(renameBody.repo.name).toBe("renamed");

      // Delete.
      const deleteRes = await fetch(`${base}/repos/${addBody.repo.id}`, { method: "DELETE" });
      expect(deleteRes.status).toBe(200);
      const list1 = await fetch(`${base}/repos`).then((r) => r.json()) as { repos: unknown[] };
      expect(list1.repos).toHaveLength(0);
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });
});

describe("role-by-id HTTP endpoints (WA-066)", () => {
  test("role lifecycle: add, list, rename, host change, delete", async () => {
    const { base } = await startWithEmptyWorkspace();
    const repoDir = await mkdtemp(join(tmpdir(), "wa-r-"));
    try {
      const repoRes = await fetch(`${base}/repos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: repoDir, name: "alpha" }),
      });
      const repo = (await repoRes.json() as { repo: { id: string } }).repo;

      // Add.
      const addRes = await fetch(`${base}/roles-by-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: repo.id, name: "main", host: "claude-code" }),
      });
      expect(addRes.status).toBe(200);
      const addBody = await addRes.json() as { role: { id: string; displayId: string; defaultHostType: string | null; hostDefault: string | null } };
      expect(addBody.role.displayId).toBe("alpha:main");
      expect(addBody.role.defaultHostType).toBe("claude-code");

      // Reject duplicate name within same repo.
      const dupRes = await fetch(`${base}/roles-by-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: repo.id, name: "main" }),
      });
      expect(dupRes.status).toBe(409);

      // Reject embedded ':' in name.
      const colonRes = await fetch(`${base}/roles-by-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: repo.id, name: "weird:name" }),
      });
      expect(colonRes.status).toBe(400);

      // List → 1 role.
      const listRes = await fetch(`${base}/roles-by-id`).then((r) => r.json()) as { roles: Array<{ displayId: string }> };
      expect(listRes.roles.map((r) => r.displayId)).toEqual(["alpha:main"]);

      // Rename.
      const renameRes = await fetch(`${base}/roles-by-id/${addBody.role.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "boss" }),
      });
      expect(renameRes.status).toBe(200);
      const renameBody = await renameRes.json() as { role: { displayId: string } };
      expect(renameBody.role.displayId).toBe("alpha:boss");

      // Update host to opencode.
      const hostRes = await fetch(`${base}/roles-by-id/${addBody.role.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: "opencode" }),
      });
      expect(hostRes.status).toBe(200);
      const hostBody = await hostRes.json() as { role: { defaultHostType: string | null } };
      expect(hostBody.role.defaultHostType).toBe("opencode");

      // Clear default host via { host: null } (Edit Agent dialog
      // 'Use daemon default' option) — EP-DEC-FIX WA-087 follow-up.
      const clearRes = await fetch(`${base}/roles-by-id/${addBody.role.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: null }),
      });
      expect(clearRes.status).toBe(200);
      const clearBody = await clearRes.json() as { role: { defaultHostType: string | null } };
      expect(clearBody.role.defaultHostType).toBe(null);

      // Delete (no runner attached).
      const deleteRes = await fetch(`${base}/roles-by-id/${addBody.role.id}`, { method: "DELETE" });
      expect(deleteRes.status).toBe(200);
      const list2 = await fetch(`${base}/roles-by-id`).then((r) => r.json()) as { roles: unknown[] };
      expect(list2.roles).toHaveLength(0);
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  test("legacy POST /roles still returns 410 (no silent dual-path)", async () => {
    const { base } = await startWithEmptyWorkspace();
    const res = await fetch(`${base}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ghost", path: ".", defaultHost: "claude-code" }),
    });
    expect(res.status).toBe(410);
  });

  test("DELETE /roles-by-id/:id cascades runner stop (EP-DEC-FIX B2)", async () => {
    const { wsId, base } = await startWithEmptyWorkspace();
    const repoDir = await mkdtemp(join(tmpdir(), "wa-r-"));
    try {
      const repoRes = await fetch(`${base}/repos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: repoDir, name: "alpha" }),
      });
      const repo = (await repoRes.json() as { repo: { id: string } }).repo;
      const addRes = await fetch(`${base}/roles-by-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: repo.id, name: "main" }),
      });
      const role = (await addRes.json() as { role: { id: string; name: string } }).role;

      // Stamp a fake runner.json keyed on the role name. `stopRunner` will
      // try `process.kill(runner_pid, "SIGTERM")` which is a no-op for our
      // own pid, then unlink the metadata file. After DELETE the file must
      // be gone and the role row must be removed.
      const wsPaths = activeWorkspacePaths(daemonHome, wsId);
      const metadataPath = join(wsPaths.runDir, `${role.name}.runner.json`);
      await writeFile(metadataPath, JSON.stringify({
        fleet_id: "fleet-test",
        role: role.name,
        // EP-DEC-RUN WA-003: registry requires display_id; pre-cutover
        // stamps without it are ignored (intentional).
        display_id: `alpha:${role.name}`,
        session_id: "session-cascade",
        host_type: "claude-code",
        runner_pid: process.pid,
        child_pid: process.pid,
        cwd: repoDir,
        socket_path: join(wsPaths.runDir, `${role.name}.sock`),
        started_at: new Date().toISOString(),
      }), "utf8");

      const delRes = await fetch(`${base}/roles-by-id/${role.id}`, { method: "DELETE" });
      expect(delRes.status).toBe(200);

      // Role row gone.
      const list = await fetch(`${base}/roles-by-id`).then((r) => r.json()) as { roles: unknown[] };
      expect(list.roles).toHaveLength(0);

      // Runner metadata file unlinked by cascade-stop.
      const stillThere = await readFile(metadataPath, "utf8").then(() => true).catch(() => false);
      expect(stillThere).toBe(false);
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  test("PATCH /roles-by-id/:id refuses rename while live runner exists (EP-DEC-RUN WA-002)", async () => {
    const { wsId, base } = await startWithEmptyWorkspace();
    const repoDir = await mkdtemp(join(tmpdir(), "wa-r-"));
    try {
      const repoRes = await fetch(`${base}/repos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: repoDir, name: "alpha" }),
      });
      const repo = (await repoRes.json() as { repo: { id: string } }).repo;
      const addRes = await fetch(`${base}/roles-by-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: repo.id, name: "main" }),
      });
      const role = (await addRes.json() as { role: { id: string; name: string } }).role;

      // Stamp a fake reachable runner.json so discoverAndReconcileRunners
      // finds an "active" runner for this role's bare name. Use process.pid
      // so the kill check (if any) is a no-op against ourselves.
      const wsPaths = activeWorkspacePaths(daemonHome, wsId);
      const metadataPath = join(wsPaths.runDir, `${role.name}.runner.json`);
      await writeFile(metadataPath, JSON.stringify({
        fleet_id: "fleet-test",
        role: role.name,
        display_id: `alpha:${role.name}`,
        session_id: "session-rename-block",
        host_type: "claude-code",
        runner_pid: process.pid,
        child_pid: process.pid,
        cwd: repoDir,
        socket_path: join(wsPaths.runDir, `${role.name}.sock`),
        started_at: new Date().toISOString(),
      }), "utf8");

      // Rename should 409 because the live runner would be orphaned by the
      // displayId path move.
      const renameRes = await fetch(`${base}/roles-by-id/${role.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "lead" }),
      });
      expect(renameRes.status).toBe(409);
      const body = await renameRes.json() as { error: string };
      expect(body.error).toContain("live runner");

      // Sanity: the role row is unchanged.
      const list = await fetch(`${base}/roles-by-id`).then((r) => r.json()) as { roles: Array<{ name: string }> };
      expect(list.roles.find((r) => r.name === "main")).toBeDefined();
      expect(list.roles.find((r) => r.name === "lead")).toBeUndefined();

      // Removing the runner stamp clears the block; rename now succeeds.
      await rm(metadataPath);
      const renameRes2 = await fetch(`${base}/roles-by-id/${role.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "lead" }),
      });
      expect(renameRes2.status).toBe(200);
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  test("PATCH rename does NOT block on stale (unreachable) metadata (EP-DEC-RUN WA-002, advisor msg #10)", async () => {
    const { wsId, base } = await startWithEmptyWorkspace();
    const repoDir = await mkdtemp(join(tmpdir(), "wa-r-"));
    try {
      const repoRes = await fetch(`${base}/repos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: repoDir, name: "alpha" }),
      });
      const repo = (await repoRes.json() as { repo: { id: string } }).repo;
      const addRes = await fetch(`${base}/roles-by-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: repo.id, name: "main" }),
      });
      const role = (await addRes.json() as { role: { id: string; name: string } }).role;

      // Stamp a stale runner.json: runner_pid pointing at a definitely-dead
      // pid (max int32). discoverAndReconcileRunners will mark it
      // unreachable; the cascade-stop guard filters on `reachable` so the
      // rename should succeed without manual cleanup.
      const wsPaths = activeWorkspacePaths(daemonHome, wsId);
      const metadataPath = join(wsPaths.runDir, `${role.name}.runner.json`);
      await writeFile(metadataPath, JSON.stringify({
        fleet_id: "fleet-test",
        role: role.name,
        display_id: `alpha:${role.name}`,
        session_id: "session-stale",
        host_type: "claude-code",
        runner_pid: 0x7fffffff,
        cwd: repoDir,
        socket_path: join(wsPaths.runDir, `${role.name}.sock`),
        started_at: new Date().toISOString(),
      }), "utf8");

      const renameRes = await fetch(`${base}/roles-by-id/${role.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "lead" }),
      });
      expect(renameRes.status).toBe(200);
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  test("PATCH /repos/:id refuses rename while a role under the repo has a live runner (EP-DEC-RUN WA-003)", async () => {
    const { wsId, base } = await startWithEmptyWorkspace();
    const repoDir = await mkdtemp(join(tmpdir(), "wa-r-"));
    try {
      const repoRes = await fetch(`${base}/repos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: repoDir, name: "alpha" }),
      });
      const repo = (await repoRes.json() as { repo: { id: string } }).repo;
      const addRes = await fetch(`${base}/roles-by-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: repo.id, name: "main" }),
      });
      const role = (await addRes.json() as { role: { id: string; name: string } }).role;

      const wsPaths = activeWorkspacePaths(daemonHome, wsId);
      const metadataPath = join(wsPaths.runDir, `alpha__${role.name}.runner.json`);
      await writeFile(metadataPath, JSON.stringify({
        fleet_id: "fleet-test",
        role: role.name,
        display_id: `alpha:${role.name}`,
        session_id: "session-repo-rename-block",
        host_type: "claude-code",
        runner_pid: process.pid,
        child_pid: process.pid,
        cwd: repoDir,
        socket_path: join(wsPaths.runDir, `alpha__${role.name}.sock`),
        started_at: new Date().toISOString(),
      }), "utf8");

      // Repo rename moves every child role's display_id → moves the
      // metadata FS path → orphans the runner. Refuse with 409.
      const renameRes = await fetch(`${base}/repos/${repo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "alpha-renamed" }),
      });
      expect(renameRes.status).toBe(409);
      const body = await renameRes.json() as { error: string };
      expect(body.error).toContain("live runner");

      // Sanity: repo still has original name.
      const list = await fetch(`${base}/repos`).then((r) => r.json()) as { repos: Array<{ name: string }> };
      expect(list.repos.find((r) => r.name === "alpha")).toBeDefined();

      // Removing the runner clears the block.
      await rm(metadataPath);
      const renameRes2 = await fetch(`${base}/repos/${repo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "alpha-renamed" }),
      });
      expect(renameRes2.status).toBe(200);
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  test("cross-repo same-bare-name owner-match isolation (EP-DEC-RUN WA-003 advisor msg #14)", async () => {
    // Reproduces the four bare-name owner-match collisions that advisor
    // msg #14 flagged. Until WA-006 drops the workspace-wide name guard,
    // we cannot create two `main` roles via the API; instead we create
    // ONE real role (`alpha:main`) and stamp a SYNTHETIC live runner that
    // claims `display_id: "beta:main"` + `role: "main"`. With bare-name
    // owner-match, every alpha:main op would route through the synthetic
    // beta:main runner; with display_id matching they must not.
    const { wsId, base } = await startWithEmptyWorkspace();
    const alphaDir = await mkdtemp(join(tmpdir(), "wa-r-alpha-"));
    try {
      const alphaRepo = (await (await fetch(`${base}/repos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: alphaDir, name: "alpha" }),
      })).json() as { repo: { id: string } }).repo;

      const alphaRole = (await (await fetch(`${base}/roles-by-id`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: alphaRepo.id, name: "main" }),
      })).json() as { role: { id: string; name: string } }).role;

      const wsPaths = activeWorkspacePaths(daemonHome, wsId);
      const synthMetadataPath = join(wsPaths.runDir, "beta__main.runner.json");
      await writeFile(synthMetadataPath, JSON.stringify({
        fleet_id: "fleet-test",
        role: "main",                 // bare name COLLIDES with alpha:main
        display_id: "beta:main",      // unique displayId — must route here
        session_id: "session-synth-beta",
        host_type: "claude-code",
        runner_pid: process.pid,
        child_pid: process.pid,
        cwd: alphaDir,
        socket_path: join(wsPaths.runDir, "beta__main.sock"),
        started_at: new Date().toISOString(),
      }), "utf8");

      // (a) Rename `alpha` repo: must succeed; the synthetic beta:main
      // runner is reachable but its display_id differs.
      const renameRepoRes = await fetch(`${base}/repos/${alphaRepo.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "alpha-renamed" }),
      });
      expect(renameRepoRes.status).toBe(200);

      // (c) Rename alpha:main role: must succeed.
      const renameRoleRes = await fetch(`${base}/roles-by-id/${alphaRole.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "lead" }),
      });
      expect(renameRoleRes.status).toBe(200);

      // (d) Delete the (now `alpha-renamed:lead`) role: synthetic
      // beta:main metadata must remain on disk.
      const delRoleRes = await fetch(`${base}/roles-by-id/${alphaRole.id}`, { method: "DELETE" });
      expect(delRoleRes.status).toBe(200);
      const stillAfterRoleDelete = await readFile(synthMetadataPath, "utf8").then(() => true).catch(() => false);
      expect(stillAfterRoleDelete).toBe(true);

      // (b) Delete the (now empty) repo: cascade must NOT touch the
      // synthetic beta:main metadata even though it claims the same
      // bare role name `main`.
      const delRepoRes = await fetch(`${base}/repos/${alphaRepo.id}`, { method: "DELETE" });
      expect(delRepoRes.status).toBe(200);
      const stillAfterRepoDelete = await readFile(synthMetadataPath, "utf8").then(() => true).catch(() => false);
      expect(stillAfterRepoDelete).toBe(true);
    } finally {
      await rm(alphaDir, { recursive: true, force: true });
    }
  });
});

describe("EP-DEC-RUN WA-004: /roles-by-id/:idOrDisplay/<action> routes", () => {
  test("stop via UUID and via percent-encoded displayId both succeed", async () => {
    const { wsId, base } = await startWithEmptyWorkspace();
    const repoDir = await mkdtemp(join(tmpdir(), "wa-r-"));
    try {
      const repoRes = await fetch(`${base}/repos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: repoDir, name: "alpha" }),
      });
      const repo = (await repoRes.json() as { repo: { id: string } }).repo;
      const addRes = await fetch(`${base}/roles-by-id`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: repo.id, name: "main" }),
      });
      const role = (await addRes.json() as { role: { id: string; displayId: string; name: string } }).role;

      // Stamp a runner so /stop has something to noop against (with no
      // metadata it returns ok:true action:noop; with metadata it goes
      // through the cascade-stop path. Either is fine for the resolver
      // smoke test, but stamping exercises the display_id owner-match.).
      const wsPaths = activeWorkspacePaths(daemonHome, wsId);
      const metadataPath = join(wsPaths.runDir, "alpha__main.runner.json");
      await writeFile(metadataPath, JSON.stringify({
        fleet_id: "fleet-test",
        role: role.name,
        display_id: role.displayId,
        session_id: "session-stop-by-id",
        host_type: "claude-code",
        runner_pid: process.pid,
        cwd: repoDir,
        socket_path: join(wsPaths.runDir, "alpha__main.sock"),
        started_at: new Date().toISOString(),
      }), "utf8");

      // (a) UUID address (no encoding needed).
      const stopByIdRes = await fetch(`${base}/roles-by-id/${role.id}/stop`, { method: "POST" });
      expect(stopByIdRes.status).toBe(200);

      // Re-stamp metadata for the second call (the first stopped + unlinked).
      await writeFile(metadataPath, JSON.stringify({
        fleet_id: "fleet-test",
        role: role.name,
        display_id: role.displayId,
        session_id: "session-stop-by-display",
        host_type: "claude-code",
        runner_pid: process.pid,
        cwd: repoDir,
        socket_path: join(wsPaths.runDir, "alpha__main.sock"),
        started_at: new Date().toISOString(),
      }), "utf8");

      // (b) Percent-encoded displayId (`:` → `%3A`). Resolver must decode.
      const encodedDisplayId = encodeURIComponent(role.displayId);
      expect(encodedDisplayId).toContain("%3A");
      const stopByDisplayRes = await fetch(`${base}/roles-by-id/${encodedDisplayId}/stop`, { method: "POST" });
      expect(stopByDisplayRes.status).toBe(200);
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  test("404 on unknown UUID; 404 on unknown displayId; 400 on bare-string non-UUID", async () => {
    const { base } = await startWithEmptyWorkspace();
    const repoDir = await mkdtemp(join(tmpdir(), "wa-r-"));
    try {
      await fetch(`${base}/repos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: repoDir, name: "alpha" }),
      });
      // Unknown UUID-shaped string → 404.
      const unknownUuid = await fetch(`${base}/roles-by-id/00000000-0000-0000-0000-000000000000/stop`, { method: "POST" });
      expect(unknownUuid.status).toBe(404);

      // Unknown displayId → 404.
      const unknownDisplay = await fetch(`${base}/roles-by-id/${encodeURIComponent("alpha:nope")}/stop`, { method: "POST" });
      expect(unknownDisplay.status).toBe(404);

      // Bare name (no `:`, not a UUID match) → 404 (advisor msg #16: no
      // silent fallback — this is "not found", not a quiet bare-name
      // lookup).
      const bareName = await fetch(`${base}/roles-by-id/main/stop`, { method: "POST" });
      expect(bareName.status).toBe(404);
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  test("PUT /roles-by-id/:id/default-runtime updates by role.id, not bare name (advisor msg #18)", async () => {
    // Until WA-006 drops the workspace-wide name guard we cannot create
    // two `main` roles via the API. Insert the second role row directly
    // into the workspace DB so we can exercise the cross-repo collision.
    const { wsId, base } = await startWithEmptyWorkspace();
    const alphaDir = await mkdtemp(join(tmpdir(), "wa-r-alpha-"));
    const betaDir = await mkdtemp(join(tmpdir(), "wa-r-beta-"));
    try {
      const alphaRepo = (await (await fetch(`${base}/repos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: alphaDir, name: "alpha" }),
      })).json() as { repo: { id: string } }).repo;
      const betaRepo = (await (await fetch(`${base}/repos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: betaDir, name: "beta" }),
      })).json() as { repo: { id: string } }).repo;

      const alphaRole = (await (await fetch(`${base}/roles-by-id`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: alphaRepo.id, name: "main" }),
      })).json() as { role: { id: string; defaultHostType: string | null } }).role;

      // Direct DB insert for beta:main (workspace-wide guard at
      // daemon.ts blocks the API path until WA-006).
      const ws = await (await fetch(`${base}/repos`)).headers; // touch
      void ws;
      const wsState = daemon!.state.workspaces.get(wsId)!;
      const betaRoleId = "00000000-0000-0000-0000-000000000beta";
      wsState.db.run(
        "INSERT INTO agents (id, repo_id, name, host_default, default_host_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [betaRoleId, betaRepo.id, "main", "claude-code", null, new Date().toISOString(), new Date().toISOString()],
      );

      // Flip alpha:main to opencode via id-keyed default-runtime.
      const flipRes = await fetch(`${base}/roles-by-id/${alphaRole.id}/default-runtime`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: "opencode" }),
      });
      expect(flipRes.status).toBe(200);
      const flipBody = await flipRes.json() as { role: { id: string; host_default: string | null } };
      expect(flipBody.role.id).toBe(alphaRole.id);
      expect(flipBody.role.host_default).toBe("opencode");

      // beta:main row must NOT have been touched. Read directly from db.
      const betaRow = wsState.db.query<{ default_host_type: string | null }, [string]>(
        "SELECT default_host_type FROM agents WHERE id = ?",
      ).get(betaRoleId);
      expect(betaRow?.default_host_type).toBeNull();
    } finally {
      await rm(alphaDir, { recursive: true, force: true });
      await rm(betaDir, { recursive: true, force: true });
    }
  });

  test("legacy /roles/:name/<action> family returns 410 (EP-DEC-RUN WA-006)", async () => {
    const { base } = await startWithEmptyWorkspace();
    const repoDir = await mkdtemp(join(tmpdir(), "wa-r-"));
    try {
      const repoRes = await fetch(`${base}/repos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: repoDir, name: "alpha" }),
      });
      const repo = (await repoRes.json() as { repo: { id: string } }).repo;
      await fetch(`${base}/roles-by-id`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: repo.id, name: "main" }),
      });

      for (const action of ["launch", "stop", "output", "input", "resize", "default-runtime"]) {
        const method = action === "default-runtime" ? "PUT" : (action === "output" ? "GET" : "POST");
        const res = await fetch(`${base}/roles/main/${action}`, { method });
        expect(res.status).toBe(410);
        const body = await res.json() as { error: string };
        expect(body.error).toContain("EP-DEC-RUN WA-006");
        expect(body.error).toContain("/roles-by-id/");
      }
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });
});

describe("round-5 fixes: address resolution + uniqueness + dir-check", () => {
  test("send_message accepts repo:role display id", async () => {
    const { base, wsId } = await startWithEmptyWorkspace();
    void wsId;
    const repoDir = await mkdtemp(join(tmpdir(), "wa-r-"));
    try {
      const repoRes = await fetch(`${base}/repos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: repoDir, name: "alpha" }),
      });
      const repo = (await repoRes.json() as { repo: { id: string } }).repo;
      await fetch(`${base}/roles-by-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: repo.id, name: "main" }),
      });
      // Web → agent direct send via the new display id format.
      const sendRes = await fetch(`${base}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toRole: "alpha:main", body: "hello via display id" }),
      });
      // Either 200 (queued) or 409 (offline) is fine — the assertion is
      // that we did NOT get 404 "Unknown role: alpha:main".
      expect(sendRes.status).not.toBe(404);
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  test("EP-DEC-RUN WA-006: cross-repo same role name now succeeds", async () => {
    // The pre-WA-006 workspace-wide guard rejected this with 409. With
    // runner addressing flipped onto display_id (WA-002..005) the
    // collision risk is gone; per-repo UNIQUE(repo_id, name) remains.
    const { base } = await startWithEmptyWorkspace();
    const repoA = await mkdtemp(join(tmpdir(), "wa-A-"));
    const repoB = await mkdtemp(join(tmpdir(), "wa-B-"));
    try {
      const a = (await (await fetch(`${base}/repos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: repoA, name: "alpha" }),
      })).json() as { repo: { id: string } }).repo;
      const b = (await (await fetch(`${base}/repos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: repoB, name: "beta" }),
      })).json() as { repo: { id: string } }).repo;
      const r1 = await fetch(`${base}/roles-by-id`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: a.id, name: "dev" }),
      });
      expect(r1.status).toBe(200);
      const r2 = await fetch(`${base}/roles-by-id`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: b.id, name: "dev" }),
      });
      expect(r2.status).toBe(200);
      const list = (await (await fetch(`${base}/roles-by-id`)).json() as { roles: Array<{ name: string; displayId: string }> }).roles;
      expect(list.filter((r) => r.name === "dev")).toHaveLength(2);
      expect(new Set(list.map((r) => r.displayId)).size).toBe(list.length);
    } finally {
      await rm(repoA, { recursive: true, force: true });
      await rm(repoB, { recursive: true, force: true });
    }
  });

  test("EP-DEC-RUN WA-006: POST /main-role rejects ambiguous bare name with 409 (advisor msg #28)", async () => {
    const { base } = await startWithEmptyWorkspace();
    const alphaDir = await mkdtemp(join(tmpdir(), "wa-r-alpha-"));
    const betaDir = await mkdtemp(join(tmpdir(), "wa-r-beta-"));
    try {
      const alpha = (await (await fetch(`${base}/repos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: alphaDir, name: "alpha" }),
      })).json() as { repo: { id: string } }).repo;
      const beta = (await (await fetch(`${base}/repos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: betaDir, name: "beta" }),
      })).json() as { repo: { id: string } }).repo;
      await fetch(`${base}/roles-by-id`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: alpha.id, name: "main" }),
      });
      await fetch(`${base}/roles-by-id`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: beta.id, name: "main" }),
      });

      // Bare-name `main` is ambiguous (matches alpha:main + beta:main) → 409.
      const ambiguous = await fetch(`${base}/main-role`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "main" }),
      });
      expect(ambiguous.status).toBe(409);
      const body = await ambiguous.json() as { error: string };
      expect(body.error).toContain("ambiguous");
    } finally {
      await rm(alphaDir, { recursive: true, force: true });
      await rm(betaDir, { recursive: true, force: true });
    }
  });

  test("EP-DEC-RUN WA-006: thread ids isolate by role.id so cross-repo same-name msgs do not collapse (advisor msg #28)", async () => {
    const { base } = await startWithEmptyWorkspace();
    const alphaDir = await mkdtemp(join(tmpdir(), "wa-r-alpha-"));
    const betaDir = await mkdtemp(join(tmpdir(), "wa-r-beta-"));
    try {
      const alpha = (await (await fetch(`${base}/repos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: alphaDir, name: "alpha" }),
      })).json() as { repo: { id: string } }).repo;
      const beta = (await (await fetch(`${base}/repos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: betaDir, name: "beta" }),
      })).json() as { repo: { id: string } }).repo;
      const alphaMain = (await (await fetch(`${base}/roles-by-id`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: alpha.id, name: "main" }),
      })).json() as { role: { id: string } }).role;
      const betaMain = (await (await fetch(`${base}/roles-by-id`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: beta.id, name: "main" }),
      })).json() as { role: { id: string } }).role;
      await fetch(`${base}/main-role`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: alphaMain.id }),
      });

      const alphaMsg = await (await fetch(`${base}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toRole: "alpha:main", body: "to alpha" }),
      })).json() as { message: { thread_id: string; to_role_id: string } };
      const betaMsg = await (await fetch(`${base}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toRole: "beta:main", body: "to beta" }),
      })).json() as { message: { thread_id: string; to_role_id: string } };

      // Pre-WA-006 threadIdFor used bare names → both threads collapsed
      // to `web:main`. Post-fix threads are id-keyed and distinct.
      expect(alphaMsg.message.thread_id).not.toBe(betaMsg.message.thread_id);
      expect(alphaMsg.message.thread_id).toBe(`web:${alphaMain.id}`);
      expect(betaMsg.message.thread_id).toBe(`web:${betaMain.id}`);
    } finally {
      await rm(alphaDir, { recursive: true, force: true });
      await rm(betaDir, { recursive: true, force: true });
    }
  });

  test("EP-DEC-RUN WA-006: POST /main-role accepts UUID and displayId, sets correct same-bare-name role (advisor msg #26)", async () => {
    const { wsId, base } = await startWithEmptyWorkspace();
    const alphaDir = await mkdtemp(join(tmpdir(), "wa-r-alpha-"));
    const betaDir = await mkdtemp(join(tmpdir(), "wa-r-beta-"));
    try {
      const alpha = (await (await fetch(`${base}/repos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: alphaDir, name: "alpha" }),
      })).json() as { repo: { id: string } }).repo;
      const beta = (await (await fetch(`${base}/repos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: betaDir, name: "beta" }),
      })).json() as { repo: { id: string } }).repo;
      const alphaMain = (await (await fetch(`${base}/roles-by-id`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: alpha.id, name: "main" }),
      })).json() as { role: { id: string } }).role;
      const betaMain = (await (await fetch(`${base}/roles-by-id`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: beta.id, name: "main" }),
      })).json() as { role: { id: string } }).role;

      // Set main = alpha:main via UUID.
      const setRes = await fetch(`${base}/main-role`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: alphaMain.id }),
      });
      expect(setRes.status).toBe(200);
      const wsState = daemon!.state.workspaces.get(wsId)!;
      const stamped1 = wsState.db.query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'main_role_id'").get();
      expect(stamped1?.value).toBe(alphaMain.id);

      // Switch to beta:main via displayId.
      const setRes2 = await fetch(`${base}/main-role`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "beta:main" }),
      });
      expect(setRes2.status).toBe(200);
      const stamped2 = wsState.db.query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'main_role_id'").get();
      expect(stamped2?.value).toBe(betaMain.id);
      expect(stamped2?.value).not.toBe(alphaMain.id);
    } finally {
      await rm(alphaDir, { recursive: true, force: true });
      await rm(betaDir, { recursive: true, force: true });
    }
  });

  test("EP-DEC-RUN WA-006: send_message via `repo:role` displayId routes to correct same-bare-name role (advisor msg #24)", async () => {
    const { wsId, base } = await startWithEmptyWorkspace();
    const alphaDir = await mkdtemp(join(tmpdir(), "wa-r-alpha-"));
    const betaDir = await mkdtemp(join(tmpdir(), "wa-r-beta-"));
    try {
      const alpha = (await (await fetch(`${base}/repos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: alphaDir, name: "alpha" }),
      })).json() as { repo: { id: string } }).repo;
      const beta = (await (await fetch(`${base}/repos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: betaDir, name: "beta" }),
      })).json() as { repo: { id: string } }).repo;
      const alphaMain = (await (await fetch(`${base}/roles-by-id`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: alpha.id, name: "main" }),
      })).json() as { role: { id: string } }).role;
      const betaMain = (await (await fetch(`${base}/roles-by-id`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: beta.id, name: "main" }),
      })).json() as { role: { id: string } }).role;
      // Star policy needs a main role to permit web → role direct send.
      await fetch(`${base}/main-role`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "main" }),
      });

      // Send to `beta:main`. resolveRoleAddress used to round-trip through
      // getRoleByName(role.name) and could return alpha:main; advisor #24
      // bug fix returns the resolved row directly. Assert message carries
      // beta:main's role.id, not alpha:main's.
      const sendRes = await fetch(`${base}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toRole: "beta:main", body: "ping" }),
      });
      const sendBody = await sendRes.json() as { ok: boolean; error?: string; message: { to_role_id: string; to_role_name: string; state: string } };
      // Web → role with no live runner returns 409 "main is offline"; the
      // crucial assertion is that the message row routes to beta:main's
      // role.id, not alpha:main's. Advisor msg #24: pre-fix
      // resolveRoleAddress round-tripped through getRoleByName(role.name)
      // and could land on alpha:main. The fix returns the resolved row.
      expect(sendBody.message.to_role_id).toBe(betaMain.id);
      expect(sendBody.message.to_role_id).not.toBe(alphaMain.id);
      expect(sendBody.message.to_role_name).toBe("beta:main");
    } finally {
      await rm(alphaDir, { recursive: true, force: true });
      await rm(betaDir, { recursive: true, force: true });
    }
  });

  test("EP-DEC-RUN WA-006: cross-repo `main` agents stop independently end-to-end", async () => {
    // Real exercise of the headline bug: two repos, two `main` roles,
    // each with its own runner. Stop alpha:main and beta:main remain
    // unaffected; stop beta:main and alpha:main remain unaffected.
    const { wsId, base } = await startWithEmptyWorkspace();
    const alphaDir = await mkdtemp(join(tmpdir(), "wa-r-alpha-"));
    const betaDir = await mkdtemp(join(tmpdir(), "wa-r-beta-"));
    try {
      const alpha = (await (await fetch(`${base}/repos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: alphaDir, name: "alpha" }),
      })).json() as { repo: { id: string } }).repo;
      const beta = (await (await fetch(`${base}/repos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: betaDir, name: "beta" }),
      })).json() as { repo: { id: string } }).repo;

      const alphaMain = (await (await fetch(`${base}/roles-by-id`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: alpha.id, name: "main" }),
      })).json() as { role: { id: string; displayId: string } }).role;
      const betaMain = (await (await fetch(`${base}/roles-by-id`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: beta.id, name: "main" }),
      })).json() as { role: { id: string; displayId: string } }).role;
      expect(alphaMain.displayId).toBe("alpha:main");
      expect(betaMain.displayId).toBe("beta:main");

      const wsPaths = activeWorkspacePaths(daemonHome, wsId);
      const alphaRunner = join(wsPaths.runDir, "alpha__main.runner.json");
      const betaRunner = join(wsPaths.runDir, "beta__main.runner.json");
      const stamp = (path: string, displayId: string, sessionId: string, cwd: string) => writeFile(path, JSON.stringify({
        fleet_id: "fleet-test", role: "main", display_id: displayId,
        session_id: sessionId, host_type: "claude-code",
        runner_pid: process.pid, child_pid: process.pid,
        cwd, socket_path: path.replace(".runner.json", ".sock"),
        started_at: new Date().toISOString(),
      }), "utf8");
      await stamp(alphaRunner, alphaMain.displayId, "session-alpha-main", alphaDir);
      await stamp(betaRunner, betaMain.displayId, "session-beta-main", betaDir);

      // List confirms both surface with distinct displayIds.
      const list = (await (await fetch(`${base}/roles-by-id`)).json() as { roles: Array<{ id: string; name: string; displayId: string }> }).roles;
      expect(list.filter((r) => r.name === "main")).toHaveLength(2);
      expect(new Set(list.map((r) => r.displayId))).toEqual(new Set(["alpha:main", "beta:main"]));

      // Stop alpha:main via UUID; alpha metadata gone, beta intact.
      const stopAlpha = await fetch(`${base}/roles-by-id/${alphaMain.id}/stop`, { method: "POST" });
      expect(stopAlpha.status).toBe(200);
      expect(await readFile(alphaRunner, "utf8").then(() => true).catch(() => false)).toBe(false);
      expect(await readFile(betaRunner, "utf8").then(() => true).catch(() => false)).toBe(true);

      // Stop beta:main via percent-encoded displayId; beta metadata gone too.
      const stopBeta = await fetch(`${base}/roles-by-id/${encodeURIComponent("beta:main")}/stop`, { method: "POST" });
      expect(stopBeta.status).toBe(200);
      expect(await readFile(betaRunner, "utf8").then(() => true).catch(() => false)).toBe(false);
    } finally {
      await rm(alphaDir, { recursive: true, force: true });
      await rm(betaDir, { recursive: true, force: true });
    }
  });

  test("PATCH role rename across repos to existing bare name now succeeds (WA-006)", async () => {
    const { base } = await startWithEmptyWorkspace();
    const repoA = await mkdtemp(join(tmpdir(), "wa-A-"));
    const repoB = await mkdtemp(join(tmpdir(), "wa-B-"));
    try {
      const a = (await (await fetch(`${base}/repos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: repoA, name: "alpha" }),
      })).json() as { repo: { id: string } }).repo;
      const b = (await (await fetch(`${base}/repos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: repoB, name: "beta" }),
      })).json() as { repo: { id: string } }).repo;
      await fetch(`${base}/roles-by-id`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: a.id, name: "dev" }),
      });
      const otherRole = (await (await fetch(`${base}/roles-by-id`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: b.id, name: "scout" }),
      })).json() as { role: { id: string } }).role;
      // Rename `scout` → `dev@` (sanitises to `dev`). Pre-WA-006 the
      // workspace-wide guard 409d this; now it succeeds because each
      // displayId is unique.
      const renameRes = await fetch(`${base}/roles-by-id/${otherRole.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "dev@" }),
      });
      expect(renameRes.status).toBe(200);
      const body = await renameRes.json() as { role: { name: string; displayId: string } };
      expect(body.role.name).toBe("dev");
      expect(body.role.displayId).toBe("beta:dev");
    } finally {
      await rm(repoA, { recursive: true, force: true });
      await rm(repoB, { recursive: true, force: true });
    }
  });

  test("repo add rejects file (not directory)", async () => {
    const { base } = await startWithEmptyWorkspace();
    const filePath = join(tmpdir(), `wa-not-a-dir-${Date.now()}.txt`);
    await Bun.write(filePath, "i am a file");
    try {
      const res = await fetch(`${base}/repos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: filePath, name: "bogus" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("not a directory");
    } finally {
      await rm(filePath, { force: true });
    }
  });

  test("scan-dir add rejects file (not directory)", async () => {
    const { base } = await startWithEmptyWorkspace();
    const filePath = join(tmpdir(), `wa-not-a-dir-${Date.now()}.txt`);
    await Bun.write(filePath, "i am a file");
    try {
      const res = await fetch(`${base}/scan-dirs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: filePath }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("not a directory");
    } finally {
      await rm(filePath, { force: true });
    }
  });
});

describe("Add Workspace kanban prefix normalization (EP-DEC-FIX S2)", () => {
  test("rejects invalid prefix at API boundary", async () => {
    daemon = await startAuthedDaemon();
    const res = await fetch(`${daemon.url}/api/v1/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ws-bad", kanbanPrefix: "with-bad!chars", rbacMode: "enforce" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("kanban task id prefix");
  });

  test("rejects empty-string prefix at API boundary", async () => {
    daemon = await startAuthedDaemon();
    const res = await fetch(`${daemon.url}/api/v1/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ws-empty", kanbanPrefix: "", rbacMode: "enforce" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("kanbanPrefix cannot be empty");
  });

  test("normalises valid prefix identically to Edit path", async () => {
    daemon = await startAuthedDaemon();
    // Add path: lower-case input persists upper-cased.
    const addRes = await fetch(`${daemon.url}/api/v1/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ws-add", kanbanPrefix: "prj", rbacMode: "enforce" }),
    });
    expect(addRes.status).toBe(200);
    const addBody = await addRes.json() as { workspace: { id: string } };
    const addStatus = await fetch(`${daemon.url}/api/v1/workspaces/${addBody.workspace.id}/status`).then((r) => r.json()) as { kanban: { taskIdPrefix: string } };
    expect(addStatus.kanban.taskIdPrefix).toBe("PRJ");

    // Edit path on a second workspace with the same input must produce
    // the same stored prefix.
    const editRes = await fetch(`${daemon.url}/api/v1/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ws-edit", rbacMode: "enforce" }),
    });
    const editBody = await editRes.json() as { workspace: { id: string } };
    const patchRes = await fetch(`${daemon.url}/api/v1/workspaces/${editBody.workspace.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kanbanPrefix: "prj" }),
    });
    expect(patchRes.status).toBe(200);
    const editStatus = await fetch(`${daemon.url}/api/v1/workspaces/${editBody.workspace.id}/status`).then((r) => r.json()) as { kanban: { taskIdPrefix: string } };
    expect(editStatus.kanban.taskIdPrefix).toBe("PRJ");
  });
});

describe("legacy endpoint removal (WA-069)", () => {
  test("POST /discover returns 410 with new-endpoint hint", async () => {
    const { base } = await startWithEmptyWorkspace();
    const res = await fetch(`${base}/discover`, { method: "POST" });
    expect(res.status).toBe(410);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("/repos");
    expect(body.error).toContain("/scan-dirs");
  });

  test("PUT /settings/multi-agent is not routed", async () => {
    const { base } = await startWithEmptyWorkspace();
    const res = await fetch(`${base}/settings/multi-agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(404);
  });
});

describe("scan-dir HTTP endpoints (WA-065)", () => {
  test("scan-dir lifecycle + scan with marker filter + dedupe", async () => {
    const { base } = await startWithEmptyWorkspace();
    const parent = await mkdtemp(join(tmpdir(), "wa-parent-"));
    const otherRepoDir = await mkdtemp(join(tmpdir(), "wa-other-repo-"));
    try {
      // Lay down children: one with .git, one with package.json, one bare.
      await mkdir(join(parent, "git-repo", ".git"), { recursive: true });
      await mkdir(join(parent, "node-repo"));
      await writeFile(join(parent, "node-repo", "package.json"), "{}");
      await mkdir(join(parent, "blank"));

      // Pre-register one of the candidates so dedupe kicks in.
      await fetch(`${base}/repos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: join(parent, "git-repo"), name: "git-repo" }),
      });

      // Add scan dir.
      const addScanRes = await fetch(`${base}/scan-dirs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath: parent, scanOnStartup: true }),
      });
      expect(addScanRes.status).toBe(200);
      const addScanBody = await addScanRes.json() as { scanDir: { id: string; scanOnStartup: boolean } };
      expect(addScanBody.scanDir.scanOnStartup).toBe(true);
      const scanId = addScanBody.scanDir.id;

      // Scan.
      const scanRes = await fetch(`${base}/scan-dirs/${scanId}/scan`, { method: "POST" });
      expect(scanRes.status).toBe(200);
      const scanBody = await scanRes.json() as { added: Array<{ absolutePath: string; sourceScanId: string | null }>; skipped: string[] };
      expect(scanBody.added.map((r) => r.absolutePath)).toEqual([join(parent, "node-repo")]);
      expect(scanBody.skipped.sort()).toEqual([join(parent, "blank"), join(parent, "git-repo")].sort());
      expect(scanBody.added[0]?.sourceScanId).toBe(scanId);

      // Toggle scan-on-startup off.
      const patchRes = await fetch(`${base}/scan-dirs/${scanId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanOnStartup: false }),
      });
      expect(patchRes.status).toBe(200);
      const patchBody = await patchRes.json() as { scanDir: { scanOnStartup: boolean } };
      expect(patchBody.scanDir.scanOnStartup).toBe(false);

      // Delete.
      const deleteRes = await fetch(`${base}/scan-dirs/${scanId}`, { method: "DELETE" });
      expect(deleteRes.status).toBe(200);
      // The scan-sourced repo's `source_scan_id` flips to NULL via FK.
      const repoList = await fetch(`${base}/repos`).then((r) => r.json()) as { repos: Array<{ name: string; sourceScanId: string | null }> };
      const nodeRepo = repoList.repos.find((r) => r.name === "node-repo");
      expect(nodeRepo?.sourceScanId).toBeNull();
    } finally {
      await rm(parent, { recursive: true, force: true });
      await rm(otherRepoDir, { recursive: true, force: true });
    }
  });
});

describe("scan-on-startup (WA-080)", () => {
  test("daemon boot scans only scan dirs flagged for startup", async () => {
    const home = await tmpDaemonHome();
    const flaggedParent = await mkdtemp(join(tmpdir(), "wa-startup-flagged-"));
    const unflaggedParent = await mkdtemp(join(tmpdir(), "wa-startup-unflagged-"));
    try {
      await mkdir(join(flaggedParent, "flagged-repo"));
      await writeFile(join(flaggedParent, "flagged-repo", "package.json"), "{}");
      await mkdir(join(unflaggedParent, "unflagged-repo"));
      await writeFile(join(unflaggedParent, "unflagged-repo", "package.json"), "{}");

      const seeded = await seedTestWorkspace(home.home, home.daemonDb, { name: "startup" });
      insertScanDir(seeded.workspaceDb, { absolutePath: flaggedParent, scanOnStartup: true });
      insertScanDir(seeded.workspaceDb, { absolutePath: unflaggedParent, scanOnStartup: false });
      seeded.workspaceDb.close();
      home.daemonDb.close();

      daemonHome = home.home;
      daemon = await startAuthedDaemon();
      const base = `${daemon.url}/api/v1/workspaces/${seeded.workspaceId}`;
      const repos = await fetch(`${base}/repos`).then((r) => r.json()) as { repos: Array<{ name: string; absolutePath: string }> };

      expect(repos.repos.map((repo) => repo.name)).toEqual(["flagged-repo"]);
      expect(repos.repos[0]?.absolutePath).toBe(join(flaggedParent, "flagged-repo"));
    } finally {
      await rm(flaggedParent, { recursive: true, force: true });
      await rm(unflaggedParent, { recursive: true, force: true });
    }
  });

  test("daemon boot logs startup scan failures and continues", async () => {
    const home = await tmpDaemonHome();
    const goodParent = await mkdtemp(join(tmpdir(), "wa-startup-good-"));
    const missingParent = join(tmpdir(), `wa-startup-missing-${Date.now()}`);
    try {
      await mkdir(join(goodParent, "good-repo"));
      await writeFile(join(goodParent, "good-repo", "package.json"), "{}");

      const seeded = await seedTestWorkspace(home.home, home.daemonDb, { name: "startup-errors" });
      insertScanDir(seeded.workspaceDb, { absolutePath: missingParent, scanOnStartup: true });
      insertScanDir(seeded.workspaceDb, { absolutePath: goodParent, scanOnStartup: true });
      seeded.workspaceDb.close();
      home.daemonDb.close();

      daemonHome = home.home;
      daemon = await startAuthedDaemon();
      const base = `${daemon.url}/api/v1/workspaces/${seeded.workspaceId}`;
      const repos = await fetch(`${base}/repos`).then((r) => r.json()) as { repos: Array<{ name: string }> };
      expect(repos.repos.map((repo) => repo.name)).toEqual(["good-repo"]);

      await new Promise((resolve) => setTimeout(resolve, 20));
      const logText = await readFile(daemon.state.logger.path, "utf8");
      expect(logText).toContain("workspace.scan.failed");
      expect(logText).toContain(missingParent);
      expect(logText).toContain("workspace.scan.startup_complete");
      expect(logText).toContain('"scanned":2');
      expect(logText).toContain('"added":1');
    } finally {
      await rm(goodParent, { recursive: true, force: true });
    }
  });
});
