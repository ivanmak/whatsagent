import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { migrate, openFleetDb } from "../src/db.ts";
import {
  createRbacRole,
  deleteRbacRole,
  getAgentRoles,
  getEffectiveGrants,
  getRbacRoleById,
  getRbacRoleByName,
  listAgentRoleNames,
  listRbacRoles,
  replaceRoleGrants,
  sanitizeRbacRoleName,
  setAgentRoles,
  updateRbacRole,
} from "../src/rbac-dao.ts";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wa-rbac-dao-"));
  dbPath = join(dir, "ws.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seedAgent(db: ReturnType<typeof openFleetDb>, repoId: string, agentId: string, agentName: string) {
  const now = new Date().toISOString();
  db.run("INSERT INTO workspace_repos (id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)",
    [repoId, repoId + "-name", "/tmp/" + repoId, now, now]);
  db.run("INSERT INTO agents (id, repo_id, name, host_default, default_host_type, created_at, updated_at) VALUES (?, ?, ?, 'claude-code', NULL, ?, ?)",
    [agentId, repoId, agentName, now, now]);
}

describe("rbac-dao", () => {
  describe("sanitizeRbacRoleName", () => {
    test("accepts lowercase + digits + underscore + hyphen", () => {
      expect(sanitizeRbacRoleName("pm")).toBe("pm");
      expect(sanitizeRbacRoleName("release-manager")).toBe("release-manager");
      expect(sanitizeRbacRoleName("ops_2")).toBe("ops_2");
    });
    test("trims surrounding whitespace", () => {
      expect(sanitizeRbacRoleName("  pm  ")).toBe("pm");
    });
    test("auto-lowercases mixed-case input", () => {
      expect(sanitizeRbacRoleName("PM")).toBe("pm");
      expect(sanitizeRbacRoleName("Release-Manager")).toBe("release-manager");
      expect(sanitizeRbacRoleName("OPS_2")).toBe("ops_2");
    });
    test.each([
      "pm role",               // space
      "pm.role",               // dot
      "-pm",                   // leading hyphen
      "_pm",                   // leading underscore
      "",                      // empty
      "a".repeat(65),          // > 64 chars
    ])("rejects %s", (bad) => {
      expect(() => sanitizeRbacRoleName(bad)).toThrow();
    });
    test("rejects non-string", () => {
      expect(() => sanitizeRbacRoleName(123 as unknown as string)).toThrow();
      expect(() => sanitizeRbacRoleName(null as unknown as string)).toThrow();
    });
  });

  describe("listRbacRoles", () => {
    test("returns 6 builtin roles, builtin-first by default", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const all = listRbacRoles(db);
        expect(all).toHaveLength(6);
        expect(all.map((r) => r.name).sort()).toEqual([
          "engineer", "operator", "pm", "researcher", "restricted", "reviewer",
        ]);
        for (const r of all) expect(r.is_builtin).toBe(1);
      } finally {
        db.close();
      }
    });

    test("custom roles appear after builtins", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        createRbacRole(db, { name: "release-manager", description: "Coordinates releases" });
        const all = listRbacRoles(db);
        expect(all).toHaveLength(7);
        // Last entry = the custom (non-builtin) role.
        expect(all[all.length - 1]!.name).toBe("release-manager");
        expect(all[all.length - 1]!.is_builtin).toBe(0);
      } finally {
        db.close();
      }
    });

    test("each builtin role carries its grant set", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const pm = listRbacRoles(db).find((r) => r.name === "pm");
        expect(pm).toBeDefined();
        const tools = pm!.grants.filter((g) => g.grant_kind === "tool_family").map((g) => g.grant_value);
        expect(tools).toContain("kanban-admin");
        expect(tools).toContain("messaging");
      } finally {
        db.close();
      }
    });
  });

  describe("createRbacRole", () => {
    test("inserts is_builtin=0 row with empty grants + sanitized name", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const role = createRbacRole(db, { name: "  release-manager  ", description: "Coords releases" });
        expect(role.name).toBe("release-manager");
        expect(role.is_builtin).toBe(0);
        expect(role.grants).toEqual([]);
        expect(role.description).toBe("Coords releases");
      } finally {
        db.close();
      }
    });

    test("rejects collision with builtin name", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        expect(() => createRbacRole(db, { name: "pm" })).toThrow(/already exists/);
      } finally {
        db.close();
      }
    });

    test("rejects collision with another custom name", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        createRbacRole(db, { name: "x" });
        expect(() => createRbacRole(db, { name: "x" })).toThrow(/already exists/);
      } finally {
        db.close();
      }
    });
  });

  describe("updateRbacRole", () => {
    test("renames + redescribes a custom role", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const r = createRbacRole(db, { name: "draft", description: "" });
        const updated = updateRbacRole(db, r.id, { name: "release-manager", description: "Coordinates" });
        expect(updated.name).toBe("release-manager");
        expect(updated.description).toBe("Coordinates");
      } finally {
        db.close();
      }
    });

    test("rejects rename of a builtin role", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const pm = getRbacRoleByName(db, "pm")!;
        expect(() => updateRbacRole(db, pm.id, { name: "PM-renamed" })).toThrow(/built-in/);
      } finally {
        db.close();
      }
    });

    test("allows description-only edit on a builtin role", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const pm = getRbacRoleByName(db, "pm")!;
        const updated = updateRbacRole(db, pm.id, { description: "edited copy" });
        expect(updated.description).toBe("edited copy");
        expect(updated.name).toBe("pm"); // name still locked
      } finally {
        db.close();
      }
    });

    test("rejects rename collision against another role", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const a = createRbacRole(db, { name: "alpha" });
        createRbacRole(db, { name: "beta" });
        expect(() => updateRbacRole(db, a.id, { name: "beta" })).toThrow(/already exists/);
      } finally {
        db.close();
      }
    });

    test("no-op update returns current row", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const a = createRbacRole(db, { name: "alpha" });
        const after = updateRbacRole(db, a.id, {});
        expect(after.id).toBe(a.id);
        expect(after.name).toBe("alpha");
      } finally {
        db.close();
      }
    });
  });

  describe("deleteRbacRole", () => {
    test("deletes a custom role + cascades its grants", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const r = createRbacRole(db, { name: "draft" });
        replaceRoleGrants(db, r.id, [{ grant_kind: "tool_family", grant_value: "messaging" }]);
        deleteRbacRole(db, r.id);
        expect(getRbacRoleById(db, r.id)).toBeNull();
        const grantCount = db.query<{ count: number }, [string]>(
          "SELECT COUNT(*) as count FROM role_grants WHERE role_id = ?",
        ).get(r.id)?.count;
        expect(grantCount).toBe(0);
      } finally {
        db.close();
      }
    });

    test("blocks delete on a builtin role", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const pm = getRbacRoleByName(db, "pm")!;
        expect(() => deleteRbacRole(db, pm.id)).toThrow(/built-in/);
      } finally {
        db.close();
      }
    });

    test("blocks delete when an agent is assigned (FK RESTRICT)", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const r = createRbacRole(db, { name: "draft" });
        const ts = new Date().toISOString();
        db.run("INSERT INTO agent_roles (agent_id, role_id, assigned_at) VALUES (?, ?, ?)", ["agent-1", r.id, ts]);
        expect(() => deleteRbacRole(db, r.id)).toThrow();
      } finally {
        db.close();
      }
    });
  });

  describe("replaceRoleGrants", () => {
    test("replaces grants atomically + dedups input", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const r = createRbacRole(db, { name: "draft" });
        replaceRoleGrants(db, r.id, [
          { grant_kind: "tool_family", grant_value: "messaging" },
          { grant_kind: "tool_family", grant_value: "messaging" }, // dup
          { grant_kind: "tool_family", grant_value: "channel" },
          { grant_kind: "kanban_action", grant_value: "comment_task", scope_qualifier: "own_assignment" },
        ]);
        const after = getRbacRoleById(db, r.id)!;
        expect(after.grants).toHaveLength(3);
        const tools = after.grants.filter((g) => g.grant_kind === "tool_family").map((g) => g.grant_value).sort();
        expect(tools).toEqual(["channel", "messaging"]);
        const scoped = after.grants.find((g) => g.grant_kind === "kanban_action");
        expect(scoped?.scope_qualifier).toBe("own_assignment");
      } finally {
        db.close();
      }
    });

    test("can edit a builtin role's grants (per spec: builtins keep name/insertion lock but grants are editable)", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const pm = getRbacRoleByName(db, "pm")!;
        replaceRoleGrants(db, pm.id, [{ grant_kind: "tool_family", grant_value: "messaging" }]);
        const after = getRbacRoleById(db, pm.id)!;
        expect(after.grants).toHaveLength(1);
        expect(after.grants[0]).toEqual({ grant_kind: "tool_family", grant_value: "messaging", scope_qualifier: null });
      } finally {
        db.close();
      }
    });

    test("clearing grants leaves the role itself intact", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const r = createRbacRole(db, { name: "draft" });
        replaceRoleGrants(db, r.id, []);
        const after = getRbacRoleById(db, r.id)!;
        expect(after).not.toBeNull();
        expect(after.grants).toEqual([]);
      } finally {
        db.close();
      }
    });
  });

  describe("listAgentRoleNames", () => {
    test("returns role names assigned to an agent (seeded by name map)", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        // Pre-existing agent with no roles → seed via re-migrate trick.
        // Easier: seed an agent post-migration and assign manually.
        seedAgent(db, "repo-1", "agent-x", "alpha");
        const engineer = getRbacRoleByName(db, "engineer")!;
        const reviewer = getRbacRoleByName(db, "reviewer")!;
        const ts = new Date().toISOString();
        db.run("INSERT INTO agent_roles (agent_id, role_id, assigned_at) VALUES (?, ?, ?)", ["agent-x", engineer.id, ts]);
        db.run("INSERT INTO agent_roles (agent_id, role_id, assigned_at) VALUES (?, ?, ?)", ["agent-x", reviewer.id, ts]);
        expect(listAgentRoleNames(db, "agent-x")).toEqual(["engineer", "reviewer"]);
      } finally {
        db.close();
      }
    });

    test("returns [] for an agent with no role assignments", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-empty", "alpha");
        expect(listAgentRoleNames(db, "agent-empty")).toEqual([]);
      } finally {
        db.close();
      }
    });
  });

  describe("getAgentRoles", () => {
    test("returns role rows joined with assigned_at, ordered by name", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const engineer = getRbacRoleByName(db, "engineer")!;
        const reviewer = getRbacRoleByName(db, "reviewer")!;
        const ts = new Date().toISOString();
        db.run("INSERT INTO agent_roles (agent_id, role_id, assigned_at) VALUES (?, ?, ?)", ["agent-1", reviewer.id, ts]);
        db.run("INSERT INTO agent_roles (agent_id, role_id, assigned_at) VALUES (?, ?, ?)", ["agent-1", engineer.id, ts]);
        const rows = getAgentRoles(db, "agent-1");
        expect(rows.map((r) => r.name)).toEqual(["engineer", "reviewer"]);
        expect(rows[0]!.is_builtin).toBe(1);
        expect(rows[0]!.assigned_at).toBe(ts);
        expect(rows[0]!.role_id).toBe(engineer.id);
      } finally {
        db.close();
      }
    });

    test("returns [] when no rows", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-x", "alpha");
        expect(getAgentRoles(db, "agent-x")).toEqual([]);
      } finally {
        db.close();
      }
    });
  });

  describe("setAgentRoles", () => {
    test("replaces the agent's full role-assignment set", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const engineer = getRbacRoleByName(db, "engineer")!;
        const reviewer = getRbacRoleByName(db, "reviewer")!;
        const pm = getRbacRoleByName(db, "pm")!;
        // Seed initial assignment
        setAgentRoles(db, "agent-1", [engineer.id, reviewer.id]);
        expect(getAgentRoles(db, "agent-1").map((r) => r.name)).toEqual(["engineer", "reviewer"]);
        // Replace
        setAgentRoles(db, "agent-1", [pm.id]);
        expect(getAgentRoles(db, "agent-1").map((r) => r.name)).toEqual(["pm"]);
      } finally {
        db.close();
      }
    });

    test("dedupes input role ids", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const engineer = getRbacRoleByName(db, "engineer")!;
        const result = setAgentRoles(db, "agent-1", [engineer.id, engineer.id, engineer.id]);
        expect(result).toHaveLength(1);
        expect(result[0]!.name).toBe("engineer");
      } finally {
        db.close();
      }
    });

    test("empty array clears all assignments", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const engineer = getRbacRoleByName(db, "engineer")!;
        setAgentRoles(db, "agent-1", [engineer.id]);
        expect(getAgentRoles(db, "agent-1")).toHaveLength(1);
        setAgentRoles(db, "agent-1", []);
        expect(getAgentRoles(db, "agent-1")).toEqual([]);
      } finally {
        db.close();
      }
    });

    test("throws on unknown role id and leaves existing rows intact", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const engineer = getRbacRoleByName(db, "engineer")!;
        setAgentRoles(db, "agent-1", [engineer.id]);
        expect(() => setAgentRoles(db, "agent-1", ["nonexistent-id"])).toThrow(/unknown role ids/);
        // Existing rows untouched.
        expect(getAgentRoles(db, "agent-1").map((r) => r.name)).toEqual(["engineer"]);
      } finally {
        db.close();
      }
    });

    test("throws naming all unknown ids in the error message", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const engineer = getRbacRoleByName(db, "engineer")!;
        try {
          setAgentRoles(db, "agent-1", [engineer.id, "missing-1", "missing-2"]);
          throw new Error("expected throw");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          expect(msg).toContain("missing-1");
          expect(msg).toContain("missing-2");
        }
      } finally {
        db.close();
      }
    });
  });

  describe("getEffectiveGrants", () => {
    test("returns empty buckets for an agent with no role assignments", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-x", "alpha");
        const grants = getEffectiveGrants(db, "agent-x");
        expect(grants.roles).toEqual([]);
        expect(grants.tool_families).toEqual([]);
        expect(grants.kanban_actions).toEqual([]);
        expect(grants.comment_types).toEqual([]);
        expect(grants.channel_actions).toEqual([]);
        expect(grants.audit_grants).toEqual([]);
        expect(grants.meta).toEqual([]);
      } finally {
        db.close();
      }
    });

    test("buckets engineer's grants by kind", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const engineer = getRbacRoleByName(db, "engineer")!;
        setAgentRoles(db, "agent-1", [engineer.id]);
        const grants = getEffectiveGrants(db, "agent-1");
        expect(grants.roles).toEqual(["engineer"]);
        expect(grants.tool_families.length).toBeGreaterThan(0);
        // engineer ships with kanban-comment + kanban-status families per spec.
        expect(grants.tool_families).toContain("kanban-comment");
        expect(grants.tool_families).toContain("kanban-status");
        // engineer has scope=own_assignment for some kanban_action grants.
        const updateStatus = grants.kanban_actions.find((g) => g.value === "update_task_status");
        expect(updateStatus).toBeDefined();
        expect(updateStatus!.scope).toBe("own_assignment");
      } finally {
        db.close();
      }
    });

    test("unions grants across multiple roles (no double-count, no scope merge)", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const engineer = getRbacRoleByName(db, "engineer")!;
        const pm = getRbacRoleByName(db, "pm")!;
        setAgentRoles(db, "agent-1", [engineer.id, pm.id]);
        const grants = getEffectiveGrants(db, "agent-1");
        expect(grants.roles.sort()).toEqual(["engineer", "pm"]);
        // pm has update_task_status with scope null (any); engineer has it with own_assignment.
        // Both should appear as separate (value, scope) tuples.
        const statusGrants = grants.kanban_actions.filter((g) => g.value === "update_task_status");
        const scopes = statusGrants.map((g) => g.scope).sort();
        // pm has any (null), engineer has own_assignment.
        expect(scopes).toContain(null);
        expect(scopes).toContain("own_assignment");
      } finally {
        db.close();
      }
    });

    test("results are sorted (deterministic for tests + stable for diff)", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const reviewer = getRbacRoleByName(db, "reviewer")!;
        setAgentRoles(db, "agent-1", [reviewer.id]);
        const grants = getEffectiveGrants(db, "agent-1");
        const sortedToolFamilies = [...grants.tool_families].sort();
        expect(grants.tool_families).toEqual(sortedToolFamilies);
        const sortedCommentTypes = [...grants.comment_types].sort();
        expect(grants.comment_types).toEqual(sortedCommentTypes);
      } finally {
        db.close();
      }
    });

    test("role with no grant rows still surfaces in roles list (LEFT JOIN safety)", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        // Create a custom role with no grants and assign it.
        const role = createRbacRole(db, { name: "blank-role" });
        setAgentRoles(db, "agent-1", [role.id]);
        const grants = getEffectiveGrants(db, "agent-1");
        expect(grants.roles).toEqual(["blank-role"]);
        expect(grants.tool_families).toEqual([]);
        expect(grants.kanban_actions).toEqual([]);
      } finally {
        db.close();
      }
    });
  });
});
