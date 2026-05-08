#!/usr/bin/env bun
// Lifecycle smoke test for WhatsAgent.
// Boots a daemon against a temp daemon-home with fake runners and walks the
// major API paths end-to-end. Intended as the pre-merge regression gate.
//
// Run with: bun scripts/smoke.ts
// Exit code: 0 on success, 1 on any failure.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAuthUser, createSession, createSessionCsrfToken } from "../src/auth-dao.ts";
import { AUTH_COOKIE_NAME, CSRF_HEADER_NAME, hashSessionToken } from "../src/auth-session.ts";
import {
  getDaemonRuntimeSettings,
  migrateDaemonDb,
  openDaemonDb,
  setDaemonRuntimeSettings,
} from "../src/daemon-db.ts";
import {
  getRoleByName,
  insertAgentSessionCredential,
  insertLaunchToken,
  migrate,
  openFleetDb,
  type RuntimeCommands,
} from "../src/db.ts";
import { hashLaunchToken } from "../src/integrations/launch-token.ts";
import { activeWorkspacePaths, daemonHomePaths } from "../src/paths.ts";
import { startDaemon, type StartedDaemon } from "../src/server/daemon.ts";

interface StepResult {
  name: string;
  ok: boolean;
  detail?: string;
  ms: number;
}

const results: StepResult[] = [];
const SMOKE_AUTH_TOKEN = "whatsagent-smoke-session-token";
const SMOKE_AUTH_COOKIE = `${AUTH_COOKIE_NAME}=${encodeURIComponent(SMOKE_AUTH_TOKEN)}`;

async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  process.stdout.write(`  ${name} ... `);
  try {
    const value = await fn();
    const ms = Date.now() - started;
    results.push({ name, ok: true, ms });
    console.log(`ok (${ms}ms)`);
    return value;
  } catch (e) {
    const ms = Date.now() - started;
    const detail = e instanceof Error ? e.message : String(e);
    results.push({ name, ok: false, detail, ms });
    console.log(`FAIL (${ms}ms): ${detail}`);
    throw e;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function preSeedFakeRuntimes(daemonHome: string): void {
  // Point every host runtime at a non-existent binary so launchRunner falls
  // back to the placeholder fake runner. Avoids needing claude/opencode/codex
  // installed for the smoke run. Done BEFORE the daemon boots so
  // probeAllRuntimes sees the missing commands at startup.
  const homePaths = daemonHomePaths(daemonHome);
  const db = openDaemonDb(homePaths.daemonDbPath);
  try {
    migrateDaemonDb(db, { daemonHome });
    const runtime = getDaemonRuntimeSettings(db);
    const missing = (key: keyof RuntimeCommands) => ({ command: `whatsagent-smoke-missing-${key}`, args: [] as string[] });
    setDaemonRuntimeSettings(db, {
      ...runtime,
      commands: {
        claudeCode: missing("claudeCode"),
        openCode: missing("openCode"),
        codex: missing("codex"),
      },
    });
    const user = createAuthUser(db, { username: "smoke", passwordHash: "$argon2id$smoke" });
    const session = createSession(db, { userId: user.id, tokenHash: hashSessionToken(SMOKE_AUTH_TOKEN), ttlMs: 24 * 60 * 60 * 1000 });
    createSessionCsrfToken(db, session.id, SMOKE_AUTH_TOKEN);
  } finally {
    db.close();
  }
}

function injectLaunchToken(daemonHome: string, workspaceId: string, roleName: string, sessionId: string, token: string): void {
  const wsPaths = activeWorkspacePaths(daemonHome, workspaceId);
  const db = openFleetDb(wsPaths.dbPath);
  try {
    migrate(db);
    const role = getRoleByName(db, roleName);
    if (!role) throw new Error(`role ${roleName} not found`);
    const id = `smoke-${roleName}-${sessionId}`;
    insertLaunchToken(db, {
      id,
      roleId: role.id,
      sessionId,
      tokenHash: hashLaunchToken(`${token}-bootstrap-placeholder`),
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    });
    insertAgentSessionCredential(db, {
      id: `${id}-session`,
      roleId: role.id,
      sessionId,
      credentialHash: hashLaunchToken(token),
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      launchTokenId: id,
    });
  } finally {
    db.close();
  }
}

async function waitFor<T>(label: string, fn: () => Promise<T | null>, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function postJson(url: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: SMOKE_AUTH_COOKIE, [CSRF_HEADER_NAME]: SMOKE_AUTH_TOKEN },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function putJson(url: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: SMOKE_AUTH_COOKIE, [CSRF_HEADER_NAME]: SMOKE_AUTH_TOKEN },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function getJson(url: string): Promise<{ status: number; json: any }> {
  const res = await fetch(url, { headers: { Cookie: SMOKE_AUTH_COOKIE } });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

interface ActiveRunner {
  role: string;
  session_id: string;
  control_url: string;
  runner_pid: number;
}

async function smoke(): Promise<void> {
  console.log("WhatsAgent lifecycle smoke");
  console.log("");

  const daemonHome = await step("create temp daemon-home", async () => {
    const dir = await mkdtemp(join(tmpdir(), "whatsagent-smoke-home-"));
    preSeedFakeRuntimes(dir);
    return dir;
  });

  const repoDir = await step("create temp repo dir", async () => {
    return await mkdtemp(join(tmpdir(), "whatsagent-smoke-repo-"));
  });

  let daemon: StartedDaemon | null = null;
  try {
    daemon = await step("start daemon on random port", () =>
      startDaemon({ port: 0, consoleLogs: false, daemonHome }),
    );
    const url = daemon.url;

    // Workspace + repo + roles via HTTP API (replaces former initFleet path).
    const wsId = await step("POST /workspaces creates a workspace", async () => {
      // EP-022 / WA-094: workspace create requires explicit rbacMode.
      const { status, json } = await postJson(`${url}/api/v1/workspaces`, { name: "smoke-ws", rbacMode: "enforce" });
      assert(status === 200 && json.ok === true && json.workspace?.id, `create workspace returned ${status}`);
      return json.workspace.id as string;
    });
    const wsBase = `/api/v1/workspaces/${encodeURIComponent(wsId)}`;

    await step("PUT /workspaces/current sets the active workspace", async () => {
      const { status, json } = await putJson(`${url}/api/v1/workspaces/current`, { id: wsId });
      assert(status === 200 && json.ok === true, `set current returned ${status}`);
    });

    const repoId = await step("POST /repos registers smoke repo", async () => {
      const { status, json } = await postJson(`${url}${wsBase}/repos`, { absolutePath: repoDir, name: "smoke" });
      assert(status === 200 && json.ok === true && json.repo?.id, `add repo returned ${status}`);
      return json.repo.id as string;
    });

    await step("POST /roles-by-id (architect)", async () => {
      const { status, json } = await postJson(`${url}${wsBase}/roles-by-id`, { repoId, name: "architect" });
      assert(status === 200 && json.ok === true, `add architect returned ${status}: ${json.error ?? ""}`);
    });

    let serviceAId = "";
    await step("POST /roles-by-id (serviceA)", async () => {
      const { status, json } = await postJson(`${url}${wsBase}/roles-by-id`, { repoId, name: "serviceA" });
      assert(status === 200 && json.ok === true, `add serviceA returned ${status}: ${json.error ?? ""}`);
      serviceAId = String(json.role?.id || "");
      assert(serviceAId.length > 0, `serviceA id missing in response: ${JSON.stringify(json)}`);
    });

    await step("GET /health", async () => {
      const { status, json } = await getJson(`${url}/health`);
      assert(status === 200 && json.ok === true, `health returned ${status}`);
    });

    await step("GET / (HTML shell)", async () => {
      // / 302-redirects to /workspaces/<currentId>/; fetch follows by default.
      const res = await fetch(`${url}/`, { headers: { Cookie: SMOKE_AUTH_COOKIE } });
      const text = await res.text();
      assert(res.status === 200, `/ returned ${res.status}`);
      assert(text.includes("WhatsAgent"), "shell HTML missing brand");
      assert(text.includes("/assets/xterm.js"), "shell HTML missing xterm asset");
    });

    await step("workspace-scoped status has 2 roles", async () => {
      const { status, json } = await getJson(`${url}${wsBase}/status`);
      assert(status === 200, `/status returned ${status}`);
      const roles = (json.roles ?? []) as Array<{ name: string }>;
      assert(roles.length === 2, `expected 2 roles, got ${roles.length}`);
      const names = roles.map((r) => r.name).sort();
      assert(names[0] === "architect" && names[1] === "serviceA", `unexpected roles: ${names.join(",")}`);
    });

    await step("GET workspace settings", async () => {
      const { status, json } = await getJson(`${url}${wsBase}/settings`);
      assert(status === 200 && json.ok === true, `/settings returned ${status}`);
      assert(json.policy?.mode === "star", `expected default star policy, got ${json.policy?.mode}`);
    });

    await step("set main-role architect", async () => {
      const { status, json } = await postJson(`${url}${wsBase}/main-role`, { role: "architect" });
      assert(status === 200 && json.role?.name === "architect", `set main returned ${status}`);
    });

    await step("launch fake runner for serviceA", async () => {
      // EP-DEC-RUN WA-006: legacy `/roles/<name>/<action>` returns 410; use UUID-keyed routes.
      const { status, json } = await postJson(`${url}${wsBase}/roles-by-id/${encodeURIComponent(serviceAId)}/launch`, { host: "claude-code" });
      assert(status === 200 && json.action === "launch", `launch returned ${status} action=${json.action}`);
      assert(json.runner?.mode === "fake", `expected fake runner mode, got ${json.runner?.mode}`);
    });

    const serviceA: ActiveRunner = await step("wait for serviceA runner control_url", () =>
      waitFor("serviceA control_url", async () => {
        const { json } = await getJson(`${url}${wsBase}/runners`);
        const found = (json as Array<any>).find(
          (item) => item.role === "serviceA" && item.reachable && item.control_url,
        );
        return found
          ? { role: found.role, session_id: found.session_id, control_url: found.control_url, runner_pid: found.runner_pid }
          : null;
      }),
    );

    await step("GET runner output shows fake-runner banner", async () => {
      const { status, json } = await getJson(`${url}${wsBase}/roles-by-id/${encodeURIComponent(serviceAId)}/output?cursor=0`);
      assert(status === 200 && Array.isArray(json.events), `output returned ${status}`);
      const text = json.events.map((e: any) => e.data).join("");
      assert(
        text.includes("WhatsAgent runner started for serviceA"),
        "fake-runner banner missing from output",
      );
    });

    await step("attach is idempotent (relaunch returns attach)", async () => {
      const { status, json } = await postJson(`${url}${wsBase}/roles-by-id/${encodeURIComponent(serviceAId)}/launch`, { host: "claude-code" });
      assert(status === 200 && json.action === "attach", `relaunch action=${json.action}`);
      assert(
        json.runner?.runner_pid === serviceA.runner_pid,
        `attach pid mismatch: ${json.runner?.runner_pid} vs ${serviceA.runner_pid}`,
      );
    });

    await step("send web → serviceA direct message", async () => {
      // EP-DEC-RUN WA-006: messages address peers as `<repo>:<role>` (display_id).
      const { status, json } = await postJson(`${url}${wsBase}/messages`, {
        toRole: "smoke:serviceA",
        body: "smoke direct hello",
      });
      assert(status === 200 && json.ok === true, `message send returned ${status}: ${json.error ?? ""}`);
    });

    await step("agent API rejects unknown launch token (401)", async () => {
      const { status } = await postJson(`${url}/api/v1/agent/whoami`, {
        workspaceId: wsId,
        role: "serviceA",
        sessionId: serviceA.session_id,
        token: "wrong-token-not-real",
      });
      assert(status === 401, `expected 401 for bad token, got ${status}`);
    });

    await step("agent API rejects unknown workspaceId (404)", async () => {
      const { status } = await postJson(`${url}/api/v1/agent/whoami`, {
        workspaceId: "not-a-real-workspace",
        role: "serviceA",
        sessionId: serviceA.session_id,
        token: "anything",
      });
      assert(status === 404, `expected 404 for bogus workspace, got ${status}`);
    });

    const serviceAToken = "smoke-serviceA-launch-token-abc";
    await step("inject valid launch token and call agent whoami", async () => {
      injectLaunchToken(daemonHome, wsId, "serviceA", serviceA.session_id, serviceAToken);
      const { status, json } = await postJson(`${url}/api/v1/agent/whoami`, {
        workspaceId: wsId,
        role: "serviceA",
        sessionId: serviceA.session_id,
        token: serviceAToken,
      });
      assert(status === 200 && json.ok === true, `agent whoami returned ${status}`);
      assert(json.role?.name === "serviceA", "wrong role in whoami response");
    });

    await step("agent API: list-peers returns peers (caller excluded)", async () => {
      // EP-022 / WA-098: route renamed `list-roles → list-peers`; reply
      // key `roles → peers`; caller (serviceA) excluded — whoami covers
      // self-introspection. Two agents seeded → one peer visible.
      const { status, json } = await postJson(`${url}/api/v1/agent/list-peers`, {
        workspaceId: wsId,
        role: "serviceA",
        sessionId: serviceA.session_id,
        token: serviceAToken,
      });
      assert(status === 200 && Array.isArray(json.peers), `list-peers returned ${status}`);
      assert(json.peers.length === 1, `expected 1 peer (self excluded), got ${json.peers.length}`);
      assert(json.peers[0]?.name !== "serviceA", "list-peers must exclude the caller");
    });

    await step("agent API: check-messages delivers the queued direct message", async () => {
      const { status, json } = await postJson(`${url}/api/v1/agent/check-messages`, {
        workspaceId: wsId,
        role: "serviceA",
        sessionId: serviceA.session_id,
        token: serviceAToken,
      });
      assert(status === 200 && Array.isArray(json.messages), `check-messages returned ${status}`);
      const text = json.messages.map((m: any) => m.body).join("\n");
      assert(text.includes("smoke direct hello"), "queued direct message not delivered");
    });

    await step("agent API: list-kanban-tasks (empty board)", async () => {
      const { status, json } = await postJson(`${url}/api/v1/agent/list-kanban-tasks`, {
        workspaceId: wsId,
        role: "serviceA",
        sessionId: serviceA.session_id,
        token: serviceAToken,
      });
      assert(status === 200 && Array.isArray(json.tasks), `list-kanban-tasks returned ${status}`);
      assert(json.tasks.length === 0, `expected empty board, got ${json.tasks.length} tasks`);
    });

    await step("policy switch star → peer-to-peer → star", async () => {
      const toPeer = await putJson(`${url}${wsBase}/settings/policy`, { mode: "peer-to-peer" });
      assert(toPeer.status === 200 && toPeer.json.policy?.mode === "peer-to-peer", `switch to peer failed: ${toPeer.status}`);
      const toStar = await putJson(`${url}${wsBase}/settings/policy`, { mode: "star" });
      assert(toStar.status === 200 && toStar.json.policy?.mode === "star", `switch back to star failed: ${toStar.status}`);
    });

    await step("WebSocket terminal handshake delivers fake-runner banner", async () => {
      const wsUrl = `${url.replace(/^http/, "ws")}${wsBase}/roles-by-id/${encodeURIComponent(serviceAId)}/terminal/ws?cursor=0`;
      const socket = new (WebSocket as any)(wsUrl, { headers: { Cookie: SMOKE_AUTH_COOKIE, [CSRF_HEADER_NAME]: SMOKE_AUTH_TOKEN } }) as WebSocket;
      const text = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          try { socket.close(); } catch { /* ignore */ }
          reject(new Error("WS timeout (2s)"));
        }, 2000);
        let acc = "";
        socket.addEventListener("message", (event) => {
          // EP-029 T2: server first frame is `{type:"restore", snapshot, ...}`
          // (mirror canonical), then live `{type:"output", events, ...}`.
          const body = JSON.parse(String((event as MessageEvent).data)) as { type?: string; snapshot?: string; events?: Array<{ data: string }> };
          if (body.type === "restore" && typeof body.snapshot === "string") {
            acc += body.snapshot;
          } else {
            acc += body.events?.map((e) => e.data).join("") ?? "";
          }
          if (acc.includes("WhatsAgent runner started for serviceA")) {
            clearTimeout(timeout);
            try { socket.close(); } catch { /* ignore */ }
            resolve(acc);
          }
        });
        socket.addEventListener("error", () => {
          clearTimeout(timeout);
          reject(new Error("WS error event"));
        });
      });
      assert(
        text.includes("WhatsAgent runner started for serviceA"),
        "WS did not deliver runner banner",
      );
    });

    await step("stop serviceA runner", async () => {
      const { status, json } = await postJson(`${url}${wsBase}/roles-by-id/${encodeURIComponent(serviceAId)}/stop`, {});
      assert(status === 200 && json.action === "stop", `stop returned ${status}`);
    });

    await step("daemon.log contains expected lifecycle events", async () => {
      const log = await readFile(daemonHomePaths(daemonHome).daemonLogPath, "utf8");
      const expected = [
        "daemon.start",
        "daemon.listen",
        "runner.launch_requested",
        "runner.launched",
        "message.sent",
      ];
      for (const marker of expected) {
        assert(log.includes(marker), `daemon.log missing event ${marker}`);
      }
    });
  } finally {
    if (daemon) {
      try { daemon.stop(); } catch { /* ignore */ }
    }
    if (process.env.SMOKE_KEEP) {
      console.log(`(SMOKE_KEEP set; preserving ${daemonHome} + ${repoDir})`);
    } else {
      await rm(daemonHome, { recursive: true, force: true }).catch(() => undefined);
      await rm(repoDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function printSummary(): void {
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  const failed = total - passed;
  const totalMs = results.reduce((sum, r) => sum + r.ms, 0);
  console.log("");
  console.log(`Smoke summary: ${passed}/${total} passed in ${totalMs}ms`);
  if (failed > 0) {
    console.log("Failures:");
    for (const item of results.filter((r) => !r.ok)) {
      console.log(`  - ${item.name}: ${item.detail ?? "no detail"}`);
    }
  }
}

let exitCode = 0;
try {
  await smoke();
} catch (e) {
  exitCode = 1;
  if (results.length === 0 || results[results.length - 1]?.ok) {
    // Failure outside any tracked step (e.g. teardown).
    console.error(`\nSmoke FAILED outside a tracked step: ${e instanceof Error ? e.message : String(e)}`);
  }
}
printSummary();
process.exit(exitCode);
