import { existsSync } from "node:fs";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { isProcessAlive } from "../runner/registry.ts";

/**
 * PID-file ops + offline runner discovery used by `whatsagent stop` and
 * `whatsagent stop-all`. These helpers run without the daemon being
 * reachable, so they read state directly from the filesystem and the
 * daemon DB.
 */

export interface StopReport {
  daemonPid: number | null;
  daemonAlive: boolean;
  workspaceRunners: Array<{
    workspaceId: string;
    workspaceName: string | null;
    role: string;
    /** EP-DEC-RUN WA-003: `repo:role` form. Empty string for legacy
     * pre-cutover metadata files; CLI prints role only in that case. */
    displayId: string;
    runnerPid: number;
    metadataPath: string;
    runnerAlive: boolean;
  }>;
}

export async function readDaemonPid(daemonPidPath: string): Promise<number | null> {
  if (!existsSync(daemonPidPath)) return null;
  const text = (await readFile(daemonPidPath, "utf8")).trim();
  const pid = Number.parseInt(text, 10);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

export async function clearDaemonPid(daemonPidPath: string): Promise<void> {
  await rm(daemonPidPath, { force: true });
}

export async function writeDaemonPid(daemonPidPath: string, pid: number): Promise<void> {
  await writeFile(daemonPidPath, `${pid}\n`, { encoding: "utf8", mode: 0o600 });
}

export interface SlotForDiscovery {
  workspaceId: string;
  workspaceName: string | null;
  runDir: string;
}

export async function discoverWorkspaceRunners(slots: SlotForDiscovery[]): Promise<StopReport["workspaceRunners"]> {
  const out: StopReport["workspaceRunners"] = [];
  for (const slot of slots) {
    if (!existsSync(slot.runDir)) continue;
    let entries: string[];
    try {
      entries = await readdir(slot.runDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".runner.json")) continue;
      const metadataPath = resolve(join(slot.runDir, entry));
      try {
        const raw = await readFile(metadataPath, "utf8");
        const parsed = JSON.parse(raw) as { role?: string; display_id?: string; runner_pid?: number };
        const role = String(parsed.role ?? "?");
        const displayId = typeof parsed.display_id === "string" ? parsed.display_id : "";
        const runnerPid = Number(parsed.runner_pid ?? -1);
        out.push({
          workspaceId: slot.workspaceId,
          workspaceName: slot.workspaceName,
          role,
          displayId,
          runnerPid,
          metadataPath,
          runnerAlive: runnerPid > 0 ? isProcessAlive(runnerPid) : false,
        });
      } catch {
        // Skip corrupt metadata; stop-all sweeps it on cleanup pass.
      }
    }
  }
  return out;
}

export async function killRunner(pid: number, opts: { timeoutMs?: number } = {}): Promise<{ alive: boolean }> {
  if (!Number.isInteger(pid) || pid <= 0) return { alive: false };
  if (!isProcessAlive(pid)) return { alive: false };
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return { alive: isProcessAlive(pid) };
  }
  const timeout = opts.timeoutMs ?? 5000;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return { alive: false };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (isProcessAlive(pid)) {
    try { process.kill(pid, "SIGKILL"); } catch { /* race: already exited */ }
  }
  return { alive: isProcessAlive(pid) };
}

/**
 * Wait for a daemon process to exit. Used by `whatsagent stop` after
 * sending SIGTERM so the user sees confirmation before the CLI returns.
 */
export async function waitForExit(pid: number, timeoutMs: number = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}
