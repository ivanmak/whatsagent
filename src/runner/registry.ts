import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { RunnerMetadata } from "./protocol.ts";

export interface RunnerStatus extends RunnerMetadata {
  reachable: boolean;
  metadata_path: string;
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// EP-DEC-RUN WA-003 (advisor msg #12): legacy `<role>.runner.json` files
// without a `display_id` field are ignored by discovery — never matched
// by filename — so a multi-repo workspace cannot route a stale `main`
// stamp from the wrong repo. We log once per process to flag cleanup
// without spamming on every scan.
const legacyMetadataLogged = new Set<string>();

export async function discoverRunners(runDir: string): Promise<RunnerStatus[]> {
  let entries: string[];
  try {
    entries = await readdir(runDir);
  } catch {
    return [];
  }

  const runners: RunnerStatus[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".runner.json")) continue;
    const metadataPath = join(runDir, entry);
    try {
      const parsed = JSON.parse(await readFile(metadataPath, "utf8")) as Partial<RunnerMetadata>;
      if (typeof parsed.display_id !== "string" || parsed.display_id.length === 0) {
        if (!legacyMetadataLogged.has(metadataPath)) {
          legacyMetadataLogged.add(metadataPath);
          // eslint-disable-next-line no-console
          console.warn(`[runner.registry] ignoring legacy metadata without display_id: ${metadataPath}`);
        }
        continue;
      }
      const full = parsed as RunnerMetadata;
      const processAlive = isProcessAlive(full.runner_pid);
      runners.push({
        ...full,
        metadata_path: metadataPath,
        reachable: processAlive && full.status !== "exited",
      });
    } catch {
      // Corrupt metadata still surfaces as a sentinel "unknown" entry
      // so the daemon's reconcile pass can sweep it. Mark it
      // unreachable + carry the filename-derived bare role for the
      // legacy stop-all path; a missing display_id ensures the
      // workspace-wide guards skip it for routing.
      runners.push({
        fleet_id: "unknown",
        role: entry.replace(/\.runner\.json$/, ""),
        display_id: "",
        session_id: "unknown",
        host_type: "claude-code",
        runner_pid: -1,
        cwd: "",
        socket_path: "",
        started_at: "",
        metadata_path: metadataPath,
        reachable: false,
      });
    }
  }
  return runners;
}
