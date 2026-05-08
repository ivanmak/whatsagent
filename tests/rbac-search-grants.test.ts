import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { listAudit } from "../src/audit-log-dao.ts";
import { migrate, openFleetDb } from "../src/db.ts";
import { getRbacRoleByName, setAgentRoles } from "../src/rbac-dao.ts";
import { ACTION_GRANT_REQUIREMENTS, checkActionGrants, shouldExposeTool } from "../src/rbac-enforce.ts";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wa-search-rbac-"));
  dbPath = join(dir, "ws.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seedAgent(db: ReturnType<typeof openFleetDb>, agentId = "agent-1"): void {
  const now = new Date().toISOString();
  db.run("INSERT INTO workspace_repos (id, name, absolute_path, created_at, updated_at) VALUES ('repo-1', 'repo', '/tmp/repo', ?, ?)", [now, now]);
  db.run("INSERT INTO agents (id, repo_id, name, host_default, created_at, updated_at) VALUES (?, 'repo-1', 'worker', 'claude-code', ?, ?)", [agentId, now, now]);
}

function roleGrantValues(db: ReturnType<typeof openFleetDb>, roleName: string, kind: string): string[] {
  return db.query<{ value: string }, [string, string]>(
    `SELECT g.grant_value AS value
       FROM role_grants g
       JOIN roles r ON r.id = g.role_id
      WHERE r.name = ? AND g.grant_kind = ?
      ORDER BY g.grant_value`,
  ).all(roleName, kind).map((row) => row.value);
}

describe("WA-111 search RBAC grants", () => {
  test("search actions declare the expected grant requirements", () => {
    expect(ACTION_GRANT_REQUIREMENTS["search-direct-messages"]).toEqual([
      { kind: "tool_family", value: "messaging" },
    ]);
    expect(ACTION_GRANT_REQUIREMENTS["search-channel-messages"]).toEqual([
      { kind: "tool_family", value: "channel-read" },
      { kind: "channel_action", value: "search_channel_messages" },
    ]);
    expect(ACTION_GRANT_REQUIREMENTS["search-kanban-tasks"]).toEqual([
      { kind: "tool_family", value: "kanban-read" },
    ]);
    expect(ACTION_GRANT_REQUIREMENTS["search-kanban-epics"]).toEqual([
      { kind: "tool_family", value: "kanban-read" },
    ]);
  });

  test("default channel search grants mirror read_channel_messages recipients", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      for (const role of ["pm", "engineer", "reviewer", "researcher", "restricted"]) {
        const channelActions = roleGrantValues(db, role, "channel_action");
        expect(channelActions).toContain("read_channel_messages");
        expect(channelActions).toContain("search_channel_messages");
      }
    } finally {
      db.close();
    }
  });

  test("register-time visibility maps search tools to their families", () => {
    expect(shouldExposeTool("search_direct_messages", ["messaging"], "enforce")).toBe(true);
    expect(shouldExposeTool("search_direct_messages", [], "enforce")).toBe(false);
    expect(shouldExposeTool("search_channel_messages", ["channel-read"], "enforce")).toBe(true);
    expect(shouldExposeTool("search_channel_messages", [], "enforce")).toBe(false);
    expect(shouldExposeTool("search_kanban_tasks", ["kanban-read"], "enforce")).toBe(true);
    expect(shouldExposeTool("search_kanban_epics", ["kanban-read"], "enforce")).toBe(true);
  });

  test("enforce mode denies search calls missing their required family or action grant", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      seedAgent(db);
      const restricted = getRbacRoleByName(db, "restricted")!;
      setAgentRoles(db, "agent-1", [restricted.id]);

      const direct = checkActionGrants(db, { agentId: "agent-1", action: "search-direct-messages", mode: "enforce" });
      expect(direct.allowed).toBe(false);
      expect(direct.firstMissRequirement).toEqual({ kind: "tool_family", value: "messaging" });

      const channel = checkActionGrants(db, { agentId: "agent-1", action: "search-channel-messages", mode: "enforce" });
      expect(channel.allowed).toBe(true);

      const custom = getRbacRoleByName(db, "operator")!;
      setAgentRoles(db, "agent-1", [custom.id]);
      const tasks = checkActionGrants(db, { agentId: "agent-1", action: "search-kanban-tasks", mode: "enforce" });
      const epics = checkActionGrants(db, { agentId: "agent-1", action: "search-kanban-epics", mode: "enforce" });
      expect(tasks.allowed).toBe(false);
      expect(epics.allowed).toBe(false);
      expect(tasks.firstMissRequirement).toEqual({ kind: "tool_family", value: "kanban-read" });
      expect(epics.firstMissRequirement).toEqual({ kind: "tool_family", value: "kanban-read" });
    } finally {
      db.close();
    }
  });

  test("soft mode allows missing-grant search calls and records grant_miss_soft", () => {
    const db = openFleetDb(dbPath);
    try {
      migrate(db);
      seedAgent(db);
      const operator = getRbacRoleByName(db, "operator")!;
      setAgentRoles(db, "agent-1", [operator.id]);

      const result = checkActionGrants(db, { agentId: "agent-1", action: "search-kanban-tasks", mode: "soft" });
      expect(result.allowed).toBe(true);
      expect(result.hasMiss).toBe(true);
      const audit = listAudit(db).find((row) => row.kind === "grant_miss_soft");
      expect(audit?.payload.tool).toBe("search-kanban-tasks");
    } finally {
      db.close();
    }
  });
});
