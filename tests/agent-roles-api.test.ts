/**
 * HTTP coverage for the agent role-assignment endpoints landed in
 * RBAC Phase 3 slice 2 (`feature/rbac-phase3-agent-roles-api`).
 *
 * Routes (under `/api/v1/workspaces/:id/agents/:agentId/roles`):
 *   GET  /  list role assignments
 *   PUT  /  replace assignment set ({ role_ids: string[] })
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AUTH_COOKIE_NAME, CSRF_HEADER_NAME } from "../src/auth-session.ts";
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
  daemonHome = await mkdtemp(join(tmpdir(), "wa-home-agent-roles-"));
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

interface SeedHandle {
  wsId: string;
  base: string;
  repoId: string;
  agentId: string;
  roleIdByName: Map<string, string>;
}

async function startWithSeededAgent(): Promise<SeedHandle> {
  daemon = await startAuthedDaemon();
  const row = await createWorkspace(daemon.state.daemonDb, daemon.state.daemonHome, { name: "ws" });
  const ws = loadWorkspaceState(daemon.state.daemonHome, getWorkspace(daemon.state.daemonDb, row.id)!);
  daemon.state.workspaces.set(row.id, ws);
  setCurrentWorkspaceId(daemon.state.daemonDb, row.id);
  daemon.state.currentWorkspaceId = row.id;

  // Seed a workspace_repo + agent so we have a real id to address.
  const now = new Date().toISOString();
  ws.db.run(
    "INSERT INTO workspace_repos (id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at) VALUES ('repo-1', 'r1', '/tmp/r1', NULL, NULL, NULL, ?, ?)",
    [now, now],
  );
  ws.db.run(
    "INSERT INTO agents (id, repo_id, name, host_default, default_host_type, created_at, updated_at) VALUES ('agent-1', 'repo-1', 'alpha', 'claude-code', NULL, ?, ?)",
    [now, now],
  );

  // Capture role ids by name for test reuse.
  const rolesRows = ws.db.query<{ id: string; name: string }, []>(
    "SELECT id, name FROM roles",
  ).all();
  const roleIdByName = new Map(rolesRows.map((r) => [r.name, r.id]));

  return {
    wsId: row.id,
    base: `${daemon!.url}/api/v1/workspaces/${row.id}`,
    repoId: "repo-1",
    agentId: "agent-1",
    roleIdByName,
  };
}

interface AgentRolesBody {
  ok: boolean;
  agentId?: string;
  error?: string;
  roles?: Array<{ role_id: string; name: string; is_builtin: number; assigned_at: string }>;
}

interface RoleCrudBody {
  ok: boolean;
  error?: string;
  role?: { id: string; repoId: string; name: string; hostDefault: string | null; defaultHostType: string | null; persona: Record<string, string> | null };
  roles?: Array<{ id: string; repoId: string; name: string; hostDefault: string | null; defaultHostType: string | null; persona: Record<string, string> | null }>;
}

function rolePersistenceSnapshot(h: SeedHandle): { agents: unknown[]; personas: unknown[] } {
  const ws = daemon!.state.workspaces.get(h.wsId)!;
  return {
    agents: ws.db.query<{ id: string; repo_id: string; name: string; host_default: string; default_host_type: string | null }, []>(
      "SELECT id, repo_id, name, host_default, default_host_type FROM agents ORDER BY id",
    ).all(),
    personas: ws.db.query<{ agent_id: string; description: string; responsibilities: string; boundaries: string; skills: string; working_style: string; extra_prompt: string }, []>(
      "SELECT agent_id, description, responsibilities, boundaries, skills, working_style, extra_prompt FROM agent_personas ORDER BY agent_id",
    ).all(),
  };
}

function seedAgentPersona(h: SeedHandle, fields: Partial<Record<"description" | "responsibilities" | "boundaries" | "skills" | "working_style" | "extra_prompt", string>>): void {
  const ws = daemon!.state.workspaces.get(h.wsId)!;
  const now = new Date().toISOString();
  ws.db.run(
    `INSERT INTO agent_personas (agent_id, description, responsibilities, boundaries, skills, working_style, extra_prompt, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      h.agentId,
      fields.description ?? "",
      fields.responsibilities ?? "",
      fields.boundaries ?? "",
      fields.skills ?? "",
      fields.working_style ?? "",
      fields.extra_prompt ?? "",
      now,
      now,
    ],
  );
}

describe("persona-bearing role CRUD guards (WA-225/WA-226)", () => {
  test("POST /roles-by-id rolls back an over-hard-cap persona create", async () => {
    const h = await startWithSeededAgent();
    const before = rolePersistenceSnapshot(h);
    const beforeList = await fetch(`${h.base}/roles-by-id`).then((r) => r.json()) as RoleCrudBody;

    const res = await fetch(`${h.base}/roles-by-id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId: h.repoId, name: "bad-persona-agent", persona: { extra_prompt: "y".repeat(32_001) } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as RoleCrudBody;
    expect(body.error).toContain("extra_prompt");
    expect(body.error).toContain("32000");

    expect(rolePersistenceSnapshot(h)).toEqual(before);
    const afterList = await fetch(`${h.base}/roles-by-id`).then((r) => r.json()) as RoleCrudBody;
    expect(afterList.roles).toEqual(beforeList.roles);
    expect(afterList.roles?.some((role) => role.name === "bad-persona-agent")).toBe(false);
  });

  test("PATCH /roles-by-id rolls back rename and persona when host validation fails", async () => {
    const h = await startWithSeededAgent();
    seedAgentPersona(h, { description: "before persona" });
    const before = rolePersistenceSnapshot(h);

    const res = await fetch(`${h.base}/roles-by-id/${encodeURIComponent(h.agentId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "renamed", host: "bogus-host", persona: { description: "after persona" } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as RoleCrudBody;
    expect(body.error).toContain("Invalid host type");
    expect(rolePersistenceSnapshot(h)).toEqual(before);
  });

  test("PATCH /roles-by-id rolls back rename and host when persona persistence throws", async () => {
    const h = await startWithSeededAgent();
    seedAgentPersona(h, { description: "before persona" });
    const before = rolePersistenceSnapshot(h);
    const ws = daemon!.state.workspaces.get(h.wsId)!;
    ws.db.run("CREATE TEMP TRIGGER fail_agent_persona_insert BEFORE INSERT ON agent_personas BEGIN SELECT RAISE(ABORT, 'persona persistence failed'); END");
    ws.db.run("CREATE TEMP TRIGGER fail_agent_persona_update BEFORE UPDATE ON agent_personas BEGIN SELECT RAISE(ABORT, 'persona persistence failed'); END");

    const res = await fetch(`${h.base}/roles-by-id/${encodeURIComponent(h.agentId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "renamed", host: "codex", persona: { description: "after persona" } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as RoleCrudBody;
    expect(body.error).toContain("persona persistence failed");
    expect(rolePersistenceSnapshot(h)).toEqual(before);
  });

  test("PATCH /roles-by-id applies rename, host, and persona together on the happy path", async () => {
    const h = await startWithSeededAgent();

    const res = await fetch(`${h.base}/roles-by-id/${encodeURIComponent(h.agentId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "beta", host: "codex", persona: { description: "beta persona", working_style: "focused" } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as RoleCrudBody;
    expect(body.role).toMatchObject({
      id: h.agentId,
      name: "beta",
      hostDefault: "codex",
      defaultHostType: "codex",
      persona: { description: "beta persona", working_style: "focused" },
    });
    expect(rolePersistenceSnapshot(h)).toEqual({
      agents: [{ id: h.agentId, repo_id: h.repoId, name: "beta", host_default: "codex", default_host_type: "codex" }],
      personas: [{ agent_id: h.agentId, description: "beta persona", responsibilities: "", boundaries: "", skills: "", working_style: "focused", extra_prompt: "" }],
    });
  });

  test("persona create and patch reject missing auth, bad CSRF, and wrong Origin", async () => {
    const h = await startWithSeededAgent();
    const createUrl = `${h.base}/roles-by-id`;
    const patchUrl = `${h.base}/roles-by-id/${encodeURIComponent(h.agentId)}`;
    const badOrigin = new URL(daemon!.url);
    badOrigin.port = String(Number(badOrigin.port) + 1);
    const writes = [
      { method: "POST", url: createUrl, body: JSON.stringify({ repoId: h.repoId, name: "persona-create", persona: { description: "create persona" } }) },
      { method: "PATCH", url: patchUrl, body: JSON.stringify({ persona: { description: "patch persona" } }) },
    ];

    for (const write of writes) {
      const unauth = await nativeFetch(write.url, { method: write.method, headers: { "Content-Type": "application/json" }, body: write.body });
      expect([401, 403]).toContain(unauth.status);

      const invalidCookie = await nativeFetch(write.url, { method: write.method, headers: { Cookie: `${AUTH_COOKIE_NAME}=bogus`, "Content-Type": "application/json" }, body: write.body });
      expect([401, 403]).toContain(invalidCookie.status);

      const missingCsrf = await nativeFetch(write.url, { method: write.method, headers: { Cookie: authCookie, "Content-Type": "application/json" }, body: write.body });
      expect(missingCsrf.status).toBe(403);

      const badCsrf = await nativeFetch(write.url, { method: write.method, headers: authedFetchHeaders({ "Content-Type": "application/json", [CSRF_HEADER_NAME]: "bad-token" }, authCookie, write.method), body: write.body });
      expect(badCsrf.status).toBe(403);

      const badOriginRes = await nativeFetch(write.url, { method: write.method, headers: authedFetchHeaders({ "Content-Type": "application/json", Origin: badOrigin.origin }, authCookie, write.method), body: write.body });
      expect(badOriginRes.status).toBe(403);
    }
  });
});

describe("agent role-assignment HTTP endpoints (Phase 3 slice 2)", () => {
  describe("GET /agents/:id/roles", () => {
    test("returns [] for a freshly seeded agent (no roles seeded by name)", async () => {
      const h = await startWithSeededAgent();
      const res = await fetch(`${h.base}/agents/${h.agentId}/roles`);
      expect(res.status).toBe(200);
      const body = await res.json() as AgentRolesBody;
      expect(body.ok).toBe(true);
      expect(body.agentId).toBe(h.agentId);
      expect(body.roles).toEqual([]);
    });

    test("returns rows after PUT", async () => {
      const h = await startWithSeededAgent();
      const engineerId = h.roleIdByName.get("engineer")!;
      await fetch(`${h.base}/agents/${h.agentId}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_ids: [engineerId] }),
      });
      const res = await fetch(`${h.base}/agents/${h.agentId}/roles`);
      const body = await res.json() as AgentRolesBody;
      expect(body.roles).toHaveLength(1);
      expect(body.roles![0]!.name).toBe("engineer");
      expect(body.roles![0]!.is_builtin).toBe(1);
    });

    test("returns 404 for unknown agent_id", async () => {
      const h = await startWithSeededAgent();
      const res = await fetch(`${h.base}/agents/no-such-agent/roles`);
      expect(res.status).toBe(404);
      const body = await res.json() as AgentRolesBody;
      expect(body.error).toContain("agent not found");
    });
  });

  describe("PUT /agents/:id/roles", () => {
    test("assigns a single role and returns the joined assignment row", async () => {
      const h = await startWithSeededAgent();
      const reviewerId = h.roleIdByName.get("reviewer")!;
      const res = await fetch(`${h.base}/agents/${h.agentId}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_ids: [reviewerId] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as AgentRolesBody;
      expect(body.ok).toBe(true);
      expect(body.roles).toHaveLength(1);
      expect(body.roles![0]!.name).toBe("reviewer");
      expect(body.roles![0]!.role_id).toBe(reviewerId);
      expect(body.roles![0]!.assigned_at).toBeTruthy();
    });

    test("replaces the assignment set; old role removed", async () => {
      const h = await startWithSeededAgent();
      const engineerId = h.roleIdByName.get("engineer")!;
      const pmId = h.roleIdByName.get("pm")!;
      await fetch(`${h.base}/agents/${h.agentId}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_ids: [engineerId] }),
      });
      const res = await fetch(`${h.base}/agents/${h.agentId}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_ids: [pmId] }),
      });
      const body = await res.json() as AgentRolesBody;
      expect(body.roles).toHaveLength(1);
      expect(body.roles![0]!.name).toBe("pm");
    });

    test("empty role_ids clears all assignments", async () => {
      const h = await startWithSeededAgent();
      const engineerId = h.roleIdByName.get("engineer")!;
      await fetch(`${h.base}/agents/${h.agentId}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_ids: [engineerId] }),
      });
      const res = await fetch(`${h.base}/agents/${h.agentId}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_ids: [] }),
      });
      const body = await res.json() as AgentRolesBody;
      expect(body.roles).toEqual([]);
    });

    test("dedupes duplicate role_ids in the request body", async () => {
      const h = await startWithSeededAgent();
      const engineerId = h.roleIdByName.get("engineer")!;
      const res = await fetch(`${h.base}/agents/${h.agentId}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_ids: [engineerId, engineerId, engineerId] }),
      });
      const body = await res.json() as AgentRolesBody;
      expect(body.roles).toHaveLength(1);
    });

    test("400 when role_ids is missing", async () => {
      const h = await startWithSeededAgent();
      const res = await fetch(`${h.base}/agents/${h.agentId}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as AgentRolesBody;
      expect(body.error).toContain("role_ids");
    });

    test("400 when role_ids contains non-string", async () => {
      const h = await startWithSeededAgent();
      const res = await fetch(`${h.base}/agents/${h.agentId}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_ids: [123] }),
      });
      expect(res.status).toBe(400);
    });

    test("400 with unknown role id; existing rows preserved", async () => {
      const h = await startWithSeededAgent();
      const engineerId = h.roleIdByName.get("engineer")!;
      await fetch(`${h.base}/agents/${h.agentId}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_ids: [engineerId] }),
      });
      const res = await fetch(`${h.base}/agents/${h.agentId}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_ids: ["not-a-real-id"] }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as AgentRolesBody;
      expect(body.error).toContain("unknown role ids");
      // GET should still show the engineer assignment.
      const getRes = await fetch(`${h.base}/agents/${h.agentId}/roles`);
      const getBody = await getRes.json() as AgentRolesBody;
      expect(getBody.roles).toHaveLength(1);
      expect(getBody.roles![0]!.name).toBe("engineer");
    });

    test("404 when agent_id does not exist", async () => {
      const h = await startWithSeededAgent();
      const engineerId = h.roleIdByName.get("engineer")!;
      const res = await fetch(`${h.base}/agents/no-such-agent/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_ids: [engineerId] }),
      });
      expect(res.status).toBe(404);
    });
  });
});
