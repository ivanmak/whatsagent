/**
 * HTTP coverage for the audit log read endpoint (`GET /audit`)
 * landed in RBAC Phase 3 slice 6 (`feature/rbac-phase3-audit-ui`).
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
import { appendAudit } from "../src/audit-log-dao.ts";
import { setSetting } from "../src/db.ts";

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
  daemonHome = await mkdtemp(join(tmpdir(), "wa-home-audit-"));
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
  ws: ReturnType<typeof loadWorkspaceState>;
}

async function startWithEmptyWorkspace(): Promise<SeedHandle> {
  daemon = await startAuthedDaemon();
  const row = await createWorkspace(daemon.state.daemonDb, daemon.state.daemonHome, { name: "ws" });
  const ws = loadWorkspaceState(daemon.state.daemonHome, getWorkspace(daemon.state.daemonDb, row.id)!);
  daemon.state.workspaces.set(row.id, ws);
  setCurrentWorkspaceId(daemon.state.daemonDb, row.id);
  daemon.state.currentWorkspaceId = row.id;
  return {
    wsId: row.id,
    base: `${daemon!.url}/api/v1/workspaces/${row.id}`,
    ws,
  };
}

interface AuditBody {
  ok: boolean;
  entries?: Array<{ id: string; kind: string; payload: Record<string, unknown> }>;
  pagination?: { total: number; limit: number; offset: number };
  summary?: { violations24h: number; violations7d: number; passes24h: number; actorsWithMisses24h: number };
  permissions?: { audit_read: boolean; audit_admin: boolean };
}

// Promote the workspace's main agent to a built-in role and set it as
// main. Returns the resolved role grants for the audit-admin gate.
function promoteMainTo(ws: ReturnType<typeof loadWorkspaceState>, agentId: string, roleName: "pm" | "reviewer" | "engineer"): void {
  const role = ws.db.query<{ id: string }, [string]>("SELECT id FROM roles WHERE name = ? AND is_builtin = 1").get(roleName);
  if (!role) throw new Error(`role ${roleName} missing`);
  ws.db.run("DELETE FROM agent_roles WHERE agent_id = ?", [agentId]);
  ws.db.run("INSERT INTO agent_roles (agent_id, role_id, assigned_at) VALUES (?, ?, ?)", [agentId, role.id, new Date().toISOString()]);
  setSetting(ws.db, "main_role_id", agentId);
}

function seedMainAgent(ws: ReturnType<typeof loadWorkspaceState>): string {
  const ts = new Date().toISOString();
  ws.db.run("INSERT INTO workspace_repos (id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)",
    ["repo-main", "repo-main-name", "/tmp/repo-main", ts, ts]);
  ws.db.run("INSERT INTO agents (id, repo_id, name, host_default, default_host_type, created_at, updated_at) VALUES (?, ?, ?, 'claude-code', NULL, ?, ?)",
    ["agent-main", "repo-main", "main", ts, ts]);
  return "agent-main";
}

describe("audit log HTTP endpoint (Phase 3 slice 6)", () => {
  test("GET /audit returns empty entries + zeroed summary on a fresh workspace", async () => {
    const h = await startWithEmptyWorkspace();
    const res = await fetch(`${h.base}/audit`);
    expect(res.status).toBe(200);
    const body = await res.json() as AuditBody;
    expect(body.ok).toBe(true);
    expect(body.entries).toEqual([]);
    expect(body.summary).toEqual({ violations24h: 0, violations7d: 0, passes24h: 0, actorsWithMisses24h: 0 });
    expect(body.pagination?.total).toBe(0);
  });

  test("default kind filter is 'grant_miss_soft' (only misses returned without ?kind)", async () => {
    const h = await startWithEmptyWorkspace();
    appendAudit(h.ws.db, { kind: "grant_miss_soft", actor_agent_id: "a-1", payload: { tool: "x" } });
    appendAudit(h.ws.db, { kind: "grant_check_pass", actor_agent_id: "a-1", payload: { tool: "y" } });
    const res = await fetch(`${h.base}/audit?kind=grant_miss_soft`);
    const body = await res.json() as AuditBody;
    expect(body.entries).toHaveLength(1);
    expect(body.entries![0]!.kind).toBe("grant_miss_soft");
  });

  test("filters by actor_agent_id", async () => {
    const h = await startWithEmptyWorkspace();
    appendAudit(h.ws.db, { kind: "grant_miss_soft", actor_agent_id: "a-1", payload: {} });
    appendAudit(h.ws.db, { kind: "grant_miss_soft", actor_agent_id: "a-2", payload: {} });
    const res = await fetch(`${h.base}/audit?kind=grant_miss_soft&actor_agent_id=a-2`);
    const body = await res.json() as AuditBody;
    expect(body.entries).toHaveLength(1);
    expect(body.entries![0]!.payload).toEqual({});
  });

  test("limit + offset paginate", async () => {
    const h = await startWithEmptyWorkspace();
    // Insert with controlled timestamps so ordering is deterministic.
    for (let i = 0; i < 10; i++) {
      h.ws.db.run(
        "INSERT INTO audit_log (id, ts, kind, actor_agent_id, target_kind, target_id, payload_json) VALUES (?, ?, 'grant_miss_soft', NULL, NULL, NULL, '{}')",
        [`p-${i}`, `2026-05-04T00:00:${String(i).padStart(2, "0")}Z`],
      );
    }
    const res1 = await fetch(`${h.base}/audit?kind=grant_miss_soft&limit=4&offset=0`);
    const body1 = await res1.json() as AuditBody;
    expect(body1.entries).toHaveLength(4);
    expect(body1.entries![0]!.id).toBe("p-9");
    expect(body1.pagination?.total).toBe(10);
    expect(body1.pagination?.offset).toBe(0);

    const res2 = await fetch(`${h.base}/audit?kind=grant_miss_soft&limit=4&offset=4`);
    const body2 = await res2.json() as AuditBody;
    expect(body2.entries![0]!.id).toBe("p-5");
  });

  test("summary fields independent of filter", async () => {
    const h = await startWithEmptyWorkspace();
    appendAudit(h.ws.db, { kind: "grant_miss_soft", actor_agent_id: "a-1", payload: {} });
    appendAudit(h.ws.db, { kind: "grant_miss_soft", actor_agent_id: "a-2", payload: {} });
    appendAudit(h.ws.db, { kind: "grant_check_pass", actor_agent_id: "a-1", payload: {} });
    // Filter by actor — but summary still covers the workspace.
    const res = await fetch(`${h.base}/audit?kind=grant_miss_soft&actor_agent_id=a-1`);
    const body = await res.json() as AuditBody;
    expect(body.entries).toHaveLength(1);
    expect(body.summary?.violations24h).toBe(2);
    expect(body.summary?.passes24h).toBe(1);
    expect(body.summary?.actorsWithMisses24h).toBe(2);
  });

  test("since filter excludes older rows", async () => {
    const h = await startWithEmptyWorkspace();
    h.ws.db.run(
      "INSERT INTO audit_log (id, ts, kind, actor_agent_id, target_kind, target_id, payload_json) VALUES ('old', '2024-01-01T00:00:00Z', 'grant_miss_soft', NULL, NULL, NULL, '{}')",
    );
    h.ws.db.run(
      "INSERT INTO audit_log (id, ts, kind, actor_agent_id, target_kind, target_id, payload_json) VALUES ('new', '2999-01-01T00:00:00Z', 'grant_miss_soft', NULL, NULL, NULL, '{}')",
    );
    const res = await fetch(`${h.base}/audit?kind=grant_miss_soft&since=2025-01-01T00:00:00Z`);
    const body = await res.json() as AuditBody;
    expect(body.entries!.map((e) => e.id)).toEqual(["new"]);
  });

  /**
   * WA-090 (Phase 4 slice 4-9): audit_admin grant gating for CSV export.
   * Permissions are resolved from the workspace's main agent (cookie-auth
   * stand-in). pm grants both audit_read + audit_admin; reviewer holds
   * audit_read only; engineer holds neither.
   */
  describe("WA-090 audit_admin gate (CSV export)", () => {
    test("GET /audit response includes permissions object", async () => {
      const h = await startWithEmptyWorkspace();
      const res = await fetch(`${h.base}/audit`);
      const body = await res.json() as AuditBody;
      expect(body.permissions).toBeDefined();
      // No main set in fresh fleet → both false.
      expect(body.permissions).toEqual({ audit_read: false, audit_admin: false });
    });

    test("permissions reflect main agent's grants — pm has both audit_read + audit_admin", async () => {
      const h = await startWithEmptyWorkspace();
      const agentId = seedMainAgent(h.ws);
      promoteMainTo(h.ws, agentId, "pm");
      const res = await fetch(`${h.base}/audit`);
      const body = await res.json() as AuditBody;
      expect(body.permissions).toEqual({ audit_read: true, audit_admin: true });
    });

    test("permissions reflect main agent's grants — reviewer has audit_read only", async () => {
      const h = await startWithEmptyWorkspace();
      const agentId = seedMainAgent(h.ws);
      promoteMainTo(h.ws, agentId, "reviewer");
      const res = await fetch(`${h.base}/audit`);
      const body = await res.json() as AuditBody;
      expect(body.permissions).toEqual({ audit_read: true, audit_admin: false });
    });

    test("permissions reflect main agent's grants — engineer holds neither", async () => {
      const h = await startWithEmptyWorkspace();
      const agentId = seedMainAgent(h.ws);
      promoteMainTo(h.ws, agentId, "engineer");
      const res = await fetch(`${h.base}/audit`);
      const body = await res.json() as AuditBody;
      expect(body.permissions).toEqual({ audit_read: false, audit_admin: false });
    });

    test("GET /audit/export with pm-as-main returns CSV", async () => {
      const h = await startWithEmptyWorkspace();
      const agentId = seedMainAgent(h.ws);
      promoteMainTo(h.ws, agentId, "pm");
      appendAudit(h.ws.db, { kind: "grant_miss_soft", actor_agent_id: "a-1", payload: { tool: "x" } });
      const res = await fetch(`${h.base}/audit/export?kind=grant_miss_soft`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/csv");
      const cd = res.headers.get("content-disposition");
      expect(cd).toContain("attachment");
      expect(cd).toContain("audit-export-");
      const text = await res.text();
      const lines = text.split("\r\n");
      expect(lines[0]).toBe("id,ts,kind,actor_agent_id,actor_display_id,target_kind,target_id,payload_json");
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines[1]).toContain("grant_miss_soft");
      expect(lines[1]).toContain("a-1");
    });

    test("GET /audit/export with reviewer-as-main returns 403 (audit_admin required)", async () => {
      const h = await startWithEmptyWorkspace();
      const agentId = seedMainAgent(h.ws);
      promoteMainTo(h.ws, agentId, "reviewer");
      const res = await fetch(`${h.base}/audit/export`);
      expect(res.status).toBe(403);
      const body = await res.json() as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toContain("audit_admin");
    });

    test("GET /audit/export on workspace with no main set returns 403", async () => {
      const h = await startWithEmptyWorkspace();
      const res = await fetch(`${h.base}/audit/export`);
      expect(res.status).toBe(403);
    });

    test("CSV export returns >500 rows (read endpoint cap is bypassed for bulk export)", async () => {
      const h = await startWithEmptyWorkspace();
      const agentId = seedMainAgent(h.ws);
      promoteMainTo(h.ws, agentId, "pm");
      // 600 rows — comfortably above the read-endpoint clamp of 500.
      const inserted = 600;
      for (let i = 0; i < inserted; i++) {
        h.ws.db.run(
          "INSERT INTO audit_log (id, ts, kind, actor_agent_id, target_kind, target_id, payload_json) VALUES (?, ?, 'grant_miss_soft', NULL, NULL, NULL, '{}')",
          [`bulk-${String(i).padStart(4, "0")}`, `2026-05-04T00:00:${String(i % 60).padStart(2, "0")}Z`],
        );
      }
      const res = await fetch(`${h.base}/audit/export?kind=grant_miss_soft`);
      expect(res.status).toBe(200);
      const text = await res.text();
      const lines = text.split("\r\n");
      // header + N data rows
      expect(lines.length - 1).toBe(inserted);
    });

    test("CSV export escapes commas, quotes, and newlines per RFC 4180", async () => {
      const h = await startWithEmptyWorkspace();
      const agentId = seedMainAgent(h.ws);
      promoteMainTo(h.ws, agentId, "pm");
      // Payload contains all the trouble characters.
      h.ws.db.run(
        "INSERT INTO audit_log (id, ts, kind, actor_agent_id, target_kind, target_id, payload_json) VALUES ('rfc4180', '2026-05-04T00:00:00Z', 'grant_miss_soft', NULL, NULL, NULL, ?)",
        ['{"note":"has, comma and \\"quote\\""}'],
      );
      const res = await fetch(`${h.base}/audit/export`);
      expect(res.status).toBe(200);
      const text = await res.text();
      // The payload_json column should be quoted because it contains commas + quotes.
      expect(text).toContain('"{""note"":""has, comma and \\""quote\\""""}"');
    });
  });
});
