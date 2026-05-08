import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  consumeRecovery,
  countAuthUsers,
  createAuthUser,
  createSession,
  deleteSession,
  deleteSessionsForUser,
  getAuthUserById,
  getAuthUserByUsername,
  getSessionById,
  getSessionByTokenHash,
  incFailedAttempts,
  listSessionsForUser,
  listAuthUsers,
  pruneExpiredSessions,
  regenerateRecovery,
  resetFailedAttempts,
  setLockedUntil,
  touchSession,
  updateAuthUserPassword,
} from "../src/auth-dao.ts";
import { hashPassword, verifyPassword } from "../src/auth-hash.ts";
import { migrateDaemonDb, openDaemonDb } from "../src/daemon-db.ts";
import { daemonHomePaths } from "../src/paths.ts";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "wa-auth-dao-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("auth DAO", () => {
  test("hashes and verifies argon2id encoded password strings", async () => {
    const encoded = await hashPassword("correct horse battery staple");
    expect(encoded).toStartWith("$argon2id$");
    expect(await verifyPassword(encoded, "correct horse battery staple")).toBe(true);
    expect(await verifyPassword(encoded, "wrong")).toBe(false);
  });

  test("creates and updates auth users", () => {
    const db = openDaemonDb(daemonHomePaths(home).daemonDbPath);
    try {
      migrateDaemonDb(db);
      const user = createAuthUser(db, {
        username: " ivan ",
        passwordHash: "$argon2id$password",
        recoveryHash: "$argon2id$recovery",
      });

      expect(countAuthUsers(db)).toBe(1);
      expect(listAuthUsers(db).map((row) => row.username)).toEqual(["ivan"]);
      expect(getAuthUserByUsername(db, "ivan")?.id).toBe(user.id);
      expect(getAuthUserById(db, user.id)).toMatchObject({ failed_attempts: 0, locked_until: null });

      expect(updateAuthUserPassword(db, user.id, "$argon2id$new").password_hash).toBe("$argon2id$new");
      expect(incFailedAttempts(db, user.id).failed_attempts).toBe(1);
      expect(setLockedUntil(db, user.id, "2026-01-01T00:00:00.000Z").locked_until).toBe("2026-01-01T00:00:00.000Z");
      expect(resetFailedAttempts(db, user.id)).toMatchObject({ failed_attempts: 0, locked_until: null });
      expect(consumeRecovery(db, user.id)).toMatchObject({ recovery_hash: null });
      expect(() => consumeRecovery(db, user.id)).toThrow("recovery already used");
      expect(regenerateRecovery(db, user.id, "$argon2id$regen")).toMatchObject({ recovery_hash: "$argon2id$regen", recovery_used_at: null });
    } finally {
      db.close();
    }
  });

  test("creates, touches, prunes, and deletes hashed-token sessions", () => {
    const db = openDaemonDb(daemonHomePaths(home).daemonDbPath);
    try {
      migrateDaemonDb(db);
      const user = createAuthUser(db, { username: "ivan", passwordHash: "$argon2id$password" });
      const session = createSession(db, {
        userId: user.id,
        tokenHash: "sha256:session-token",
        ttlMs: 60_000,
        userAgent: "bun:test",
        ip: "127.0.0.1",
      });

      expect(session.token_hash).toBe("sha256:session-token");
      expect(getSessionById(db, session.id)?.user_id).toBe(user.id);
      expect(getSessionByTokenHash(db, "sha256:session-token")?.id).toBe(session.id);

      const touched = touchSession(db, session.id, "2026-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z");
      expect(touched.last_seen_at).toBe("2026-01-01T00:00:00.000Z");
      expect(createSession(db, { userId: user.id, tokenHash: "sha256:other", ttlMs: 1 })).toBeTruthy();
      db.run("UPDATE auth_sessions SET expires_at = ? WHERE token_hash = ?", ["2000-01-01T00:00:00.000Z", "sha256:other"]);
      expect(listSessionsForUser(db, user.id).map((row) => row.id)).toEqual([session.id]);
      expect(pruneExpiredSessions(db, "2099-01-01T00:00:00.000Z")).toBeGreaterThanOrEqual(1);
      expect(deleteSessionsForUser(db, user.id, session.id)).toBe(0);
      expect(deleteSession(db, session.id)).toBe(true);
      expect(deleteSession(db, session.id)).toBe(false);
    } finally {
      db.close();
    }
  });

  test("expired sessions are removed on lookup", () => {
    const db = openDaemonDb(daemonHomePaths(home).daemonDbPath);
    try {
      migrateDaemonDb(db);
      const user = createAuthUser(db, { username: "ivan", passwordHash: "$argon2id$password" });
      const session = createSession(db, { userId: user.id, tokenHash: "expired", ttlMs: 1 });
      db.run("UPDATE auth_sessions SET expires_at = ? WHERE id = ?", ["2000-01-01T00:00:00.000Z", session.id]);
      expect(getSessionById(db, session.id)).toBeNull();
      expect(db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM auth_sessions").get()?.count).toBe(0);
    } finally {
      db.close();
    }
  });
});
