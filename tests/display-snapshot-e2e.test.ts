/**
 * End-to-end coverage for the display-snapshot pipeline introduced in
 * WA-059 + WA-062-followup. Guards Advisor's blocker that "schema added
 * snapshot columns but DAO insert paths never populate them, so messages /
 * channel / kanban history render as deleted/null after role delete."
 *
 * For each insert path that touches a role FK, exercise it through the
 * real DAO (NOT raw SQL) and verify post-role-delete reads:
 *   1. survive (FK SET NULL)
 *   2. retain a non-null `*_display` snapshot
 *   3. surface the snapshot via the `*_role_name` rendered field
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  addKanbanComment,
  addKanbanEpicComment,
  archiveKanbanEpic,
  archiveKanbanTask,
  createKanbanEpic,
  createKanbanTask,
  getKanbanEpicById,
  getKanbanTaskById,
  insertKanbanNotification,
  insertMessage,
  listAllKanbanDependencies,
  listKanbanActivity,
  listKanbanComments,
  listKanbanEpicActivity,
  listKanbanEpicComments,
  listKanbanEpics,
  listKanbanTasks,
  listChannelMessages,
  listMessages,
  listPendingKanbanNotifications,
  postChannelMessage,
  setKanbanEpicCloseApprovalPending,
  updateKanbanTask,
} from "../src/db.ts";
import { seedTestWorkspace, tmpDaemonHome, tmpRepoDir, type TestDaemonHome } from "./helpers/seed-workspace.ts";

let env: TestDaemonHome;

beforeEach(async () => {
  env = await tmpDaemonHome();
});

afterEach(async () => {
  await env.cleanup();
});

async function setup() {
  const repoA = await tmpRepoDir();
  const repoB = await tmpRepoDir();
  const ws = await seedTestWorkspace(env.home, env.daemonDb, {
    name: "ws",
    repos: [
      { absolutePath: repoA, name: "alpha", roles: [{ name: "main" }] },
      { absolutePath: repoB, name: "beta",  roles: [{ name: "agent" }] },
    ],
  });
  return ws;
}

describe("display-snapshot end-to-end (DAO inserts → role delete → reads)", () => {
  test("messages: insertMessage populates from_display + to_display, survives role delete", async () => {
    const ws = await setup();
    try {
      const main = ws.repos[0]!.roles[0]!;
      const agent = ws.repos[1]!.roles[0]!;
      insertMessage(ws.workspaceDb, {
        threadId: "t1",
        fromRoleId: main.id,
        toRoleId: agent.id,
        body: "hello",
        state: "delivered",
        deliveryKind: "direct",
        fromSessionId: null,
        toSessionId: null,
      });
      // Delete the receiving role's repo → cascade-drops role → SET NULL on messages.to_role_id.
      ws.workspaceDb.run("DELETE FROM workspace_repos WHERE id = ?", [agent.raw.repo_id]);
      const rows = listMessages(ws.workspaceDb);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.to_role_id).toBeNull();
      // The rendered to_role_name comes from the snapshot.
      expect(rows[0]?.to_role_name).toBe("beta:agent");
      expect(rows[0]?.from_role_name).toBe("alpha:main");
    } finally {
      ws.workspaceDb.close();
    }
  });

  test("channel_messages: postChannelMessage populates from_display, survives role delete", async () => {
    const ws = await setup();
    try {
      const main = ws.repos[0]!.roles[0]!;
      postChannelMessage(ws.workspaceDb, { fromRoleId: main.id, body: "hi channel", fromSessionId: null });
      ws.workspaceDb.run("DELETE FROM workspace_repos WHERE id = ?", [main.raw.repo_id]);
      const rows = listChannelMessages(ws.workspaceDb);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.from_role_id).toBeNull();
      expect(rows[0]?.from_role_name).toBe("alpha:main");
    } finally {
      ws.workspaceDb.close();
    }
  });

  test("kanban_tasks: createKanbanTask populates created_by_display + assignee_display, survives role delete", async () => {
    const ws = await setup();
    try {
      const main = ws.repos[0]!.roles[0]!;
      const agent = ws.repos[1]!.roles[0]!;
      createKanbanTask(ws.workspaceDb, {
        title: "do thing",
        createdByRoleId: main.id,
        assignedRoleId: agent.id,
        priority: "P2",
        effort: "M",
      });
      ws.workspaceDb.run("DELETE FROM workspace_repos WHERE id = ?", [agent.raw.repo_id]);
      const tasks = listKanbanTasks(ws.workspaceDb);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.assigned_role_id).toBeNull();
      expect(tasks[0]?.assigned_role_name).toBe("beta:agent");
      expect(tasks[0]?.created_by_role_name).toBe("alpha:main");
    } finally {
      ws.workspaceDb.close();
    }
  });

  test("kanban_epics: createKanbanEpic populates display columns, survives role delete", async () => {
    const ws = await setup();
    try {
      const main = ws.repos[0]!.roles[0]!;
      const agent = ws.repos[1]!.roles[0]!;
      createKanbanEpic(ws.workspaceDb, {
        title: "Epic 1",
        createdByRoleId: main.id,
        assignedRoleId: agent.id,
        priority: "P2",
        effort: "M",
      });
      ws.workspaceDb.run("DELETE FROM workspace_repos WHERE id = ?", [agent.raw.repo_id]);
      const epics = listKanbanEpics(ws.workspaceDb);
      expect(epics).toHaveLength(1);
      expect(epics[0]?.assigned_role_id).toBeNull();
      expect(epics[0]?.assigned_role_name).toBe("beta:agent");
      expect(epics[0]?.created_by_role_name).toBe("alpha:main");
    } finally {
      ws.workspaceDb.close();
    }
  });

  test("kanban_comments + kanban_activity: addKanbanComment populates actor_display, survives delete", async () => {
    const ws = await setup();
    try {
      const main = ws.repos[0]!.roles[0]!;
      const task = createKanbanTask(ws.workspaceDb, {
        title: "t",
        createdByRoleId: main.id,
        assignedRoleId: main.id,
        priority: "P2",
        effort: "M",
      });
      addKanbanComment(ws.workspaceDb, task.id, { roleId: main.id, type: "note", body: "first comment" });
      ws.workspaceDb.run("DELETE FROM workspace_repos WHERE id = ?", [main.raw.repo_id]);
      const comments = listKanbanComments(ws.workspaceDb, task.id);
      expect(comments).toHaveLength(1);
      expect(comments[0]?.role_id).toBeNull();
      expect(comments[0]?.role_name).toBe("alpha:main");
      const activity = listKanbanActivity(ws.workspaceDb, task.id);
      // task creation + comment activity rows; both should display the snapshot.
      expect(activity.length).toBeGreaterThan(0);
      for (const a of activity) {
        expect(a.role_name).toBe("alpha:main");
      }
    } finally {
      ws.workspaceDb.close();
    }
  });

  test("kanban_notifications: insertKanbanNotification populates to_display, survives delete", async () => {
    const ws = await setup();
    try {
      const main = ws.repos[0]!.roles[0]!;
      const agent = ws.repos[1]!.roles[0]!;
      const task = createKanbanTask(ws.workspaceDb, {
        title: "n",
        createdByRoleId: main.id,
        assignedRoleId: agent.id,
        priority: "P2",
        effort: "M",
      });
      insertKanbanNotification(ws.workspaceDb, {
        taskId: task.id,
        toRoleId: agent.id,
        actorRoleId: main.id,
        eventType: "assigned",
        body: "you got the task",
      });
      // Save agent ID for query, then delete the agent's repo
      const agentId = agent.id;
      ws.workspaceDb.run("DELETE FROM workspace_repos WHERE id = ?", [agent.raw.repo_id]);
      // listPendingKanbanNotifications by role id won't find a row because the
      // FK is now NULL. We read directly by reading the task notification join.
      const all = ws.workspaceDb.query<{ to_role_id: string | null; to_role_name: string }, []>(
        `SELECT kanban_notifications.to_role_id,
                COALESCE(to_repo.name || ':' || to_role.name, kanban_notifications.to_display, '(deleted)') AS to_role_name
         FROM kanban_notifications
         LEFT JOIN agents AS to_role ON to_role.id = kanban_notifications.to_role_id
         LEFT JOIN workspace_repos AS to_repo ON to_repo.id = to_role.repo_id`,
      ).all();
      expect(all).toHaveLength(1);
      expect(all[0]?.to_role_id).toBeNull();
      expect(all[0]?.to_role_name).toBe("beta:agent");
      // Sanity: pending-by-role lookup correctly returns nothing (the role
      // is gone, the cursor has no match).
      expect(listPendingKanbanNotifications(ws.workspaceDb, agentId)).toHaveLength(0);
    } finally {
      ws.workspaceDb.close();
    }
  });

  test("messages: human-web sentinel writes NULL to_role_id + 'human-web' display", async () => {
    const ws = await setup();
    try {
      const main = ws.repos[0]!.roles[0]!;
      // Agent → human-web direct message (EP-DEC-3 path).
      insertMessage(ws.workspaceDb, {
        threadId: "t-hw-out",
        fromRoleId: main.id,
        toRoleId: "human-web",
        body: "ping human",
        state: "delivered",
        deliveryKind: "direct",
        fromSessionId: null,
        toSessionId: null,
      });
      // Web → agent direct message (no fromRoleId).
      insertMessage(ws.workspaceDb, {
        threadId: "t-hw-in",
        fromRoleId: null,
        toRoleId: main.id,
        body: "ping agent",
        state: "delivered",
        deliveryKind: "direct",
        fromSessionId: null,
        toSessionId: null,
      });
      const rows = listMessages(ws.workspaceDb).sort((a, b) => a.id - b.id);
      expect(rows).toHaveLength(2);
      // Outbound: from_role_id = main, to_role_id NULL (sentinel translated).
      expect(rows[0]?.from_role_id).toBe(main.id);
      expect(rows[0]?.to_role_id).toBeNull();
      expect(rows[0]?.from_role_name).toBe("alpha:main");
      expect(rows[0]?.to_role_name).toBe("human-web");
      // Inbound: from_role_id NULL (web origin), to_role_id = main.
      expect(rows[1]?.from_role_id).toBeNull();
      expect(rows[1]?.to_role_id).toBe(main.id);
      expect(rows[1]?.from_role_name).toBe("human-web");
      expect(rows[1]?.to_role_name).toBe("alpha:main");
    } finally {
      ws.workspaceDb.close();
    }
  });

  test("kanban_dependencies: created_by_display populated, survives creator delete", async () => {
    const ws = await setup();
    try {
      const main = ws.repos[0]!.roles[0]!;
      const t1 = createKanbanTask(ws.workspaceDb, {
        title: "first",
        createdByRoleId: main.id,
        assignedRoleId: main.id,
        priority: "P2",
        effort: "M",
      });
      const t2 = createKanbanTask(ws.workspaceDb, {
        title: "second",
        createdByRoleId: main.id,
        assignedRoleId: main.id,
        priority: "P2",
        effort: "M",
      });
      // Create the dependency via updateKanbanTask (the only public path).
      updateKanbanTask(ws.workspaceDb, t2.id, {
        actorRoleId: main.id,
        actorSessionId: null,
        dependsOnTaskIds: [t1.display_id],
      });
      ws.workspaceDb.run("DELETE FROM workspace_repos WHERE id = ?", [main.raw.repo_id]);
      const deps = listAllKanbanDependencies(ws.workspaceDb);
      expect(deps).toHaveLength(1);
      expect(deps[0]?.created_by_role_id).toBeNull();
      expect(deps[0]?.created_by_role_name).toBe("alpha:main");
    } finally {
      ws.workspaceDb.close();
    }
  });

  test("kanban_tasks archive: archived_by_display populated, survives delete", async () => {
    const ws = await setup();
    try {
      const main = ws.repos[0]!.roles[0]!;
      const task = createKanbanTask(ws.workspaceDb, {
        title: "to archive",
        createdByRoleId: main.id,
        assignedRoleId: main.id,
        priority: "P2",
        effort: "M",
      });
      archiveKanbanTask(ws.workspaceDb, task.id, main.id, null);
      ws.workspaceDb.run("DELETE FROM workspace_repos WHERE id = ?", [main.raw.repo_id]);
      const archived = getKanbanTaskById(ws.workspaceDb, task.id);
      expect(archived?.archived_by_role_id).toBeNull();
      expect(archived?.archived_by_role_name).toBe("alpha:main");
    } finally {
      ws.workspaceDb.close();
    }
  });

  test("kanban_epics archive + close-approval: displays populated, survive delete", async () => {
    const ws = await setup();
    try {
      const main = ws.repos[0]!.roles[0]!;
      const epic = createKanbanEpic(ws.workspaceDb, {
        title: "E",
        createdByRoleId: main.id,
        assignedRoleId: main.id,
        priority: "P2",
        effort: "M",
      });
      // Request close-approval first (records the requester display).
      setKanbanEpicCloseApprovalPending(ws.workspaceDb, epic.id, main.id, null);
      // Then archive separately (records archived_by display).
      archiveKanbanEpic(ws.workspaceDb, epic.id, main.id, null);
      ws.workspaceDb.run("DELETE FROM workspace_repos WHERE id = ?", [main.raw.repo_id]);
      const archived = getKanbanEpicById(ws.workspaceDb, epic.id);
      expect(archived?.archived_by_role_id).toBeNull();
      expect(archived?.archived_by_role_name).toBe("alpha:main");
      expect(archived?.close_approval_requested_by_role_id).toBeNull();
      expect(archived?.close_approval_requested_by_role_name).toBe("alpha:main");
    } finally {
      ws.workspaceDb.close();
    }
  });

  test("kanban_epic_comments + activity: snapshot fallback after role delete", async () => {
    const ws = await setup();
    try {
      const main = ws.repos[0]!.roles[0]!;
      const epic = createKanbanEpic(ws.workspaceDb, {
        title: "E",
        createdByRoleId: main.id,
        assignedRoleId: main.id,
        priority: "P2",
        effort: "M",
      });
      addKanbanEpicComment(ws.workspaceDb, epic.id, { roleId: main.id, type: "note", body: "epic note" });
      ws.workspaceDb.run("DELETE FROM workspace_repos WHERE id = ?", [main.raw.repo_id]);
      const comments = listKanbanEpicComments(ws.workspaceDb, epic.id);
      expect(comments[0]?.role_name).toBe("alpha:main");
      const activity = listKanbanEpicActivity(ws.workspaceDb, epic.id);
      for (const a of activity) {
        expect(a.role_name).toBe("alpha:main");
      }
    } finally {
      ws.workspaceDb.close();
    }
  });
});
