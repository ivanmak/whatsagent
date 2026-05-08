import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { migrate, openFleetDb } from "../src/db.ts";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wa-mig16-"));
  dbPath = join(dir, "ws.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function tableNames(db: ReturnType<typeof openFleetDb>): string[] {
  return db.query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  ).all().map((r) => r.name);
}

function tableInfo(db: ReturnType<typeof openFleetDb>, name: string) {
  return db.query<{ name: string; type: string; notnull: number; pk: number }, []>(
    `PRAGMA table_info(${name})`,
  ).all();
}

function indexNames(db: ReturnType<typeof openFleetDb>, table: string): string[] {
  return db.query<{ name: string }, []>(`PRAGMA index_list(${table})`).all().map((r) => r.name);
}

/**
 * Roll a fully-migrated DB back to pre-v16 state so survival tests can
 * populate audit_log rows BEFORE migration 16 runs. Mirror of
 * applyMigration16.
 */
function rollbackV16(db: ReturnType<typeof openFleetDb>): void {
  db.transaction(() => {
    db.run("DROP TABLE IF EXISTS audit_log");
    db.run("DELETE FROM schema_migrations WHERE version = 16");
  })();
}

describe("workspace-db migration 16 — RBAC Phase 3 audit_log table", () => {
  test("fresh DB after migrate has audit_log table", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      expect(tableNames(db)).toContain("audit_log");
    } finally {
      db.close();
    }
  });

  test("audit_log shape: id, ts, kind, actor_agent_id, target_kind, target_id, payload_json", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const cols = tableInfo(db, "audit_log");
      const byName = new Map(cols.map((c) => [c.name, c]));
      expect(byName.get("id")?.pk).toBe(1);
      expect(byName.get("ts")?.notnull).toBe(1);
      expect(byName.get("kind")?.notnull).toBe(1);
      // actor_agent_id, target_kind, target_id are nullable
      expect(byName.get("actor_agent_id")?.notnull).toBe(0);
      expect(byName.get("target_kind")?.notnull).toBe(0);
      expect(byName.get("target_id")?.notnull).toBe(0);
      expect(byName.get("payload_json")?.notnull).toBe(1);
    } finally {
      db.close();
    }
  });

  test("audit_log has no foreign key on actor_agent_id (rows must outlive deleted agents)", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const fks = db.query<{ table: string; from: string }, []>(
        "PRAGMA foreign_key_list(audit_log)",
      ).all();
      expect(fks).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  test("audit_log has indexes on (kind, ts) and (actor, ts)", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const idxs = indexNames(db, "audit_log");
      expect(idxs).toContain("audit_log_kind_ts");
      expect(idxs).toContain("audit_log_actor_ts");
    } finally {
      db.close();
    }
  });

  test("schema_migrations records version 16", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const row = db.query<{ version: number }, []>(
        "SELECT version FROM schema_migrations WHERE version = 16",
      ).get();
      expect(row?.version).toBe(16);
    } finally {
      db.close();
    }
  });

  test("audit_log accepts inserts with all columns populated and round-trips payload_json", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const ts = "2026-05-04T18:23:11Z";
      db.run(
        "INSERT INTO audit_log (id, ts, kind, actor_agent_id, target_kind, target_id, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["aud-1", ts, "grant_miss_soft", "agent-x", "epic", "EP-001", JSON.stringify({ tool: "update_kanban_epic_status", outcome: "soft_allow" })],
      );
      const row = db.query<{
        id: string; ts: string; kind: string; actor_agent_id: string | null;
        target_kind: string | null; target_id: string | null; payload_json: string;
      }, []>("SELECT * FROM audit_log WHERE id = 'aud-1'").get();
      expect(row?.ts).toBe(ts);
      expect(row?.kind).toBe("grant_miss_soft");
      expect(row?.actor_agent_id).toBe("agent-x");
      expect(row?.target_kind).toBe("epic");
      expect(row?.target_id).toBe("EP-001");
      const payload = JSON.parse(row?.payload_json ?? "{}");
      expect(payload.tool).toBe("update_kanban_epic_status");
      expect(payload.outcome).toBe("soft_allow");
    } finally {
      db.close();
    }
  });

  test("audit_log accepts NULL actor_agent_id, target_kind, target_id (system-emitted rows)", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      db.run(
        "INSERT INTO audit_log (id, ts, kind, actor_agent_id, target_kind, target_id, payload_json) VALUES (?, ?, ?, NULL, NULL, NULL, ?)",
        ["aud-sys", "2026-05-04T19:00:00Z", "system_event", "{}"],
      );
      const row = db.query<{ actor_agent_id: string | null }, []>(
        "SELECT actor_agent_id FROM audit_log WHERE id = 'aud-sys'",
      ).get();
      expect(row?.actor_agent_id).toBeNull();
    } finally {
      db.close();
    }
  });

  test("inserted rows survive deletion of the referenced agent (no FK cascade)", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      // Seed an agent + a workspace_repo so the FK constraint on agents is happy.
      const now = new Date().toISOString();
      db.run("INSERT INTO workspace_repos (id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)",
        ["repo-1", "repo-1-name", "/tmp/repo-1", now, now]);
      db.run("INSERT INTO agents (id, repo_id, name, host_default, default_host_type, created_at, updated_at) VALUES (?, ?, ?, 'claude-code', NULL, ?, ?)",
        ["agent-orphan", "repo-1", "departed-worker", now, now]);

      db.run(
        "INSERT INTO audit_log (id, ts, kind, actor_agent_id, target_kind, target_id, payload_json) VALUES (?, ?, ?, ?, NULL, NULL, ?)",
        ["aud-orphan", now, "grant_miss_soft", "agent-orphan", "{}"],
      );

      // Delete the agent; the audit row must remain.
      db.run("DELETE FROM agents WHERE id = ?", ["agent-orphan"]);
      const row = db.query<{ actor_agent_id: string | null }, []>(
        "SELECT actor_agent_id FROM audit_log WHERE id = 'aud-orphan'",
      ).get();
      expect(row?.actor_agent_id).toBe("agent-orphan");
    } finally {
      db.close();
    }
  });

  test("rollback v16 then re-migrate preserves pre-existing rows are NOT possible (table dropped) — but the migration itself is idempotent on re-run", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      rollbackV16(db);
      expect(tableNames(db)).not.toContain("audit_log");
      // Re-run migrate; v16 reapplies clean.
      migrate(db);
      expect(tableNames(db)).toContain("audit_log");
      const row = db.query<{ version: number }, []>(
        "SELECT version FROM schema_migrations WHERE version = 16",
      ).get();
      expect(row?.version).toBe(16);
    } finally {
      db.close();
    }
  });
});
