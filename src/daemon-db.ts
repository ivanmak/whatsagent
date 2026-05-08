import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { DEFAULT_RUNTIME_COMMANDS, normalizeRuntimeCommands, type RuntimeCommands, type RuntimeSettings } from "./db.ts";
import { daemonHomePaths } from "./paths.ts";
import type { HostType } from "./runner/protocol.ts";

type DaemonMigrationLog = (
  level: "info" | "warn" | "error",
  event: string,
  payload: Record<string, unknown>,
) => void;

export interface MigrateDaemonDbOptions {
  /**
   * Daemon-home root (`~/.whatsagent` in production). When provided,
   * migration 3 also wipes orphan slot dirs under `workspaces/` and `trash/`
   * after the row wipe, since those dirs reference the pre-decoupling
   * workspace shape and are unusable under the new schema.
   */
  daemonHome?: string;
  /** Optional structured logger. */
  log?: DaemonMigrationLog;
}

export type WorkspaceStatus =
  | "creating"
  | "active"
  | "deleting"
  | "trashed"
  | "restoring"
  | "purging"
  | "error";

/**
 * EP-022 / WA-092 — per-workspace RBAC enforcement mode. Replaces the
 * daemon-wide `WHATSAGENT_RBAC_HARD_ENFORCE` env-var kill switch (removed
 * in T3 / WA-094). Ordering on the strictness axis is `off < soft < enforce`;
 * the CLI ceiling flag (`--rbac-mode=<x>`, T3) caps a workspace's
 * effective mode at `min(workspace, ceiling)` so an operator can run the
 * whole daemon in `off` for a single launch without losing per-workspace
 * stored modes. See `docs/superpowers/specs/2026-05-04-rbac-design.md`
 * "Per-workspace mode" section.
 */
export const RBAC_MODES = ["enforce", "soft", "off"] as const;
export type RbacMode = (typeof RBAC_MODES)[number];

export function isRbacMode(value: unknown): value is RbacMode {
  return typeof value === "string" && (RBAC_MODES as readonly string[]).includes(value);
}

export interface WorkspaceRow {
  id: string;
  name: string;
  status: WorkspaceStatus;
  trashed_at: string | null;
  status_error: string | null;
  created_at: string;
  updated_at: string;
  /**
   * EP-022 / WA-092: per-workspace RBAC enforcement mode. Defaults to
   * `enforce` for new + existing workspaces; flippable via web UI (T9) or
   * `PATCH /api/v1/workspaces/:id/rbac-mode` (T3).
   */
  rbac_mode: RbacMode;
}

export interface CreateWorkspaceInput {
  id: string;
  name: string;
  /**
   * Optional in T1 (defaults to `enforce` at the schema layer). T3 / WA-094
   * tightens API-layer to reject create/update endpoints when `rbacMode`
   * is absent, so application code should pass an explicit value going
   * forward; the optional shape here exists only for migration safety.
   */
  rbacMode?: RbacMode;
}

export const DAEMON_SETTING_TRASH_RETENTION_DAYS = "workspace_trash_retention_days";
export const DAEMON_SETTING_CURRENT_WORKSPACE_ID = "current_workspace_id";
export const DAEMON_SETTING_RUNTIME_COMMANDS = "runtime.commands";
export const DAEMON_SETTING_RUNTIME_GLOBAL_DEFAULT_HOST = "runtime.global_default_host";
export const DAEMON_SETTING_TUI_REDRAW_WORKAROUND = "tui_redraw_workaround";
export const DAEMON_SETTING_TUI_REDRAW_INTERVAL_SECONDS = "tui_redraw_interval_seconds";

export const DEFAULT_TRASH_RETENTION_DAYS = 30;
export const TUI_REDRAW_WORKAROUNDS = ["off", "on"] as const;
export type TuiRedrawWorkaround = (typeof TUI_REDRAW_WORKAROUNDS)[number];
export interface TuiRedrawSettings {
  workaround: TuiRedrawWorkaround;
}
export const DEFAULT_TUI_REDRAW_SETTINGS: TuiRedrawSettings = { workaround: "on" };

export function nowIso(): string {
  return new Date().toISOString();
}

export function openDaemonDb(dbPath: string): Database {
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new Database(dbPath);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  return db;
}

export function migrateDaemonDb(db: Database, opts: MigrateDaemonDbOptions = {}): void {
  db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  if (!migrationApplied(db, 1)) applyMigration1(db);
  if (!migrationApplied(db, 2)) applyMigration2(db);
  if (!migrationApplied(db, 3)) applyMigration3(db, opts);
  if (!migrationApplied(db, 4)) applyMigration4(db);
  if (!migrationApplied(db, 5)) applyMigration5(db);
  if (!migrationApplied(db, 6)) applyMigration6(db);
  if (!migrationApplied(db, 7)) applyMigration7(db);
  if (!migrationApplied(db, 8)) applyMigration8(db);
}

function migrationApplied(db: Database, version: number): boolean {
  return Boolean(db.query<{ version: number }, [number]>("SELECT version FROM schema_migrations WHERE version = ?").get(version));
}

function applyMigration1(db: Database): void {
  db.transaction(() => {
    db.run(`CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      trashed_at TEXT,
      status_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    // Partial unique indexes: only enforce name/path uniqueness on
    // workspaces visible in the active set. Trashed/purging slots can
    // coexist with new workspaces re-using the same path.
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS workspaces_active_name
      ON workspaces(name) WHERE status NOT IN ('trashed','purging')`);
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS workspaces_active_path
      ON workspaces(path) WHERE status NOT IN ('trashed','purging')`);

    db.run(`CREATE TABLE IF NOT EXISTS daemon_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);

    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)", [nowIso()]);
  })();
}

function applyMigration2(db: Database): void {
  db.transaction(() => {
    const now = nowIso();
    db.run(
      "INSERT INTO daemon_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING",
      [DAEMON_SETTING_RUNTIME_COMMANDS, JSON.stringify(DEFAULT_RUNTIME_COMMANDS), now],
    );
    db.run(
      "INSERT INTO daemon_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING",
      [DAEMON_SETTING_RUNTIME_GLOBAL_DEFAULT_HOST, "", now],
    );
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)", [nowIso()]);
  })();
}

/**
 * Workspace decoupling, phase 1: drop the `path` and `type` columns from
 * `workspaces` plus the path-based active-uniqueness index. Workspaces become
 * pure logical containers; on-disk repos move to per-workspace `workspace_repos`
 * (added by per-workspace migration in WA-058).
 *
 * Alpha break: existing rows are not preserved, since they reference shapes
 * (single-repo / multi-repo, parent-dir-as-path) that the new model has no
 * way to migrate. When `opts.daemonHome` is provided, the migration also
 * wipes orphan slot dirs under `workspaces/` and `trash/` so the filesystem
 * does not retain pre-decoupling per-workspace state that the daemon can
 * neither open nor surface in the UI.
 */
function applyMigration3(db: Database, opts: MigrateDaemonDbOptions): void {
  db.transaction(() => {
    db.run("DROP INDEX IF EXISTS workspaces_active_path");
    db.run("DROP INDEX IF EXISTS workspaces_active_name");
    db.run("DROP TABLE IF EXISTS workspaces_v3_new");
    db.run(`CREATE TABLE workspaces_v3_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      trashed_at TEXT,
      status_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    db.run("DROP TABLE IF EXISTS workspaces");
    db.run("ALTER TABLE workspaces_v3_new RENAME TO workspaces");
    db.run(`CREATE UNIQUE INDEX workspaces_active_name
      ON workspaces(name) WHERE status NOT IN ('trashed','purging')`);
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (3, ?)", [nowIso()]);
  })();

  if (opts.daemonHome) {
    wipeOrphanWorkspaceSlotDirs(opts.daemonHome, opts.log);
  }
}

function applyMigration4(db: Database): void {
  db.transaction(() => {
    db.run(`CREATE TABLE IF NOT EXISTS custom_prompts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL UNIQUE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (4, ?)", [nowIso()]);
  })();
}

function applyMigration5(db: Database): void {
  db.transaction(() => {
    db.run(`CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      recovery_hash TEXT,
      recovery_used_at TEXT,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      user_agent TEXT,
      ip TEXT
    )`);
    db.run("CREATE INDEX IF NOT EXISTS auth_sessions_user_id ON auth_sessions(user_id)");
    db.run("CREATE INDEX IF NOT EXISTS auth_sessions_expires_at ON auth_sessions(expires_at)");
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (5, ?)", [nowIso()]);
  })();
}

function applyMigration6(db: Database): void {
  db.transaction(() => {
    const cols = db.query<{ name: string }, []>("PRAGMA table_info(auth_sessions)").all().map((row) => row.name);
    if (!cols.includes("force_pwd_reset")) {
      db.run("ALTER TABLE auth_sessions ADD COLUMN force_pwd_reset INTEGER NOT NULL DEFAULT 0");
    }
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (6, ?)", [nowIso()]);
  })();
}

/**
 * v7 — EP-022 / WA-092: per-workspace RBAC mode.
 *
 * Adds `rbac_mode` to `workspaces` with `NOT NULL DEFAULT 'enforce'` plus a
 * column-level CHECK enforcing the `enforce | soft | off` enum. Existing
 * rows transparently get `enforce` so behavior on upgrade matches the
 * Phase 4 default-on env-var path; operators that previously ran with
 * `WHATSAGENT_RBAC_HARD_ENFORCE=false` must explicitly flip workspaces to
 * `soft` after this migration (env var removed in WA-094 / T3).
 *
 * Implementation note: `ALTER TABLE … ADD COLUMN` is used rather than a
 * full table rebuild so the existing partial unique index
 * `workspaces_active_name`, FKs, and triggers (none today, but future-
 * proof) survive untouched. SQLite permits CHECK on `ADD COLUMN` and the
 * NOT NULL + DEFAULT pair is the only way to add a non-null column to a
 * populated table. Idempotent: a guard around `PRAGMA table_info` skips
 * re-adding the column if a prior partial run inserted the column but
 * not the schema_migrations row.
 */
function applyMigration7(db: Database): void {
  db.transaction(() => {
    const cols = db.query<{ name: string }, []>("PRAGMA table_info(workspaces)").all().map((row) => row.name);
    if (!cols.includes("rbac_mode")) {
      db.run(
        "ALTER TABLE workspaces ADD COLUMN rbac_mode TEXT NOT NULL DEFAULT 'enforce' CHECK (rbac_mode IN ('enforce', 'soft', 'off'))",
      );
    }
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (7, ?)", [nowIso()]);
  })();
}

/**
 * v8 — WA-161: per-web-session CSRF tokens.
 *
 * Browser state-changing routes are cookie-authenticated, so exact
 * Origin/Referer checks are paired with a nonce that only the legitimate UI
 * receives after login/session establishment. Tokens are separate from the
 * HttpOnly session cookie and cascade when a session is deleted or pruned.
 */
function applyMigration8(db: Database): void {
  db.transaction(() => {
    db.run(`CREATE TABLE IF NOT EXISTS csrf_tokens (
      session_id TEXT PRIMARY KEY REFERENCES auth_sessions(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      issued_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL
    )`);
    db.run("CREATE INDEX IF NOT EXISTS csrf_tokens_last_used_at ON csrf_tokens(last_used_at)");
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (8, ?)", [nowIso()]);
  })();
}

function wipeOrphanWorkspaceSlotDirs(daemonHome: string, log?: DaemonMigrationLog): void {
  const paths = daemonHomePaths(daemonHome);
  let wiped = 0;
  for (const dir of [paths.workspacesDir, paths.trashDir]) {
    if (!existsSync(dir)) continue;
    let children: string[];
    try {
      children = readdirSync(dir);
    } catch (e) {
      log?.("warn", "workspace.migration.read_failed", {
        dir,
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
    for (const child of children) {
      const target = join(dir, child);
      try {
        rmSync(target, { recursive: true, force: true });
        wiped += 1;
      } catch (e) {
        log?.("warn", "workspace.migration.wipe_failed", {
          target,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
  log?.("info", "workspace.migration.wiped", { count: wiped, daemonHome: paths.home });
}

// ---- workspace CRUD ----

export function listWorkspaces(db: Database, opts: { includeTrash?: boolean } = {}): WorkspaceRow[] {
  const sql = opts.includeTrash
    ? "SELECT * FROM workspaces ORDER BY created_at ASC"
    : "SELECT * FROM workspaces WHERE status NOT IN ('trashed','purging') ORDER BY created_at ASC";
  return db.query<WorkspaceRow, []>(sql).all();
}

export function listTrashedWorkspaces(db: Database): WorkspaceRow[] {
  return db.query<WorkspaceRow, []>("SELECT * FROM workspaces WHERE status = 'trashed' ORDER BY trashed_at ASC").all();
}

export function getWorkspace(db: Database, id: string): WorkspaceRow | null {
  return db.query<WorkspaceRow, [string]>("SELECT * FROM workspaces WHERE id = ?").get(id) ?? null;
}

export function getWorkspaceByName(db: Database, name: string): WorkspaceRow | null {
  return db.query<WorkspaceRow, [string]>(
    "SELECT * FROM workspaces WHERE name = ? AND status NOT IN ('trashed','purging') ORDER BY created_at LIMIT 1",
  ).get(name) ?? null;
}

export function insertWorkspace(db: Database, input: CreateWorkspaceInput): WorkspaceRow {
  const now = nowIso();
  const rbacMode: RbacMode = input.rbacMode ?? "enforce";
  db.run(
    "INSERT INTO workspaces (id, name, status, trashed_at, status_error, created_at, updated_at, rbac_mode) VALUES (?, ?, 'creating', NULL, NULL, ?, ?, ?)",
    [input.id, input.name, now, now, rbacMode],
  );
  const row = getWorkspace(db, input.id);
  if (!row) throw new Error("workspace insert failed");
  return row;
}

/**
 * EP-022 / WA-092 DAO: read a workspace's stored RBAC mode. Returns
 * `null` if the workspace doesn't exist; for present-but-unset rows the
 * schema NOT NULL guarantee means this never returns null otherwise.
 */
export function getWorkspaceRbacMode(db: Database, workspaceId: string): RbacMode | null {
  const row = db.query<{ rbac_mode: RbacMode }, [string]>(
    "SELECT rbac_mode FROM workspaces WHERE id = ?",
  ).get(workspaceId);
  return row?.rbac_mode ?? null;
}

/**
 * EP-022 / WA-092 DAO: flip a workspace's stored RBAC mode. The schema
 * CHECK constraint is the safety net — invalid values raise SQLITE_CONSTRAINT
 * here; callers (T3 endpoint, T9 UI) validate beforehand for cleaner errors.
 */
export function setWorkspaceRbacMode(db: Database, workspaceId: string, mode: RbacMode): WorkspaceRow {
  if (!isRbacMode(mode)) {
    throw new Error(`invalid rbac_mode ${mode}; expected one of ${RBAC_MODES.join(", ")}`);
  }
  db.run("UPDATE workspaces SET rbac_mode = ?, updated_at = ? WHERE id = ?", [mode, nowIso(), workspaceId]);
  const row = getWorkspace(db, workspaceId);
  if (!row) throw new Error(`workspace ${workspaceId} disappeared during rbac_mode update`);
  return row;
}

export function updateWorkspaceStatus(
  db: Database,
  id: string,
  status: WorkspaceStatus,
  opts: { trashedAt?: string | null; error?: string | null } = {},
): WorkspaceRow {
  const trashedAt = opts.trashedAt === undefined ? null : opts.trashedAt;
  const error = opts.error === undefined ? null : opts.error;
  // The `trashed_at` column is set explicitly when transitioning to
  // 'trashed'. Other transitions clear it. Caller passes opts.trashedAt
  // when they want to set it explicitly.
  const setTrashedAt = status === "trashed" || opts.trashedAt !== undefined;
  if (setTrashedAt) {
    db.run(
      "UPDATE workspaces SET status = ?, trashed_at = ?, status_error = ?, updated_at = ? WHERE id = ?",
      [status, trashedAt, error, nowIso(), id],
    );
  } else {
    db.run(
      "UPDATE workspaces SET status = ?, status_error = ?, updated_at = ? WHERE id = ?",
      [status, error, nowIso(), id],
    );
  }
  const row = getWorkspace(db, id);
  if (!row) throw new Error(`workspace ${id} disappeared during status update`);
  return row;
}

export function renameWorkspace(db: Database, id: string, name: string): WorkspaceRow {
  db.run("UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?", [name, nowIso(), id]);
  const row = getWorkspace(db, id);
  if (!row) throw new Error(`workspace ${id} disappeared during rename`);
  return row;
}

export function deleteWorkspaceRow(db: Database, id: string): void {
  db.run("DELETE FROM workspaces WHERE id = ?", [id]);
}

// ---- daemon settings ----

export function getDaemonSetting(db: Database, key: string): string | null {
  return db.query<{ value: string }, [string]>("SELECT value FROM daemon_settings WHERE key = ?").get(key)?.value ?? null;
}

export function setDaemonSetting(db: Database, key: string, value: string): void {
  db.run(
    "INSERT INTO daemon_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    [key, value, nowIso()],
  );
}

export function getTrashRetentionDays(db: Database): number {
  const raw = getDaemonSetting(db, DAEMON_SETTING_TRASH_RETENTION_DAYS);
  if (raw == null) return DEFAULT_TRASH_RETENTION_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return DEFAULT_TRASH_RETENTION_DAYS;
  return n;
}

export function setTrashRetentionDays(db: Database, days: number): number {
  if (!Number.isFinite(days) || !Number.isInteger(days) || days < 0) {
    throw new Error("trash retention days must be a non-negative integer (0 = manual-only)");
  }
  setDaemonSetting(db, DAEMON_SETTING_TRASH_RETENTION_DAYS, String(days));
  return days;
}

function isTuiRedrawWorkaround(value: unknown): value is TuiRedrawWorkaround {
  return typeof value === "string" && (TUI_REDRAW_WORKAROUNDS as readonly string[]).includes(value);
}

function coerceStoredTuiRedrawWorkaround(value: string | null): { workaround: TuiRedrawWorkaround; changed: boolean } {
  if (isTuiRedrawWorkaround(value)) return { workaround: value, changed: false };
  if (value === "none") return { workaround: "off", changed: true };
  if (value === "client" || value === "server" || value === "both") return { workaround: "on", changed: true };
  return { workaround: DEFAULT_TUI_REDRAW_SETTINGS.workaround, changed: false };
}

export function getTuiRedrawSettings(db: Database): TuiRedrawSettings {
  const storedWorkaround = getDaemonSetting(db, DAEMON_SETTING_TUI_REDRAW_WORKAROUND);
  const coerced = coerceStoredTuiRedrawWorkaround(storedWorkaround);
  if (coerced.changed) setDaemonSetting(db, DAEMON_SETTING_TUI_REDRAW_WORKAROUND, coerced.workaround);
  return { workaround: coerced.workaround };
}

export function setTuiRedrawSettings(db: Database, input: unknown): TuiRedrawSettings {
  if (!input || typeof input !== "object") throw new Error("tui redraw settings body is required");
  const value = input as Partial<{ workaround: unknown }>;
  if (value.workaround === undefined) throw new Error("tui redraw workaround is required");
  if (!isTuiRedrawWorkaround(value.workaround)) throw new Error("tui redraw workaround must be off or on");
  const next: TuiRedrawSettings = { workaround: value.workaround };
  setDaemonSetting(db, DAEMON_SETTING_TUI_REDRAW_WORKAROUND, next.workaround);
  return next;
}

export function getCurrentWorkspaceId(db: Database): string | null {
  return getDaemonSetting(db, DAEMON_SETTING_CURRENT_WORKSPACE_ID);
}

export function setCurrentWorkspaceId(db: Database, id: string | null): void {
  if (id == null) {
    db.run("DELETE FROM daemon_settings WHERE key = ?", [DAEMON_SETTING_CURRENT_WORKSPACE_ID]);
    return;
  }
  setDaemonSetting(db, DAEMON_SETTING_CURRENT_WORKSPACE_ID, id);
}

export function generateWorkspaceId(): string {
  // Compact monotonic-ish id. Using crypto.randomUUID without dashes keeps
  // it filesystem-safe and 32 chars wide.
  return crypto.randomUUID().replace(/-/g, "");
}

// ---- daemon-global runtime commands ----
//
// Phase 2 moves runtime commands from per-workspace settings into the
// daemon-global daemon_settings row keyed by DAEMON_SETTING_RUNTIME_COMMANDS.
// The serialized JSON shape is the same as the per-workspace key from
// Phase 1 — we reuse normalizeRuntimeCommands so an existing payload
// validates identically.

export function getDaemonRuntimeCommands(db: Database): RuntimeCommands {
  const stored = getDaemonSetting(db, DAEMON_SETTING_RUNTIME_COMMANDS);
  if (!stored) return DEFAULT_RUNTIME_COMMANDS;
  try {
    return normalizeRuntimeCommands(JSON.parse(stored), DEFAULT_RUNTIME_COMMANDS);
  } catch {
    return DEFAULT_RUNTIME_COMMANDS;
  }
}

export function setDaemonRuntimeCommands(db: Database, input: unknown): RuntimeCommands {
  const next = normalizeRuntimeCommands(input, getDaemonRuntimeCommands(db));
  setDaemonSetting(db, DAEMON_SETTING_RUNTIME_COMMANDS, JSON.stringify(next));
  return next;
}

function normalizeDaemonGlobalDefaultHost(input: unknown): HostType | null {
  if (input === null || input === undefined || input === "" || input === "default") return null;
  if (input === "claude-code" || input === "opencode" || input === "codex" || input === "pi") return input;
  throw new Error("global default runtime must be claude-code, opencode, codex, pi, default, or null");
}

export function getDaemonGlobalDefaultHost(db: Database): HostType | null {
  try {
    return normalizeDaemonGlobalDefaultHost(getDaemonSetting(db, DAEMON_SETTING_RUNTIME_GLOBAL_DEFAULT_HOST));
  } catch {
    return null;
  }
}

export function setDaemonGlobalDefaultHost(db: Database, host: unknown): HostType | null {
  const next = normalizeDaemonGlobalDefaultHost(host);
  setDaemonSetting(db, DAEMON_SETTING_RUNTIME_GLOBAL_DEFAULT_HOST, next ?? "");
  return next;
}

export function getDaemonRuntimeSettings(db: Database): RuntimeSettings {
  return {
    globalDefaultHost: getDaemonGlobalDefaultHost(db),
    commands: getDaemonRuntimeCommands(db),
  };
}

export function setDaemonRuntimeSettings(db: Database, input: unknown): RuntimeSettings {
  const value = input && typeof input === "object" ? input as Partial<{ globalDefaultHost: unknown; commands: unknown }> : {};
  const globalDefaultHost = setDaemonGlobalDefaultHost(db, value.globalDefaultHost);
  const commands = setDaemonRuntimeCommands(db, value.commands);
  return { globalDefaultHost, commands };
}
