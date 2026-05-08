import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAuthUser, createSession, createSessionCsrfToken } from "../src/auth-dao.ts";
import { hashPassword } from "../src/auth-hash.ts";
import { AUTH_COOKIE_NAME, CSRF_HEADER_NAME, hashSessionToken } from "../src/auth-session.ts";
import { getDaemonRuntimeSettings, migrateDaemonDb, openDaemonDb, setCurrentWorkspaceId, setDaemonRuntimeSettings } from "../src/daemon-db.ts";
import { addKanbanComment, addKanbanEpicComment, archiveKanbanTask, createKanbanEpic, createKanbanTask, getRoleByName, insertAgentSessionCredential, insertLaunchToken, insertMessage, postChannelMessage } from "../src/db.ts";
import { createClaudeToolHandlers } from "../src/integrations/claude-mcp.ts";
import { hashLaunchToken } from "../src/integrations/launch-token.ts";
import { daemonHomePaths } from "../src/paths.ts";
import { startDaemon, type StartedDaemon } from "../src/server/daemon.ts";
import { seedTestWorkspace, tmpRepoDir } from "./helpers/seed-workspace.ts";

let home: string;
let repoPath: string;
let workspaceId: string;
let cookie: string;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "wa-search-e2e-"));
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "daemon.toml"), `[ui]\nhost = "127.0.0.1"\nport = 0\n`, "utf8");
  repoPath = await tmpRepoDir();
  const daemonDb = openDaemonDb(daemonHomePaths(home).daemonDbPath);
  try {
    migrateDaemonDb(daemonDb, { daemonHome: home });
    const seeded = await seedTestWorkspace(home, daemonDb, {
      name: "search-e2e",
      repos: [{ absolutePath: repoPath, name: "repo", roles: [{ name: "alpha" }, { name: "beta" }, { name: "gamma" }] }],
    });
    workspaceId = seeded.workspaceId;
    setCurrentWorkspaceId(daemonDb, workspaceId);

    const alpha = getRoleByName(seeded.workspaceDb, "alpha")!;
    const beta = getRoleByName(seeded.workspaceDb, "beta")!;
    const gamma = getRoleByName(seeded.workspaceDb, "gamma")!;
    insertMessage(seeded.workspaceDb, { threadId: "alpha-beta", fromRoleId: alpha.id, toRoleId: beta.id, fromSessionId: null, toSessionId: null, body: "private mouse evidence", state: "pending" });
    insertMessage(seeded.workspaceDb, { threadId: "beta-gamma", fromRoleId: beta.id, toRoleId: gamma.id, fromSessionId: null, toSessionId: null, body: "private mouse control", state: "pending" });
    postChannelMessage(seeded.workspaceDb, { fromRoleId: beta.id, fromSessionId: null, body: "shared channel mouse evidence" });
    const task = createKanbanTask(seeded.workspaceDb, { title: "Task mouse evidence", details: "WA-071 display token", createdByRoleId: alpha.id, assignedRoleId: beta.id });
    addKanbanComment(seeded.workspaceDb, task.id, { roleId: beta.id, type: "progress", body: "comment mousedown evidence" });
    const archived = createKanbanTask(seeded.workspaceDb, { title: "Archived mouse task", createdByRoleId: alpha.id, assignedRoleId: beta.id });
    archiveKanbanTask(seeded.workspaceDb, archived.display_id, alpha.id);
    const epic = createKanbanEpic(seeded.workspaceDb, { title: "Epic mouse evidence", createdByRoleId: alpha.id, assignedRoleId: beta.id });
    addKanbanEpicComment(seeded.workspaceDb, epic.id, { roleId: beta.id, type: "progress", body: "epic comment mouse evidence" });
    seeded.workspaceDb.close();

    const runtime = getDaemonRuntimeSettings(daemonDb);
    setDaemonRuntimeSettings(daemonDb, {
      ...runtime,
      commands: { ...runtime.commands, claudeCode: { command: "sh", args: ["-c", "while :; do sleep 1; done"], enabled: true } },
    });
    const token = "search-e2e-session";
    const user = createAuthUser(daemonDb, { username: "ivan", passwordHash: await hashPassword("correct-password") });
    const session = createSession(daemonDb, { userId: user.id, tokenHash: hashSessionToken(token), ttlMs: 60_000, userAgent: "WA Search E2E Test" });
    createSessionCsrfToken(daemonDb, session.id, token);
    cookie = `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`;
  } finally {
    daemonDb.close();
  }
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(repoPath, { recursive: true, force: true });
});

async function withDaemon(fn: (daemon: StartedDaemon) => Promise<void>): Promise<void> {
  const daemon = await startDaemon({ daemonHome: home, port: 0, consoleLogs: false });
  try {
    await fn(daemon);
  } finally {
    daemon.stop();
  }
}

async function waitForRunner(daemon: StartedDaemon, role: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const runners = await fetch(`${daemon.url}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/runners`, { headers: { Cookie: cookie } }).then((r) => r.json()) as Array<{ role: string; reachable: boolean }>;
    if (runners.some((runner) => runner.role === role && runner.reachable)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`runner did not become reachable: ${role}`);
}

async function launchAgent(daemon: StartedDaemon, role: string, token: string): Promise<string> {
  const launch = await fetch(`${daemon.url}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/roles-by-id/${encodeURIComponent(`repo:${role}`)}/launch`, { method: "POST", headers: { Cookie: cookie, [CSRF_HEADER_NAME]: "search-e2e-session" } });
  expect(launch.status).toBe(200);
  const body = await launch.json() as { runner: { session_id: string } };
  await waitForRunner(daemon, role);
  const ws = daemon.state.workspaces.get(workspaceId)!;
  const agent = getRoleByName(ws.db, role)!;
  const tokenId = `search-e2e-${role}-${body.runner.session_id}`;
  insertLaunchToken(ws.db, {
    id: tokenId,
    roleId: agent.id,
    sessionId: body.runner.session_id,
    tokenHash: hashLaunchToken(`${token}-bootstrap-placeholder`),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  insertAgentSessionCredential(ws.db, {
    id: `${tokenId}-session`,
    roleId: agent.id,
    sessionId: body.runner.session_id,
    credentialHash: hashLaunchToken(token),
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    launchTokenId: tokenId,
  });
  return body.runner.session_id;
}

describe("WA-113 agent search E2E", () => {
  test("Claude MCP handlers search direct, channel, task, and epic surfaces through the daemon", async () => {
    await withDaemon(async (daemon) => {
      const sessionId = await launchAgent(daemon, "alpha", "alpha-search-e2e-token");
      const handlers = createClaudeToolHandlers({ workspaceId, fleetRoot: repoPath, role: "alpha", sessionId, daemonUrl: daemon.url, launchToken: "alpha-search-e2e-token" });

      const direct = await handlers.search_direct_messages({ q: "mouse" }) as Array<{ bodyPreview: string }>;
      expect(direct.map((row) => row.bodyPreview)).toEqual(["private mouse evidence"]);

      const channel = await handlers.search_channel_messages({ q: "mouse", sender: "repo:beta" }) as Array<{ bodyPreview: string }>;
      expect(channel.map((row) => row.bodyPreview)).toEqual(["shared channel mouse evidence"]);

      const taskComment = await handlers.search_kanban_tasks({ q: "mousedown" }) as Array<{ displayId: string; matchedIn: string[] }>;
      expect(taskComment[0]?.matchedIn).toContain("comments");
      const archivedDefault = await handlers.search_kanban_tasks({ q: "Archived" }) as unknown[];
      expect(archivedDefault).toHaveLength(0);
      const archivedIncluded = await handlers.search_kanban_tasks({ q: "Archived", includeArchived: true }) as Array<{ title: string }>;
      expect(archivedIncluded[0]?.title).toBe("Archived mouse task");

      const epic = await handlers.search_kanban_epics({ q: "epic" }) as Array<{ displayId: string; matchedIn: string[] }>;
      expect(epic[0]?.displayId).toBe("EP-001");
      expect(epic[0]?.matchedIn).toContain("title");
    });
  });
});
