import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  deleteAgentPersona,
  getAgentPersona,
  listAgentPersonas,
  PERSONA_FIELD_HARD_MAX,
  PERSONA_TOTAL_HARD_MAX,
  personaForPeers,
  personaForWhoami,
  PersonaSizeLimitError,
  upsertAgentPersona,
} from "../src/agent-personas-dao.ts";
import { migrate, openFleetDb } from "../src/db.ts";
import { deleteRoleById, insertRepo, insertRole } from "../src/workspace-decoupling-dao.ts";

let workspaceDir: string;
let dbPath: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "wa-persona-dao-"));
  dbPath = join(workspaceDir, "ws.sqlite");
});

afterEach(() => {
  rmSync(workspaceDir, { recursive: true, force: true });
});

function freshDb() {
  const db = openFleetDb(dbPath);
  migrate(db);
  return db;
}

function seedAgent(db: ReturnType<typeof freshDb>, name = "agent") {
  const repoDir = mkdtempSync(join(tmpdir(), "wa-persona-repo-"));
  const repo = insertRepo(db, { absolutePath: repoDir, name: `repo-${name}` });
  return insertRole(db, { repoId: repo.id, name });
}

describe("agent personas DAO", () => {
  test("upsert creates and updates persona rows", () => {
    const db = freshDb();
    try {
      const agent = seedAgent(db);
      const created = upsertAgentPersona(db, agent.id, {
        description: "Builder",
        responsibilities: "Owns implementation",
        skills: "TypeScript",
      });
      expect(created.warnings).toEqual([]);
      expect(created.row).toMatchObject({
        agent_id: agent.id,
        description: "Builder",
        responsibilities: "Owns implementation",
        boundaries: "",
        skills: "TypeScript",
      });

      const updated = upsertAgentPersona(db, agent.id, {
        description: "Reviewer",
        boundaries: "Do not ship without tests",
        working_style: "terse",
      });
      expect(updated.row?.created_at).toBe(created.row?.created_at);
      expect(updated.row?.updated_at).not.toBe("");
      expect(getAgentPersona(db, agent.id)).toMatchObject({
        description: "Reviewer",
        responsibilities: "",
        boundaries: "Do not ship without tests",
        skills: "",
        working_style: "terse",
      });
    } finally {
      db.close();
    }
  });

  test("all-empty upsert deletes the persona row", () => {
    const db = freshDb();
    try {
      const agent = seedAgent(db);
      upsertAgentPersona(db, agent.id, { description: "temporary" });
      expect(getAgentPersona(db, agent.id)).not.toBeNull();
      const cleared = upsertAgentPersona(db, agent.id, {});
      expect(cleared).toEqual({ row: null, warnings: [] });
      expect(getAgentPersona(db, agent.id)).toBeNull();
      expect(deleteAgentPersona(db, agent.id)).toBe(false);
    } finally {
      db.close();
    }
  });

  test("rejects per-field and total hard cap violations without storing changes", () => {
    const db = freshDb();
    try {
      const agent = seedAgent(db);
      upsertAgentPersona(db, agent.id, { description: "safe" });

      expect(() => upsertAgentPersona(db, agent.id, { description: "x".repeat(PERSONA_FIELD_HARD_MAX + 1) })).toThrow(PersonaSizeLimitError);
      expect(getAgentPersona(db, agent.id)?.description).toBe("safe");

      expect(() => upsertAgentPersona(db, agent.id, {
        responsibilities: "a".repeat(16_000),
        boundaries: "b".repeat(16_000),
        skills: "c".repeat(16_000),
        working_style: "d".repeat(16_000),
        extra_prompt: "e".repeat(PERSONA_TOTAL_HARD_MAX - 64_000 + 1),
      })).toThrow(PersonaSizeLimitError);
      expect(getAgentPersona(db, agent.id)?.description).toBe("safe");
    } finally {
      db.close();
    }
  });

  test("batch fetch returns a map and shaping helpers drop empty/private fields", () => {
    const db = freshDb();
    try {
      const alpha = seedAgent(db, "alpha");
      const beta = seedAgent(db, "beta");
      const missing = seedAgent(db, "missing");
      upsertAgentPersona(db, alpha.id, { description: "Alpha", extra_prompt: "private" });
      upsertAgentPersona(db, beta.id, { skills: "Research", working_style: "careful" });

      const rows = listAgentPersonas(db, [alpha.id, beta.id, alpha.id, missing.id]);
      expect(Array.from(rows.keys()).sort()).toEqual([alpha.id, beta.id].sort());
      expect(personaForWhoami(rows.get(alpha.id))).toEqual({ description: "Alpha", extra_prompt: "private" });
      expect(personaForPeers(rows.get(alpha.id))).toEqual({ description: "Alpha" });
      expect(personaForPeers(rows.get(missing.id))).toBeNull();
    } finally {
      db.close();
    }
  });

  test("agent delete cascades persona rows", () => {
    const db = freshDb();
    try {
      const agent = seedAgent(db);
      upsertAgentPersona(db, agent.id, { description: "delete me" });
      expect(getAgentPersona(db, agent.id)).not.toBeNull();
      expect(deleteRoleById(db, agent.id)).toBe(true);
      expect(getAgentPersona(db, agent.id)).toBeNull();
    } finally {
      db.close();
    }
  });

  test("soft warnings are advisory only", () => {
    const db = freshDb();
    try {
      const agent = seedAgent(db);
      const result = upsertAgentPersona(db, agent.id, { description: "x".repeat(281), extra_prompt: "y".repeat(24_000) });
      expect(result.row?.description.length).toBe(281);
      expect(result.warnings.some(w => w.includes("description"))).toBe(true);
      expect(result.warnings.some(w => w.includes("persona total"))).toBe(true);
    } finally {
      db.close();
    }
  });
});
