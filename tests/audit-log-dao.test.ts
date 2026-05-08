import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { migrate, openFleetDb } from "../src/db.ts";
import {
  appendAudit,
  countAudit,
  getAuditEntry,
  listAudit,
  listAuditActors,
} from "../src/audit-log-dao.ts";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wa-audit-dao-"));
  dbPath = join(dir, "ws.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function openMigrated() {
  const db = openFleetDb(dbPath);
  migrate(db);
  return db;
}

describe("audit-log-dao", () => {
  describe("appendAudit", () => {
    test("inserts a row with generated id + ts and returns the entry", () => {
      const db = openMigrated();
      try {
        const before = Date.now();
        const entry = appendAudit(db, {
          kind: "grant_miss_soft",
          actor_agent_id: "agent-1",
          target_kind: "epic",
          target_id: "EP-001",
          payload: { tool: "update_kanban_epic_status", outcome: "soft_allow" },
        });
        const after = Date.now();
        expect(entry.id).toBeTruthy();
        expect(entry.kind).toBe("grant_miss_soft");
        const tsMs = Date.parse(entry.ts);
        expect(tsMs).toBeGreaterThanOrEqual(before - 1);
        expect(tsMs).toBeLessThanOrEqual(after + 1);
        expect(entry.payload.tool).toBe("update_kanban_epic_status");
      } finally {
        db.close();
      }
    });

    test("accepts null actor + target columns for system-emitted rows", () => {
      const db = openMigrated();
      try {
        const entry = appendAudit(db, {
          kind: "system_event",
          payload: { detail: "daemon_started" },
        });
        expect(entry.actor_agent_id).toBeNull();
        expect(entry.target_kind).toBeNull();
        expect(entry.target_id).toBeNull();
      } finally {
        db.close();
      }
    });

    test("payload round-trips through JSON storage", () => {
      const db = openMigrated();
      try {
        const payload = {
          tool: "comment_kanban_task",
          expected_grant: { kind: "kanban_action", value: "comment_task", scope: null },
          actor_grants: [{ kind: "kanban_action", value: "comment_task", scope: "own_assignment" }],
          agent_roles: ["engineer"],
        };
        const written = appendAudit(db, { kind: "grant_miss_soft", payload });
        const read = getAuditEntry(db, written.id);
        expect(read?.payload).toEqual(payload);
      } finally {
        db.close();
      }
    });
  });

  describe("listAudit", () => {
    test("orders by ts DESC and clamps limit to default 50 when omitted", () => {
      const db = openMigrated();
      try {
        for (let i = 0; i < 60; i++) {
          appendAudit(db, { kind: "grant_check_pass", payload: { i } });
        }
        const rows = listAudit(db);
        expect(rows).toHaveLength(50);
        // Most recent first: ts of row[0] >= ts of row[49]. Bun sqlite serializes
        // INSERTs to the same millisecond sometimes, so use >= rather than >.
        expect(Date.parse(rows[0]!.ts)).toBeGreaterThanOrEqual(Date.parse(rows[49]!.ts));
      } finally {
        db.close();
      }
    });

    test("limit clamps to [1, 500]", () => {
      const db = openMigrated();
      try {
        for (let i = 0; i < 5; i++) {
          appendAudit(db, { kind: "grant_check_pass", payload: { i } });
        }
        expect(listAudit(db, { limit: 0 })).toHaveLength(1);
        expect(listAudit(db, { limit: -10 })).toHaveLength(1);
        expect(listAudit(db, { limit: 9999 })).toHaveLength(5);
      } finally {
        db.close();
      }
    });

    test("filters by single kind", () => {
      const db = openMigrated();
      try {
        appendAudit(db, { kind: "grant_miss_soft", payload: {} });
        appendAudit(db, { kind: "grant_check_pass", payload: {} });
        appendAudit(db, { kind: "grant_check_pass", payload: {} });
        const rows = listAudit(db, { kind: "grant_miss_soft" });
        expect(rows).toHaveLength(1);
        expect(rows[0]!.kind).toBe("grant_miss_soft");
      } finally {
        db.close();
      }
    });

    test("filters by kind array (IN clause)", () => {
      const db = openMigrated();
      try {
        appendAudit(db, { kind: "grant_miss_soft", payload: {} });
        appendAudit(db, { kind: "grant_check_pass", payload: {} });
        appendAudit(db, { kind: "role_assigned", payload: {} });
        const rows = listAudit(db, { kind: ["grant_miss_soft", "grant_check_pass"] });
        expect(rows.map((r) => r.kind).sort()).toEqual(["grant_check_pass", "grant_miss_soft"]);
      } finally {
        db.close();
      }
    });

    test("kind=[] short-circuits to empty result without query", () => {
      const db = openMigrated();
      try {
        appendAudit(db, { kind: "grant_miss_soft", payload: {} });
        expect(listAudit(db, { kind: [] })).toEqual([]);
      } finally {
        db.close();
      }
    });

    test("filters by actor_agent_id", () => {
      const db = openMigrated();
      try {
        appendAudit(db, { kind: "grant_miss_soft", actor_agent_id: "agent-A", payload: {} });
        appendAudit(db, { kind: "grant_miss_soft", actor_agent_id: "agent-B", payload: {} });
        const rows = listAudit(db, { actor_agent_id: "agent-A" });
        expect(rows).toHaveLength(1);
        expect(rows[0]!.actor_agent_id).toBe("agent-A");
      } finally {
        db.close();
      }
    });

    test("filters by since (inclusive)", () => {
      const db = openMigrated();
      try {
        // Manually insert known timestamps to make the assertion precise.
        const stmts: Array<[string, string]> = [
          ["a-1", "2026-05-01T00:00:00Z"],
          ["a-2", "2026-05-02T00:00:00Z"],
          ["a-3", "2026-05-03T00:00:00Z"],
        ];
        for (const [id, ts] of stmts) {
          db.run(
            "INSERT INTO audit_log (id, ts, kind, actor_agent_id, target_kind, target_id, payload_json) VALUES (?, ?, 'grant_miss_soft', NULL, NULL, NULL, '{}')",
            [id, ts],
          );
        }
        const rows = listAudit(db, { since: "2026-05-02T00:00:00Z" });
        expect(rows.map((r) => r.id).sort()).toEqual(["a-2", "a-3"]);
      } finally {
        db.close();
      }
    });

    test("offset paginates within ts-ordered rows", () => {
      const db = openMigrated();
      try {
        for (let i = 0; i < 10; i++) {
          db.run(
            "INSERT INTO audit_log (id, ts, kind, actor_agent_id, target_kind, target_id, payload_json) VALUES (?, ?, 'grant_miss_soft', NULL, NULL, NULL, '{}')",
            [`p-${i}`, `2026-05-04T00:00:${String(i).padStart(2, "0")}Z`],
          );
        }
        const page1 = listAudit(db, { limit: 4, offset: 0 });
        const page2 = listAudit(db, { limit: 4, offset: 4 });
        expect(page1.map((r) => r.id)).toEqual(["p-9", "p-8", "p-7", "p-6"]);
        expect(page2.map((r) => r.id)).toEqual(["p-5", "p-4", "p-3", "p-2"]);
      } finally {
        db.close();
      }
    });
  });

  describe("countAudit", () => {
    test("counts all rows when no filter", () => {
      const db = openMigrated();
      try {
        for (let i = 0; i < 7; i++) appendAudit(db, { kind: "grant_check_pass", payload: {} });
        expect(countAudit(db)).toBe(7);
      } finally {
        db.close();
      }
    });

    test("counts rows matching a kind filter", () => {
      const db = openMigrated();
      try {
        appendAudit(db, { kind: "grant_miss_soft", payload: {} });
        appendAudit(db, { kind: "grant_miss_soft", payload: {} });
        appendAudit(db, { kind: "grant_check_pass", payload: {} });
        expect(countAudit(db, { kind: "grant_miss_soft" })).toBe(2);
      } finally {
        db.close();
      }
    });

    test("kind=[] returns 0 without query", () => {
      const db = openMigrated();
      try {
        appendAudit(db, { kind: "grant_miss_soft", payload: {} });
        expect(countAudit(db, { kind: [] })).toBe(0);
      } finally {
        db.close();
      }
    });
  });

  describe("listAuditActors", () => {
    test("returns distinct non-null actor ids ordered alphabetically", () => {
      const db = openMigrated();
      try {
        appendAudit(db, { kind: "grant_miss_soft", actor_agent_id: "agent-B", payload: {} });
        appendAudit(db, { kind: "grant_miss_soft", actor_agent_id: "agent-A", payload: {} });
        appendAudit(db, { kind: "grant_miss_soft", actor_agent_id: "agent-A", payload: {} });
        appendAudit(db, { kind: "grant_miss_soft", payload: {} }); // null actor — excluded
        expect(listAuditActors(db, { kind: "grant_miss_soft" })).toEqual(["agent-A", "agent-B"]);
      } finally {
        db.close();
      }
    });
  });

  describe("actor_display_id join", () => {
    test("resolves to <repo>:<agent> when actor agent exists", () => {
      const db = openMigrated();
      try {
        const now = new Date().toISOString();
        db.run("INSERT INTO workspace_repos (id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at) VALUES ('repo-1', 'whatsagent', '/tmp/wa', NULL, NULL, NULL, ?, ?)", [now, now]);
        db.run("INSERT INTO agents (id, repo_id, name, host_default, default_host_type, created_at, updated_at) VALUES ('agent-1', 'repo-1', 'main', 'claude-code', NULL, ?, ?)", [now, now]);
        const entry = appendAudit(db, { kind: "grant_miss_soft", actor_agent_id: "agent-1", payload: {} });
        expect(entry.actor_display_id).toBe("whatsagent:main");
        const fetched = getAuditEntry(db, entry.id);
        expect(fetched?.actor_display_id).toBe("whatsagent:main");
      } finally {
        db.close();
      }
    });

    test("resolves to null when actor agent has been deleted", () => {
      const db = openMigrated();
      try {
        const now = new Date().toISOString();
        db.run("INSERT INTO workspace_repos (id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at) VALUES ('repo-1', 'wa', '/tmp/wa', NULL, NULL, NULL, ?, ?)", [now, now]);
        db.run("INSERT INTO agents (id, repo_id, name, host_default, default_host_type, created_at, updated_at) VALUES ('agent-departed', 'repo-1', 'departed', 'claude-code', NULL, ?, ?)", [now, now]);
        appendAudit(db, { kind: "grant_miss_soft", actor_agent_id: "agent-departed", payload: {} });
        db.run("DELETE FROM agents WHERE id = 'agent-departed'");
        const rows = listAudit(db);
        expect(rows[0]!.actor_agent_id).toBe("agent-departed");
        expect(rows[0]!.actor_display_id).toBeNull();
      } finally {
        db.close();
      }
    });

    test("resolves to null for system-emitted rows (actor_agent_id NULL)", () => {
      const db = openMigrated();
      try {
        appendAudit(db, { kind: "system_event", payload: {} });
        const rows = listAudit(db);
        expect(rows[0]!.actor_display_id).toBeNull();
      } finally {
        db.close();
      }
    });
  });

  describe("payload edge cases", () => {
    test("malformed payload_json surfaces as { _raw }", () => {
      const db = openMigrated();
      try {
        db.run(
          "INSERT INTO audit_log (id, ts, kind, actor_agent_id, target_kind, target_id, payload_json) VALUES (?, ?, 'grant_miss_soft', NULL, NULL, NULL, ?)",
          ["bad-json", new Date().toISOString(), "this is not json"],
        );
        const entry = getAuditEntry(db, "bad-json");
        expect(entry?.payload).toEqual({ _raw: "this is not json" });
      } finally {
        db.close();
      }
    });

    test("array payload coerces to empty object (rows must be Record-shaped)", () => {
      const db = openMigrated();
      try {
        db.run(
          "INSERT INTO audit_log (id, ts, kind, actor_agent_id, target_kind, target_id, payload_json) VALUES (?, ?, 'grant_miss_soft', NULL, NULL, NULL, ?)",
          ["arr", new Date().toISOString(), "[1,2,3]"],
        );
        const entry = getAuditEntry(db, "arr");
        expect(entry?.payload).toEqual({});
      } finally {
        db.close();
      }
    });
  });
});
