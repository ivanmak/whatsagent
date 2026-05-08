import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { migrate, openFleetDb } from "../src/db.ts";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wa-mig18-"));
  dbPath = join(dir, "ws.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Roll a fully-migrated DB back to a pre-v18 state by:
 *   1. Removing the v18 schema_migrations row.
 *   2. Reverting role_grants to the pre-EP-022 channel-family shape:
 *      - replacing channel-read + channel-write rows with a single
 *        legacy `channel` row on every role that holds at least one;
 *      - dropping channel-read from the restricted role so the
 *        special-case-skip pre-EP-022 shape is reproduced.
 * v18 then runs on the next migrate() call.
 */
function rollbackV18(db: ReturnType<typeof openFleetDb>): void {
  db.transaction(() => {
    db.run("DELETE FROM schema_migrations WHERE version = 18");

    const roles = db.query<{ role_id: string }, []>(
      `SELECT DISTINCT role_id FROM role_grants
        WHERE grant_kind = 'tool_family' AND grant_value IN ('channel-read', 'channel-write')`,
    ).all();
    for (const row of roles) {
      const ts = "2026-01-01T00:00:00Z";
      // Drop new families.
      db.run(
        "DELETE FROM role_grants WHERE role_id = ? AND grant_kind = 'tool_family' AND grant_value IN ('channel-read', 'channel-write')",
        [row.role_id],
      );
      // Restore pre-EP-022 `channel` row only on roles that previously
      // had it (everyone except restricted).
      const isRestricted = db.query<{ name: string }, [string]>(
        "SELECT name FROM roles WHERE id = ?",
      ).get(row.role_id)?.name === "restricted";
      if (!isRestricted) {
        db.run(
          "INSERT INTO role_grants (id, role_id, grant_kind, grant_value, scope_qualifier, created_at) VALUES (?, ?, 'tool_family', 'channel', NULL, ?)",
          [randomUUID(), row.role_id, ts],
        );
      }
    }
  })();
}

function familyValuesByRole(db: ReturnType<typeof openFleetDb>, roleName: string): string[] {
  const rows = db.query<{ value: string }, [string]>(
    `SELECT grant_value AS value FROM role_grants g
       JOIN roles r ON r.id = g.role_id
      WHERE r.name = ? AND g.grant_kind = 'tool_family'
      ORDER BY g.grant_value`,
  ).all(roleName);
  return rows.map((r) => r.value);
}

function getRoleId(db: ReturnType<typeof openFleetDb>, name: string): string {
  const row = db.query<{ id: string }, [string]>("SELECT id FROM roles WHERE name = ?").get(name);
  if (!row) throw new Error(`role ${name} missing`);
  return row.id;
}

describe("workspace-db migration 18 — EP-022 channel family split (WA-093)", () => {
  test("fresh migrate seeds pm/engineer/reviewer/researcher with channel-read + channel-write (no plain 'channel')", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      for (const role of ["pm", "engineer", "reviewer", "researcher"]) {
        const families = familyValuesByRole(db, role);
        expect(families).toContain("channel-read");
        expect(families).toContain("channel-write");
        expect(families).not.toContain("channel");
      }
    } finally {
      db.close();
    }
  });

  test("fresh migrate seeds restricted with channel-read (NO channel-write)", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const families = familyValuesByRole(db, "restricted");
      expect(families).toContain("channel-read");
      expect(families).not.toContain("channel-write");
      expect(families).not.toContain("channel");
    } finally {
      db.close();
    }
  });

  test("schema_migrations records version 18", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const row = db.query<{ version: number }, []>(
        "SELECT version FROM schema_migrations WHERE version = 18",
      ).get();
      expect(row?.version).toBe(18);
    } finally {
      db.close();
    }
  });

  test("rolled-back DB upgrades cleanly: legacy 'channel' rows split, restricted gains channel-read", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      rollbackV18(db);
      // Pre-condition: pm now has plain 'channel', no channel-read/write.
      const pmFamilies = familyValuesByRole(db, "pm");
      expect(pmFamilies).toContain("channel");
      expect(pmFamilies).not.toContain("channel-read");
      expect(pmFamilies).not.toContain("channel-write");
      // Pre-condition: restricted has neither channel nor channel-read.
      const restrictedFamilies = familyValuesByRole(db, "restricted");
      expect(restrictedFamilies).not.toContain("channel");
      expect(restrictedFamilies).not.toContain("channel-read");

      // Re-run migrate — only v18 should advance.
      migrate(db);

      // Post-condition: pm now has channel-read + channel-write, no channel.
      const pmAfter = familyValuesByRole(db, "pm");
      expect(pmAfter).toContain("channel-read");
      expect(pmAfter).toContain("channel-write");
      expect(pmAfter).not.toContain("channel");

      // Post-condition: restricted gains channel-read (no channel-write).
      const restrictedAfter = familyValuesByRole(db, "restricted");
      expect(restrictedAfter).toContain("channel-read");
      expect(restrictedAfter).not.toContain("channel-write");
    } finally {
      db.close();
    }
  });

  test("custom (non-builtin) role with 'channel' family is split into channel-read + channel-write (advisor msg #399 ¶5)", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      // Create a custom role with the legacy 'channel' family directly,
      // simulating an upgrade where an operator had configured a custom
      // role pre-EP-022.
      const ts = "2026-01-01T00:00:00Z";
      const customRoleId = randomUUID();
      db.run(
        "INSERT INTO roles (id, name, description, is_builtin, created_at, updated_at) VALUES (?, 'custom-x', 'custom test role', 0, ?, ?)",
        [customRoleId, ts, ts],
      );
      db.run(
        "INSERT INTO role_grants (id, role_id, grant_kind, grant_value, scope_qualifier, created_at) VALUES (?, ?, 'tool_family', 'channel', NULL, ?)",
        [randomUUID(), customRoleId, ts],
      );
      // Roll v18 back so it re-runs on next migrate().
      db.run("DELETE FROM schema_migrations WHERE version = 18");

      migrate(db);

      const families = familyValuesByRole(db, "custom-x");
      expect(families).toContain("channel-read");
      expect(families).toContain("channel-write");
      expect(families).not.toContain("channel");
    } finally {
      db.close();
    }
  });

  test("re-running migrate is idempotent (no-op + no duplicate rows)", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const before = db.query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM role_grants WHERE grant_kind = 'tool_family' AND grant_value IN ('channel-read', 'channel-write')",
      ).get()?.count ?? 0;

      // Re-run migrate; v18 should short-circuit on schema_migrations.
      migrate(db);

      const after = db.query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM role_grants WHERE grant_kind = 'tool_family' AND grant_value IN ('channel-read', 'channel-write')",
      ).get()?.count ?? 0;
      expect(after).toBe(before);

      // Plain 'channel' rows fully removed — the migration deletes after split.
      const legacyCount = db.query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM role_grants WHERE grant_kind = 'tool_family' AND grant_value = 'channel'",
      ).get()?.count ?? 0;
      expect(legacyCount).toBe(0);
    } finally {
      db.close();
    }
  });

  test("re-running migration after rollback preserves existing channel-read/write rows (no duplicates)", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      // Pre-existing channel-read row count for the pm role.
      const pmId = getRoleId(db, "pm");
      const pmReadBefore = db.query<{ count: number }, [string]>(
        "SELECT COUNT(*) AS count FROM role_grants WHERE role_id = ? AND grant_kind = 'tool_family' AND grant_value = 'channel-read'",
      ).get(pmId)?.count ?? 0;
      expect(pmReadBefore).toBe(1);

      // Roll v18 back BUT keep channel-read row intact + insert a stray
      // legacy 'channel' row to simulate partial state.
      db.run("DELETE FROM schema_migrations WHERE version = 18");
      db.run(
        "INSERT INTO role_grants (id, role_id, grant_kind, grant_value, scope_qualifier, created_at) VALUES (?, ?, 'tool_family', 'channel', NULL, ?)",
        [randomUUID(), pmId, "2026-01-01T00:00:00Z"],
      );

      migrate(db);

      // Existing channel-read row preserved (no dup), legacy 'channel' deleted.
      const pmReadAfter = db.query<{ count: number }, [string]>(
        "SELECT COUNT(*) AS count FROM role_grants WHERE role_id = ? AND grant_kind = 'tool_family' AND grant_value = 'channel-read'",
      ).get(pmId)?.count ?? 0;
      expect(pmReadAfter).toBe(1);
      const legacy = db.query<{ count: number }, [string]>(
        "SELECT COUNT(*) AS count FROM role_grants WHERE role_id = ? AND grant_kind = 'tool_family' AND grant_value = 'channel'",
      ).get(pmId)?.count ?? 0;
      expect(legacy).toBe(0);
    } finally {
      db.close();
    }
  });
});
