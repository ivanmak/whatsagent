#!/usr/bin/env bun
// Claude Code MCP stdio server. It refuses to run outside a WhatsAgent-launched
// PTY and exposes WhatsAgent messaging tools backed by the local daemon.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { MessageRow } from "../db.ts";
import { DEFAULT_AGENT_TEXT_SETTINGS, normalizeAgentTextSettings, type AgentTextSettings } from "../messages/agent-text-settings.ts";
import { formatInboxEnvelope, INBOX_ENVELOPE_NONCE_EXHAUSTION_MESSAGE } from "../messages/inbox-envelope.ts";
import { shouldExposeTool } from "../rbac-enforce.ts";
import { createAgentTools, formatWhatsAgentToolFailure, safeAgentToolCall, type AgentTools } from "./agent-client.ts";
import { requireLaunchContext, validateLaunchContext, type FetchLike, type LaunchContext } from "./launch-token.ts";
import { LruSet, defaultPushSeenCapacity } from "./lru-set.ts";
import { loadRbacBootSnapshot, PERMISSIVE_RBAC_BOOT_SNAPSHOT, type RbacBootSnapshot } from "./rbac-snapshot.ts";
import { mergeRecentDelivered, recordRecentDelivered } from "./recent-delivered.ts";
import { WHATSAGENT_VERSION } from "../version.ts";

export interface ClaudeToolHandlers {
  whoami(): Promise<unknown>;
  list_peers(input?: { details?: boolean }): Promise<unknown>;
  list_kanban_tasks(input?: Record<string, unknown>): Promise<unknown>;
  read_kanban_task(input: { taskId?: string; task_id?: string }): Promise<unknown>;
  create_kanban_task(input: Record<string, unknown>): Promise<unknown>;
  update_kanban_task(input: Record<string, unknown>): Promise<unknown>;
  update_kanban_task_status(input: { taskId?: string; task_id?: string; status?: string }): Promise<unknown>;
  comment_kanban_task(input: { taskId?: string; task_id?: string; type?: string; body?: string }): Promise<unknown>;
  archive_kanban_task(input: { taskId?: string; task_id?: string }): Promise<unknown>;
  list_kanban_epics(input?: Record<string, unknown>): Promise<unknown>;
  read_kanban_epic(input: { epicId?: string; epic_id?: string }): Promise<unknown>;
  create_kanban_epic(input: Record<string, unknown>): Promise<unknown>;
  update_kanban_epic(input: Record<string, unknown>): Promise<unknown>;
  comment_kanban_epic(input: { epicId?: string; epic_id?: string; type?: string; body?: string }): Promise<unknown>;
  archive_kanban_epic(input: { epicId?: string; epic_id?: string }): Promise<unknown>;
  update_kanban_epic_status(input: { epicId?: string; epic_id?: string; status?: string }): Promise<unknown>;
  request_kanban_epic_close(input: { epicId?: string; epic_id?: string }): Promise<unknown>;
  cancel_kanban_epic_close(input: { epicId?: string; epic_id?: string }): Promise<unknown>;
  send_message(input: { toRole?: string; to_role?: string; body?: string }): Promise<unknown>;
  broadcast_message(input: { body?: string }): Promise<unknown>;
  post_channel_message(input: { body?: string }): Promise<unknown>;
  reply_channel_thread(input: { messageId?: number; message_id?: number; body?: string }): Promise<unknown>;
  read_channel_messages(input?: { limit?: number; sinceId?: number; beforeId?: number }): Promise<unknown>;
  search_direct_messages(input: Record<string, unknown>): Promise<unknown>;
  search_channel_messages(input: Record<string, unknown>): Promise<unknown>;
  search_kanban_tasks(input: Record<string, unknown>): Promise<unknown>;
  search_kanban_epics(input: Record<string, unknown>): Promise<unknown>;
  check_messages(input?: { limit?: number }): Promise<unknown>;
  set_summary(input: { summary?: string }): Promise<unknown>;
}

export const CLAUDE_TOOL_NAMES = ["whoami", "list_peers", "list_kanban_tasks", "read_kanban_task", "create_kanban_task", "update_kanban_task", "update_kanban_task_status", "comment_kanban_task", "archive_kanban_task", "list_kanban_epics", "read_kanban_epic", "create_kanban_epic", "update_kanban_epic", "comment_kanban_epic", "archive_kanban_epic", "update_kanban_epic_status", "request_kanban_epic_close", "cancel_kanban_epic_close", "send_message", "broadcast_message", "post_channel_message", "reply_channel_thread", "read_channel_messages", "search_direct_messages", "search_channel_messages", "search_kanban_tasks", "search_kanban_epics", "check_messages", "set_summary"] as const;
export const CLAUDE_CHANNEL_CAPABILITY = "claude/channel";
export const CLAUDE_CHANNEL_NOTIFICATION_METHOD = "notifications/claude/channel";

export interface ClaudeChannelSink {
  notification(notification: { method: string; params: { content: string; meta: Record<string, string> } }): Promise<void>;
}

export interface ClaudePushController {
  start(): void;
  stop(): void;
  pollOnce(): Promise<number>;
}

export function claudeIntegrationStatus(env: Record<string, string | undefined> = process.env): string {
  const ctx = requireLaunchContext(env);
  return `WhatsAgent Claude integration enabled for role ${ctx.role} (${ctx.sessionId})`;
}

export function createClaudeToolHandlers(context: LaunchContext, fetchImpl: FetchLike = fetch): ClaudeToolHandlers {
  return claudeHandlersFromAgentTools(createAgentTools(context, fetchImpl));
}

export async function createValidatedClaudeToolHandlers(env: Record<string, string | undefined> = process.env, fetchImpl: FetchLike = fetch): Promise<ClaudeToolHandlers> {
  const context = requireLaunchContext(env);
  if (!await validateLaunchContext(context, fetchImpl)) throw new Error("WhatsAgent launch token validation failed.");
  return createClaudeToolHandlers(context, fetchImpl);
}

export function createClaudeMcpServer(context: LaunchContext, fetchImpl: FetchLike = fetch, agentText: AgentTextSettings = DEFAULT_AGENT_TEXT_SETTINGS, rbac: RbacBootSnapshot = PERMISSIVE_RBAC_BOOT_SNAPSHOT): McpServer {
  const handlers = createClaudeToolHandlers(context, fetchImpl);
  const server = new McpServer(
    { name: "whatsagent", version: WHATSAGENT_VERSION },
    {
      instructions: `${agentText.colleagueProtocol}

DELIVERY ON THIS SIDE (Claude Code):

Treat WhatsAgent as a colleague inbox. Live messages may arrive through Claude's
native channel push while you are already in a turn. Treat those immediately,
using the same rules as WHATSAGENT INBOX blocks. On the first useful turn after
launch, call whoami, list_peers, check_messages, and set_summary. On every later
user turn, call check_messages before answering or changing files. This returns
a WHATSAGENT INBOX backfill for messages delivered while the session was idle.
Reply only when substantive; do not auto-acknowledge.`,
      capabilities: {
        experimental: { [CLAUDE_CHANNEL_CAPABILITY]: {} },
      },
    },
  );

  // EP-022 / WA-097: register-time visibility filter. Each
  // `register(...)` call below is gated on `shouldExposeTool(name,
  // families, mode)` so an agent that lacks a tool's family grant
  // never sees the tool in its MCP menu. `mode === "off"` short-
  // circuits to expose every tool (operator-level RBAC opt-out, no
  // auth gate anywhere). Tools with no `tool_family` requirement
  // (housekeeping like whoami / list_peers / set_summary /
  // check_messages) are always exposed.
  const register: typeof server.registerTool = ((name: string, def: unknown, handler: unknown) => {
    if (!shouldExposeTool(name, rbac.toolFamilies, rbac.mode)) return undefined as never;
    return (server.registerTool as (n: string, d: unknown, h: unknown) => unknown)(name, def, handler) as never;
  }) as typeof server.registerTool;

  register("whoami", {
    title: "Who Am I",
    description: "Show this WhatsAgent role, session, main role, and policy.",
  }, async () => toToolResult(await handlers.whoami(), "whoami"));

  register("list_peers", {
    title: "List Peers",
    description: "List other WhatsAgent agents in this workspace — `displayId`, `repo`, `name`, `roles[]` (RBAC role-name assignments per peer), `persona` description (or fuller persona with details), `isMain`, `active`. Caller is excluded; use `whoami` for self-introspection.",
    inputSchema: {
      details: z.boolean().optional().describe("Include safe runtime, summary, and attention metadata."),
    },
  }, async (input) => toToolResult(await handlers.list_peers(input), "list_peers"));

  register("list_kanban_tasks", {
    title: "List Kanban Tasks",
    description: "List WhatsAgent Kanban tasks. Humans read the board; policy-authorized agents manage it.",
    inputSchema: {
      includeArchived: z.boolean().optional().describe("Include archived tasks hidden from the default board."),
      status: z.enum(["Backlog", "Queued", "In Progress", "Blocked", "Review", "Completed"]).optional().describe("Filter by task status."),
      assignedTo: z.string().optional().describe("Filter by assigned role name."),
      createdBy: z.string().optional().describe("Filter by creator role name."),
      priority: z.enum(["P0", "P1", "P2", "P3"]).optional().describe("Filter by priority."),
      search: z.string().optional().describe("Search display id, title, or details."),
      limit: z.number().int().min(1).max(1000).optional().describe("Maximum tasks to return."),
      epicId: z.string().optional().describe("Filter by parent epic. Pass an epic display id (e.g. EP-001) to filter to that epic, or 'none' to filter to unclassified tasks (epic_id IS NULL)."),
    },
  }, async (input) => toToolResult(await handlers.list_kanban_tasks(input), "list_kanban_tasks"));

  register("read_kanban_task", {
    title: "Read Kanban Task",
    description: "Read one WhatsAgent Kanban task with comments, dependencies, and activity.",
    inputSchema: {
      taskId: z.string().describe("Task display id, for example WA-001."),
    },
  }, async (input) => toToolResult(await handlers.read_kanban_task(input), "read_kanban_task"));

  register("create_kanban_task", {
    title: "Create Kanban Task",
    description: "Create an assigned WhatsAgent Kanban task. Requires the `kanban-admin` tool-family grant (default: `pm` role). Comments are open to any agent with `kanban-comment`. Optional epicId links the task to a parent epic.",
    inputSchema: {
      title: z.string().describe("Task title."),
      assignedTo: z.string().describe("Assigned role name."),
      details: z.string().optional().describe("Markdown/text task details."),
      status: z.enum(["Backlog", "Queued", "In Progress", "Blocked", "Review", "Completed"]).optional(),
      priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
      effort: z.enum(["XS", "S", "M", "L", "XL"]).optional(),
      githubUrl: z.string().optional(),
      githubNumber: z.number().int().positive().optional(),
      githubTitle: z.string().optional(),
      epicId: z.string().optional().describe("Optional parent epic display id (e.g. EP-001). Omit to leave the task unlinked. Cannot point to an archived epic."),
    },
  }, async (input) => toToolResult(await handlers.create_kanban_task(input), "create_kanban_task"));

  register("update_kanban_task", {
    title: "Update Kanban Task",
    description: "Broadly update fields, assignment, status, dependencies, GitHub metadata, or epic link on a WhatsAgent Kanban task. Requires the `kanban-admin` tool-family grant (default: `pm` role). Assigned agents without `kanban-admin` should use update_kanban_task_status for progress moves.",
    inputSchema: {
      taskId: z.string().describe("Task display id, for example WA-001."),
      title: z.string().optional(),
      details: z.string().optional(),
      status: z.enum(["Backlog", "Queued", "In Progress", "Blocked", "Review", "Completed"]).optional(),
      priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
      effort: z.enum(["XS", "S", "M", "L", "XL"]).optional(),
      assignedTo: z.string().optional().describe("New assigned role name."),
      dependsOnTaskIds: z.array(z.string()).optional().describe("Complete replacement list of dependency task ids."),
      githubUrl: z.string().nullable().optional(),
      githubNumber: z.number().int().positive().nullable().optional(),
      githubTitle: z.string().nullable().optional(),
      epicId: z.string().nullable().optional().describe("Parent epic display id (e.g. EP-001) to link the task. Pass null to unlink. Omit to leave unchanged. Cannot point to an archived epic."),
    },
  }, async (input) => toToolResult(await handlers.update_kanban_task(input), "update_kanban_task"));

  register("update_kanban_task_status", {
    title: "Update Kanban Task Status",
    description: "Move a WhatsAgent Kanban task status. Requires `kanban-status` family grant. With `update_task_status` at any-scope (default: `pm`) all transitions are allowed; with own_assignment scope (default: `engineer`) the assignee may move Queued/active tasks to In Progress, Blocked, or Review only.",
    inputSchema: {
      taskId: z.string().describe("Task display id, for example WA-001."),
      status: z.enum(["Backlog", "Queued", "In Progress", "Blocked", "Review", "Completed"]).describe("New task status."),
    },
  }, async (input) => toToolResult(await handlers.update_kanban_task_status(input), "update_kanban_task_status"));

  register("comment_kanban_task", {
    title: "Comment Kanban Task",
    description: "Add a typed progress, note, or blocker comment to a WhatsAgent Kanban task.",
    inputSchema: {
      taskId: z.string().describe("Task display id, for example WA-001."),
      type: z.enum(["progress", "note", "blocker"]).describe("Comment type."),
      body: z.string().describe("Comment body."),
    },
  }, async (input) => toToolResult(await handlers.comment_kanban_task(input), "comment_kanban_task"));

  register("archive_kanban_task", {
    title: "Archive Kanban Task",
    description: "Archive a WhatsAgent Kanban task without deleting it. Archived tasks are hidden by default.",
    inputSchema: {
      taskId: z.string().describe("Task display id, for example WA-001."),
    },
  }, async (input) => toToolResult(await handlers.archive_kanban_task(input), "archive_kanban_task"));

  register("list_kanban_epics", {
    title: "List Kanban Epics",
    description: "List WhatsAgent Kanban epics. Epics group related task issues. Read-only for humans.",
    inputSchema: {
      includeArchived: z.boolean().optional(),
      status: z.enum(["Backlog", "Queued", "In Progress", "Blocked", "Review", "Completed"]).optional(),
      assignedTo: z.string().optional(),
      createdBy: z.string().optional(),
      priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
      search: z.string().optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    },
  }, async (input) => toToolResult(await handlers.list_kanban_epics(input), "list_kanban_epics"));

  register("read_kanban_epic", {
    title: "Read Kanban Epic",
    description: "Read one WhatsAgent Kanban epic with comments, activity, and child issues.",
    inputSchema: {
      epicId: z.string().describe("Epic display id, for example EP-001."),
    },
  }, async (input) => toToolResult(await handlers.read_kanban_epic(input), "read_kanban_epic"));

  register("create_kanban_epic", {
    title: "Create Kanban Epic",
    description: "Create a Kanban epic. Requires the `kanban-admin` tool-family grant (default: `pm` role). Comments are open to any agent with `kanban-comment`.",
    inputSchema: {
      title: z.string().describe("Epic title."),
      assignedTo: z.string().describe("Assigned role name."),
      details: z.string().optional(),
      status: z.enum(["Backlog", "Queued", "In Progress", "Blocked", "Review", "Completed"]).optional(),
      priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
      effort: z.enum(["XS", "S", "M", "L", "XL"]).optional(),
      githubUrl: z.string().optional(),
      githubNumber: z.number().int().positive().optional(),
      githubTitle: z.string().optional(),
    },
  }, async (input) => toToolResult(await handlers.create_kanban_epic(input), "create_kanban_epic"));

  register("update_kanban_epic", {
    title: "Update Kanban Epic",
    description: "Broadly update fields, assignment, priority, effort, or GitHub metadata on a Kanban epic. Requires the `kanban-admin` tool-family grant (default: `pm` role). The `Completed` status cannot be set here; it must go through the close-approval workflow via update_kanban_epic_status or request_kanban_epic_close.",
    inputSchema: {
      epicId: z.string().describe("Epic display id, for example EP-001."),
      title: z.string().optional(),
      details: z.string().optional(),
      status: z.enum(["Backlog", "Queued", "In Progress", "Blocked", "Review", "Completed"]).optional(),
      priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
      effort: z.enum(["XS", "S", "M", "L", "XL"]).optional(),
      assignedTo: z.string().optional(),
      githubUrl: z.string().nullable().optional(),
      githubNumber: z.number().int().positive().nullable().optional(),
      githubTitle: z.string().nullable().optional(),
    },
  }, async (input) => toToolResult(await handlers.update_kanban_epic(input), "update_kanban_epic"));

  register("comment_kanban_epic", {
    title: "Comment Kanban Epic",
    description: "Add a typed progress, note, or blocker comment to a Kanban epic.",
    inputSchema: {
      epicId: z.string().describe("Epic display id, for example EP-001."),
      type: z.enum(["progress", "note", "blocker"]),
      body: z.string(),
    },
  }, async (input) => toToolResult(await handlers.comment_kanban_epic(input), "comment_kanban_epic"));

  register("archive_kanban_epic", {
    title: "Archive Kanban Epic",
    description: "Archive a Kanban epic. Rejects with 409 if open child issues are present.",
    inputSchema: {
      epicId: z.string().describe("Epic display id, for example EP-001."),
    },
  }, async (input) => toToolResult(await handlers.archive_kanban_epic(input), "archive_kanban_epic"));

  register("update_kanban_epic_status", {
    title: "Update Kanban Epic Status",
    description: "Move a Kanban epic status. Requires `kanban-status` family grant. Any-scope `update_epic_status` (default: `pm`) allows all transitions; own_assignment scope restricts the assignee to Queued/active source states. Moves to Completed run the close-approval workflow (auto-completes when no open children, otherwise enters pending and only a human web session can approve).",
    inputSchema: {
      epicId: z.string().describe("Epic display id, for example EP-001."),
      status: z.enum(["Backlog", "Queued", "In Progress", "Blocked", "Review", "Completed"]).describe("New epic status."),
    },
  }, async (input) => toToolResult(await handlers.update_kanban_epic_status(input), "update_kanban_epic_status"));

  register("request_kanban_epic_close", {
    title: "Request Kanban Epic Close",
    description: "Request closing a Kanban epic. If no children are open, the epic auto-completes; otherwise enters close-approval pending state until a human web session approves or cancels.",
    inputSchema: {
      epicId: z.string().describe("Epic display id, for example EP-001."),
    },
  }, async (input) => toToolResult(await handlers.request_kanban_epic_close(input), "request_kanban_epic_close"));

  register("cancel_kanban_epic_close", {
    title: "Cancel Kanban Epic Close",
    description: "Cancel a pending close-approval on a Kanban epic. Requires the `kanban_action:cancel_epic_close` grant (default: `pm` any-scope, or assignee with own_assignment scope).",
    inputSchema: {
      epicId: z.string().describe("Epic display id, for example EP-001."),
    },
  }, async (input) => toToolResult(await handlers.cancel_kanban_epic_close(input), "cancel_kanban_epic_close"));

  register("send_message", {
    title: "Send Message",
    description: "Send a useful colleague message to another WhatsAgent role. Include the concrete ask and context. WhatsAgent communication policy is enforced by the daemon.",
    inputSchema: {
      toRole: z.string().describe("Target role display id (`repo:role`), for example whatsagent:dev or infra:scout. Use `human-web` to reach the web user."),
      body: z.string().describe("Markdown/text message body."),
    },
  }, async (input) => toToolResult(await handlers.send_message(input), "send_message"));

  register("broadcast_message", {
    title: "Broadcast Message",
    description: "Broadcast a useful colleague message from the main role to all online non-main roles. Only available in Star Topology.",
    inputSchema: {
      body: z.string().describe("Markdown/text broadcast body."),
    },
  }, async (input) => toToolResult(await handlers.broadcast_message(input), "broadcast_message"));

  register("post_channel_message", {
    title: "Post Channel Message",
    description: "Post a useful colleague message as a new root message in the shared WhatsAgent channel. Only available in Channel policy.",
    inputSchema: {
      body: z.string().describe("Markdown/text channel message body."),
    },
  }, async (input) => toToolResult(await handlers.post_channel_message(input), "post_channel_message"));

  register("reply_channel_thread", {
    title: "Reply Channel Thread",
    description: "Post a useful colleague reply to an existing WhatsAgent Channel message or thread. Only available in Channel policy.",
    inputSchema: {
      messageId: z.number().int().positive().describe("Existing Channel message id to reply to."),
      body: z.string().describe("Markdown/text thread reply body."),
    },
  }, async (input) => toToolResult(await handlers.reply_channel_thread(input), "reply_channel_thread"));

  register("read_channel_messages", {
    title: "Read Channel Messages",
    description: "Read recent WhatsAgent Channel history for context only. History reads are not an actionable inbox backlog, and the daemon rejects this outside Channel policy.",
    inputSchema: {
      limit: z.number().int().min(1).max(500).optional().describe("Maximum channel messages to read."),
      sinceId: z.number().int().positive().optional().describe("Only messages after this id."),
      beforeId: z.number().int().positive().optional().describe("Only messages before this id."),
    },
  }, async (input) => toToolResult(await handlers.read_channel_messages(input), "read_channel_messages"));

  register("search_direct_messages", {
    title: "Search Direct Messages",
    description: "Search direct messages visible to this agent. Use for private role-to-role message history, not shared Channel posts.",
    inputSchema: {
      q: z.string().min(2).max(200).describe("Search query."),
      sender: z.string().optional().describe("Optional sender role display id or name."),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum results to return."),
    },
  }, async (input) => toToolResult(await handlers.search_direct_messages(input), "search_direct_messages"));

  register("search_channel_messages", {
    title: "Search Channel Messages",
    description: "Search shared Channel history. Use for workspace-wide Channel posts and threads, not private direct messages.",
    inputSchema: {
      q: z.string().min(2).max(200).describe("Search query."),
      sender: z.string().optional().describe("Optional sender role display id or name."),
      channel: z.string().optional().describe("Optional channel id/name; defaults to all searchable channel history."),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum results to return."),
    },
  }, async (input) => toToolResult(await handlers.search_channel_messages(input), "search_channel_messages"));

  register("search_kanban_tasks", {
    title: "Search Kanban Tasks",
    description: "Search Kanban task titles, details, and task comments. Use for issue/task history, not epics.",
    inputSchema: {
      q: z.string().min(2).max(200).describe("Search query."),
      status: z.enum(["Backlog", "Queued", "In Progress", "Blocked", "Review", "Completed"]).optional().describe("Optional task status filter."),
      assignee: z.string().optional().describe("Optional assigned role display id or name."),
      assignedTo: z.string().optional().describe("Alias for assignee."),
      includeArchived: z.boolean().optional().describe("Include archived tasks hidden by default."),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum results to return."),
    },
  }, async (input) => toToolResult(await handlers.search_kanban_tasks(input), "search_kanban_tasks"));

  register("search_kanban_epics", {
    title: "Search Kanban Epics",
    description: "Search Kanban epic titles, details, and epic comments. Use for epic-level history, not individual tasks.",
    inputSchema: {
      q: z.string().min(2).max(200).describe("Search query."),
      status: z.enum(["Backlog", "Queued", "In Progress", "Blocked", "Review", "Completed"]).optional().describe("Optional epic status filter."),
      assignee: z.string().optional().describe("Optional assigned role display id or name."),
      assignedTo: z.string().optional().describe("Alias for assignee."),
      includeArchived: z.boolean().optional().describe("Include archived epics hidden by default."),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum results to return."),
    },
  }, async (input) => toToolResult(await handlers.search_kanban_epics(input), "search_kanban_epics"));

  register("check_messages", {
    title: "Check Messages",
    description: "Deliver pending WhatsAgent messages. Call first on every user turn before answering or editing files.",
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional().describe("Maximum pending messages to deliver."),
    },
  }, async (input) => toToolResult(await handlers.check_messages(input), "check_messages"));

  register("set_summary", {
    title: "Set Summary",
    description: "Set or refresh a 1-2 sentence current-work summary visible to other roles.",
    inputSchema: {
      summary: z.string().max(4000).describe("Current-work summary."),
    },
  }, async (input) => toToolResult(await handlers.set_summary(input), "set_summary"));

  return server;
}

export async function runClaudeMcpServer(env: Record<string, string | undefined> = process.env, fetchImpl: FetchLike = fetch): Promise<void> {
  const context = requireLaunchContext(env);
  if (!await validateLaunchContext(context, fetchImpl)) throw new Error("WhatsAgent launch token validation failed.");
  const agentText = await loadAgentTextSettings(context, fetchImpl);
  // EP-022 / WA-097: fetch RBAC visibility snapshot once at boot. The
  // server then registers only tools the agent holds the family grant
  // for. `loadRbacBootSnapshot` returns the permissive default on any
  // failure so a transient whoami error does not lock the agent out
  // — the dispatcher's per-call enforcement still applies.
  const rbac = await loadRbacBootSnapshot(context, fetchImpl);
  const server = createClaudeMcpServer(context, fetchImpl, agentText, rbac);
  const push = createClaudePushController(context, server.server as unknown as ClaudeChannelSink, fetchImpl, { start: false });
  await server.connect(new StdioServerTransport());
  push.start();
}

async function loadAgentTextSettings(context: LaunchContext, fetchImpl: FetchLike): Promise<AgentTextSettings> {
  try {
    const result = await createAgentTools(context, fetchImpl).settings() as { agentText?: unknown };
    return normalizeAgentTextSettings(result.agentText);
  } catch {
    return DEFAULT_AGENT_TEXT_SETTINGS;
  }
}

export function createClaudePushController(
  context: LaunchContext,
  sink: ClaudeChannelSink,
  fetchImpl: FetchLike = fetch,
  opts: { intervalMs?: number; start?: boolean } = {},
): ClaudePushController {
  const tools = createAgentTools(context, fetchImpl);
  // Bounded so a long-running Claude session doesn't accumulate one entry per
  // ever-delivered message (audit P2). Oldest keys age out; if a really old
  // message id appears again it might re-deliver, but the daemon is the
  // source of truth via mark-read receipts so the cost is at most one
  // duplicate notification.
  const seen = new LruSet(defaultPushSeenCapacity());
  const intervalMs = Math.max(250, opts.intervalMs ?? 1000);
  let stopped = true;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const pollOnce = async (): Promise<number> => {
    const polled = await tools.pollMessages(50) as { messages?: MessageRow[] };
    const messages = Array.isArray(polled.messages) ? polled.messages : [];
    // EP-030: split direct/broadcast (push-state machine) from channel and
    // kanban (no push-state). Direct/broadcast → mark-messages-pushed so
    // delivery only flips to delivered on the agent's check_messages pull.
    // Channel rows have no push-state on the channel_messages table; their
    // state advances via channel_reads cursor — keep the existing
    // mark-messages-read semantics. Kanban also uses mark-messages-read.
    const pushedMessageIds: number[] = [];
    const readMessageIds: number[] = [];
    const readKanbanNotificationIds: number[] = [];
    const readKanbanEpicNotificationIds: number[] = [];
    const queueRead = (message: MessageRow) => {
      if (message.delivery_kind === "kanban") {
        if (message.kanban_epic_notification_id != null) readKanbanEpicNotificationIds.push(message.kanban_epic_notification_id);
        else readKanbanNotificationIds.push(message.kanban_notification_id ?? message.id);
      } else if (message.delivery_kind === "channel") {
        readMessageIds.push(message.id);
      } else {
        pushedMessageIds.push(message.id);
      }
    };
    const fresh = messages.filter((message) => !seen.has(messageKey(message)));
    if (fresh.length > 0) {
      await sink.notification(toClaudeChannelNotification(fresh));
      for (const message of fresh) {
        seen.add(messageKey(message));
        recordRecentDelivered(message);
      }
    }
    for (const message of messages) queueRead(message);
    if (pushedMessageIds.length > 0) {
      await tools.markMessagesPushed(pushedMessageIds);
    }
    if (readMessageIds.length > 0 || readKanbanNotificationIds.length > 0 || readKanbanEpicNotificationIds.length > 0) {
      await tools.markMessagesRead(readMessageIds, readKanbanNotificationIds, readKanbanEpicNotificationIds);
    }
    return pushedMessageIds.length + readMessageIds.length + readKanbanNotificationIds.length + readKanbanEpicNotificationIds.length;
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(async () => {
      try {
        await pollOnce();
      } catch (e) {
        console.error(`[whatsagent/claude-push] ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        schedule();
      }
    }, intervalMs);
    timer.unref?.();
  };

  const controller: ClaudePushController = {
    start() {
      if (!stopped) return;
      stopped = false;
      schedule();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
    pollOnce,
  };
  if (opts.start !== false) controller.start();
  return controller;
}

function claudeHandlersFromAgentTools(tools: AgentTools): ClaudeToolHandlers {
  return {
    whoami: () => safeAgentToolCall("whoami", () => tools.whoami()),
    list_peers: (input = {}) => safeAgentToolCall("list_peers", () => tools.listPeers({ details: Boolean(input.details) })),
    list_kanban_tasks: (input = {}) => safeAgentToolCall("list_kanban_tasks", () => tools.listKanbanTasks(input)),
    read_kanban_task: (input) => safeAgentToolCall("read_kanban_task", () => tools.readKanbanTask(String(input.taskId ?? input.task_id ?? ""))),
    create_kanban_task: (input) => safeAgentToolCall("create_kanban_task", () => tools.createKanbanTask(input)),
    update_kanban_task: (input) => safeAgentToolCall("update_kanban_task", () => tools.updateKanbanTask(String(input.taskId ?? input.task_id ?? ""), input)),
    update_kanban_task_status: (input) => safeAgentToolCall("update_kanban_task_status", () => tools.updateKanbanTaskStatus(String(input.taskId ?? input.task_id ?? ""), String(input.status ?? ""))),
    comment_kanban_task: (input) => safeAgentToolCall("comment_kanban_task", () => tools.commentKanbanTask(String(input.taskId ?? input.task_id ?? ""), String(input.type ?? "progress"), String(input.body ?? ""))),
    archive_kanban_task: (input) => safeAgentToolCall("archive_kanban_task", () => tools.archiveKanbanTask(String(input.taskId ?? input.task_id ?? ""))),
    list_kanban_epics: (input = {}) => safeAgentToolCall("list_kanban_epics", () => tools.listKanbanEpics(input)),
    read_kanban_epic: (input) => safeAgentToolCall("read_kanban_epic", () => tools.readKanbanEpic(String(input.epicId ?? input.epic_id ?? ""))),
    create_kanban_epic: (input) => safeAgentToolCall("create_kanban_epic", () => tools.createKanbanEpic(input)),
    update_kanban_epic: (input) => safeAgentToolCall("update_kanban_epic", () => tools.updateKanbanEpic(String(input.epicId ?? input.epic_id ?? ""), input)),
    comment_kanban_epic: (input) => safeAgentToolCall("comment_kanban_epic", () => tools.commentKanbanEpic(String(input.epicId ?? input.epic_id ?? ""), String(input.type ?? "progress"), String(input.body ?? ""))),
    archive_kanban_epic: (input) => safeAgentToolCall("archive_kanban_epic", () => tools.archiveKanbanEpic(String(input.epicId ?? input.epic_id ?? ""))),
    update_kanban_epic_status: (input) => safeAgentToolCall("update_kanban_epic_status", () => tools.updateKanbanEpicStatus(String(input.epicId ?? input.epic_id ?? ""), String(input.status ?? ""))),
    request_kanban_epic_close: (input) => safeAgentToolCall("request_kanban_epic_close", () => tools.requestKanbanEpicClose(String(input.epicId ?? input.epic_id ?? ""))),
    cancel_kanban_epic_close: (input) => safeAgentToolCall("cancel_kanban_epic_close", () => tools.cancelKanbanEpicClose(String(input.epicId ?? input.epic_id ?? ""))),
    send_message: (input) => safeAgentToolCall("send_message", () => tools.sendMessage(String(input.toRole ?? input.to_role ?? ""), String(input.body ?? ""))),
    broadcast_message: (input) => safeAgentToolCall("broadcast_message", () => tools.broadcastMessage(String(input.body ?? ""))),
    post_channel_message: (input) => safeAgentToolCall("post_channel_message", () => tools.postChannelMessage(String(input.body ?? ""))),
    reply_channel_thread: (input) => safeAgentToolCall("reply_channel_thread", () => tools.replyChannelThread(normalizeMessageId(input.messageId ?? input.message_id), String(input.body ?? ""))),
    read_channel_messages: (input = {}) => safeAgentToolCall("read_channel_messages", () => tools.readChannelMessages(input)),
    search_direct_messages: (input) => safeAgentToolCall("search_direct_messages", () => tools.search_direct_messages(input)),
    search_channel_messages: (input) => safeAgentToolCall("search_channel_messages", () => tools.search_channel_messages(input)),
    search_kanban_tasks: (input) => safeAgentToolCall("search_kanban_tasks", () => tools.search_kanban_tasks(input)),
    search_kanban_epics: (input) => safeAgentToolCall("search_kanban_epics", () => tools.search_kanban_epics(input)),
    check_messages: async (input = {}) => {
      const result = await safeAgentToolCall("check_messages", () => tools.checkMessages(input.limit)) as { ok?: boolean; messages?: MessageRow[]; envelope?: string; agentText?: AgentTextSettings };
      if (result.ok === false) return result;
      const messages = Array.isArray(result.messages) ? result.messages : [];
      const merged = mergeRecentDelivered(messages);
      if (merged.length === messages.length) return result;
      try {
        // Audit-exempt: Claude MCP has no workspace DB handle; daemon check/poll
        // calls record nonce-collision telemetry at the authoritative boundary.
        return { ...result, messages: merged, envelope: formatInboxEnvelope(merged, result.agentText) };
      } catch (error) {
        if (error instanceof Error && error.message === INBOX_ENVELOPE_NONCE_EXHAUSTION_MESSAGE) return { ...result, ok: false, error: "inbox_envelope_nonce_exhaustion", envelope: "" };
        throw error;
      }
    },
    set_summary: (input) => safeAgentToolCall("set_summary", () => tools.setSummary(String(input.summary ?? ""))),
  };
}

function toClaudeChannelNotification(messages: MessageRow[]): { method: string; params: { content: string; meta: Record<string, string> } } {
  const first = messages[0];
  const count = messages.length;
  const meta: Record<string, string> = {
    count: String(count),
    message_ids: messages.map((message) => String(message.id)).join(","),
    delivery_kinds: Array.from(new Set(messages.map((message) => message.delivery_kind))).join(","),
  };
  if (first && count === 1) {
    meta.message_id = String(first.id);
    meta.thread_id = first.thread_id;
    meta.from_name = first.from_role_name ?? "human-web";
    meta.to_name = first.to_role_name;
    meta.sent_at = first.sent_at;
    if (first.delivery_kind === "kanban") {
      meta.delivery_kind = first.delivery_kind;
      meta.kanban_notification_id = String(first.kanban_notification_id ?? first.id);
      meta.kanban_task_id = first.kanban_task_display_id ?? "";
      meta.kanban_event = first.kanban_event_type ?? "";
    }
  }
  return {
    method: CLAUDE_CHANNEL_NOTIFICATION_METHOD,
    params: {
      content: claudePushSignalText(count),
      meta,
    },
  };
}

function claudePushSignalText(count: number): string {
  return `WhatsAgent inbox has ${count} message${count === 1 ? "" : "s"} waiting. Call check_messages.`;
}

function toToolResult(result: unknown, action: string): CallToolResult {
  return { content: [{ type: "text", text: formatToolText(result, action) }] };
}

function normalizeMessageId(value: unknown): number {
  const id = Number(value ?? 0);
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0;
}

function messageKey(message: MessageRow): string {
  if (message.delivery_kind === "kanban" && message.kanban_epic_notification_id != null) {
    return `kanban-epic::${message.kanban_epic_notification_id}`;
  }
  if (message.delivery_kind === "kanban") {
    return `kanban::${message.kanban_notification_id ?? message.id}`;
  }
  return `${message.delivery_kind}:${message.channel_id ?? ""}:${message.id}`;
}

function formatToolText(result: unknown, action: string): string {
  const body = result as { ok?: boolean; broadcastId?: string; task?: { display_id?: string; title?: string; status?: string; priority?: string; assigned_role_name?: string }; tasks?: Array<{ display_id?: string; title?: string; status?: string; priority?: string; assigned_role_name?: string }>; comment?: { task_display_id?: string; type?: string }; message?: { id?: number; to_role_name?: string; state?: string; channel_name?: string; parent_message_id?: number | null; root_message_id?: number | null }; messages?: Array<{ id?: number; to_role_name?: string; from_role_name?: string | null; sent_at?: string; body?: string; parent_message_id?: number | null; root_message_id?: number | null }>; envelope?: string; peers?: Array<{ displayId?: string; repo?: string | null; name: string; roles?: string[]; active?: boolean; isMain?: boolean; hostType?: string; status?: string; summary?: string; persona?: Record<string, string> | null }>; role?: { name?: string }; sessionId?: string; persona?: Record<string, string> | null };
  const failure = formatWhatsAgentToolFailure(body, action);
  if (failure) return failure;
  if (action === "list_kanban_tasks" && Array.isArray(body.tasks)) return formatKanbanTasks(body.tasks);
  if ((action === "read_kanban_task" || action === "create_kanban_task" || action === "update_kanban_task" || action === "update_kanban_task_status" || action === "archive_kanban_task") && body.task) return `Kanban task ${body.task.display_id ?? "?"}: ${body.task.title ?? ""} [${body.task.status ?? "unknown"}/${body.task.priority ?? "?"}] assigned=${body.task.assigned_role_name ?? "unknown"}`;
  if (action === "comment_kanban_task" && body.comment) return `Kanban ${body.comment.type ?? "comment"} comment added to ${body.comment.task_display_id ?? "task"}.`;
  if (action === "send_message" && body.message) return `Message sent to ${body.message.to_role_name ?? "role"} (id=${body.message.id}, state=${body.message.state ?? "pending"}).`;
  if (action === "broadcast_message" && Array.isArray(body.messages)) return `Broadcast sent to ${body.messages.length} online role(s) (broadcast_id=${body.broadcastId ?? "unknown"}).`;
  if (action === "post_channel_message" && body.message) return `Channel message posted to #${body.message.channel_name ?? "shared"} (id=${body.message.id}).`;
  if (action === "reply_channel_thread" && body.message) return `Channel thread reply posted to #${body.message.channel_name ?? "shared"} (id=${body.message.id}, parent=${body.message.parent_message_id ?? "unknown"}).`;
  if (action === "read_channel_messages" && Array.isArray(body.messages)) return formatChannelHistory(body.messages);
  if (action === "check_messages") return body.envelope || "No WhatsAgent messages are queued.";
  if (action === "list_peers" && Array.isArray(body.peers)) {
    return body.peers.map((peer) => `${peer.isMain ? "*" : " "} ${peer.displayId ?? peer.name}${peer.active ? " live" : " offline"}${peer.hostType ? ` ${peer.hostType}/${peer.status ?? "unknown"}` : ""}${peer.roles?.length ? ` [${peer.roles.join(", ")}]` : ""}${peer.persona?.description ? ` — ${peer.persona.description}` : ""}${peer.summary ? ` - ${peer.summary}` : ""}`).join("\n");
  }
  if (action === "whoami" && body.role) return formatWhoamiText(body);
  return JSON.stringify(result, null, 2);
}

function formatWhoamiText(body: { role?: { name?: string }; sessionId?: string; persona?: Record<string, string> | null }): string {
  const lines = [`role=${body.role?.name ?? "unknown"}`, `session=${body.sessionId ?? "unknown"}`];
  const persona = body.persona;
  if (persona && typeof persona === "object") {
    const entries = Object.entries(persona).filter(([, v]) => typeof v === "string" && v.trim().length > 0);
    if (entries.length) {
      lines.push("persona:");
      for (const [key, value] of entries) lines.push(`  ${key}: ${value}`);
    }
  }
  return lines.join("\n");
}

function formatKanbanTasks(tasks: Array<{ display_id?: string; title?: string; status?: string; priority?: string; assigned_role_name?: string }>): string {
  if (tasks.length === 0) return "No Kanban tasks found.";
  return tasks.map((task) => `${task.display_id ?? "?"} [${task.status ?? "unknown"}/${task.priority ?? "?"}] ${task.assigned_role_name ?? "unassigned"} - ${task.title ?? ""}`).join("\n");
}

function formatChannelHistory(messages: Array<{ id?: number; from_role_name?: string | null; sent_at?: string; body?: string; parent_message_id?: number | null; root_message_id?: number | null }>): string {
  if (messages.length === 0) return "No Channel messages found.";
  return messages.map((message) => {
    const thread = [message.parent_message_id ? `parent=${message.parent_message_id}` : "", message.root_message_id ? `root=${message.root_message_id}` : ""].filter(Boolean).join(" ");
    return `#${message.id ?? "?"}${thread ? ` ${thread}` : ""} ${message.from_role_name ?? "human-web"} ${message.sent_at ?? ""}\n${message.body ?? ""}`;
  }).join("\n\n");
}

if (import.meta.main) {
  try {
    console.error(claudeIntegrationStatus());
    await runClaudeMcpServer();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
