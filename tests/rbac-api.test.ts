/**
 * HTTP coverage for the RBAC role + grant endpoints landed in
 * RBAC Phase 2a (`feature/rbac-phase2a-schema-api`).
 *
 * Routes (all under `/api/v1/workspaces/:id/rbac/roles`):
 *   GET    /                  list roles + grants
 *   POST   /                  create custom role
 *   PATCH  /:id                edit name/description (built-in: description only)
 *   DELETE /:id                delete custom role only (409 on built-in)
 *   PUT    /:id/grants         replace role's grant set
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setCurrentWorkspaceId, getWorkspace } from "../src/daemon-db.ts";
import { createWorkspace } from "../src/config.ts";
import { startDaemon, type StartedDaemon } from "../src/server/daemon.ts";
import { loadWorkspaceState } from "../src/server/workspace-state.ts";
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
  daemonHome = await mkdtemp(join(tmpdir(), "wa-home-rbac-"));
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

describe("RBAC role HTTP endpoints (Phase 2a)", () => {
  test("GET /rbac/roles returns 6 builtins with grants", async () => {
    const { base } = await startWithEmptyWorkspace();
    const res = await fetch(`${base}/rbac/roles`);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; roles: Array<{ name: string; is_builtin: number; grants: unknown[] }> };
    expect(body.ok).toBe(true);
    expect(body.roles).toHaveLength(6);
    expect(body.roles.map((r) => r.name).sort()).toEqual([
      "engineer", "operator", "pm", "researcher", "restricted", "reviewer",
    ]);
    for (const r of body.roles) expect(r.is_builtin).toBe(1);
    const pm = body.roles.find((r) => r.name === "pm")!;
    expect(pm.grants.length).toBeGreaterThan(0);
  });

  test("POST /rbac/roles creates a custom role", async () => {
    const { base } = await startWithEmptyWorkspace();
    const res = await fetch(`${base}/rbac/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "release-manager", description: "Coordinates releases" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; role: { name: string; is_builtin: number; description: string } };
    expect(body.role.name).toBe("release-manager");
    expect(body.role.is_builtin).toBe(0);
    expect(body.role.description).toBe("Coordinates releases");
  });

  test("POST /rbac/roles 409 on collision with builtin name", async () => {
    const { base } = await startWithEmptyWorkspace();
    const res = await fetch(`${base}/rbac/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "pm" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("already exists");
  });

  test("POST /rbac/roles 400 on invalid name", async () => {
    const { base } = await startWithEmptyWorkspace();
    const res = await fetch(`${base}/rbac/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bad Name!" }),
    });
    expect(res.status).toBe(400);
  });

  test("PATCH /rbac/roles/:id edits description on a builtin role", async () => {
    const { base } = await startWithEmptyWorkspace();
    const list = await (await fetch(`${base}/rbac/roles`)).json() as { roles: Array<{ id: string; name: string }> };
    const pm = list.roles.find((r) => r.name === "pm")!;
    const res = await fetch(`${base}/rbac/roles/${pm.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "EDITED" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { role: { description: string; name: string } };
    expect(body.role.description).toBe("EDITED");
    expect(body.role.name).toBe("pm");
  });

  test("PATCH /rbac/roles/:id 409 on rename of builtin", async () => {
    const { base } = await startWithEmptyWorkspace();
    const list = await (await fetch(`${base}/rbac/roles`)).json() as { roles: Array<{ id: string; name: string }> };
    const pm = list.roles.find((r) => r.name === "pm")!;
    const res = await fetch(`${base}/rbac/roles/${pm.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "pm-renamed" }),
    });
    expect(res.status).toBe(409);
  });

  test("PATCH /rbac/roles/:id renames a custom role", async () => {
    const { base } = await startWithEmptyWorkspace();
    const created = await (await fetch(`${base}/rbac/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "draft" }),
    })).json() as { role: { id: string } };
    const res = await fetch(`${base}/rbac/roles/${created.role.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "release-manager" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { role: { name: string } };
    expect(body.role.name).toBe("release-manager");
  });

  test("PATCH /rbac/roles/:id 404 on unknown id", async () => {
    const { base } = await startWithEmptyWorkspace();
    const res = await fetch(`${base}/rbac/roles/no-such-id`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "x" }),
    });
    expect(res.status).toBe(404);
  });

  test("DELETE /rbac/roles/:id 409 on builtin", async () => {
    const { base } = await startWithEmptyWorkspace();
    const list = await (await fetch(`${base}/rbac/roles`)).json() as { roles: Array<{ id: string; name: string }> };
    const pm = list.roles.find((r) => r.name === "pm")!;
    const res = await fetch(`${base}/rbac/roles/${pm.id}`, { method: "DELETE" });
    expect(res.status).toBe(409);
  });

  test("DELETE /rbac/roles/:id removes a custom role", async () => {
    const { base } = await startWithEmptyWorkspace();
    const created = await (await fetch(`${base}/rbac/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "draft" }),
    })).json() as { role: { id: string } };
    const res = await fetch(`${base}/rbac/roles/${created.role.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    // Now gone from the list.
    const after = await (await fetch(`${base}/rbac/roles`)).json() as { roles: Array<{ id: string }> };
    expect(after.roles.find((r) => r.id === created.role.id)).toBeUndefined();
  });

  test("DELETE /rbac/roles/:id 404 on unknown id", async () => {
    const { base } = await startWithEmptyWorkspace();
    const res = await fetch(`${base}/rbac/roles/no-such-id`, { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  test("PUT /rbac/roles/:id/grants replaces grant set", async () => {
    const { base } = await startWithEmptyWorkspace();
    const created = await (await fetch(`${base}/rbac/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "draft" }),
    })).json() as { role: { id: string } };
    const res = await fetch(`${base}/rbac/roles/${created.role.id}/grants`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grants: [
          { grant_kind: "tool_family", grant_value: "messaging" },
          { grant_kind: "tool_family", grant_value: "channel" },
          { grant_kind: "kanban_action", grant_value: "comment_task", scope_qualifier: "own_assignment" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { role: { grants: Array<{ grant_kind: string; grant_value: string; scope_qualifier: string | null }> } };
    expect(body.role.grants).toHaveLength(3);
    const tools = body.role.grants.filter((g) => g.grant_kind === "tool_family").map((g) => g.grant_value).sort();
    expect(tools).toEqual(["channel", "messaging"]);
    const scoped = body.role.grants.find((g) => g.grant_kind === "kanban_action");
    expect(scoped?.scope_qualifier).toBe("own_assignment");
  });

  test("PUT /rbac/roles/:id/grants on builtin: edits a builtin role's grants", async () => {
    const { base } = await startWithEmptyWorkspace();
    const list = await (await fetch(`${base}/rbac/roles`)).json() as { roles: Array<{ id: string; name: string }> };
    const restricted = list.roles.find((r) => r.name === "restricted")!;
    const res = await fetch(`${base}/rbac/roles/${restricted.id}/grants`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grants: [{ grant_kind: "tool_family", grant_value: "summary" }] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { role: { grants: unknown[] } };
    expect(body.role.grants).toHaveLength(1);
  });

  test("PUT /rbac/roles/:id/grants 400 on missing grants array", async () => {
    const { base } = await startWithEmptyWorkspace();
    const list = await (await fetch(`${base}/rbac/roles`)).json() as { roles: Array<{ id: string; name: string }> };
    const pm = list.roles.find((r) => r.name === "pm")!;
    const res = await fetch(`${base}/rbac/roles/${pm.id}/grants`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("PUT /rbac/roles/:id/grants 400 on malformed grant entry", async () => {
    const { base } = await startWithEmptyWorkspace();
    const list = await (await fetch(`${base}/rbac/roles`)).json() as { roles: Array<{ id: string; name: string }> };
    const pm = list.roles.find((r) => r.name === "pm")!;
    const res = await fetch(`${base}/rbac/roles/${pm.id}/grants`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grants: [{ grant_kind: "tool_family" }] }),
    });
    expect(res.status).toBe(400);
  });

  test("PUT /rbac/roles/:id/grants 404 on unknown id", async () => {
    const { base } = await startWithEmptyWorkspace();
    const res = await fetch(`${base}/rbac/roles/no-such-id/grants`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grants: [] }),
    });
    expect(res.status).toBe(404);
  });

  test("unauthenticated requests are blocked at auth gate", async () => {
    const { base } = await startWithEmptyWorkspace();
    // Drop the auth cookie for one fetch.
    const noAuthFetch = nativeFetch;
    const res = await noAuthFetch(`${base}/rbac/roles`);
    // Auth-gated routes return 401 or 302 (login redirect) — either is non-200.
    expect(res.status).not.toBe(200);
  });
});
