import type { Database } from "bun:sqlite";
import { existsSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { sanitizeRoleName } from "./config.ts";
import { nowIso } from "./db.ts";
import type { HostType } from "./runner/protocol.ts";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface WorkspaceRepoRow {
  id: string;
  name: string;
  absolute_path: string;
  git_root: string | null;
  source_scan_id: string | null;
  missing_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceScanDirRow {
  id: string;
  absolute_path: string;
  scan_on_startup: number;
  last_scan_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentByRepoRow {
  id: string;
  repo_id: string;
  name: string;
  host_default: HostType;
  default_host_type: HostType | null;
  created_at: string;
  updated_at: string;
}

export interface AgentWithDisplayRow extends AgentByRepoRow {
  repo_name: string;
  repo_absolute_path: string;
  repo_git_root: string | null;
  repo_missing_at: string | null;
  display_id: string;
}

/** RBAC Phase 1 alias — prefer `AgentByRepoRow` in new code. */
export type RoleByRepoRow = AgentByRepoRow;
/** RBAC Phase 1 alias — prefer `AgentWithDisplayRow` in new code. */
export type RoleWithDisplayRow = AgentWithDisplayRow;

export interface RepoCreateInput {
  absolutePath: string;
  name?: string;
  sourceScanId?: string | null;
}

export interface ScanDirCreateInput {
  absolutePath: string;
  scanOnStartup?: boolean;
}

export interface AgentCreateInput {
  repoId: string;
  name: string;
  host?: HostType | null;
}

/** RBAC Phase 1 alias — prefer `AgentCreateInput` in new code. */
export type RoleCreateInput = AgentCreateInput;

export interface ParsedAgentAddress {
  repoName: string;
  /** Bare agent name (legacy field name retained for back-compat with callers). */
  roleName: string;
}

/** RBAC Phase 1 alias — prefer `ParsedAgentAddress` in new code. */
export type ParsedRoleAddress = ParsedAgentAddress;

// -----------------------------------------------------------------------------
// Address helpers
// -----------------------------------------------------------------------------

/**
 * Build the canonical `repo:role` display id used everywhere outside the DB
 * (DM target, channel mention, kanban assignee, MCP `to_role` arg, web URL).
 */
export function buildRoleDisplayId(repoName: string, roleName: string): string {
  return `${repoName}:${roleName}`;
}

/**
 * Parse a `repo:role` address. Splits on the FIRST `:` only. Both sides must
 * be non-empty and pass the sanitiser shape (alphanumeric + `_-`). Embedded
 * extra `:` characters or leading/trailing colons are rejected. Throws an
 * Error with a stable message on any failure so handlers can surface it as
 * HTTP 400.
 */
export function parseRoleAddress(address: string): ParsedRoleAddress {
  if (typeof address !== "string" || address.length === 0) {
    throw new Error("role address is required");
  }
  const idx = address.indexOf(":");
  if (idx <= 0 || idx === address.length - 1) {
    throw new Error(`role address must be 'repo:role': ${JSON.stringify(address)}`);
  }
  const repoName = address.slice(0, idx);
  const roleName = address.slice(idx + 1);
  if (repoName.includes(":") || roleName.includes(":")) {
    throw new Error(`role address must contain exactly one ':': ${JSON.stringify(address)}`);
  }
  if (sanitizeRoleName(repoName) !== repoName) {
    throw new Error(`repo name has illegal characters: ${JSON.stringify(repoName)}`);
  }
  if (sanitizeRoleName(roleName) !== roleName) {
    throw new Error(`role name has illegal characters: ${JSON.stringify(roleName)}`);
  }
  return { repoName, roleName };
}

// -----------------------------------------------------------------------------
// Scan-dir DAO
// -----------------------------------------------------------------------------

export function insertScanDir(db: Database, input: ScanDirCreateInput): WorkspaceScanDirRow {
  const absolutePath = resolve(input.absolutePath);
  const ts = nowIso();
  const id = randomUUID();
  db.run(
    `INSERT INTO workspace_scan_dirs (id, absolute_path, scan_on_startup, last_scan_at, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?)`,
    [id, absolutePath, input.scanOnStartup ? 1 : 0, ts, ts],
  );
  const row = getScanDirById(db, id);
  if (!row) throw new Error("scan-dir insert failed");
  return row;
}

export function listScanDirs(db: Database): WorkspaceScanDirRow[] {
  return db.query<WorkspaceScanDirRow, []>(
    `SELECT id, absolute_path, scan_on_startup, last_scan_at, created_at, updated_at
     FROM workspace_scan_dirs ORDER BY created_at ASC`,
  ).all();
}

export function getScanDirById(db: Database, id: string): WorkspaceScanDirRow | null {
  return db.query<WorkspaceScanDirRow, [string]>(
    `SELECT id, absolute_path, scan_on_startup, last_scan_at, created_at, updated_at
     FROM workspace_scan_dirs WHERE id = ?`,
  ).get(id) ?? null;
}

export function setScanDirStartup(db: Database, id: string, scanOnStartup: boolean): WorkspaceScanDirRow {
  const ts = nowIso();
  db.run(
    `UPDATE workspace_scan_dirs SET scan_on_startup = ?, updated_at = ? WHERE id = ?`,
    [scanOnStartup ? 1 : 0, ts, id],
  );
  const row = getScanDirById(db, id);
  if (!row) throw new Error(`scan-dir ${id} not found`);
  return row;
}

export function deleteScanDir(db: Database, id: string): boolean {
  const before = getScanDirById(db, id);
  if (!before) return false;
  db.run("DELETE FROM workspace_scan_dirs WHERE id = ?", [id]);
  return true;
}

// -----------------------------------------------------------------------------
// Repo DAO (DB-level only — caller is responsible for stopping runners
// before deleting a repo or role; runner-stop hook lives at the API layer)
// -----------------------------------------------------------------------------

export function insertRepo(db: Database, input: RepoCreateInput): WorkspaceRepoRow {
  const absolutePath = resolve(input.absolutePath);
  const defaultName = sanitizeRoleName(basename(absolutePath));
  const name = input.name ? sanitizeRoleName(input.name) : (defaultName || "repo");
  if (!name) throw new Error("repo name resolved to empty after sanitisation");
  const ts = nowIso();
  const id = randomUUID();
  const gitRoot = detectGitRoot(absolutePath);
  const sourceScanId = input.sourceScanId ?? null;
  db.run(
    `INSERT INTO workspace_repos (id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
    [id, name, absolutePath, gitRoot, sourceScanId, ts, ts],
  );
  const row = getRepoById(db, id);
  if (!row) throw new Error("repo insert failed");
  return row;
}

export function listRepos(db: Database): WorkspaceRepoRow[] {
  return db.query<WorkspaceRepoRow, []>(
    `SELECT id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at
     FROM workspace_repos ORDER BY created_at ASC`,
  ).all();
}

export function getRepoById(db: Database, id: string): WorkspaceRepoRow | null {
  return db.query<WorkspaceRepoRow, [string]>(
    `SELECT id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at
     FROM workspace_repos WHERE id = ?`,
  ).get(id) ?? null;
}

export function getRepoByPath(db: Database, absolutePath: string): WorkspaceRepoRow | null {
  return db.query<WorkspaceRepoRow, [string]>(
    `SELECT id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at
     FROM workspace_repos WHERE absolute_path = ?`,
  ).get(resolve(absolutePath)) ?? null;
}

export function getRepoByName(db: Database, name: string): WorkspaceRepoRow | null {
  return db.query<WorkspaceRepoRow, [string]>(
    `SELECT id, name, absolute_path, git_root, source_scan_id, missing_at, created_at, updated_at
     FROM workspace_repos WHERE name = ?`,
  ).get(name) ?? null;
}

export function renameRepo(db: Database, id: string, newName: string): WorkspaceRepoRow {
  const sanitized = sanitizeRoleName(newName);
  if (!sanitized) throw new Error("repo name resolved to empty after sanitisation");
  const collider = getRepoByName(db, sanitized);
  if (collider && collider.id !== id) {
    throw new Error(`repo name "${sanitized}" already in use`);
  }
  db.run("UPDATE workspace_repos SET name = ?, updated_at = ? WHERE id = ?", [sanitized, nowIso(), id]);
  const row = getRepoById(db, id);
  if (!row) throw new Error(`repo ${id} not found`);
  return row;
}

export function deleteRepo(db: Database, id: string): boolean {
  const row = getRepoById(db, id);
  if (!row) return false;
  db.run("DELETE FROM workspace_repos WHERE id = ?", [id]);
  return true;
}

export function markRepoMissing(db: Database, id: string, isMissing: boolean): WorkspaceRepoRow | null {
  const ts = nowIso();
  if (isMissing) {
    db.run("UPDATE workspace_repos SET missing_at = COALESCE(missing_at, ?), updated_at = ? WHERE id = ?", [ts, ts, id]);
  } else {
    db.run("UPDATE workspace_repos SET missing_at = NULL, updated_at = ? WHERE id = ?", [ts, id]);
  }
  return getRepoById(db, id);
}

export function refreshRepoMeta(db: Database, id: string): WorkspaceRepoRow | null {
  const row = getRepoById(db, id);
  if (!row) return null;
  const ts = nowIso();
  const present = existsSync(row.absolute_path);
  const gitRoot = present ? detectGitRoot(row.absolute_path) : row.git_root;
  const missingAt = present ? null : (row.missing_at ?? ts);
  db.run(
    "UPDATE workspace_repos SET git_root = ?, missing_at = ?, updated_at = ? WHERE id = ?",
    [gitRoot, missingAt, ts, id],
  );
  return getRepoById(db, id);
}

function detectGitRoot(absolutePath: string): string | null {
  return existsSync(join(absolutePath, ".git")) ? absolutePath : null;
}

// -----------------------------------------------------------------------------
// Repo scan: walk a scan-dir's immediate children, filter to project markers,
// dedupe against existing repos, insert new ones with `source_scan_id`.
// -----------------------------------------------------------------------------

/**
 * Files / directories whose presence in an immediate child of a scan dir
 * marks that child as a candidate repo. Manual `insertRepo` does not require
 * any of these (any existing dir is acceptable); only auto-scan filters.
 */
export const SCAN_REPO_MARKERS: ReadonlyArray<string> = [
  ".git",
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
];

export interface ScanRunResult {
  added: WorkspaceRepoRow[];
  skipped: string[];
}

/**
 * Run a scan against the absolute path stored on `workspace_scan_dirs`.
 * Returns the newly-added repos plus a `skipped` list for paths that were
 * filtered out (no marker), already registered, or unreadable. Updates
 * `last_scan_at` on the scan-dir row regardless of the count.
 */
export function runScanDir(db: Database, scanId: string): ScanRunResult {
  const scan = getScanDirById(db, scanId);
  if (!scan) throw new Error(`scan-dir ${scanId} not found`);
  const added: WorkspaceRepoRow[] = [];
  const skipped: string[] = [];

  if (!existsSync(scan.absolute_path)) {
    db.run("UPDATE workspace_scan_dirs SET last_scan_at = ?, updated_at = ? WHERE id = ?",
      [nowIso(), nowIso(), scanId]);
    return { added, skipped: [scan.absolute_path] };
  }

  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(scan.absolute_path, { withFileTypes: true });
  } catch {
    db.run("UPDATE workspace_scan_dirs SET last_scan_at = ?, updated_at = ? WHERE id = ?",
      [nowIso(), nowIso(), scanId]);
    return { added, skipped: [scan.absolute_path] };
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    const candidate = join(scan.absolute_path, entry.name);
    if (!hasRepoMarker(candidate)) {
      skipped.push(candidate);
      continue;
    }
    if (getRepoByPath(db, candidate)) {
      skipped.push(candidate);
      continue;
    }
    try {
      const row = insertRepo(db, { absolutePath: candidate, sourceScanId: scanId });
      added.push(row);
    } catch (e) {
      // Most likely cause: name collision with an existing repo.
      // Auto-suffix to keep scan idempotent under name-clash conditions.
      const base = sanitizeRoleName(basename(candidate)) || "repo";
      let attempt = 2;
      let inserted: WorkspaceRepoRow | null = null;
      while (attempt < 100) {
        try {
          inserted = insertRepo(db, { absolutePath: candidate, sourceScanId: scanId, name: `${base}-${attempt}` });
          break;
        } catch {
          attempt += 1;
        }
      }
      if (inserted) added.push(inserted);
      else skipped.push(candidate);
      void e;
    }
  }

  const ts = nowIso();
  db.run("UPDATE workspace_scan_dirs SET last_scan_at = ?, updated_at = ? WHERE id = ?", [ts, ts, scanId]);
  return { added, skipped };
}

function hasRepoMarker(absolutePath: string): boolean {
  for (const marker of SCAN_REPO_MARKERS) {
    if (existsSync(join(absolutePath, marker))) return true;
  }
  return false;
}

// -----------------------------------------------------------------------------
// Role DAO (new shape — repo_id-scoped, UNIQUE(repo_id, name))
// -----------------------------------------------------------------------------

const ROLE_WITH_REPO_SELECT = `SELECT
    r.id              AS id,
    r.repo_id         AS repo_id,
    r.name            AS name,
    r.host_default    AS host_default,
    r.default_host_type AS default_host_type,
    r.created_at      AS created_at,
    r.updated_at      AS updated_at,
    p.name            AS repo_name,
    p.absolute_path   AS repo_absolute_path,
    p.git_root        AS repo_git_root,
    p.missing_at      AS repo_missing_at,
    p.name || ':' || r.name AS display_id
  FROM agents r
  JOIN workspace_repos p ON p.id = r.repo_id`;

export function insertRole(db: Database, input: RoleCreateInput): RoleWithDisplayRow {
  const sanitized = sanitizeRoleName(input.name);
  if (!sanitized) throw new Error("role name resolved to empty after sanitisation");
  const repo = getRepoById(db, input.repoId);
  if (!repo) throw new Error(`repo ${input.repoId} not found`);
  const collider = db.query<{ id: string }, [string, string]>(
    "SELECT id FROM agents WHERE repo_id = ? AND name = ?",
  ).get(input.repoId, sanitized);
  if (collider) throw new Error(`role "${sanitized}" already exists in repo ${repo.name}`);
  const ts = nowIso();
  const id = randomUUID();
  const host = input.host ?? null;
  db.run(
    `INSERT INTO agents (id, repo_id, name, host_default, default_host_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.repoId, sanitized, host ?? "claude-code", host, ts, ts],
  );
  // Phase 4 (WA-084): seed default RBAC roles by name so newly-created
  // agents have a usable grant set under hard enforcement. Web UI's
  // role picker overrides via PUT after create. Imported lazily to
  // avoid a circular dep between db.ts and workspace-decoupling-dao.ts.
  // Best-effort — pre-v15 schemas (no `roles` table) skip silently.
  try {
    const { assignDefaultRolesForAgent } = require("./db.ts") as { assignDefaultRolesForAgent: (db: Database, agentId: string, agentName: string) => void };
    assignDefaultRolesForAgent(db, id, sanitized);
  } catch {
    // Roles table may not exist in legacy schemas; skip.
  }
  const row = getRoleById(db, id);
  if (!row) throw new Error("role insert failed");
  return row;
}

export function listAgentsByWorkspace(db: Database): RoleWithDisplayRow[] {
  return db.query<RoleWithDisplayRow, []>(`${ROLE_WITH_REPO_SELECT} ORDER BY p.name ASC, r.name ASC`).all();
}

export function listAgentsByRepo(db: Database, repoId: string): RoleWithDisplayRow[] {
  return db.query<RoleWithDisplayRow, [string]>(
    `${ROLE_WITH_REPO_SELECT} WHERE r.repo_id = ? ORDER BY r.name ASC`,
  ).all(repoId);
}

export function getRoleById(db: Database, id: string): RoleWithDisplayRow | null {
  return db.query<RoleWithDisplayRow, [string]>(
    `${ROLE_WITH_REPO_SELECT} WHERE r.id = ?`,
  ).get(id) ?? null;
}

export function getRoleByDisplayId(db: Database, displayId: string): RoleWithDisplayRow | null {
  let parsed: ParsedRoleAddress;
  try {
    parsed = parseRoleAddress(displayId);
  } catch {
    return null;
  }
  return db.query<RoleWithDisplayRow, [string, string]>(
    `${ROLE_WITH_REPO_SELECT} WHERE p.name = ? AND r.name = ?`,
  ).get(parsed.repoName, parsed.roleName) ?? null;
}

export function renameRoleById(db: Database, id: string, newName: string): RoleWithDisplayRow {
  const sanitized = sanitizeRoleName(newName);
  if (!sanitized) throw new Error("role name resolved to empty after sanitisation");
  const role = getRoleById(db, id);
  if (!role) throw new Error(`role ${id} not found`);
  if (role.name === sanitized) return role;
  const collider = db.query<{ id: string }, [string, string, string]>(
    "SELECT id FROM agents WHERE repo_id = ? AND name = ? AND id != ?",
  ).get(role.repo_id, sanitized, id);
  if (collider) throw new Error(`role "${sanitized}" already exists in this repo`);
  db.run("UPDATE agents SET name = ?, updated_at = ? WHERE id = ?", [sanitized, nowIso(), id]);
  const renamed = getRoleById(db, id);
  if (!renamed) throw new Error(`rename failed for role ${id}`);
  return renamed;
}

/**
 * Delete a role row by id. DB-level only: caller MUST stop any attached
 * runner before invoking this. Caller surfaces the cascade-stop hook
 * (lifted at the API layer in WA-066).
 */
export function deleteRoleById(db: Database, id: string): boolean {
  const role = getRoleById(db, id);
  if (!role) return false;
  db.run("DELETE FROM agents WHERE id = ?", [id]);
  return true;
}
