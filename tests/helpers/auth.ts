import type { Database } from "bun:sqlite";

import { createAuthUser, createSession, createSessionCsrfToken, getAuthUserByUsername } from "../../src/auth-dao.ts";
import { hashPassword } from "../../src/auth-hash.ts";
import { AUTH_COOKIE_NAME, CSRF_HEADER_NAME, hashSessionToken } from "../../src/auth-session.ts";
import { migrateDaemonDb, openDaemonDb } from "../../src/daemon-db.ts";
import { daemonHomePaths } from "../../src/paths.ts";

export async function seedAuthSessionCookie(daemonHome: string): Promise<string> {
  const db = openDaemonDb(daemonHomePaths(daemonHome).daemonDbPath);
  try {
    migrateDaemonDb(db, { daemonHome });
    return await seedAuthSessionCookieInDb(db);
  } finally {
    db.close();
  }
}

export async function seedAuthSessionCookieInDb(db: Database): Promise<string> {
  const token = crypto.randomUUID();
  const user = getAuthUserByUsername(db, "test-user") ?? createAuthUser(db, {
    username: "test-user",
    passwordHash: await hashPassword("correct-password"),
  });
  const session = createSession(db, { userId: user.id, tokenHash: hashSessionToken(token), ttlMs: 60_000 });
  // Test-only shortcut: use the raw session token as the CSRF token so HTTP
  // fixtures can derive the header from their existing Cookie string without
  // learning daemon internals. Production sessions get an independent random
  // CSRF token through createUserSession().
  createSessionCsrfToken(db, session.id, token);
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`;
}

export function csrfTokenFromAuthCookie(cookie: string): string | null {
  for (const part of cookie.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === AUTH_COOKIE_NAME) {
      try { return decodeURIComponent(rawValue.join("=")); } catch { return null; }
    }
  }
  return null;
}

export function authedFetchHeaders(existing: HeadersInit | undefined, cookie: string, method: string | undefined = "GET"): Headers {
  const headers = new Headers(existing);
  if (cookie && !headers.has("Cookie")) headers.set("Cookie", cookie);
  const verb = String(method || "GET").toUpperCase();
  if (cookie && (verb === "POST" || verb === "PUT" || verb === "DELETE" || verb === "PATCH") && !headers.has(CSRF_HEADER_NAME)) {
    const csrfToken = csrfTokenFromAuthCookie(cookie);
    if (csrfToken) headers.set(CSRF_HEADER_NAME, csrfToken);
  }
  return headers;
}
