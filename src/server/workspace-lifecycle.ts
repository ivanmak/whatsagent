import { mkdir, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

import type { Database } from "bun:sqlite";

import {
  deleteWorkspaceRow,
  getCurrentWorkspaceId,
  getTrashRetentionDays,
  getWorkspaceByName,
  listTrashedWorkspaces,
  listWorkspaces,
  setCurrentWorkspaceId,
  updateWorkspaceStatus,
  type WorkspaceRow,
} from "../daemon-db.ts";
import { migrate, openFleetDb, runStartupRepair } from "../db.ts";
import { activeWorkspacePaths, daemonHomePaths, trashWorkspacePaths } from "../paths.ts";

export interface LifecycleHooks {
  /** Stop every reachable runner in this workspace. Implemented by the
   * daemon (closes over runner-stop helpers) so this module stays free
   * of runner internals. */
  stopWorkspaceRunners?: (workspace: WorkspaceRow) => Promise<void>;
  /** Close any cached per-workspace DB handle the daemon is holding. */
  closeWorkspaceDb?: (workspaceId: string) => void;
  /** Re-open + cache the per-workspace DB handle (called after restore). */
  openWorkspaceDb?: (workspace: WorkspaceRow) => void;
  /** Optional logger. */
  log?: (level: "info" | "warn" | "error", event: string, payload: Record<string, unknown>) => void;
}

function note(hooks: LifecycleHooks, level: "info" | "warn" | "error", event: string, payload: Record<string, unknown>): void {
  hooks.log?.(level, event, payload);
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
}

/**
 * Trash a workspace. Two-phase:
 *   1. status -> 'deleting', stop runners, close DB handle
 *   2. rename slot to trash, status -> 'trashed' with trashed_at=now
 *
 * Idempotent: if the rename already happened (slot missing, trash present),
 * skip directly to flipping the row.
 */
export async function trashWorkspace(
  daemonDb: Database,
  daemonHome: string,
  workspace: WorkspaceRow,
  hooks: LifecycleHooks = {},
): Promise<WorkspaceRow> {
  if (workspace.status === "trashed") return workspace;
  if (workspace.status !== "active" && workspace.status !== "deleting" && workspace.status !== "error") {
    throw new Error(`cannot trash workspace in status '${workspace.status}'`);
  }

  let row = workspace;
  if (row.status !== "deleting") {
    row = updateWorkspaceStatus(daemonDb, row.id, "deleting");
  }

  try {
    await hooks.stopWorkspaceRunners?.(row);
    hooks.closeWorkspaceDb?.(row.id);

    const active = activeWorkspacePaths(daemonHome, row.id);
    const trashed = trashWorkspacePaths(daemonHome, row.id);
    if (existsSync(active.slot)) {
      const trashRoot = daemonHomePaths(daemonHome).trashDir;
      await ensureDir(trashRoot);
      // If a trash slot for this id already exists from a partial earlier
      // run, prefer the freshly-renamed-from-active copy. Remove the
      // leftover first.
      if (existsSync(trashed.slot)) {
        await rm(trashed.slot, { recursive: true, force: true });
      }
      await rename(active.slot, trashed.slot);
    } else if (!existsSync(trashed.slot)) {
      throw new Error(`workspace slot for ${row.id} missing from both workspaces/ and trash/`);
    }

    const next = updateWorkspaceStatus(daemonDb, row.id, "trashed", { trashedAt: new Date().toISOString() });
    if (getCurrentWorkspaceId(daemonDb) === row.id) {
      const fallback = listWorkspaces(daemonDb).find((w) => w.id !== row.id) ?? null;
      setCurrentWorkspaceId(daemonDb, fallback?.id ?? null);
    }
    note(hooks, "info", "workspace.trashed", { id: row.id, name: row.name });
    return next;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    note(hooks, "error", "workspace.trash_failed", { id: row.id, error: message });
    return updateWorkspaceStatus(daemonDb, row.id, "error", { error: message });
  }
}

/**
 * Restore a trashed workspace. Refuses if the registered path is now
 * occupied by another active workspace.
 */
export async function restoreWorkspace(
  daemonDb: Database,
  daemonHome: string,
  workspace: WorkspaceRow,
  hooks: LifecycleHooks = {},
): Promise<WorkspaceRow> {
  if (workspace.status !== "trashed" && workspace.status !== "restoring" && workspace.status !== "error") {
    throw new Error(`cannot restore workspace in status '${workspace.status}'`);
  }
  // Workspace decoupling: no more on-disk path uniqueness — workspace_repos
  // owns absolute paths now. The only collider that still matters at restore
  // time is name uniqueness on active workspaces.
  const nameCollider = getWorkspaceByName(daemonDb, workspace.name);
  if (nameCollider && nameCollider.id !== workspace.id) {
    throw new Error(`workspace name ${JSON.stringify(workspace.name)} is in use by active workspace ${nameCollider.id}; rename one before restore`);
  }

  let row = workspace;
  if (row.status !== "restoring") {
    row = updateWorkspaceStatus(daemonDb, row.id, "restoring");
  }

  try {
    const active = activeWorkspacePaths(daemonHome, row.id);
    const trashed = trashWorkspacePaths(daemonHome, row.id);
    if (!existsSync(active.slot)) {
      if (!existsSync(trashed.slot)) {
        throw new Error(`workspace slot for ${row.id} missing from both workspaces/ and trash/`);
      }
      await ensureDir(daemonHomePaths(daemonHome).workspacesDir);
      await rename(trashed.slot, active.slot);
    }
    // Catch up on any per-workspace migrations that landed while trashed.
    const db = openFleetDb(active.dbPath);
    try {
      migrate(db);
      runStartupRepair(db);
    } finally {
      db.close();
    }
    const next = updateWorkspaceStatus(daemonDb, row.id, "active", { trashedAt: null });
    hooks.openWorkspaceDb?.(next);
    note(hooks, "info", "workspace.restored", { id: row.id, name: row.name });
    return next;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    note(hooks, "error", "workspace.restore_failed", { id: row.id, error: message });
    return updateWorkspaceStatus(daemonDb, row.id, "error", { error: message });
  }
}

/**
 * Permanently delete a trashed workspace.
 */
export async function purgeWorkspace(
  daemonDb: Database,
  daemonHome: string,
  workspace: WorkspaceRow,
  hooks: LifecycleHooks = {},
): Promise<void> {
  if (workspace.status !== "trashed" && workspace.status !== "purging" && workspace.status !== "error") {
    throw new Error(`cannot purge workspace in status '${workspace.status}'; trash it first`);
  }
  let row = workspace;
  if (row.status !== "purging") {
    row = updateWorkspaceStatus(daemonDb, row.id, "purging");
  }
  try {
    const trashed = trashWorkspacePaths(daemonHome, row.id);
    const active = activeWorkspacePaths(daemonHome, row.id);
    // Defensive: remove from both possible locations. Active slot can
    // only be present if we crashed mid-trash and rename never ran;
    // purge subsumes the trash step in that case.
    if (existsSync(active.slot)) {
      await rm(active.slot, { recursive: true, force: true });
    }
    if (existsSync(trashed.slot)) {
      await rm(trashed.slot, { recursive: true, force: true });
    }
    deleteWorkspaceRow(daemonDb, row.id);
    note(hooks, "info", "workspace.purged", { id: row.id, name: row.name });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    note(hooks, "error", "workspace.purge_failed", { id: row.id, error: message });
    updateWorkspaceStatus(daemonDb, row.id, "error", { error: message });
    throw e;
  }
}

/**
 * Run at daemon startup. Walks every workspace row and resolves any
 * transient state (creating/deleting/restoring/purging) by inspecting
 * the filesystem. Idempotent — safe to invoke repeatedly.
 */
export async function repairOnStartup(
  daemonDb: Database,
  daemonHome: string,
  hooks: LifecycleHooks = {},
): Promise<void> {
  const all = listWorkspaces(daemonDb, { includeTrash: true });
  for (const ws of all) {
    const active = activeWorkspacePaths(daemonHome, ws.id);
    const trashed = trashWorkspacePaths(daemonHome, ws.id);
    const inActive = existsSync(active.slot);
    const inTrash = existsSync(trashed.slot);
    try {
      switch (ws.status) {
        case "creating":
          if (inActive) {
            updateWorkspaceStatus(daemonDb, ws.id, "active");
          } else {
            deleteWorkspaceRow(daemonDb, ws.id);
            note(hooks, "info", "workspace.repair.creating_rolled_back", { id: ws.id });
          }
          break;
        case "deleting":
          if (inActive) {
            await trashWorkspace(daemonDb, daemonHome, ws, hooks);
          } else if (inTrash) {
            updateWorkspaceStatus(daemonDb, ws.id, "trashed", { trashedAt: ws.trashed_at ?? new Date().toISOString() });
            note(hooks, "info", "workspace.repair.deleting_finished", { id: ws.id });
          } else {
            updateWorkspaceStatus(daemonDb, ws.id, "error", { error: "workspace dir missing from both workspaces/ and trash/" });
          }
          break;
        case "restoring":
          if (inActive) {
            updateWorkspaceStatus(daemonDb, ws.id, "active", { trashedAt: null });
            note(hooks, "info", "workspace.repair.restoring_finished", { id: ws.id });
          } else if (inTrash) {
            await restoreWorkspace(daemonDb, daemonHome, ws, hooks);
          } else {
            updateWorkspaceStatus(daemonDb, ws.id, "error", { error: "workspace dir missing during restore" });
          }
          break;
        case "purging":
          if (inActive || inTrash) {
            await purgeWorkspace(daemonDb, daemonHome, ws, hooks);
          } else {
            deleteWorkspaceRow(daemonDb, ws.id);
            note(hooks, "info", "workspace.repair.purge_finished", { id: ws.id });
          }
          break;
        case "trashed":
          if (!inTrash) {
            updateWorkspaceStatus(daemonDb, ws.id, "error", { error: "trash slot missing" });
          }
          break;
        case "active":
          if (!inActive) {
            updateWorkspaceStatus(daemonDb, ws.id, "error", { error: "workspace slot missing" });
          }
          break;
        case "error":
          // Operator must intervene. Leave alone.
          break;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      note(hooks, "error", "workspace.repair_failed", { id: ws.id, status: ws.status, error: message });
      updateWorkspaceStatus(daemonDb, ws.id, "error", { error: message });
    }
  }
}

/**
 * Walk every workspace in 'trashed' state, purge the ones whose
 * trashed_at + retention is in the past. Retention=0 disables auto-purge.
 */
export async function autoPurgeSweep(
  daemonDb: Database,
  daemonHome: string,
  hooks: LifecycleHooks = {},
): Promise<{ purged: number; skipped: number }> {
  const retentionDays = getTrashRetentionDays(daemonDb);
  if (retentionDays === 0) return { purged: 0, skipped: 0 };

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const trashed = listTrashedWorkspaces(daemonDb);
  let purged = 0;
  let skipped = 0;
  for (const ws of trashed) {
    if (!ws.trashed_at || ws.trashed_at >= cutoff) {
      skipped += 1;
      continue;
    }
    try {
      await purgeWorkspace(daemonDb, daemonHome, ws, hooks);
      purged += 1;
    } catch {
      // purgeWorkspace flips to 'error' on its own; loop continues.
      skipped += 1;
    }
  }
  if (purged > 0) note(hooks, "info", "workspace.auto_purge_swept", { purged, skipped, retentionDays });
  return { purged, skipped };
}
