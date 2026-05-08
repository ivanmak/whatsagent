/**
 * EP-022 / WA-097 — RBAC visibility snapshot loader for the MCP
 * register-time tool filter.
 *
 * Captures the agent's effective `tool_families` + per-call mode at MCP
 * boot from the daemon's `whoami` reply, so each integration
 * (`claude-mcp`, `codex-mcp`, `opencode-plugin`) can decide which tools
 * to register without hitting the daemon DB directly. The snapshot is
 * permissive (all tools exposed) when the loader fails — that matches
 * the pre-EP-022 default of unconditional registration so a transient
 * whoami failure doesn't lock an agent out of every tool. Operators
 * still get the per-call enforcement at dispatch time, which uses
 * authoritative state.
 *
 * Boot-time snapshot caveat: role / mode changes after boot do NOT
 * re-register tools live; agent must relaunch / reconnect to pick up
 * new visibility. Documented in tool descriptions + Roles tab UI hint.
 */
import type { RbacMode } from "../daemon-db.ts";

import type { FetchLike, LaunchContext } from "./launch-token.ts";

export interface RbacBootSnapshot {
  toolFamilies: readonly string[];
  mode: RbacMode;
}

/**
 * Permissive default: every tool exposed. Used when the snapshot loader
 * cannot resolve the agent's grants (network blip, daemon mid-restart,
 * tests that bypass whoami). The dispatcher's per-call enforcement
 * still applies — failing open at the visibility layer is safe because
 * the actual auth gate lives downstream.
 */
export const PERMISSIVE_RBAC_BOOT_SNAPSHOT: RbacBootSnapshot = { toolFamilies: [], mode: "off" };

interface WhoamiReply {
  ok?: boolean;
  grants?: { tool_families?: readonly string[] };
  rbac?: { mode?: RbacMode };
}

/**
 * Fetch the agent's grants + effective mode from the daemon. Returns a
 * permissive snapshot on any failure so a transient whoami error does
 * not lock the agent out of every tool. Production callers wrap this in
 * the existing launch flow (after `validateLaunchContext` succeeds).
 */
export async function loadRbacBootSnapshot(context: LaunchContext, fetchImpl: FetchLike): Promise<RbacBootSnapshot> {
  try {
    const res = await fetchImpl(`${context.daemonUrl}/api/v1/agent/whoami`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${context.launchToken}` },
      body: JSON.stringify({
        workspaceId: context.workspaceId,
        role: context.role,
        sessionId: context.sessionId,
      }),
    });
    if (!res.ok) return PERMISSIVE_RBAC_BOOT_SNAPSHOT;
    const body = (await res.json()) as WhoamiReply;
    if (body?.ok !== true) return PERMISSIVE_RBAC_BOOT_SNAPSHOT;
    const families = Array.isArray(body.grants?.tool_families) ? body.grants!.tool_families! : [];
    const mode: RbacMode = body.rbac?.mode === "enforce" || body.rbac?.mode === "soft" || body.rbac?.mode === "off"
      ? body.rbac.mode
      : "off";
    return { toolFamilies: families, mode };
  } catch {
    return PERMISSIVE_RBAC_BOOT_SNAPSHOT;
  }
}
