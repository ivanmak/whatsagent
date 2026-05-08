import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createAuthUser, createSession, createSessionCsrfToken } from "../src/auth-dao.ts";
import { AUTH_COOKIE_NAME, CSRF_HEADER_NAME, hashSessionToken } from "../src/auth-session.ts";
import { getDaemonRuntimeSettings, migrateDaemonDb, openDaemonDb, setCurrentWorkspaceId, setDaemonRuntimeSettings } from "../src/daemon-db.ts";
import { addKanbanComment, createKanbanEpic, createKanbanTask, getRoleByName, insertAgentSessionCredential, insertLaunchToken, insertMessage, postChannelMessage } from "../src/db.ts";
import { hashPassword } from "../src/auth-hash.ts";
import { hashLaunchToken } from "../src/integrations/launch-token.ts";
import { daemonHomePaths } from "../src/paths.ts";
import { startDaemon, type StartedDaemon } from "../src/server/daemon.ts";
import { seedTestWorkspace, tmpRepoDir } from "./helpers/seed-workspace.ts";
import { getRbacRoleByName, setAgentRoles } from "../src/rbac-dao.ts";

let home: string;
let repoPath: string;
let cookie: string;
let workspaceId: string;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "wa-search-web-"));
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "daemon.toml"), `[ui]\nhost = "127.0.0.1"\nport = 0\n`, "utf8");
  repoPath = await tmpRepoDir();
  const daemonDb = openDaemonDb(daemonHomePaths(home).daemonDbPath);
  try {
    migrateDaemonDb(daemonDb, { daemonHome: home });
    const seeded = await seedTestWorkspace(home, daemonDb, {
      name: "search-web",
      repos: [{ absolutePath: repoPath, name: "repo", roles: [{ name: "alpha" }, { name: "beta" }, { name: "gamma" }] }],
    });
    workspaceId = seeded.workspaceId;
    setCurrentWorkspaceId(daemonDb, workspaceId);
    const alpha = getRoleByName(seeded.workspaceDb, "alpha")!;
    const beta = getRoleByName(seeded.workspaceDb, "beta")!;
    const gamma = getRoleByName(seeded.workspaceDb, "gamma")!;
    const restricted = getRbacRoleByName(seeded.workspaceDb, "restricted")!;
    setAgentRoles(seeded.workspaceDb, gamma.id, [restricted.id]);
    insertMessage(seeded.workspaceDb, { threadId: "alpha-beta", fromRoleId: alpha.id, toRoleId: beta.id, fromSessionId: null, toSessionId: null, body: "owner global mouse evidence", state: "pending" });
    insertMessage(seeded.workspaceDb, { threadId: "beta-gamma", fromRoleId: beta.id, toRoleId: gamma.id, fromSessionId: null, toSessionId: null, body: "owner global mouse control", state: "pending" });
    postChannelMessage(seeded.workspaceDb, { fromRoleId: alpha.id, fromSessionId: null, body: "channel mouse evidence" });
    const task = createKanbanTask(seeded.workspaceDb, { title: "Task mouse evidence", createdByRoleId: alpha.id, assignedRoleId: beta.id });
    addKanbanComment(seeded.workspaceDb, task.id, { roleId: beta.id, type: "progress", body: "comment mouse evidence" });
    createKanbanEpic(seeded.workspaceDb, { title: "Epic mouse evidence", createdByRoleId: alpha.id, assignedRoleId: beta.id });
    seeded.workspaceDb.close();

    const token = "search-web-session";
    const user = createAuthUser(daemonDb, { username: "ivan", passwordHash: await hashPassword("correct-password") });
    const session = createSession(daemonDb, { userId: user.id, tokenHash: hashSessionToken(token), ttlMs: 60_000, userAgent: "WA Search Test" });
    createSessionCsrfToken(daemonDb, session.id, token);
    cookie = `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`;
    const runtime = getDaemonRuntimeSettings(daemonDb);
    setDaemonRuntimeSettings(daemonDb, {
      ...runtime,
      commands: {
        ...runtime.commands,
        claudeCode: { command: "sh", args: ["-c", "while :; do sleep 1; done"], enabled: true },
      },
    });
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
  const launch = await fetch(`${daemon.url}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/roles-by-id/${encodeURIComponent(`repo:${role}`)}/launch`, {
    method: "POST",
    headers: { Cookie: cookie, [CSRF_HEADER_NAME]: "search-web-session" },
  });
  expect(launch.status).toBe(200);
  const body = await launch.json() as { runner: { session_id: string } };
  await waitForRunner(daemon, role);
  const ws = daemon.state.workspaces.get(workspaceId)!;
  const agent = getRoleByName(ws.db, role)!;
  const tokenId = `search-route-${role}-${body.runner.session_id}`;
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

describe("WA-111 web search routes", () => {
  test("search endpoints require a web cookie", async () => {
    await withDaemon(async (daemon) => {
      const res = await fetch(`${daemon.url}/api/v1/search/direct-messages?q=mouse`);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: "auth_required" });
    });
  });

  test("direct-message search supports owner-global and agent-scoped mode envelopes", async () => {
    await withDaemon(async (daemon) => {
      const global = await fetch(`${daemon.url}/api/v1/search/direct-messages?q=mouse`, { headers: { Cookie: cookie } });
      expect(global.status).toBe(200);
      const globalBody = await global.json() as { mode: string; results: Array<{ bodyPreview: string }> };
      expect(globalBody.mode).toBe("owner-equivalent");
      expect(globalBody.results.map((row) => row.bodyPreview).sort()).toEqual(["owner global mouse control", "owner global mouse evidence"]);

      const scoped = await fetch(`${daemon.url}/api/v1/search/direct-messages?q=mouse&scope=agent&agentId=repo:alpha`, { headers: { Cookie: cookie } });
      expect(scoped.status).toBe(200);
      const scopedBody = await scoped.json() as { mode: string; results: Array<{ bodyPreview: string }> };
      expect(scopedBody.mode).toBe("agent-scoped");
      expect(scopedBody.results.map((row) => row.bodyPreview)).toEqual(["owner global mouse evidence"]);
    });
  });

  test("channel, task, and epic web search endpoints return matching rows", async () => {
    await withDaemon(async (daemon) => {
      const channel = await fetch(`${daemon.url}/api/v1/search/channel-messages?q=mouse&sender=repo:alpha`, { headers: { Cookie: cookie } });
      expect(channel.status).toBe(200);
      expect((await channel.json() as { results: unknown[] }).results).toHaveLength(1);

      const tasks = await fetch(`${daemon.url}/api/v1/search/kanban-tasks?q=comment`, { headers: { Cookie: cookie } });
      expect(tasks.status).toBe(200);
      expect((await tasks.json() as { results: Array<{ matchedIn: string[] }> }).results[0]?.matchedIn).toContain("comments");

      const epics = await fetch(`${daemon.url}/api/v1/search/kanban-epics?q=epic`, { headers: { Cookie: cookie } });
      expect(epics.status).toBe(200);
      expect((await epics.json() as { results: Array<{ displayId: string }> }).results[0]?.displayId).toBe("EP-001");
    });
  });

  test("kanban web search endpoints return 400 for invalid status", async () => {
    await withDaemon(async (daemon) => {
      const tasks = await fetch(`${daemon.url}/api/v1/search/kanban-tasks?q=mouse&status=bogus`, { headers: { Cookie: cookie } });
      expect(tasks.status).toBe(400);

      const epics = await fetch(`${daemon.url}/api/v1/search/kanban-epics?q=mouse&status=bogus`, { headers: { Cookie: cookie } });
      expect(epics.status).toBe(400);
    });
  });

  test("agent search route returns results for granted caller and rbac_denied without family", async () => {
    await withDaemon(async (daemon) => {
      const alphaSession = await launchAgent(daemon, "alpha", "alpha-search-token");
      const ok = await fetch(`${daemon.url}/api/v1/agent/search-direct-messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, role: "alpha", sessionId: alphaSession, token: "alpha-search-token", q: "mouse" }),
      });
      expect(ok.status).toBe(200);
      expect((await ok.json() as { results: Array<{ bodyPreview: string }> }).results.map((row) => row.bodyPreview)).toEqual(["owner global mouse evidence"]);

      const gammaSession = await launchAgent(daemon, "gamma", "gamma-search-token");
      const denied = await fetch(`${daemon.url}/api/v1/agent/search-direct-messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, role: "gamma", sessionId: gammaSession, token: "gamma-search-token", q: "mouse" }),
      });
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ error: "rbac_denied", tool: "search-direct-messages" });
    });
  });
});
