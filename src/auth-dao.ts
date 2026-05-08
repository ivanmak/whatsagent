import type { Database } from "bun:sqlite";

import { nowIso } from "./daemon-db.ts";

export interface AuthUserRow {
  id: string;
  username: string;
  password_hash: string;
  recovery_hash: string | null;
  recovery_used_at: string | null;
  failed_attempts: number;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthSessionRow {
  id: string;
  token_hash: string;
  user_id: string;
  expires_at: string;
  created_at: string;
  last_seen_at: string;
  user_agent: string | null;
  ip: string | null;
  force_pwd_reset: number;
}

export interface AuthCsrfTokenRow {
  session_id: string;
  token: string;
  issued_at: string;
  last_used_at: string;
}

export interface CreateAuthUserInput {
  username: string;
  passwordHash: string;
  recoveryHash?: string | null;
}

export interface CreateAuthSessionInput {
  userId: string;
  tokenHash: string;
  ttlMs: number;
  userAgent?: string | null;
  ip?: string | null;
  forcePwdReset?: boolean;
}

export function listAuthUsers(db: Database): AuthUserRow[] {
  return db.query<AuthUserRow, []>("SELECT * FROM auth_users ORDER BY created_at ASC").all();
}

export function countAuthUsers(db: Database): number {
  return db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM auth_users").get()?.count ?? 0;
}

export function getAuthUserByUsername(db: Database, username: string): AuthUserRow | null {
  return db.query<AuthUserRow, [string]>("SELECT * FROM auth_users WHERE username = ?").get(username) ?? null;
}

export function getAuthUserById(db: Database, id: string): AuthUserRow | null {
  return db.query<AuthUserRow, [string]>("SELECT * FROM auth_users WHERE id = ?").get(id) ?? null;
}

export function createAuthUser(db: Database, input: CreateAuthUserInput): AuthUserRow {
  const username = normalizeUsername(input.username);
  if (!input.passwordHash) throw new Error("passwordHash is required");
  const now = nowIso();
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO auth_users (id, username, password_hash, recovery_hash, recovery_used_at, failed_attempts, locked_until, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, 0, NULL, ?, ?)`,
    [id, username, input.passwordHash, input.recoveryHash ?? null, now, now],
  );
  const row = getAuthUserById(db, id);
  if (!row) throw new Error("auth user insert failed");
  return row;
}

export function updateAuthUserPassword(db: Database, id: string, passwordHash: string): AuthUserRow {
  if (!passwordHash) throw new Error("passwordHash is required");
  db.run("UPDATE auth_users SET password_hash = ?, updated_at = ? WHERE id = ?", [passwordHash, nowIso(), id]);
  const row = getAuthUserById(db, id);
  if (!row) throw new Error("auth user not found");
  return row;
}

export function consumeRecovery(db: Database, id: string, expectedHash?: string): AuthUserRow {
  const now = nowIso();
  const result = expectedHash
    ? db.run("UPDATE auth_users SET recovery_hash = NULL, recovery_used_at = ?, updated_at = ? WHERE id = ? AND recovery_hash = ?", [now, now, id, expectedHash])
    : db.run("UPDATE auth_users SET recovery_hash = NULL, recovery_used_at = ?, updated_at = ? WHERE id = ? AND recovery_hash IS NOT NULL", [now, now, id]);
  if (result.changes !== 1) throw new Error("recovery already used");
  const row = getAuthUserById(db, id);
  if (!row) throw new Error("auth user not found");
  return row;
}

export function regenerateRecovery(db: Database, id: string, newHash: string): AuthUserRow {
  if (!newHash) throw new Error("recovery hash is required");
  db.run("UPDATE auth_users SET recovery_hash = ?, recovery_used_at = NULL, updated_at = ? WHERE id = ?", [newHash, nowIso(), id]);
  const row = getAuthUserById(db, id);
  if (!row) throw new Error("auth user not found");
  return row;
}

export function incFailedAttempts(db: Database, id: string): AuthUserRow {
  db.run("UPDATE auth_users SET failed_attempts = failed_attempts + 1, updated_at = ? WHERE id = ?", [nowIso(), id]);
  const row = getAuthUserById(db, id);
  if (!row) throw new Error("auth user not found");
  return row;
}

export function resetFailedAttempts(db: Database, id: string): AuthUserRow {
  db.run("UPDATE auth_users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?", [nowIso(), id]);
  const row = getAuthUserById(db, id);
  if (!row) throw new Error("auth user not found");
  return row;
}

export function setLockedUntil(db: Database, id: string, iso: string | null): AuthUserRow {
  db.run("UPDATE auth_users SET locked_until = ?, updated_at = ? WHERE id = ?", [iso, nowIso(), id]);
  const row = getAuthUserById(db, id);
  if (!row) throw new Error("auth user not found");
  return row;
}

export function createSession(db: Database, input: CreateAuthSessionInput): AuthSessionRow {
  if (!input.userId) throw new Error("userId is required");
  if (!input.tokenHash) throw new Error("tokenHash is required");
  if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0) throw new Error("ttlMs must be positive");
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + input.ttlMs).toISOString();
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO auth_sessions (id, token_hash, user_id, expires_at, created_at, last_seen_at, user_agent, ip, force_pwd_reset)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.tokenHash, input.userId, expiresAt, now, now, input.userAgent ?? null, input.ip ?? null, input.forcePwdReset ? 1 : 0],
  );
  const row = db.query<AuthSessionRow, [string]>("SELECT * FROM auth_sessions WHERE id = ?").get(id) ?? null;
  if (!row) throw new Error("auth session insert failed");
  return row;
}

export function getSessionById(db: Database, id: string): AuthSessionRow | null {
  return getLiveSession(db, "id", id);
}

export function getSessionByTokenHash(db: Database, tokenHash: string): AuthSessionRow | null {
  return getLiveSession(db, "token_hash", tokenHash);
}

export function touchSession(db: Database, id: string, lastSeenAt: string, expiresAt: string): AuthSessionRow {
  db.run("UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?", [lastSeenAt, expiresAt, id]);
  const row = getSessionById(db, id);
  if (!row) throw new Error("auth session not found");
  return row;
}

export function listSessionsForUser(db: Database, userId: string): AuthSessionRow[] {
  return db.query<AuthSessionRow, [string, string]>("SELECT * FROM auth_sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC").all(userId, nowIso());
}

export function clearSessionForcePwdReset(db: Database, id: string): AuthSessionRow {
  db.run("UPDATE auth_sessions SET force_pwd_reset = 0 WHERE id = ?", [id]);
  const row = getSessionById(db, id);
  if (!row) throw new Error("auth session not found");
  return row;
}

export function deleteSession(db: Database, id: string): boolean {
  return db.run("DELETE FROM auth_sessions WHERE id = ?", [id]).changes > 0;
}

export function deleteSessionsForUser(db: Database, userId: string, exceptSessionId?: string): number {
  const result = exceptSessionId
    ? db.run("DELETE FROM auth_sessions WHERE user_id = ? AND id != ?", [userId, exceptSessionId])
    : db.run("DELETE FROM auth_sessions WHERE user_id = ?", [userId]);
  return result.changes;
}

export function pruneExpiredSessions(db: Database, now: string = nowIso()): number {
  return db.run("DELETE FROM auth_sessions WHERE expires_at <= ?", [now]).changes;
}

export function createSessionCsrfToken(db: Database, sessionId: string, token: string): AuthCsrfTokenRow {
  if (!sessionId) throw new Error("sessionId is required");
  if (!token) throw new Error("csrf token is required");
  const now = nowIso();
  db.run(
    `INSERT INTO csrf_tokens (session_id, token, issued_at, last_used_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET token = excluded.token, issued_at = excluded.issued_at, last_used_at = excluded.last_used_at`,
    [sessionId, token, now, now],
  );
  const row = getSessionCsrfToken(db, sessionId);
  if (!row) throw new Error("csrf token insert failed");
  return row;
}

export function getSessionCsrfToken(db: Database, sessionId: string): AuthCsrfTokenRow | null {
  return db.query<AuthCsrfTokenRow, [string]>("SELECT * FROM csrf_tokens WHERE session_id = ?").get(sessionId) ?? null;
}

export function touchSessionCsrfToken(db: Database, sessionId: string, lastUsedAt: string = nowIso()): boolean {
  return db.run("UPDATE csrf_tokens SET last_used_at = ? WHERE session_id = ?", [lastUsedAt, sessionId]).changes > 0;
}

export function deleteSessionCsrfToken(db: Database, sessionId: string): boolean {
  return db.run("DELETE FROM csrf_tokens WHERE session_id = ?", [sessionId]).changes > 0;
}

function getLiveSession(db: Database, column: "id" | "token_hash", value: string): AuthSessionRow | null {
  const row = db.query<AuthSessionRow, [string]>(`SELECT * FROM auth_sessions WHERE ${column} = ?`).get(value) ?? null;
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    deleteSession(db, row.id);
    return null;
  }
  return row;
}

function normalizeUsername(value: string): string {
  const username = value.trim();
  if (!username) throw new Error("username is required");
  if (username.length > 120) throw new Error("username must be 1-120 characters");
  return username;
}
