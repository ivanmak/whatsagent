import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { migrate, openFleetDb } from "../src/db.ts";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wa-mig17-"));
  dbPath = join(dir, "ws.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Roll a fully-migrated DB back to a pre-v17 state by:
 *  1. Removing the v17 schema_migrations row, AND
 *  2. Deleting one or more grants from a built-in role to mimic the
 *     v15-era seed gap that v17 backfills.
 * v17 then runs on the next migrate() call.
 */
function rollbackV17AndDropPmCommentGrants(db: ReturnType<typeof openFleetDb>): void {
  db.transaction(() => {
    db.run("DELETE FROM schema_migrations WHERE version = 17");
    const pm = db.query<{ id: string }, []>("SELECT id FROM roles WHERE name = 'pm' AND is_builtin = 1").get();
    if (!pm) throw new Error("pm role missing");
    db.run(
      "DELETE FROM role_grants WHERE role_id = ? AND grant_kind = ? AND grant_value IN ('comment_task', 'comment_epic')",
      [pm.id, "kanban_action"],
    );
  })();
}

function pmGrantValues(db: ReturnType<typeof openFleetDb>, kind: string): string[] {
  const rows = db.query<{ value: string }, [string]>(
    `SELECT g.grant_value AS value FROM role_grants g
       JOIN roles r ON r.id = g.role_id
      WHERE r.name = 'pm' AND r.is_builtin = 1 AND g.grant_kind = ?
      ORDER BY g.grant_value`,
  ).all(kind);
  return rows.map((r) => r.value);
}

describe("workspace-db migration 17 — RBAC Phase 4 builtin-grant top-up (WA-087)", () => {
  test("fresh migrate seeds pm with comment_task + comment_epic", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const values = pmGrantValues(db, "kanban_action");
      expect(values).toContain("comment_task");
      expect(values).toContain("comment_epic");
    } finally {
      db.close();
    }
  });

  test("schema_migrations records version 17", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const row = db.query<{ version: number }, []>(
        "SELECT version FROM schema_migrations WHERE version = 17",
      ).get();
      expect(row?.version).toBe(17);
    } finally {
      db.close();
    }
  });

  test("rollback to pre-v17 + drop pm comment grants → re-migrate restores them", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      // Confirm baseline.
      expect(pmGrantValues(db, "kanban_action")).toContain("comment_task");
      // Simulate a v15-era pm seed gap (the bug WA-087 fixes on existing DBs).
      rollbackV17AndDropPmCommentGrants(db);
      expect(pmGrantValues(db, "kanban_action")).not.toContain("comment_task");
      expect(pmGrantValues(db, "kanban_action")).not.toContain("comment_epic");
      // Re-run migrate — v17 fires and backfills.
      migrate(db);
      expect(pmGrantValues(db, "kanban_action")).toContain("comment_task");
      expect(pmGrantValues(db, "kanban_action")).toContain("comment_epic");
    } finally {
      db.close();
    }
  });

  test("v17 preserves pre-existing extra grants (no deletes)", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      // Insert a synthetic extra grant on pm that isn't in BUILTIN_ROLE_DEFINITIONS.
      const pm = db.query<{ id: string }, []>("SELECT id FROM roles WHERE name = 'pm' AND is_builtin = 1").get()!;
      db.run(
        "INSERT INTO role_grants (id, role_id, grant_kind, grant_value, scope_qualifier, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
        [`extra-${Date.now()}`, pm.id, "tool_family", "synthetic-extra", new Date().toISOString()],
      );
      // Roll back v17 + re-migrate. Top-up must NOT remove the synthetic extra.
      db.run("DELETE FROM schema_migrations WHERE version = 17");
      migrate(db);
      const families = pmGrantValues(db, "tool_family");
      expect(families).toContain("synthetic-extra");
      // And the standard grants are still present.
      expect(families).toContain("kanban-admin");
    } finally {
      db.close();
    }
  });

  test("v17 is idempotent — second migrate is a no-op (no duplicate rows)", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const before = db.query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM role_grants WHERE grant_kind = 'kanban_action' AND grant_value IN ('comment_task', 'comment_epic')",
      ).get()!;
      migrate(db);
      const after = db.query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM role_grants WHERE grant_kind = 'kanban_action' AND grant_value IN ('comment_task', 'comment_epic')",
      ).get()!;
      expect(after.count).toBe(before.count);
    } finally {
      db.close();
    }
  });
});
