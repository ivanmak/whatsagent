import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { migrate, openFleetDb } from "../src/db.ts";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wa-mig12-"));
  dbPath = join(dir, "ws.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function tableInfo(db: ReturnType<typeof openFleetDb>, name: string) {
  return db.query<{ name: string; type: string; notnull: number }, []>(`PRAGMA table_info(${name})`).all();
}

function fkOn(db: ReturnType<typeof openFleetDb>, name: string, fromColumn: string) {
  return db.query<{ table: string; from: string; to: string; on_delete: string }, []>(`PRAGMA foreign_key_list(${name})`).all().find((f) => f.from === fromColumn);
}

function seedRepoAndRole(db: ReturnType<typeof openFleetDb>, repoId: string, roleId: string, roleName: string) {
  const now = new Date().toISOString();
  db.run("INSERT INTO workspace_repos (id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)",
    [repoId, repoId + "-name", "/tmp/" + repoId, now, now]);
  // Post-migration-14 the table is `agents` (RBAC Phase 1 rename).
  db.run("INSERT INTO agents (id, repo_id, name, host_default, default_host_type, created_at, updated_at) VALUES (?, ?, ?, 'claude-code', NULL, ?, ?)",
    [roleId, repoId, roleName, now, now]);
}

describe("workspace-db migration 12 — history-table FK flip + display snapshots", () => {
  test("messages table has SET NULL FKs + display columns", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const cols = tableInfo(db, "messages").map((c) => c.name);
      expect(cols).toContain("from_display");
      expect(cols).toContain("to_display");
      expect(fkOn(db, "messages", "from_role_id")?.on_delete).toBe("SET NULL");
      expect(fkOn(db, "messages", "to_role_id")?.on_delete).toBe("SET NULL");
    } finally {
      db.close();
    }
  });

  test("channel_messages keeps SET NULL + adds from_display", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      expect(tableInfo(db, "channel_messages").map((c) => c.name)).toContain("from_display");
      expect(fkOn(db, "channel_messages", "from_role_id")?.on_delete).toBe("SET NULL");
    } finally {
      db.close();
    }
  });

  test("events gains FK to roles + actor_display", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      expect(tableInfo(db, "events").map((c) => c.name)).toContain("actor_display");
      expect(fkOn(db, "events", "role_id")?.on_delete).toBe("SET NULL");
    } finally {
      db.close();
    }
  });

  test("kanban_tasks: created_by + assigned flip to SET NULL, gain display columns", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const cols = tableInfo(db, "kanban_tasks").map((c) => c.name);
      expect(cols).toContain("created_by_display");
      expect(cols).toContain("assignee_display");
      expect(fkOn(db, "kanban_tasks", "created_by_role_id")?.on_delete).toBe("SET NULL");
      expect(fkOn(db, "kanban_tasks", "assigned_role_id")?.on_delete).toBe("SET NULL");
      expect(fkOn(db, "kanban_tasks", "epic_id")?.on_delete).toBe("SET NULL");
    } finally {
      db.close();
    }
  });

  test.each([
    ["kanban_comments", "actor_display", "role_id"],
    ["kanban_activity", "actor_display", "role_id"],
    ["kanban_dependencies", null, "created_by_role_id"],
    ["kanban_notifications", "to_display", "to_role_id"],
    ["kanban_epics", "created_by_display", "created_by_role_id"],
    ["kanban_epic_comments", "actor_display", "role_id"],
    ["kanban_epic_activity", "actor_display", "role_id"],
    ["kanban_epic_notifications", "to_display", "to_role_id"],
  ])("%s: FK %s flips to SET NULL%s", (table, displayCol, fkColumn) => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      expect(fkOn(db, table, fkColumn)?.on_delete).toBe("SET NULL");
      if (displayCol) {
        expect(tableInfo(db, table).map((c) => c.name)).toContain(displayCol);
      }
    } finally {
      db.close();
    }
  });

  test("history row survives role delete: messages.to_role_id null, to_display intact", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      seedRepoAndRole(db, "r1", "role-x", "agent");
      seedRepoAndRole(db, "r2", "role-y", "peer");
      db.run(`INSERT INTO messages (thread_id, from_role_id, to_role_id, from_display, to_display, body, state, sent_at, delivery_kind)
              VALUES ('t1', 'role-x', 'role-y', 'r1-name:agent', 'r2-name:peer', 'hi', 'delivered', '2026-05-01T00:00:00Z', 'direct')`);
      db.run("DELETE FROM agents WHERE id = 'role-y'");
      const row = db.query<{ to_role_id: string | null; to_display: string | null }, []>(
        "SELECT to_role_id, to_display FROM messages",
      ).get();
      expect(row?.to_role_id).toBeNull();
      expect(row?.to_display).toBe("r2-name:peer");
    } finally {
      db.close();
    }
  });

  test("history row survives repo delete cascade: kanban_comments.role_id null, actor_display intact", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      seedRepoAndRole(db, "r1", "role-a", "agent");
      const now = new Date().toISOString();
      db.run(`INSERT INTO kanban_tasks
              (display_id, sequence, title, status, priority, effort, created_by_role_id, assigned_role_id,
               created_by_display, assignee_display, created_at, updated_at)
              VALUES ('WA-001', 1, 't', 'Backlog', 'P2', 'M', 'role-a', 'role-a', 'r1-name:agent', 'r1-name:agent', ?, ?)`,
        [now, now]);
      const taskId = db.query<{ id: number }, []>("SELECT id FROM kanban_tasks").get()!.id;
      db.run(`INSERT INTO kanban_comments (task_id, role_id, actor_display, type, body, created_at)
              VALUES (?, 'role-a', 'r1-name:agent', 'note', 'hello', ?)`,
        [taskId, now]);
      // Deleting the repo cascades-drops the role (FK ON DELETE CASCADE on roles.repo_id),
      // which then SET NULL on kanban_comments.role_id thanks to migration 12.
      db.run("DELETE FROM workspace_repos WHERE id = 'r1'");
      const comment = db.query<{ role_id: string | null; actor_display: string | null }, []>(
        "SELECT role_id, actor_display FROM kanban_comments",
      ).get();
      expect(comment?.role_id).toBeNull();
      expect(comment?.actor_display).toBe("r1-name:agent");
      // Task itself survives — assignment + creator role IDs nulled, displays kept.
      const task = db.query<{ created_by_role_id: string | null; assigned_role_id: string | null; created_by_display: string | null; assignee_display: string | null }, []>(
        "SELECT created_by_role_id, assigned_role_id, created_by_display, assignee_display FROM kanban_tasks",
      ).get();
      expect(task?.created_by_role_id).toBeNull();
      expect(task?.assigned_role_id).toBeNull();
      expect(task?.created_by_display).toBe("r1-name:agent");
      expect(task?.assignee_display).toBe("r1-name:agent");
    } finally {
      db.close();
    }
  });

  test("kanban_notifications.to_role_id flip from CASCADE → SET NULL preserves history", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      seedRepoAndRole(db, "r1", "role-a", "agent");
      const now = new Date().toISOString();
      db.run(`INSERT INTO kanban_tasks
              (display_id, sequence, title, status, priority, effort, created_by_role_id, assigned_role_id, created_by_display, assignee_display, created_at, updated_at)
              VALUES ('WA-002', 1, 't', 'Backlog', 'P2', 'M', 'role-a', 'role-a', 'r1:agent', 'r1:agent', ?, ?)`,
        [now, now]);
      const taskId = db.query<{ id: number }, []>("SELECT id FROM kanban_tasks").get()!.id;
      db.run(`INSERT INTO kanban_notifications (task_id, to_role_id, to_display, actor_display, event_type, body, created_at)
              VALUES (?, 'role-a', 'r1:agent', 'r1:agent', 'assigned', 'you were assigned', ?)`,
        [taskId, now]);
      db.run("DELETE FROM workspace_repos WHERE id = 'r1'");
      // Old behaviour would DELETE the notification (CASCADE). New behaviour keeps row, nulls FK.
      const n = db.query<{ to_role_id: string | null; to_display: string | null }, []>(
        "SELECT to_role_id, to_display FROM kanban_notifications",
      ).get();
      expect(n).toBeDefined();
      expect(n?.to_role_id).toBeNull();
      expect(n?.to_display).toBe("r1:agent");
    } finally {
      db.close();
    }
  });

  test("re-running migrate is a no-op + foreign_keys pragma restored", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      migrate(db);
      const versions = db.query<{ version: number }, []>("SELECT version FROM schema_migrations ORDER BY version").all();
      expect(versions.map((v) => v.version)).toContain(12);
      const pragma = db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get();
      expect(pragma?.foreign_keys).toBe(1);
    } finally {
      db.close();
    }
  });
});
