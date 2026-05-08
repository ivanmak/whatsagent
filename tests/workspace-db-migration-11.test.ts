import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { migrate, openFleetDb } from "../src/db.ts";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wa-mig11-"));
  dbPath = join(dir, "ws.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function tableInfo(db: ReturnType<typeof openFleetDb>, name: string): { name: string; type: string; notnull: number; dflt_value: string | null }[] {
  return db.query<{ name: string; type: string; notnull: number; dflt_value: string | null }, []>(`PRAGMA table_info(${name})`).all();
}

function fkList(db: ReturnType<typeof openFleetDb>, name: string): { table: string; from: string; to: string; on_delete: string }[] {
  return db.query<{ table: string; from: string; to: string; on_delete: string }, []>(`PRAGMA foreign_key_list(${name})`).all();
}

describe("workspace-db migration 11 — workspace decoupling: repos, scan_dirs, roles.repo_id", () => {
  test("fresh DB after migrate has new tables and roles shape", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);

      const wsRepos = tableInfo(db, "workspace_repos").map((c) => c.name).sort();
      expect(wsRepos).toEqual([
        "absolute_path", "created_at", "git_root", "id", "missing_at",
        "name", "source_scan_id", "updated_at",
      ]);

      const wsScans = tableInfo(db, "workspace_scan_dirs").map((c) => c.name).sort();
      expect(wsScans).toEqual([
        "absolute_path", "created_at", "id", "last_scan_at", "scan_on_startup", "updated_at",
      ]);

      // Post-migration-14 the table is `agents` (RBAC Phase 1 rename).
      const roles = tableInfo(db, "agents");
      const roleCols = roles.map((c) => c.name).sort();
      expect(roleCols).toEqual([
        "created_at", "default_host_type", "host_default", "id", "name", "repo_id", "updated_at",
      ]);
      // Path/git_root/missing_at/is_manual/last_discovered_at all gone.
      expect(roleCols).not.toContain("path");
      expect(roleCols).not.toContain("git_root");
      expect(roleCols).not.toContain("is_manual");
      expect(roleCols).not.toContain("missing_at");
      expect(roleCols).not.toContain("last_discovered_at");

      const roleFks = fkList(db, "agents");
      const repoFk = roleFks.find((f) => f.from === "repo_id");
      expect(repoFk).toBeDefined();
      expect(repoFk?.table).toBe("workspace_repos");
      expect(repoFk?.on_delete).toBe("CASCADE");
    } finally {
      db.close();
    }
  });

  test("re-running migrate is a no-op", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      migrate(db);
      const versions = db.query<{ version: number }, []>("SELECT version FROM schema_migrations ORDER BY version").all();
      expect(versions.map((v) => v.version)).toContain(11);
      // PRAGMA foreign_keys should be back on.
      const pragma = db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get();
      expect(pragma?.foreign_keys).toBe(1);
    } finally {
      db.close();
    }
  });

  test("repo→role cascade: deleting a repo drops its roles", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const now = new Date().toISOString();
      db.run("INSERT INTO workspace_repos (id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)",
        ["repo-1", "alpha", "/tmp/alpha", now, now]);
      // Post-migration-14 the table is `agents` (RBAC Phase 1 rename).
      db.run("INSERT INTO agents (id, repo_id, name, host_default, default_host_type, created_at, updated_at) VALUES (?, ?, ?, 'claude-code', NULL, ?, ?)",
        ["role-1", "repo-1", "agent", now, now]);
      expect(db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM agents").get()?.count).toBe(1);
      db.run("DELETE FROM workspace_repos WHERE id = 'repo-1'");
      expect(db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM agents").get()?.count).toBe(0);
    } finally {
      db.close();
    }
  });

  test("scan_dir→repo set-null: deleting a scan dir nulls source_scan_id but keeps repos", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const now = new Date().toISOString();
      db.run("INSERT INTO workspace_scan_dirs (id, absolute_path, scan_on_startup, last_scan_at, created_at, updated_at) VALUES (?, ?, 0, NULL, ?, ?)",
        ["scan-1", "/tmp/parent", now, now]);
      db.run("INSERT INTO workspace_repos (id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, NULL, ?, ?)",
        ["repo-1", "foo", "/tmp/parent/foo", "scan-1", now, now]);
      db.run("DELETE FROM workspace_scan_dirs WHERE id = 'scan-1'");
      const row = db.query<{ source_scan_id: string | null }, []>("SELECT source_scan_id FROM workspace_repos WHERE id = 'repo-1'").get();
      expect(row?.source_scan_id).toBeNull();
    } finally {
      db.close();
    }
  });

  test("roles UNIQUE(repo_id, name): same name allowed across repos, blocked within a repo", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const now = new Date().toISOString();
      db.run("INSERT INTO workspace_repos (id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at) VALUES ('r-a', 'alpha', '/a', NULL, NULL, NULL, ?, ?)", [now, now]);
      db.run("INSERT INTO workspace_repos (id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at) VALUES ('r-b', 'beta',  '/b', NULL, NULL, NULL, ?, ?)", [now, now]);
      // Post-migration-14: table is `agents`.
      db.run("INSERT INTO agents (id, repo_id, name, host_default, default_host_type, created_at, updated_at) VALUES ('id-1', 'r-a', 'agent', 'claude-code', NULL, ?, ?)", [now, now]);
      // Different repo, same name — should succeed.
      db.run("INSERT INTO agents (id, repo_id, name, host_default, default_host_type, created_at, updated_at) VALUES ('id-2', 'r-b', 'agent', 'claude-code', NULL, ?, ?)", [now, now]);
      // Same repo + name — should fail.
      expect(() =>
        db.run("INSERT INTO agents (id, repo_id, name, host_default, default_host_type, created_at, updated_at) VALUES ('id-3', 'r-a', 'agent', 'claude-code', NULL, ?, ?)", [now, now]),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  test("alpha-break: pre-migration roles row + multi_agent_per_repo setting both wiped", () => {
    const db = openFleetDb(dbPath);
    try {
      // Apply migrations 1..10 manually so we can inject pre-migration state
      // before migration 11 runs. Easiest is to call `migrate` once which
      // applies all current migrations including 11 — that defeats the test.
      // Instead, reach in via a fresh DB and replay just the pre-11 schema
      // pieces relevant to the assertion.
      db.run(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
      for (const v of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, '2026-01-01T00:00:00Z')", [v]);
      }
      db.run(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`);
      db.run(`INSERT INTO settings (key, value, updated_at) VALUES ('workspace.multi_agent_per_repo', 'true', '2026-01-01T00:00:00Z')`);
      db.run(`CREATE TABLE roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        path TEXT NOT NULL,
        git_root TEXT,
        host_default TEXT NOT NULL DEFAULT 'claude-code',
        default_host_type TEXT,
        missing_at TEXT,
        last_discovered_at TEXT,
        is_manual INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      db.run(`INSERT INTO roles (id, name, path, host_default, created_at, updated_at) VALUES ('legacy', 'legacy', '.', 'claude-code', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`);

      migrate(db);

      // Multi-agent setting cleared.
      const set = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM settings WHERE key = 'workspace.multi_agent_per_repo'").get();
      expect(set?.count).toBe(0);
      // Old role row gone (post-migration-14 the table is `agents`; legacy
      // `roles` was wiped by migration 11 and the table itself renamed by 14).
      expect(db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM agents").get()?.count).toBe(0);
      // New columns present (read from current canonical name `agents`).
      const cols = tableInfo(db, "agents").map((c) => c.name);
      expect(cols).toContain("repo_id");
      expect(cols).not.toContain("path");
    } finally {
      db.close();
    }
  });
});
