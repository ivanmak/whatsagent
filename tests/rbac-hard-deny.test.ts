/**
 * RBAC Phase 4 slice 4-2 (WA-083): hard-deny response shape + adversarial
 * fixture matrix. Pure data-shape tests — `denyResponse` helper is exercised
 * directly; the dispatcher consumer ships in WA-084.
 *
 * Adversarial matrix (per advisor msg 357 §3): built-in role × action
 * grid + custom-role edge cases (empty / family-only / action-only / wrong
 * scope / multi-role union) + target-shape edges + topology edges.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { migrate, openFleetDb } from "../src/db.ts";
import {
  createRbacRole,
  getRbacRoleByName,
  replaceRoleGrants,
  setAgentRoles,
} from "../src/rbac-dao.ts";
import {
  ACTION_GRANT_REQUIREMENTS,
  HARD_DENY_AUDIT_KIND,
  denyResponse,
  formatExpectedGrant,
} from "../src/rbac-enforce.ts";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wa-rbac-hard-deny-"));
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

describe("RBAC Phase 4 slice 4-2 — hard-deny shape + adversarial matrix", () => {
  describe("HARD_DENY_AUDIT_KIND constant", () => {
    test("exposes the audit kind string for the dispatcher", () => {
      expect(HARD_DENY_AUDIT_KIND).toBe("grant_miss_hard");
    });
  });

  describe("formatExpectedGrant", () => {
    test("boolean kind renders as kind:value", () => {
      expect(formatExpectedGrant({ kind: "tool_family", value: "kanban-admin" })).toBe("tool_family:kanban-admin");
    });

    test("kanban_action with scope renders as kind:value@scope", () => {
      expect(formatExpectedGrant({ kind: "kanban_action", value: "update_task_status", scope: "own_assignment" }))
        .toBe("kanban_action:update_task_status@own_assignment");
    });

    test("kanban_action without scope renders as kind:value", () => {
      expect(formatExpectedGrant({ kind: "kanban_action", value: "create_task" })).toBe("kanban_action:create_task");
    });

    test("null scope is treated as no scope (omitted from rendering)", () => {
      expect(formatExpectedGrant({ kind: "kanban_action", value: "create_task", scope: null }))
        .toBe("kanban_action:create_task");
    });
  });

  describe("denyResponse — built-in role hint computation", () => {
    test("kanban-admin missing → hint suggests pm role", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const body = denyResponse(db, {
          tool: "create-kanban-task",
          expectedGrant: { kind: "tool_family", value: "kanban-admin" },
          agentRoles: ["engineer"],
        });
        expect(body.ok).toBe(false);
        expect(body.error).toBe("rbac_denied");
        expect(body.tool).toBe("create-kanban-task");
        expect(body.expected_grant).toBe("tool_family:kanban-admin");
        expect(body.agent_roles).toEqual(["engineer"]);
        expect(body.hint).toContain("'pm'");
      } finally {
        db.close();
      }
    });

    test("verdict comment_type missing → hint suggests reviewer role", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const body = denyResponse(db, {
          tool: "comment-kanban-task",
          expectedGrant: { kind: "comment_type", value: "verdict_go" },
          agentRoles: ["engineer"],
        });
        // Both pm and reviewer have verdict_go in builtin seed. Hint lists multi-role form.
        expect(body.hint).toContain("'pm'");
        expect(body.hint).toContain("'reviewer'");
      } finally {
        db.close();
      }
    });

    test("broadcast channel_action missing → hint suggests pm role", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const body = denyResponse(db, {
          tool: "broadcast-message",
          expectedGrant: { kind: "channel_action", value: "broadcast_message" },
          agentRoles: ["restricted"],
        });
        expect(body.hint).toContain("'pm'");
      } finally {
        db.close();
      }
    });

    test("audit_admin missing → hint suggests pm role only (reviewer has audit_read)", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const body = denyResponse(db, {
          tool: "audit-export",
          expectedGrant: { kind: "audit_grant", value: "audit_admin" },
          agentRoles: ["reviewer"],
        });
        expect(body.hint).toContain("'pm'");
        expect(body.hint).not.toContain("'reviewer'");
      } finally {
        db.close();
      }
    });

    test("kanban_action with own_assignment scope → hint includes engineer (narrow grant) and pm (any-scope)", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const body = denyResponse(db, {
          tool: "update-kanban-task-status",
          expectedGrant: { kind: "kanban_action", value: "update_task_status", scope: "own_assignment" },
          agentRoles: ["restricted"],
        });
        // pm has any-scope; engineer has own_assignment-scope. Both satisfy.
        expect(body.hint).toContain("'pm'");
        expect(body.hint).toContain("'engineer'");
        expect(body.expected_grant).toBe("kanban_action:update_task_status@own_assignment");
      } finally {
        db.close();
      }
    });
  });

  describe("denyResponse — no-grantor edge", () => {
    test("synthetic grant nobody has → hint surfaces 'No role currently grants ...'", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const body = denyResponse(db, {
          tool: "fictional-action",
          expectedGrant: { kind: "tool_family", value: "fictional-family" },
          agentRoles: ["engineer"],
        });
        expect(body.hint).toContain("No role currently grants tool_family:fictional-family");
      } finally {
        db.close();
      }
    });
  });

  describe("denyResponse — custom-role edge cases (advisor §3)", () => {
    test("empty role added as grantor → hint lists the custom role", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const role = createRbacRole(db, { name: "kanban-power" });
        replaceRoleGrants(db, role.id, [{ grant_kind: "tool_family", grant_value: "kanban-admin", scope_qualifier: null }]);
        const body = denyResponse(db, {
          tool: "create-kanban-task",
          expectedGrant: { kind: "tool_family", value: "kanban-admin" },
          agentRoles: ["engineer"],
        });
        // pm + kanban-power both grant.
        expect(body.hint).toContain("'pm'");
        expect(body.hint).toContain("'kanban-power'");
      } finally {
        db.close();
      }
    });

    test("custom role with family-only grant → satisfies family hint, not action-only hint", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const role = createRbacRole(db, { name: "fam-only" });
        replaceRoleGrants(db, role.id, [
          { grant_kind: "tool_family", grant_value: "kanban-admin", scope_qualifier: null },
        ]);
        const familyBody = denyResponse(db, {
          tool: "create-kanban-task",
          expectedGrant: { kind: "tool_family", value: "kanban-admin" },
          agentRoles: ["x"],
        });
        expect(familyBody.hint).toContain("'fam-only'");
        const actionBody = denyResponse(db, {
          tool: "create-kanban-task",
          expectedGrant: { kind: "kanban_action", value: "create_task" },
          agentRoles: ["x"],
        });
        expect(actionBody.hint).not.toContain("'fam-only'");
      } finally {
        db.close();
      }
    });

    test("custom role with action-only grant → satisfies action hint, not family hint", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const role = createRbacRole(db, { name: "act-only" });
        replaceRoleGrants(db, role.id, [
          { grant_kind: "kanban_action", grant_value: "create_task", scope_qualifier: null },
        ]);
        const actionBody = denyResponse(db, {
          tool: "create-kanban-task",
          expectedGrant: { kind: "kanban_action", value: "create_task" },
          agentRoles: ["x"],
        });
        expect(actionBody.hint).toContain("'act-only'");
        const familyBody = denyResponse(db, {
          tool: "create-kanban-task",
          expectedGrant: { kind: "tool_family", value: "kanban-admin" },
          agentRoles: ["x"],
        });
        expect(familyBody.hint).not.toContain("'act-only'");
      } finally {
        db.close();
      }
    });

    test("wrong-scope custom role (own_assignment when call needs any) → NOT a grantor for null-scope requirement", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const role = createRbacRole(db, { name: "scoped-only" });
        replaceRoleGrants(db, role.id, [
          { grant_kind: "kanban_action", grant_value: "archive_task", scope_qualifier: "own_assignment" },
        ]);
        // Caller demands any-scope explicitly via `scope: null`. Per
        // matchKanbanAction semantics + lookupGrantingRoles, only NULL-
        // qualifier grants satisfy. Narrow `own_assignment` grants do NOT.
        const body = denyResponse(db, {
          tool: "archive-kanban-task",
          expectedGrant: { kind: "kanban_action", value: "archive_task", scope: null },
          agentRoles: ["x"],
        });
        // pm has NULL-qualifier archive_task; scoped-only has own_assignment
        // and must NOT show as a grantor.
        expect(body.hint).toContain("'pm'");
        expect(body.hint).not.toContain("'scoped-only'");
      } finally {
        db.close();
      }
    });

    test("scope=null requirement excludes ALL narrow-scope grants (advisor §3 null-scope wrong-grant case)", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        // Three custom roles, each at a different narrow scope. None should
        // surface for a scope=null call.
        const a = createRbacRole(db, { name: "narrow-own" });
        const b = createRbacRole(db, { name: "narrow-creator" });
        const c = createRbacRole(db, { name: "narrow-assigned" });
        replaceRoleGrants(db, a.id, [
          { grant_kind: "kanban_action", grant_value: "update_task", scope_qualifier: "own_assignment" },
        ]);
        replaceRoleGrants(db, b.id, [
          { grant_kind: "kanban_action", grant_value: "update_task", scope_qualifier: "created_by_self" },
        ]);
        replaceRoleGrants(db, c.id, [
          { grant_kind: "kanban_action", grant_value: "update_task", scope_qualifier: "assigned_to_agent" },
        ]);
        const body = denyResponse(db, {
          tool: "update-kanban-task",
          expectedGrant: { kind: "kanban_action", value: "update_task", scope: null },
          agentRoles: ["x"],
        });
        expect(body.hint).toContain("'pm'"); // pm has NULL-qualifier update_task
        expect(body.hint).not.toContain("'narrow-own'");
        expect(body.hint).not.toContain("'narrow-creator'");
        expect(body.hint).not.toContain("'narrow-assigned'");
      } finally {
        db.close();
      }
    });

    test("scope=specific-string includes both NULL-qualifier and matching-qualifier grants", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const narrow = createRbacRole(db, { name: "narrow-archiver" });
        const wide = createRbacRole(db, { name: "wide-archiver" });
        const wrong = createRbacRole(db, { name: "wrong-scope-archiver" });
        replaceRoleGrants(db, narrow.id, [
          { grant_kind: "kanban_action", grant_value: "archive_task", scope_qualifier: "own_assignment" },
        ]);
        replaceRoleGrants(db, wide.id, [
          { grant_kind: "kanban_action", grant_value: "archive_task", scope_qualifier: null },
        ]);
        replaceRoleGrants(db, wrong.id, [
          { grant_kind: "kanban_action", grant_value: "archive_task", scope_qualifier: "created_by_self" },
        ]);
        const body = denyResponse(db, {
          tool: "archive-kanban-task",
          expectedGrant: { kind: "kanban_action", value: "archive_task", scope: "own_assignment" },
          agentRoles: ["x"],
        });
        expect(body.hint).toContain("'narrow-archiver'");   // exact scope match
        expect(body.hint).toContain("'wide-archiver'");     // any-scope satisfies
        expect(body.hint).not.toContain("'wrong-scope-archiver'"); // different specific scope excluded
      } finally {
        db.close();
      }
    });

    test("scoped requirement own_assignment → both narrow grant and any-scope grant satisfy", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const role = createRbacRole(db, { name: "narrow-archiver" });
        replaceRoleGrants(db, role.id, [
          { grant_kind: "kanban_action", grant_value: "archive_task", scope_qualifier: "own_assignment" },
        ]);
        const body = denyResponse(db, {
          tool: "archive-kanban-task",
          expectedGrant: { kind: "kanban_action", value: "archive_task", scope: "own_assignment" },
          agentRoles: ["x"],
        });
        expect(body.hint).toContain("'narrow-archiver'");
        expect(body.hint).toContain("'pm'"); // any-scope satisfies own_assignment too
      } finally {
        db.close();
      }
    });

    test("multiple custom roles granting same → hint lists all sorted", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const a = createRbacRole(db, { name: "alpha-grant" });
        const b = createRbacRole(db, { name: "beta-grant" });
        replaceRoleGrants(db, a.id, [{ grant_kind: "tool_family", grant_value: "kanban-admin", scope_qualifier: null }]);
        replaceRoleGrants(db, b.id, [{ grant_kind: "tool_family", grant_value: "kanban-admin", scope_qualifier: null }]);
        const body = denyResponse(db, {
          tool: "create-kanban-task",
          expectedGrant: { kind: "tool_family", value: "kanban-admin" },
          agentRoles: ["x"],
        });
        // Sorted ASC: alpha-grant, beta-grant, pm
        const idxA = body.hint.indexOf("'alpha-grant'");
        const idxB = body.hint.indexOf("'beta-grant'");
        const idxPm = body.hint.indexOf("'pm'");
        expect(idxA).toBeGreaterThan(-1);
        expect(idxB).toBeGreaterThan(-1);
        expect(idxPm).toBeGreaterThan(-1);
        expect(idxA).toBeLessThan(idxB);
        expect(idxB).toBeLessThan(idxPm);
      } finally {
        db.close();
      }
    });
  });

  describe("denyResponse — agent_roles passthrough (advisor §3)", () => {
    test("multi-role union actor → all roles surface in body.agent_roles", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const body = denyResponse(db, {
          tool: "broadcast-message",
          expectedGrant: { kind: "channel_action", value: "broadcast_message" },
          agentRoles: ["engineer", "reviewer"],
        });
        expect(body.agent_roles).toEqual(["engineer", "reviewer"]);
      } finally {
        db.close();
      }
    });

    test("empty agent_roles (agent has no role assignment) → empty array in body", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const body = denyResponse(db, {
          tool: "create-kanban-task",
          expectedGrant: { kind: "tool_family", value: "kanban-admin" },
          agentRoles: [],
        });
        expect(body.agent_roles).toEqual([]);
        expect(body.error).toBe("rbac_denied");
      } finally {
        db.close();
      }
    });
  });

  describe("denyResponse — every gated tool produces a usable shape", () => {
    test.each(Object.keys(ACTION_GRANT_REQUIREMENTS))(
      "%s: shape contains all five fields",
      (action) => {
        const db = openFleetDb(dbPath);
        try {
          migrate(db);
          const reqs = ACTION_GRANT_REQUIREMENTS[action]!;
          const firstReq = reqs[0]!;
          const body = denyResponse(db, {
            tool: action,
            expectedGrant: firstReq,
            agentRoles: ["restricted"],
          });
          expect(body.ok).toBe(false);
          expect(body.error).toBe("rbac_denied");
          expect(body.tool).toBe(action);
          expect(body.expected_grant).toContain(firstReq.kind);
          expect(body.expected_grant).toContain(firstReq.value);
          expect(typeof body.hint).toBe("string");
          expect(body.hint.length).toBeGreaterThan(0);
        } finally {
          db.close();
        }
      },
    );
  });

  describe("denyResponse — built-in role × representative action grid", () => {
    interface RoleCheck { role: string; expectGrantor: boolean }
    interface Case {
      name: string;
      expectedGrant: Parameters<typeof denyResponse>[1]["expectedGrant"];
      checks: readonly RoleCheck[];
    }
    const cases: readonly Case[] = [
      {
        name: "kanban-admin family",
        expectedGrant: { kind: "tool_family", value: "kanban-admin" },
        checks: [
          { role: "pm", expectGrantor: true },
          { role: "engineer", expectGrantor: false },
          { role: "reviewer", expectGrantor: false },
          { role: "researcher", expectGrantor: false },
          { role: "restricted", expectGrantor: false },
          { role: "operator", expectGrantor: false },
        ],
      },
      {
        name: "channel post action",
        expectedGrant: { kind: "channel_action", value: "post_channel_message" },
        checks: [
          { role: "pm", expectGrantor: true },
          { role: "engineer", expectGrantor: true },
          { role: "reviewer", expectGrantor: true },
          { role: "researcher", expectGrantor: true },
          { role: "restricted", expectGrantor: false },
          { role: "operator", expectGrantor: false },
        ],
      },
      {
        name: "verdict_go comment type",
        expectedGrant: { kind: "comment_type", value: "verdict_go" },
        checks: [
          { role: "pm", expectGrantor: true },
          { role: "engineer", expectGrantor: false },
          { role: "reviewer", expectGrantor: true },
          { role: "researcher", expectGrantor: false },
          { role: "restricted", expectGrantor: false },
          { role: "operator", expectGrantor: false },
        ],
      },
    ];
    for (const c of cases) {
      test(c.name, () => {
        const db = openFleetDb(dbPath);
        try {
          migrate(db);
          const body = denyResponse(db, {
            tool: "test-action",
            expectedGrant: c.expectedGrant,
            agentRoles: ["x"],
          });
          for (const check of c.checks) {
            const exists = body.hint.includes(`'${check.role}'`);
            if (check.expectGrantor) {
              expect(exists).toBe(true);
            } else {
              expect(exists).toBe(false);
            }
          }
        } finally {
          db.close();
        }
      });
    }
  });

  describe("denyResponse — operator meta marker (advisor §5 negative)", () => {
    test("operator role does NOT appear as grantor for any tool_family", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        // Operator is composed alongside other roles in seed but its own
        // grants are meta-only. Confirm it's never a grantor of family.
        for (const fam of ["kanban-admin", "kanban-status", "kanban-comment", "channel-read", "channel-write", "messaging", "summary", "kanban-read"]) {
          const body = denyResponse(db, {
            tool: "fake",
            expectedGrant: { kind: "tool_family", value: fam },
            agentRoles: ["x"],
          });
          expect(body.hint).not.toContain("'operator'");
        }
      } finally {
        db.close();
      }
    });

    test("operator role does NOT grant any kanban_action", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        for (const action of ["create_task", "update_task", "archive_task", "update_task_status", "comment_task"]) {
          const body = denyResponse(db, {
            tool: "fake",
            expectedGrant: { kind: "kanban_action", value: action },
            agentRoles: ["x"],
          });
          expect(body.hint).not.toContain("'operator'");
        }
      } finally {
        db.close();
      }
    });

    test("operator role IS a grantor of the is_operator_surrogate meta marker only", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const body = denyResponse(db, {
          tool: "fake",
          expectedGrant: { kind: "meta", value: "is_operator_surrogate" },
          agentRoles: ["x"],
        });
        expect(body.hint).toContain("'operator'");
      } finally {
        db.close();
      }
    });
  });

  describe("denyResponse — defensive shape edges", () => {
    test("body is a fresh object each call (no shared reference)", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const a = denyResponse(db, { tool: "x", expectedGrant: { kind: "tool_family", value: "kanban-admin" }, agentRoles: ["a"] });
        const b = denyResponse(db, { tool: "x", expectedGrant: { kind: "tool_family", value: "kanban-admin" }, agentRoles: ["a"] });
        expect(a).not.toBe(b);
        expect(a).toEqual(b);
      } finally {
        db.close();
      }
    });

    test("error field is the literal 'rbac_denied' (consumed by HTTP layer)", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const body = denyResponse(db, {
          tool: "x",
          expectedGrant: { kind: "tool_family", value: "kanban-admin" },
          agentRoles: ["a"],
        });
        expect(body.error).toBe("rbac_denied");
      } finally {
        db.close();
      }
    });

    test("body.ok is the literal `false`", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        const body = denyResponse(db, {
          tool: "x",
          expectedGrant: { kind: "tool_family", value: "kanban-admin" },
          agentRoles: ["a"],
        });
        expect(body.ok).toBe(false);
      } finally {
        db.close();
      }
    });
  });

  describe("denyResponse — body.id alias / target shape doesn't affect hint", () => {
    test("seedAgent + arbitrary target shapes don't impact deny computation", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "engineer");
        const restricted = getRbacRoleByName(db, "restricted")!;
        setAgentRoles(db, "agent-1", [restricted.id]);
        // Helper does not consume target — just shape.
        const body = denyResponse(db, {
          tool: "delete-something",
          expectedGrant: { kind: "tool_family", value: "kanban-admin" },
          agentRoles: ["restricted"],
        });
        expect(body.expected_grant).toBe("tool_family:kanban-admin");
      } finally {
        db.close();
      }
    });
  });
});
