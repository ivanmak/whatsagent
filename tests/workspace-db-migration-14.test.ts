import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { migrate, openFleetDb } from "../src/db.ts";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wa-mig14-"));
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

function seedRepoAndAgent(db: ReturnType<typeof openFleetDb>, repoId: string, agentId: string, agentName: string) {
  const now = new Date().toISOString();
  db.run("INSERT INTO workspace_repos (id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)",
    [repoId, repoId + "-name", "/tmp/" + repoId, now, now]);
  db.run("INSERT INTO agents (id, repo_id, name, host_default, default_host_type, created_at, updated_at) VALUES (?, ?, ?, 'claude-code', NULL, ?, ?)",
    [agentId, repoId, agentName, now, now]);
}

/**
 * Roll a fully-migrated DB back to pre-v14 state so survival tests can
 * insert pre-rename rows against `roles` / `role_locks` / `runners.role_id`,
 * then re-run `migrate()` to drive applyMigration14 and assert that rows
 * persist intact through the rename. Inverse of applyMigration14.
 *
 * Also drops the RBAC tables introduced in v15 (`roles`, `agent_roles`,
 * `role_grants`) BEFORE reversing v14 — otherwise the `agents` → `roles`
 * rename collides with the new RBAC `roles` table created by v15.
 */
function rollbackV14(db: ReturnType<typeof openFleetDb>): void {
  db.run("PRAGMA foreign_keys = OFF");
  try {
    db.transaction(() => {
      // Drop v15 first so the v14 `agents` → `roles` rename has no collision.
      db.run("DROP TABLE IF EXISTS role_grants");
      db.run("DROP TABLE IF EXISTS agent_roles");
      db.run("DROP TABLE IF EXISTS roles"); // the RBAC one introduced in v15
      db.run("DELETE FROM schema_migrations WHERE version = 15");
      // Reverse v14 ALTERs.
      db.run("ALTER TABLE agents RENAME TO roles");
      db.run("ALTER TABLE agent_locks RENAME COLUMN agent_id TO role_id");
      db.run("ALTER TABLE agent_locks RENAME TO role_locks");
      db.run("ALTER TABLE runners RENAME COLUMN agent_id TO role_id");
      db.run("DELETE FROM schema_migrations WHERE version = 14");
    })();
  } finally {
    db.run("PRAGMA foreign_keys = ON");
  }
}

describe("workspace-db migration 14 — RBAC Phase 1 rename (roles → agents)", () => {
  test("fresh DB after migrate has agents (not the legacy identity `roles`) + agent_locks (not role_locks)", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const tables = tableNames(db);
      expect(tables).toContain("agents");
      expect(tables).toContain("agent_locks");
      expect(tables).not.toContain("role_locks");
      // Post-v15 a NEW `roles` table exists for RBAC permission sets — that
      // is NOT the legacy identity table (which was renamed to `agents` in
      // v14). Distinguish by shape: RBAC roles have `is_builtin` column;
      // identity rows do not. The test only fires post-migrate to head.
      const roleCols = tableInfo(db, "roles").map((c) => c.name);
      expect(roleCols).toContain("is_builtin");
      expect(roleCols).not.toContain("repo_id");
    } finally {
      db.close();
    }
  });

  test("agent_locks column rename: agent_id (not role_id)", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const cols = tableInfo(db, "agent_locks").map((c) => c.name);
      expect(cols).toContain("agent_id");
      expect(cols).not.toContain("role_id");
    } finally {
      db.close();
    }
  });

  test("runners.role_id renamed to runners.agent_id", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const cols = tableInfo(db, "runners").map((c) => c.name);
      expect(cols).toContain("agent_id");
      expect(cols).not.toContain("role_id");
    } finally {
      db.close();
    }
  });

  test("FK arrows on dependent tables auto-updated to agents", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      // Lockout-risk surfaces called out by advisor: sessions + launch_tokens.
      // FK column names retained at legacy `role_id` per pragmatic narrowing,
      // but FK target table must point at the renamed `agents`.
      expect(fkTarget(db, "sessions", "role_id")).toBe("agents");
      expect(fkTarget(db, "launch_tokens", "role_id")).toBe("agents");
      // Other dependents.
      expect(fkTarget(db, "messages", "to_role_id")).toBe("agents");
      expect(fkTarget(db, "messages", "from_role_id")).toBe("agents");
      expect(fkTarget(db, "kanban_tasks", "assigned_role_id")).toBe("agents");
      expect(fkTarget(db, "kanban_tasks", "created_by_role_id")).toBe("agents");
      expect(fkTarget(db, "agent_locks", "agent_id")).toBe("agents");
      expect(fkTarget(db, "runners", "agent_id")).toBe("agents");
    } finally {
      db.close();
    }
  });

  test("re-running migrate is a no-op", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      migrate(db);
      const versions = db.query<{ version: number }, []>(
        "SELECT version FROM schema_migrations ORDER BY version",
      ).all().map((v) => v.version);
      expect(versions).toContain(14);
      // Idempotent: 14 only appears once.
      expect(versions.filter((v) => v === 14)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  test("session rows survive migration 14 (lockout-risk surface — advisor ask)", () => {
    // Build a real pre-v14 fixture: migrate to head, roll v14 back, insert
    // rows against the legacy `roles` table, then re-run migrate() so v14
    // applies for-real against pre-existing rows. Asserts both row data
    // and FK arrow rewrite. (Pre-fix this test inserted AFTER v14 already
    // ran, which only proved row stability across no-op re-migrate, not
    // survival through the actual rename — caught by advisor msg id=314.)
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      rollbackV14(db);
      // Now at pre-v14 state: tables `roles`, `role_locks`, `runners.role_id`.
      // Pre-insert a workspace_repos row + role row (legacy table name) so
      // sessions FK to roles(id) is satisfied.
      const now = new Date().toISOString();
      db.run("INSERT INTO workspace_repos (id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)",
        ["repo-A", "repo-A-name", "/tmp/repo-A", now, now]);
      db.run("INSERT INTO roles (id, repo_id, name, host_default, default_host_type, created_at, updated_at) VALUES (?, ?, ?, 'claude-code', NULL, ?, ?)",
        ["agent-A", "repo-A", "main", now, now]);
      db.run(
        `INSERT INTO sessions (id, role_id, host_type, runner_pid, status, cwd, started_at, last_seen, summary)
         VALUES ('sess-1', 'agent-A', 'claude-code', 1234, 'running', '/tmp/x', ?, ?, '')`,
        [now, now],
      );
      // Drive v14 against the populated pre-rename state.
      migrate(db);
      // Row survives, FK column kept legacy name, FK arrow points at agents.
      const sess = db.query<{ id: string; role_id: string }, []>(
        "SELECT id, role_id FROM sessions WHERE id = 'sess-1'",
      ).get();
      expect(sess).toEqual({ id: "sess-1", role_id: "agent-A" });
      expect(fkTarget(db, "sessions", "role_id")).toBe("agents");
      // Confirm we actually did re-apply v14 (the schema_migrations row is back).
      const v14Rows = db.query<{ count: number }, []>(
        "SELECT COUNT(*) as count FROM schema_migrations WHERE version = 14",
      ).get();
      expect(v14Rows?.count).toBe(1);
    } finally {
      db.close();
    }
  });

  test("launch_token rows survive migration 14 (lockout-risk surface — advisor ask)", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      rollbackV14(db);
      const now = new Date().toISOString();
      const expires = new Date(Date.now() + 600_000).toISOString();
      db.run("INSERT INTO workspace_repos (id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)",
        ["repo-B", "repo-B-name", "/tmp/repo-B", now, now]);
      db.run("INSERT INTO roles (id, repo_id, name, host_default, default_host_type, created_at, updated_at) VALUES (?, ?, ?, 'claude-code', NULL, ?, ?)",
        ["agent-B", "repo-B", "worker", now, now]);
      db.run(
        `INSERT INTO sessions (id, role_id, host_type, status, cwd, started_at, last_seen, summary)
         VALUES ('sess-tok', 'agent-B', 'claude-code', 'running', '/tmp/y', ?, ?, '')`,
        [now, now],
      );
      db.run(
        `INSERT INTO launch_tokens (id, role_id, session_id, token_hash, expires_at, consumed_at)
         VALUES ('tok-1', 'agent-B', 'sess-tok', 'h0t-h4sh', ?, NULL)`,
        [expires],
      );
      // Drive v14 against the populated pre-rename state.
      migrate(db);
      const tok = db.query<{ id: string; role_id: string; token_hash: string }, []>(
        "SELECT id, role_id, token_hash FROM launch_tokens WHERE id = 'tok-1'",
      ).get();
      expect(tok).toEqual({ id: "tok-1", role_id: "agent-B", token_hash: "h0t-h4sh" });
      expect(fkTarget(db, "launch_tokens", "role_id")).toBe("agents");
    } finally {
      db.close();
    }
  });

  test("role_locks/runners rows survive migration 14 (rename + column flip)", () => {
    // Renamed table + column: most stress on the rename path. Insert against
    // legacy `role_locks(role_id, …)` and `runners(role_id, …)` pre-v14, then
    // assert survival under `agent_locks(agent_id, …)` and `runners(agent_id, …)`.
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      rollbackV14(db);
      const now = new Date().toISOString();
      db.run("INSERT INTO workspace_repos (id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)",
        ["repo-C", "repo-C-name", "/tmp/repo-C", now, now]);
      db.run("INSERT INTO roles (id, repo_id, name, host_default, default_host_type, created_at, updated_at) VALUES (?, ?, ?, 'claude-code', NULL, ?, ?)",
        ["agent-C", "repo-C", "advisor", now, now]);
      db.run(
        `INSERT INTO sessions (id, role_id, host_type, status, cwd, started_at, last_seen, summary)
         VALUES ('sess-c', 'agent-C', 'claude-code', 'running', '/tmp/z', ?, ?, '')`,
        [now, now],
      );
      // Legacy column name on the legacy table.
      db.run("INSERT INTO role_locks (role_id, session_id, acquired_at) VALUES ('agent-C', 'sess-c', ?)", [now]);
      // Legacy column name on the runners table.
      db.run(
        `INSERT INTO runners (role_id, session_id, runner_pid, socket_path, metadata_path, status, started_at, last_seen)
         VALUES ('agent-C', 'sess-c', 9999, '/tmp/sock', '/tmp/meta', 'running', ?, ?)`,
        [now, now],
      );
      // Drive v14 against the populated pre-rename state.
      migrate(db);
      // Lock row survives the table rename and column rename.
      const lock = db.query<{ agent_id: string; session_id: string }, []>(
        "SELECT agent_id, session_id FROM agent_locks WHERE agent_id = 'agent-C'",
      ).get();
      expect(lock).toEqual({ agent_id: "agent-C", session_id: "sess-c" });
      // Runner row survives the column rename.
      const runner = db.query<{ agent_id: string; session_id: string; runner_pid: number }, []>(
        "SELECT agent_id, session_id, runner_pid FROM runners WHERE agent_id = 'agent-C'",
      ).get();
      expect(runner).toEqual({ agent_id: "agent-C", session_id: "sess-c", runner_pid: 9999 });
    } finally {
      db.close();
    }
  });
});
