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
