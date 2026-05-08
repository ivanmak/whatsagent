import { requireLaunchContext, validateLaunchContext, type FetchLike, type LaunchContext } from "./launch-token.ts";

export interface AgentTools {
  whoami(): Promise<unknown>;
  /**
   * EP-022 / WA-098: renamed from `listAgents` (which itself was the
   * 2026-05 sed-rename of the original `list_peers`). The MCP tool name
   * is `list_peers`; this method is the agent-client wrapper for the
   * `/api/v1/agent/list-peers` HTTP route.
   */
  listPeers(input?: { details?: boolean }): Promise<unknown>;
  listKanbanTasks(input?: Record<string, unknown>): Promise<unknown>;
  readKanbanTask(taskId: string): Promise<unknown>;
  createKanbanTask(input: Record<string, unknown>): Promise<unknown>;
  updateKanbanTask(taskId: string, input: Record<string, unknown>): Promise<unknown>;
  updateKanbanTaskStatus(taskId: string, status: string): Promise<unknown>;
  commentKanbanTask(taskId: string, type: string, body: string): Promise<unknown>;
  archiveKanbanTask(taskId: string): Promise<unknown>;
  listKanbanEpics(input?: Record<string, unknown>): Promise<unknown>;
  readKanbanEpic(epicId: string): Promise<unknown>;
  createKanbanEpic(input: Record<string, unknown>): Promise<unknown>;
  updateKanbanEpic(epicId: string, input: Record<string, unknown>): Promise<unknown>;
  commentKanbanEpic(epicId: string, type: string, body: string): Promise<unknown>;
  archiveKanbanEpic(epicId: string): Promise<unknown>;
  updateKanbanEpicStatus(epicId: string, status: string): Promise<unknown>;
  requestKanbanEpicClose(epicId: string): Promise<unknown>;
  cancelKanbanEpicClose(epicId: string): Promise<unknown>;
  sendMessage(toRole: string, body: string): Promise<unknown>;
  broadcastMessage(body: string): Promise<unknown>;
  postChannelMessage(body: string): Promise<unknown>;
  replyChannelThread(messageId: number, body: string): Promise<unknown>;
  readChannelMessages(input?: { limit?: number; sinceId?: number; beforeId?: number }): Promise<unknown>;
  search_direct_messages(input: Record<string, unknown>): Promise<unknown[]>;
  search_channel_messages(input: Record<string, unknown>): Promise<unknown[]>;
  search_kanban_tasks(input: Record<string, unknown>): Promise<unknown[]>;
  search_kanban_epics(input: Record<string, unknown>): Promise<unknown[]>;
  checkMessages(limit?: number): Promise<unknown>;
  pollMessages(limit?: number): Promise<unknown>;
  markMessagesRead(messageIds: number[], kanbanNotificationIds?: number[], kanbanEpicNotificationIds?: number[]): Promise<unknown>;
  /** EP-030: native-push plugin signal that rows reached the runtime SDK
   * (pending → pushed). Delivery is still pending agent-side check_messages. */
  markMessagesPushed(messageIds: number[]): Promise<unknown>;
  setSummary(summary: string): Promise<unknown>;
  settings(): Promise<unknown>;
}

export class WhatsAgentApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message);
    this.name = "WhatsAgentApiError";
  }
}

export interface WhatsAgentToolFailure {
  ok: false;
  action: string;
  error: string;
  status?: number;
}

export function whatsAgentErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function whatsAgentToolFailure(action: string, error: unknown): WhatsAgentToolFailure {
  return {
    ok: false,
    action,
    error: whatsAgentErrorMessage(error),
    ...(error instanceof WhatsAgentApiError ? { status: error.status } : {}),
  };
}

export async function safeAgentToolCall(action: string, call: () => Promise<unknown>): Promise<unknown> {
  try {
    return await call();
  } catch (error) {
    return whatsAgentToolFailure(action, error);
  }
}

export function formatWhatsAgentToolFailure(result: unknown, action: string): string | null {
  const body = result as { ok?: unknown; error?: unknown };
  if (body?.ok === false && typeof body.error === "string") return `WhatsAgent ${action} failed: ${body.error}`;
  return null;
}

export function createAgentTools(context: LaunchContext, fetchImpl: FetchLike = fetch): AgentTools {
  return {
    whoami: () => postAgent(context, "whoami", {}, fetchImpl),
    listPeers: (input = {}) => postAgent(context, "list-peers", input, fetchImpl),
    listKanbanTasks: (input = {}) => postAgent(context, "list-kanban-tasks", input, fetchImpl),
    readKanbanTask: (taskId) => postAgent(context, "read-kanban-task", { taskId }, fetchImpl),
    createKanbanTask: (input) => postAgent(context, "create-kanban-task", input, fetchImpl),
    updateKanbanTask: (taskId, input) => postAgent(context, "update-kanban-task", { taskId, ...input }, fetchImpl),
    updateKanbanTaskStatus: (taskId, status) => postAgent(context, "update-kanban-task-status", { taskId, status }, fetchImpl),
    commentKanbanTask: (taskId, type, body) => postAgent(context, "comment-kanban-task", { taskId, type, body }, fetchImpl),
    archiveKanbanTask: (taskId) => postAgent(context, "archive-kanban-task", { taskId }, fetchImpl),
    listKanbanEpics: (input = {}) => postAgent(context, "list-kanban-epics", input, fetchImpl),
    readKanbanEpic: (epicId) => postAgent(context, "read-kanban-epic", { epicId }, fetchImpl),
    createKanbanEpic: (input) => postAgent(context, "create-kanban-epic", input, fetchImpl),
    updateKanbanEpic: (epicId, input) => postAgent(context, "update-kanban-epic", { epicId, ...input }, fetchImpl),
    commentKanbanEpic: (epicId, type, body) => postAgent(context, "comment-kanban-epic", { epicId, type, body }, fetchImpl),
    archiveKanbanEpic: (epicId) => postAgent(context, "archive-kanban-epic", { epicId }, fetchImpl),
    updateKanbanEpicStatus: (epicId, status) => postAgent(context, "update-kanban-epic-status", { epicId, status }, fetchImpl),
    requestKanbanEpicClose: (epicId) => postAgent(context, "request-kanban-epic-close", { epicId }, fetchImpl),
    cancelKanbanEpicClose: (epicId) => postAgent(context, "cancel-kanban-epic-close", { epicId }, fetchImpl),
    sendMessage: (toRole, body) => postAgent(context, "send-message", { toRole, body }, fetchImpl),
    broadcastMessage: (body) => postAgent(context, "broadcast-message", { body }, fetchImpl),
    postChannelMessage: (body) => postAgent(context, "post-channel-message", { body }, fetchImpl),
    replyChannelThread: (messageId, body) => postAgent(context, "reply-channel-thread", { messageId, body }, fetchImpl),
    readChannelMessages: (input = {}) => postAgent(context, "read-channel-messages", input, fetchImpl),
    search_direct_messages: (input) => postAgentResults(context, "search-direct-messages", input, fetchImpl),
    search_channel_messages: (input) => postAgentResults(context, "search-channel-messages", input, fetchImpl),
    search_kanban_tasks: (input) => postAgentResults(context, "search-kanban-tasks", input, fetchImpl),
    search_kanban_epics: (input) => postAgentResults(context, "search-kanban-epics", input, fetchImpl),
    checkMessages: (limit = 50) => postAgent(context, "check-messages", { limit }, fetchImpl),
    pollMessages: (limit = 50) => postAgent(context, "poll-messages", { limit }, fetchImpl),
    markMessagesRead: (messageIds, kanbanNotificationIds = [], kanbanEpicNotificationIds = []) => {
      const payload: Record<string, unknown> = { messageIds };
      if (kanbanNotificationIds.length > 0) payload.kanbanNotificationIds = kanbanNotificationIds;
      if (kanbanEpicNotificationIds.length > 0) payload.kanbanEpicNotificationIds = kanbanEpicNotificationIds;
      return postAgent(context, "mark-messages-read", payload, fetchImpl);
    },
    markMessagesPushed: (messageIds) => postAgent(context, "mark-messages-pushed", { messageIds }, fetchImpl),
    setSummary: (summary) => postAgent(context, "set-summary", { summary }, fetchImpl),
    settings: () => postAgent(context, "settings", {}, fetchImpl),
  };
}

export async function createValidatedAgentTools(env: Record<string, string | undefined> = process.env, fetchImpl: FetchLike = fetch): Promise<AgentTools> {
  const context = requireLaunchContext(env);
  if (!await validateLaunchContext(context, fetchImpl)) {
    throw new Error("WhatsAgent launch token validation failed.");
  }
  return createAgentTools(context, fetchImpl);
}

async function postAgentResults(context: LaunchContext, action: string, payload: Record<string, unknown>, fetchImpl: FetchLike): Promise<unknown[]> {
  const body = await postAgent(context, action, payload, fetchImpl) as { results?: unknown[] };
  return Array.isArray(body.results) ? body.results : [];
}

const AGENT_SESSION_REFRESH_SKEW_MS = 60_000;

function shouldRefreshAgentSession(context: LaunchContext): boolean {
  if (!context.sessionCredentialExpiresAt) return false;
  const expiresAt = Date.parse(context.sessionCredentialExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt - Date.now() <= AGENT_SESSION_REFRESH_SKEW_MS;
}

async function ensureFreshAgentSession(context: LaunchContext, fetchImpl: FetchLike): Promise<void> {
  if (!shouldRefreshAgentSession(context)) return;
  await validateLaunchContext(context, fetchImpl);
}

function agentRequestInit(context: LaunchContext, payload: Record<string, unknown>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${context.launchToken}` },
    body: JSON.stringify({
      workspaceId: context.workspaceId,
      role: context.role,
      sessionId: context.sessionId,
      ...payload,
    }),
  };
}

async function postAgent(context: LaunchContext, action: string, payload: Record<string, unknown>, fetchImpl: FetchLike): Promise<unknown> {
  await ensureFreshAgentSession(context, fetchImpl);
  const url = new URL(`/api/v1/agent/${action}`, context.daemonUrl);
  let res = await fetchImpl(url, agentRequestInit(context, payload));
  let body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
  if (res.status === 401 && await validateLaunchContext(context, fetchImpl)) {
    res = await fetchImpl(url, agentRequestInit(context, payload));
    body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
  }
  if (!res.ok || body.ok === false) {
    throw new WhatsAgentApiError(body.error || `WhatsAgent agent API failed with HTTP ${res.status}`, res.status, body);
  }
  return body;
}
