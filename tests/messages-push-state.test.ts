import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  getPushStateStats,
  insertMessage,
  listAgentInboxRows,
  markMessagesPushed,
  markMessagesRead,
  migrate,
  openFleetDb,
} from "../src/db.ts";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wa-push-state-"));
  dbPath = join(dir, "ws.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function ensureRepo(db: ReturnType<typeof openFleetDb>): string {
  const existing = db.query<{ id: string }, []>(
    "SELECT id FROM workspace_repos LIMIT 1",
  ).get();
  if (existing) return existing.id;
  const id = randomUUID();
  const ts = "2026-01-01T00:00:00Z";
  db.run(
    `INSERT INTO workspace_repos (id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at)
     VALUES (?, 'repo', '/tmp/repo', NULL, NULL, NULL, ?, ?)`,
    [id, ts, ts],
  );
  return id;
}

function makeRole(db: ReturnType<typeof openFleetDb>, name: string): string {
  const id = randomUUID();
  const ts = "2026-01-01T00:00:00Z";
  const repoId = ensureRepo(db);
  db.run(
    `INSERT INTO agents (id, repo_id, name, host_default, default_host_type, created_at, updated_at)
     VALUES (?, ?, ?, 'opencode', NULL, ?, ?)`,
    [id, repoId, name, ts, ts],
  );
  return id;
}

function insertSession(db: ReturnType<typeof openFleetDb>, roleId: string, sessionId: string, status: "running" | "stopped" = "running"): void {
  const ts = "2026-01-01T00:00:00Z";
  db.run(
    `INSERT INTO sessions (id, role_id, host_type, status, cwd, started_at, ended_at, last_seen, summary)
     VALUES (?, ?, 'opencode', ?, '/tmp/repo', ?, ?, ?, '')`,
    [sessionId, roleId, status, ts, status === "stopped" ? ts : null, ts],
  );
}

function insertActiveRunner(db: ReturnType<typeof openFleetDb>, roleId: string, sessionId: string): void {
  const ts = "2026-01-01T00:00:00Z";
  db.run(
    `INSERT INTO runners (agent_id, session_id, runner_pid, socket_path, metadata_path, status, started_at, last_seen)
     VALUES (?, ?, 123, '', '/tmp/runner.json', 'running', ?, ?)`,
    [roleId, sessionId, ts, ts],
  );
}

function tableInfo(db: ReturnType<typeof openFleetDb>, name: string): Array<{ name: string; type: string; notnull: number; dflt_value: string | null }> {
  return db.query<{ name: string; type: string; notnull: number; dflt_value: string | null }, []>(
    `PRAGMA table_info(${name})`,
  ).all();
}

function tableSql(db: ReturnType<typeof openFleetDb>, name: string): string {
  const row = db.query<{ sql: string }, [string]>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(name);
  return row?.sql ?? "";
}

describe("EP-030 T1 — messages push-state schema migration v21", () => {
  test("v21 records itself in schema_migrations", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const row = db.query<{ version: number }, [number]>(
        "SELECT version FROM schema_migrations WHERE version = ?",
      ).get(21);
      expect(row?.version).toBe(21);
    } finally {
      db.close();
    }
  });

  test("messages.pushed_at column exists, nullable TEXT", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const cols = tableInfo(db, "messages");
      const pushedAt = cols.find((c) => c.name === "pushed_at");
      expect(pushedAt).toBeDefined();
      expect(pushedAt?.type).toBe("TEXT");
      expect(pushedAt?.notnull).toBe(0);
    } finally {
      db.close();
    }
  });

  test("messages.state CHECK rejects bogus state value", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const sql = tableSql(db, "messages");
      expect(sql).toContain("CHECK");
      expect(sql).toMatch(/state\s+IN\s*\(/i);
      // Direct INSERT bypassing helpers should fail on bogus state.
      const ts = "2026-01-01T00:00:00Z";
      const fromId = makeRole(db, "alice");
      const toId = makeRole(db, "bob");
      expect(() => {
        db.run(
          `INSERT INTO messages (thread_id, from_role_id, to_role_id, from_session_id, to_session_id, from_display, to_display, body, state, delivery_kind, broadcast_id, sent_at, error)
           VALUES (?, ?, ?, NULL, NULL, 'alice', 'bob', 'hi', 'bogus', 'direct', NULL, ?, NULL)`,
          ["t", fromId, toId, ts],
        );
      }).toThrow();
    } finally {
      db.close();
    }
  });

  test("messages.state CHECK admits pending, pushed, delivered, rejected, acked", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const ts = "2026-01-01T00:00:00Z";
      const fromId = makeRole(db, "alice");
      const toId = makeRole(db, "bob");
      for (const value of ["pending", "pushed", "delivered", "rejected", "acked"] as const) {
        expect(() => {
          db.run(
            `INSERT INTO messages (thread_id, from_role_id, to_role_id, from_session_id, to_session_id, from_display, to_display, body, state, delivery_kind, broadcast_id, sent_at, error)
             VALUES (?, ?, ?, NULL, NULL, 'alice', 'bob', 'hi', ?, 'direct', NULL, ?, NULL)`,
            ["t", fromId, toId, value, ts],
          );
        }).not.toThrow();
      }
    } finally {
      db.close();
    }
  });

  test("backfill: existing pending and delivered rows preserve state through v21", () => {
    // Roll v21 back, insert legacy rows with state=pending+delivered, then re-run migrate.
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const fromId = makeRole(db, "alice");
      const toId = makeRole(db, "bob");
      const ts = "2026-01-01T00:00:00Z";
      db.run("DELETE FROM schema_migrations WHERE version = 21");
      // Drop the new table form, recreate v20 shape (without pushed_at, without CHECK), copy rows.
      // Drop FTS triggers + rebuild table to v20-shape (no pushed_at, no CHECK).
      db.run("DROP TRIGGER IF EXISTS messages_ai");
      db.run("DROP TRIGGER IF EXISTS messages_ad");
      db.run("DROP TRIGGER IF EXISTS messages_au");
      db.run("ALTER TABLE messages RENAME TO messages_pre_v21");
      db.run(`CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        from_role_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        to_role_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        from_session_id TEXT,
        to_session_id TEXT,
        from_display TEXT,
        to_display TEXT,
        body TEXT NOT NULL,
        state TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        delivered_at TEXT,
        acked_at TEXT,
        error TEXT,
        delivery_kind TEXT NOT NULL DEFAULT 'direct',
        broadcast_id TEXT
      )`);
      db.run("DROP TABLE messages_pre_v21");
      db.run(
        `INSERT INTO messages (thread_id, from_role_id, to_role_id, body, state, delivery_kind, sent_at)
         VALUES (?, ?, ?, 'p1', 'pending', 'direct', ?), (?, ?, ?, 'd1', 'delivered', 'direct', ?)`,
        ["t1", fromId, toId, ts, "t2", fromId, toId, ts],
      );
      // Re-run migrate to apply v21 again.
      migrate(db);
      const rows = db.query<{ id: number; state: string; pushed_at: string | null }, []>(
        "SELECT id, state, pushed_at FROM messages ORDER BY id ASC",
      ).all();
      expect(rows.length).toBe(2);
      expect(rows[0]!.state).toBe("pending");
      expect(rows[0]!.pushed_at).toBeNull();
      expect(rows[1]!.state).toBe("delivered");
      expect(rows[1]!.pushed_at).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe("EP-030 T1 — markMessagesPushed", () => {
  test("transitions pending → pushed, sets pushed_at, returns updated rows", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const fromId = makeRole(db, "alice");
      const toId = makeRole(db, "bob");
      const session = "sess-1";
      const m1 = insertMessage(db, {
        threadId: "t", fromRoleId: fromId, toRoleId: toId,
        fromSessionId: null, toSessionId: session,
        body: "hi", state: "pending",
      });
      const m2 = insertMessage(db, {
        threadId: "t", fromRoleId: fromId, toRoleId: toId,
        fromSessionId: null, toSessionId: session,
        body: "hi2", state: "pending",
      });
      const updated = markMessagesPushed(db, toId, session, [m1.id, m2.id]);
      expect(updated.map((r) => r.id).sort()).toEqual([m1.id, m2.id].sort());
      for (const row of updated) {
        expect(row.state).toBe("pushed");
        expect(row.pushed_at).not.toBeNull();
      }
    } finally {
      db.close();
    }
  });

  test("idempotent: second call on already-pushed rows is no-op (returns empty)", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const fromId = makeRole(db, "alice");
      const toId = makeRole(db, "bob");
      const session = "sess-1";
      const m = insertMessage(db, {
        threadId: "t", fromRoleId: fromId, toRoleId: toId,
        fromSessionId: null, toSessionId: session,
        body: "hi", state: "pending",
      });
      const first = markMessagesPushed(db, toId, session, [m.id]);
      expect(first.length).toBe(1);
      const firstPushedAt = first[0]!.pushed_at;
      const second = markMessagesPushed(db, toId, session, [m.id]);
      expect(second.length).toBe(0);
      // pushed_at unchanged
      const after = db.query<{ pushed_at: string | null }, [number]>(
        "SELECT pushed_at FROM messages WHERE id = ?",
      ).get(m.id);
      expect(after?.pushed_at).toBe(firstPushedAt!);
    } finally {
      db.close();
    }
  });

  test("does not transition delivered rows (no-op on delivered)", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const fromId = makeRole(db, "alice");
      const toId = makeRole(db, "bob");
      const session = "sess-1";
      const m = insertMessage(db, {
        threadId: "t", fromRoleId: fromId, toRoleId: toId,
        fromSessionId: null, toSessionId: session,
        body: "hi", state: "delivered",
      });
      const result = markMessagesPushed(db, toId, session, [m.id]);
      expect(result.length).toBe(0);
      const row = db.query<{ state: string; pushed_at: string | null }, [number]>(
        "SELECT state, pushed_at FROM messages WHERE id = ?",
      ).get(m.id);
      expect(row?.state).toBe("delivered");
      expect(row?.pushed_at).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe("EP-030 T1 — listAgentInboxRows", () => {
  test("returns both pending and pushed, ordered by id ASC, excludes delivered", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const fromId = makeRole(db, "alice");
      const toId = makeRole(db, "bob");
      const session = "sess-1";
      const a = insertMessage(db, {
        threadId: "t", fromRoleId: fromId, toRoleId: toId,
        fromSessionId: null, toSessionId: session,
        body: "a", state: "pending",
      });
      const b = insertMessage(db, {
        threadId: "t", fromRoleId: fromId, toRoleId: toId,
        fromSessionId: null, toSessionId: session,
        body: "b", state: "pending",
      });
      const c = insertMessage(db, {
        threadId: "t", fromRoleId: fromId, toRoleId: toId,
        fromSessionId: null, toSessionId: session,
        body: "c", state: "delivered",
      });
      // Push b only.
      markMessagesPushed(db, toId, session, [b.id]);
      const rows = listAgentInboxRows(db, toId, session, 50);
      expect(rows.map((r) => r.id)).toEqual([a.id, b.id]);
      expect(rows.find((r) => r.id === a.id)?.state).toBe("pending");
      expect(rows.find((r) => r.id === b.id)?.state).toBe("pushed");
      expect(rows.find((r) => r.id === c.id)).toBeUndefined();
    } finally {
      db.close();
    }
  });

  test("does not claim rows owned by another running session", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const fromId = makeRole(db, "alice");
      const toId = makeRole(db, "bob");
      const live = "sess-live";
      const otherLive = "sess-other-live";
      insertSession(db, toId, live, "running");
      insertSession(db, toId, otherLive, "running");
      insertActiveRunner(db, toId, otherLive);
      const a = insertMessage(db, {
        threadId: "t", fromRoleId: fromId, toRoleId: toId,
        fromSessionId: null, toSessionId: live,
        body: "live", state: "pending",
      });
      insertMessage(db, {
        threadId: "t", fromRoleId: fromId, toRoleId: toId,
        fromSessionId: null, toSessionId: otherLive,
        body: "other live", state: "pending",
      });
      const rows = listAgentInboxRows(db, toId, live, 50);
      expect(rows.map((r) => r.id)).toEqual([a.id]);
    } finally {
      db.close();
    }
  });

  test("reclaims pending and pushed rows from a previous inactive runner even when its session row is stale-running", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const fromId = makeRole(db, "alice");
      const toId = makeRole(db, "bob");
      const oldSession = "sess-old";
      const live = "sess-live";
      insertSession(db, toId, oldSession, "running");
      const pending = insertMessage(db, {
        threadId: "t", fromRoleId: fromId, toRoleId: toId,
        fromSessionId: null, toSessionId: oldSession,
        body: "pending old", state: "pending",
      });
      const pushed = insertMessage(db, {
        threadId: "t", fromRoleId: fromId, toRoleId: toId,
        fromSessionId: null, toSessionId: oldSession,
        body: "pushed old", state: "pending",
      });
      expect(markMessagesPushed(db, toId, oldSession, [pushed.id]).map((r) => r.id)).toEqual([pushed.id]);
      insertSession(db, toId, live, "running");
      insertActiveRunner(db, toId, live);

      const rows = listAgentInboxRows(db, toId, live, 50);
      expect(rows.map((r) => r.id)).toEqual([pending.id, pushed.id]);
      expect(rows.map((r) => r.state)).toEqual(["pending", "pushed"]);

      expect(markMessagesPushed(db, toId, live, [pending.id]).map((r) => r.id)).toEqual([pending.id]);
      const delivered = markMessagesRead(db, toId, live, [pending.id, pushed.id]);
      expect(delivered.map((r) => r.id).sort()).toEqual([pending.id, pushed.id].sort());
      for (const id of [pending.id, pushed.id]) {
        const row = db.query<{ state: string; to_session_id: string | null; delivered_at: string | null }, [number]>(
          "SELECT state, to_session_id, delivered_at FROM messages WHERE id = ?",
        ).get(id);
        expect(row).toMatchObject({ state: "delivered", to_session_id: live, delivered_at: expect.any(String) });
      }
    } finally {
      db.close();
    }
  });

  test("respects limit + ordering", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const fromId = makeRole(db, "alice");
      const toId = makeRole(db, "bob");
      const session = "s";
      const ids: number[] = [];
      for (let i = 0; i < 5; i++) {
        const m = insertMessage(db, {
          threadId: "t", fromRoleId: fromId, toRoleId: toId,
          fromSessionId: null, toSessionId: session,
          body: `m${i}`, state: "pending",
        });
        ids.push(m.id);
      }
      const rows = listAgentInboxRows(db, toId, session, 3);
      expect(rows.map((r) => r.id)).toEqual(ids.slice(0, 3));
    } finally {
      db.close();
    }
  });
});

describe("EP-030 T4 — getPushStateStats", () => {
  test("returns pending + pushed counts and oldestPushedAt timestamp", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const empty = getPushStateStats(db);
      expect(empty).toEqual({ pending: 0, pushed: 0, oldestPushedAt: null });

      const fromId = makeRole(db, "alice");
      const toId = makeRole(db, "bob");
      const session = "sess-1";
      const a = insertMessage(db, {
        threadId: "t", fromRoleId: fromId, toRoleId: toId,
        fromSessionId: null, toSessionId: session,
        body: "a", state: "pending",
      });
      insertMessage(db, {
        threadId: "t", fromRoleId: fromId, toRoleId: toId,
        fromSessionId: null, toSessionId: session,
        body: "b", state: "pending",
      });
      const c = insertMessage(db, {
        threadId: "t", fromRoleId: fromId, toRoleId: toId,
        fromSessionId: null, toSessionId: session,
        body: "c", state: "delivered",
      });
      const beforePush = getPushStateStats(db);
      expect(beforePush).toEqual({ pending: 2, pushed: 0, oldestPushedAt: null });

      // Push `a` first — its pushed_at becomes oldestPushedAt.
      markMessagesPushed(db, toId, session, [a.id]);
      const afterFirst = getPushStateStats(db);
      expect(afterFirst.pending).toBe(1);
      expect(afterFirst.pushed).toBe(1);
      expect(typeof afterFirst.oldestPushedAt).toBe("string");

      // Delivered row never appears in pending/pushed.
      expect(c.state).toBe("delivered");
    } finally {
      db.close();
    }
  });

  test("review fix #3: auditPushDeliveryLag filters delivered to direct/broadcast before keying by id", () => {
    // Code-shape pin for the cross-table id-collision guard in
    // src/server/daemon.ts auditPushDeliveryLag. Channel + kanban rows
    // live on separate tables; their ids can numerically match a direct
    // message id and would corrupt the per-row lag audit if the map
    // weren't filtered before keying.
    const daemonSrc = readFileSync(new URL("../src/server/daemon.ts", import.meta.url), "utf8");
    expect(daemonSrc).toContain("function auditPushDeliveryLag");
    expect(daemonSrc).toContain('row.delivery_kind === "direct" || row.delivery_kind === "broadcast"');
  });

  test("review fix #4: rows with NULL to_role_id or NULL to_session_id are excluded", () => {
    // sendFleetMessage's human-web sentinel path leaves to_role_id NULL
    // (FK can't reference the sentinel). Such rows aren't pushable by any
    // plugin and would inflate the operator-facing pending counter.
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const fromId = makeRole(db, "alice");
      const toId = makeRole(db, "bob");
      const ts = "2026-01-01T00:00:00Z";
      // Row with NULL to_role_id (human-web sentinel shape).
      db.run(
        `INSERT INTO messages (thread_id, from_role_id, to_role_id, from_session_id, to_session_id, from_display, to_display, body, state, delivery_kind, broadcast_id, sent_at, error)
         VALUES ('t', ?, NULL, NULL, NULL, 'alice', 'human-web', 'web body', 'pending', 'direct', NULL, ?, NULL)`,
        [fromId, ts],
      );
      // Row with NULL to_session_id (offline target — no plugin push pipeline).
      db.run(
        `INSERT INTO messages (thread_id, from_role_id, to_role_id, from_session_id, to_session_id, from_display, to_display, body, state, delivery_kind, broadcast_id, sent_at, error)
         VALUES ('t', ?, ?, NULL, NULL, 'alice', 'bob', 'offline body', 'pending', 'direct', NULL, ?, NULL)`,
        [fromId, toId, ts],
      );
      // Real pushable row.
      insertMessage(db, {
        threadId: "t", fromRoleId: fromId, toRoleId: toId,
        fromSessionId: null, toSessionId: "live-session",
        body: "real", state: "pending",
      });
      const stats = getPushStateStats(db);
      expect(stats).toEqual({ pending: 1, pushed: 0, oldestPushedAt: null });
    } finally {
      db.close();
    }
  });
});
