/**
 * EP-031 — DB-free RBAC visibility helpers.
 *
 * Pi (Node-based) loads its WhatsAgent extension from `pi-extension.ts`,
 * whose import graph must not pull `bun:sqlite`. Extracted here so
 * `getToolFamily` / `shouldExposeTool` / `ACTION_GRANT_REQUIREMENTS` are
 * reachable without dragging in `audit-log-dao` / `rbac-dao` / `db.ts`
 * (all of which import the Bun-only `bun:sqlite` driver).
 *
 * `rbac-enforce.ts` re-exports these for back-compat with existing
 * call sites (claude-mcp, codex-mcp, opencode-plugin, tests). New
 * Node-runtime call sites import from this module directly.
 */

import type { RbacMode } from "./daemon-db.ts";

export interface GrantRequirement {
  kind: string;
  value: string;
  /**
   * Optional scope qualifier the call requires. `undefined` means
   * scope-insensitive (boolean-grant kinds like `tool_family`); `null`
   * means the call demands `any` scope explicitly; a string means the
   * call needs that specific scope (and `any` scope also satisfies).
   */
  scope?: string | null;
}

/**
 * Action → list of grant requirements. Order matters for audit
 * payload only (first miss is the "most important" requirement —
 * tool_family before action-level by convention).
 *
 * Underscored variants in the spec map to kebab-case here because
 * `action` arrives at `handleAgentApi` already converted by
 * `dispatchAgentRequest`. Audit payloads keep the kebab-case spelling
 * because that's what operators see in their tool logs.
 *
 * EP-022 / WA-097: this map is also the single source of truth for
 * the MCP visibility filter (`getToolFamily`). The integration files
 * (`claude-mcp.ts`, `codex-mcp.ts`, `opencode-plugin.ts`,
 * `pi-extension.ts`) read families from here at boot, so adding a new
 * gated tool is a one-place change.
 */
export const ACTION_GRANT_REQUIREMENTS: Record<string, readonly GrantRequirement[]> = {
  // Kanban — read
  "list-kanban-tasks": [{ kind: "tool_family", value: "kanban-read" }],
  "read-kanban-task": [{ kind: "tool_family", value: "kanban-read" }],
  "list-kanban-epics": [{ kind: "tool_family", value: "kanban-read" }],
  "read-kanban-epic": [{ kind: "tool_family", value: "kanban-read" }],

  // Kanban — admin (create, edit metadata, archive)
  "create-kanban-task": [
    { kind: "tool_family", value: "kanban-admin" },
    { kind: "kanban_action", value: "create_task" },
  ],
  "create-kanban-epic": [
    { kind: "tool_family", value: "kanban-admin" },
    { kind: "kanban_action", value: "create_epic" },
  ],
  "update-kanban-task": [
    { kind: "tool_family", value: "kanban-admin" },
    { kind: "kanban_action", value: "update_task" },
  ],
  "update-kanban-epic": [
    { kind: "tool_family", value: "kanban-admin" },
    { kind: "kanban_action", value: "update_epic" },
  ],
  "archive-kanban-task": [
    { kind: "tool_family", value: "kanban-admin" },
    { kind: "kanban_action", value: "archive_task" },
  ],
  "archive-kanban-epic": [
    { kind: "tool_family", value: "kanban-admin" },
    { kind: "kanban_action", value: "archive_epic" },
  ],

  // Kanban — status (scope-aware: dynamicScope=own_assignment if actor is assignee)
  "update-kanban-task-status": [
    { kind: "tool_family", value: "kanban-status" },
    { kind: "kanban_action", value: "update_task_status" },
  ],
  "update-kanban-epic-status": [
    { kind: "tool_family", value: "kanban-status" },
    { kind: "kanban_action", value: "update_epic_status" },
  ],
  "request-kanban-epic-close": [
    { kind: "tool_family", value: "kanban-status" },
    { kind: "kanban_action", value: "request_epic_close" },
  ],
  "cancel-kanban-epic-close": [
    { kind: "tool_family", value: "kanban-status" },
    { kind: "kanban_action", value: "cancel_epic_close" },
  ],

  // Kanban — comment (scope-aware)
  "comment-kanban-task": [
    { kind: "tool_family", value: "kanban-comment" },
    { kind: "kanban_action", value: "comment_task" },
  ],
  "comment-kanban-epic": [
    { kind: "tool_family", value: "kanban-comment" },
    { kind: "kanban_action", value: "comment_epic" },
  ],

  // Messaging — `send-message` is direct messaging only; channel verbs live
  // in the channel-read / channel-write families below. EP-022 / WA-093
  // moved `broadcast-message` out of `messaging` because broadcast is a
  // channel-write op (the channel-read role must NOT also be able to
  // broadcast).
  "send-message": [{ kind: "tool_family", value: "messaging" }],
  "broadcast-message": [
    { kind: "tool_family", value: "channel-write" },
    { kind: "channel_action", value: "broadcast_message" },
  ],

  // Channels — EP-022 / WA-093 split the coarse `channel` family into
  // `channel-read` (read_channel_messages only) and `channel-write`
  // (post / reply / broadcast). The `restricted` role gains
  // `tool_family:channel-read` in the same slice so the special-case
  // skip the old `read-channel-messages` requirement carried (no
  // tool_family layer at all) is no longer needed: the two-layer rule
  // (family gates visibility, action gates execution) holds without
  // exceptions.
  "post-channel-message": [
    { kind: "tool_family", value: "channel-write" },
    { kind: "channel_action", value: "post_channel_message" },
  ],
  "reply-channel-thread": [
    { kind: "tool_family", value: "channel-write" },
    { kind: "channel_action", value: "reply_channel_thread" },
  ],
  "read-channel-messages": [
    { kind: "tool_family", value: "channel-read" },
    { kind: "channel_action", value: "read_channel_messages" },
  ],

  // Search — EP-024. Direct messages are gated by the messaging family;
  // channel search has its own action grain separate from channel read.
  "search-direct-messages": [{ kind: "tool_family", value: "messaging" }],
  "search-channel-messages": [
    { kind: "tool_family", value: "channel-read" },
    { kind: "channel_action", value: "search_channel_messages" },
  ],
  "search-kanban-tasks": [{ kind: "tool_family", value: "kanban-read" }],
  "search-kanban-epics": [{ kind: "tool_family", value: "kanban-read" }],

  // Summary — agent-identity introspection + status surface. EP-022 /
  // WA-097 maps `list-peers` + `set-summary` to `tool_family:summary`
  // so unticking the chip on the Roles tab actually hides those tools
  // (advisor msg #419 — pre-fix, summary was a no-op family).
  "list-peers": [{ kind: "tool_family", value: "summary" }],
  "set-summary": [{ kind: "tool_family", value: "summary" }],

  // Always-on housekeeping — `whoami` is the snapshot/whoami fetch the
  // MCP boot path uses to learn which families the agent holds, so it
  // must register regardless of mode (the agent has no way to discover
  // its own grants without it). `check-messages` is the inbox-delivery
  // primitive; gating it would lock the agent out of the colleague
  // protocol the daemon documents in every launch prompt. Both stay
  // out of ACTION_GRANT_REQUIREMENTS so `getToolFamily` returns null
  // for them and `shouldExposeTool` exposes them universally.
  // poll-messages + mark-messages-read are also intentionally absent.
};

/**
 * EP-022 / WA-097: MCP-tool-name → tool_family lookup. Drives the
 * register-time visibility filter in
 * `src/integrations/{claude,codex,opencode,pi}-*.ts` so agents only see
 * the tools they actually hold a family grant for. Returns `null` for
 * tools that have no `tool_family` requirement — that bucket is the
 * always-on housekeeping pair `whoami` (the boot snapshot fetch needs
 * it) and `check_messages` (inbox-delivery primitive used by the
 * colleague protocol).
 *
 * Single source of truth: derives from `ACTION_GRANT_REQUIREMENTS` so
 * adding or moving an action's family requirement automatically updates
 * what the MCP integrations expose, no second list to keep in sync.
 *
 * Conversion: integration files use snake_case tool names
 * (`create_kanban_task`); ACTION_GRANT_REQUIREMENTS uses the
 * dispatcher-side kebab-case (`create-kanban-task`). The helper accepts
 * snake_case input and converts internally.
 */
export function getToolFamily(toolName: string): string | null {
  const action = toolName.replace(/_/g, "-");
  const reqs = ACTION_GRANT_REQUIREMENTS[action];
  if (!reqs) return null;
  const familyReq = reqs.find((r) => r.kind === "tool_family");
  return familyReq?.value ?? null;
}

/**
 * EP-022 / WA-097: register-time visibility decision. Returns true when
 * the tool should be exposed to the agent's MCP server, false when it
 * should be skipped during `server.registerTool` so the agent never sees
 * it in the tool list.
 *
 * Rules:
 *   - `mode === "off"`: every tool exposed (off short-circuits both
 *     enforcement AND visibility — operator opted out of RBAC entirely).
 *   - Tool with no family (whoami, set_summary, etc.): always exposed
 *     (these are housekeeping tools every agent needs).
 *   - Otherwise: exposed iff agent's `tool_families` contains the family.
 *
 * Boot-time snapshot caveat: this evaluates once at MCP server boot
 * for each agent. Role / mode changes after boot do NOT re-register
 * tools live; the agent must relaunch / reconnect to pick up new
 * visibility. Documented in tool descriptions + Roles tab UI hint.
 */
export function shouldExposeTool(toolName: string, agentToolFamilies: readonly string[], mode: RbacMode): boolean {
  if (mode === "off") return true;
  const family = getToolFamily(toolName);
  if (family === null) return true;
  return agentToolFamilies.includes(family);
}
