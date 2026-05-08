import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Database } from "bun:sqlite";

import { createSession, createSessionCsrfToken, getAuthUserById, getSessionByTokenHash, getSessionCsrfToken, touchSession, touchSessionCsrfToken, type AuthSessionRow, type AuthUserRow } from "./auth-dao.ts";

export const AUTH_COOKIE_NAME = "wa_sid";
export const CSRF_HEADER_NAME = "X-WhatsAgent-CSRF";
export const CSRF_QUERY_PARAM = "csrf";
export const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const AUTH_SESSION_ROLLING_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthSessionContext {
  user: AuthUserRow;
  session: AuthSessionRow;
  csrfToken: string;
  refreshedToken?: string;
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createUserSession(db: Database, input: { userId: string; req?: Request; forcePwdReset?: boolean }): { token: string; session: AuthSessionRow; csrfToken: string } {
  const token = createSessionToken();
  const session = createSession(db, {
    userId: input.userId,
    tokenHash: hashSessionToken(token),
    ttlMs: AUTH_SESSION_TTL_MS,
    userAgent: input.req?.headers.get("user-agent") ?? null,
    ip: clientIp(input.req),
    forcePwdReset: input.forcePwdReset,
  });
  const csrfToken = createCsrfToken();
  createSessionCsrfToken(db, session.id, csrfToken);
  return { token, session, csrfToken };
}

export function requireSession(db: Database, req: Request): AuthSessionContext | null {
  const token = getCookie(req.headers.get("cookie") ?? "", AUTH_COOKIE_NAME);
  if (!token) return null;
  let session = getSessionByTokenHash(db, hashSessionToken(token));
  if (!session) return null;
  const user = getAuthUserById(db, session.user_id);
  if (!user) return null;
  const csrfToken = ensureSessionCsrfToken(db, session.id);
  const remainingMs = Date.parse(session.expires_at) - Date.now();
  if (remainingMs > 0 && remainingMs <= AUTH_SESSION_ROLLING_REFRESH_MS) {
    session = touchSession(db, session.id, new Date().toISOString(), new Date(Date.now() + AUTH_SESSION_TTL_MS).toISOString());
    return { user, session, csrfToken, refreshedToken: token };
  }
  return { user, session, csrfToken };
}

export function csrfTokenFromRequest(req: Request, url?: URL): string | null {
  const header = req.headers.get(CSRF_HEADER_NAME);
  if (header) return header;
  const query = url?.searchParams.get(CSRF_QUERY_PARAM);
  return query || null;
}

export function validateCsrfTokenForSession(db: Database, sessionId: string, suppliedToken: string | null | undefined): boolean {
  if (!sessionId || !suppliedToken) return false;
  const row = getSessionCsrfToken(db, sessionId);
  if (!row) return false;
  if (!constantTimeStringEqual(row.token, suppliedToken)) return false;
  touchSessionCsrfToken(db, sessionId);
  return true;
}

export function attachSessionCookie(headers: Headers, token: string, req?: Request): void {
  headers.append("Set-Cookie", serializeCookie(AUTH_COOKIE_NAME, token, {
    maxAge: Math.floor(AUTH_SESSION_TTL_MS / 1000),
    httpOnly: true,
    sameSite: "Lax",
    secure: isHttpsRequest(req),
    path: "/",
  }));
}

export function clearSessionCookie(headers: Headers, req?: Request): void {
  headers.append("Set-Cookie", serializeCookie(AUTH_COOKIE_NAME, "", {
    maxAge: 0,
    httpOnly: true,
    sameSite: "Lax",
    secure: isHttpsRequest(req),
    path: "/",
  }));
}

function ensureSessionCsrfToken(db: Database, sessionId: string): string {
  const existing = getSessionCsrfToken(db, sessionId);
  if (existing) return existing.token;
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = createCsrfToken();
    try {
      return createSessionCsrfToken(db, sessionId, token).token;
    } catch (e) {
      if (String(e).includes("UNIQUE")) continue;
      throw e;
    }
  }
  return createSessionCsrfToken(db, sessionId, createCsrfToken()).token;
}

function constantTimeStringEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function getCookie(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) {
      try { return decodeURIComponent(rawValue.join("=")); } catch { return null; }
    }
  }
  return null;
}

function serializeCookie(name: string, value: string, opts: { maxAge: number; httpOnly: boolean; sameSite: "Lax"; secure: boolean; path: string }): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Max-Age=${opts.maxAge}`, `Path=${opts.path}`, `SameSite=${opts.sameSite}`];
  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

function isHttpsRequest(req?: Request): boolean {
  if (!req) return false;
  return new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
}

function clientIp(req?: Request): string | null {
  return req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req?.headers.get("x-real-ip") || null;
}
