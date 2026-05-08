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
import { ACTION_GRANT_REQUIREMENTS, checkActionGrants } from "../src/rbac-enforce.ts";
import { listAudit } from "../src/audit-log-dao.ts";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wa-rbac-enforce-"));
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

describe("rbac-enforce — Phase 3 soft enforcement", () => {
  describe("ACTION_GRANT_REQUIREMENTS", () => {
    test("every kanban write action requires both tool_family + kanban_action", () => {
      for (const action of ["create-kanban-task", "update-kanban-task", "archive-kanban-task", "comment-kanban-task", "comment-kanban-epic"]) {
        const reqs = ACTION_GRANT_REQUIREMENTS[action];
        expect(reqs).toBeDefined();
        expect(reqs!.some((r) => r.kind === "tool_family")).toBe(true);
        expect(reqs!.some((r) => r.kind === "kanban_action")).toBe(true);
      }
    });

    test("read-only actions require only tool_family", () => {
      for (const action of ["list-kanban-tasks", "read-kanban-task", "list-kanban-epics", "read-kanban-epic"]) {
        const reqs = ACTION_GRANT_REQUIREMENTS[action]!;
        expect(reqs.every((r) => r.kind === "tool_family")).toBe(true);
      }
    });

    test("read-channel-messages requires tool_family:channel-read + channel_action (EP-022 channel split)", () => {
      const reqs = ACTION_GRANT_REQUIREMENTS["read-channel-messages"]!;
      expect(reqs).toHaveLength(2);
      expect(reqs).toEqual([
        { kind: "tool_family", value: "channel-read" },
        { kind: "channel_action", value: "read_channel_messages" },
      ]);
    });

    test("channel WRITE actions require tool_family:channel-write (EP-022 channel split)", () => {
      for (const action of ["post-channel-message", "reply-channel-thread", "broadcast-message"]) {
        const reqs = ACTION_GRANT_REQUIREMENTS[action]!;
        const family = reqs.find((r) => r.kind === "tool_family");
        expect(family?.value).toBe("channel-write");
      }
    });

    test("always-on housekeeping (whoami + check-messages) NOT gated", () => {
      // whoami: boot snapshot fetch + agent introspection depends on it.
      // check-messages: inbox-delivery primitive used by the colleague
      // protocol the daemon documents in every launch prompt.
      // poll-messages + mark-messages-read also intentionally absent.
      expect(ACTION_GRANT_REQUIREMENTS["whoami"]).toBeUndefined();
      expect(ACTION_GRANT_REQUIREMENTS["check-messages"]).toBeUndefined();
    });

    test("summary family gates list-peers + set-summary (EP-022 / WA-097 fix)", () => {
      // Advisor msg #419: pre-fix, the `summary` family was a no-op
      // because list-peers / set-summary were unmapped. Now they
      // require `tool_family:summary` so unticking the chip hides them.
      expect(ACTION_GRANT_REQUIREMENTS["list-peers"]).toEqual([{ kind: "tool_family", value: "summary" }]);
      expect(ACTION_GRANT_REQUIREMENTS["set-summary"]).toEqual([{ kind: "tool_family", value: "summary" }]);
    });
  });

  describe("checkActionGrants", () => {
    test("ungated action returns allowed=true with no audit row", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const r = checkActionGrants(db, { agentId: "agent-1", action: "whoami", mode: "soft" });
        expect(r.allowed).toBe(true);
        expect(r.hasMiss).toBe(false);
        expect(r.auditIds).toEqual([]);
        expect(listAudit(db)).toEqual([]);
      } finally {
        db.close();
      }
    });

    test("agent with required tool_family + kanban_action passes and emits grant_check_pass", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const pm = getRbacRoleByName(db, "pm")!;
        setAgentRoles(db, "agent-1", [pm.id]);
        // pm has tool_family:kanban-admin + kanban_action:create_task per spec.
        const r = checkActionGrants(db, { agentId: "agent-1", action: "create-kanban-task", mode: "soft" });
        expect(r.allowed).toBe(true);
        expect(r.hasMiss).toBe(false);
        const rows = listAudit(db);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.kind).toBe("grant_check_pass");
        expect(rows[0]!.payload.tool).toBe("create-kanban-task");
        expect(rows[0]!.payload.outcome).toBe("pass");
      } finally {
        db.close();
      }
    });

    test("agent missing tool_family logs grant_miss_soft and still allows (Phase 3)", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        // researcher has tool_family:kanban-read but NOT kanban-admin
        const researcher = getRbacRoleByName(db, "researcher")!;
        setAgentRoles(db, "agent-1", [researcher.id]);
        const r = checkActionGrants(db, { agentId: "agent-1", action: "create-kanban-task", mode: "soft" });
        expect(r.allowed).toBe(true); // soft = always allow
        expect(r.hasMiss).toBe(true);
        expect(r.auditIds.length).toBeGreaterThan(0);
        const audits = listAudit(db);
        expect(audits.length).toBeGreaterThan(0);
        expect(audits[0]!.kind).toBe("grant_miss_soft");
        expect(audits[0]!.actor_agent_id).toBe("agent-1");
        expect(audits[0]!.payload.outcome).toBe("soft_allow");
        expect(audits[0]!.payload.tool).toBe("create-kanban-task");
      } finally {
        db.close();
      }
    });

    test("dynamicScope=null with grant scoped own_assignment → has-close miss", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const engineer = getRbacRoleByName(db, "engineer")!;
        // engineer has update_task_status scoped own_assignment per spec.
        setAgentRoles(db, "agent-1", [engineer.id]);
        // Caller indicates the actor is NOT the assignee → dynamicScope=null
        // means the call requires "any" scope.
        const r = checkActionGrants(db, {
          agentId: "agent-1",
          action: "update-kanban-task-status",
          dynamicScope: null, mode: "soft",
        });
        expect(r.allowed).toBe(true);
        expect(r.hasMiss).toBe(true);
        const audits = listAudit(db);
        const closeMiss = audits.find((a) => (a.payload.expected_grant as { kind: string }).kind === "kanban_action");
        expect(closeMiss).toBeDefined();
        expect(closeMiss!.payload.match).toBe("has-close");
        expect(closeMiss!.payload.matched_scope).toBe("own_assignment");
      } finally {
        db.close();
      }
    });

    test("dynamicScope=own_assignment satisfies engineer's narrower-scope grant exactly", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const engineer = getRbacRoleByName(db, "engineer")!;
        setAgentRoles(db, "agent-1", [engineer.id]);
        const r = checkActionGrants(db, {
          agentId: "agent-1",
          action: "update-kanban-task-status",
          dynamicScope: "own_assignment", mode: "soft",
        });
        expect(r.hasMiss).toBe(false);
        expect(listAudit(db).filter((a) => a.kind === "grant_miss_soft")).toHaveLength(0);
      } finally {
        db.close();
      }
    });

    test("agent with `any` scope grant satisfies a narrower-scope requirement", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const pm = getRbacRoleByName(db, "pm")!;
        // pm has update_task_status with scope=null (any) per spec.
        setAgentRoles(db, "agent-1", [pm.id]);
        // Caller asks for own_assignment specifically — pm's any-scope still satisfies.
        const r = checkActionGrants(db, {
          agentId: "agent-1",
          action: "update-kanban-task-status",
          dynamicScope: "own_assignment", mode: "soft",
        });
        expect(r.hasMiss).toBe(false);
      } finally {
        db.close();
      }
    });

    test("missing kind→has-none audit row", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        // Custom role with NO kanban_action grants but kanban-admin family.
        const role = createRbacRole(db, { name: "blank-admin" });
        replaceRoleGrants(db, role.id, [{ grant_kind: "tool_family", grant_value: "kanban-admin", scope_qualifier: null }]);
        setAgentRoles(db, "agent-1", [role.id]);
        const r = checkActionGrants(db, { agentId: "agent-1", action: "create-kanban-task", mode: "soft" });
        expect(r.hasMiss).toBe(true);
        const audits = listAudit(db);
        const actionMiss = audits.find((a) => (a.payload.expected_grant as { kind: string }).kind === "kanban_action");
        expect(actionMiss).toBeDefined();
        expect(actionMiss!.payload.match).toBe("has-none");
      } finally {
        db.close();
      }
    });

    test("target kind+id propagate to audit row", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        // No roles assigned → all requirements miss.
        checkActionGrants(db, {
          agentId: "agent-1",
          action: "comment-kanban-task",
          target: { kind: "task", id: "WA-001" },
          mode: "soft",
        });
        const audits = listAudit(db);
        expect(audits.length).toBeGreaterThan(0);
        expect(audits[0]!.target_kind).toBe("task");
        expect(audits[0]!.target_id).toBe("WA-001");
      } finally {
        db.close();
      }
    });

    test("agent_roles snapshot in payload reflects state at the time of call", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const restricted = getRbacRoleByName(db, "restricted")!;
        setAgentRoles(db, "agent-1", [restricted.id]);
        checkActionGrants(db, { agentId: "agent-1", action: "create-kanban-task", mode: "soft" });
        const audits = listAudit(db);
        expect(audits[0]!.payload.agent_roles).toEqual(["restricted"]);
      } finally {
        db.close();
      }
    });

    test("passing action emits exactly one grant_check_pass row capturing all requirements", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const pm = getRbacRoleByName(db, "pm")!;
        setAgentRoles(db, "agent-1", [pm.id]);
        // create-kanban-task has 2 requirements: tool_family + kanban_action.
        // Both pass for pm → one summary row covering both.
        const r = checkActionGrants(db, { agentId: "agent-1", action: "create-kanban-task", mode: "soft" });
        expect(r.hasMiss).toBe(false);
        expect(r.auditIds).toHaveLength(1);
        const rows = listAudit(db);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.kind).toBe("grant_check_pass");
        const reqs = rows[0]!.payload.requirements as Array<{ kind: string; value: string }>;
        expect(reqs).toHaveLength(2);
        expect(reqs.map((r) => r.kind).sort()).toEqual(["kanban_action", "tool_family"]);
      } finally {
        db.close();
      }
    });

    test("grant_check_pass row records dynamicScope when supplied", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const engineer = getRbacRoleByName(db, "engineer")!;
        setAgentRoles(db, "agent-1", [engineer.id]);
        checkActionGrants(db, {
          agentId: "agent-1",
          action: "update-kanban-task-status",
          dynamicScope: "own_assignment", mode: "soft",
        });
        const rows = listAudit(db);
        const passRow = rows.find((a) => a.kind === "grant_check_pass");
        expect(passRow).toBeDefined();
        const reqs = passRow!.payload.requirements as Array<{ kind: string; value: string; scope: string | null }>;
        const kanbanReq = reqs.find((r) => r.kind === "kanban_action");
        expect(kanbanReq?.scope).toBe("own_assignment");
      } finally {
        db.close();
      }
    });

    test("restricted role reads channels with channel-read family (EP-022 channel split)", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const restricted = getRbacRoleByName(db, "restricted")!;
        // EP-022: restricted ships with tool_family:channel-read +
        // channel_action:read_channel_messages. The pre-EP-022 special-
        // case skip on read-channel-messages (no family layer at all)
        // is gone — the standard two-layer rule applies cleanly.
        setAgentRoles(db, "agent-1", [restricted.id]);
        const r = checkActionGrants(db, { agentId: "agent-1", action: "read-channel-messages", mode: "soft" });
        expect(r.hasMiss).toBe(false);
        const rows = listAudit(db);
        expect(rows.filter((a) => a.kind === "grant_miss_soft")).toEqual([]);
        expect(rows.filter((a) => a.kind === "grant_check_pass")).toHaveLength(1);
      } finally {
        db.close();
      }
    });

    test("miss path still emits no grant_check_pass row", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        // researcher has tool_family:kanban-read but NOT kanban-admin.
        const researcher = getRbacRoleByName(db, "researcher")!;
        setAgentRoles(db, "agent-1", [researcher.id]);
        checkActionGrants(db, { agentId: "agent-1", action: "create-kanban-task", mode: "soft" });
        const rows = listAudit(db);
        expect(rows.every((a) => a.kind === "grant_miss_soft")).toBe(true);
      } finally {
        db.close();
      }
    });

    test("multi-requirement action emits one audit row per missed requirement", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        // No roles → both tool_family + kanban_action requirements miss.
        const r = checkActionGrants(db, { agentId: "agent-1", action: "create-kanban-task", mode: "soft" });
        expect(r.auditIds).toHaveLength(2);
        const audits = listAudit(db);
        expect(audits).toHaveLength(2);
        const kinds = audits.map((a) => (a.payload.expected_grant as { kind: string }).kind).sort();
        expect(kinds).toEqual(["kanban_action", "tool_family"]);
      } finally {
        db.close();
      }
    });
  });

  describe("checkActionGrants — Phase 4 hardEnforce flag (WA-084)", () => {
    test("hardEnforce=false on miss → allowed=true, kind=grant_miss_soft, outcome=soft_allow (Phase 3 behavior preserved)", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const restricted = getRbacRoleByName(db, "restricted")!;
        setAgentRoles(db, "agent-1", [restricted.id]);
        const r = checkActionGrants(db, {
          agentId: "agent-1",
          action: "create-kanban-task",
          mode: "soft",
        });
        expect(r.allowed).toBe(true);
        expect(r.hasMiss).toBe(true);
        const audits = listAudit(db);
        expect(audits.every((a) => a.kind === "grant_miss_soft")).toBe(true);
        expect(audits[0]!.payload.outcome).toBe("soft_allow");
      } finally {
        db.close();
      }
    });

    test("hardEnforce=true on miss → allowed=false, kind=grant_miss_hard, outcome=hard_deny", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const restricted = getRbacRoleByName(db, "restricted")!;
        setAgentRoles(db, "agent-1", [restricted.id]);
        const r = checkActionGrants(db, {
          agentId: "agent-1",
          action: "create-kanban-task",
          mode: "enforce",
        });
        expect(r.allowed).toBe(false);
        expect(r.hasMiss).toBe(true);
        const audits = listAudit(db);
        expect(audits.every((a) => a.kind === "grant_miss_hard")).toBe(true);
        expect(audits[0]!.payload.outcome).toBe("hard_deny");
      } finally {
        db.close();
      }
    });

    test("hardEnforce=true on pass → allowed=true, grant_check_pass row (no allow/deny noise)", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const pm = getRbacRoleByName(db, "pm")!;
        setAgentRoles(db, "agent-1", [pm.id]);
        const r = checkActionGrants(db, {
          agentId: "agent-1",
          action: "create-kanban-task",
          mode: "enforce",
        });
        expect(r.allowed).toBe(true);
        expect(r.hasMiss).toBe(false);
        const audits = listAudit(db);
        expect(audits.map((a) => a.kind)).toEqual(["grant_check_pass"]);
      } finally {
        db.close();
      }
    });

    test("firstMissRequirement is the first failed requirement in declaration order", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        // Restricted has neither tool_family:kanban-admin nor kanban_action:create_task.
        // Declaration order in ACTION_GRANT_REQUIREMENTS is tool_family first, then kanban_action.
        const restricted = getRbacRoleByName(db, "restricted")!;
        setAgentRoles(db, "agent-1", [restricted.id]);
        const r = checkActionGrants(db, {
          agentId: "agent-1",
          action: "create-kanban-task",
          mode: "enforce",
        });
        expect(r.firstMissRequirement?.kind).toBe("tool_family");
        expect(r.firstMissRequirement?.value).toBe("kanban-admin");
      } finally {
        db.close();
      }
    });

    test("agentRolesSnapshot reflects assigned roles for denyResponse use", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const restricted = getRbacRoleByName(db, "restricted")!;
        setAgentRoles(db, "agent-1", [restricted.id]);
        const r = checkActionGrants(db, {
          agentId: "agent-1",
          action: "create-kanban-task",
          mode: "enforce",
        });
        expect(r.agentRolesSnapshot).toEqual(["restricted"]);
      } finally {
        db.close();
      }
    });

    test("hardEnforce=true with dynamicScope → scope-aware kanban_action miss switches to grant_miss_hard", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        // Engineer has update_task_status@own_assignment. dynamicScope=null
        // (acting on someone else's task) → has-close miss.
        const engineer = getRbacRoleByName(db, "engineer")!;
        setAgentRoles(db, "agent-1", [engineer.id]);
        const r = checkActionGrants(db, {
          agentId: "agent-1",
          action: "update-kanban-task-status",
          dynamicScope: null, mode: "enforce",
        });
        expect(r.allowed).toBe(false);
        expect(r.hasMiss).toBe(true);
        const audits = listAudit(db);
        const missRow = audits.find((a) => a.kind === "grant_miss_hard");
        expect(missRow).toBeDefined();
        expect(missRow!.payload.match).toBe("has-close");
        expect(missRow!.payload.outcome).toBe("hard_deny");
      } finally {
        db.close();
      }
    });

    test("ungated action with hardEnforce=true returns allowed=true with no audit (no requirement → no enforcement)", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const r = checkActionGrants(db, {
          agentId: "agent-1",
          action: "whoami",
          mode: "enforce",
        });
        expect(r.allowed).toBe(true);
        expect(r.hasMiss).toBe(false);
        expect(r.auditIds).toEqual([]);
        expect(r.agentRolesSnapshot).toEqual([]);
      } finally {
        db.close();
      }
    });

    test("operator-only agent (advisor §5 negative) → 403 on every gated tool", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const operator = getRbacRoleByName(db, "operator")!;
        setAgentRoles(db, "agent-1", [operator.id]);
        // Operator carries only the meta:is_operator_surrogate marker.
        // It must NOT silently grant any tool_family or kanban_action.
        // Hard mode → every gated MCP call denies.
        const sample = ["create-kanban-task", "update-kanban-task", "post-channel-message", "send-message", "broadcast-message"];
        for (const action of sample) {
          const r = checkActionGrants(db, {
            agentId: "agent-1",
            action,
            mode: "enforce",
          });
          expect(r.allowed).toBe(false);
          expect(r.hasMiss).toBe(true);
          expect(r.firstMissRequirement).toBeDefined();
        }
      } finally {
        db.close();
      }
    });
  });

  /**
   * Shadow-parity tests (advisor msg 357 §2): for every (action × built-in
   * role) combination, the soft and hard `checkActionGrants` calls must
   * agree on whether a miss occurred. Only `outcome.allowed` and the audit
   * `kind` differ. This is the gate before WA-085..090 fan-out: if the
   * hard decision diverges from soft on the same fixture, the dispatcher
   * flip would 403 work that today succeeds.
   */
  describe("checkActionGrants — Phase 4 dynamicCommentType (WA-087)", () => {
    test("comment-kanban-task with body.type=blocker passes for engineer (has comment_type:blocker)", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const engineer = getRbacRoleByName(db, "engineer")!;
        setAgentRoles(db, "agent-1", [engineer.id]);
        const r = checkActionGrants(db, {
          agentId: "agent-1",
          action: "comment-kanban-task",
          dynamicCommentType: "blocker",
          dynamicScope: "own_assignment", mode: "enforce",
        });
        expect(r.allowed).toBe(true);
        expect(r.hasMiss).toBe(false);
      } finally {
        db.close();
      }
    });

    test("comment-kanban-task with body.type=verdict_go denies engineer (no verdict grant)", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const engineer = getRbacRoleByName(db, "engineer")!;
        setAgentRoles(db, "agent-1", [engineer.id]);
        const r = checkActionGrants(db, {
          agentId: "agent-1",
          action: "comment-kanban-task",
          dynamicCommentType: "verdict_go",
          dynamicScope: "own_assignment", mode: "enforce",
        });
        expect(r.allowed).toBe(false);
        expect(r.hasMiss).toBe(true);
        expect(r.firstMissRequirement?.kind).toBe("comment_type");
        expect(r.firstMissRequirement?.value).toBe("verdict_go");
      } finally {
        db.close();
      }
    });

    test("comment-kanban-task with body.type=verdict_go passes for reviewer", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const reviewer = getRbacRoleByName(db, "reviewer")!;
        setAgentRoles(db, "agent-1", [reviewer.id]);
        const r = checkActionGrants(db, {
          agentId: "agent-1",
          action: "comment-kanban-task",
          dynamicCommentType: "verdict_go",
          mode: "enforce",
        });
        expect(r.allowed).toBe(true);
        expect(r.hasMiss).toBe(false);
      } finally {
        db.close();
      }
    });

    test("comment-kanban-task with body.type=verdict_go passes for pm", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const pm = getRbacRoleByName(db, "pm")!;
        setAgentRoles(db, "agent-1", [pm.id]);
        const r = checkActionGrants(db, {
          agentId: "agent-1",
          action: "comment-kanban-task",
          dynamicCommentType: "verdict_go",
          mode: "enforce",
        });
        expect(r.allowed).toBe(true);
      } finally {
        db.close();
      }
    });

    test("comment-kanban-task without body.type skips comment_type requirement", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const engineer = getRbacRoleByName(db, "engineer")!;
        setAgentRoles(db, "agent-1", [engineer.id]);
        const r = checkActionGrants(db, {
          agentId: "agent-1",
          action: "comment-kanban-task",
          dynamicCommentType: "",
          dynamicScope: "own_assignment", mode: "enforce",
        });
        expect(r.allowed).toBe(true);
        expect(r.hasMiss).toBe(false);
      } finally {
        db.close();
      }
    });

    test("comment-kanban-epic with body.type=verdict_no_go denies researcher", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const researcher = getRbacRoleByName(db, "researcher")!;
        setAgentRoles(db, "agent-1", [researcher.id]);
        const r = checkActionGrants(db, {
          agentId: "agent-1",
          action: "comment-kanban-epic",
          dynamicCommentType: "verdict_no_go",
          mode: "enforce",
        });
        expect(r.allowed).toBe(false);
        expect(r.firstMissRequirement?.kind).toBe("comment_type");
        expect(r.firstMissRequirement?.value).toBe("verdict_no_go");
      } finally {
        db.close();
      }
    });

    test("non-comment action ignores dynamicCommentType", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const engineer = getRbacRoleByName(db, "engineer")!;
        setAgentRoles(db, "agent-1", [engineer.id]);
        // engineer has create_task miss anyway (no kanban-admin), but
        // the comment_type predicate must NOT be added for create-kanban-task.
        const r = checkActionGrants(db, {
          agentId: "agent-1",
          action: "create-kanban-task",
          dynamicCommentType: "verdict_go",
          mode: "enforce",
        });
        expect(r.allowed).toBe(false);
        expect(r.firstMissRequirement?.kind).toBe("tool_family");
        expect(r.firstMissRequirement?.value).toBe("kanban-admin");
      } finally {
        db.close();
      }
    });

    test("soft mode + missing comment_type → grant_miss_soft (not blocking)", () => {
      const db = openFleetDb(dbPath);
      try {
        migrate(db);
        seedAgent(db, "repo-1", "agent-1", "alpha");
        const engineer = getRbacRoleByName(db, "engineer")!;
        setAgentRoles(db, "agent-1", [engineer.id]);
        const r = checkActionGrants(db, {
          agentId: "agent-1",
          action: "comment-kanban-task",
          dynamicCommentType: "verdict_go",
          dynamicScope: "own_assignment",
          mode: "soft",
        });
        expect(r.allowed).toBe(true); // soft: allow
        expect(r.hasMiss).toBe(true); // but logged
        const audits = listAudit(db);
        const softMiss = audits.find((a) => a.kind === "grant_miss_soft" && (a.payload.expected_grant as { value: string }).value === "verdict_go");
        expect(softMiss).toBeDefined();
        expect(softMiss!.payload.outcome).toBe("soft_allow");
      } finally {
        db.close();
      }
    });
  });

  describe("checkActionGrants — Phase 4 shadow parity (advisor §2)", () => {
    interface ParityCase {
      role: string;
      action: string;
      dynamicScope?: string | null;
    }
    const cases: readonly ParityCase[] = [
      // pm — broad grants, expected pass on all
      { role: "pm", action: "create-kanban-task" },
      { role: "pm", action: "update-kanban-task-status", dynamicScope: null },
      { role: "pm", action: "broadcast-message" },
      { role: "pm", action: "post-channel-message" },
      { role: "pm", action: "comment-kanban-task", dynamicScope: null },
      // engineer — own_assignment scope
      { role: "engineer", action: "create-kanban-task" },                     // miss family + action
      { role: "engineer", action: "update-kanban-task-status", dynamicScope: "own_assignment" }, // pass
      { role: "engineer", action: "update-kanban-task-status", dynamicScope: null },              // has-close
      { role: "engineer", action: "post-channel-message" },
      { role: "engineer", action: "broadcast-message" },                       // miss
      // reviewer — review-y grants
      { role: "reviewer", action: "comment-kanban-task" },
      { role: "reviewer", action: "update-kanban-task-status", dynamicScope: null }, // miss
      { role: "reviewer", action: "broadcast-message" },                       // miss
      // researcher
      { role: "researcher", action: "comment-kanban-task" },
      { role: "researcher", action: "create-kanban-task" },                    // miss
      // restricted
      { role: "restricted", action: "read-channel-messages" },                 // pass (slice 4.5 fix)
      { role: "restricted", action: "post-channel-message" },                  // miss family + action
      { role: "restricted", action: "create-kanban-task" },                    // miss
      // operator (no auth grants)
      { role: "operator", action: "create-kanban-task" },                      // miss
      { role: "operator", action: "post-channel-message" },                    // miss
      { role: "operator", action: "send-message" },                            // miss
    ];

    for (const c of cases) {
      const tag = c.dynamicScope === undefined ? c.action : `${c.action} dynamicScope=${c.dynamicScope ?? "null"}`;
      test(`parity: ${c.role} × ${tag}`, () => {
        // Soft and enforce runs share fixture but have separate DB instances
        // so audit rows from the soft run don't pollute the enforce run's
        // audit-kind assertions.
        function run(mode: "soft" | "enforce") {
          const db = openFleetDb(join(dir, `${c.role}-${tag}-${mode}.sqlite`));
          try {
            migrate(db);
            seedAgent(db, "repo-1", "agent-1", "alpha");
            const role = getRbacRoleByName(db, c.role);
            if (role) setAgentRoles(db, "agent-1", [role.id]);
            const out = checkActionGrants(db, {
              agentId: "agent-1",
              action: c.action,
              dynamicScope: c.dynamicScope,
              mode,
            });
            return { hasMiss: out.hasMiss, firstMissKind: out.firstMissRequirement?.kind, firstMissValue: out.firstMissRequirement?.value, allowed: out.allowed };
          } finally {
            db.close();
          }
        }
        const soft = run("soft");
        const hard = run("enforce");
        // hasMiss and firstMissRequirement must agree.
        expect(hard.hasMiss).toBe(soft.hasMiss);
        expect(hard.firstMissKind).toBe(soft.firstMissKind);
        expect(hard.firstMissValue).toBe(soft.firstMissValue);
        // allowed differs only when hasMiss=true: soft=true, hard=false.
        if (soft.hasMiss) {
          expect(soft.allowed).toBe(true);
          expect(hard.allowed).toBe(false);
        } else {
          expect(soft.allowed).toBe(true);
          expect(hard.allowed).toBe(true);
        }
      });
    }
  });
});
