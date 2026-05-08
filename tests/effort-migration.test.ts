import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrate, openFleetDb } from "../src/db.ts";

type TestDb = ReturnType<typeof openFleetDb>;

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wa-effort-mig-"));
  dbPath = join(dir, "ws.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function createPreV22KanbanTables(db: TestDb) {
  db.run("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const now = new Date().toISOString();
  for (let version = 1; version <= 21; version += 1) {
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [version, now]);
  }
  db.run("CREATE TABLE kanban_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, display_id TEXT NOT NULL, effort TEXT NOT NULL)");
  db.run("CREATE TABLE kanban_epics (id INTEGER PRIMARY KEY AUTOINCREMENT, display_id TEXT NOT NULL, effort TEXT NOT NULL)");
}

function efforts(db: TestDb, table: "kanban_tasks" | "kanban_epics") {
  return db.query<{ display_id: string; effort: string }, []>(`SELECT display_id, effort FROM ${table} ORDER BY id`).all();
}

describe("migration 22 — Kanban effort T-shirt buckets", () => {
  test("backfills legacy effort values and records v22 idempotently", () => {
    const db = openFleetDb(dbPath);
    try {
      createPreV22KanbanTables(db);
      const legacyTasks: Array<[string, string]> = [["T-LOW", "Low"], ["T-MED", "Medium"], ["T-HIGH", "High"], ["T-XS", "XS"], ["T-XL", "XL"]];
      for (const [displayId, effort] of legacyTasks) {
        db.run("INSERT INTO kanban_tasks (display_id, effort) VALUES (?, ?)", [displayId, effort]);
      }
      const legacyEpics: Array<[string, string]> = [["E-LOW", "Low"], ["E-MED", "Medium"], ["E-HIGH", "High"], ["E-S", "S"], ["E-M", "M"]];
      for (const [displayId, effort] of legacyEpics) {
        db.run("INSERT INTO kanban_epics (display_id, effort) VALUES (?, ?)", [displayId, effort]);
      }

      migrate(db);
      expect(efforts(db, "kanban_tasks")).toEqual([
        { display_id: "T-LOW", effort: "S" },
        { display_id: "T-MED", effort: "M" },
        { display_id: "T-HIGH", effort: "L" },
        { display_id: "T-XS", effort: "XS" },
        { display_id: "T-XL", effort: "XL" },
      ]);
      expect(efforts(db, "kanban_epics")).toEqual([
        { display_id: "E-LOW", effort: "S" },
        { display_id: "E-MED", effort: "M" },
        { display_id: "E-HIGH", effort: "L" },
        { display_id: "E-S", effort: "S" },
        { display_id: "E-M", effort: "M" },
      ]);

      migrate(db);
      expect(efforts(db, "kanban_tasks").map((row) => row.effort)).toEqual(["S", "M", "L", "XS", "XL"]);
      expect(db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 22").get()?.count).toBe(1);
    } finally {
      db.close();
    }
  });
});
