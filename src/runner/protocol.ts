import { join } from "node:path";

export type HostType = "claude-code" | "opencode" | "codex" | "pi";
export type NativePushType = "claude-channel" | "opencode-plugin" | "pi-extension";

export interface RunnerMetadata {
  /**
   * Phase 2 workspace identifier. Optional during 2a transition while
   * legacy code paths still populate `fleet_id` only. New launches write
   * both; the daemon prefers `workspace_id` when present.
   */
  workspace_id?: string;
  /** @deprecated since Phase 2; use `workspace_id`. Retained until 2a-final. */
  fleet_id: string;
  role: string;
  /**
   * EP-DEC-RUN: `repo:role` display id of the launching role. Required as
   * of WA-003 (every writer — launcher, process.ts, node-pty-runner.mjs —
   * populates it). Registry filters out legacy entries that lack this
   * field, with a one-time log per scan, so multi-repo same-name runners
   * route by displayId rather than colliding on bare `role`.
   */
  display_id: string;
  session_id: string;
  host_type: HostType;
  mode?: "fake" | "pty";
  status?: "running" | "exited";
  native_push?: NativePushType;
  /**
   * True when the daemon tried EP-034 /redraw-pulse against this runner
   * session and received 404, indicating an old runner binary that needs
   * a Stop+Launch to load the redraw-pulse endpoint.
   */
  stale_pulse_endpoint?: boolean;
  tui_redraw?: {
    workaround: "off" | "on";
    pulse_count?: number;
    last_pulse_at?: string;
  };
  pending_nudge?: {
    count: number;
    from_role?: string;
    source?: string;
    queued_at: string;
    blocked_by_draft?: boolean;
    submitted_at?: string;
  };
  attention?: {
    approval_waiting?: {
      at: string;
      kind: string;
    };
  };
  runner_pid: number;
  child_pid?: number;
  exit_code?: number;
  exit_signal?: string;
  exited_at?: string;
  output_tail?: string;
  cwd: string;
  socket_path: string;
  control_url?: string;
  /**
   * WA-153: per-runner loopback control bearer. Stored only in the 0600
   * runner metadata file / daemon memory and stripped from browser/API
   * responses. This mitigates browser/loopback drive-by requests; it is
   * not a same-UID boundary because same-UID processes can read 0600 files.
   */
  control_secret?: string;
  started_at: string;
}

export interface RunnerOutputEvent {
  seq: number;
  type: "output" | "input" | "status";
  data: string;
  at: string;
}

/**
 * EP-DEC-RUN: filesystem-safe form of a role display id (`repo:role`).
 * `:` (only reserved char in display ids) becomes `__`; everything else
 * outside `[A-Za-z0-9_-]` collapses to `_`. Empty input falls back to
 * `role`. Param renamed from `role` → `displayId` (WA-002, advisor msg #8)
 * so future bare-name calls fail review intent. Bare names still pass
 * here (no `:`) — full caller cutover lands in WA-003.
 */
export function safeRoleFileName(displayId: string): string {
  return displayId.replace(/:/g, "__").replace(/[^a-zA-Z0-9_-]+/g, "_") || "role";
}

export function runnerMetadataPath(runDir: string, displayId: string): string {
  return join(runDir, `${safeRoleFileName(displayId)}.runner.json`);
}

export function runnerSocketPath(runDir: string, displayId: string): string {
  return join(runDir, `${safeRoleFileName(displayId)}.sock`);
}

export function runnerLogPath(logsDir: string, displayId: string): string {
  return join(logsDir, `runner-${safeRoleFileName(displayId)}.log`);
}

export function normalizeHostType(value: string | undefined, fallback?: string | null): HostType {
  const host = !value || value === "default" ? fallback : value;
  if (host !== "claude-code" && host !== "opencode" && host !== "codex" && host !== "pi") throw new Error(`Invalid host type: ${host}`);
  return host;
}
