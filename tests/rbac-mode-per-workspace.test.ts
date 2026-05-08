/**
 * EP-022 / WA-094 — per-workspace RBAC mode + CLI ceiling + endpoints.
 *
 * Replaces the daemon-wide `WHATSAGENT_RBAC_HARD_ENFORCE` env-var with
 * per-workspace `rbac_mode` (`enforce`/`soft`/`off`) plus an optional
 * launch-only ceiling cap. `effectiveRbacMode(workspace, ceiling)`
 * returns the most-permissive of the two so the CLI flag can globally
 * loosen but never tighten beyond a workspace's stored mode.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listAudit } from "../src/audit-log-dao.ts";
import { createWorkspace } from "../src/config.ts";
import { getWorkspace, getWorkspaceRbacMode, setCurrentWorkspaceId, type RbacMode } from "../src/daemon-db.ts";
import { migrate, openFleetDb } from "../src/db.ts";
import { setAgentRoles, getRbacRoleByName } from "../src/rbac-dao.ts";
import { checkActionGrants } from "../src/rbac-enforce.ts";
import { effectiveRbacMode, startDaemon, type StartedDaemon } from "../src/server/daemon.ts";
import { loadWorkspaceState } from "../src/server/workspace-state.ts";
import { authedFetchHeaders, seedAuthSessionCookieInDb } from "./helpers/auth.ts";

let daemonHome: string;
let daemon: StartedDaemon | null = null;
let authCookie = "";
const nativeFetch = globalThis.fetch.bind(globalThis);

async function startAuthedDaemon(opts: { rbacModeCeiling?: RbacMode | null } = {}): Promise<StartedDaemon> {
  const started = await startDaemon({ port: 0, consoleLogs: false, daemonHome, ...opts });
  authCookie = await seedAuthSessionCookieInDb(started.state.daemonDb);
  return started;
}

beforeEach(async () => {
  daemonHome = await mkdtemp(join(tmpdir(), "wa-home-rbac-mode-"));
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

describe("EP-022 / WA-094 effectiveRbacMode helper", () => {
  test("ceiling=null returns workspace mode unchanged", () => {
    expect(effectiveRbacMode("enforce", null)).toBe("enforce");
    expect(effectiveRbacMode("soft", null)).toBe("soft");
    expect(effectiveRbacMode("off", null)).toBe("off");
  });

  test("ceiling caps at most-permissive (off < soft < enforce)", () => {
    // ceiling=off forces every workspace to off
    expect(effectiveRbacMode("enforce", "off")).toBe("off");
    expect(effectiveRbacMode("soft", "off")).toBe("off");
    expect(effectiveRbacMode("off", "off")).toBe("off");

    // ceiling=soft caps enforce -> soft, but doesn't tighten off
    expect(effectiveRbacMode("enforce", "soft")).toBe("soft");
    expect(effectiveRbacMode("soft", "soft")).toBe("soft");
    expect(effectiveRbacMode("off", "soft")).toBe("off");

    // ceiling=enforce never tightens (already most-strict, just lets workspace win)
    expect(effectiveRbacMode("enforce", "enforce")).toBe("enforce");
    expect(effectiveRbacMode("soft", "enforce")).toBe("soft");
    expect(effectiveRbacMode("off", "enforce")).toBe("off");
  });
});

describe("EP-022 / WA-094 POST /api/v1/workspaces — rbacMode required", () => {
  test("rejects 400 when rbacMode is missing", async () => {
    daemon = await startAuthedDaemon();
    const res = await fetch(`${daemon.url}/api/v1/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "no-mode" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("rbacMode");
  });

  test("rejects 400 when rbacMode is invalid string", async () => {
    daemon = await startAuthedDaemon();
    const res = await fetch(`${daemon.url}/api/v1/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "bad-mode", rbacMode: "loud" }),
    });
    expect(res.status).toBe(400);
  });

  test("accepts each valid mode + persists it on the workspace row", async () => {
    daemon = await startAuthedDaemon();
    for (const mode of ["enforce", "soft", "off"] as const) {
      const res = await fetch(`${daemon.url}/api/v1/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `ws-${mode}`, rbacMode: mode }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; workspace: { id: string; rbac_mode: RbacMode } };
      expect(body.workspace.rbac_mode).toBe(mode);
      expect(getWorkspaceRbacMode(daemon!.state.daemonDb, body.workspace.id)).toBe(mode);
    }
  });
});

describe("EP-022 / WA-094 PATCH /api/v1/workspaces/:id/rbac-mode", () => {
  test("flips stored mode + cached WorkspaceState.rbacMode + 200 with previous in body", async () => {
    daemon = await startAuthedDaemon();
    const row = await createWorkspace(daemon.state.daemonDb, daemon.state.daemonHome, { name: "flip", rbacMode: "enforce" });
    daemon.state.workspaces.set(row.id, loadWorkspaceState(daemon.state.daemonHome, getWorkspace(daemon.state.daemonDb, row.id)!));
    setCurrentWorkspaceId(daemon.state.daemonDb, row.id);
    daemon.state.currentWorkspaceId = row.id;

    const res = await fetch(`${daemon.url}/api/v1/workspaces/${row.id}/rbac-mode`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rbacMode: "off" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; workspaceId: string; rbacMode: RbacMode; previous: RbacMode };
    expect(body.ok).toBe(true);
    expect(body.rbacMode).toBe("off");
    expect(body.previous).toBe("enforce");

    // DB row updated.
    expect(getWorkspaceRbacMode(daemon.state.daemonDb, row.id)).toBe("off");
    // Cached WorkspaceState updated (dispatcher reads from this).
    expect(daemon.state.workspaces.get(row.id)!.rbacMode).toBe("off");
  });

  test("rejects 400 on invalid mode", async () => {
    daemon = await startAuthedDaemon();
    const row = await createWorkspace(daemon.state.daemonDb, daemon.state.daemonHome, { name: "ws", rbacMode: "enforce" });
    daemon.state.workspaces.set(row.id, loadWorkspaceState(daemon.state.daemonHome, getWorkspace(daemon.state.daemonDb, row.id)!));

    const res = await fetch(`${daemon.url}/api/v1/workspaces/${row.id}/rbac-mode`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rbacMode: "loose" }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects 400 when rbacMode field missing", async () => {
    daemon = await startAuthedDaemon();
    const row = await createWorkspace(daemon.state.daemonDb, daemon.state.daemonHome, { name: "ws", rbacMode: "enforce" });
    daemon.state.workspaces.set(row.id, loadWorkspaceState(daemon.state.daemonHome, getWorkspace(daemon.state.daemonDb, row.id)!));

    const res = await fetch(`${daemon.url}/api/v1/workspaces/${row.id}/rbac-mode`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("returns 404 when workspace does not exist", async () => {
    daemon = await startAuthedDaemon();
    const res = await fetch(`${daemon.url}/api/v1/workspaces/nonexistent/rbac-mode`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rbacMode: "off" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("EP-022 / WA-094 GET /api/v1/workspaces — rbac_mode in payload", () => {
  test("workspace summary includes rbac_mode field", async () => {
    daemon = await startAuthedDaemon();
    await createWorkspace(daemon.state.daemonDb, daemon.state.daemonHome, { name: "alpha", rbacMode: "enforce" });
    await createWorkspace(daemon.state.daemonDb, daemon.state.daemonHome, { name: "beta", rbacMode: "soft" });
    await createWorkspace(daemon.state.daemonDb, daemon.state.daemonHome, { name: "gamma", rbacMode: "off" });

    const res = await fetch(`${daemon.url}/api/v1/workspaces`);
    expect(res.status).toBe(200);
    const body = await res.json() as { workspaces: Array<{ name: string; rbac_mode: RbacMode }> };
    const byName = Object.fromEntries(body.workspaces.map((w) => [w.name, w.rbac_mode]));
    expect(byName.alpha).toBe("enforce");
    expect(byName.beta).toBe("soft");
    expect(byName.gamma).toBe("off");
  });
});

describe("EP-022 / WA-094 CLI ceiling — opts.rbacModeCeiling", () => {
  test("ceiling=off forces effective mode off regardless of stored workspace mode", async () => {
    daemon = await startAuthedDaemon({ rbacModeCeiling: "off" });
    const row = await createWorkspace(daemon.state.daemonDb, daemon.state.daemonHome, { name: "ws", rbacMode: "enforce" });
    daemon.state.workspaces.set(row.id, loadWorkspaceState(daemon.state.daemonHome, getWorkspace(daemon.state.daemonDb, row.id)!));

    const ws = daemon.state.workspaces.get(row.id)!;
    expect(effectiveRbacMode(ws.rbacMode, daemon.state.rbacModeCeiling)).toBe("off");
  });

  test("ceiling=soft caps enforce workspace at soft, leaves off workspace as off", async () => {
    daemon = await startAuthedDaemon({ rbacModeCeiling: "soft" });
    const enforceRow = await createWorkspace(daemon.state.daemonDb, daemon.state.daemonHome, { name: "ws-e", rbacMode: "enforce" });
    const offRow = await createWorkspace(daemon.state.daemonDb, daemon.state.daemonHome, { name: "ws-o", rbacMode: "off" });
    daemon.state.workspaces.set(enforceRow.id, loadWorkspaceState(daemon.state.daemonHome, getWorkspace(daemon.state.daemonDb, enforceRow.id)!));
    daemon.state.workspaces.set(offRow.id, loadWorkspaceState(daemon.state.daemonHome, getWorkspace(daemon.state.daemonDb, offRow.id)!));

    expect(effectiveRbacMode(daemon.state.workspaces.get(enforceRow.id)!.rbacMode, daemon.state.rbacModeCeiling)).toBe("soft");
    expect(effectiveRbacMode(daemon.state.workspaces.get(offRow.id)!.rbacMode, daemon.state.rbacModeCeiling)).toBe("off");
  });

  test("ceiling=null lets workspace mode win as-is (no cap)", async () => {
    daemon = await startAuthedDaemon();
    const row = await createWorkspace(daemon.state.daemonDb, daemon.state.daemonHome, { name: "ws", rbacMode: "enforce" });
    daemon.state.workspaces.set(row.id, loadWorkspaceState(daemon.state.daemonHome, getWorkspace(daemon.state.daemonDb, row.id)!));

    expect(daemon.state.rbacModeCeiling).toBeNull();
    expect(effectiveRbacMode(daemon.state.workspaces.get(row.id)!.rbacMode, daemon.state.rbacModeCeiling)).toBe("enforce");
  });
});

describe("EP-022 / WA-094 — workspace cache hydration carries rbac_mode", () => {
  test("loadWorkspaceState reads rbac_mode from WorkspaceRow into cache", async () => {
    daemon = await startAuthedDaemon();
    const row = await createWorkspace(daemon.state.daemonDb, daemon.state.daemonHome, { name: "ws", rbacMode: "soft" });
    daemon.state.workspaces.set(row.id, loadWorkspaceState(daemon.state.daemonHome, getWorkspace(daemon.state.daemonDb, row.id)!));

    expect(daemon.state.workspaces.get(row.id)!.rbacMode).toBe("soft");
  });
});

/**
 * EP-022 / WA-094 — `off` mode security semantics (advisor msg #409 ¶3).
 *
 * Helper-level proof that an `off` mode call is fully short-circuited:
 *   - Allowed even when no required grants are held.
 *   - No audit row written for misses (`grant_miss_*`) OR passes
 *     (`grant_check_pass`).
 *   - No `agentRolesSnapshot` (the helper does not touch role_grants).
 *
 * Pairs with the `enforce` + `soft` audit-emission tests already in
 * `rbac-enforce.test.ts` so all three modes have explicit security
 * coverage at the helper layer. End-to-end coverage at the dispatcher
 * layer for `enforce` lives in `daemon.test.ts` (WA-084 fan-out gate);
 * the off path needs no analogous deny-shape test because off has no
 * deny shape — `outcome.allowed` is always true and no audit row is
 * written.
 */
describe("EP-022 / WA-094 — off-mode dispatcher security semantics", () => {
  test("off mode + missing grant → allowed=true, no audit rows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wa-off-"));
    const dbPath = join(dir, "ws.sqlite");
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      // Seed an agent + assign restricted role (which has zero kanban-admin
      // grants), then call create-kanban-task — would `grant_miss_hard` /
      // `grant_miss_soft` under enforce / soft, but off skips entirely.
      const now = new Date().toISOString();
      db.run("INSERT INTO workspace_repos (id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at) VALUES ('repo-1', 'r', '/tmp/r', NULL, NULL, NULL, ?, ?)", [now, now]);
      db.run("INSERT INTO agents (id, repo_id, name, host_default, default_host_type, created_at, updated_at) VALUES ('agent-1', 'repo-1', 'alpha', 'claude-code', NULL, ?, ?)", [now, now]);
      const restricted = getRbacRoleByName(db, "restricted")!;
      setAgentRoles(db, "agent-1", [restricted.id]);

      const r = checkActionGrants(db, {
        agentId: "agent-1",
        action: "create-kanban-task",
        mode: "off",
      });
      expect(r.allowed).toBe(true);
      expect(r.hasMiss).toBe(false);
      expect(r.auditIds).toEqual([]);
      expect(r.firstMissRequirement).toBeUndefined();
      expect(r.agentRolesSnapshot).toEqual([]);

      const audits = listAudit(db);
      expect(audits.filter((a) => a.kind === "grant_miss_hard")).toHaveLength(0);
      expect(audits.filter((a) => a.kind === "grant_miss_soft")).toHaveLength(0);
      expect(audits.filter((a) => a.kind === "grant_check_pass")).toHaveLength(0);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("off mode + present grant → allowed=true, no audit (off skips even pass-row)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wa-off-"));
    const dbPath = join(dir, "ws.sqlite");
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const now = new Date().toISOString();
      db.run("INSERT INTO workspace_repos (id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at) VALUES ('repo-1', 'r', '/tmp/r', NULL, NULL, NULL, ?, ?)", [now, now]);
      db.run("INSERT INTO agents (id, repo_id, name, host_default, default_host_type, created_at, updated_at) VALUES ('agent-1', 'repo-1', 'alpha', 'claude-code', NULL, ?, ?)", [now, now]);
      const pm = getRbacRoleByName(db, "pm")!;
      setAgentRoles(db, "agent-1", [pm.id]);

      const r = checkActionGrants(db, {
        agentId: "agent-1",
        action: "create-kanban-task",
        mode: "off",
      });
      expect(r.allowed).toBe(true);
      expect(r.hasMiss).toBe(false);
      expect(r.auditIds).toEqual([]);

      // The off short-circuit MUST suppress grant_check_pass too, otherwise
      // an agent could distinguish off-mode workspaces by audit-row presence.
      expect(listAudit(db)).toEqual([]);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("off mode + ungated action → allowed=true, no audit (consistent with other no-gate paths)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wa-off-"));
    const dbPath = join(dir, "ws.sqlite");
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const now = new Date().toISOString();
      db.run("INSERT INTO workspace_repos (id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at) VALUES ('repo-1', 'r', '/tmp/r', NULL, NULL, NULL, ?, ?)", [now, now]);
      db.run("INSERT INTO agents (id, repo_id, name, host_default, default_host_type, created_at, updated_at) VALUES ('agent-1', 'repo-1', 'alpha', 'claude-code', NULL, ?, ?)", [now, now]);

      const r = checkActionGrants(db, { agentId: "agent-1", action: "whoami", mode: "off" });
      expect(r.allowed).toBe(true);
      expect(r.hasMiss).toBe(false);
      expect(listAudit(db)).toEqual([]);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * EP-022 / WA-094 — PATCH `/api/v1/workspaces/:id` accepts `rbacMode`
 * (advisor msg #409 ¶2). Earlier revision said Workspace PATCH covers
 * the Edit Workspace modal in the same slice; this exercises that
 * surface so an Edit Workspace request that includes `rbacMode` flips
 * the stored mode + cached state instead of silently failing.
 */
describe("EP-022 / WA-094 — PATCH /api/v1/workspaces/:id rbacMode field", () => {
  test("flips stored mode + cached state when rbacMode included alongside name", async () => {
    daemon = await startAuthedDaemon();
    const row = await createWorkspace(daemon.state.daemonDb, daemon.state.daemonHome, { name: "edit-me", rbacMode: "enforce" });
    daemon.state.workspaces.set(row.id, loadWorkspaceState(daemon.state.daemonHome, getWorkspace(daemon.state.daemonDb, row.id)!));

    const res = await fetch(`${daemon.url}/api/v1/workspaces/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "edit-me-renamed", rbacMode: "soft" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; workspace: { name: string; rbac_mode: RbacMode } };
    expect(body.workspace.name).toBe("edit-me-renamed");
    expect(body.workspace.rbac_mode).toBe("soft");
    expect(daemon.state.workspaces.get(row.id)!.rbacMode).toBe("soft");
    expect(getWorkspaceRbacMode(daemon.state.daemonDb, row.id)).toBe("soft");
  });

  test("rejects 400 on invalid rbacMode in PATCH body", async () => {
    daemon = await startAuthedDaemon();
    const row = await createWorkspace(daemon.state.daemonDb, daemon.state.daemonHome, { name: "ws", rbacMode: "enforce" });
    daemon.state.workspaces.set(row.id, loadWorkspaceState(daemon.state.daemonHome, getWorkspace(daemon.state.daemonDb, row.id)!));

    const res = await fetch(`${daemon.url}/api/v1/workspaces/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rbacMode: "loose" }),
    });
    expect(res.status).toBe(400);
    expect(daemon.state.workspaces.get(row.id)!.rbacMode).toBe("enforce");
  });

  test("ignores omitted rbacMode (other-field-only PATCH preserves stored mode)", async () => {
    daemon = await startAuthedDaemon();
    const row = await createWorkspace(daemon.state.daemonDb, daemon.state.daemonHome, { name: "ws", rbacMode: "soft" });
    daemon.state.workspaces.set(row.id, loadWorkspaceState(daemon.state.daemonHome, getWorkspace(daemon.state.daemonDb, row.id)!));

    const res = await fetch(`${daemon.url}/api/v1/workspaces/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "renamed-only" }),
    });
    expect(res.status).toBe(200);
    expect(getWorkspaceRbacMode(daemon.state.daemonDb, row.id)).toBe("soft");
    expect(daemon.state.workspaces.get(row.id)!.rbacMode).toBe("soft");
  });

  /**
   * Atomicity guard (advisor msg #411 ¶2): if name validation fails the
   * PATCH must NOT have already flipped rbacMode. Earlier revision
   * applied rbacMode first; a downstream `name: ""` would 400 after the
   * mode change persisted.
   */
  test("rejects PATCH atomically: invalid name does not flip rbacMode", async () => {
    daemon = await startAuthedDaemon();
    const row = await createWorkspace(daemon.state.daemonDb, daemon.state.daemonHome, { name: "ws", rbacMode: "enforce" });
    daemon.state.workspaces.set(row.id, loadWorkspaceState(daemon.state.daemonHome, getWorkspace(daemon.state.daemonDb, row.id)!));

    const res = await fetch(`${daemon.url}/api/v1/workspaces/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rbacMode: "off", name: "" }),
    });
    expect(res.status).toBe(400);

    // Mode preserved; cache + DB row unchanged.
    expect(getWorkspaceRbacMode(daemon.state.daemonDb, row.id)).toBe("enforce");
    expect(daemon.state.workspaces.get(row.id)!.rbacMode).toBe("enforce");
  });

  test("rejects PATCH atomically: empty kanbanPrefix does not flip rbacMode", async () => {
    daemon = await startAuthedDaemon();
    const row = await createWorkspace(daemon.state.daemonDb, daemon.state.daemonHome, { name: "ws", rbacMode: "enforce" });
    daemon.state.workspaces.set(row.id, loadWorkspaceState(daemon.state.daemonHome, getWorkspace(daemon.state.daemonDb, row.id)!));

    const res = await fetch(`${daemon.url}/api/v1/workspaces/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rbacMode: "off", kanbanPrefix: "" }),
    });
    expect(res.status).toBe(400);
    expect(getWorkspaceRbacMode(daemon.state.daemonDb, row.id)).toBe("enforce");
    expect(daemon.state.workspaces.get(row.id)!.rbacMode).toBe("enforce");
  });
});
