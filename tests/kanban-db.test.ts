import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";

import { seedTestWorkspace, tmpDaemonHome, tmpRepoDir } from "./helpers/seed-workspace.ts";

import {
  addKanbanComment,
  addKanbanEpicComment,
  archiveKanbanEpic,
  archiveKanbanTask,
  clearKanbanEpicCloseApproval,
  completeKanbanEpicWithApproval,
  countOpenKanbanEpicChildren,
  createKanbanEpic,
  createKanbanTask,
  getKanbanEpic,
  getKanbanSettings,
  getKanbanTask,
  getRoleByName,
  insertKanbanEpicNotification,
  insertKanbanNotification,
  kanbanEpicNotificationToInboxRow,
  listKanbanActivity,
  listKanbanComments,
  listKanbanDependedBy,
  listKanbanDependencies,
  listKanbanEpicActivity,
  listKanbanEpicChildren,
  listKanbanEpicComments,
  listKanbanEpics,
  listKanbanTasks,
  listOpenKanbanEpicChildren,
  listPendingKanbanEpicNotifications,
  listPendingKanbanNotifications,
  listUnclassifiedKanbanTasks,
  markKanbanEpicNotificationsRead,
  markKanbanNotificationsRead,
  migrate,
  notifyKanbanEpicEvent,
  type AgentRow,
  setKanbanEpicCloseApprovalPending,
  setKanbanEpicStatus,
  setKanbanSettings,
  updateKanbanEpic,
  updateKanbanTask,
} from "../src/db.ts";

interface KanbanFixture {
  db: Awaited<ReturnType<typeof seedTestWorkspace>>["workspaceDb"];
  architect: AgentRow;
  serviceA: AgentRow;
  cleanup: () => Promise<void>;
}

async function tempKanbanFixture(): Promise<KanbanFixture> {
  const env = await tmpDaemonHome();
  const repoPath = await tmpRepoDir();
  const seeded = await seedTestWorkspace(env.home, env.daemonDb, {
    name: "kanban-db",
    repos: [{ absolutePath: repoPath, name: "repo", roles: [{ name: "architect" }, { name: "serviceA" }] }],
  });
  const architect = getRoleByName(seeded.workspaceDb, "architect");
  const serviceA = getRoleByName(seeded.workspaceDb, "serviceA");
  if (!architect || !serviceA) throw new Error("test roles missing");
  return {
    db: seeded.workspaceDb,
    architect,
    serviceA,
    cleanup: async () => {
      try { seeded.workspaceDb.close(); } catch { /* already closed */ }
      await env.cleanup();
      await rm(repoPath, { recursive: true, force: true });
    },
  };
}

test("kanban db helpers create stable display ids and task history", async () => {
  const fixture = await tempKanbanFixture();
  const { db, architect, serviceA } = fixture;
  try {
      expect(getKanbanSettings(db)).toEqual({ taskIdPrefix: "WA", epicIdPrefix: "EP" });
      expect(setKanbanSettings(db, { taskIdPrefix: "task" })).toEqual({ taskIdPrefix: "TASK", epicIdPrefix: "EP" });

      const first = createKanbanTask(db, {
        title: "Implement queue persistence",
        details: "Persist pending work across daemon restarts.",
        createdByRoleId: architect.id,
        assignedRoleId: serviceA.id,
        priority: "P1",
        effort: "L",
      });
      expect(first).toMatchObject({ display_id: "TASK-001", status: "Backlog", priority: "P1", effort: "L", created_by_role_name: "repo:architect", assigned_role_name: "repo:serviceA" });

      setKanbanSettings(db, { taskIdPrefix: "NEXT" });
      const dependency = createKanbanTask(db, {
        title: "Add schema migration tests",
        createdByRoleId: architect.id,
        assignedRoleId: architect.id,
        priority: "P2",
        effort: "M",
      });
      expect(dependency.display_id).toBe("NEXT-002");
      expect(getKanbanTask(db, first.display_id)?.display_id).toBe("TASK-001");

      const updated = updateKanbanTask(db, first.display_id, {
        actorRoleId: architect.id,
        actorSessionId: "architect-session",
        status: "Queued",
        assignedRoleId: architect.id,
        priority: "P0",
        githubUrl: "https://github.com/example/repo/issues/42",
        githubNumber: 42,
        githubTitle: "Queue persistence",
        dependsOnTaskIds: [dependency.display_id],
      });
      expect(updated).toMatchObject({ display_id: "TASK-001", status: "Queued", priority: "P0", assigned_role_name: "repo:architect", github_number: 42 });
      expect(listKanbanDependencies(db, first.id)).toMatchObject([{ task_display_id: "TASK-001", depends_on_display_id: "NEXT-002", depends_on_title: "Add schema migration tests" }]);
      expect(listKanbanDependedBy(db, dependency.id)).toMatchObject([{ task_display_id: "TASK-001", depends_on_display_id: "NEXT-002" }]);

      const comment = addKanbanComment(db, first.id, { roleId: architect.id, sessionId: "architect-session", type: "blocker", body: "Blocked until migration tests settle." });
      expect(comment).toMatchObject({ task_display_id: "TASK-001", role_name: "repo:architect", type: "blocker" });
      expect(listKanbanComments(db, first.display_id)).toHaveLength(1);
      expect(listKanbanActivity(db, first.display_id).map((item) => [item.action, item.field])).toEqual(expect.arrayContaining([
        ["created", null],
        ["updated", "status"],
        ["updated", "assigned_role_id"],
        ["updated", "dependencies"],
        ["commented", "blocker"],
      ]));

      const notification = insertKanbanNotification(db, {
        taskId: first.id,
        toRoleId: serviceA.id,
        actorRoleId: architect.id,
        eventType: "blocker_comment",
        commentId: comment.id,
        body: "TASK-001 has a blocker comment.",
      });
      expect(listPendingKanbanNotifications(db, serviceA.id)).toMatchObject([{ id: notification.id, task_display_id: "TASK-001", to_role_name: "repo:serviceA", actor_role_name: "repo:architect" }]);
      expect(markKanbanNotificationsRead(db, serviceA.id, [notification.id])).toMatchObject([{ id: notification.id, read_at: expect.any(String) }]);
      expect(listPendingKanbanNotifications(db, serviceA.id)).toEqual([]);

      archiveKanbanTask(db, first.display_id, architect.id, "architect-session");
      expect(listKanbanTasks(db).map((task) => task.display_id)).toEqual(["NEXT-002"]);
      expect(listKanbanTasks(db, { includeArchived: true }).map((task) => task.display_id)).toEqual(["TASK-001", "NEXT-002"]);
  } finally {
    await fixture.cleanup();
  }
});

test("createKanbanTask rejects non-http(s) github_url schemes", async () => {
  const fixture = await tempKanbanFixture();
  const { db, architect, serviceA } = fixture;
  try {
      const baseInput = {
        title: "Phishing payload task",
        createdByRoleId: architect.id,
        assignedRoleId: serviceA.id,
      };

      expect(() =>
        createKanbanTask(db, { ...baseInput, githubUrl: "javascript:alert(1)" }),
      ).toThrow(/githubUrl must start with http/);
      expect(() =>
        createKanbanTask(db, { ...baseInput, githubUrl: "data:text/html,<script>" }),
      ).toThrow(/githubUrl must start with http/);
      expect(() =>
        createKanbanTask(db, { ...baseInput, githubUrl: "file:///etc/passwd" }),
      ).toThrow(/githubUrl must start with http/);

      const ok = createKanbanTask(db, {
        ...baseInput,
        githubUrl: "https://github.com/example/repo/issues/1",
      });
      expect(ok.github_url).toBe("https://github.com/example/repo/issues/1");

      expect(() =>
        updateKanbanTask(db, ok.display_id, {
          actorRoleId: architect.id,
          actorSessionId: "smoke-session",
          githubUrl: "javascript:doom()",
        }),
      ).toThrow(/githubUrl must start with http/);
  } finally {
    await fixture.cleanup();
  }
});

test("kanban effort defaults to M and rejects legacy labels", async () => {
  const fixture = await tempKanbanFixture();
  const { db, architect, serviceA } = fixture;
  try {
    const task = createKanbanTask(db, { title: "Default task effort", createdByRoleId: architect.id, assignedRoleId: serviceA.id });
    expect(task.effort).toBe("M");
    const epic = createKanbanEpic(db, { title: "Default epic effort", createdByRoleId: architect.id, assignedRoleId: serviceA.id });
    expect(epic.effort).toBe("M");
    expect(() => createKanbanTask(db, { title: "Legacy task effort", createdByRoleId: architect.id, assignedRoleId: serviceA.id, effort: "Medium" as never })).toThrow("kanban effort must be XS, S, M, L, or XL");
    expect(() => createKanbanEpic(db, { title: "Legacy epic effort", createdByRoleId: architect.id, assignedRoleId: serviceA.id, effort: "Medium" as never })).toThrow("kanban effort must be XS, S, M, L, or XL");
  } finally {
    await fixture.cleanup();
  }
});

test("migration 9 adds kanban_epics + epic_id column + EP prefix setting", async () => {
  const fixture = await tempKanbanFixture();
  const { db } = fixture;
  try {
      // kanban_epics table + columns present.
      const epicCols = db.query<{ name: string }, []>("PRAGMA table_info(kanban_epics)").all();
      const epicNames = new Set(epicCols.map((c) => c.name));
      for (const expected of [
        "id", "display_id", "sequence", "title", "details", "status", "priority", "effort",
        "created_by_role_id", "assigned_role_id", "github_url", "github_number", "github_title",
        "created_at", "updated_at", "completed_at", "archived_at", "archived_by_role_id",
        "close_approval_status", "close_approval_requested_at", "close_approval_requested_by_role_id",
        "close_approval_approved_at", "close_approval_approved_by",
      ]) {
        expect(epicNames.has(expected)).toBe(true);
      }

      // kanban_tasks gained epic_id column.
      const taskCols = db.query<{ name: string }, []>("PRAGMA table_info(kanban_tasks)").all();
      expect(taskCols.some((c) => c.name === "epic_id")).toBe(true);

      // Default settings include EP prefix.
      expect(getKanbanSettings(db)).toEqual({ taskIdPrefix: "WA", epicIdPrefix: "EP" });

      // Setting epicIdPrefix: roundtrip + uppercasing + validation.
      expect(setKanbanSettings(db, { epicIdPrefix: "feat" })).toEqual({ taskIdPrefix: "WA", epicIdPrefix: "FEAT" });
      expect(getKanbanSettings(db)).toEqual({ taskIdPrefix: "WA", epicIdPrefix: "FEAT" });
      expect(() => setKanbanSettings(db, { epicIdPrefix: "1bad" })).toThrow(/kanban epic id prefix/);

      // Re-running migrate is a no-op.
      migrate(db);
      const epicColsAfter = db.query<{ name: string }, []>("PRAGMA table_info(kanban_epics)").all();
      expect(epicColsAfter.length).toBe(epicCols.length);
  } finally {
    await fixture.cleanup();
  }
});

test("migration 10 adds parallel epic comment/activity/notification tables and helpers", async () => {
  const fixture = await tempKanbanFixture();
  const { db, architect, serviceA } = fixture;
  try {
      // All three parallel tables present.
      for (const table of ["kanban_epic_comments", "kanban_epic_activity", "kanban_epic_notifications"]) {
        const cols = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
        expect(cols.length).toBeGreaterThan(0);
      }

      // Existing task tables UNCHANGED — no epic_id column was added to them.
      for (const table of ["kanban_comments", "kanban_activity", "kanban_notifications"]) {
        const cols = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
        expect(cols.some((c) => c.name === "epic_id")).toBe(false);
      }

      // Seed an epic row directly (createKanbanEpic helper lands in WA-010).
      const epicResult = db.query<{ id: number }, [string, number, string, string, string, string, string, string, string, string, string]>(
        `INSERT INTO kanban_epics (display_id, sequence, title, status, priority, effort, created_by_role_id, assigned_role_id, created_at, updated_at, close_approval_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
      ).get("EP-001", 1, "Test epic", "Backlog", "P1", "M", architect.id, serviceA.id, new Date().toISOString(), new Date().toISOString(), "none");
      if (!epicResult) throw new Error("failed to insert seed epic");

      // addKanbanEpicComment writes to kanban_epic_comments + kanban_epic_activity (NOT to task tables).
      const comment = addKanbanEpicComment(db, epicResult.id, { roleId: serviceA.id, type: "blocker", body: "Stalled on schema review" });
      expect(comment.epic_id).toBe(epicResult.id);
      expect(comment.epic_display_id).toBe("EP-001");
      expect(comment.role_name).toBe("repo:serviceA");
      expect(comment.type).toBe("blocker");

      const epicComments = listKanbanEpicComments(db, epicResult.id);
      expect(epicComments.length).toBe(1);
      const epicActivity = listKanbanEpicActivity(db, epicResult.id);
      expect(epicActivity.length).toBe(1);
      expect(epicActivity[0]!.action).toBe("commented");
      // Task-side tables not touched.
      expect(db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM kanban_comments").get()?.count).toBe(0);
      expect(db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM kanban_activity").get()?.count).toBe(0);

      // notifyKanbanEpicEvent: recipients = creator + assignee minus actor; actor=architect (creator) so only assignee gets notified.
      const epicRow = { id: epicResult.id, assigned_role_id: serviceA.id, created_by_role_id: architect.id };
      const notifs = notifyKanbanEpicEvent(db, epicRow, architect.id, "epic_status_in_progress", "Moved to In Progress");
      expect(notifs.length).toBe(1);
      expect(notifs[0]!.to_role_id).toBe(serviceA.id);
      expect(notifs[0]!.event_type).toBe("epic_status_in_progress");

      // Pending list separate from task notifications.
      const pendingEpic = listPendingKanbanEpicNotifications(db, serviceA.id, 50);
      expect(pendingEpic.length).toBe(1);
      const pendingTask = listPendingKanbanNotifications(db, serviceA.id, 50);
      expect(pendingTask.length).toBe(0);

      // Inbox row mapping: distinct kanban_epic_* fields, shared delivery_kind="kanban".
      const inboxRow = kanbanEpicNotificationToInboxRow(notifs[0]!, serviceA, "session-abc", "pending");
      expect(inboxRow.delivery_kind).toBe("kanban");
      expect(inboxRow.kanban_epic_notification_id).toBe(notifs[0]!.id);
      expect(inboxRow.kanban_epic_id).toBe(epicResult.id);
      expect(inboxRow.kanban_epic_display_id).toBe("EP-001");
      expect(inboxRow.kanban_event_type).toBe("epic_status_in_progress");
      expect(inboxRow.kanban_notification_id ?? null).toBeNull();
      expect(inboxRow.thread_id).toBe("kanban-epic:EP-001");

      // markKanbanEpicNotificationsRead: only flips epic notifications.
      const marked = markKanbanEpicNotificationsRead(db, serviceA.id, [notifs[0]!.id]);
      expect(marked.length).toBe(1);
      expect(marked[0]!.read_at).not.toBeNull();
      expect(listPendingKanbanEpicNotifications(db, serviceA.id, 50).length).toBe(0);

      // Direct insertKanbanEpicNotification API path.
      const direct = insertKanbanEpicNotification(db, {
        epicId: epicResult.id,
        toRoleId: architect.id,
        actorRoleId: serviceA.id,
        eventType: "epic_blocker_comment",
        body: "Need decision on schema",
      });
      expect(direct.actor_role_name).toBe("repo:serviceA");
      expect(direct.epic_display_id).toBe("EP-001");

      // Recipient set excludes actor + dedupes when assignee==creator.
      const samePersonEpicId = (() => {
        const row = db.query<{ id: number }, [string, number, string, string, string, string, string, string, string, string, string]>(
          `INSERT INTO kanban_epics (display_id, sequence, title, status, priority, effort, created_by_role_id, assigned_role_id, created_at, updated_at, close_approval_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id`,
        ).get("EP-002", 2, "Solo epic", "Backlog", "P2", "S", architect.id, architect.id, new Date().toISOString(), new Date().toISOString(), "none");
        return row!.id;
      })();
      const soloRow = { id: samePersonEpicId, assigned_role_id: architect.id, created_by_role_id: architect.id };
      // Actor is the same role: nobody to notify.
      expect(notifyKanbanEpicEvent(db, soloRow, architect.id, "epic_created", "n/a").length).toBe(0);
      // Different actor: only architect (deduped from creator+assignee).
      const soloNotifs = notifyKanbanEpicEvent(db, soloRow, serviceA.id, "epic_created", "Created EP-002");
      expect(soloNotifs.length).toBe(1);
      expect(soloNotifs[0]!.to_role_id).toBe(architect.id);
  } finally {
    await fixture.cleanup();
  }
});

test("kanban epic CRUD helpers issue stable display ids and gate archive-with-children", async () => {
  const fixture = await tempKanbanFixture();
  const { db, architect, serviceA } = fixture;
  try {
      // EP-prefix sequence respects current setting.
      const first = createKanbanEpic(db, {
        title: "Auth refactor",
        details: "Rip out the legacy session middleware.",
        createdByRoleId: architect.id,
        assignedRoleId: serviceA.id,
        priority: "P1",
        effort: "L",
      });
      expect(first.display_id).toBe("EP-001");
      expect(first.status).toBe("Backlog");
      expect(first.assigned_role_name).toBe("repo:serviceA");
      expect(first.created_by_role_name).toBe("repo:architect");
      expect(first.close_approval_status).toBe("none");

      setKanbanSettings(db, { epicIdPrefix: "FEAT" });
      const second = createKanbanEpic(db, { title: "Onboarding wizard", createdByRoleId: architect.id, assignedRoleId: architect.id });
      expect(second.display_id).toBe("FEAT-002");

      // List + lookup work by both numeric id and display id.
      const all = listKanbanEpics(db, {});
      expect(all.map((e) => e.display_id)).toEqual(["EP-001", "FEAT-002"]);
      expect(getKanbanEpic(db, "ep-001")?.id).toBe(first.id);
      expect(getKanbanEpic(db, first.id)?.display_id).toBe("EP-001");

      // Update activity + reassignment.
      const updated = updateKanbanEpic(db, first.id, {
        actorRoleId: architect.id,
        title: "Auth refactor (phase 1)",
        status: "Queued",
        assignedRoleId: architect.id,
      });
      expect(updated.title).toBe("Auth refactor (phase 1)");
      expect(updated.status).toBe("Queued");
      expect(updated.assigned_role_id).toBe(architect.id);

      // Status filter.
      const queued = listKanbanEpics(db, { status: "Queued" });
      expect(queued.map((e) => e.display_id)).toEqual(["EP-001"]);

      // Children helpers see no children yet.
      expect(listKanbanEpicChildren(db, first.id).length).toBe(0);
      expect(listUnclassifiedKanbanTasks(db).length).toBe(0);

      // Seed an unlinked task + a linked task (direct insert; createKanbanTask doesn't expose epicId until WA-011).
      const linkedTask = createKanbanTask(db, { title: "Drop sessions table", createdByRoleId: architect.id, assignedRoleId: serviceA.id });
      db.run("UPDATE kanban_tasks SET epic_id = ? WHERE id = ?", [first.id, linkedTask.id]);
      const orphan = createKanbanTask(db, { title: "Floats outside any epic", createdByRoleId: architect.id, assignedRoleId: serviceA.id });
      expect(listKanbanEpicChildren(db, first.id).map((t) => t.display_id)).toEqual([linkedTask.display_id]);
      expect(listUnclassifiedKanbanTasks(db).map((t) => t.display_id)).toEqual([orphan.display_id]);

      // archiveKanbanEpic blocks while there's an open child.
      let archiveError: (Error & { code?: string; childDisplayIds?: string[] }) | null = null;
      try {
        archiveKanbanEpic(db, first.id, architect.id, null);
      } catch (e) {
        archiveError = e as Error & { code?: string; childDisplayIds?: string[] };
      }
      expect(archiveError).not.toBeNull();
      expect(archiveError?.code).toBe("EPIC_HAS_CHILDREN");
      expect(archiveError?.childDisplayIds).toEqual([linkedTask.display_id]);

      // Once child is archived, listKanbanEpicChildren default excludes archived; includeArchived flag flips that.
      archiveKanbanTask(db, linkedTask.id, architect.id, null);
      expect(listKanbanEpicChildren(db, first.id).length).toBe(0);
      expect(listKanbanEpicChildren(db, first.id, { includeArchived: true }).map((t) => t.display_id)).toEqual([linkedTask.display_id]);

      // Now archive succeeds.
      const archivedEpic = archiveKanbanEpic(db, first.id, architect.id, null);
      expect(archivedEpic.archived_at).not.toBeNull();
      expect(archivedEpic.archived_by_role_name).toBe("repo:architect");

      // Default list excludes archived epic.
      expect(listKanbanEpics(db, {}).map((e) => e.display_id)).toEqual(["FEAT-002"]);
      expect(listKanbanEpics(db, { includeArchived: true }).map((e) => e.display_id)).toEqual(["EP-001", "FEAT-002"]);
  } finally {
    await fixture.cleanup();
  }
});

test("kanban task epicId linking: create, update, list filter, archived rejection", async () => {
  const fixture = await tempKanbanFixture();
  const { db, architect, serviceA } = fixture;
  try {
      const epic = createKanbanEpic(db, { title: "Auth refactor", createdByRoleId: architect.id, assignedRoleId: serviceA.id });
      expect(epic.display_id).toBe("EP-001");

      // Backward compat: createKanbanTask without epicId leaves epic_id null.
      const orphan = createKanbanTask(db, { title: "Plain task", createdByRoleId: architect.id, assignedRoleId: serviceA.id });
      expect(orphan.epic_id).toBeNull();

      // Create with epicId by display id.
      const linked = createKanbanTask(db, { title: "Linked at create", createdByRoleId: architect.id, assignedRoleId: serviceA.id, epicId: "ep-001" });
      expect(linked.epic_id).toBe(epic.id);

      // Update by numeric epic id, then unlink with null, then re-link with a string display id.
      const linkedAgain = updateKanbanTask(db, orphan.id, { actorRoleId: architect.id, epicId: epic.id });
      expect(linkedAgain.epic_id).toBe(epic.id);
      const unlinked = updateKanbanTask(db, orphan.id, { actorRoleId: architect.id, epicId: null });
      expect(unlinked.epic_id).toBeNull();
      const reLinked = updateKanbanTask(db, orphan.id, { actorRoleId: architect.id, epicId: "EP-001" });
      expect(reLinked.epic_id).toBe(epic.id);

      // listKanbanTasks epicId filter: numeric id, display id, "none" sentinel.
      const orphan2 = createKanbanTask(db, { title: "Outside everything", createdByRoleId: architect.id, assignedRoleId: serviceA.id });
      expect(listKanbanTasks(db, { epicId: epic.id }).map((t) => t.display_id).sort()).toEqual([reLinked.display_id, linked.display_id].sort());
      expect(listKanbanTasks(db, { epicId: "EP-001" }).map((t) => t.display_id).sort()).toEqual([reLinked.display_id, linked.display_id].sort());
      expect(listKanbanTasks(db, { epicId: "none" }).map((t) => t.display_id)).toEqual([orphan2.display_id]);
      expect(listKanbanTasks(db, { epicId: null }).map((t) => t.display_id)).toEqual([orphan2.display_id]);
      // Omitted filter returns everything.
      expect(listKanbanTasks(db, {}).length).toBe(3);

      // Reject linking to non-existent epic.
      expect(() => createKanbanTask(db, { title: "Bad ref", createdByRoleId: architect.id, assignedRoleId: serviceA.id, epicId: "EP-999" })).toThrow(/kanban epic was not found/);
      expect(() => updateKanbanTask(db, orphan2.id, { actorRoleId: architect.id, epicId: 9999 })).toThrow(/kanban epic was not found/);

      // Reject linking to archived epic. Detach children first so we can archive the epic.
      updateKanbanTask(db, reLinked.id, { actorRoleId: architect.id, epicId: null });
      updateKanbanTask(db, linked.id, { actorRoleId: architect.id, epicId: null });
      const archivedEpic = archiveKanbanEpic(db, epic.id, architect.id, null);
      expect(archivedEpic.archived_at).not.toBeNull();
      expect(() => createKanbanTask(db, { title: "Try archived", createdByRoleId: architect.id, assignedRoleId: serviceA.id, epicId: "EP-001" })).toThrow(/archived/);
      expect(() => updateKanbanTask(db, orphan2.id, { actorRoleId: architect.id, epicId: "EP-001" })).toThrow(/archived/);

      // Activity log records the linking changes on epic_id field.
      const activity = listKanbanActivity(db, orphan.id);
      const epicChanges = activity.filter((row) => row.field === "epic_id").map((row) => ({ before: row.before_json, after: row.after_json }));
      // orphan was: link → unlink → re-link → unlink (4 epic_id transitions).
      expect(epicChanges.length).toBe(4);
  } finally {
    await fixture.cleanup();
  }
});

test("kanban epic close-approval lifecycle: pending state, direct complete, approve, cancel", async () => {
  const fixture = await tempKanbanFixture();
  const { db, architect, serviceA } = fixture;
  try {
      const epic = createKanbanEpic(db, { title: "Close-approval target", createdByRoleId: architect.id, assignedRoleId: serviceA.id });
      const child1 = createKanbanTask(db, { title: "Child 1", createdByRoleId: architect.id, assignedRoleId: serviceA.id, epicId: epic.id });
      const child2 = createKanbanTask(db, { title: "Child 2", createdByRoleId: architect.id, assignedRoleId: serviceA.id, epicId: epic.id });

      // open-children count and listing.
      expect(countOpenKanbanEpicChildren(db, epic.id)).toBe(2);
      expect(listOpenKanbanEpicChildren(db, epic.id).map((c) => c.display_id).sort()).toEqual([child1.display_id, child2.display_id].sort());

      // setKanbanEpicStatus to a non-Completed value: simple flip + activity entry.
      const inProgress = setKanbanEpicStatus(db, epic.id, "In Progress", architect.id, null);
      expect(inProgress.status).toBe("In Progress");
      const activity1 = listKanbanEpicActivity(db, epic.id);
      expect(activity1.some((row) => row.field === "status" && row.after_json === JSON.stringify("In Progress"))).toBe(true);

      // setKanbanEpicCloseApprovalPending: flips columns + activity row.
      const pending = setKanbanEpicCloseApprovalPending(db, epic.id, architect.id, null);
      expect(pending.close_approval_status).toBe("pending");
      expect(pending.close_approval_requested_by_role_id).toBe(architect.id);
      expect(pending.close_approval_requested_by_role_name).toBe("repo:architect");
      expect(pending.status).toBe("In Progress");
      const activity2 = listKanbanEpicActivity(db, epic.id);
      expect(activity2.some((row) => row.action === "close_approval_requested")).toBe(true);

      // clearKanbanEpicCloseApproval resets state + activity row.
      const cancelled = clearKanbanEpicCloseApproval(db, epic.id, serviceA.id, null);
      expect(cancelled.close_approval_status).toBe("none");
      expect(cancelled.close_approval_requested_at).toBeNull();
      const activity3 = listKanbanEpicActivity(db, epic.id);
      expect(activity3.some((row) => row.action === "close_approval_cancelled")).toBe(true);

      // No-op cancel returns unchanged when not pending.
      const noop = clearKanbanEpicCloseApproval(db, epic.id, serviceA.id, null);
      expect(noop.close_approval_status).toBe("none");

      // Re-enter pending, then completeKanbanEpicWithApproval flips both status + close_approval_status.
      setKanbanEpicCloseApprovalPending(db, epic.id, architect.id, null);
      const approved = completeKanbanEpicWithApproval(db, epic.id, "human-web", architect.id, null);
      expect(approved.close_approval_status).toBe("approved");
      expect(approved.close_approval_approved_by).toBe("human-web");
      expect(approved.status).toBe("Completed");
      expect(approved.completed_at).not.toBeNull();
      const activity4 = listKanbanEpicActivity(db, epic.id);
      expect(activity4.some((row) => row.action === "close_approved")).toBe(true);
  } finally {
    await fixture.cleanup();
  }
});
