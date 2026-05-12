/**
 * EP-031 WA-PI-3a — Public agent tool catalog.
 *
 * Single source of truth for the tools WhatsAgent runtimes expose to
 * agents. Each entry pairs the canonical snake_case MCP/plugin tool
 * name with its description, JSON Schema input shape, RBAC family,
 * and an `execute` adapter that calls the matching `AgentTools`
 * method.
 *
 * Why a catalog and not just iterating `createAgentTools`:
 * - `AgentTools` exposes camelCase client wrappers (`listPeers`,
 *   `sendMessage`) plus internal helpers (`pollMessages`,
 *   `markMessagesPushed`, `markMessagesRead`, `settings`). Iterating
 *   it would publish wrong names and leak private surfaces.
 * - The catalog locks the public set: 29 tools spanning whoami,
 *   list_peers, check_messages, messaging, channel, search, kanban
 *   tasks, kanban epics, set_summary. Internal helpers are NOT here.
 *   They stay reachable via the `AgentTools` instance for push
 *   controllers and audit cursors.
 *
 * RBAC: the `family` field carries the result of `getToolFamily(name)`
 * for transparency. Always-on housekeeping tools (`whoami` and
 * `check_messages`) intentionally have `family === null` —
 * `shouldExposeTool` exposes them universally regardless of grants.
 * Note: `list_peers` and `set_summary` are NOT housekeeping; they are
 * gated under `tool_family: summary` (see `src/rbac-enforce.ts:249-250`).
 * Runtime adapters should still gate registration with
 * `shouldExposeTool(entry.name, ...)` rather than reading
 * `entry.family` directly so the helper resolves housekeeping +
 * `mode === "off"` short-circuits in one place.
 *
 * Out of scope for v1: migrating claude-mcp / opencode-plugin /
 * codex-mcp to consume this catalog. They keep hand-rolled lists.
 * Pi consumes the catalog directly (WA-PI-3b). A follow-up
 * consolidation epic can fold the others in.
 */

import type { AgentTools } from "./agent-client.ts";
// EP-031: import from the DB-free leaf so Pi (Node-based) loading the
// catalog does not pull `bun:sqlite` through the audit / rbac DAOs.
import { getToolFamily } from "../rbac-visibility.ts";

/**
 * JSON Schema Draft-07 input shape. Catalog uses a small subset (object
 * roots, primitive properties, `additionalProperties` only when needed)
 * so per-runtime adapters can convert without dragging in a full JSON
 * Schema → zod / SDK-shape compiler.
 */
export type JsonSchemaPrimitive =
  | { type: "string"; description?: string; minLength?: number; maxLength?: number; enum?: string[] }
  | { type: "number"; description?: string; minimum?: number; maximum?: number }
  | { type: "integer"; description?: string; minimum?: number; maximum?: number }
  | { type: "boolean"; description?: string }
  | { type: "array"; description?: string; items: JsonSchemaPrimitive }
  | { type: ["string", "null"]; description?: string }
  | { type: ["number", "null"]; description?: string }
  | { type: ["integer", "null"]; description?: string };

export interface JsonSchemaObject {
  type: "object";
  properties: Record<string, JsonSchemaPrimitive>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface AgentToolDef {
  /** Canonical snake_case name (matches MCP / plugin tool names across runtimes). */
  name: string;
  /** One-line tool description shown to the agent in tool listings. */
  description: string;
  /** JSON Schema (Draft-07) describing the tool input. */
  inputSchema: JsonSchemaObject;
  /** RBAC tool family; null for always-on housekeeping tools. */
  family: string | null;
  /** Adapter that maps the tool input record to the matching `AgentTools` method. */
  execute: (tools: AgentTools, input: Record<string, unknown>) => Promise<unknown>;
  /** Compact one-line Pi renderer summary for this tool's result. */
  summarize: (result: unknown) => string;
}

/** Helpers for input coercion in execute callbacks. */
function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Catalog entries below mirror the descriptions and arg sets registered
 * by `src/integrations/opencode-plugin.ts` (the most complete source).
 * Keep names + descriptions in sync if either side moves.
 */
const ENTRIES: ReadonlyArray<Omit<AgentToolDef, "family" | "summarize">> = [
  {
    name: "whoami",
    description: "Show this WhatsAgent role, session, main role, and policy.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: async (tools) => tools.whoami(),
  },
  {
    name: "list_peers",
    description: "List other WhatsAgent agents in this workspace — `displayId`, `repo`, `name`, `roles[]` (RBAC role-name assignments per peer), `persona` description (or fuller persona with details), `isMain`, `active`. Caller is excluded; use `whoami` for self-introspection.",
    inputSchema: {
      type: "object",
      properties: {
        details: { type: "boolean", description: "Include safe runtime, summary, and attention metadata." },
      },
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.listPeers({ details: Boolean(input.details) }),
  },
  {
    name: "check_messages",
    description: "Deliver pending WhatsAgent messages. Call first on every user turn before answering or editing files.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Maximum pending messages to deliver." },
      },
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.checkMessages(asOptionalNumber(input.limit)),
  },
  {
    name: "send_message",
    description: "Send a useful colleague message to another WhatsAgent role. Include the concrete ask and context. WhatsAgent communication policy is enforced by the daemon.",
    inputSchema: {
      type: "object",
      properties: {
        toRole: { type: "string", description: "Target role display id (`repo:role`), for example whatsagent:dev or infra:scout. Use `human-web` to reach the web user." },
        body: { type: "string", description: "Markdown/text message body." },
      },
      required: ["toRole", "body"],
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.sendMessage(asString(input.toRole), asString(input.body)),
  },
  {
    name: "broadcast_message",
    description: "Broadcast a useful colleague message from the main role to all online non-main roles. Only available in Star Topology.",
    inputSchema: {
      type: "object",
      properties: {
        body: { type: "string", description: "Markdown/text broadcast body." },
      },
      required: ["body"],
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.broadcastMessage(asString(input.body)),
  },
  {
    name: "post_channel_message",
    description: "Post a useful colleague message as a new root message in the shared WhatsAgent channel. Only available in Channel policy.",
    inputSchema: {
      type: "object",
      properties: {
        body: { type: "string", description: "Markdown/text channel message body." },
      },
      required: ["body"],
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.postChannelMessage(asString(input.body)),
  },
  {
    name: "reply_channel_thread",
    description: "Post a useful colleague reply to an existing WhatsAgent Channel message or thread. Only available in Channel policy.",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "integer", minimum: 1, description: "Existing Channel message id to reply to." },
        body: { type: "string", description: "Markdown/text thread reply body." },
      },
      required: ["messageId", "body"],
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.replyChannelThread(asOptionalNumber(input.messageId) ?? 0, asString(input.body)),
  },
  {
    name: "read_channel_messages",
    description: "Read recent WhatsAgent Channel history for context only. History reads are not an actionable inbox backlog, and the daemon rejects this outside Channel policy.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 500, description: "Maximum channel messages to read." },
        sinceId: { type: "integer", minimum: 1, description: "Only messages after this id." },
        beforeId: { type: "integer", minimum: 1, description: "Only messages before this id." },
      },
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.readChannelMessages({
      limit: asOptionalNumber(input.limit),
      sinceId: asOptionalNumber(input.sinceId),
      beforeId: asOptionalNumber(input.beforeId),
    }),
  },
  {
    name: "search_direct_messages",
    description: "Search direct messages visible to this agent. Use for private role-to-role message history, not shared Channel posts.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", minLength: 2, maxLength: 200, description: "Search query." },
        sender: { type: "string", description: "Optional sender role display id or name." },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Maximum results to return." },
      },
      required: ["q"],
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.search_direct_messages(input),
  },
  {
    name: "search_channel_messages",
    description: "Search shared Channel history. Use for workspace-wide Channel posts and threads, not private direct messages.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", minLength: 2, maxLength: 200, description: "Search query." },
        sender: { type: "string", description: "Optional sender role display id or name." },
        channel: { type: "string", description: "Optional channel id/name; defaults to all searchable channel history." },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Maximum results to return." },
      },
      required: ["q"],
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.search_channel_messages(input),
  },
  {
    name: "search_kanban_tasks",
    description: "Search Kanban task titles, details, and task comments. Use for issue/task history, not epics.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", minLength: 2, maxLength: 200, description: "Search query." },
        status: { type: "string", description: "Optional task status filter: Backlog, Queued, In Progress, Blocked, Review, Completed." },
        assignee: { type: "string", description: "Optional assigned role display id or name." },
        assignedTo: { type: "string", description: "Alias for assignee." },
        includeArchived: { type: "boolean", description: "Include archived tasks hidden by default." },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Maximum results to return." },
      },
      required: ["q"],
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.search_kanban_tasks(input),
  },
  {
    name: "search_kanban_epics",
    description: "Search Kanban epic titles, details, and epic comments. Use for epic-level history, not individual tasks.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", minLength: 2, maxLength: 200, description: "Search query." },
        status: { type: "string", description: "Optional epic status filter: Backlog, Queued, In Progress, Blocked, Review, Completed." },
        assignee: { type: "string", description: "Optional assigned role display id or name." },
        assignedTo: { type: "string", description: "Alias for assignee." },
        includeArchived: { type: "boolean", description: "Include archived epics hidden by default." },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Maximum results to return." },
      },
      required: ["q"],
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.search_kanban_epics(input),
  },
  {
    name: "list_kanban_tasks",
    description: "List WhatsAgent Kanban tasks. Humans read the board; policy-authorized agents manage it.",
    inputSchema: {
      type: "object",
      properties: {
        includeArchived: { type: "boolean", description: "Include archived tasks." },
        status: { type: "string", description: "Filter status: Backlog, Queued, In Progress, Blocked, Review, Completed." },
        assignedTo: { type: "string", description: "Filter by assigned role name." },
        createdBy: { type: "string", description: "Filter by creator role name." },
        priority: { type: "string", description: "Filter priority: P0, P1, P2, P3." },
        search: { type: "string", description: "Search display id, title, or details." },
        limit: { type: "integer", minimum: 1, maximum: 1000, description: "Maximum tasks to return." },
        epicId: { type: "string", description: "Filter by epic display id, or 'none' for unclassified tasks." },
      },
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.listKanbanTasks(input),
  },
  {
    name: "read_kanban_task",
    description: "Read one WhatsAgent Kanban task with comments, dependencies, and activity.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task display id, for example WA-001." },
      },
      required: ["taskId"],
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.readKanbanTask(asString(input.taskId)),
  },
  {
    name: "create_kanban_task",
    description: "Create an assigned WhatsAgent Kanban task. Requires the `kanban-admin` tool-family grant (default: `pm` role). Comments are open to any agent with `kanban-comment`. Optional epicId links the task to a parent epic.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title." },
        assignedTo: { type: "string", description: "Assigned role name." },
        details: { type: "string", description: "Markdown/text task details." },
        status: { type: "string", description: "Backlog, Queued, In Progress, Blocked, Review, or Completed." },
        priority: { type: "string", description: "P0, P1, P2, or P3." },
        effort: { type: "string", enum: ["XS", "S", "M", "L", "XL"], description: "XS, S, M, L, or XL." },
        githubUrl: { type: "string", description: "Optional GitHub issue URL." },
        githubNumber: { type: "integer", minimum: 1, description: "Optional GitHub issue number." },
        githubTitle: { type: "string", description: "Optional GitHub issue title." },
        epicId: { type: "string", description: "Optional parent epic display id." },
      },
      required: ["title", "assignedTo"],
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.createKanbanTask(input),
  },
  {
    name: "update_kanban_task",
    description: "Broadly update fields, assignment, status, dependencies, GitHub metadata, or epic link on a WhatsAgent Kanban task. Requires the `kanban-admin` tool-family grant (default: `pm` role). Assigned agents without `kanban-admin` should use update_kanban_task_status for progress moves.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task display id, for example WA-001." },
        title: { type: "string" },
        details: { type: "string" },
        status: { type: "string", description: "Backlog, Queued, In Progress, Blocked, Review, or Completed." },
        priority: { type: "string", description: "P0, P1, P2, or P3." },
        effort: { type: "string", enum: ["XS", "S", "M", "L", "XL"], description: "XS, S, M, L, or XL." },
        assignedTo: { type: "string", description: "New assigned role name." },
        dependsOnTaskIds: { type: "array", items: { type: "string" }, description: "Complete replacement list of dependency task ids." },
        epicId: { type: ["string", "null"], description: "Parent epic display id; null to unlink; omit to leave unchanged." },
        githubUrl: { type: ["string", "null"] },
        githubNumber: { type: ["integer", "null"] },
        githubTitle: { type: ["string", "null"] },
      },
      required: ["taskId"],
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.updateKanbanTask(asString(input.taskId), input),
  },
  {
    name: "update_kanban_task_status",
    description: "Move a WhatsAgent Kanban task status. Requires `kanban-status` family grant. With `update_task_status` at any-scope (default: `pm`) all transitions are allowed; with own_assignment scope (default: `engineer`) the assignee may move Queued/active tasks to In Progress, Blocked, or Review only.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task display id, for example WA-001." },
        status: { type: "string", description: "Backlog, Queued, In Progress, Blocked, Review, or Completed." },
      },
      required: ["taskId", "status"],
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.updateKanbanTaskStatus(asString(input.taskId), asString(input.status)),
  },
  {
    name: "comment_kanban_task",
    description: "Add a typed progress, note, or blocker comment to a WhatsAgent Kanban task.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task display id, for example WA-001." },
        type: { type: "string", description: "progress, note, or blocker." },
        body: { type: "string", description: "Comment body." },
      },
      required: ["taskId", "type", "body"],
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.commentKanbanTask(asString(input.taskId), asString(input.type, "progress"), asString(input.body)),
  },
  {
    name: "archive_kanban_task",
    description: "Archive a WhatsAgent Kanban task without deleting it.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task display id, for example WA-001." },
      },
      required: ["taskId"],
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.archiveKanbanTask(asString(input.taskId)),
  },
  {
    name: "list_kanban_epics",
    description: "List WhatsAgent Kanban epics. Epics group related task issues. Read-only for humans.",
    inputSchema: {
      type: "object",
      properties: {
        includeArchived: { type: "boolean" },
        status: { type: "string", description: "Backlog, Queued, In Progress, Blocked, Review, or Completed." },
        assignedTo: { type: "string" },
        createdBy: { type: "string" },
        priority: { type: "string", description: "P0, P1, P2, or P3." },
        search: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 1000 },
      },
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.listKanbanEpics(input),
  },
  {
    name: "read_kanban_epic",
    description: "Read one Kanban epic with comments, activity, and child issues.",
    inputSchema: {
      type: "object",
      properties: {
        epicId: { type: "string", description: "Epic display id, for example EP-001." },
      },
      required: ["epicId"],
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.readKanbanEpic(asString(input.epicId)),
  },
  {
    name: "create_kanban_epic",
    description: "Create a Kanban epic. Requires the `kanban-admin` tool-family grant (default: `pm` role).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        assignedTo: { type: "string" },
        details: { type: "string" },
        status: { type: "string", description: "Backlog, Queued, In Progress, Blocked, Review, or Completed." },
        priority: { type: "string", description: "P0, P1, P2, or P3." },
        effort: { type: "string", enum: ["XS", "S", "M", "L", "XL"], description: "XS, S, M, L, or XL." },
        githubUrl: { type: "string" },
        githubNumber: { type: "integer", minimum: 1 },
        githubTitle: { type: "string" },
      },
      required: ["title", "assignedTo"],
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.createKanbanEpic(input),
  },
  {
    name: "update_kanban_epic",
    description: "Broadly update a Kanban epic. Requires the `kanban-admin` tool-family grant (default: `pm` role).",
    inputSchema: {
      type: "object",
      properties: {
        epicId: { type: "string" },
        title: { type: "string" },
        details: { type: "string" },
        status: { type: "string", description: "Backlog, Queued, In Progress, Blocked, Review, or Completed." },
        priority: { type: "string", description: "P0, P1, P2, or P3." },
        effort: { type: "string", enum: ["XS", "S", "M", "L", "XL"], description: "XS, S, M, L, or XL." },
        assignedTo: { type: "string" },
        githubUrl: { type: ["string", "null"] },
        githubNumber: { type: ["integer", "null"] },
        githubTitle: { type: ["string", "null"] },
      },
      required: ["epicId"],
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.updateKanbanEpic(asString(input.epicId), input),
  },
  {
    name: "update_kanban_epic_status",
    description: "Move a Kanban epic status. Requires `kanban-status` family grant. Any-scope `update_epic_status` (default: `pm`) allows all transitions; own_assignment scope restricts the assignee to Queued/active source states. Completed routes through the close-approval workflow.",
    inputSchema: {
      type: "object",
      properties: {
        epicId: { type: "string" },
        status: { type: "string", description: "Backlog, Queued, In Progress, Blocked, Review, or Completed." },
      },
      required: ["epicId", "status"],
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.updateKanbanEpicStatus(asString(input.epicId), asString(input.status)),
  },
  {
    name: "comment_kanban_epic",
    description: "Add a typed progress, note, or blocker comment to a Kanban epic.",
    inputSchema: {
      type: "object",
      properties: {
        epicId: { type: "string" },
        type: { type: "string", description: "progress, note, or blocker." },
        body: { type: "string" },
      },
      required: ["epicId", "type", "body"],
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.commentKanbanEpic(asString(input.epicId), asString(input.type, "progress"), asString(input.body)),
  },
  {
    name: "archive_kanban_epic",
    description: "Archive a Kanban epic. Rejects with 409 if open child issues are present.",
    inputSchema: {
      type: "object",
      properties: {
        epicId: { type: "string" },
      },
      required: ["epicId"],
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.archiveKanbanEpic(asString(input.epicId)),
  },
  {
    name: "request_kanban_epic_close",
    description: "Request closing a Kanban epic. Auto-completes when no children are open; otherwise enters pending close-approval until a human web session approves.",
    inputSchema: {
      type: "object",
      properties: {
        epicId: { type: "string" },
      },
      required: ["epicId"],
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.requestKanbanEpicClose(asString(input.epicId)),
  },
  {
    name: "cancel_kanban_epic_close",
    description: "Cancel a pending close-approval. Requires the `kanban_action:cancel_epic_close` grant (default: `pm` any-scope, or assignee with own_assignment scope).",
    inputSchema: {
      type: "object",
      properties: {
        epicId: { type: "string" },
      },
      required: ["epicId"],
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.cancelKanbanEpicClose(asString(input.epicId)),
  },
  {
    name: "set_summary",
    description: "Set or refresh a 1-2 sentence current-work summary visible to other roles.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", maxLength: 4000, description: "Current-work summary." },
      },
      required: ["summary"],
      additionalProperties: false,
    },
    execute: async (tools, input) => tools.setSummary(asString(input.summary)),
  },
] as const;

/**
 * Public tool catalog. Frozen array; consumers iterate it once at boot.
 * Order matches the registration order in `opencode-plugin.ts` so cross-
 * runtime tool listings stay grep-comparable.
 */
export const AGENT_TOOL_CATALOG: ReadonlyArray<AgentToolDef> = ENTRIES.map((entry) => ({
  ...entry,
  family: getToolFamily(entry.name),
  summarize: (result: unknown) => summarizeAgentToolResult(entry.name, result),
}));

function summarizeAgentToolResult(name: string, result: unknown): string {
  const data = isRecord(result) ? result : {};
  switch (name) {
    case "whoami": {
      const role = recordAt(data, "role");
      const main = recordAt(data, "mainRole");
      return `✓ whoami ${stringAt(role, "display_id", stringAt(role, "name", "role"))} (main=${stringAt(main, "display_id", "none")} session=${stringAt(data, "sessionId", "unknown")})`;
    }
    case "list_peers": {
      const peers = arrayAt(data, "peers");
      const names = peers.map((peer) => isRecord(peer) ? stringAt(peer, "displayId", stringAt(peer, "name", "peer")) : "peer").slice(0, 3).join(", ");
      return `✓ list_peers ${peers.length} peer(s)${names ? `: ${names}` : ""}`;
    }
    case "check_messages":
      return `✓ check_messages ${arrayAt(data, "messages").length} message(s)`;
    case "read_kanban_task": {
      const task = recordAt(data, "task");
      return `✓ read ${stringAt(task, "display_id", "WA-?")} ${stringAt(task, "title", "")} [${stringAt(task, "status", "?")}/${stringAt(task, "priority", "?")}] @ ${stringAt(task, "assigned_role_name", "unassigned")}`.trim();
    }
    case "read_kanban_epic": {
      const epic = recordAt(data, "epic");
      return `✓ read ${stringAt(epic, "display_id", "EP-?")} ${stringAt(epic, "title", "")} [${stringAt(epic, "status", "?")}/${stringAt(epic, "priority", "?")}]`.trim();
    }
    case "list_kanban_tasks":
      return `✓ list_kanban_tasks ${arrayAt(data, "tasks").length} task(s)`;
    case "list_kanban_epics":
      return `✓ list_kanban_epics ${arrayAt(data, "epics").length} epic(s)`;
    case "search_direct_messages":
    case "search_channel_messages":
    case "search_kanban_tasks":
    case "search_kanban_epics":
      return `✓ search ${hitCount(result)} hit(s)`;
    case "send_message":
    case "broadcast_message":
      return `✓ sent${idSuffix(data)}`;
    case "post_channel_message":
    case "reply_channel_thread":
      return `✓ posted${idSuffix(data)}`;
    case "create_kanban_task":
      return `✓ created ${displayIdFrom(data, "task", "WA-?")}`;
    case "create_kanban_epic":
      return `✓ created ${displayIdFrom(data, "epic", "EP-?")}`;
    case "update_kanban_task":
      return `✓ updated ${displayIdFrom(data, "task", "WA-?")}`;
    case "update_kanban_epic":
      return `✓ updated ${displayIdFrom(data, "epic", "EP-?")}`;
    case "update_kanban_task_status": {
      const task = recordAt(data, "task");
      return `✓ status ${stringAt(task, "display_id", "WA-?")} → ${stringAt(task, "status", "?")}`;
    }
    case "update_kanban_epic_status": {
      const epic = recordAt(data, "epic");
      return `✓ status ${stringAt(epic, "display_id", "EP-?")} → ${stringAt(epic, "status", "?")}`;
    }
    case "comment_kanban_task":
      return `✓ commented ${displayIdFrom(data, "task", "WA-?")}${commentTypeSuffix(data)}`;
    case "comment_kanban_epic":
      return `✓ commented ${displayIdFrom(data, "epic", "EP-?")}${commentTypeSuffix(data)}`;
    case "archive_kanban_task":
      return `✓ archived ${displayIdFrom(data, "task", "WA-?")}`;
    case "archive_kanban_epic":
      return `✓ archived ${displayIdFrom(data, "epic", "EP-?")}`;
    case "request_kanban_epic_close":
      return `✓ requested close ${displayIdFrom(data, "epic", "EP-?")}`;
    case "cancel_kanban_epic_close":
      return `✓ cancelled close ${displayIdFrom(data, "epic", "EP-?")}`;
    case "set_summary":
      return "✓ set summary";
    default:
      return `✓ ${name}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function recordAt(data: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = data[key];
  return isRecord(value) ? value : {};
}

function arrayAt(data: Record<string, unknown>, key: string): unknown[] {
  const value = data[key];
  return Array.isArray(value) ? value : [];
}

function stringAt(data: Record<string, unknown>, key: string, fallback: string): string {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function displayIdFrom(data: Record<string, unknown>, key: string, fallback: string): string {
  const item = recordAt(data, key);
  return stringAt(item, "display_id", fallback);
}

function idSuffix(data: Record<string, unknown>): string {
  const message = recordAt(data, "message");
  const id = typeof message.id === "number" || typeof message.id === "string" ? message.id : data.id;
  return typeof id === "number" || typeof id === "string" ? ` (id=${id})` : "";
}

function hitCount(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  if (!isRecord(result)) return 0;
  for (const key of ["results", "messages", "tasks", "epics", "hits"]) {
    const items = arrayAt(result, key);
    if (items.length > 0) return items.length;
  }
  return 0;
}

function commentTypeSuffix(data: Record<string, unknown>): string {
  const comment = recordAt(data, "comment");
  const type = stringAt(comment, "type", "");
  return type ? ` (${type})` : "";
}

/**
 * Set of canonical names in the public catalog. Useful for tests that
 * pin "Pi must register exactly these names".
 */
export const AGENT_TOOL_CATALOG_NAMES: ReadonlySet<string> = new Set(AGENT_TOOL_CATALOG.map((entry) => entry.name));

/**
 * Internal helper names that are explicitly NOT in the catalog. Pi push
 * controllers / mark-read cursors should call these directly via the
 * `AgentTools` instance.
 */
export const AGENT_INTERNAL_TOOL_NAMES: ReadonlySet<string> = new Set([
  "poll_messages",
  "mark_messages_read",
  "mark_messages_pushed",
  "settings",
]);
