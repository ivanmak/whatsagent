import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  generateWorkspaceId,
  getTrashRetentionDays,
  insertWorkspace,
  listWorkspaces,
  migrateDaemonDb,
  openDaemonDb,
  setTrashRetentionDays,
  updateWorkspaceStatus,
  type WorkspaceRow,
} from "../src/daemon-db.ts";
import { activeWorkspacePaths, daemonHomePaths, trashWorkspacePaths } from "../src/paths.ts";
import { autoPurgeSweep, purgeWorkspace, repairOnStartup, restoreWorkspace, trashWorkspace } from "../src/server/workspace-lifecycle.ts";

interface Harness {
  home: string;
  daemonDb: ReturnType<typeof openDaemonDb>;
  cleanup: () => Promise<void>;
}

async function makeHarness(): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), "wa-life-"));
  await mkdir(daemonHomePaths(home).workspacesDir, { recursive: true, mode: 0o700 });
  await mkdir(daemonHomePaths(home).trashDir, { recursive: true, mode: 0o700 });
  const daemonDb = openDaemonDb(daemonHomePaths(home).daemonDbPath);
  migrateDaemonDb(daemonDb);
  return {
    home,
    daemonDb,
    cleanup: async () => {
      try { daemonDb.close(); } catch { /* already closed */ }
      await rm(home, { recursive: true, force: true });
    },
  };
}

async function seedActiveWorkspace(h: Harness, name = "ws"): Promise<WorkspaceRow> {
  const id = generateWorkspaceId();
  insertWorkspace(h.daemonDb, { id, name });
  const slot = activeWorkspacePaths(h.home, id);
  await mkdir(slot.slot, { recursive: true, mode: 0o700 });
  await mkdir(slot.runDir, { recursive: true, mode: 0o700 });
  await mkdir(slot.logsDir, { recursive: true, mode: 0o700 });
  // Seed a fake DB file so existence checks pass.
  await Bun.write(slot.dbPath, "");
  return updateWorkspaceStatus(h.daemonDb, id, "active");
}

test("trashWorkspace moves slot to trash and flips status", async () => {
  const h = await makeHarness();
  try {
    const ws = await seedActiveWorkspace(h);
    const slot = activeWorkspacePaths(h.home, ws.id);
    const trashed = trashWorkspacePaths(h.home, ws.id);
    expect(existsSync(slot.slot)).toBe(true);
    expect(existsSync(trashed.slot)).toBe(false);

    const after = await trashWorkspace(h.daemonDb, h.home, ws);
    expect(after.status).toBe("trashed");
    expect(after.trashed_at).not.toBeNull();
    expect(existsSync(slot.slot)).toBe(false);
    expect(existsSync(trashed.slot)).toBe(true);
  } finally {
    await h.cleanup();
  }
});

test("restoreWorkspace puts slot back and clears trashed_at", async () => {
  const h = await makeHarness();
  try {
    const ws = await seedActiveWorkspace(h);
    await trashWorkspace(h.daemonDb, h.home, ws);
    const trashed = listWorkspaces(h.daemonDb, { includeTrash: true }).find((w) => w.id === ws.id)!;

    const after = await restoreWorkspace(h.daemonDb, h.home, trashed);
    expect(after.status).toBe("active");
    expect(after.trashed_at).toBeNull();
    expect(existsSync(activeWorkspacePaths(h.home, ws.id).slot)).toBe(true);
    expect(existsSync(trashWorkspacePaths(h.home, ws.id).slot)).toBe(false);
  } finally {
    await h.cleanup();
  }
});

test("restoreWorkspace refuses when name is now occupied by another active workspace", async () => {
  const h = await makeHarness();
  try {
    const a = await seedActiveWorkspace(h, "a");
    await trashWorkspace(h.daemonDb, h.home, a);
    const trashedA = listWorkspaces(h.daemonDb, { includeTrash: true }).find((w) => w.id === a.id)!;

    // Create a new active workspace using the same name → should block restore.
    const collider = generateWorkspaceId();
    insertWorkspace(h.daemonDb, { id: collider, name: "a" });
    updateWorkspaceStatus(h.daemonDb, collider, "active");

    await expect(restoreWorkspace(h.daemonDb, h.home, trashedA)).rejects.toThrow(/in use by active workspace/);
    const stillTrashed = listWorkspaces(h.daemonDb, { includeTrash: true }).find((w) => w.id === a.id)!;
    expect(stillTrashed.status).toBe("trashed");
  } finally {
    await h.cleanup();
  }
});

test("purgeWorkspace removes trash dir and the daemon row", async () => {
  const h = await makeHarness();
  try {
    const ws = await seedActiveWorkspace(h);
    await trashWorkspace(h.daemonDb, h.home, ws);
    const trashed = listWorkspaces(h.daemonDb, { includeTrash: true }).find((w) => w.id === ws.id)!;
    expect(existsSync(trashWorkspacePaths(h.home, ws.id).slot)).toBe(true);

    await purgeWorkspace(h.daemonDb, h.home, trashed);
    expect(existsSync(trashWorkspacePaths(h.home, ws.id).slot)).toBe(false);
    expect(listWorkspaces(h.daemonDb, { includeTrash: true }).find((w) => w.id === ws.id)).toBeUndefined();
  } finally {
    await h.cleanup();
  }
});

test("repairOnStartup: 'creating' rolls back when slot is missing", async () => {
  const h = await makeHarness();
  try {
    const id = generateWorkspaceId();
    insertWorkspace(h.daemonDb, { id, name: "stuck" });
    // Stays in 'creating' with no slot on disk.
    expect(listWorkspaces(h.daemonDb, { includeTrash: true }).find((w) => w.id === id)?.status).toBe("creating");

    await repairOnStartup(h.daemonDb, h.home);
    expect(listWorkspaces(h.daemonDb, { includeTrash: true }).find((w) => w.id === id)).toBeUndefined();
  } finally {
    await h.cleanup();
  }
});

test("repairOnStartup: 'creating' becomes 'active' when slot exists", async () => {
  const h = await makeHarness();
  try {
    const id = generateWorkspaceId();
    insertWorkspace(h.daemonDb, { id, name: "ok" });
    const slot = activeWorkspacePaths(h.home, id);
    await mkdir(slot.slot, { recursive: true, mode: 0o700 });

    await repairOnStartup(h.daemonDb, h.home);
    expect(listWorkspaces(h.daemonDb, { includeTrash: true }).find((w) => w.id === id)?.status).toBe("active");
  } finally {
    await h.cleanup();
  }
});

test("repairOnStartup: 'deleting' with rename already done flips to 'trashed'", async () => {
  const h = await makeHarness();
  try {
    const ws = await seedActiveWorkspace(h);
    // Manually pre-rename to simulate crash mid-trash after rename succeeded
    // but before status flip ran.
    await mkdir(daemonHomePaths(h.home).trashDir, { recursive: true, mode: 0o700 });
    await rename(activeWorkspacePaths(h.home, ws.id).slot, trashWorkspacePaths(h.home, ws.id).slot);
    updateWorkspaceStatus(h.daemonDb, ws.id, "deleting");

    await repairOnStartup(h.daemonDb, h.home);
    const repaired = listWorkspaces(h.daemonDb, { includeTrash: true }).find((w) => w.id === ws.id)!;
    expect(repaired.status).toBe("trashed");
    expect(repaired.trashed_at).not.toBeNull();
  } finally {
    await h.cleanup();
  }
});

test("repairOnStartup: 'restoring' completes when slot already moved back", async () => {
  const h = await makeHarness();
  try {
    const ws = await seedActiveWorkspace(h);
    await trashWorkspace(h.daemonDb, h.home, ws);
    // Manually move back + set restoring (crash before status flip).
    await rename(trashWorkspacePaths(h.home, ws.id).slot, activeWorkspacePaths(h.home, ws.id).slot);
    updateWorkspaceStatus(h.daemonDb, ws.id, "restoring");

    await repairOnStartup(h.daemonDb, h.home);
    const repaired = listWorkspaces(h.daemonDb, { includeTrash: true }).find((w) => w.id === ws.id)!;
    expect(repaired.status).toBe("active");
    expect(repaired.trashed_at).toBeNull();
  } finally {
    await h.cleanup();
  }
});

test("autoPurgeSweep purges trashed workspaces past retention; retention=0 disables", async () => {
  const h = await makeHarness();
  try {
    const ws = await seedActiveWorkspace(h);
    await trashWorkspace(h.daemonDb, h.home, ws);

    // Force trashed_at into the past so even retention=1 day is exceeded.
    const longAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    h.daemonDb.run("UPDATE workspaces SET trashed_at = ? WHERE id = ?", [longAgo, ws.id]);

    // retention=0 → manual-only, sweep is a no-op.
    setTrashRetentionDays(h.daemonDb, 0);
    expect(getTrashRetentionDays(h.daemonDb)).toBe(0);
    let result = await autoPurgeSweep(h.daemonDb, h.home);
    expect(result.purged).toBe(0);
    expect(listWorkspaces(h.daemonDb, { includeTrash: true }).length).toBe(1);

    // retention=1 → trashed-365-days-ago is past cutoff, should purge.
    setTrashRetentionDays(h.daemonDb, 1);
    result = await autoPurgeSweep(h.daemonDb, h.home);
    expect(result.purged).toBe(1);
    expect(listWorkspaces(h.daemonDb, { includeTrash: true }).length).toBe(0);
  } finally {
    await h.cleanup();
  }
});
