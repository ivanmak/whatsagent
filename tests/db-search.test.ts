import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";

import { seedTestWorkspace, tmpDaemonHome, tmpRepoDir, type TestDaemonHome } from "./helpers/seed-workspace.ts";
import {
  addKanbanComment,
  addKanbanEpicComment,
  archiveKanbanEpic,
  archiveKanbanTask,
  clearChatHistory,
  createKanbanEpic,
  createKanbanTask,
  getRoleByName,
  insertMessage,
  migrate,
  postChannelMessage,
  pruneChatHistoryBefore,
  searchChannelMessages,
  searchDirectMessages,
  searchKanbanEpics,
  searchKanbanTasks,
  type AgentRow,
} from "../src/db.ts";
import { KANBAN_EFFORT_ORDINAL } from "../src/kanban-effort.ts";

function ftsCount(table: string, rowid?: number): number {
  const where = rowid === undefined ? "" : " WHERE rowid = ?";
  return fixture.db.query<{ count: number }, [number] | []>(`SELECT COUNT(*) AS count FROM ${table}${where}`)
    .get(...(rowid === undefined ? [] : [rowid]) as [])?.count ?? 0;
}

interface SearchFixture {
  env: TestDaemonHome;
  repoPath: string;
  db: Awaited<ReturnType<typeof seedTestWorkspace>>["workspaceDb"];
  alpha: AgentRow;
  beta: AgentRow;
  gamma: AgentRow;
}

async function createSearchFixture(): Promise<SearchFixture> {
  const env = await tmpDaemonHome();
  const repoPath = await tmpRepoDir();
  const seeded = await seedTestWorkspace(env.home, env.daemonDb, {
    name: "search-db",
    repos: [{ absolutePath: repoPath, name: "repo", roles: [{ name: "alpha" }, { name: "beta" }, { name: "gamma" }] }],
  });
  const alpha = getRoleByName(seeded.workspaceDb, "alpha");
  const beta = getRoleByName(seeded.workspaceDb, "beta");
  const gamma = getRoleByName(seeded.workspaceDb, "gamma");
  if (!alpha || !beta || !gamma) throw new Error("fixture agents missing");
  return { env, repoPath, db: seeded.workspaceDb, alpha, beta, gamma };
}

let fixture: SearchFixture;

beforeEach(async () => {
  fixture = await createSearchFixture();
});

afterEach(async () => {
  try { fixture.db.close(); } catch { /* already closed */ }
  await fixture.env.cleanup();
  await rm(fixture.repoPath, { recursive: true, force: true });
});

describe("workspace search DB helpers", () => {
  test("Kanban effort ordinal map preserves T-shirt order", () => {
    expect(KANBAN_EFFORT_ORDINAL).toEqual({ XS: 0, S: 1, M: 2, L: 3, XL: 4 });
  });

  test("migration 19 creates FTS5 tables and records schema version", () => {
    const { db } = fixture;
    for (const table of [
      "messages_fts",
      "channel_messages_fts",
      "kanban_tasks_fts",
      "kanban_epics_fts",
      "kanban_comments_fts",
      "kanban_epic_comments_fts",
    ]) {
      const row = db.query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      ).get(table);
      expect(row?.name).toBe(table);
    }
    const version = db.query<{ version: number }, []>(
      "SELECT version FROM schema_migrations WHERE version = 19",
    ).get();
    expect(version?.version).toBe(19);

    expect(() => migrate(db)).not.toThrow();
  });

  test("migration 19 backfills existing rows when upgrading a pre-v19 database", async () => {
    const old = fixture;
    try { old.db.close(); } catch { /* replaced by this test */ }
    await old.env.cleanup();
    await rm(old.repoPath, { recursive: true, force: true });

    const env = await tmpDaemonHome();
    const repoPath = await tmpRepoDir();
    const seeded = await seedTestWorkspace(env.home, env.daemonDb, {
      name: "search-db-backfill",
      repos: [{ absolutePath: repoPath, name: "repo", roles: [{ name: "alpha" }, { name: "beta" }] }],
    });
    fixture = { env, repoPath, db: seeded.workspaceDb, alpha: getRoleByName(seeded.workspaceDb, "alpha")!, beta: getRoleByName(seeded.workspaceDb, "beta")!, gamma: getRoleByName(seeded.workspaceDb, "beta")! };
    const { db, alpha, beta } = fixture;

    for (const trigger of [
      "messages_ai", "messages_ad", "messages_au",
      "channel_messages_ai", "channel_messages_ad", "channel_messages_au",
      "kanban_tasks_ai", "kanban_tasks_ad", "kanban_tasks_au",
      "kanban_epics_ai", "kanban_epics_ad", "kanban_epics_au",
      "kanban_comments_ai", "kanban_comments_ad", "kanban_comments_au",
      "kanban_epic_comments_ai", "kanban_epic_comments_ad", "kanban_epic_comments_au",
    ]) db.run(`DROP TRIGGER ${trigger}`);
    for (const table of [
      "messages_fts",
      "channel_messages_fts",
      "kanban_tasks_fts",
      "kanban_epics_fts",
      "kanban_comments_fts",
      "kanban_epic_comments_fts",
    ]) db.run(`DROP TABLE ${table}`);
    db.run("DELETE FROM schema_migrations WHERE version = 19");
    insertMessage(db, {
      threadId: "pre-v19",
      fromRoleId: alpha.id,
      toRoleId: beta.id,
      fromSessionId: null,
      toSessionId: null,
      body: "preexisting backfill mouse evidence",
      state: "pending",
    });

    migrate(db);

    expect(searchDirectMessages(db, { callerRoleId: alpha.id, q: "backfill", limit: 20 })[0]?.bodyPreview).toBe("preexisting backfill mouse evidence");
  });

  test("searchDirectMessages scopes results to the caller and supports sender filtering", () => {
    const { db, alpha, beta, gamma } = fixture;
    insertMessage(db, {
      threadId: "alpha-beta",
      fromRoleId: alpha.id,
      toRoleId: beta.id,
      fromSessionId: null,
      toSessionId: null,
      body: "Mouse wheel selector evidence lives here.",
      state: "pending",
    });
    insertMessage(db, {
      threadId: "beta-gamma",
      fromRoleId: beta.id,
      toRoleId: gamma.id,
      fromSessionId: null,
      toSessionId: null,
      body: "Mouse wheel selector private control.",
      state: "pending",
    });

    const alphaResults = searchDirectMessages(db, { callerRoleId: alpha.id, q: "mouse", limit: 20 });
    expect(alphaResults.map((row) => row.bodyPreview)).toEqual(["Mouse wheel selector evidence lives here."]);

    const betaFromGamma = searchDirectMessages(db, {
      callerRoleId: beta.id,
      senderRoleId: gamma.id,
      q: "mouse",
      limit: 20,
    });
    expect(betaFromGamma).toHaveLength(0);
  });

  test("searchChannelMessages finds channel posts and narrows by sender", () => {
    const { db, alpha, beta } = fixture;
    postChannelMessage(db, { fromRoleId: alpha.id, fromSessionId: null, body: "EP-023 diagnostics mouse evidence" });
    postChannelMessage(db, { fromRoleId: beta.id, fromSessionId: null, body: "EP-023 unrelated control" });

    const results = searchChannelMessages(db, { q: "mouse", limit: 20 });
    expect(results.map((row) => row.from?.displayId)).toEqual(["repo:alpha"]);

    const filtered = searchChannelMessages(db, { senderRoleId: beta.id, q: "mouse", limit: 20 });
    expect(filtered).toEqual([]);
  });

  test("searchKanbanTasks matches display id, title/details, comments, and archived opt-in", () => {
    const { db, alpha, beta } = fixture;
    const task = createKanbanTask(db, {
      title: "Fix mouse wheel remount",
      details: "WA-071 xterm selector regression",
      createdByRoleId: alpha.id,
      assignedRoleId: beta.id,
    });
    addKanbanComment(db, task.id, { roleId: beta.id, type: "progress", body: "mousedown capture verified" });
    const archived = createKanbanTask(db, {
      title: "Archived mouse note",
      createdByRoleId: alpha.id,
      assignedRoleId: beta.id,
    });
    archiveKanbanTask(db, archived.display_id, alpha.id);

    expect(searchKanbanTasks(db, { q: "WA-001", includeArchived: false, limit: 20 })[0]?.displayId).toBe(task.display_id);
    expect(searchKanbanTasks(db, { q: "mou", includeArchived: false, limit: 20 })[0]?.displayId).toBe(task.display_id);
    expect(searchKanbanTasks(db, { q: "mousedown", includeArchived: false, limit: 20 })[0]?.matchedIn).toContain("comments");
    expect(searchKanbanTasks(db, { q: "archived", includeArchived: false, limit: 20 })).toEqual([]);
    expect(searchKanbanTasks(db, { q: "archived", includeArchived: true, limit: 20 })[0]?.displayId).toBe(archived.display_id);
  });

  test("searchKanbanEpics matches epic fields and comments with archived opt-in", () => {
    const { db, alpha, beta } = fixture;
    const epic = createKanbanEpic(db, {
      title: "Search MCP tools",
      details: "EP-024 direct channel kanban search",
      createdByRoleId: alpha.id,
      assignedRoleId: beta.id,
    });
    addKanbanEpicComment(db, epic.id, { roleId: beta.id, type: "note", body: "diacritics résumé coverage" });
    const archived = createKanbanEpic(db, {
      title: "Archived search epic",
      createdByRoleId: alpha.id,
      assignedRoleId: beta.id,
    });
    archiveKanbanEpic(db, archived.display_id, alpha.id);

    expect(searchKanbanEpics(db, { q: "EP-001", includeArchived: false, limit: 20 })[0]?.displayId).toBe(epic.display_id);
    expect(searchKanbanEpics(db, { q: "resume", includeArchived: false, limit: 20 })[0]?.matchedIn).toContain("comments");
    expect(searchKanbanEpics(db, { q: "archived", includeArchived: false, limit: 20 })).toEqual([]);
    expect(searchKanbanEpics(db, { q: "archived", includeArchived: true, limit: 20 })[0]?.displayId).toBe(archived.display_id);
  });

  test("FTS5 special characters are treated as literal query text", () => {
    const { db, alpha, beta } = fixture;
    const cases: Array<{ q: string; body: string; expected?: string; expectMatch?: boolean }> = [
      { q: "AND", body: "AND literal operator" },
      { q: "NOT", body: "NOT literal operator" },
      { q: "OR", body: "OR literal operator" },
      { q: "(test)", body: "parenthesized test literal", expected: "parenthesized test literal" },
      { q: "a-b", body: "a-b dash token" },
      { q: "wa_test_id", body: "wa_test_id underscore token" },
      { q: "a:b", body: "a:b colon token" },
      { q: "cafe", body: "café diacritic token", expected: "café diacritic token" },
      { q: "\"", body: "single quote mark \" token", expectMatch: false },
    ];

    for (const item of cases) {
      insertMessage(db, {
        threadId: `special-${item.q}`,
        fromRoleId: alpha.id,
        toRoleId: beta.id,
        fromSessionId: null,
        toSessionId: null,
        body: item.body,
        state: "pending",
      });
      expect(() => searchDirectMessages(db, { callerRoleId: alpha.id, q: item.q, limit: 20 })).not.toThrow();
      const previews = searchDirectMessages(db, { callerRoleId: alpha.id, q: item.q, limit: 20 }).map((row) => row.bodyPreview);
      if (item.expectMatch === false) expect(previews).toEqual([]);
      else expect(previews).toContain(item.expected ?? item.body);
    }

    expect(() => searchDirectMessages(db, { callerRoleId: alpha.id, q: "   ", limit: 20 })).toThrow("empty_query");
    expect(searchDirectMessages(db, { callerRoleId: alpha.id, q: "'; DROP TABLE messages;--", limit: 20 })).toEqual([]);
    expect(db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM messages").get()?.count).toBe(cases.length);
  });

  test("FTS triggers track message update, delete, and retention prune", () => {
    const { db, alpha, beta } = fixture;
    const direct = insertMessage(db, {
      threadId: "sync-direct",
      fromRoleId: alpha.id,
      toRoleId: beta.id,
      fromSessionId: null,
      toSessionId: null,
      body: "oldmouse direct evidence",
      state: "pending",
    });
    const channel = postChannelMessage(db, { fromRoleId: alpha.id, fromSessionId: null, body: "oldmouse channel evidence" });

    db.run("UPDATE messages SET body = ? WHERE id = ?", ["newmouse direct evidence", direct.id]);
    expect(searchDirectMessages(db, { callerRoleId: alpha.id, q: "oldmouse", limit: 20 })).toEqual([]);
    expect(searchDirectMessages(db, { callerRoleId: alpha.id, q: "newmouse", limit: 20 })).toHaveLength(1);

    db.run("DELETE FROM messages WHERE id = ?", [direct.id]);
    expect(searchDirectMessages(db, { callerRoleId: alpha.id, q: "newmouse", limit: 20 })).toEqual([]);
    expect(ftsCount("messages_fts")).toBe(0);

    db.run("UPDATE channel_messages SET sent_at = ? WHERE id = ?", ["2000-01-01T00:00:00.000Z", channel.id]);
    expect(searchChannelMessages(db, { q: "oldmouse", limit: 20 })).toHaveLength(1);
    pruneChatHistoryBefore(db, "2001-01-01T00:00:00.000Z");
    expect(searchChannelMessages(db, { q: "oldmouse", limit: 20 })).toEqual([]);
    expect(ftsCount("channel_messages_fts")).toBe(0);

    insertMessage(db, {
      threadId: "clear-direct",
      fromRoleId: alpha.id,
      toRoleId: beta.id,
      fromSessionId: null,
      toSessionId: null,
      body: "clearable direct evidence",
      state: "pending",
    });
    postChannelMessage(db, { fromRoleId: alpha.id, fromSessionId: null, body: "clearable channel evidence" });
    expect(ftsCount("messages_fts")).toBe(1);
    expect(ftsCount("channel_messages_fts")).toBe(1);
    clearChatHistory(db);
    expect(ftsCount("messages_fts")).toBe(0);
    expect(ftsCount("channel_messages_fts")).toBe(0);
  });

  test("FTS triggers track kanban field and comment updates and deletes", () => {
    const { db, alpha, beta } = fixture;
    const task = createKanbanTask(db, {
      title: "Old task trigger title",
      createdByRoleId: alpha.id,
      assignedRoleId: beta.id,
    });
    db.run("UPDATE kanban_tasks SET title = ? WHERE id = ?", ["New task trigger title", task.id]);
    expect(searchKanbanTasks(db, { q: "old task", includeArchived: true, limit: 20 })).toEqual([]);
    expect(searchKanbanTasks(db, { q: "new task", includeArchived: true, limit: 20 })[0]?.displayId).toBe(task.display_id);
    db.run("DELETE FROM kanban_tasks WHERE id = ?", [task.id]);
    expect(searchKanbanTasks(db, { q: "new task", includeArchived: true, limit: 20 })).toEqual([]);
    expect(ftsCount("kanban_tasks_fts", task.id)).toBe(0);

    const epic = createKanbanEpic(db, {
      title: "Old epic trigger title",
      createdByRoleId: alpha.id,
      assignedRoleId: beta.id,
    });
    db.run("UPDATE kanban_epics SET title = ? WHERE id = ?", ["New epic trigger title", epic.id]);
    expect(searchKanbanEpics(db, { q: "old epic", includeArchived: true, limit: 20 })).toEqual([]);
    expect(searchKanbanEpics(db, { q: "new epic", includeArchived: true, limit: 20 })[0]?.displayId).toBe(epic.display_id);
    db.run("DELETE FROM kanban_epics WHERE id = ?", [epic.id]);
    expect(searchKanbanEpics(db, { q: "new epic", includeArchived: true, limit: 20 })).toEqual([]);
    expect(ftsCount("kanban_epics_fts", epic.id)).toBe(0);

    const commentTask = createKanbanTask(db, {
      title: "Task comment host",
      createdByRoleId: alpha.id,
      assignedRoleId: beta.id,
    });
    const comment = addKanbanComment(db, commentTask.id, { roleId: beta.id, type: "progress", body: "old task comment trigger" });
    db.run("UPDATE kanban_comments SET body = ? WHERE id = ?", ["new task comment trigger", comment.id]);
    expect(searchKanbanTasks(db, { q: "old task comment", includeArchived: true, limit: 20 })).toEqual([]);
    expect(searchKanbanTasks(db, { q: "new task comment", includeArchived: true, limit: 20 })[0]?.matchedIn).toContain("comments");
    db.run("DELETE FROM kanban_comments WHERE id = ?", [comment.id]);
    expect(searchKanbanTasks(db, { q: "new task comment", includeArchived: true, limit: 20 })).toEqual([]);
    expect(ftsCount("kanban_comments_fts", comment.id)).toBe(0);

    const commentEpic = createKanbanEpic(db, {
      title: "Epic comment host",
      createdByRoleId: alpha.id,
      assignedRoleId: beta.id,
    });
    const epicComment = addKanbanEpicComment(db, commentEpic.id, { roleId: beta.id, type: "note", body: "old epic comment trigger" });
    db.run("UPDATE kanban_epic_comments SET body = ? WHERE id = ?", ["new epic comment trigger", epicComment.id]);
    expect(searchKanbanEpics(db, { q: "old epic comment", includeArchived: true, limit: 20 })).toEqual([]);
    expect(searchKanbanEpics(db, { q: "new epic comment", includeArchived: true, limit: 20 })[0]?.matchedIn).toContain("comments");
    db.run("DELETE FROM kanban_epic_comments WHERE id = ?", [epicComment.id]);
    expect(searchKanbanEpics(db, { q: "new epic comment", includeArchived: true, limit: 20 })).toEqual([]);
    expect(ftsCount("kanban_epic_comments_fts", epicComment.id)).toBe(0);
  });
});
