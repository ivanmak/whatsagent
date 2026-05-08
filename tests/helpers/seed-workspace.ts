/**
 * Test fixture for the post-decoupling workspace shape.
 *
 * Use this helper instead of relying on the legacy `bootstrap: true` default
 * on `startDaemon` (dropped in WA-062). The helper creates a workspace via
 * the public daemon-db + decoupling DAO surface, lays down its slot dir +
 * per-workspace SQLite, and seeds the requested repos and roles.
 *
 * The returned `workspaceDb` belongs to the caller; close it (and the daemon
 * DB) before letting the test cleanup remove the temp dir.
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Database } from "bun:sqlite";

import { insertWorkspace, openDaemonDb, migrateDaemonDb, updateWorkspaceStatus, type RbacMode } from "../../src/daemon-db.ts";
import { migrate, openFleetDb, runStartupRepair, setSetting } from "../../src/db.ts";
import { activeWorkspacePaths, daemonHomePaths } from "../../src/paths.ts";
import {
  insertRepo,
  insertRole,
  type RoleWithDisplayRow,
  type WorkspaceRepoRow,
} from "../../src/workspace-decoupling-dao.ts";
import type { HostType } from "../../src/runner/protocol.ts";

export interface SeedAgentInput {
  name: string;
  host?: HostType | null;
}

/** RBAC Phase 1 alias — prefer `SeedAgentInput` in new code. */
export type SeedRoleInput = SeedAgentInput;

export interface SeedRepoInput {
  /** Absolute path of the repo on disk. Caller is responsible for creating
   * the dir; tests can use `tmpRepoDir()` to allocate a throwaway path. */
  absolutePath: string;
  /** Optional human display name. Defaults to sanitised basename of the path. */
  name?: string;
  roles?: SeedAgentInput[];
}

export interface SeedWorkspaceInput {
  name: string;
  kanbanPrefix?: string;
  repos?: SeedRepoInput[];
  /**
   * EP-022 / WA-094: optional initial RBAC mode for the seeded workspace.
   * Defaults to `enforce` (matches schema default + post-Phase-4
   * production posture). Set to `'soft'` to exercise legacy Star-policy
   * fallback paths in tests, or `'off'` to short-circuit RBAC entirely.
   */
  rbacMode?: RbacMode;
}

export interface SeededAgent {
  id: string;
  name: string;
  displayId: string;
  raw: RoleWithDisplayRow;
}

/** RBAC Phase 1 alias — prefer `SeededAgent` in new code. */
export type SeededRole = SeededAgent;

export interface SeededRepo {
  id: string;
  name: string;
  absolutePath: string;
  roles: SeededAgent[];
  raw: WorkspaceRepoRow;
}

export interface SeededWorkspace {
  workspaceId: string;
  workspaceDb: Database;
  repos: SeededRepo[];
}

export interface TestDaemonHome {
  /** `~/.whatsagent`-equivalent root for this test. */
  home: string;
  /** Open daemon-DB handle. */
  daemonDb: Database;
  /** Paths derived from `home`. */
  paths: ReturnType<typeof daemonHomePaths>;
  /** Cleanup hook: closes the daemon DB and removes the temp tree. */
  cleanup: () => Promise<void>;
}

/**
 * Create an isolated daemon-home temp dir, open + migrate the daemon DB,
 * and return both alongside a cleanup hook. Call `cleanup()` from `afterEach`
 * (or equivalent) so the temp tree is removed even on test failure.
 */
export async function tmpDaemonHome(): Promise<TestDaemonHome> {
  const home = await mkdtemp(join(tmpdir(), "wa-seedws-"));
  const paths = daemonHomePaths(home);
  await mkdir(paths.workspacesDir, { recursive: true, mode: 0o700 });
  await mkdir(paths.trashDir, { recursive: true, mode: 0o700 });
  await mkdir(paths.logsDir, { recursive: true, mode: 0o700 });
  const daemonDb = openDaemonDb(paths.daemonDbPath);
  migrateDaemonDb(daemonDb, { daemonHome: home });
  return {
    home,
    daemonDb,
    paths,
    cleanup: async () => {
      try { daemonDb.close(); } catch { /* already closed */ }
      await rm(home, { recursive: true, force: true });
    },
  };
}

/**
 * Allocate a temp dir that the caller can use as a repo path. The dir
 * exists but is empty (no `.git`, no `package.json`). Tests that need
 * markers should `mkdir`/`writeFileSync` extras themselves.
 */
export async function tmpRepoDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "wa-repo-"));
}

/**
 * Lay down a workspace + repos + roles via the public lifecycle and DAO
 * surface. No raw SQL — the helper stays correct under future schema bumps.
 */
export async function seedTestWorkspace(
  home: string,
  daemonDb: Database,
  input: SeedWorkspaceInput,
): Promise<SeededWorkspace> {
  const id = randomUUID();
  insertWorkspace(daemonDb, { id, name: input.name, rbacMode: input.rbacMode });
  const slot = activeWorkspacePaths(home, id);
  await mkdir(slot.slot, { recursive: true, mode: 0o700 });
  await mkdir(slot.runDir, { recursive: true, mode: 0o700 });
  await mkdir(slot.logsDir, { recursive: true, mode: 0o700 });
  const workspaceDb = openFleetDb(slot.dbPath);
  migrate(workspaceDb);
  runStartupRepair(workspaceDb);
  if (input.kanbanPrefix !== undefined) {
    setSetting(workspaceDb, "kanban.task_id_prefix", input.kanbanPrefix);
  }

  const repos: SeededRepo[] = [];
  for (const repoInput of input.repos ?? []) {
    const repo = insertRepo(workspaceDb, {
      absolutePath: repoInput.absolutePath,
      name: repoInput.name,
    });
    const roles: SeededRole[] = [];
    for (const roleInput of repoInput.roles ?? []) {
      const role = insertRole(workspaceDb, {
        repoId: repo.id,
        name: roleInput.name,
        host: roleInput.host ?? null,
      });
      roles.push({
        id: role.id,
        name: role.name,
        displayId: role.display_id,
        raw: role,
      });
    }
    repos.push({
      id: repo.id,
      name: repo.name,
      absolutePath: repo.absolute_path,
      roles,
      raw: repo,
    });
  }

  updateWorkspaceStatus(daemonDb, id, "active");
  return { workspaceId: id, workspaceDb, repos };
}
