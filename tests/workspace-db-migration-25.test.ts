import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { migrate, openFleetDb, runStartupRepair } from "../src/db.ts";

let workspaceDir: string;
let dbPath: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "wa-migration-25-"));
  dbPath = join(workspaceDir, "ws.sqlite");
});

afterEach(() => {
  rmSync(workspaceDir, { recursive: true, force: true });
});

function tableInfo(db: ReturnType<typeof openFleetDb>, table: string) {
  return db.query<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }, []>(`PRAGMA table_info(${table})`).all();
}

describe("workspace-db migration 25 — agent_personas", () => {
  test("fresh DB after migrate has agent_personas with 1:1 agent FK", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      const cols = tableInfo(db, "agent_personas");
      expect(cols.map(c => c.name)).toEqual([
        "agent_id",
        "description",
        "responsibilities",
        "boundaries",
        "skills",
        "working_style",
        "extra_prompt",
        "created_at",
        "updated_at",
      ]);
      expect(cols.find(c => c.name === "agent_id")?.pk).toBe(1);
      for (const field of ["description", "responsibilities", "boundaries", "skills", "working_style", "extra_prompt"]) {
        const col = cols.find(c => c.name === field);
        expect(col?.type).toBe("TEXT");
        expect(col?.notnull).toBe(1);
        expect(col?.dflt_value).toBe("''");
      }
      const fk = db.query<{ table: string; from: string; to: string; on_delete: string }, []>("PRAGMA foreign_key_list(agent_personas)").get();
      expect(fk).toMatchObject({ table: "agents", from: "agent_id", to: "id", on_delete: "CASCADE" });
      expect(db.query<{ version: number }, []>("SELECT version FROM schema_migrations WHERE version = 25").get()?.version).toBe(25);
    } finally {
      db.close();
    }
  });

  test("migration 25 can be re-applied to an existing DB", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      db.run("DROP TABLE agent_personas");
      db.run("DELETE FROM schema_migrations WHERE version = 25");
      migrate(db);
      expect(tableInfo(db, "agent_personas").map(c => c.name)).toContain("extra_prompt");
      expect(db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM schema_migrations WHERE version = 25").get()?.count).toBe(1);
    } finally {
      db.close();
    }
  });

  test("startup repair recreates missing agent_personas table", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      db.run("DROP TABLE agent_personas");
      runStartupRepair(db);
      expect(tableInfo(db, "agent_personas").map(c => c.name)).toContain("agent_id");
    } finally {
      db.close();
    }
  });
});
