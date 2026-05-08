import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { migrateDaemonDb, openDaemonDb } from "../src/daemon-db.ts";
import { daemonHomePaths } from "../src/paths.ts";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "wa-mig3-"));
  const paths = daemonHomePaths(home);
  mkdirSync(paths.workspacesDir, { recursive: true });
  mkdirSync(paths.trashDir, { recursive: true });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function tableInfo(db: ReturnType<typeof openDaemonDb>, name: string): { name: string; type: string; notnull: number }[] {
  return db.query<{ name: string; type: string; notnull: number }, []>(`PRAGMA table_info(${name})`).all();
}

function indexList(db: ReturnType<typeof openDaemonDb>, table: string): string[] {
  return db.query<{ name: string }, []>(`PRAGMA index_list(${table})`).all().map((r) => r.name);
}

describe("daemon-db migration 3 — workspace decoupling schema drop", () => {
  test("fresh DB ends up with new shape and no path/type", () => {
    const paths = daemonHomePaths(home);
    const db = openDaemonDb(paths.daemonDbPath);
    try {
      migrateDaemonDb(db, { daemonHome: home });
      const cols = tableInfo(db, "workspaces").map((c) => c.name);
      expect(cols).toContain("id");
      expect(cols).toContain("name");
      expect(cols).toContain("status");
      expect(cols).not.toContain("path");
      expect(cols).not.toContain("type");
      const idx = indexList(db, "workspaces");
      expect(idx).toContain("workspaces_active_name");
      expect(idx).not.toContain("workspaces_active_path");
    } finally {
      db.close();
    }
  });

  test("re-running migrate is a no-op", () => {
    const paths = daemonHomePaths(home);
    const db = openDaemonDb(paths.daemonDbPath);
    try {
      migrateDaemonDb(db, { daemonHome: home });
      // Should not throw or rewrite schema_migrations.
      migrateDaemonDb(db, { daemonHome: home });
      const versions = db.query<{ version: number }, []>("SELECT version FROM schema_migrations ORDER BY version").all();
      expect(versions.map((v) => v.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    } finally {
      db.close();
    }
  });

  test("alpha-break: pre-migration rows + slot dirs are wiped", () => {
    const paths = daemonHomePaths(home);
    const db = openDaemonDb(paths.daemonDbPath);
    try {
      // Simulate pre-migration-3 state by running just migration 1's CREATE
      // statements + inserting a row with the old path/type shape.
      db.run(`CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        trashed_at TEXT,
        status_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      db.run(`CREATE UNIQUE INDEX workspaces_active_path
        ON workspaces(path) WHERE status NOT IN ('trashed','purging')`);
      db.run(`CREATE UNIQUE INDEX workspaces_active_name
        ON workspaces(name) WHERE status NOT IN ('trashed','purging')`);
      db.run(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
      db.run(`INSERT INTO schema_migrations (version, applied_at) VALUES (1, '2026-01-01T00:00:00Z')`);
      db.run(`INSERT INTO schema_migrations (version, applied_at) VALUES (2, '2026-01-01T00:00:00Z')`);
      db.run(`CREATE TABLE daemon_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`);
      db.run(`INSERT INTO workspaces (id, name, path, type, status, created_at, updated_at)
              VALUES ('legacy-1', 'legacy', '/tmp/legacy', 'single-repo', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`);

      // Lay down orphan slot dirs that the daemon would have managed.
      mkdirSync(join(paths.workspacesDir, "legacy-1"), { recursive: true });
      writeFileSync(join(paths.workspacesDir, "legacy-1", "whatsagent.sqlite"), "stale");
      mkdirSync(join(paths.trashDir, "legacy-2"), { recursive: true });
      writeFileSync(join(paths.trashDir, "legacy-2", "whatsagent.sqlite"), "stale");

      migrateDaemonDb(db, { daemonHome: home });

      const cols = tableInfo(db, "workspaces").map((c) => c.name);
      expect(cols).not.toContain("path");
      expect(cols).not.toContain("type");
      // Row wiped because the alpha-break recreate skips data copy.
      expect(db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM workspaces").get()?.count).toBe(0);
      // Filesystem children wiped.
      expect(readdirSync(paths.workspacesDir).sort()).toEqual([]);
      expect(readdirSync(paths.trashDir).sort()).toEqual([]);
      // The parent dirs themselves remain.
      expect(existsSync(paths.workspacesDir)).toBe(true);
      expect(existsSync(paths.trashDir)).toBe(true);
    } finally {
      db.close();
    }
  });

  test("migration without daemonHome leaves filesystem alone", () => {
    const paths = daemonHomePaths(home);
    mkdirSync(join(paths.workspacesDir, "untouched"), { recursive: true });
    writeFileSync(join(paths.workspacesDir, "untouched", "marker"), "keep");

    const db = openDaemonDb(paths.daemonDbPath);
    try {
      migrateDaemonDb(db); // no opts → no filesystem cleanup
      expect(existsSync(join(paths.workspacesDir, "untouched", "marker"))).toBe(true);
    } finally {
      db.close();
    }
  });

  test("migration 4 creates daemon-global custom_prompts", () => {
    const paths = daemonHomePaths(home);
    const db = openDaemonDb(paths.daemonDbPath);
    try {
      migrateDaemonDb(db, { daemonHome: home });
      const cols = tableInfo(db, "custom_prompts").map((c) => c.name);
      expect(cols).toEqual(["id", "title", "body", "created_at", "updated_at"]);
      const idx = indexList(db, "custom_prompts").join("\n");
      expect(idx).toContain("sqlite_autoindex_custom_prompts");
    } finally {
      db.close();
    }
  });

  test("migration 5 creates auth users and hashed-token sessions", () => {
    const paths = daemonHomePaths(home);
    const db = openDaemonDb(paths.daemonDbPath);
    try {
      migrateDaemonDb(db, { daemonHome: home });
      expect(tableInfo(db, "auth_users").map((c) => c.name)).toEqual([
        "id",
        "username",
        "password_hash",
        "recovery_hash",
        "recovery_used_at",
        "failed_attempts",
        "locked_until",
        "created_at",
        "updated_at",
      ]);
      expect(tableInfo(db, "auth_sessions").map((c) => c.name)).toEqual([
        "id",
        "token_hash",
        "user_id",
        "expires_at",
        "created_at",
        "last_seen_at",
        "user_agent",
        "ip",
        "force_pwd_reset",
      ]);
      const idx = indexList(db, "auth_sessions").join("\n");
      expect(idx).toContain("auth_sessions_user_id");
      expect(idx).toContain("auth_sessions_expires_at");
      expect(idx).toContain("sqlite_autoindex_auth_sessions");
    } finally {
      db.close();
    }
  });

  test("migration 6 adds recovery force-reset flag to sessions", () => {
    const paths = daemonHomePaths(home);
    const db = openDaemonDb(paths.daemonDbPath);
    try {
      migrateDaemonDb(db, { daemonHome: home });
      const col = tableInfo(db, "auth_sessions").find((c) => c.name === "force_pwd_reset");
      expect(col).toMatchObject({ type: "INTEGER", notnull: 1 });
    } finally {
      db.close();
    }
  });
});
