import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { migrate, openFleetDb } from "../src/db.ts";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wa-mig24-"));
  dbPath = join(dir, "ws.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Reproduce the macOS-Bun-SQLite breakage by recreating each affected
 * table with the legacy `REFERENCES roles(id)` DDL so a fully-migrated
 * DB looks like the broken pre-v24 state. Bun blocks
 * `PRAGMA writable_schema` mutations on sqlite_master, so this uses
 * the same recreate idiom v24 itself uses, just in reverse.
 */
function corruptToMacShape(db: ReturnType<typeof openFleetDb>): void {
  const targets = [
    "sessions",
    "agent_locks",
    "permissions",
    "launch_tokens",
    "runners",
    "channel_messages",
    "events",
    "kanban_tasks",
    "kanban_comments",
    "kanban_dependencies",
    "kanban_activity",
    "kanban_notifications",
    "kanban_epics",
    "kanban_epic_comments",
    "kanban_epic_activity",
    "kanban_epic_notifications",
  ];

  db.run("PRAGMA foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.run("DELETE FROM schema_migrations WHERE version = 24");
      for (const name of targets) {
        const row = db.query<{ sql: string }, [string]>(
          "SELECT sql FROM sqlite_master WHERE name = ? AND type = 'table'",
        ).get(name);
        if (!row || !row.sql || !/REFERENCES "?agents"?\(id\)/.test(row.sql)) continue;

        const tempName = `${name}_corrupt_new`;
        const newDdl = row.sql
          .replace(
            new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?["\`\\[]?${name}["\`\\]]?`, "i"),
            `CREATE TABLE ${tempName}`,
          )
          .replace(/REFERENCES "?agents"?\(id\)/g, "REFERENCES roles(id)");

        const indexes = db.query<{ sql: string }, [string]>(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL",
        ).all(name);

        db.run(newDdl);
        db.run(`INSERT INTO ${tempName} SELECT * FROM ${name}`);
        db.run(`DROP TABLE ${name}`);
        db.run(`ALTER TABLE ${tempName} RENAME TO ${name}`);
        for (const idx of indexes) db.run(idx.sql);
      }
    })();
  } finally {
    db.run("PRAGMA foreign_keys = ON");
  }
}

function tableDdl(db: ReturnType<typeof openFleetDb>, name: string): string {
  return db.query<{ sql: string }, [string]>(
    "SELECT sql FROM sqlite_master WHERE name = ? AND type = 'table'",
  ).get(name)?.sql || "";
}

function expectAgentsFk(ddl: string) {
  // Linux SQLite stores the auto-rewritten reference quoted ("agents"); the
  // v24 REPLACE on a Mac-broken DB writes it unquoted (agents). Accept both.
  expect(ddl).not.toContain("REFERENCES roles(id)");
  expect(ddl).toMatch(/REFERENCES "?agents"?\(id\)/);
}

test("v24 rewrites pre-v14 ID-FK arrows from roles(id) to agents(id)", () => {
  const db = openFleetDb(dbPath);
  migrate(db);

  // Simulate a Mac DB that hit v14's auto-rewrite gap.
  corruptToMacShape(db);
  expect(tableDdl(db, "sessions")).toContain("REFERENCES roles(id)");
  expect(tableDdl(db, "kanban_tasks")).toContain("REFERENCES roles(id)");

  // Re-running migrate() should apply v24 and fix every affected table.
  migrate(db);

  for (const name of [
    "sessions",
    "agent_locks",
    "permissions",
    "launch_tokens",
    "runners",
    "channel_messages",
    "events",
    "kanban_tasks",
    "kanban_comments",
    "kanban_dependencies",
    "kanban_activity",
    "kanban_notifications",
    "kanban_epics",
    "kanban_epic_comments",
    "kanban_epic_activity",
    "kanban_epic_notifications",
  ]) {
    const ddl = tableDdl(db, name);
    expect(ddl).not.toContain("REFERENCES roles(id)");
    if (/REFERENCES/.test(ddl)) expectAgentsFk(ddl);
  }

  // Sanity: RBAC tables that legitimately point at the new RBAC `roles`
  // table must NOT be rewritten.
  expect(tableDdl(db, "agent_roles")).toContain("REFERENCES roles(id)");
  expect(tableDdl(db, "role_grants")).toContain("REFERENCES roles(id)");

  db.close();
});

test("v24 is idempotent on Linux DBs where v14 auto-rewrite already happened", () => {
  const db = openFleetDb(dbPath);
  migrate(db);

  // sessions FK already points at agents (Linux behaviour). Capture state.
  const before = tableDdl(db, "sessions");
  expectAgentsFk(before);

  // Force v24 to re-run.
  db.run("DELETE FROM schema_migrations WHERE version = 24");
  migrate(db);

  expect(tableDdl(db, "sessions")).toBe(before);

  db.close();
});

test("v24 INSERT into sessions succeeds after FK arrow rewrite", () => {
  const db = openFleetDb(dbPath);
  migrate(db);

  corruptToMacShape(db);
  migrate(db);

  // Seed the prerequisite rows: an agent (identity) + a workspace_repos
  // entry for the agent's repo_id FK.
  const repoId = "repo-test-1";
  db.run(
    "INSERT INTO workspace_repos (id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)",
    [repoId, "platform", "/tmp/platform", "2026-05-09T00:00:00Z", "2026-05-09T00:00:00Z"],
  );
  const agentId = "agent-test-1";
  db.run(
    "INSERT INTO agents (id, repo_id, name, host_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [agentId, repoId, "architect", "claude-code", "2026-05-09T00:00:00Z", "2026-05-09T00:00:00Z"],
  );

  // The bug: this insert would fail with FOREIGN KEY constraint failed
  // because sessions.role_id resolved against the RBAC roles table after
  // v15. Post-v24 it resolves against agents and succeeds.
  expect(() => {
    db.run(
      `INSERT INTO sessions (id, role_id, host_type, runner_pid, status, cwd, started_at, last_seen, summary)
       VALUES (?, ?, ?, ?, 'running', ?, ?, ?, '')`,
      ["sess-1", agentId, "claude-code", 99999, "/tmp/platform", "2026-05-09T00:00:00Z", "2026-05-09T00:00:00Z"],
    );
  }).not.toThrow();

  db.close();
});
