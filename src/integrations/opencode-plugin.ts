import { tool, type Hooks, type Plugin, type PluginInput } from "@opencode-ai/plugin";

import type { MessageRow } from "../db.ts";
import { shouldExposeTool } from "../rbac-enforce.ts";
import { createAgentTools, formatWhatsAgentToolFailure, safeAgentToolCall, type AgentTools } from "./agent-client.ts";
import { getLaunchContext, validateLaunchContext, type FetchLike, type LaunchContext } from "./launch-token.ts";
import { LruSet, defaultPushSeenCapacity } from "./lru-set.ts";
import { loadRbacBootSnapshot } from "./rbac-snapshot.ts";

const KANBAN_EFFORT_DESCRIPTION = "XS, S, M, L, or XL.";
const KANBAN_EFFORT_SCHEMA = tool.schema.enum(["XS", "S", "M", "L", "XL"]).optional().describe(KANBAN_EFFORT_DESCRIPTION);

export interface OpenCodeToolHandlers {
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

export interface OpenCodePushRuntime {
  client?: PluginInput["client"];
  directory?: string;
}

export interface OpenCodePushController {
  start(): void;
  stop(): void;
  pollOnce(): Promise<number>;
  noteSession(sessionId: string, status?: "idle" | "busy" | "unknown"): void;
  handleEvent(event: unknown): void;
}

type OpenCodeApiResult<T> = { data?: T; error?: unknown } | T | undefined;

interface OpenCodeClientShape {
  session?: {
    list?: (input?: unknown) => Promise<OpenCodeApiResult<Array<{ id: string; parentID?: string; time?: { updated?: number } }>>>;
    status?: (input?: unknown) => Promise<OpenCodeApiResult<Record<string, { type?: string }>>>;
    promptAsync?: (input: unknown) => Promise<OpenCodeApiResult<unknown>>;
  };
  tui?: {
    showToast?: (input: unknown) => Promise<unknown>;
    publish?: (input: unknown) => Promise<unknown>;
    appendPrompt?: (input: unknown) => Promise<OpenCodeApiResult<unknown>>;
    submitPrompt?: (input: unknown) => Promise<OpenCodeApiResult<unknown>>;
  };
}

type OpenCodePushTarget =
  | { kind: "ready"; sessionId: string }
  | { kind: "busy"; sessionId: string }
  | { kind: "none" }
  | { kind: "error" };

export function createOpenCodeToolHandlers(context: LaunchContext, fetchImpl: FetchLike = fetch): OpenCodeToolHandlers {
  return openCodeHandlersFromAgentTools(createAgentTools(context, fetchImpl));
}

export async function createWhatsAgentOpenCodeHooks(env: Record<string, string | undefined> = process.env, fetchImpl: FetchLike = fetch, runtime: OpenCodePushRuntime = {}): Promise<Hooks> {
  const ctx = getLaunchContext(env);
  if (!ctx) return {};
  if (!await validateLaunchContext(ctx, fetchImpl)) return {};
  const handlers = createOpenCodeToolHandlers(ctx, fetchImpl);
  // EP-022 / WA-097: fetch RBAC visibility snapshot once at boot;
  // permissive default on failure preserves the pre-EP-022 behavior of
  // exposing every tool when the snapshot loader can't resolve grants.
  const rbac = await loadRbacBootSnapshot(ctx, fetchImpl);
  const expose = (name: string): boolean => shouldExposeTool(name, rbac.toolFamilies, rbac.mode);
  const push = runtime.client ? createOpenCodePushController(ctx, runtime, fetchImpl) : undefined;
  // Build the full tool catalog first, then drop entries the agent
  // shouldn't see. Object.fromEntries + filter keeps each `tool({...})`
  // factory call explicit (good for grep) while letting the filter
  // step stay declarative.
  const allTools = {
      whoami: tool({
        description: "Show this WhatsAgent role, session, main role, and policy.",
        args: {},
        async execute() {
          return formatToolText(await handlers.whoami(), "whoami");
        },
      }),
      list_peers: tool({
        description: "List other WhatsAgent agents in this workspace — `displayId`, `repo`, `name`, `roles[]` (RBAC role-name assignments per peer), `persona` description (or fuller persona with details), `isMain`, `active`. Caller is excluded; use `whoami` for self-introspection.",
        args: {
          details: tool.schema.boolean().optional().describe("Include safe runtime, summary, and attention metadata."),
        },
        async execute(input) {
          return formatToolText(await handlers.list_peers(input), "list_peers");
        },
      }),
      list_kanban_tasks: tool({
        description: "List WhatsAgent Kanban tasks. Humans read the board; policy-authorized agents manage it.",
        args: {
          includeArchived: tool.schema.boolean().optional().describe("Include archived tasks."),
          status: tool.schema.string().optional().describe("Filter status: Backlog, Queued, In Progress, Blocked, Review, Completed."),
          assignedTo: tool.schema.string().optional().describe("Filter by assigned role name."),
          createdBy: tool.schema.string().optional().describe("Filter by creator role name."),
          priority: tool.schema.string().optional().describe("Filter priority: P0, P1, P2, P3."),
          search: tool.schema.string().optional().describe("Search display id, title, or details."),
          limit: tool.schema.number().int().min(1).max(1000).optional().describe("Maximum tasks to return."),
          epicId: tool.schema.string().optional().describe("Filter by epic display id, or 'none' for unclassified tasks."),
        },
        async execute(input) {
          return formatToolText(await handlers.list_kanban_tasks(input), "list_kanban_tasks");
        },
      }),
      read_kanban_task: tool({
        description: "Read one WhatsAgent Kanban task with comments, dependencies, and activity.",
        args: {
          taskId: tool.schema.string().describe("Task display id, for example WA-001."),
        },
        async execute(input) {
          return formatToolText(await handlers.read_kanban_task(input), "read_kanban_task");
        },
      }),
      create_kanban_task: tool({
        description: "Create an assigned WhatsAgent Kanban task. Requires the `kanban-admin` tool-family grant (default: `pm` role). Comments are open to any agent with `kanban-comment`. Optional epicId links the task to a parent epic.",
        args: {
          title: tool.schema.string().describe("Task title."),
          assignedTo: tool.schema.string().describe("Assigned role name."),
          details: tool.schema.string().optional().describe("Markdown/text task details."),
          status: tool.schema.string().optional().describe("Backlog, Queued, In Progress, Blocked, Review, or Completed."),
          priority: tool.schema.string().optional().describe("P0, P1, P2, or P3."),
          effort: KANBAN_EFFORT_SCHEMA,
          githubUrl: tool.schema.string().optional().describe("Optional GitHub issue URL."),
          githubNumber: tool.schema.number().int().positive().optional().describe("Optional GitHub issue number."),
          githubTitle: tool.schema.string().optional().describe("Optional GitHub issue title."),
          epicId: tool.schema.string().optional().describe("Optional parent epic display id."),
        },
        async execute(input) {
          return formatToolText(await handlers.create_kanban_task(input), "create_kanban_task");
        },
      }),
      update_kanban_task: tool({
        description: "Broadly update fields, assignment, status, dependencies, GitHub metadata, or epic link on a WhatsAgent Kanban task. Requires the `kanban-admin` tool-family grant (default: `pm` role). Assigned agents without `kanban-admin` should use update_kanban_task_status for progress moves.",
        args: {
          taskId: tool.schema.string().describe("Task display id, for example WA-001."),
          title: tool.schema.string().optional(),
          details: tool.schema.string().optional(),
          status: tool.schema.string().optional().describe("Backlog, Queued, In Progress, Blocked, Review, or Completed."),
          priority: tool.schema.string().optional().describe("P0, P1, P2, or P3."),
          effort: KANBAN_EFFORT_SCHEMA,
          assignedTo: tool.schema.string().optional().describe("New assigned role name."),
          dependsOnTaskIds: tool.schema.array(tool.schema.string()).optional().describe("Complete replacement list of dependency task ids."),
          epicId: tool.schema.string().nullable().optional().describe("Parent epic display id; null to unlink; omit to leave unchanged."),
          githubUrl: tool.schema.string().nullable().optional(),
          githubNumber: tool.schema.number().int().positive().nullable().optional(),
          githubTitle: tool.schema.string().nullable().optional(),
        },
        async execute(input) {
          return formatToolText(await handlers.update_kanban_task(input), "update_kanban_task");
        },
      }),
      update_kanban_task_status: tool({
        description: "Move a WhatsAgent Kanban task status. Requires `kanban-status` family grant. With `update_task_status` at any-scope (default: `pm`) all transitions are allowed; with own_assignment scope (default: `engineer`) the assignee may move Queued/active tasks to In Progress, Blocked, or Review only.",
        args: {
          taskId: tool.schema.string().describe("Task display id, for example WA-001."),
          status: tool.schema.string().describe("Backlog, Queued, In Progress, Blocked, Review, or Completed."),
        },
        async execute(input) {
          return formatToolText(await handlers.update_kanban_task_status(input), "update_kanban_task_status");
        },
      }),
      comment_kanban_task: tool({
        description: "Add a typed progress, note, or blocker comment to a WhatsAgent Kanban task.",
        args: {
          taskId: tool.schema.string().describe("Task display id, for example WA-001."),
          type: tool.schema.string().describe("progress, note, or blocker."),
          body: tool.schema.string().describe("Comment body."),
        },
        async execute(input) {
          return formatToolText(await handlers.comment_kanban_task(input), "comment_kanban_task");
        },
      }),
      archive_kanban_task: tool({
        description: "Archive a WhatsAgent Kanban task without deleting it.",
        args: {
          taskId: tool.schema.string().describe("Task display id, for example WA-001."),
        },
        async execute(input) {
          return formatToolText(await handlers.archive_kanban_task(input), "archive_kanban_task");
        },
      }),
      list_kanban_epics: tool({
        description: "List WhatsAgent Kanban epics. Epics group related task issues. Read-only for humans.",
        args: {
          includeArchived: tool.schema.boolean().optional(),
          status: tool.schema.string().optional().describe("Backlog, Queued, In Progress, Blocked, Review, or Completed."),
          assignedTo: tool.schema.string().optional(),
          createdBy: tool.schema.string().optional(),
          priority: tool.schema.string().optional().describe("P0, P1, P2, or P3."),
          search: tool.schema.string().optional(),
          limit: tool.schema.number().int().min(1).max(1000).optional(),
        },
        async execute(input) {
          return formatToolText(await handlers.list_kanban_epics(input), "list_kanban_epics");
        },
      }),
      read_kanban_epic: tool({
        description: "Read one Kanban epic with comments, activity, and child issues.",
        args: {
          epicId: tool.schema.string().describe("Epic display id, for example EP-001."),
        },
        async execute(input) {
          return formatToolText(await handlers.read_kanban_epic(input), "read_kanban_epic");
        },
      }),
      create_kanban_epic: tool({
        description: "Create a Kanban epic. Requires the `kanban-admin` tool-family grant (default: `pm` role).",
        args: {
          title: tool.schema.string(),
          assignedTo: tool.schema.string(),
          details: tool.schema.string().optional(),
          status: tool.schema.string().optional().describe("Backlog, Queued, In Progress, Blocked, Review, or Completed."),
          priority: tool.schema.string().optional().describe("P0, P1, P2, or P3."),
          effort: KANBAN_EFFORT_SCHEMA,
          githubUrl: tool.schema.string().optional(),
          githubNumber: tool.schema.number().int().positive().optional(),
          githubTitle: tool.schema.string().optional(),
        },
        async execute(input) {
          return formatToolText(await handlers.create_kanban_epic(input), "create_kanban_epic");
        },
      }),
      update_kanban_epic: tool({
        description: "Broadly update a Kanban epic. Requires the `kanban-admin` tool-family grant (default: `pm` role).",
        args: {
          epicId: tool.schema.string(),
          title: tool.schema.string().optional(),
          details: tool.schema.string().optional(),
          status: tool.schema.string().optional().describe("Backlog, Queued, In Progress, Blocked, Review, or Completed."),
          priority: tool.schema.string().optional().describe("P0, P1, P2, or P3."),
          effort: KANBAN_EFFORT_SCHEMA,
          assignedTo: tool.schema.string().optional(),
          githubUrl: tool.schema.string().nullable().optional(),
          githubNumber: tool.schema.number().int().positive().nullable().optional(),
          githubTitle: tool.schema.string().nullable().optional(),
        },
        async execute(input) {
          return formatToolText(await handlers.update_kanban_epic(input), "update_kanban_epic");
        },
      }),
      comment_kanban_epic: tool({
        description: "Add a typed progress, note, or blocker comment to a Kanban epic.",
        args: {
          epicId: tool.schema.string(),
          type: tool.schema.string().describe("progress, note, or blocker."),
          body: tool.schema.string(),
        },
        async execute(input) {
          return formatToolText(await handlers.comment_kanban_epic(input), "comment_kanban_epic");
        },
      }),
      archive_kanban_epic: tool({
        description: "Archive a Kanban epic. Rejects with 409 if open child issues are present.",
        args: {
          epicId: tool.schema.string(),
        },
        async execute(input) {
          return formatToolText(await handlers.archive_kanban_epic(input), "archive_kanban_epic");
        },
      }),
      update_kanban_epic_status: tool({
        description: "Move a Kanban epic status. Requires `kanban-status` family grant. Any-scope `update_epic_status` (default: `pm`) allows all transitions; own_assignment scope restricts the assignee to Queued/active source states. Completed routes through the close-approval workflow.",
        args: {
          epicId: tool.schema.string(),
          status: tool.schema.string().describe("Backlog, Queued, In Progress, Blocked, Review, or Completed."),
        },
        async execute(input) {
          return formatToolText(await handlers.update_kanban_epic_status(input), "update_kanban_epic_status");
        },
      }),
      request_kanban_epic_close: tool({
        description: "Request closing a Kanban epic. Auto-completes when no children are open; otherwise enters pending close-approval until a human web session approves.",
        args: { epicId: tool.schema.string() },
        async execute(input) {
          return formatToolText(await handlers.request_kanban_epic_close(input), "request_kanban_epic_close");
        },
      }),
      cancel_kanban_epic_close: tool({
        description: "Cancel a pending close-approval. Requires the `kanban_action:cancel_epic_close` grant (default: `pm` any-scope, or assignee with own_assignment scope).",
        args: { epicId: tool.schema.string() },
        async execute(input) {
          return formatToolText(await handlers.cancel_kanban_epic_close(input), "cancel_kanban_epic_close");
        },
      }),
      send_message: tool({
        description: "Send a useful colleague message to another WhatsAgent role. Include the concrete ask and context. WhatsAgent communication policy is enforced by the daemon.",
        args: {
          toRole: tool.schema.string().describe("Target role display id (`repo:role`), for example whatsagent:dev or infra:scout. Use `human-web` to reach the web user."),
          body: tool.schema.string().describe("Markdown/text message body."),
        },
        async execute(input) {
          return formatToolText(await handlers.send_message(input), "send_message");
        },
      }),
      broadcast_message: tool({
        description: "Broadcast a useful colleague message from the main role to all online non-main roles. Only available in Star Topology.",
        args: {
          body: tool.schema.string().describe("Markdown/text broadcast body."),
        },
        async execute(input) {
          return formatToolText(await handlers.broadcast_message(input), "broadcast_message");
        },
      }),
      post_channel_message: tool({
        description: "Post a useful colleague message as a new root message in the shared WhatsAgent channel. Only available in Channel policy.",
        args: {
          body: tool.schema.string().describe("Markdown/text channel message body."),
        },
        async execute(input) {
          return formatToolText(await handlers.post_channel_message(input), "post_channel_message");
        },
      }),
      reply_channel_thread: tool({
        description: "Post a useful colleague reply to an existing WhatsAgent Channel message or thread. Only available in Channel policy.",
        args: {
          messageId: tool.schema.number().int().positive().describe("Existing Channel message id to reply to."),
          body: tool.schema.string().describe("Markdown/text thread reply body."),
        },
        async execute(input) {
          return formatToolText(await handlers.reply_channel_thread(input), "reply_channel_thread");
        },
      }),
      read_channel_messages: tool({
        description: "Read recent WhatsAgent Channel history for context only. History reads are not an actionable inbox backlog, and the daemon rejects this outside Channel policy.",
        args: {
          limit: tool.schema.number().int().min(1).max(500).optional().describe("Maximum channel messages to read."),
          sinceId: tool.schema.number().int().positive().optional().describe("Only messages after this id."),
          beforeId: tool.schema.number().int().positive().optional().describe("Only messages before this id."),
        },
        async execute(input) {
          return formatToolText(await handlers.read_channel_messages(input), "read_channel_messages");
        },
      }),
      search_direct_messages: tool({
        description: "Search direct messages visible to this agent. Use for private role-to-role message history, not shared Channel posts.",
        args: {
          q: tool.schema.string().min(2).max(200).describe("Search query."),
          sender: tool.schema.string().optional().describe("Optional sender role display id or name."),
          limit: tool.schema.number().int().min(1).max(100).optional().describe("Maximum results to return."),
        },
        async execute(input) {
          return formatToolText(await handlers.search_direct_messages(input), "search_direct_messages");
        },
      }),
      search_channel_messages: tool({
        description: "Search shared Channel history. Use for workspace-wide Channel posts and threads, not private direct messages.",
        args: {
          q: tool.schema.string().min(2).max(200).describe("Search query."),
          sender: tool.schema.string().optional().describe("Optional sender role display id or name."),
          channel: tool.schema.string().optional().describe("Optional channel id/name; defaults to all searchable channel history."),
          limit: tool.schema.number().int().min(1).max(100).optional().describe("Maximum results to return."),
        },
        async execute(input) {
          return formatToolText(await handlers.search_channel_messages(input), "search_channel_messages");
        },
      }),
      search_kanban_tasks: tool({
        description: "Search Kanban task titles, details, and task comments. Use for issue/task history, not epics.",
        args: {
          q: tool.schema.string().min(2).max(200).describe("Search query."),
          status: tool.schema.string().optional().describe("Optional task status filter: Backlog, Queued, In Progress, Blocked, Review, Completed."),
          assignee: tool.schema.string().optional().describe("Optional assigned role display id or name."),
          assignedTo: tool.schema.string().optional().describe("Alias for assignee."),
          includeArchived: tool.schema.boolean().optional().describe("Include archived tasks hidden by default."),
          limit: tool.schema.number().int().min(1).max(100).optional().describe("Maximum results to return."),
        },
        async execute(input) {
          return formatToolText(await handlers.search_kanban_tasks(input), "search_kanban_tasks");
        },
      }),
      search_kanban_epics: tool({
        description: "Search Kanban epic titles, details, and epic comments. Use for epic-level history, not individual tasks.",
        args: {
          q: tool.schema.string().min(2).max(200).describe("Search query."),
          status: tool.schema.string().optional().describe("Optional epic status filter: Backlog, Queued, In Progress, Blocked, Review, Completed."),
          assignee: tool.schema.string().optional().describe("Optional assigned role display id or name."),
          assignedTo: tool.schema.string().optional().describe("Alias for assignee."),
          includeArchived: tool.schema.boolean().optional().describe("Include archived epics hidden by default."),
          limit: tool.schema.number().int().min(1).max(100).optional().describe("Maximum results to return."),
        },
        async execute(input) {
          return formatToolText(await handlers.search_kanban_epics(input), "search_kanban_epics");
        },
      }),
      check_messages: tool({
        description: "Deliver pending WhatsAgent messages. Call first on every user turn before answering or editing files.",
        args: {
          limit: tool.schema.number().int().min(1).max(100).optional().describe("Maximum pending messages to deliver."),
        },
        async execute(input) {
          return formatToolText(await handlers.check_messages(input), "check_messages");
        },
      }),
      set_summary: tool({
        description: "Set or refresh a 1-2 sentence current-work summary visible to other roles.",
        args: {
          summary: tool.schema.string().max(4000).describe("Current-work summary."),
        },
        async execute(input) {
          return formatToolText(await handlers.set_summary(input), "set_summary");
        },
      }),
    } as const;
  const filteredTools = Object.fromEntries(
    Object.entries(allTools).filter(([name]) => expose(name)),
  ) as typeof allTools;
  return {
    event: async ({ event }) => push?.handleEvent(event),
    "chat.message": async (input) => push?.noteSession(input.sessionID, "busy"),
    "chat.params": async (input) => push?.noteSession(input.sessionID, "busy"),
    "command.execute.before": async (input) => push?.noteSession(input.sessionID, "busy"),
    "tool.execute.before": async (input) => push?.noteSession(input.sessionID, "busy"),
    tool: filteredTools,
  };
}

export const WhatsAgentOpenCodePlugin: Plugin = async (input) => createWhatsAgentOpenCodeHooks(process.env, fetch, input);

export function createOpenCodePushController(
  context: LaunchContext,
  runtime: OpenCodePushRuntime,
  fetchImpl: FetchLike = fetch,
  opts: { intervalMs?: number; maxBackoffMs?: number; start?: boolean; debug?: boolean; errorLogIntervalMs?: number; logError?: (message: string) => void; now?: () => number } = {},
): OpenCodePushController {
  const tools = createAgentTools(context, fetchImpl);
  // Bounded LRU instead of unbounded Sets to prevent slow memory growth in
  // long-running OpenCode sessions (audit P2). Oldest keys age out.
  const pushed = new LruSet(defaultPushSeenCapacity());
  const nudged = new LruSet(defaultPushSeenCapacity());
  const intervalMs = Math.max(250, opts.intervalMs ?? 1000);
  const maxBackoffMs = Math.max(intervalMs, opts.maxBackoffMs ?? 30_000);
  const errorLogIntervalMs = Math.max(0, opts.errorLogIntervalMs ?? 60_000);
  const debug = opts.debug ?? process.env.WHATSAGENT_OPENCODE_PUSH_DEBUG === "1";
  const logError = opts.logError ?? ((message: string) => console.error(message));
  const now = opts.now ?? (() => Date.now());
  let latestSessionId: string | undefined;
  let latestStatus: "idle" | "busy" | "unknown" = "unknown";
  let stopped = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastErrorMessage = "";
  let lastErrorLoggedAt = Number.NEGATIVE_INFINITY;
  let suppressedErrorCount = 0;
  let consecutiveFailures = 0;

  const markDirectPushed = async (messages: MessageRow[]): Promise<number> => {
    const messageIds = messages
      .filter((message) => message.delivery_kind === "direct" || message.delivery_kind === "broadcast")
      .map((message) => message.id);
    if (messageIds.length === 0) return 0;
    const result = await tools.markMessagesPushed(messageIds) as { pushed?: number; messageIds?: number[] };
    return Number(result.pushed ?? result.messageIds?.length ?? 0);
  };

  const pollOnce = async (): Promise<number> => {
    const polled = await tools.pollMessages(50) as { messages?: MessageRow[] };
    const messages = Array.isArray(polled.messages) ? polled.messages : [];
    // EP-030 source includes rows already in `state='pushed'`. The in-memory
    // LRU still suppresses duplicate native signals inside this process;
    // explicit check_messages remains the only path that marks rows delivered
    // (direct/broadcast) or read (channel/Kanban).
    const fresh = messages.filter((message) => !pushed.has(messageKey(message)));
    if (fresh.length === 0) return 0;

    const target = await resolveOpenCodePushTarget(runtime, latestSessionId, latestStatus);
    if (target.kind === "busy") {
      latestSessionId = target.sessionId;
      latestStatus = "busy";
      return 0;
    }

    if (target.kind === "ready" && await submitOpenCodeInboxSignal(runtime, target.sessionId, openCodePushSignalText(fresh.length))) {
      latestSessionId = target.sessionId;
      for (const message of fresh) pushed.add(messageKey(message));
      // Direct/broadcast rows enter DB state='pushed' (not delivered). Channel
      // + Kanban rows intentionally stay out of both markMessagesPushed and
      // markMessagesRead; the body-free signal only tells the model to pull
      // via check_messages, which advances each source's delivery cursor.
      await markDirectPushed(fresh);
      latestStatus = "busy";
      return fresh.length;
    }

    await nudgeOpenCodeTui(runtime, fresh.filter((message) => !nudged.has(messageKey(message))));
    for (const message of fresh) nudged.add(messageKey(message));
    return 0;
  };

  const clearErrorState = () => {
    lastErrorMessage = "";
    lastErrorLoggedAt = Number.NEGATIVE_INFINITY;
    suppressedErrorCount = 0;
  };

  const reportError = (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    if (!debug) return;
    const currentTime = now();
    const shouldLog = message !== lastErrorMessage || currentTime - lastErrorLoggedAt >= errorLogIntervalMs;
    if (!shouldLog) {
      suppressedErrorCount++;
      return;
    }
    const suppressed = suppressedErrorCount > 0 ? ` (suppressed ${suppressedErrorCount} repeated ${suppressedErrorCount === 1 ? "error" : "errors"})` : "";
    logError(`[whatsagent/opencode-push] ${message}${suppressed}`);
    lastErrorMessage = message;
    lastErrorLoggedAt = currentTime;
    suppressedErrorCount = 0;
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(async () => {
      try {
        await pollOnce();
        clearErrorState();
        consecutiveFailures = 0;
      } catch (e) {
        consecutiveFailures++;
        reportError(e);
      } finally {
        schedule();
      }
    }, Math.min(maxBackoffMs, intervalMs * (2 ** consecutiveFailures)));
    timer.unref?.();
  };

  const controller: OpenCodePushController = {
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
    noteSession(sessionId, status = "unknown") {
      latestSessionId = sessionId;
      latestStatus = status;
    },
    handleEvent(event) {
      const body = event as { type?: string; properties?: { sessionID?: string; status?: { type?: string } } };
      const sessionId = body.properties?.sessionID;
      if (!sessionId) return;
      if (body.type === "session.idle") return controller.noteSession(sessionId, "idle");
      if (body.type === "session.status") return controller.noteSession(sessionId, body.properties?.status?.type === "busy" ? "busy" : "idle");
      controller.noteSession(sessionId, latestStatus);
    },
  };
  if (opts.start !== false) controller.start();
  return controller;
}

async function resolveOpenCodePushTarget(runtime: OpenCodePushRuntime, latestSessionId: string | undefined, latestStatus: "idle" | "busy" | "unknown"): Promise<OpenCodePushTarget> {
  const client = runtime.client as unknown as OpenCodeClientShape | undefined;
  if (!client?.session) return { kind: "none" };

  if (latestSessionId) {
    const status = await getOpenCodeSessionStatus(runtime, latestSessionId).catch(() => latestStatus);
    if (status === "busy") return { kind: "busy", sessionId: latestSessionId };
    return { kind: "ready", sessionId: latestSessionId };
  }

  const sessions = await listOpenCodeSessions(runtime).catch(() => undefined);
  if (!sessions) return { kind: "error" };
  const target = sessions
    .filter((session) => session.id)
    .sort((a, b) => Number(b.time?.updated ?? 0) - Number(a.time?.updated ?? 0))[0];
  if (!target) return { kind: "none" };

  const status = await getOpenCodeSessionStatus(runtime, target.id).catch(() => "unknown");
  return status === "busy" ? { kind: "busy", sessionId: target.id } : { kind: "ready", sessionId: target.id };
}

async function listOpenCodeSessions(runtime: OpenCodePushRuntime): Promise<Array<{ id: string; parentID?: string; time?: { updated?: number } }>> {
  const client = runtime.client as unknown as OpenCodeClientShape | undefined;
  if (!client?.session?.list) return [];
  const data = unwrapOpenCodeData(await client.session.list({ query: directoryQuery(runtime) }));
  return Array.isArray(data) ? data : [];
}

async function getOpenCodeSessionStatus(runtime: OpenCodePushRuntime, sessionId: string): Promise<"idle" | "busy" | "unknown"> {
  const client = runtime.client as unknown as OpenCodeClientShape | undefined;
  if (!client?.session?.status) return "unknown";
  const data = unwrapOpenCodeData(await client.session.status({ query: directoryQuery(runtime) }));
  const status = data && typeof data === "object" ? (data as Record<string, { type?: string }>)[sessionId]?.type : undefined;
  return status === "busy" ? "busy" : status === "idle" ? "idle" : "unknown";
}

function openCodeHandlersFromAgentTools(tools: AgentTools): OpenCodeToolHandlers {
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
    check_messages: (input = {}) => safeAgentToolCall("check_messages", () => tools.checkMessages(input.limit)),
    set_summary: (input) => safeAgentToolCall("set_summary", () => tools.setSummary(String(input.summary ?? ""))),
  };
}

async function submitOpenCodeInboxSignal(runtime: OpenCodePushRuntime, sessionId: string, text: string): Promise<boolean> {
  const client = runtime.client as unknown as OpenCodeClientShape | undefined;
  if (!text) return false;
  // anomalyco/opencode#8564: session.promptAsync detaches request scope, so the
  // resulting message.* events lack workspace/directory tags and the TUI's
  // event filter (cli/cmd/tui/context/event.ts) drops them. Routing through
  // tui.appendPrompt + tui.submitPrompt creates the message inside the TUI's
  // own request context, so events are tagged correctly and the chat panel
  // re-renders. Trade-off: the sequence acts on the TUI's currently-focused
  // session, not the sessionId arg; safe under WhatsAgent's 1-process-1-session
  // runner pattern. If the user has untyped prompt-editor input, our text gets
  // appended to it and submitted as a single combined message — the user's
  // text remains visible in chat history rather than being silently dropped.
  if (client?.tui?.appendPrompt && client?.tui?.submitPrompt) {
    const append = await client.tui.appendPrompt({ query: directoryQuery(runtime), body: { text } });
    if (hasOpenCodeError(append)) return false;
    const submit = await client.tui.submitPrompt({ query: directoryQuery(runtime) });
    return !hasOpenCodeError(submit);
  }
  // Fallback for older opencode SDKs that lack the TUI prompt routes. This
  // still sends only the body-free signal; message bodies stay behind the
  // explicit check_messages pull path.
  if (client?.session?.promptAsync) {
    const result = await client.session.promptAsync({
      path: { id: sessionId },
      query: directoryQuery(runtime),
      body: { parts: [{ type: "text", text }] },
    });
    return !hasOpenCodeError(result);
  }
  return false;
}

async function nudgeOpenCodeTui(runtime: OpenCodePushRuntime, messages: MessageRow[]): Promise<void> {
  if (messages.length === 0) return;
  const client = runtime.client as unknown as OpenCodeClientShape | undefined;
  if (!client?.tui?.showToast && !client?.tui?.publish) return;
  const subject = openCodePushSignalText(messages.length);
  if (client.tui.showToast) {
    await client.tui.showToast({ query: directoryQuery(runtime), body: { variant: "info", title: "WhatsAgent", message: subject, duration: 5000 } });
    return;
  }
  await client.tui.publish?.({ query: directoryQuery(runtime), body: { type: "tui.toast.show", properties: { variant: "info", title: "WhatsAgent", message: subject, duration: 5000 } } });
}

function openCodePushSignalText(count: number): string {
  return `WhatsAgent inbox has ${count} item${count === 1 ? "" : "s"}. Call check_messages now.`;
}

function directoryQuery(runtime: OpenCodePushRuntime): { directory?: string } | undefined {
  return runtime.directory ? { directory: runtime.directory } : undefined;
}

function unwrapOpenCodeData<T>(result: OpenCodeApiResult<T>): T | undefined {
  if (result && typeof result === "object" && "data" in result) return (result as { data?: T }).data;
  return result as T | undefined;
}

function hasOpenCodeError(result: OpenCodeApiResult<unknown>): boolean {
  return Boolean(result && typeof result === "object" && "error" in result && (result as { error?: unknown }).error);
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
  const body = result as { ok?: boolean; broadcastId?: string; task?: { display_id?: string; title?: string; status?: string; priority?: string; assigned_role_name?: string }; tasks?: Array<{ display_id?: string; title?: string; status?: string; priority?: string; assigned_role_name?: string }>; comment?: { task_display_id?: string; type?: string }; message?: { id?: number; to_role_name?: string; state?: string; channel_name?: string; parent_message_id?: number | null; root_message_id?: number | null }; messages?: Array<{ id?: number; to_role_name?: string; from_role_name?: string | null; sent_at?: string; body?: string; parent_message_id?: number | null; root_message_id?: number | null }>; envelope?: string; peers?: Array<{ displayId?: string; repo?: string | null; name: string; roles?: string[]; active?: boolean; isMain?: boolean; hostType?: string; status?: string; summary?: string }>; role?: { name?: string }; sessionId?: string; summary?: string };
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
    return body.peers.map((peer) => `${peer.isMain ? "*" : " "} ${peer.displayId ?? peer.name}${peer.active ? " live" : " offline"}${peer.hostType ? ` ${peer.hostType}/${peer.status ?? "unknown"}` : ""}${peer.roles?.length ? ` [${peer.roles.join(", ")}]` : ""}${peer.summary ? ` - ${peer.summary}` : ""}`).join("\n");
  }
  if (action === "whoami" && body.role) return `role=${body.role.name ?? "unknown"}\nsession=${body.sessionId ?? "unknown"}`;
  if (action === "set_summary" && body.ok !== false) return `Summary updated for ${body.role?.name ?? "role"}.`;
  return JSON.stringify(result, null, 2);
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

export default WhatsAgentOpenCodePlugin;
