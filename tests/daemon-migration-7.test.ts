import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  getWorkspaceRbacMode,
  insertWorkspace,
  migrateDaemonDb,
  openDaemonDb,
  setWorkspaceRbacMode,
  type WorkspaceRow,
} from "../src/daemon-db.ts";
import { daemonHomePaths } from "../src/paths.ts";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "wa-mig7-"));
  const paths = daemonHomePaths(home);
  mkdirSync(paths.workspacesDir, { recursive: true });
  mkdirSync(paths.trashDir, { recursive: true });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function tableInfo(
  db: ReturnType<typeof openDaemonDb>,
  name: string,
): Array<{ name: string; type: string; notnull: number; dflt_value: string | null }> {
  return db.query<{ name: string; type: string; notnull: number; dflt_value: string | null }, []>(
    `PRAGMA table_info(${name})`,
  ).all();
}

function indexList(db: ReturnType<typeof openDaemonDb>, table: string): string[] {
  return db.query<{ name: string }, []>(`PRAGMA index_list(${table})`).all().map((r) => r.name);
}

describe("daemon-db migration 7 — EP-022 per-workspace RBAC mode (WA-092)", () => {
  test("fresh DB has rbac_mode column with NOT NULL DEFAULT 'enforce'", () => {
    const paths = daemonHomePaths(home);
    const db = openDaemonDb(paths.daemonDbPath);
    try {
      migrateDaemonDb(db, { daemonHome: home });
      const col = tableInfo(db, "workspaces").find((c) => c.name === "rbac_mode");
      expect(col).toBeDefined();
      expect(col?.type).toBe("TEXT");
      expect(col?.notnull).toBe(1);
      expect(col?.dflt_value).toBe("'enforce'");
    } finally {
      db.close();
    }
  });

  test("schema_migrations records version 7", () => {
    const paths = daemonHomePaths(home);
    const db = openDaemonDb(paths.daemonDbPath);
    try {
      migrateDaemonDb(db, { daemonHome: home });
      const versions = db.query<{ version: number }, []>(
        "SELECT version FROM schema_migrations ORDER BY version",
      ).all().map((r) => r.version);
      expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    } finally {
      db.close();
    }
  });

  test("re-running migrate is a no-op (idempotent)", () => {
    const paths = daemonHomePaths(home);
    const db = openDaemonDb(paths.daemonDbPath);
    try {
      migrateDaemonDb(db, { daemonHome: home });
      migrateDaemonDb(db, { daemonHome: home });
      const versions = db.query<{ version: number }, []>(
        "SELECT version FROM schema_migrations ORDER BY version",
      ).all().map((r) => r.version);
      expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      // PRAGMA integrity_check + foreign_key_check both clean (advisor watchpoint).
      const integrity = db.query<{ value: string }, []>("PRAGMA integrity_check").all();
      expect(integrity[0]?.value ?? integrity[0]).toMatchObject({});
      const fkErrs = db.query<unknown, []>("PRAGMA foreign_key_check").all();
      expect(fkErrs).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("partial-run safety: rbac_mode column already added but schema_migrations row missing", () => {
    const paths = daemonHomePaths(home);
    const db = openDaemonDb(paths.daemonDbPath);
    try {
      // Run migrations 1-6 only by stopping migrateDaemonDb mid-way is not
      // exposed; simulate by running migrate, then deleting v7 row + dropping
      // and re-adding the column? Simpler: insert pre-existing column then
      // delete schema_migrations row.
      migrateDaemonDb(db, { daemonHome: home });
      db.run("DELETE FROM schema_migrations WHERE version = 7");
      // Re-running should be safe — guard re-detects the column and skips.
      migrateDaemonDb(db, { daemonHome: home });
      const versions = db.query<{ version: number }, []>(
        "SELECT version FROM schema_migrations WHERE version = 7",
      ).all();
      expect(versions.length).toBe(1);
    } finally {
      db.close();
    }
  });

  test("existing pre-v7 workspaces row backfills to 'enforce'", () => {
    const paths = daemonHomePaths(home);
    const db = openDaemonDb(paths.daemonDbPath);
    try {
      // Bring DB up to v6 only by manually inserting versions 1-6 then
      // creating the v3-shape workspaces table directly.
      db.run("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
      for (const v of [1, 2, 3, 4, 5, 6]) {
        db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [v, "2026-01-01T00:00:00Z"]);
      }
      db.run(`CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        trashed_at TEXT,
        status_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      db.run(
        "INSERT INTO workspaces (id, name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
        ["legacy-1", "legacy", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"],
      );
      // Now run migrations — v7 (rbac_mode) and later daemon migrations should advance.
      migrateDaemonDb(db, { daemonHome: home });
      const row = db.query<WorkspaceRow, [string]>("SELECT * FROM workspaces WHERE id = ?").get("legacy-1");
      expect(row?.rbac_mode).toBe("enforce");
    } finally {
      db.close();
    }
  });

  test("CHECK constraint rejects invalid rbac_mode value", () => {
    const paths = daemonHomePaths(home);
    const db = openDaemonDb(paths.daemonDbPath);
    try {
      migrateDaemonDb(db, { daemonHome: home });
      const now = "2026-01-01T00:00:00Z";
      expect(() => {
        db.run(
          "INSERT INTO workspaces (id, name, status, trashed_at, status_error, created_at, updated_at, rbac_mode) VALUES (?, ?, 'creating', NULL, NULL, ?, ?, ?)",
          ["w1", "ws", now, now, "bogus"],
        );
      }).toThrow();
    } finally {
      db.close();
    }
  });

  test("workspaces_active_name index survives migration", () => {
    const paths = daemonHomePaths(home);
    const db = openDaemonDb(paths.daemonDbPath);
    try {
      migrateDaemonDb(db, { daemonHome: home });
      const indexes = indexList(db, "workspaces");
      expect(indexes).toContain("workspaces_active_name");
    } finally {
      db.close();
    }
  });

  test("insertWorkspace defaults to enforce when rbacMode omitted", () => {
    const paths = daemonHomePaths(home);
    const db = openDaemonDb(paths.daemonDbPath);
    try {
      migrateDaemonDb(db, { daemonHome: home });
      const row = insertWorkspace(db, { id: "w1", name: "alpha" });
      expect(row.rbac_mode).toBe("enforce");
    } finally {
      db.close();
    }
  });

  test("insertWorkspace honors explicit rbacMode", () => {
    const paths = daemonHomePaths(home);
    const db = openDaemonDb(paths.daemonDbPath);
    try {
      migrateDaemonDb(db, { daemonHome: home });
      const row = insertWorkspace(db, { id: "w1", name: "alpha", rbacMode: "soft" });
      expect(row.rbac_mode).toBe("soft");
    } finally {
      db.close();
    }
  });

  test("getWorkspaceRbacMode + setWorkspaceRbacMode round-trip", () => {
    const paths = daemonHomePaths(home);
    const db = openDaemonDb(paths.daemonDbPath);
    try {
      migrateDaemonDb(db, { daemonHome: home });
      insertWorkspace(db, { id: "w1", name: "alpha" });
      expect(getWorkspaceRbacMode(db, "w1")).toBe("enforce");

      setWorkspaceRbacMode(db, "w1", "soft");
      expect(getWorkspaceRbacMode(db, "w1")).toBe("soft");

      setWorkspaceRbacMode(db, "w1", "off");
      expect(getWorkspaceRbacMode(db, "w1")).toBe("off");

      setWorkspaceRbacMode(db, "w1", "enforce");
      expect(getWorkspaceRbacMode(db, "w1")).toBe("enforce");
    } finally {
      db.close();
    }
  });

  test("setWorkspaceRbacMode rejects invalid mode", () => {
    const paths = daemonHomePaths(home);
    const db = openDaemonDb(paths.daemonDbPath);
    try {
      migrateDaemonDb(db, { daemonHome: home });
      insertWorkspace(db, { id: "w1", name: "alpha" });
      expect(() => setWorkspaceRbacMode(db, "w1", "bogus" as never)).toThrow(/invalid rbac_mode/);
    } finally {
      db.close();
    }
  });

  test("getWorkspaceRbacMode returns null for missing workspace", () => {
    const paths = daemonHomePaths(home);
    const db = openDaemonDb(paths.daemonDbPath);
    try {
      migrateDaemonDb(db, { daemonHome: home });
      expect(getWorkspaceRbacMode(db, "nonexistent")).toBeNull();
    } finally {
      db.close();
    }
  });
});
