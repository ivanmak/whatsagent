import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAuthUser, createSession, createSessionCsrfToken, getAuthUserByUsername } from "../src/auth-dao.ts";
import { hashPassword, verifyPassword } from "../src/auth-hash.ts";
import { AUTH_COOKIE_NAME, CSRF_HEADER_NAME, hashSessionToken } from "../src/auth-session.ts";
import { DAEMON_SETTING_TUI_REDRAW_INTERVAL_SECONDS, getDaemonSetting, migrateDaemonDb, openDaemonDb, setCurrentWorkspaceId, setDaemonSetting } from "../src/daemon-db.ts";
import { daemonHomePaths } from "../src/paths.ts";
import { startDaemon, type StartedDaemon } from "../src/server/daemon.ts";
import { seedTestWorkspace } from "./helpers/seed-workspace.ts";

let home: string;
const csrfByCookie = new Map<string, string>();

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "wa-web-auth-"));
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "daemon.toml"), `[ui]\nhost = "127.0.0.1"\nport = 0\n`, "utf8");
});

afterEach(() => {
  csrfByCookie.clear();
  rmSync(home, { recursive: true, force: true });
});

async function withDaemon(fn: (daemon: StartedDaemon) => Promise<void>): Promise<void> {
  const daemon = await startDaemon({ daemonHome: home, port: 0, consoleLogs: false });
  try {
    await fn(daemon);
  } finally {
    await daemon.stop();
  }
}

async function seedUser(username = "ivan", password = "correct-password", recovery = "ABCDE-FGHIJ-KLMNO-PQRST-UVWXY"): Promise<void> {
  const db = openDaemonDb(daemonHomePaths(home).daemonDbPath);
  try {
    migrateDaemonDb(db, { daemonHome: home });
    createAuthUser(db, {
      username,
      passwordHash: await hashPassword(password),
      recoveryHash: await hashPassword(recovery),
    });
  } finally {
    db.close();
  }
}

async function seedSessionCookie(): Promise<string> {
  const token = "test-session-token";
  const db = openDaemonDb(daemonHomePaths(home).daemonDbPath);
  try {
    migrateDaemonDb(db, { daemonHome: home });
    const user = getAuthUserByUsername(db, "ivan") ?? createAuthUser(db, { username: "ivan", passwordHash: await hashPassword("correct-password") });
    const session = createSession(db, { userId: user.id, tokenHash: hashSessionToken(token), ttlMs: 60_000, userAgent: "WA Test Browser" });
    createSessionCsrfToken(db, session.id, token);
    const cookie = `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`;
    csrfByCookie.set(cookie, token);
    return cookie;
  } finally {
    db.close();
  }
}

function cookieValue(setCookie: string | null): string {
  const cookie = setCookie?.split(";")[0] ?? "";
  expect(cookie.startsWith(`${AUTH_COOKIE_NAME}=`)).toBe(true);
  return decodeURIComponent(cookie.split("=")[1] ?? "");
}

function rememberCsrf(cookie: string, body: { csrfToken?: string }): void {
  if (body.csrfToken) csrfByCookie.set(cookie, body.csrfToken);
}

function csrfHeaders(cookie: string, extra: Record<string, string> = {}): Record<string, string> {
  const token = csrfByCookie.get(cookie);
  const headers: Record<string, string> = { ...extra, Cookie: cookie };
  if (token && headers[CSRF_HEADER_NAME] === undefined) headers[CSRF_HEADER_NAME] = token;
  return headers;
}

function expectCommonSecurityHeaders(res: Response): void {
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
}

function expectHtmlSecurityHeaders(res: Response): void {
  expectCommonSecurityHeaders(res);
  expect(res.headers.get("x-frame-options")).toBe("DENY");
}

function streamUtf8(text: string, chunkSize = 1024): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
      }
      controller.close();
    },
  });
}

describe("web auth", () => {
  test("renders login page", async () => {
    await withDaemon(async (daemon) => {
      const res = await fetch(`${daemon.url}/login`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Sign in to manage this local daemon");
      expect(body).toContain("/api/v1/auth/login");
      expect(body).toContain("/api/v1/auth/login-recovery");
    });
  });

  test("WA-157 login return validator keeps navigation same-origin", async () => {
    await withDaemon(async (daemon) => {
      const res = await fetch(`${daemon.url}/login?return=${encodeURIComponent("/workspaces/abc")}`);
      expect(res.status).toBe(200);
      const body = await res.text();
      const start = body.indexOf("function safeReturnPath");
      const end = body.indexOf("async function post");
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      const safeReturnPath = new Function("location", `${body.slice(start, end)}; return safeReturnPath;`)({ origin: daemon.url }) as (value: string | null) => string;

      expect(safeReturnPath("/workspaces/abc/")).toBe("/workspaces/abc/");
      expect(safeReturnPath("/workspaces/abc?tab=settings#runtime")).toBe("/workspaces/abc?tab=settings#runtime");
      expect(safeReturnPath("https://evil.example.com/phish")).toBe("/");
      expect(safeReturnPath("//evil.example.com/phish")).toBe("/");
      expect(safeReturnPath("javascript:alert(1)")).toBe("/");
      expect(safeReturnPath("/\\evil.example.com")).toBe("/");
      expect(safeReturnPath("\\\\evil.example.com\\share")).toBe("/");
      expect(safeReturnPath(new URLSearchParams("return=%2F%5Cevil.example.com").get("return"))).toBe("/");
      expect(safeReturnPath(new URLSearchParams("return=%5C%5Cevil.example.com%5Cshare").get("return"))).toBe("/");
      expect(safeReturnPath("/bad\u0000path")).toBe("/");
      expect(safeReturnPath(null)).toBe("/");
    });
  });

  test("WA-159 adds browser hardening headers to HTML, API, and assets", async () => {
    await seedUser();
    const cookie = await seedSessionCookie();
    const db = openDaemonDb(daemonHomePaths(home).daemonDbPath);
    let workspaceId = "";
    try {
      migrateDaemonDb(db, { daemonHome: home });
      const seeded = await seedTestWorkspace(home, db, { name: "headers" });
      workspaceId = seeded.workspaceId;
      setCurrentWorkspaceId(db, workspaceId);
      seeded.workspaceDb.close();
    } finally {
      db.close();
    }

    await withDaemon(async (daemon) => {
      const login = await fetch(`${daemon.url}/login`);
      expect(login.status).toBe(200);
      expectHtmlSecurityHeaders(login);

      const shell = await fetch(`${daemon.url}/workspaces/${encodeURIComponent(workspaceId)}/`, { headers: { Cookie: cookie, Accept: "text/html" } });
      expect(shell.status).toBe(200);
      expectHtmlSecurityHeaders(shell);

      const api = await fetch(`${daemon.url}/api/v1/agent/whoami`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: "missing" }),
      });
      expect(api.status).toBe(404);
      expectCommonSecurityHeaders(api);

      const asset = await fetch(`${daemon.url}/assets/xterm.js`);
      expect(asset.status).toBe(200);
      expectCommonSecurityHeaders(asset);
    });
  });

  test("WA-152 state routes require exact Origin/Referer scheme-host-port", async () => {
    await seedUser();
    const cookie = await seedSessionCookie();
    await withDaemon(async (daemon) => {
      const url = `${daemon.url}/api/v1/settings/tui-redraw`;
      const body = JSON.stringify({ workaround: "off", intervalSeconds: 60 });
      const sameHostDifferentPort = new URL(daemon.url);
      sameHostDifferentPort.port = String(Number(sameHostDifferentPort.port) + 1);

      const exactOrigin = await fetch(url, { method: "PUT", headers: csrfHeaders(cookie, { "Content-Type": "application/json", Origin: daemon.url }), body });
      expect(exactOrigin.status).toBe(200);
      const differentPortOrigin = await fetch(url, { method: "PUT", headers: csrfHeaders(cookie, { "Content-Type": "application/json", Origin: sameHostDifferentPort.origin }), body });
      expect(differentPortOrigin.status).toBe(403);
      const differentPortReferer = await fetch(url, { method: "PUT", headers: csrfHeaders(cookie, { "Content-Type": "application/json", Referer: `${sameHostDifferentPort.origin}/settings` }), body });
      expect(differentPortReferer.status).toBe(403);
      const malformedReferer = await fetch(url, { method: "PUT", headers: csrfHeaders(cookie, { "Content-Type": "application/json", Referer: "http://[::1" }), body });
      expect(malformedReferer.status).toBe(403);
      const missingOrigin = await fetch(url, { method: "PUT", headers: csrfHeaders(cookie, { "Content-Type": "application/json" }), body });
      expect(missingOrigin.status).toBe(200);
    });
  });

  test("WA-152 proxy origins must be configured as exact origins", async () => {
    writeFileSync(join(home, "daemon.toml"), `[ui]\nhost = "127.0.0.1"\nport = 0\nallow_hosts = ["https://whatsagent-test.example.com", "bare-proxy.example.com"]\n`, "utf8");
    await seedUser();
    const cookie = await seedSessionCookie();
    await withDaemon(async (daemon) => {
      const url = `${daemon.url}/api/v1/settings/tui-redraw`;
      const body = JSON.stringify({ workaround: "off", intervalSeconds: 60 });
      const exactProxy = await fetch(url, { method: "PUT", headers: csrfHeaders(cookie, { "Content-Type": "application/json", Host: "whatsagent-test.example.com", Origin: "https://whatsagent-test.example.com" }), body });
      expect(exactProxy.status).toBe(200);
      const bareHostOnly = await fetch(url, { method: "PUT", headers: csrfHeaders(cookie, { "Content-Type": "application/json", Host: "bare-proxy.example.com", Origin: "https://bare-proxy.example.com" }), body });
      expect(bareHostOnly.status).toBe(403);
    });
  });

  test("global middleware redirects HTML to setup or login", async () => {
    await withDaemon(async (daemon) => {
      const setup = await fetch(`${daemon.url}/`, { redirect: "manual", headers: { Accept: "text/html" } });
      expect(setup.status).toBe(302);
      expect(setup.headers.get("location")).toBe("/setup");
      expectCommonSecurityHeaders(setup);

      const apiSetup = await fetch(`${daemon.url}/api/v1/workspaces/current`);
      expect(apiSetup.status).toBe(401);
      expect(await apiSetup.json()).toMatchObject({ error: "setup_required" });
    });

    await seedUser();
    await withDaemon(async (daemon) => {
      const login = await fetch(`${daemon.url}/`, { redirect: "manual", headers: { Accept: "text/html" } });
      expect(login.status).toBe(302);
      expect(login.headers.get("location")).toBe("/login");
      expectCommonSecurityHeaders(login);
    });
  });

  test("daemon-global TUI redraw settings require auth, validate, and persist", async () => {
    await seedUser();
    const cookie = await seedSessionCookie();
    const paths = daemonHomePaths(home);
    const db = openDaemonDb(paths.daemonDbPath);
    try {
      migrateDaemonDb(db, { daemonHome: home });
      setDaemonSetting(db, DAEMON_SETTING_TUI_REDRAW_INTERVAL_SECONDS, "30");
      expect(getDaemonSetting(db, DAEMON_SETTING_TUI_REDRAW_INTERVAL_SECONDS)).toBe("30");
    } finally {
      db.close();
    }

    await withDaemon(async (daemon) => {
      const unauth = await fetch(`${daemon.url}/api/v1/settings/tui-redraw`);
      expect(unauth.status).toBe(401);
      expect(await unauth.json()).toMatchObject({ error: "auth_required" });

      const initial = await fetch(`${daemon.url}/api/v1/settings/tui-redraw`, { headers: { Cookie: cookie } });
      expect(initial.status).toBe(200);
      expect(await initial.json()).toEqual({ ok: true, workaround: "on", tuiRedraw: { workaround: "on" } });

      const invalidMode = await fetch(`${daemon.url}/api/v1/settings/tui-redraw`, {
        method: "PUT",
        headers: csrfHeaders(cookie, { "Content-Type": "application/json" }),
        body: JSON.stringify({ workaround: "magic", intervalSeconds: 30 }),
      });
      expect(invalidMode.status).toBe(400);
      expect((await invalidMode.json()).error).toContain("workaround");

      const staleInterval = await fetch(`${daemon.url}/api/v1/settings/tui-redraw`, {
        method: "PUT",
        headers: csrfHeaders(cookie, { "Content-Type": "application/json" }),
        body: JSON.stringify({ workaround: "on", intervalSeconds: 45 }),
      });
      expect(staleInterval.status).toBe(200);
      const staleIntervalBody = await staleInterval.json();
      expect(staleIntervalBody).toEqual({ ok: true, workaround: "on", tuiRedraw: { workaround: "on" } });
      expect(staleIntervalBody).not.toHaveProperty("intervalSeconds");
      expect(staleIntervalBody.tuiRedraw).not.toHaveProperty("intervalSeconds");

      const afterStaleInterval = await fetch(`${daemon.url}/api/v1/settings/tui-redraw`, { headers: { Cookie: cookie } });
      expect(afterStaleInterval.status).toBe(200);
      const afterStaleIntervalBody = await afterStaleInterval.json();
      expect(afterStaleIntervalBody).toEqual({ ok: true, workaround: "on", tuiRedraw: { workaround: "on" } });
      expect(afterStaleIntervalBody).not.toHaveProperty("intervalSeconds");
      expect(afterStaleIntervalBody.tuiRedraw).not.toHaveProperty("intervalSeconds");

      const saved = await fetch(`${daemon.url}/api/v1/settings/tui-redraw`, {
        method: "PUT",
        headers: csrfHeaders(cookie, { "Content-Type": "application/json" }),
        body: JSON.stringify({ workaround: "off", intervalSeconds: 45 }),
      });
      expect(saved.status).toBe(200);
      expect(await saved.json()).toEqual({ ok: true, workaround: "off", tuiRedraw: { workaround: "off" } });
    });

    const afterPutDb = openDaemonDb(paths.daemonDbPath);
    try {
      migrateDaemonDb(afterPutDb, { daemonHome: home });
      expect(getDaemonSetting(afterPutDb, DAEMON_SETTING_TUI_REDRAW_INTERVAL_SECONDS)).toBe("30");
    } finally {
      afterPutDb.close();
    }

    await withDaemon(async (daemon) => {
      const persisted = await fetch(`${daemon.url}/api/v1/settings/tui-redraw`, { headers: { Cookie: cookie } });
      expect(persisted.status).toBe(200);
      expect(await persisted.json()).toEqual({ ok: true, workaround: "off", tuiRedraw: { workaround: "off" } });
    });
  });

  test("WA-161 state-changing browser routes require CSRF tokens", async () => {
    await seedUser();
    const cookie = await seedSessionCookie();
    await withDaemon(async (daemon) => {
      const url = `${daemon.url}/api/v1/settings/tui-redraw`;
      const body = JSON.stringify({ workaround: "off", intervalSeconds: 60 });

      const get = await fetch(url, { headers: { Cookie: cookie } });
      expect(get.status).toBe(200);

      const missing = await fetch(url, { method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json" }, body });
      expect(missing.status).toBe(403);
      expect(await missing.json()).toMatchObject({ error: "invalid_csrf_token" });

      const valid = await fetch(url, { method: "PUT", headers: csrfHeaders(cookie, { "Content-Type": "application/json" }), body });
      expect(valid.status).toBe(200);

      const tampered = await fetch(url, { method: "PUT", headers: csrfHeaders(cookie, { "Content-Type": "application/json", [CSRF_HEADER_NAME]: "tampered-token" }), body });
      expect(tampered.status).toBe(403);
    });
  });

  test("WA-161 login-issued CSRF token round-trips through the session", async () => {
    await seedUser();
    await withDaemon(async (daemon) => {
      const login = await fetch(`${daemon.url}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "ivan", password: "correct-password" }),
      });
      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
      const loginBody = await login.json() as { csrfToken: string };
      expect(typeof loginBody.csrfToken).toBe("string");
      csrfByCookie.set(cookie, loginBody.csrfToken);

      const me = await fetch(`${daemon.url}/api/v1/auth/me`, { headers: { Cookie: cookie } });
      expect(me.status).toBe(200);
      expect((await me.json() as { csrfToken: string }).csrfToken).toBe(loginBody.csrfToken);

      const saved = await fetch(`${daemon.url}/api/v1/settings/tui-redraw`, {
        method: "PUT",
        headers: csrfHeaders(cookie, { "Content-Type": "application/json" }),
        body: JSON.stringify({ workaround: "off", intervalSeconds: 60 }),
      });
      expect(saved.status).toBe(200);
    });
  });

  test("WA-161 logout invalidates the session CSRF token", async () => {
    await seedUser();
    await withDaemon(async (daemon) => {
      const login = await fetch(`${daemon.url}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "ivan", password: "correct-password" }),
      });
      const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
      const loginBody = await login.json() as { csrfToken: string };
      csrfByCookie.set(cookie, loginBody.csrfToken);

      const logout = await fetch(`${daemon.url}/api/v1/auth/logout`, { method: "POST", headers: csrfHeaders(cookie), redirect: "manual" });
      expect(logout.status).toBe(302);

      const stale = await fetch(`${daemon.url}/api/v1/settings/tui-redraw`, {
        method: "PUT",
        headers: csrfHeaders(cookie, { "Content-Type": "application/json" }),
        body: JSON.stringify({ workaround: "off", intervalSeconds: 60 }),
      });
      expect(stale.status).toBe(403);
    });
  });

  test("setup page renders strength meter and copy-gated recovery continue", async () => {
    await withDaemon(async (daemon) => {
      const res = await fetch(`${daemon.url}/setup`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Set up WhatsAgent");
      expect(body).toContain("strengthBar");
      expect(body).toContain("copyRecovery");
      expect(body).toContain("continueBtn.disabled=false");
    });
  });

  test("setup creates first user, stores hashed recovery code, and sets session cookie", async () => {
    await withDaemon(async (daemon) => {
      const res = await fetch(`${daemon.url}/api/v1/auth/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "ivan", password: "correct-password", passwordConfirm: "correct-password" }),
      });
      expect(res.status).toBe(201);
      expect(res.headers.get("set-cookie")).toContain("HttpOnly");
      const body = await res.json() as { ok: boolean; recoveryCode: string; csrfToken: string; user: { username: string }; session: { id: string } };
      expect(body).toMatchObject({ ok: true, user: { username: "ivan" } });
      expect(typeof body.csrfToken).toBe("string");
      expect(body.recoveryCode).toMatch(/^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){7}$/);

      const db = openDaemonDb(daemonHomePaths(home).daemonDbPath);
      try {
        migrateDaemonDb(db);
        const user = getAuthUserByUsername(db, "ivan");
        expect(user?.password_hash).toStartWith("$argon2id$");
        expect(user?.recovery_hash).toStartWith("$argon2id$");
        expect(await verifyPassword(user!.recovery_hash!, body.recoveryCode)).toBe(true);
        expect(db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM auth_sessions").get()?.count).toBe(1);
        expect(db.query<{ token: string }, [string]>("SELECT token FROM csrf_tokens WHERE session_id = ?").get(body.session.id)?.token).toBe(body.csrfToken);
      } finally {
        db.close();
      }
    });
  });

  test("setup rejects invalid input and already configured daemon", async () => {
    await withDaemon(async (daemon) => {
      const mismatch = await fetch(`${daemon.url}/api/v1/auth/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "ivan", password: "correct-password", passwordConfirm: "wrong-password" }),
      });
      expect(mismatch.status).toBe(400);
      expect(await mismatch.json()).toMatchObject({ error: "passwords do not match" });

      const ok = await fetch(`${daemon.url}/api/v1/auth/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "ivan", password: "correct-password", passwordConfirm: "correct-password" }),
      });
      expect(ok.status).toBe(201);

      const duplicate = await fetch(`${daemon.url}/api/v1/auth/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "other", password: "correct-password", passwordConfirm: "correct-password" }),
      });
      expect(duplicate.status).toBe(409);

      const page = await fetch(`${daemon.url}/setup`, { redirect: "manual" });
      expect(page.status).toBe(302);
      expect(page.headers.get("location")).toBe("/login");
    });
  });

  test("global middleware gates browser APIs but not agent APIs", async () => {
    await seedUser();
    const cookie = await seedSessionCookie();
    await withDaemon(async (daemon) => {
      const rejected = await fetch(`${daemon.url}/api/v1/workspaces/current`, { headers: { Accept: "application/json" } });
      expect(rejected.status).toBe(401);
      expect(await rejected.json()).toMatchObject({ error: "auth_required" });

      const defaultAccept = await fetch(`${daemon.url}/api/v1/workspaces/current`);
      expect(defaultAccept.status).toBe(401);
      expect(await defaultAccept.json()).toMatchObject({ error: "auth_required" });

      const malformedCookie = await fetch(`${daemon.url}/api/v1/workspaces/current`, { headers: { Cookie: "wa_sid=%" } });
      expect(malformedCookie.status).toBe(401);

      const allowed = await fetch(`${daemon.url}/api/v1/workspaces/current`, { headers: { Cookie: cookie } });
      expect(allowed.status).toBe(200);

      const agent = await fetch(`${daemon.url}/api/v1/agent/whoami`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: "missing" }),
      });
      expect(agent.status).toBe(404);
      expect(await agent.json()).toMatchObject({ error: "workspace_not_found" });
    });
  });

  test("login sets httponly session cookie and stores only token hash", async () => {
    await seedUser();
    await withDaemon(async (daemon) => {
      const res = await fetch(`${daemon.url}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "ivan", password: "correct-password" }),
      });
      expect(res.status).toBe(200);
      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
      expect(setCookie).toContain("Path=/");
      const token = cookieValue(setCookie);
      const body = await res.json() as { ok: boolean; csrfToken: string; user: { username: string }; session: { id: string } };
      expect(body).toMatchObject({ ok: true, user: { username: "ivan" } });
      expect(typeof body.csrfToken).toBe("string");

      const db = openDaemonDb(daemonHomePaths(home).daemonDbPath);
      try {
        migrateDaemonDb(db);
        const row = db.query<{ token_hash: string }, [string]>("SELECT token_hash FROM auth_sessions WHERE id = ?").get(body.session.id);
        expect(row?.token_hash).toBe(hashSessionToken(token));
        expect(row?.token_hash).not.toBe(token);
        expect(db.query<{ token: string }, [string]>("SELECT token FROM csrf_tokens WHERE session_id = ?").get(body.session.id)?.token).toBe(body.csrfToken);
      } finally {
        db.close();
      }
    });
  });

  test("login rejects wrong password and increments failed attempts", async () => {
    await seedUser();
    await withDaemon(async (daemon) => {
      const res = await fetch(`${daemon.url}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "ivan", password: "wrong" }),
      });
      expect(res.status).toBe(401);
      const db = openDaemonDb(daemonHomePaths(home).daemonDbPath);
      try {
        migrateDaemonDb(db);
        expect(getAuthUserByUsername(db, "ivan")?.failed_attempts).toBe(1);
      } finally {
        db.close();
      }
    });
  });

  test("locked user cannot log in", async () => {
    await seedUser();
    const db = openDaemonDb(daemonHomePaths(home).daemonDbPath);
    try {
      migrateDaemonDb(db);
      db.run("UPDATE auth_users SET locked_until = ?", [new Date(Date.now() + 60_000).toISOString()]);
    } finally {
      db.close();
    }
    await withDaemon(async (daemon) => {
      const res = await fetch(`${daemon.url}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "ivan", password: "correct-password" }),
      });
      expect(res.status).toBe(423);
      expect(res.headers.get("retry-after")).toBeTruthy();
    });
  });

  test("login locks an account after 5 failed attempts in one minute", async () => {
    await seedUser();
    await withDaemon(async (daemon) => {
      for (let i = 1; i <= 4; i++) {
        const res = await fetch(`${daemon.url}/api/v1/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "ivan", password: `bad-${i}` }),
        });
        expect(res.status).toBe(401);
      }

      const limited = await fetch(`${daemon.url}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "ivan", password: "bad-5" }),
      });
      expect(limited.status).toBe(423);
      expect(limited.headers.get("retry-after")).toBeTruthy();

      const locked = await fetch(`${daemon.url}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "ivan", password: "correct-password" }),
      });
      expect(locked.status).toBe(423);

      const db = openDaemonDb(daemonHomePaths(home).daemonDbPath);
      try {
        migrateDaemonDb(db);
        const user = getAuthUserByUsername(db, "ivan")!;
        expect(user.failed_attempts).toBe(5);
        expect(Date.parse(user.locked_until!)).toBeGreaterThan(Date.now());
      } finally {
        db.close();
      }
    });
  });

  test("logout clears cookie and deletes session row", async () => {
    await seedUser();
    let cookie = "";
    await withDaemon(async (daemon) => {
      const login = await fetch(`${daemon.url}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "ivan", password: "correct-password" }),
      });
      cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
      rememberCsrf(cookie, await login.json() as { csrfToken?: string });
      const logout = await fetch(`${daemon.url}/api/v1/auth/logout`, { method: "POST", headers: csrfHeaders(cookie), redirect: "manual" });
      expect(logout.status).toBe(302);
      expect(logout.headers.get("location")).toBe("/login");
      expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    });
    const db = openDaemonDb(daemonHomePaths(home).daemonDbPath);
    try {
      migrateDaemonDb(db);
      expect(db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM auth_sessions").get()?.count).toBe(0);
    } finally {
      db.close();
    }
  });

  test("recovery login consumes code and marks session for password reset", async () => {
    await seedUser();
    await withDaemon(async (daemon) => {
      const res = await fetch(`${daemon.url}/api/v1/auth/login-recovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "ivan", recoveryCode: "ABCDE-FGHIJ-KLMNO-PQRST-UVWXY" }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("set-cookie")).toContain("HttpOnly");
      const body = await res.json() as { forcePwdReset: boolean; csrfToken: string; session: { id: string } };
      expect(body.forcePwdReset).toBe(true);
      expect(typeof body.csrfToken).toBe("string");
      const db = openDaemonDb(daemonHomePaths(home).daemonDbPath);
      try {
        migrateDaemonDb(db);
        expect(getAuthUserByUsername(db, "ivan")?.recovery_hash).toBeNull();
        expect(db.query<{ force_pwd_reset: number }, [string]>("SELECT force_pwd_reset FROM auth_sessions WHERE id = ?").get(body.session.id)?.force_pwd_reset).toBe(1);
      } finally {
        db.close();
      }
    });
  });

  test("force-reset recovery session can change password without current password", async () => {
    await seedUser();
    await withDaemon(async (daemon) => {
      let res = await fetch(`${daemon.url}/api/v1/auth/login-recovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "ivan", recoveryCode: "ABCDE-FGHIJ-KLMNO-PQRST-UVWXY" }),
      });
      expect(res.status).toBe(200);
      const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
      rememberCsrf(cookie, await res.json() as { csrfToken?: string });

      res = await fetch(`${daemon.url}/api/v1/auth/change-password`, {
        method: "POST",
        headers: csrfHeaders(cookie, { "Content-Type": "application/json" }),
        body: JSON.stringify({ currentPassword: "", newPassword: "new-password" }),
      });
      expect(res.status).toBe(200);

      const db = openDaemonDb(daemonHomePaths(home).daemonDbPath);
      try {
        migrateDaemonDb(db);
        const user = getAuthUserByUsername(db, "ivan")!;
        expect(await verifyPassword(user.password_hash, "new-password")).toBe(true);
        expect(db.query<{ force_pwd_reset: number }, []>("SELECT force_pwd_reset FROM auth_sessions").get()?.force_pwd_reset).toBe(0);
      } finally {
        db.close();
      }
    });
  });

  test("recovery login rate-limits repeated invalid codes", async () => {
    await seedUser();
    await withDaemon(async (daemon) => {
      for (let i = 0; i < 10; i++) {
        const res = await fetch(`${daemon.url}/api/v1/auth/login-recovery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "ivan", recoveryCode: `WRONG-${i}` }),
        });
        expect(res.status).toBe(401);
      }
      const limited = await fetch(`${daemon.url}/api/v1/auth/login-recovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "ivan", recoveryCode: "ABCDE-FGHIJ-KLMNO-PQRST-UVWXY" }),
      });
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBeTruthy();
      const db = openDaemonDb(daemonHomePaths(home).daemonDbPath);
      try {
        migrateDaemonDb(db);
        expect(getAuthUserByUsername(db, "ivan")?.recovery_hash).toBeTruthy();
      } finally {
        db.close();
      }
    });
  });

  test("recovery login reserves rate-limit slots before concurrent verification", async () => {
    await seedUser();
    await withDaemon(async (daemon) => {
      const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => fetch(`${daemon.url}/api/v1/auth/login-recovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "ivan", recoveryCode: `WRONG-CONCURRENT-${i}` }),
      })));
      const statuses = responses.map((res) => res.status);
      expect(statuses.filter((status) => status === 401).length).toBe(10);
      expect(statuses.filter((status) => status === 429).length).toBe(10);
      const db = openDaemonDb(daemonHomePaths(home).daemonDbPath);
      try {
        migrateDaemonDb(db);
        expect(getAuthUserByUsername(db, "ivan")?.recovery_hash).toBeTruthy();
      } finally {
        db.close();
      }
    });
  });

  test("recovery login rate-limit window expires", async () => {
    await seedUser();
    const realDateNow = Date.now;
    let nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    Date.now = () => nowMs;
    try {
      await withDaemon(async (daemon) => {
        for (let i = 0; i < 10; i++) {
          const res = await fetch(`${daemon.url}/api/v1/auth/login-recovery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: "ivan", recoveryCode: `WRONG-WINDOW-${i}` }),
          });
          expect(res.status).toBe(401);
        }
        nowMs += 61_000;
        const res = await fetch(`${daemon.url}/api/v1/auth/login-recovery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "ivan", recoveryCode: "WRONG-WINDOW-EXPIRED" }),
        });
        expect(res.status).toBe(401);
      });
    } finally {
      Date.now = realDateNow;
    }
  });

  test("user settings endpoints manage password, sessions, and recovery", async () => {
    await seedUser();
    const cookie = await seedSessionCookie();
    await withDaemon(async (daemon) => {
      let res = await fetch(`${daemon.url}/api/v1/auth/me`, { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, user: { username: "ivan" } });

      res = await fetch(`${daemon.url}/api/v1/auth/sessions`, { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
      const sessions = await res.json() as { currentSessionId: string; sessions: Array<{ id: string; user_agent: string | null; last_seen_at: string }> };
      expect(sessions.sessions.length).toBe(1);
      const listedSession = sessions.sessions[0]!;
      expect(listedSession.user_agent).toBe("WA Test Browser");
      expect(listedSession.last_seen_at).toBeTruthy();

      res = await fetch(`${daemon.url}/api/v1/auth/regenerate-recovery`, { method: "POST", headers: csrfHeaders(cookie) });
      expect(res.status).toBe(200);
      const regen = await res.json() as { recoveryCode: string };
      expect(regen.recoveryCode).toMatch(/^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){7}$/);

      res = await fetch(`${daemon.url}/api/v1/auth/change-password`, {
        method: "POST",
        headers: csrfHeaders(cookie, { "Content-Type": "application/json" }),
        body: JSON.stringify({ currentPassword: "correct-password", newPassword: "new-password" }),
      });
      expect(res.status).toBe(200);
      const db = openDaemonDb(daemonHomePaths(home).daemonDbPath);
      try {
        migrateDaemonDb(db);
        const user = getAuthUserByUsername(db, "ivan")!;
        expect(await verifyPassword(user.password_hash, "new-password")).toBe(true);
        const extra = createSession(db, { userId: user.id, tokenHash: hashSessionToken("extra"), ttlMs: 60_000 });
        expect(extra).toBeTruthy();
      } finally {
        db.close();
      }

      res = await fetch(`${daemon.url}/api/v1/auth/sessions/sign-out-others`, { method: "POST", headers: csrfHeaders(cookie) });
      expect(res.status).toBe(200);
      res = await fetch(`${daemon.url}/api/v1/auth/sessions`, { headers: { Cookie: cookie } });
      expect((await res.json() as { sessions: unknown[] }).sessions.length).toBe(1);

      res = await fetch(`${daemon.url}/api/v1/auth/sessions/${encodeURIComponent(sessions.currentSessionId)}`, { method: "DELETE", headers: csrfHeaders(cookie) });
      expect(res.status).toBe(200);
      expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    });
  });
});

describe("client-debug ingest endpoint (EP-023 / WA-103)", () => {
  async function readDebugLog(): Promise<string> {
    return readFileSync(join(daemonHomePaths(home).logsDir, "xterm-debug.log"), "utf8");
  }

  test("rejects unauthenticated POST with 401", async () => {
    await withDaemon(async (daemon) => {
      await seedUser();
      const res = await fetch(`${daemon.url}/api/v1/client-debug`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: [{ category: "x" }] }),
      });
      expect(res.status).toBe(401);
      expect(((await res.json()) as { error: string }).error).toBe("auth_required");
    });
  });

  test("accepts authed batch and appends a JSON line per event with sessionId + userId", async () => {
    await withDaemon(async (daemon) => {
      const cookie = await seedSessionCookie();
      const res = await fetch(`${daemon.url}/api/v1/client-debug`, {
        method: "POST",
        headers: csrfHeaders(cookie, { "Content-Type": "application/json" }),
        body: JSON.stringify({ events: [
          { category: "mount", payload: { role: "researcher" }, ts: 1234 },
          { category: "periodic-snapshot", payload: { renderer: "webgl" } },
        ] }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; accepted: number };
      expect(body).toEqual({ ok: true, accepted: 2 });
      // Logger writes are async (appendFile catches errors); poll briefly.
      let log = "";
      for (let i = 0; i < 20; i++) {
        try { log = await readDebugLog(); if (log.split("\n").filter(Boolean).length >= 2) break; } catch { /* file not written yet */ }
        await new Promise((r) => setTimeout(r, 25));
      }
      const lines = log.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(lines.length).toBe(2);
      for (const line of lines) {
        expect(line.event).toBe("xterm_client_event");
        expect(typeof line.sessionId).toBe("string");
        expect(typeof line.userId).toBe("string");
      }
      const byCategory = new Map(lines.map((line) => [line.category, line]));
      const mount = byCategory.get("mount")!;
      expect((mount.payload as { role: string }).role).toBe("researcher");
      expect(mount.clientTs).toBe(1234);
      expect(byCategory.has("periodic-snapshot")).toBe(true);
    });
  });

  test("recursively redacts nested secret-like keys (logger top-level redact() is not enough)", async () => {
    await withDaemon(async (daemon) => {
      const cookie = await seedSessionCookie();
      const res = await fetch(`${daemon.url}/api/v1/client-debug`, {
        method: "POST",
        headers: csrfHeaders(cookie, { "Content-Type": "application/json" }),
        body: JSON.stringify({ events: [{
          category: "x",
          payload: {
            outer: { token: "abc", nested: { password: "p1", apiKey: "k1", url: "https://example.com/?token=tttt" } },
            keystroke: { key: "Enter", code: "Enter" },
          },
        }] }),
      });
      expect(res.status).toBe(200);
      let log = "";
      for (let i = 0; i < 20; i++) {
        try { log = await readDebugLog(); if (log) break; } catch { /* not yet */ }
        await new Promise((r) => setTimeout(r, 25));
      }
      // Concrete strings must not appear anywhere in the log line.
      expect(log).not.toContain("abc");
      expect(log).not.toContain("p1");
      expect(log).not.toContain("k1");
      expect(log).not.toContain("example.com");
      expect(log).toContain("[redacted]");
    });
  });

  test("rejects > 50 events with 413", async () => {
    await withDaemon(async (daemon) => {
      const cookie = await seedSessionCookie();
      const events = Array.from({ length: 51 }, () => ({ category: "x" }));
      const res = await fetch(`${daemon.url}/api/v1/client-debug`, {
        method: "POST",
        headers: csrfHeaders(cookie, { "Content-Type": "application/json" }),
        body: JSON.stringify({ events }),
      });
      expect(res.status).toBe(413);
    });
  });

  test("rejects body over 32 KB with 413 via Content-Length", async () => {
    await withDaemon(async (daemon) => {
      const cookie = await seedSessionCookie();
      const big = "x".repeat(33 * 1024);
      const res = await fetch(`${daemon.url}/api/v1/client-debug`, {
        method: "POST",
        headers: csrfHeaders(cookie, { "Content-Type": "application/json" }),
        body: JSON.stringify({ events: [{ category: "x", payload: { blob: big } }] }),
      });
      expect(res.status).toBe(413);
    });
  });

  test("WA-158 rejects streamed client-debug bodies over 32 KB without Content-Length", async () => {
    await withDaemon(async (daemon) => {
      const cookie = await seedSessionCookie();
      const big = "x".repeat(33 * 1024);
      const body = JSON.stringify({ events: [{ category: "x", payload: { blob: big } }] });
      const res = await fetch(`${daemon.url}/api/v1/client-debug`, {
        method: "POST",
        headers: csrfHeaders(cookie, { "Content-Type": "application/json" }),
        body: streamUtf8(body),
      });
      expect(res.status).toBe(413);
      const payload = await res.json() as { ok: boolean; size: number; limit: number };
      expect(payload.ok).toBe(false);
      expect(payload.size).toBeGreaterThan(payload.limit);
      expect(payload.limit).toBe(32 * 1024);
    });
  });

  test("WA-158 accepts streamed client-debug bodies under 32 KB without Content-Length", async () => {
    await withDaemon(async (daemon) => {
      const cookie = await seedSessionCookie();
      const res = await fetch(`${daemon.url}/api/v1/client-debug`, {
        method: "POST",
        headers: csrfHeaders(cookie, { "Content-Type": "application/json" }),
        body: streamUtf8(JSON.stringify({ events: [{ category: "x", payload: { safe: true } }] })),
      });
      expect(res.status).toBe(200);
      const payload = await res.json() as { ok: boolean };
      expect(payload.ok).toBe(true);
    });
  });

  test("rate-limits past 30 batches in trailing minute", async () => {
    await withDaemon(async (daemon) => {
      const cookie = await seedSessionCookie();
      const send = () => fetch(`${daemon.url}/api/v1/client-debug`, {
        method: "POST",
        headers: csrfHeaders(cookie, { "Content-Type": "application/json" }),
        body: JSON.stringify({ events: [{ category: "x" }] }),
      });
      for (let i = 0; i < 30; i++) {
        const res = await send();
        expect(res.status).toBe(200);
      }
      const limited = await send();
      expect(limited.status).toBe(429);
      expect(limited.headers.get("Retry-After")).not.toBeNull();
    });
  });

  test("rejects malformed body with 400", async () => {
    await withDaemon(async (daemon) => {
      const cookie = await seedSessionCookie();
      const noJson = await fetch(`${daemon.url}/api/v1/client-debug`, {
        method: "POST",
        headers: csrfHeaders(cookie, { "Content-Type": "application/json" }),
        body: "not json",
      });
      expect(noJson.status).toBe(400);
      const noEvents = await fetch(`${daemon.url}/api/v1/client-debug`, {
        method: "POST",
        headers: csrfHeaders(cookie, { "Content-Type": "application/json" }),
        body: JSON.stringify({}),
      });
      expect(noEvents.status).toBe(400);
    });
  });

  test("clears rate-limit window on daemon stop", async () => {
    // Two daemons sharing the same home (and DB row, so the cookie keeps
    // working across restarts). First fills the window in memory; second
    // boots fresh and accepts immediately. Pins limiter is in-memory and
    // cleared on stop, not persisted.
    const cookie = await seedSessionCookie();
    await withDaemon(async (daemon) => {
      for (let i = 0; i < 30; i++) {
        const res = await fetch(`${daemon.url}/api/v1/client-debug`, {
          method: "POST", headers: csrfHeaders(cookie, { "Content-Type": "application/json" }),
          body: JSON.stringify({ events: [{ category: "x" }] }),
        });
        expect(res.status).toBe(200);
      }
    });
    await withDaemon(async (daemon) => {
      const res = await fetch(`${daemon.url}/api/v1/client-debug`, {
        method: "POST", headers: csrfHeaders(cookie, { "Content-Type": "application/json" }),
        body: JSON.stringify({ events: [{ category: "x" }] }),
      });
      expect(res.status).toBe(200);
    });
  });
});
