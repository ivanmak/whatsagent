import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { migrate, openFleetDb } from "../src/db.ts";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wa-mig15-"));
  dbPath = join(dir, "ws.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function tableInfo(db: ReturnType<typeof openFleetDb>, name: string) {
  return db.query<{ name: string; type: string; notnull: number }, []>(`PRAGMA table_info(${name})`).all();
}

function tableNames(db: ReturnType<typeof openFleetDb>): string[] {
  return db.query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  ).all().map((r) => r.name);
}

function fkTarget(db: ReturnType<typeof openFleetDb>, fromTable: string, fromColumn: string): string | undefined {
  return db.query<{ table: string; from: string; to: string; on_delete: string }, []>(
    `PRAGMA foreign_key_list(${fromTable})`,
  ).all().find((f) => f.from === fromColumn)?.table;
}

function seedAgent(db: ReturnType<typeof openFleetDb>, repoId: string, agentId: string, agentName: string) {
  const now = new Date().toISOString();
  db.run("INSERT INTO workspace_repos (id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)",
    [repoId, repoId + "-name", "/tmp/" + repoId, now, now]);
  db.run("INSERT INTO agents (id, repo_id, name, host_default, default_host_type, created_at, updated_at) VALUES (?, ?, ?, 'claude-code', NULL, ?, ?)",
    [agentId, repoId, agentName, now, now]);
}

/**
 * Roll a fully-migrated DB back to pre-v15 state so seed-on-existing-agents
 * tests can populate agents BEFORE migration 15 runs. Inverse of
 * applyMigration15.
 */
function rollbackV15(db: ReturnType<typeof openFleetDb>): void {
  db.transaction(() => {
    db.run("DROP TABLE IF EXISTS role_grants");
    db.run("DROP TABLE IF EXISTS agent_roles");
    db.run("DROP TABLE IF EXISTS roles");
    db.run("DELETE FROM schema_migrations WHERE version = 15");
  })();
}

describe("workspace-db migration 15 — RBAC Phase 2a (RBAC schema + builtin seed)", () => {
  test("fresh DB after migrate has rbac tables: roles, agent_roles, role_grants", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const tables = tableNames(db);
      expect(tables).toContain("roles");
      expect(tables).toContain("agent_roles");
      expect(tables).toContain("role_grants");
    } finally {
      db.close();
    }
  });

  test("roles table shape: id, name, description, is_builtin, timestamps", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const cols = tableInfo(db, "roles").map((c) => c.name).sort();
      expect(cols).toEqual([
        "created_at", "description", "id", "is_builtin", "name", "updated_at",
      ]);
    } finally {
      db.close();
    }
  });

  test("agent_roles FKs: agent_id → agents (CASCADE), role_id → roles (RESTRICT)", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      expect(fkTarget(db, "agent_roles", "agent_id")).toBe("agents");
      expect(fkTarget(db, "agent_roles", "role_id")).toBe("roles");
    } finally {
      db.close();
    }
  });

  test("role_grants FK to roles + UNIQUE on (role_id, grant_kind, grant_value, scope_qualifier-coalesced)", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      expect(fkTarget(db, "role_grants", "role_id")).toBe("roles");
      // Insert a builtin role's grant pair, then re-insert same to assert UNIQUE blocks.
      const pmRoleId = db.query<{ id: string }, []>("SELECT id FROM roles WHERE name = 'pm'").get()?.id;
      expect(pmRoleId).toBeDefined();
      // Try to dup an existing PM grant (e.g. messaging tool_family).
      expect(() =>
        db.run(
          "INSERT INTO role_grants (id, role_id, grant_kind, grant_value, scope_qualifier, created_at) VALUES (?, ?, 'tool_family', 'messaging', NULL, ?)",
          ["dup-test-id", pmRoleId!, new Date().toISOString()],
        ),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  test("seeds 6 builtin roles by name with is_builtin=1", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const builtins = db.query<{ name: string; is_builtin: number }, []>(
        "SELECT name, is_builtin FROM roles WHERE is_builtin = 1 ORDER BY name",
      ).all();
      expect(builtins.map((r) => r.name)).toEqual([
        "engineer", "operator", "pm", "researcher", "restricted", "reviewer",
      ]);
      for (const r of builtins) expect(r.is_builtin).toBe(1);
    } finally {
      db.close();
    }
  });

  test("seeds expected grants for `pm` role (full coordination)", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const grants = db.query<{ kind: string; value: string }, []>(
        `SELECT grant_kind AS kind, grant_value AS value FROM role_grants
         WHERE role_id = (SELECT id FROM roles WHERE name = 'pm')
         ORDER BY grant_kind, grant_value`,
      ).all();
      // Sanity-check key markers per spec: kanban-admin tool family, verdict comments, broadcast, audit_admin.
      const tooling = grants.filter((g) => g.kind === "tool_family").map((g) => g.value);
      expect(tooling).toContain("kanban-admin");
      expect(tooling).toContain("messaging");
      const comments = grants.filter((g) => g.kind === "comment_type").map((g) => g.value);
      expect(comments).toContain("verdict_go");
      expect(comments).toContain("verdict_no_go");
      const channels = grants.filter((g) => g.kind === "channel_action").map((g) => g.value);
      expect(channels).toContain("broadcast_message");
      const audits = grants.filter((g) => g.kind === "audit_grant").map((g) => g.value);
      expect(audits).toContain("audit_admin");
      // Status mutations: pm must carry unrestricted update_task_status +
      // update_epic_status to preserve current Star-policy main-can-do-all
      // behavior once Phase 4 enforcement maps these tools to grants.
      const kanbanActions = grants.filter((g) => g.kind === "kanban_action").map((g) => g.value);
      expect(kanbanActions).toContain("update_task_status");
      expect(kanbanActions).toContain("update_epic_status");
      expect(kanbanActions).toContain("request_epic_close");
      expect(kanbanActions).toContain("cancel_epic_close");
    } finally {
      db.close();
    }
  });

  test("seeds engineer with own_assignment scope qualifier on status + close-approval grants", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const scoped = db.query<{ value: string; scope: string | null }, []>(
        `SELECT grant_value AS value, scope_qualifier AS scope FROM role_grants
         WHERE role_id = (SELECT id FROM roles WHERE name = 'engineer')
           AND grant_kind = 'kanban_action'
         ORDER BY grant_value, scope_qualifier`,
      ).all();
      const updateStatus = scoped.find((g) => g.value === "update_task_status");
      expect(updateStatus?.scope).toBe("own_assignment");
      // Engineer-as-assignee can drive epic status + close-approval per
      // current Star-policy assignee fallthrough; pin those grants too.
      const updateEpicStatus = scoped.find((g) => g.value === "update_epic_status");
      expect(updateEpicStatus?.scope).toBe("own_assignment");
      const requestClose = scoped.find((g) => g.value === "request_epic_close");
      expect(requestClose?.scope).toBe("own_assignment");
      const cancelClose = scoped.find((g) => g.value === "cancel_epic_close");
      expect(cancelClose?.scope).toBe("own_assignment");
      // comment_task scoped both to own_assignment and created_by_self.
      const commentTaskScopes = scoped.filter((g) => g.value === "comment_task").map((g) => g.scope).sort();
      expect(commentTaskScopes).toEqual(["created_by_self", "own_assignment"]);
    } finally {
      db.close();
    }
  });

  test("operator role has only the meta=is_operator_surrogate grant", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const grants = db.query<{ kind: string; value: string }, []>(
        `SELECT grant_kind AS kind, grant_value AS value FROM role_grants
         WHERE role_id = (SELECT id FROM roles WHERE name = 'operator')`,
      ).all();
      expect(grants).toHaveLength(1);
      expect(grants[0]).toEqual({ kind: "meta", value: "is_operator_surrogate" });
    } finally {
      db.close();
    }
  });

  test("restricted role: summary + kanban-read + channel-read tool families and channel read/search actions", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const grants = db.query<{ kind: string; value: string }, []>(
        `SELECT grant_kind AS kind, grant_value AS value FROM role_grants
         WHERE role_id = (SELECT id FROM roles WHERE name = 'restricted')
         ORDER BY grant_kind, grant_value`,
      ).all();
      expect(grants).toEqual([
        { kind: "channel_action", value: "read_channel_messages" },
        { kind: "channel_action", value: "search_channel_messages" },
        { kind: "tool_family", value: "channel-read" },
        { kind: "tool_family", value: "kanban-read" },
        { kind: "tool_family", value: "summary" },
      ]);
    } finally {
      db.close();
    }
  });

  test("seeds agent_roles for pre-existing agents using name → roles map", () => {
    // Pre-populate `agents` rows BEFORE v15 fires, then run v15 to seed
    // agent_roles. Tests the actual seed path that production hits on first
    // boot at master-HEAD with an existing fleet.
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      rollbackV15(db);
      seedAgent(db, "repo-1", "agent-main", "main");
      seedAgent(db, "repo-2", "agent-worker", "worker");
      seedAgent(db, "repo-3", "agent-advisor", "advisor");
      seedAgent(db, "repo-4", "agent-researcher", "researcher");
      seedAgent(db, "repo-5", "agent-other", "exploratory");
      // Re-run migrate so applyMigration15 fires against pre-existing agents.
      migrate(db);

      const assignmentsByName = (agentName: string) => db.query<{ role_name: string }, [string]>(
        `SELECT roles.name AS role_name FROM agent_roles
         JOIN agents ON agents.id = agent_roles.agent_id
         JOIN roles ON roles.id = agent_roles.role_id
         WHERE agents.name = ?
         ORDER BY roles.name`,
      ).all(agentName).map((r) => r.role_name);

      expect(assignmentsByName("main")).toEqual(["operator", "pm"]);
      expect(assignmentsByName("worker")).toEqual(["engineer"]);
      expect(assignmentsByName("advisor")).toEqual(["engineer", "reviewer"]);
      expect(assignmentsByName("researcher")).toEqual(["researcher"]);
      // Fallback for non-known names → `engineer`.
      expect(assignmentsByName("exploratory")).toEqual(["engineer"]);
    } finally {
      db.close();
    }
  });

  test("seed builtin role names cannot be re-inserted (UNIQUE name)", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      expect(() =>
        db.run(
          "INSERT INTO roles (id, name, description, is_builtin, created_at, updated_at) VALUES (?, 'pm', 'dup', 0, ?, ?)",
          ["dup-id", new Date().toISOString(), new Date().toISOString()],
        ),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  test("re-running migrate is a no-op (v15 recorded once)", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const before = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM role_grants").get()?.count ?? 0;
      migrate(db);
      const after = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM role_grants").get()?.count ?? 0;
      expect(after).toBe(before);
      const v15Stamps = db.query<{ count: number }, []>(
        "SELECT COUNT(*) as count FROM schema_migrations WHERE version = 15",
      ).get()?.count;
      expect(v15Stamps).toBe(1);
    } finally {
      db.close();
    }
  });
});
