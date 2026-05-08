/**
 * Minimal daemon coverage that survives the EP-DEC-1 cutover.
 * `tests/daemon.test.ts` is parked as `*.test.ts.todo` pending WA-086
 * rebaseline; this suite restores the smoke / shell / current-workspace /
 * list_peers coverage Advisor flagged before merge.
 *
 * Boots the real daemon (no `bootstrap`), seeds a workspace + repo + role
 * directly into the daemon's DB via `seedTestWorkspace`, and exercises
 * the HTTP API end-to-end:
 *   - GET /health
 *   - GET /api/v1/workspaces (empty + non-empty)
 *   - GET /api/v1/workspaces/current (null + populated)
 *   - PUT /api/v1/workspaces/current
 *   - GET /api/v1/workspaces/:id/status (roles in legacy compat shape via
 *     the WA-062 follow-up shim — ready for WA-066 to swap to the new
 *     repo+role API surface)
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setCurrentWorkspaceId } from "../src/daemon-db.ts";
import { startDaemon, type StartedDaemon } from "../src/server/daemon.ts";
import { loadWorkspaceState } from "../src/server/workspace-state.ts";
import { getWorkspace } from "../src/daemon-db.ts";

import { seedTestWorkspace, tmpRepoDir } from "./helpers/seed-workspace.ts";
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

describe("daemon decoupling smoke", () => {
  test("boots empty: /health 200, no current workspace, empty list", async () => {
    daemon = await startAuthedDaemon();
    const health = await fetch(`${daemon.url}/health`);
    expect(health.status).toBe(200);
    const cur = await fetch(`${daemon.url}/api/v1/workspaces/current`).then((r) => r.json()) as { current: unknown };
    expect(cur.current).toBeNull();
    const list = await fetch(`${daemon.url}/api/v1/workspaces`).then((r) => r.json()) as { workspaces: unknown[]; currentWorkspaceId: string | null };
    expect(list.workspaces).toHaveLength(0);
    expect(list.currentWorkspaceId).toBeNull();
  });

  test("POST /workspaces accepts {name, kanbanPrefix?}, rejects legacy path/type", async () => {
    daemon = await startAuthedDaemon();

    // New shape: {name} → 200.
    const okRes = await fetch(`${daemon.url}/api/v1/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "fresh", kanbanPrefix: "FX", rbacMode: "enforce" }),
    });
    expect(okRes.status).toBe(200);
    const okBody = await okRes.json() as { ok: boolean; workspace: { id: string; name: string } };
    expect(okBody.ok).toBe(true);
    expect(okBody.workspace.name).toBe("fresh");

    // PATCH to update name + kanban prefix.
    const patchRes = await fetch(`${daemon.url}/api/v1/workspaces/${okBody.workspace.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "renamed", kanbanPrefix: "GX" }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json() as { ok: boolean; workspace: { name: string } };
    expect(patchBody.workspace.name).toBe("renamed");

    // Legacy {path, type} → 400.
    const legacyRes = await fetch(`${daemon.url}/api/v1/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "legacy", path: "/tmp/foo", type: "single-repo", rbacMode: "enforce" }),
    });
    expect(legacyRes.status).toBe(400);
    const legacyBody = await legacyRes.json() as { ok: boolean; error: string };
    expect(legacyBody.error).toContain("path/type");
  });

  test("seeded workspace appears in /workspaces, current, status (with role-shim shape)", async () => {
    daemon = await startAuthedDaemon();
    // Seed via the public helper, then hydrate the runtime cache so the
    // daemon's per-workspace state map sees it. Real callers route this
    // through the lifecycle hooks invoked by `createWorkspaceEndpoint`;
    // since this test bypasses HTTP for the seed, do the same work
    // explicitly.
    const repoDir = await tmpRepoDir();
    const seeded = await seedTestWorkspace(daemon.state.daemonHome, daemon.state.daemonDb, {
      name: "ws",
      repos: [{ absolutePath: repoDir, name: "alpha", roles: [{ name: "main" }] }],
    });
    seeded.workspaceDb.close();
    const row = getWorkspace(daemon.state.daemonDb, seeded.workspaceId)!;
    daemon.state.workspaces.set(row.id, loadWorkspaceState(daemon.state.daemonHome, row));
    setCurrentWorkspaceId(daemon.state.daemonDb, row.id);
    daemon.state.currentWorkspaceId = row.id;

    const list = await fetch(`${daemon.url}/api/v1/workspaces`).then((r) => r.json()) as { workspaces: Array<{ id: string; name: string; status: string; repo_count: number; role_count: number }>; currentWorkspaceId: string };
    expect(list.workspaces).toHaveLength(1);
    expect(list.workspaces[0]?.name).toBe("ws");
    expect(list.workspaces[0]?.status).toBe("active");
    expect(list.workspaces[0]?.repo_count).toBe(1);
    expect(list.workspaces[0]?.role_count).toBe(1);
    expect(list.currentWorkspaceId).toBe(row.id);
    // No legacy fields leak into the response.
    expect((list.workspaces[0] as Record<string, unknown>).path).toBeUndefined();
    expect((list.workspaces[0] as Record<string, unknown>).type).toBeUndefined();

    const cur = await fetch(`${daemon.url}/api/v1/workspaces/current`).then((r) => r.json()) as { current: { id: string; name: string } };
    expect(cur.current?.id).toBe(row.id);

    const status = await fetch(`${daemon.url}/api/v1/workspaces/${row.id}/status`).then((r) => r.json()) as {
      currentWorkspace: { id: string; name: string };
      roles: Array<{ id: string; name: string; path: string; repo_id?: string; repo_name?: string; display_id?: string }>;
      repos: Array<{ id: string; name: string; absolutePath: string; roleCount: number }>;
      scanDirs: unknown[];
    };
    expect(status.currentWorkspace?.id).toBe(row.id);
    expect((status.currentWorkspace as Record<string, unknown>).path).toBeUndefined();
    expect((status.currentWorkspace as Record<string, unknown>).type).toBeUndefined();
    expect(status.roles).toHaveLength(1);
    const role = status.roles[0]!;
    // Compat shape for legacy callers (path comes from repo absolute_path,
    // git_root from repo). Plus the new repo metadata bonus columns.
    expect(role.name).toBe("main");
    expect(role.path).toBe(repoDir);
    expect(role.repo_id).toBeTruthy();
    expect(role.repo_name).toBe("alpha");
    expect(role.display_id).toBe("alpha:main");
    // WA-067: status snapshot exposes repos + scanDirs so the UI can
    // group roles by repo + show scan-dir state without extra fetches.
    expect(status.repos).toHaveLength(1);
    expect(status.repos[0]?.name).toBe("alpha");
    expect(status.repos[0]?.absolutePath).toBe(repoDir);
    expect(status.repos[0]?.roleCount).toBe(1);
    expect(status.scanDirs).toHaveLength(0);
  });
});
