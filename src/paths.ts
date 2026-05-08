import { homedir } from "node:os";
import { join, resolve } from "node:path";

// EP-DEC-3 (WA-070) drops the legacy fleet-root layout (per-tree `.whatsagent/`
// directory with `whatsagent.toml`, daemon DB, run dir, logs). The daemon-home
// layout below is the only on-disk surface the daemon reads at boot.

export const DAEMON_DIR_NAME = ".whatsagent";
export const DAEMON_DB_FILE = "daemon.sqlite";
export const DAEMON_PID_FILE = "daemon.pid";
export const DAEMON_LOG_FILE = "daemon.log";
export const WORKSPACES_DIR = "workspaces";
export const TRASH_DIR = "trash";
export const WORKSPACE_DB_FILE = "whatsagent.sqlite";

export interface DaemonHomePaths {
  home: string;
  daemonDbPath: string;
  daemonPidPath: string;
  daemonLogPath: string;
  logsDir: string;
  workspacesDir: string;
  trashDir: string;
}

export interface WorkspacePaths {
  /** Absolute path to the workspace's slot under `<daemonHome>/workspaces/<id>/`. */
  slot: string;
  dbPath: string;
  runDir: string;
  logsDir: string;
}

/**
 * Returns the daemon home and its top-level paths. Pass the daemon home
 * directory itself — `~/.whatsagent` (or its tmp/test equivalent), not the
 * user's home dir. Defaults to `~/.whatsagent`. The directory is NOT
 * created here; call sites that need it on-disk should
 * `mkdir({ recursive: true })`.
 */
export function daemonHomePaths(home: string | undefined = undefined): DaemonHomePaths {
  const root = resolve(home ?? join(homedir(), DAEMON_DIR_NAME));
  return {
    home: root,
    daemonDbPath: join(root, DAEMON_DB_FILE),
    daemonPidPath: join(root, DAEMON_PID_FILE),
    daemonLogPath: join(root, "logs", DAEMON_LOG_FILE),
    logsDir: join(root, "logs"),
    workspacesDir: join(root, WORKSPACES_DIR),
    trashDir: join(root, TRASH_DIR),
  };
}

/**
 * Paths for a single workspace's slot under `<home>/workspaces/<id>/`. The
 * caller picks the slot location (workspaces vs trash) and passes it in.
 */
export function workspacePathsAt(slot: string): WorkspacePaths {
  const resolved = resolve(slot);
  return {
    slot: resolved,
    dbPath: join(resolved, WORKSPACE_DB_FILE),
    runDir: join(resolved, "run"),
    logsDir: join(resolved, "logs"),
  };
}

export function activeWorkspacePaths(home: string, workspaceId: string): WorkspacePaths {
  return workspacePathsAt(join(daemonHomePaths(home).workspacesDir, workspaceId));
}

export function trashWorkspacePaths(home: string, workspaceId: string): WorkspacePaths {
  return workspacePathsAt(join(daemonHomePaths(home).trashDir, workspaceId));
}
