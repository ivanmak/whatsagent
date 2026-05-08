import type { Database } from "bun:sqlite";

import { listWorkspaces, type RbacMode, type WorkspaceRow } from "../daemon-db.ts";
import { migrate, openFleetDb, runStartupRepair } from "../db.ts";
import { activeWorkspacePaths, type WorkspacePaths } from "../paths.ts";

/**
 * Runtime cache entry for a single active workspace. The daemon holds one
 * `WorkspaceState` per active workspace in `state.workspaces`; trashed,
 * creating, deleting, restoring, purging, and error rows are tracked via
 * `state.daemonDb` and have no cache entry. Presence in `state.workspaces`
 * is therefore the active-signal — no `status` field needed here.
 *
 * Workspace decoupling (2026-05-01): no more `path` / `type` here. Roles
 * resolve their absolute path via `workspace_repos.absolute_path`; what
 * used to be `multi-repo` discovery is now per-workspace `workspace_scan_dirs`.
 */
export interface WorkspaceState {
  id: string;
  name: string;
  /** Slot under `~/.whatsagent/workspaces/<id>/` (db, run, logs). */
  paths: WorkspacePaths;
  /** Per-workspace SQLite handle, opened once at boot or on activation. */
  db: Database;
  /**
   * EP-022 / WA-094: cached RBAC mode for this workspace. Snapshot of
   * `daemon_db.workspaces.rbac_mode` at hydration / patch time so the
   * dispatcher does not need to round-trip the daemon DB on every
   * action. The PATCH `/workspaces/:id/rbac-mode` endpoint refreshes
   * both the row and this cache atomically.
   */
  rbacMode: RbacMode;
}

/**
 * Open the per-workspace DB, run migrations + startup repair, and return
 * a `WorkspaceState` ready to be cached. Caller is responsible for inserting
 * into `state.workspaces` and for calling `closeWorkspaceState` to release
 * the DB handle when the workspace transitions out of active.
 */
export function loadWorkspaceState(daemonHome: string, row: WorkspaceRow): WorkspaceState {
  const paths = activeWorkspacePaths(daemonHome, row.id);
  const db = openFleetDb(paths.dbPath);
  migrate(db);
  runStartupRepair(db);
  return {
    id: row.id,
    name: row.name,
    paths,
    db,
    rbacMode: row.rbac_mode,
  };
}

/**
 * Close the cached DB handle and return; caller removes from the map.
 */
export function closeWorkspaceState(ws: WorkspaceState): void {
  try { ws.db.close(); } catch { /* already closed */ }
}

/**
 * Boot-time hydration. Builds an empty Map and populates one `WorkspaceState`
 * per row with status='active'. Called from `startDaemon` after `repairOnStartup`
 * has settled transient rows. Bypasses lifecycle hooks intentionally — boot
 * hydration is not a lifecycle event.
 */
export function hydrateActiveWorkspaces(daemonDb: Database, daemonHome: string): Map<string, WorkspaceState> {
  const out = new Map<string, WorkspaceState>();
  for (const row of listWorkspaces(daemonDb)) {
    if (row.status !== "active") continue;
    out.set(row.id, loadWorkspaceState(daemonHome, row));
  }
  return out;
}

/**
 * Close every cached DB handle. Called from `StartedDaemon.stop()`.
 */
export function closeAllWorkspaceStates(workspaces: Map<string, WorkspaceState>): void {
  for (const ws of workspaces.values()) closeWorkspaceState(ws);
  workspaces.clear();
}
