import { Database } from "bun:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { KANBAN_EFFORTS, type KanbanEffort } from "./kanban-effort.ts";
export { KANBAN_EFFORTS, KANBAN_EFFORT_ORDINAL, type KanbanEffort } from "./kanban-effort.ts";
import type { HostType } from "./runner/protocol.ts";

export interface AgentRow {
  id: string;
  name: string;
  /** Workspace-decoupling: comes from the agent's repo (`workspace_repos.absolute_path`). */
  path: string;
  /** Workspace-decoupling: comes from the agent's repo (`workspace_repos.git_root`). */
  git_root: string | null;
  host_default: HostType | null;
  /** Workspace-decoupling: comes from the agent's repo (`workspace_repos.missing_at`). */
  missing_at: string | null;
  /** Workspace-decoupling: always null; tracking moved to per-repo metadata. */
  last_discovered_at: string | null;
  created_at: string;
  updated_at: string;
  /** Workspace-decoupling: present after migration 11. */
  repo_id?: string;
  /** Workspace-decoupling: `workspace_repos.name` for the agent's repo. */
  repo_name?: string;
  /** Workspace-decoupling: `<repo.name>:<agent.name>`. */
  display_id?: string;
}

export type PolicyMode = "star" | "peer-to-peer" | "channel";
export type PeerRuleMode = "allow-list" | "deny-list";

export const DEFAULT_CHANNEL_ID = "shared";
export const DEFAULT_CHANNEL_NAME = "shared";

export interface RuntimeCommandConfig {
  command: string;
  args: string[];
  enabled: boolean;
}

export interface RuntimeCommands {
  claudeCode: RuntimeCommandConfig;
  openCode: RuntimeCommandConfig;
  codex: RuntimeCommandConfig;
  pi: RuntimeCommandConfig;
}

export interface RuntimeSettings {
  globalDefaultHost: HostType | null;
  commands: RuntimeCommands;
}

export interface PeerRuleRow {
  id: number;
  role_a_id: string;
  role_a_name: string;
  role_b_id: string;
  role_b_name: string;
  created_at: string;
}

export interface PeerPolicySettings {
  mode: PeerRuleMode;
  rules: PeerRuleRow[];
}

export interface RunningSessionDetail {
  role_id: string;
  role_name: string;
  session_id: string;
  host_type: HostType;
  status: string;
  cwd: string;
  started_at: string;
  last_seen: string;
  summary: string;
}

export interface ChatHistorySettings {
  retentionDays: number | null;
}

export interface MessageSettings {
  maxBodyChars: number;
}

export type KanbanStatus = "Backlog" | "Queued" | "In Progress" | "Blocked" | "Review" | "Completed";
export type KanbanPriority = "P0" | "P1" | "P2" | "P3";
export type KanbanCommentType = "progress" | "note" | "blocker";

export interface KanbanSettings {
  taskIdPrefix: string;
  epicIdPrefix: string;
}

export type KanbanEpicCloseApprovalStatus = "none" | "pending" | "approved";

export interface KanbanTaskRow {
  id: number;
  display_id: string;
  sequence: number;
  title: string;
  details: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  effort: KanbanEffort;
  created_by_role_id: string;
  created_by_role_name: string;
  assigned_role_id: string;
  assigned_role_name: string;
  github_url: string | null;
  github_number: number | null;
  github_title: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  archived_at: string | null;
  archived_by_role_id: string | null;
  archived_by_role_name: string | null;
  epic_id: number | null;
}

export interface KanbanEpicRow {
  id: number;
  display_id: string;
  sequence: number;
  title: string;
  details: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  effort: KanbanEffort;
  created_by_role_id: string;
  created_by_role_name: string;
  assigned_role_id: string;
  assigned_role_name: string;
  github_url: string | null;
  github_number: number | null;
  github_title: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  archived_at: string | null;
  archived_by_role_id: string | null;
  archived_by_role_name: string | null;
  close_approval_status: KanbanEpicCloseApprovalStatus;
  close_approval_requested_at: string | null;
  close_approval_requested_by_role_id: string | null;
  close_approval_requested_by_role_name: string | null;
  close_approval_approved_at: string | null;
  close_approval_approved_by: string | null;
}

export interface KanbanTaskInput {
  title: string;
  details?: string;
  createdByRoleId: string;
  assignedRoleId: string;
  status?: KanbanStatus;
  priority?: KanbanPriority;
  effort?: KanbanEffort;
  githubUrl?: string | null;
  githubNumber?: number | null;
  githubTitle?: string | null;
  epicId?: string | number | null;
}

export interface KanbanTaskUpdateInput {
  actorRoleId: string;
  actorSessionId?: string | null;
  title?: string;
  details?: string;
  status?: KanbanStatus;
  priority?: KanbanPriority;
  effort?: KanbanEffort;
  assignedRoleId?: string;
  githubUrl?: string | null;
  githubNumber?: number | null;
  githubTitle?: string | null;
  dependsOnTaskIds?: Array<string | number>;
  epicId?: string | number | null;
}

export interface KanbanCommentRow {
  id: number;
  task_id: number;
  task_display_id: string;
  role_id: string;
  role_name: string;
  session_id: string | null;
  type: KanbanCommentType;
  body: string;
  created_at: string;
}

export interface KanbanActivityRow {
  id: number;
  task_id: number;
  task_display_id: string;
  role_id: string;
  role_name: string;
  session_id: string | null;
  action: string;
  field: string | null;
  before_json: string | null;
  after_json: string | null;
  created_at: string;
}

export interface KanbanDependencyRow {
  task_id: number;
  task_display_id: string;
  depends_on_task_id: number;
  depends_on_display_id: string;
  depends_on_title: string;
  depends_on_status: KanbanStatus;
  depends_on_priority: KanbanPriority;
  created_by_role_id: string;
  created_by_role_name: string;
  created_at: string;
}

export interface KanbanDependedByRow {
  task_id: number;
  task_display_id: string;
  title: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  depends_on_task_id: number;
  depends_on_display_id: string;
  created_by_role_id: string;
  created_by_role_name: string;
  created_at: string;
}

export interface KanbanNotificationRow {
  id: number;
  task_id: number;
  task_display_id: string;
  to_role_id: string;
  to_role_name: string;
  actor_role_id: string | null;
  actor_role_name: string | null;
  event_type: string;
  activity_id: number | null;
  comment_id: number | null;
  body: string;
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
}

export interface KanbanEpicInput {
  title: string;
  details?: string;
  createdByRoleId: string;
  assignedRoleId: string;
  status?: KanbanStatus;
  priority?: KanbanPriority;
  effort?: KanbanEffort;
  githubUrl?: string | null;
  githubNumber?: number | null;
  githubTitle?: string | null;
}

export interface KanbanEpicUpdateInput {
  actorRoleId: string;
  actorSessionId?: string | null;
  title?: string;
  details?: string;
  status?: KanbanStatus;
  priority?: KanbanPriority;
  effort?: KanbanEffort;
  assignedRoleId?: string;
  githubUrl?: string | null;
  githubNumber?: number | null;
  githubTitle?: string | null;
}

export interface KanbanEpicCommentRow {
  id: number;
  epic_id: number;
  epic_display_id: string;
  role_id: string;
  role_name: string;
  session_id: string | null;
  type: KanbanCommentType;
  body: string;
  created_at: string;
}

export interface KanbanEpicActivityRow {
  id: number;
  epic_id: number;
  epic_display_id: string;
  role_id: string;
  role_name: string;
  session_id: string | null;
  action: string;
  field: string | null;
  before_json: string | null;
  after_json: string | null;
  created_at: string;
}

export interface KanbanEpicNotificationRow {
  id: number;
  epic_id: number;
  epic_display_id: string;
  to_role_id: string;
  to_role_name: string;
  actor_role_id: string | null;
  actor_role_name: string | null;
  event_type: string;
  activity_id: number | null;
  comment_id: number | null;
  body: string;
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
}

export interface DirectMessageSearchRow {
  id: number;
  sentAt: string;
  from: { displayId: string; name: string };
  to: { displayId: string; name: string };
  bodyPreview: string;
  rank: number;
}

export interface ChannelMessageSearchRow {
  id: number;
  sentAt: string;
  channelId: string;
  channelName: string;
  from: { displayId: string; name: string } | null;
  bodyPreview: string;
  parentMessageId: number | null;
  rootMessageId: number | null;
  rank: number;
}

export interface KanbanMatchingCommentSearchRow {
  id: number;
  author: string;
  type: KanbanCommentType;
  bodyPreview: string;
  createdAt: string;
}

export interface KanbanTaskSearchRow {
  displayId: string;
  title: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  assignee: string;
  createdAt: string;
  updatedAt: string;
  matchedIn: Array<"display_id" | "title" | "details" | "comments">;
  bodyPreview: string;
  matchingComment?: KanbanMatchingCommentSearchRow;
  rank: number;
}

export interface KanbanEpicSearchRow {
  displayId: string;
  title: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  assignee: string;
  createdAt: string;
  updatedAt: string;
  matchedIn: Array<"display_id" | "title" | "details" | "comments">;
  bodyPreview: string;
  matchingComment?: KanbanMatchingCommentSearchRow;
  rank: number;
}

export interface ChatHistoryCleanupResult {
  messages: number;
  channelMessages: number;
  total: number;
}

export const DEFAULT_POLICY_MODE: PolicyMode = "star";
export const DEFAULT_PEER_RULE_MODE: PeerRuleMode = "deny-list";
export const DEFAULT_CHAT_HISTORY_RETENTION_DAYS = 30;
export const DEFAULT_MESSAGE_MAX_BODY_CHARS = 32_000;
export const DEFAULT_KANBAN_TASK_ID_PREFIX = "WA";
export const DEFAULT_KANBAN_EPIC_ID_PREFIX = "EP";
export const DEFAULT_RUNTIME_COMMANDS: RuntimeCommands = {
  claudeCode: { command: "claude", args: [], enabled: true },
  openCode: { command: "opencode", args: [], enabled: true },
  codex: { command: "codex", args: [], enabled: true },
  pi: { command: "pi", args: [], enabled: true },
};

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  globalDefaultHost: null,
  commands: DEFAULT_RUNTIME_COMMANDS,
};

const POLICY_MODE_KEY = "policy.mode";
const PEER_RULE_MODE_KEY = "policy.peer_rule_mode";
const RUNTIME_COMMANDS_KEY = "runtime.commands";
const RUNTIME_GLOBAL_DEFAULT_HOST_KEY = "runtime.global_default_host";
const CHAT_HISTORY_RETENTION_DAYS_KEY = "chat_history.retention_days";
const MESSAGE_MAX_BODY_CHARS_KEY = "message.max_body_chars";
const KANBAN_TASK_ID_PREFIX_KEY = "kanban.task_id_prefix";
const KANBAN_EPIC_ID_PREFIX_KEY = "kanban.epic_id_prefix";

export interface RunnerLaunchRecord {
  roleId: string;
  sessionId: string;
  hostType: HostType;
  runnerPid: number;
  cwd: string;
  socketPath: string;
  metadataPath: string;
  startedAt: string;
}

export interface LaunchTokenInput {
  id: string;
  roleId: string;
  sessionId: string;
  tokenHash: string;
  expiresAt: string;
}

export interface LaunchTokenRow {
  id: string;
  role_id: string;
  role_name: string;
  session_id: string | null;
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
}

export interface AgentSessionCredentialInput {
  id: string;
  roleId: string;
  sessionId: string;
  credentialHash: string;
  issuedAt: string;
  expiresAt: string;
  launchTokenId?: string | null;
}

export interface AgentSessionCredentialRow {
  id: string;
  role_id: string;
  role_name: string;
  session_id: string;
  credential_hash: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  launch_token_id: string | null;
}

export type MessageState = "pending" | "pushed" | "delivered" | "acked" | "rejected";
export type MessageDeliveryKind = "direct" | "broadcast" | "channel" | "kanban";

export interface MessageInput {
  threadId: string;
  fromRoleId: string | null;
  toRoleId: string;
  fromSessionId: string | null;
  toSessionId: string | null;
  body: string;
  state: MessageState;
  deliveryKind?: MessageDeliveryKind;
  broadcastId?: string | null;
  error?: string | null;
}

export interface MessageRow {
  id: number;
  thread_id: string;
  from_role_id: string | null;
  from_role_name: string | null;
  to_role_id: string;
  to_role_name: string;
  from_session_id: string | null;
  to_session_id: string | null;
  body: string;
  state: MessageState;
  delivery_kind: MessageDeliveryKind;
  broadcast_id: string | null;
  channel_id?: string | null;
  channel_name?: string | null;
  parent_message_id?: number | null;
  root_message_id?: number | null;
  kanban_notification_id?: number | null;
  kanban_task_id?: number | null;
  kanban_task_display_id?: string | null;
  kanban_epic_notification_id?: number | null;
  kanban_epic_id?: number | null;
  kanban_epic_display_id?: string | null;
  kanban_event_type?: string | null;
  sent_at: string;
  delivered_at: string | null;
  acked_at: string | null;
  pushed_at: string | null;
  error: string | null;
}

export interface ChannelRow {
  id: string;
  name: string;
  created_at: string;
}

export interface ChannelMessageInput {
  channelId?: string;
  fromRoleId: string | null;
  fromSessionId: string | null;
  body: string;
  parentMessageId?: number | null;
}

export interface ChannelMessageRow {
  id: number;
  channel_id: string;
  channel_name: string;
  from_role_id: string | null;
  from_role_name: string | null;
  from_session_id: string | null;
  body: string;
  parent_message_id: number | null;
  root_message_id: number | null;
  sent_at: string;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function openFleetDb(dbPath: string): Database {
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new Database(dbPath);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  return db;
}

export function migrate(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  if (!migrationApplied(db, 1)) applyMigration1(db);
  if (!migrationApplied(db, 2)) applyMigration2(db);
  if (!migrationApplied(db, 3)) applyMigration3(db);
  if (!migrationApplied(db, 4)) applyMigration4(db);
  if (!migrationApplied(db, 5)) applyMigration5(db);
  if (!migrationApplied(db, 6)) applyMigration6(db);
  if (!migrationApplied(db, 7)) applyMigration7(db);
  if (!migrationApplied(db, 8)) applyMigration8(db);
  if (!migrationApplied(db, 9)) applyMigration9(db);
  if (!migrationApplied(db, 10)) applyMigration10(db);
  if (!migrationApplied(db, 11)) applyMigration11(db);
  if (!migrationApplied(db, 12)) applyMigration12(db);
  if (!migrationApplied(db, 13)) applyMigration13(db);
  if (!migrationApplied(db, 14)) applyMigration14(db);
  if (!migrationApplied(db, 15)) applyMigration15(db);
  if (!migrationApplied(db, 16)) applyMigration16(db);
  if (!migrationApplied(db, 17)) applyMigration17(db);
  if (!migrationApplied(db, 18)) applyMigration18(db);
  if (!migrationApplied(db, 19)) applyMigration19(db);
  if (!migrationApplied(db, 20)) applyMigration20(db);
  if (!migrationApplied(db, 21)) applyMigration21(db);
  if (!migrationApplied(db, 22)) applyMigration22(db);
  if (!migrationApplied(db, 23)) applyMigration23(db);
  if (!migrationApplied(db, 24)) applyMigration24(db);
  if (!migrationApplied(db, 25)) applyMigration25(db);
}

// Historical schema-repair pass for DBs upgraded from earlier versions where a
// migration may have left a table or column missing (Q9). Idempotent: runs a
// transaction full of `CREATE TABLE IF NOT EXISTS` and `PRAGMA table_info`
// add-column shims. Used to run on every migrate() call (i.e. on every API
// request); audit PR7 moved it to startup-only — daemon calls this once after
// migrate() in startDaemon.
export function runStartupRepair(db: Database): void {
  repairCurrentSchema(db);
}

function migrationApplied(db: Database, version: number): boolean {
  return Boolean(db.query<{ version: number }, [number]>("SELECT version FROM schema_migrations WHERE version = ?").get(version));
}

function applyMigration1(db: Database): void {
  db.transaction(() => {
    db.run(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      path TEXT NOT NULL,
      git_root TEXT,
      host_default TEXT NOT NULL DEFAULT 'claude-code',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL REFERENCES roles(id),
      host_type TEXT NOT NULL,
      pid INTEGER,
      child_pid INTEGER,
      runner_pid INTEGER,
      status TEXT NOT NULL,
      cwd TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      last_seen TEXT,
      summary TEXT NOT NULL DEFAULT ''
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS role_locks (
      role_id TEXT PRIMARY KEY REFERENCES roles(id),
      session_id TEXT NOT NULL REFERENCES sessions(id),
      acquired_at TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      from_role_id TEXT,
      to_role_id TEXT NOT NULL,
      from_session_id TEXT,
      to_session_id TEXT,
      body TEXT NOT NULL,
      state TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      delivered_at TEXT,
      acked_at TEXT,
      error TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS permissions (
      id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL REFERENCES roles(id),
      session_id TEXT REFERENCES sessions(id),
      host_type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      role_id TEXT,
      session_id TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS launch_tokens (
      id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL REFERENCES roles(id),
      session_id TEXT,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS runners (
      role_id TEXT PRIMARY KEY REFERENCES roles(id),
      session_id TEXT NOT NULL REFERENCES sessions(id),
      runner_pid INTEGER NOT NULL,
      socket_path TEXT NOT NULL,
      metadata_path TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      last_seen TEXT
    )`);

    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)", [nowIso()]);
  })();
}

function applyMigration2(db: Database): void {
  db.transaction(() => {
    addColumnIfMissing(db, "roles", "default_host_type", "TEXT");
    addColumnIfMissing(db, "roles", "missing_at", "TEXT");
    addColumnIfMissing(db, "roles", "last_discovered_at", "TEXT");
    db.run("UPDATE roles SET default_host_type = host_default WHERE default_host_type IS NULL AND host_default IS NOT NULL AND host_default != ''");
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)", [nowIso()]);
  })();
}

function applyMigration3(db: Database): void {
  db.transaction(() => {
    ensurePeerPolicyRulesTable(db);
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (3, ?)", [nowIso()]);
  })();
}

function applyMigration4(db: Database): void {
  db.transaction(() => {
    ensureMessageDeliveryColumns(db);
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (4, ?)", [nowIso()]);
  })();
}

function applyMigration5(db: Database): void {
  db.transaction(() => {
    ensureChannelTables(db);
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (5, ?)", [nowIso()]);
  })();
}

function applyMigration6(db: Database): void {
  db.transaction(() => {
    ensureMessageDeliveryColumns(db);
    backfillDeliveredMessagesAsRead(db);
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (6, ?)", [nowIso()]);
  })();
}

function applyMigration7(db: Database): void {
  db.transaction(() => {
    ensureKanbanTables(db);
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (7, ?)", [nowIso()]);
  })();
}

function applyMigration8(db: Database): void {
  db.transaction(() => {
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (8, ?)", [nowIso()]);
  })();
}

function applyMigration9(db: Database): void {
  db.transaction(() => {
    ensureKanbanEpicSchema(db);
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (9, ?)", [nowIso()]);
  })();
}

function applyMigration10(db: Database): void {
  db.transaction(() => {
    ensureKanbanEpicNotificationSchema(db);
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (10, ?)", [nowIso()]);
  })();
}

/**
 * Workspace decoupling, phase 2: introduce `workspace_scan_dirs` and
 * `workspace_repos` as first-class entities and recreate `roles` so each
 * role belongs to exactly one repo (`repo_id` FK, `UNIQUE(repo_id, name)`).
 *
 * `roles` columns dropped: `path`, `git_root`, `missing_at`,
 * `last_discovered_at`. `path` semantics move to `workspace_repos.absolute_path`,
 * `git_root` cached on the repo, missing-detection per-repo. The
 * Multiple roles per repo are always allowed in the new model.
 *
 * Alpha break: `roles` gets recreated empty. Per-workspace child tables
 * (messages, channel_*, kanban_*) keep their existing FK declarations
 * pointing at the new `roles(id)`. Their FK semantics flip to ON DELETE
 * SET NULL with display-snapshot columns in WA-059 (migration 12). Until
 * that migration lands the per-workspace DB is in a transient state —
 * intentional, mid-epic.
 */
function applyMigration11(db: Database): void {
  // FK enforcement must be off across DROP+RENAME of `roles` because every
  // child table that references `roles(id)` would otherwise reject the swap.
  // PRAGMA foreign_keys is a no-op inside a transaction, so toggle it
  // outside and restore in `finally`.
  db.run("PRAGMA foreign_keys = OFF");
  try {
    db.transaction(() => {
      // Scan dirs first — workspace_repos.source_scan_id FKs into it.
      db.run(`CREATE TABLE IF NOT EXISTS workspace_scan_dirs (
        id TEXT PRIMARY KEY,
        absolute_path TEXT NOT NULL UNIQUE,
        scan_on_startup INTEGER NOT NULL DEFAULT 0,
        last_scan_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS workspace_repos (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        absolute_path TEXT NOT NULL UNIQUE,
        git_root TEXT,
        source_scan_id TEXT REFERENCES workspace_scan_dirs(id) ON DELETE SET NULL,
        missing_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);

      // Recreate `roles` with the new shape. Existing rows are not
      // preserved per the alpha-break decision in the spec; child tables
      // (messages, channel_*, kanban_*) retain their FKs pointing at the
      // new `roles(id)`, which is empty. WA-059 will rewrite the child
      // FKs to ON DELETE SET NULL plus display-snapshot columns.
      db.run("DROP TABLE IF EXISTS roles_v11_new");
      db.run(`CREATE TABLE roles_v11_new (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL REFERENCES workspace_repos(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        host_default TEXT NOT NULL DEFAULT 'claude-code',
        default_host_type TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(repo_id, name)
      )`);
      db.run("DROP TABLE IF EXISTS roles");
      db.run("ALTER TABLE roles_v11_new RENAME TO roles");

      // Drop the removed per-workspace toggle; multiple roles per repo are
      // always allowed after this migration.
      db.run("DELETE FROM settings WHERE key = 'workspace.multi_agent_per_repo'");

      db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (11, ?)", [nowIso()]);
    })();
  } finally {
    db.run("PRAGMA foreign_keys = ON");
  }
}

/**
 * Workspace decoupling, phase 3: history-table FK flip + display snapshots.
 *
 * Every history-bearing table that previously declared `REFERENCES roles(id)
 * ON DELETE RESTRICT` (or no action / CASCADE on `to_role_id` notification
 * fanout) is recreated with `ON DELETE SET NULL` so deleting a role/repo
 * does not block (RESTRICT) and does not destroy historical rows (CASCADE).
 * To preserve render-ability after the FK is nulled out, each affected row
 * gains a `*_display` snapshot column populated at insert time and never
 * mutated afterwards. Renderers prefer the live join, fall back to the
 * snapshot, and surface "(deleted)" only if both are gone.
 *
 * Live-state tables (sessions, role_locks, runners, launch_tokens,
 * permissions, peer_policy_rules, channel_reads) are intentionally NOT
 * touched here — they can keep their default FK behaviour. A future
 * cleanup task may make their CASCADE explicit.
 *
 * Alpha break: every recreated table is wiped (no data copy). The new
 * insert sites in WA-060+ DAO must populate display snapshots.
 */
function applyMigration12(db: Database): void {
  db.run("PRAGMA foreign_keys = OFF");
  try {
    db.transaction(() => {
      // ---- messages ----
      db.run(`CREATE TABLE messages_v12_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        from_role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
        to_role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
        from_session_id TEXT,
        to_session_id TEXT,
        from_display TEXT,
        to_display TEXT,
        body TEXT NOT NULL,
        state TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        delivered_at TEXT,
        acked_at TEXT,
        error TEXT,
        delivery_kind TEXT NOT NULL DEFAULT 'direct',
        broadcast_id TEXT
      )`);
      db.run("DROP TABLE IF EXISTS messages");
      db.run("ALTER TABLE messages_v12_new RENAME TO messages");

      // ---- channel_messages: just add from_display via column copy ----
      db.run(`CREATE TABLE channel_messages_v12_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        from_role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
        from_session_id TEXT,
        from_display TEXT,
        body TEXT NOT NULL,
        parent_message_id INTEGER REFERENCES channel_messages(id),
        root_message_id INTEGER REFERENCES channel_messages(id),
        sent_at TEXT NOT NULL
      )`);
      db.run("DROP TABLE IF EXISTS channel_messages");
      db.run("ALTER TABLE channel_messages_v12_new RENAME TO channel_messages");

      // ---- events ----
      db.run(`CREATE TABLE events_v12_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
        actor_display TEXT,
        session_id TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`);
      db.run("DROP TABLE IF EXISTS events");
      db.run("ALTER TABLE events_v12_new RENAME TO events");

      // ---- kanban_tasks ----
      db.run(`CREATE TABLE kanban_tasks_v12_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        display_id TEXT NOT NULL UNIQUE,
        sequence INTEGER NOT NULL UNIQUE,
        title TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        effort TEXT NOT NULL,
        created_by_role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
        assigned_role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
        created_by_display TEXT,
        assignee_display TEXT,
        github_url TEXT,
        github_number INTEGER,
        github_title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        archived_at TEXT,
        archived_by_role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
        epic_id INTEGER REFERENCES kanban_epics(id) ON DELETE SET NULL
      )`);
      db.run("DROP TABLE IF EXISTS kanban_tasks");
      db.run("ALTER TABLE kanban_tasks_v12_new RENAME TO kanban_tasks");
      db.run("CREATE INDEX kanban_tasks_status_idx ON kanban_tasks(status)");
      db.run("CREATE INDEX kanban_tasks_assigned_role_idx ON kanban_tasks(assigned_role_id)");
      db.run("CREATE INDEX kanban_tasks_created_by_role_idx ON kanban_tasks(created_by_role_id)");
      db.run("CREATE INDEX kanban_tasks_archived_idx ON kanban_tasks(archived_at)");
      db.run("CREATE INDEX kanban_tasks_epic_idx ON kanban_tasks(epic_id)");

      // ---- kanban_comments ----
      db.run(`CREATE TABLE kanban_comments_v12_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
        role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
        actor_display TEXT,
        session_id TEXT,
        type TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`);
      db.run("DROP TABLE IF EXISTS kanban_comments");
      db.run("ALTER TABLE kanban_comments_v12_new RENAME TO kanban_comments");
      db.run("CREATE INDEX kanban_comments_task_idx ON kanban_comments(task_id, id)");

      // ---- kanban_dependencies ----
      db.run(`CREATE TABLE kanban_dependencies_v12_new (
        task_id INTEGER NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
        depends_on_task_id INTEGER NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
        created_by_role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(task_id, depends_on_task_id),
        CHECK(task_id != depends_on_task_id)
      )`);
      db.run("DROP TABLE IF EXISTS kanban_dependencies");
      db.run("ALTER TABLE kanban_dependencies_v12_new RENAME TO kanban_dependencies");
      db.run("CREATE INDEX kanban_dependencies_depends_on_idx ON kanban_dependencies(depends_on_task_id)");

      // ---- kanban_activity ----
      db.run(`CREATE TABLE kanban_activity_v12_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
        role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
        actor_display TEXT,
        session_id TEXT,
        action TEXT NOT NULL,
        field TEXT,
        before_json TEXT,
        after_json TEXT,
        created_at TEXT NOT NULL
      )`);
      db.run("DROP TABLE IF EXISTS kanban_activity");
      db.run("ALTER TABLE kanban_activity_v12_new RENAME TO kanban_activity");
      db.run("CREATE INDEX kanban_activity_task_idx ON kanban_activity(task_id, id)");

      // ---- kanban_notifications ----
      db.run(`CREATE TABLE kanban_notifications_v12_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
        to_role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
        actor_role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
        to_display TEXT,
        actor_display TEXT,
        event_type TEXT NOT NULL,
        activity_id INTEGER REFERENCES kanban_activity(id) ON DELETE SET NULL,
        comment_id INTEGER REFERENCES kanban_comments(id) ON DELETE SET NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        delivered_at TEXT,
        read_at TEXT
      )`);
      db.run("DROP TABLE IF EXISTS kanban_notifications");
      db.run("ALTER TABLE kanban_notifications_v12_new RENAME TO kanban_notifications");
      db.run("CREATE INDEX kanban_notifications_to_role_idx ON kanban_notifications(to_role_id, read_at, id)");

      // ---- kanban_epics ----
      db.run(`CREATE TABLE kanban_epics_v12_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        display_id TEXT NOT NULL UNIQUE,
        sequence INTEGER NOT NULL UNIQUE,
        title TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        effort TEXT NOT NULL,
        created_by_role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
        assigned_role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
        created_by_display TEXT,
        assignee_display TEXT,
        github_url TEXT,
        github_number INTEGER,
        github_title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        archived_at TEXT,
        archived_by_role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
        close_approval_status TEXT NOT NULL DEFAULT 'none',
        close_approval_requested_at TEXT,
        close_approval_requested_by_role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
        close_approval_approved_at TEXT,
        close_approval_approved_by TEXT
      )`);
      db.run("DROP TABLE IF EXISTS kanban_epics");
      db.run("ALTER TABLE kanban_epics_v12_new RENAME TO kanban_epics");
      db.run("CREATE INDEX kanban_epics_status_idx ON kanban_epics(status)");
      db.run("CREATE INDEX kanban_epics_assigned_role_idx ON kanban_epics(assigned_role_id)");
      db.run("CREATE INDEX kanban_epics_created_by_role_idx ON kanban_epics(created_by_role_id)");
      db.run("CREATE INDEX kanban_epics_archived_idx ON kanban_epics(archived_at)");

      // ---- kanban_epic_comments ----
      db.run(`CREATE TABLE kanban_epic_comments_v12_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        epic_id INTEGER NOT NULL REFERENCES kanban_epics(id) ON DELETE CASCADE,
        role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
        actor_display TEXT,
        session_id TEXT,
        type TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`);
      db.run("DROP TABLE IF EXISTS kanban_epic_comments");
      db.run("ALTER TABLE kanban_epic_comments_v12_new RENAME TO kanban_epic_comments");
      db.run("CREATE INDEX kanban_epic_comments_epic_idx ON kanban_epic_comments(epic_id, id)");

      // ---- kanban_epic_activity ----
      db.run(`CREATE TABLE kanban_epic_activity_v12_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        epic_id INTEGER NOT NULL REFERENCES kanban_epics(id) ON DELETE CASCADE,
        role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
        actor_display TEXT,
        session_id TEXT,
        action TEXT NOT NULL,
        field TEXT,
        before_json TEXT,
        after_json TEXT,
        created_at TEXT NOT NULL
      )`);
      db.run("DROP TABLE IF EXISTS kanban_epic_activity");
      db.run("ALTER TABLE kanban_epic_activity_v12_new RENAME TO kanban_epic_activity");
      db.run("CREATE INDEX kanban_epic_activity_epic_idx ON kanban_epic_activity(epic_id, id)");

      // ---- kanban_epic_notifications ----
      db.run(`CREATE TABLE kanban_epic_notifications_v12_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        epic_id INTEGER NOT NULL REFERENCES kanban_epics(id) ON DELETE CASCADE,
        to_role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
        actor_role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
        to_display TEXT,
        actor_display TEXT,
        event_type TEXT NOT NULL,
        activity_id INTEGER REFERENCES kanban_epic_activity(id) ON DELETE SET NULL,
        comment_id INTEGER REFERENCES kanban_epic_comments(id) ON DELETE SET NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        delivered_at TEXT,
        read_at TEXT
      )`);
      db.run("DROP TABLE IF EXISTS kanban_epic_notifications");
      db.run("ALTER TABLE kanban_epic_notifications_v12_new RENAME TO kanban_epic_notifications");
      db.run("CREATE INDEX kanban_epic_notifications_to_role_idx ON kanban_epic_notifications(to_role_id, read_at, id)");

      db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (12, ?)", [nowIso()]);
    })();
  } finally {
    db.run("PRAGMA foreign_keys = ON");
  }
}

/**
 * Workspace decoupling, phase 4 (Advisor round-4 follow-up):
 *  - drop FK on `messages.to_role_id` so the `human-web` sentinel peer
 *    survives the post-migration-12 FK enforcement. Renderer falls back
 *    on the snapshot column populated at insert time.
 *  - add display-snapshot columns to history that round-3 missed:
 *    `kanban_dependencies.created_by_display`,
 *    `kanban_tasks.archived_by_display`,
 *    `kanban_epics.archived_by_display`,
 *    `kanban_epics.close_approval_requested_by_display`.
 */
function applyMigration13(db: Database): void {
  db.transaction(() => {
    // Sentinels (e.g. `human-web` for agent → human direct messages)
    // are NOT real role rows. Migration 12's `to_role_id` FK to roles
    // would FK-fail those inserts. Resolution: at insert time we
    // translate sentinel → `to_role_id = NULL` + `to_display = '<sentinel>'`,
    // so the FK is preserved and the renderer falls back through the
    // display snapshot. The migration only adds the missing display
    // columns Advisor flagged in round 4.
    addColumnIfMissing(db, "kanban_dependencies", "created_by_display", "TEXT");
    addColumnIfMissing(db, "kanban_tasks", "archived_by_display", "TEXT");
    addColumnIfMissing(db, "kanban_epics", "archived_by_display", "TEXT");
    addColumnIfMissing(db, "kanban_epics", "close_approval_requested_by_display", "TEXT");

    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (13, ?)", [nowIso()]);
  })();
}

/**
 * RBAC Phase 1: rename `role` → `agent` at the identity-term layer.
 *
 *  - `roles` table → `agents`. SQLite auto-rewrites every dependent table's
 *    `REFERENCES roles(id)` clause in sqlite_master to `REFERENCES agents(id)`.
 *    No data migration; table contents move untouched.
 *  - `role_locks` → `agent_locks` + column `role_id` → `agent_id`. This
 *    satellite tracks per-identity lock state and is semantically meaningless
 *    if the parent table is `agents` but the satellite name still says "role".
 *  - `runners.role_id` → `agent_id`. Same reasoning: the runner row IS an
 *    agent's runner.
 *
 * Intentionally NOT renamed (pragmatic narrowing per spec §Phase 1):
 *  - `sessions.role_id`, `launch_tokens.role_id` — auth path; lockout-risk
 *    surface flagged by advisor. Keeping legacy column names eliminates any
 *    column-rewrite path on these tables.
 *  - `kanban_tasks.assigned_role_id` / `created_by_role_id` / etc — high-churn
 *    column rename across DAO call sites for zero functional gain. Phase 2+
 *    RBAC works against legacy column names.
 *  - `messages.from_role_id` / `to_role_id`, `events.role_id`,
 *    `permissions.role_id`, `kanban_comments.role_id`, `channel_messages.from_role_id`,
 *    `kanban_*.assigned_role_id` / `created_by_role_id`, etc.
 *
 * The dependent-table `REFERENCES` arrow auto-updates anyway, so FK semantics
 * stay correct; only the column NAME on the dependent side stays "role_id".
 *
 * PRAGMA foreign_keys disabled across the rename (matches v11/v12 precedent)
 * to make the FK-arrow rewrite atomic and to avoid any transient FK violation
 * during the table swap.
 */
function applyMigration14(db: Database): void {
  // Tests sometimes hand-roll partial schemas (e.g. only `roles` + `settings`)
  // and call migrate() to verify a specific migration's behavior. Skip rename
  // for any table the caller hasn't created. Production paths always have all
  // tables (migration 1 creates them).
  const tableExists = (name: string): boolean =>
    Boolean(
      db.query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      ).get(name),
    );

  db.run("PRAGMA foreign_keys = OFF");
  try {
    db.transaction(() => {
      if (tableExists("roles")) {
        db.run("ALTER TABLE roles RENAME TO agents");
      }
      if (tableExists("role_locks")) {
        db.run("ALTER TABLE role_locks RENAME TO agent_locks");
        db.run("ALTER TABLE agent_locks RENAME COLUMN role_id TO agent_id");
      }
      if (tableExists("runners")) {
        db.run("ALTER TABLE runners RENAME COLUMN role_id TO agent_id");
      }

      db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (14, ?)", [nowIso()]);
    })();
  } finally {
    db.run("PRAGMA foreign_keys = ON");
  }
}

/**
 * RBAC Phase 2a: introduce RBAC schema (`roles`, `agent_roles`, `role_grants`)
 * + seed 6 built-in roles with their default grants + assign each existing
 * `agents` row to the appropriate built-in role(s) by name.
 *
 * The Phase 1 rename freed the `roles` table name; this migration reuses it
 * for RBAC permission sets. Identity stays in `agents`.
 *
 * No enforcement here — this phase only lays the data model + seed. Phase 3
 * adds soft-enforcement reads; Phase 4 flips to hard 403s.
 */
function applyMigration15(db: Database): void {
  db.transaction(() => {
    // ---- RBAC tables -------------------------------------------------------
    db.run(`CREATE TABLE roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    db.run("CREATE INDEX roles_builtin_idx ON roles(is_builtin)");

    db.run(`CREATE TABLE agent_roles (
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
      assigned_at TEXT NOT NULL,
      PRIMARY KEY (agent_id, role_id)
    )`);
    db.run("CREATE INDEX agent_roles_role_idx ON agent_roles(role_id)");

    db.run(`CREATE TABLE role_grants (
      id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      grant_kind TEXT NOT NULL,
      grant_value TEXT NOT NULL,
      scope_qualifier TEXT,
      created_at TEXT NOT NULL
    )`);
    db.run("CREATE INDEX role_grants_role_idx ON role_grants(role_id)");
    db.run("CREATE UNIQUE INDEX role_grants_uniq ON role_grants(role_id, grant_kind, grant_value, COALESCE(scope_qualifier, ''))");

    // ---- Seed 6 built-in roles + their default grants ----------------------
    seedBuiltinRolesAndGrants(db);

    // ---- Seed agent_roles for every existing agents row by name match -----
    seedAgentRolesByNameMap(db);

    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (15, ?)", [nowIso()]);
  })();
}

/**
 * v16 — `audit_log` table for soft-enforcement violations + grant-check
 * passes (Phase 3) and future hard-violation rows + role-mutation events
 * (Phase 4 / EP-SEC-C). Schema deliberately wide enough to absorb new
 * audit kinds without migration; kind-specific structure lives in
 * `payload_json`. `actor_agent_id` is NOT a foreign key — agents may be
 * deleted after a row is written and the audit log is the legal record
 * of what happened then. Display layer joins to `agents` opportunistically
 * and falls back to the raw id when the agent is gone.
 */
function applyMigration16(db: Database): void {
  db.transaction(() => {
    db.run(`CREATE TABLE audit_log (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      kind TEXT NOT NULL,
      actor_agent_id TEXT,
      target_kind TEXT,
      target_id TEXT,
      payload_json TEXT NOT NULL
    )`);
    db.run("CREATE INDEX audit_log_kind_ts ON audit_log(kind, ts DESC)");
    db.run("CREATE INDEX audit_log_actor_ts ON audit_log(actor_agent_id, ts DESC) WHERE actor_agent_id IS NOT NULL");
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (16, ?)", [nowIso()]);
  })();
}

/**
 * v17 — RBAC Phase 4 (WA-087) builtin-grant top-up. Adds any
 * `BUILTIN_ROLE_DEFINITIONS` grants missing from the `role_grants` table
 * for built-in roles. Idempotent: pre-existing rows are left alone, new
 * rows insert. Backfills the `pm.kanban_action:comment_task` +
 * `pm.kanban_action:comment_epic` gap that the v15 seed list missed —
 * without this, hard-mode dispatcher 403s pm on every `comment-kanban-*`
 * call. Note: v17 runs once on the user's DB; future seed-list additions
 * after this slice need their own migration (v18+) reusing this same
 * top-up pattern. Pre-existing extras (e.g. user-added custom grants on
 * a built-in role) are preserved — top-up never deletes.
 */
function applyMigration17(db: Database): void {
  db.transaction(() => {
    for (const def of BUILTIN_ROLE_DEFINITIONS) {
      const role = db.query<{ id: string }, [string]>(
        "SELECT id FROM roles WHERE name = ? AND is_builtin = 1",
      ).get(def.name);
      if (!role) continue;
      for (const grant of def.grants) {
        const scope = grant.scope ?? null;
        const exists = db.query<{ id: string }, [string, string, string, string | null, string | null]>(
          `SELECT id FROM role_grants
            WHERE role_id = ? AND grant_kind = ? AND grant_value = ?
              AND ((scope_qualifier IS NULL AND ? IS NULL) OR scope_qualifier = ?)`,
        ).get(role.id, grant.kind, grant.value, scope, scope);
        if (exists) continue;
        db.run(
          "INSERT INTO role_grants (id, role_id, grant_kind, grant_value, scope_qualifier, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          [randomUUID(), role.id, grant.kind, grant.value, grant.scope ?? null, nowIso()],
        );
      }
    }
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (17, ?)", [nowIso()]);
  })();
}

/**
 * v18 — EP-022 / WA-093: channel family split.
 *
 * Splits the coarse `channel` tool_family into `channel-read` (gates
 * `read_channel_messages` only) + `channel-write` (gates post / reply /
 * broadcast). Closes the `rbac-enforce.ts` special-case skip that let
 * `restricted` read channels without holding any tool_family — the new
 * two-layer rule (family gates visibility, action gates execution)
 * holds without exceptions.
 *
 * Strategy per advisor msg #399 ¶5: top-up / update-in-place, not
 * drop-and-reseed. Custom (non-builtin) role grants on `channel` are
 * preserved by also splitting them into channel-read + channel-write.
 *
 * Steps:
 *   1. For every `(tool_family, channel)` row, insert sibling
 *      `channel-read` + `channel-write` rows on the same role
 *      (idempotent — skip if either already exists).
 *   2. Delete the original `channel` rows.
 *   3. For roles holding `channel_action:read_channel_messages` but no
 *      `tool_family:channel-read` row (i.e. the seed-untouched
 *      `restricted` shape pre-EP-022), insert `channel-read`. This is
 *      what makes the family gate satisfiable for the restricted role
 *      under the new dispatcher rule.
 *
 * Idempotency: re-running the migration after step 2 is a no-op (no
 * `channel` rows to split, sibling rows already present, restricted
 * already has `channel-read`).
 */
function applyMigration18(db: Database): void {
  db.transaction(() => {
    const ts = nowIso();

    // Step 1+2: split every existing `channel` family row into
    // channel-read + channel-write. Custom roles preserved.
    const channelRows = db.query<{ role_id: string }, []>(
      "SELECT role_id FROM role_grants WHERE grant_kind = 'tool_family' AND grant_value = 'channel'",
    ).all();
    for (const row of channelRows) {
      for (const newValue of ["channel-read", "channel-write"]) {
        const exists = db.query<{ id: string }, [string, string]>(
          "SELECT id FROM role_grants WHERE role_id = ? AND grant_kind = 'tool_family' AND grant_value = ?",
        ).get(row.role_id, newValue);
        if (exists) continue;
        db.run(
          "INSERT INTO role_grants (id, role_id, grant_kind, grant_value, scope_qualifier, created_at) VALUES (?, ?, 'tool_family', ?, NULL, ?)",
          [randomUUID(), row.role_id, newValue, ts],
        );
      }
    }
    db.run("DELETE FROM role_grants WHERE grant_kind = 'tool_family' AND grant_value = 'channel'");

    // Step 3: roles with read_channel_messages but no channel-read.
    // Captures the pre-EP-022 `restricted` seed shape (no `channel`
    // family at all) — top-up gives them the new family.
    const readers = db.query<{ role_id: string }, []>(
      `SELECT DISTINCT rg.role_id FROM role_grants rg
        WHERE rg.grant_kind = 'channel_action' AND rg.grant_value = 'read_channel_messages'
          AND NOT EXISTS (
            SELECT 1 FROM role_grants rg2
            WHERE rg2.role_id = rg.role_id
              AND rg2.grant_kind = 'tool_family'
              AND rg2.grant_value = 'channel-read'
          )`,
    ).all();
    for (const row of readers) {
      db.run(
        "INSERT INTO role_grants (id, role_id, grant_kind, grant_value, scope_qualifier, created_at) VALUES (?, ?, 'tool_family', 'channel-read', NULL, ?)",
        [randomUUID(), row.role_id, ts],
      );
    }

    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (18, ?)", [ts]);
  })();
}

/**
 * v19 — EP-024 / WA-110: FTS5 search indexes for direct messages,
 * channel messages, kanban tasks/epics, and their comments.
 */
function applyMigration19(db: Database): void {
  db.transaction(() => {
    const tokenizer = "tokenize = 'unicode61 remove_diacritics 1 tokenchars ''_-'''";
    db.run(`CREATE VIRTUAL TABLE messages_fts USING fts5(body, content='messages', content_rowid='id', ${tokenizer})`);
    db.run(`CREATE VIRTUAL TABLE channel_messages_fts USING fts5(body, content='channel_messages', content_rowid='id', ${tokenizer})`);
    db.run(`CREATE VIRTUAL TABLE kanban_tasks_fts USING fts5(display_id, title, details, content='kanban_tasks', content_rowid='id', ${tokenizer})`);
    db.run(`CREATE VIRTUAL TABLE kanban_epics_fts USING fts5(display_id, title, details, content='kanban_epics', content_rowid='id', ${tokenizer})`);
    db.run(`CREATE VIRTUAL TABLE kanban_comments_fts USING fts5(body, content='kanban_comments', content_rowid='id', ${tokenizer})`);
    db.run(`CREATE VIRTUAL TABLE kanban_epic_comments_fts USING fts5(body, content='kanban_epic_comments', content_rowid='id', ${tokenizer})`);

    db.run(`CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body); END`);
    db.run(`CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.id, old.body); END`);
    db.run(`CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.id, old.body); INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body); END`);

    db.run(`CREATE TRIGGER channel_messages_ai AFTER INSERT ON channel_messages BEGIN INSERT INTO channel_messages_fts(rowid, body) VALUES (new.id, new.body); END`);
    db.run(`CREATE TRIGGER channel_messages_ad AFTER DELETE ON channel_messages BEGIN INSERT INTO channel_messages_fts(channel_messages_fts, rowid, body) VALUES('delete', old.id, old.body); END`);
    db.run(`CREATE TRIGGER channel_messages_au AFTER UPDATE ON channel_messages BEGIN INSERT INTO channel_messages_fts(channel_messages_fts, rowid, body) VALUES('delete', old.id, old.body); INSERT INTO channel_messages_fts(rowid, body) VALUES (new.id, new.body); END`);

    db.run(`CREATE TRIGGER kanban_tasks_ai AFTER INSERT ON kanban_tasks BEGIN INSERT INTO kanban_tasks_fts(rowid, display_id, title, details) VALUES (new.id, new.display_id, new.title, new.details); END`);
    db.run(`CREATE TRIGGER kanban_tasks_ad AFTER DELETE ON kanban_tasks BEGIN INSERT INTO kanban_tasks_fts(kanban_tasks_fts, rowid, display_id, title, details) VALUES('delete', old.id, old.display_id, old.title, old.details); END`);
    db.run(`CREATE TRIGGER kanban_tasks_au AFTER UPDATE ON kanban_tasks BEGIN INSERT INTO kanban_tasks_fts(kanban_tasks_fts, rowid, display_id, title, details) VALUES('delete', old.id, old.display_id, old.title, old.details); INSERT INTO kanban_tasks_fts(rowid, display_id, title, details) VALUES (new.id, new.display_id, new.title, new.details); END`);

    db.run(`CREATE TRIGGER kanban_epics_ai AFTER INSERT ON kanban_epics BEGIN INSERT INTO kanban_epics_fts(rowid, display_id, title, details) VALUES (new.id, new.display_id, new.title, new.details); END`);
    db.run(`CREATE TRIGGER kanban_epics_ad AFTER DELETE ON kanban_epics BEGIN INSERT INTO kanban_epics_fts(kanban_epics_fts, rowid, display_id, title, details) VALUES('delete', old.id, old.display_id, old.title, old.details); END`);
    db.run(`CREATE TRIGGER kanban_epics_au AFTER UPDATE ON kanban_epics BEGIN INSERT INTO kanban_epics_fts(kanban_epics_fts, rowid, display_id, title, details) VALUES('delete', old.id, old.display_id, old.title, old.details); INSERT INTO kanban_epics_fts(rowid, display_id, title, details) VALUES (new.id, new.display_id, new.title, new.details); END`);

    db.run(`CREATE TRIGGER kanban_comments_ai AFTER INSERT ON kanban_comments BEGIN INSERT INTO kanban_comments_fts(rowid, body) VALUES (new.id, new.body); END`);
    db.run(`CREATE TRIGGER kanban_comments_ad AFTER DELETE ON kanban_comments BEGIN INSERT INTO kanban_comments_fts(kanban_comments_fts, rowid, body) VALUES('delete', old.id, old.body); END`);
    db.run(`CREATE TRIGGER kanban_comments_au AFTER UPDATE ON kanban_comments BEGIN INSERT INTO kanban_comments_fts(kanban_comments_fts, rowid, body) VALUES('delete', old.id, old.body); INSERT INTO kanban_comments_fts(rowid, body) VALUES (new.id, new.body); END`);

    db.run(`CREATE TRIGGER kanban_epic_comments_ai AFTER INSERT ON kanban_epic_comments BEGIN INSERT INTO kanban_epic_comments_fts(rowid, body) VALUES (new.id, new.body); END`);
    db.run(`CREATE TRIGGER kanban_epic_comments_ad AFTER DELETE ON kanban_epic_comments BEGIN INSERT INTO kanban_epic_comments_fts(kanban_epic_comments_fts, rowid, body) VALUES('delete', old.id, old.body); END`);
    db.run(`CREATE TRIGGER kanban_epic_comments_au AFTER UPDATE ON kanban_epic_comments BEGIN INSERT INTO kanban_epic_comments_fts(kanban_epic_comments_fts, rowid, body) VALUES('delete', old.id, old.body); INSERT INTO kanban_epic_comments_fts(rowid, body) VALUES (new.id, new.body); END`);

    db.run("INSERT INTO messages_fts(rowid, body) SELECT id, body FROM messages");
    db.run("INSERT INTO channel_messages_fts(rowid, body) SELECT id, body FROM channel_messages");
    db.run("INSERT INTO kanban_tasks_fts(rowid, display_id, title, details) SELECT id, display_id, title, details FROM kanban_tasks");
    db.run("INSERT INTO kanban_epics_fts(rowid, display_id, title, details) SELECT id, display_id, title, details FROM kanban_epics");
    db.run("INSERT INTO kanban_comments_fts(rowid, body) SELECT id, body FROM kanban_comments");
    db.run("INSERT INTO kanban_epic_comments_fts(rowid, body) SELECT id, body FROM kanban_epic_comments");

    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (19, ?)", [nowIso()]);
  })();
}

/**
 * v20 — EP-024 / WA-111: grant channel search to every role that can read
 * channel messages. Search is intentionally a separate channel_action grain.
 */
function applyMigration20(db: Database): void {
  db.transaction(() => {
    const ts = nowIso();
    const readers = db.query<{ role_id: string }, []>(
      `SELECT DISTINCT role_id FROM role_grants
        WHERE grant_kind = 'channel_action' AND grant_value = 'read_channel_messages'
          AND NOT EXISTS (
            SELECT 1 FROM role_grants search
             WHERE search.role_id = role_grants.role_id
               AND search.grant_kind = 'channel_action'
               AND search.grant_value = 'search_channel_messages'
          )`,
    ).all();
    for (const row of readers) {
      db.run(
        "INSERT INTO role_grants (id, role_id, grant_kind, grant_value, scope_qualifier, created_at) VALUES (?, ?, 'channel_action', 'search_channel_messages', NULL, ?)",
        [randomUUID(), row.role_id, ts],
      );
    }
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (20, ?)", [ts]);
  })();
}

/**
 * v21 — EP-030 / WA-136: push-delivery confirmation. Adds the `pushed`
 * intermediate state on the `messages.state` enum, a `pushed_at` timestamp,
 * and a CHECK constraint pinning the legal state set. Existing rows keep
 * their state (no `pending` row is migrated to `pushed`); `pushed_at` is
 * NULL on backfill.
 *
 * The CHECK admits the legacy `acked` and `rejected` states alongside
 * the EP-030 trio (`pending`/`pushed`/`delivered`). Plan §"State machine"
 * specified the trio only; the broader set preserves
 * `sendFleetMessage`'s `state: "rejected"` insert path that predates
 * EP-030. Plan amendment to record.
 */
function applyMigration21(db: Database): void {
  db.run("PRAGMA foreign_keys = OFF");
  try {
    db.transaction(() => {
      // Drop FTS triggers; they reference the `messages` table by name and
      // would mis-fire mid-copy. Recreate at the end against the new table.
      db.run("DROP TRIGGER IF EXISTS messages_ai");
      db.run("DROP TRIGGER IF EXISTS messages_ad");
      db.run("DROP TRIGGER IF EXISTS messages_au");

      db.run(`CREATE TABLE messages_v21_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        from_role_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        to_role_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        from_session_id TEXT,
        to_session_id TEXT,
        from_display TEXT,
        to_display TEXT,
        body TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'pushed', 'delivered', 'acked', 'rejected')),
        sent_at TEXT NOT NULL,
        delivered_at TEXT,
        acked_at TEXT,
        pushed_at TEXT,
        error TEXT,
        delivery_kind TEXT NOT NULL DEFAULT 'direct',
        broadcast_id TEXT
      )`);

      // Some installs reach v21 with the v12-era `roles` FK; SET NULL is the
      // resolved post-EP-DEC-RUN shape. `INSERT...SELECT` ignores the FK
      // because foreign_keys is OFF for the migration window.
      db.run(`INSERT INTO messages_v21_new
        (id, thread_id, from_role_id, to_role_id, from_session_id, to_session_id,
         from_display, to_display, body, state, sent_at, delivered_at, acked_at, pushed_at, error,
         delivery_kind, broadcast_id)
        SELECT id, thread_id, from_role_id, to_role_id, from_session_id, to_session_id,
               from_display, to_display, body, state, sent_at, delivered_at, acked_at, NULL, error,
               COALESCE(delivery_kind, 'direct'), broadcast_id
          FROM messages`);

      db.run("DROP TABLE messages");
      db.run("ALTER TABLE messages_v21_new RENAME TO messages");

      // Recreate FTS triggers (mirrors v19). FTS index content is
      // automatically still pointed at `messages` (rebuild keeps rowid
      // alignment with the AUTOINCREMENT-preserved ids).
      db.run("CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body); END");
      db.run("CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.id, old.body); END");
      db.run("CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.id, old.body); INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body); END");

      db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (21, ?)", [nowIso()]);
    })();
  } finally {
    db.run("PRAGMA foreign_keys = ON");
  }
}

/** v22 — EP-027 / WA-120: migrate Kanban effort to XS/S/M/L/XL buckets. */
function applyMigration22(db: Database): void {
  db.transaction(() => {
    db.run("UPDATE kanban_tasks SET effort = CASE effort WHEN 'Low' THEN 'S' WHEN 'Medium' THEN 'M' WHEN 'High' THEN 'L' ELSE effort END");
    db.run("UPDATE kanban_epics SET effort = CASE effort WHEN 'Low' THEN 'S' WHEN 'Medium' THEN 'M' WHEN 'High' THEN 'L' ELSE effort END");
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (22, ?)", [nowIso()]);
  })();
}

/** v23 — WA-154: short-lived agent session credentials after one-shot bootstrap. */
function applyMigration23(db: Database): void {
  db.transaction(() => {
    db.run(`CREATE TABLE IF NOT EXISTS agent_session_credentials (
      id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      credential_hash TEXT NOT NULL UNIQUE,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      launch_token_id TEXT REFERENCES launch_tokens(id) ON DELETE SET NULL
    )`);
    db.run("CREATE INDEX IF NOT EXISTS agent_session_credentials_session_idx ON agent_session_credentials(role_id, session_id, expires_at)");
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (23, ?)", [nowIso()]);
  })();
}

/**
 * Repair v14's `roles` → `agents` rename for SQLite builds where
 * `ALTER TABLE roles RENAME TO agents` did NOT auto-rewrite the dependent
 * tables' `REFERENCES roles(id)` clauses in `sqlite_master`. SQLite is
 * supposed to do that rewrite when `legacy_alter_table` is OFF (default
 * since 3.25), but Bun's bundled SQLite on macOS hits the legacy-on
 * codepath and leaves the `REFERENCES roles(id)` literal intact.
 *
 * Once v15 introduced a NEW `roles` table for RBAC, every dependent
 * table's FK started resolving against the wrong table — agent UUIDs
 * aren't in the RBAC roles table, so every insert into sessions /
 * runners / kanban / etc. FK-fails.
 *
 * Fix: for each pre-v14 ID-FK table, follow the standard SQLite "change
 * a column FK" recipe — recreate the table with the corrected DDL and
 * copy data over. Bun blocks `PRAGMA writable_schema` mutations on
 * `sqlite_master`, so the in-place REPLACE path is unavailable.
 *
 * We do NOT touch `agent_roles` / `role_grants` / any other RBAC table —
 * those legitimately reference `roles(id)` (the new RBAC `roles` table).
 *
 * Idempotent: tables whose DDL no longer contains `REFERENCES roles(id)`
 * are skipped (the Linux happy-path).
 */
function applyMigration24(db: Database): void {
  // Pre-v14 tables whose `role_id` / `*_role_id` FKs originally pointed
  // at the identity table. Sourced from a Mac DB query and cross-checked
  // against the v1..v13 CREATE TABLE statements in this file.
  const targets = [
    "sessions",
    "agent_locks",
    "permissions",
    "launch_tokens",
    "runners",
    "channel_messages",
    "events",
    "kanban_tasks",
    "kanban_comments",
    "kanban_dependencies",
    "kanban_activity",
    "kanban_notifications",
    "kanban_epics",
    "kanban_epic_comments",
    "kanban_epic_activity",
    "kanban_epic_notifications",
  ];

  db.run("PRAGMA foreign_keys = OFF");
  try {
    db.transaction(() => {
      for (const name of targets) {
        const row = db.query<{ sql: string }, [string]>(
          "SELECT sql FROM sqlite_master WHERE name = ? AND type = 'table'",
        ).get(name);
        if (!row || !row.sql || !row.sql.includes("REFERENCES roles(id)")) continue;

        const tempName = `${name}_v24_new`;
        const newDdl = row.sql
          .replace(
            new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?["\`\\[]?${name}["\`\\]]?`, "i"),
            `CREATE TABLE ${tempName}`,
          )
          .replace(/REFERENCES roles\(id\)/g, "REFERENCES agents(id)");

        const indexes = db.query<{ sql: string }, [string]>(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL",
        ).all(name);

        db.run(newDdl);
        db.run(`INSERT INTO ${tempName} SELECT * FROM ${name}`);
        db.run(`DROP TABLE ${name}`);
        db.run(`ALTER TABLE ${tempName} RENAME TO ${name}`);
        for (const idx of indexes) db.run(idx.sql);
      }
      db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (24, ?)", [nowIso()]);
    })();
  } finally {
    db.run("PRAGMA foreign_keys = ON");
  }
}

/** v25 — EP-037 / WA-214: per-agent persona profile rows. */
function applyMigration25(db: Database): void {
  db.transaction(() => {
    ensureAgentPersonasTable(db);
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (25, ?)", [nowIso()]);
  })();
}

/** Spec §"Default Built-in Roles" → seeded as `is_builtin = 1`. */
const BUILTIN_ROLE_DEFINITIONS: Array<{
  name: string;
  description: string;
  grants: Array<{ kind: string; value: string; scope?: string | null }>;
}> = [
  {
    name: "pm",
    description: "Project manager. Full coordination — task/epic CRUD, all comment types incl verdicts, all channel ops, full audit access.",
    grants: [
      { kind: "tool_family", value: "messaging" },
      { kind: "tool_family", value: "channel-read" },
      { kind: "tool_family", value: "channel-write" },
      { kind: "tool_family", value: "summary" },
      { kind: "tool_family", value: "kanban-read" },
      { kind: "tool_family", value: "kanban-comment" },
      { kind: "tool_family", value: "kanban-status" },
      { kind: "tool_family", value: "kanban-admin" },
      { kind: "kanban_action", value: "create_task" },
      { kind: "kanban_action", value: "create_epic" },
      { kind: "kanban_action", value: "update_task" },
      { kind: "kanban_action", value: "update_epic" },
      // Status mutations: pm holds any-scope (NULL) `update_*_status` grants
      // so the `requireKanbanStatusUpdateInvariant` /
      // `requireKanbanEpicStatusUpdateInvariant` business-rule check (T5 /
      // WA-096) short-circuits — any-scope bypasses the narrow-scope
      // source-state restriction. Missing these grants would 403 every
      // pm status move under enforce.
      { kind: "kanban_action", value: "update_task_status" },
      { kind: "kanban_action", value: "update_epic_status" },
      { kind: "kanban_action", value: "archive_task" },
      { kind: "kanban_action", value: "archive_epic" },
      { kind: "kanban_action", value: "request_epic_close" },
      { kind: "kanban_action", value: "cancel_epic_close" },
      // Comment authorship — pm holds any-scope comment_task / comment_epic
      // so they can comment on tasks they didn't create or aren't assigned
      // to. Without these, the dispatcher 403s pm on every comment-kanban-*
      // call under hard enforcement (WA-087 surfaces this seed gap).
      { kind: "kanban_action", value: "comment_task" },
      { kind: "kanban_action", value: "comment_epic" },
      { kind: "comment_type", value: "progress" },
      { kind: "comment_type", value: "note" },
      { kind: "comment_type", value: "blocker" },
      { kind: "comment_type", value: "verdict_go" },
      { kind: "comment_type", value: "verdict_no_go" },
      { kind: "comment_type", value: "verdict_needs_revision" },
      { kind: "channel_action", value: "post_channel_message" },
      { kind: "channel_action", value: "reply_channel_thread" },
      { kind: "channel_action", value: "read_channel_messages" },
      { kind: "channel_action", value: "search_channel_messages" },
      { kind: "channel_action", value: "broadcast_message" },
      { kind: "audit_grant", value: "audit_read" },
      { kind: "audit_grant", value: "audit_admin" },
    ],
  },
  {
    name: "engineer",
    description: "Worker / implementer. Acts on assignments — status transitions and comments scoped to own assignment or self-created.",
    grants: [
      { kind: "tool_family", value: "messaging" },
      { kind: "tool_family", value: "channel-read" },
      { kind: "tool_family", value: "channel-write" },
      { kind: "tool_family", value: "summary" },
      { kind: "tool_family", value: "kanban-read" },
      { kind: "tool_family", value: "kanban-comment" },
      { kind: "tool_family", value: "kanban-status" },
      { kind: "kanban_action", value: "update_task_status", scope: "own_assignment" },
      // Engineer-as-assignee can drive epic status moves on their assigned
      // epics + the close-approval workflow. The narrow-scope (own_assignment)
      // grant is paired with the `requireKanbanEpicStatusUpdateInvariant` /
      // `requireKanbanEpicCloseRequestInvariant` enforce-mode check (T5 /
      // WA-096) which permits the move only when the assignee is acting on
      // an epic in an active source state (Queued, In Progress, Blocked,
      // Review). Without these grants the dispatcher would 403 every
      // assignee status move under enforce.
      { kind: "kanban_action", value: "update_epic_status", scope: "own_assignment" },
      { kind: "kanban_action", value: "request_epic_close", scope: "own_assignment" },
      { kind: "kanban_action", value: "cancel_epic_close", scope: "own_assignment" },
      { kind: "kanban_action", value: "comment_task", scope: "own_assignment" },
      { kind: "kanban_action", value: "comment_task", scope: "created_by_self" },
      { kind: "comment_type", value: "progress" },
      { kind: "comment_type", value: "note" },
      { kind: "comment_type", value: "blocker" },
      { kind: "channel_action", value: "post_channel_message" },
      { kind: "channel_action", value: "reply_channel_thread" },
      { kind: "channel_action", value: "read_channel_messages" },
      { kind: "channel_action", value: "search_channel_messages" },
    ],
  },
  {
    name: "reviewer",
    description: "Reviews work; can post structured verdicts. Typically composed with `engineer` so reviewers can pick up tasks.",
    grants: [
      { kind: "tool_family", value: "messaging" },
      { kind: "tool_family", value: "channel-read" },
      { kind: "tool_family", value: "channel-write" },
      { kind: "tool_family", value: "summary" },
      { kind: "tool_family", value: "kanban-read" },
      { kind: "tool_family", value: "kanban-comment" },
      { kind: "kanban_action", value: "comment_task" },
      { kind: "kanban_action", value: "comment_epic" },
      { kind: "comment_type", value: "progress" },
      { kind: "comment_type", value: "note" },
      { kind: "comment_type", value: "blocker" },
      { kind: "comment_type", value: "verdict_go" },
      { kind: "comment_type", value: "verdict_no_go" },
      { kind: "comment_type", value: "verdict_needs_revision" },
      { kind: "channel_action", value: "post_channel_message" },
      { kind: "channel_action", value: "reply_channel_thread" },
      { kind: "channel_action", value: "read_channel_messages" },
      { kind: "channel_action", value: "search_channel_messages" },
      { kind: "audit_grant", value: "audit_read" },
    ],
  },
  {
    name: "researcher",
    description: "Read-and-advise; no status changes. Comments only, no verdicts.",
    grants: [
      { kind: "tool_family", value: "messaging" },
      { kind: "tool_family", value: "channel-read" },
      { kind: "tool_family", value: "channel-write" },
      { kind: "tool_family", value: "summary" },
      { kind: "tool_family", value: "kanban-read" },
      { kind: "tool_family", value: "kanban-comment" },
      { kind: "kanban_action", value: "comment_task" },
      { kind: "kanban_action", value: "comment_epic" },
      { kind: "comment_type", value: "progress" },
      { kind: "comment_type", value: "note" },
      { kind: "comment_type", value: "blocker" },
      { kind: "channel_action", value: "post_channel_message" },
      { kind: "channel_action", value: "reply_channel_thread" },
      { kind: "channel_action", value: "read_channel_messages" },
      { kind: "channel_action", value: "search_channel_messages" },
    ],
  },
  {
    name: "restricted",
    description: "Minimum viable participation. Read-only across kanban + channels; for sandboxed exploration agents.",
    grants: [
      { kind: "tool_family", value: "summary" },
      { kind: "tool_family", value: "kanban-read" },
      // EP-022 / WA-093: restricted now has explicit `channel-read` family
      // so the two-layer rule (family gates visibility, action gates
      // execution) holds without exceptions. Pre-EP-022 the rbac-enforce
      // dispatcher carried a special-case skip on `read-channel-messages`
      // so this role could read without `channel` family — that skip is
      // gone. Restricted does NOT get `channel-write`.
      { kind: "tool_family", value: "channel-read" },
      { kind: "channel_action", value: "read_channel_messages" },
      { kind: "channel_action", value: "search_channel_messages" },
    ],
  },
  {
    name: "operator",
    description: "Operator surrogate. Marks the agent as the human-facing operator (typically `human-web` or workspace main); active-push permission gates on this. Additive — compose with another role.",
    grants: [
      { kind: "meta", value: "is_operator_surrogate" },
    ],
  },
];

function seedBuiltinRolesAndGrants(db: Database): void {
  const ts = nowIso();
  for (const def of BUILTIN_ROLE_DEFINITIONS) {
    const roleId = randomUUID();
    db.run(
      "INSERT INTO roles (id, name, description, is_builtin, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
      [roleId, def.name, def.description, ts, ts],
    );
    for (const grant of def.grants) {
      db.run(
        "INSERT INTO role_grants (id, role_id, grant_kind, grant_value, scope_qualifier, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [randomUUID(), roleId, grant.kind, grant.value, grant.scope ?? null, ts],
      );
    }
  }
}

/**
 * Spec §"Default agent → role assignments (migration seed)" — seed
 * `agent_roles` for every existing agents row using the name → roles map:
 * - `main` → `pm`, `operator`
 * - `worker` → `engineer`
 * - `advisor` → `reviewer`, `engineer`
 * - `researcher` → `researcher`
 * - `human-web` → `pm`, `operator`
 * - any other name → `engineer`
 *
 * Users can edit assignments after migration via the Phase 3 UI/API.
 */
/** Built-in agent-name → default RBAC role names. Spec L221-229. Used by
 * the v15 migration to seed pre-existing agents AND by `daoInsertRole`
 * (Phase 4) to auto-seed agents created post-migration so they have a
 * sensible grant set at first launch. Web UI's add-agent dialog reads
 * the same map (`NAME_DEFAULTS_FOR_NEW_AGENT` in `src/web/client/agents.ts`)
 * so the picker pre-checks the chips for the operator. */
const AGENT_NAME_ROLE_DEFAULTS: Record<string, readonly string[]> = {
  main: ["pm", "operator"],
  worker: ["engineer"],
  advisor: ["reviewer", "engineer"],
  researcher: ["researcher"],
  "human-web": ["pm", "operator"],
};
const AGENT_ROLE_FALLBACK: readonly string[] = ["engineer"];

function defaultRoleNamesForAgent(agentName: string): readonly string[] {
  return AGENT_NAME_ROLE_DEFAULTS[agentName] ?? AGENT_ROLE_FALLBACK;
}

/** Assign default RBAC roles to a single agent using the name-default
 * map. No-op if the agent already has assignments. Called by
 * `daoInsertRole` so newly-created agents (CLI, smoke, raw-create) carry
 * a usable grant set under Phase 4 hard enforcement. The web UI's
 * "Roles" picker subsequently overrides via PUT
 * `/api/v1/workspaces/:id/agents/:agentId/roles`. */
export function assignDefaultRolesForAgent(db: Database, agentId: string, agentName: string): void {
  const existing = db.query<{ count: number }, [string]>(
    "SELECT COUNT(*) AS count FROM agent_roles WHERE agent_id = ?",
  ).get(agentId);
  if ((existing?.count ?? 0) > 0) return;
  const roleNames = defaultRoleNamesForAgent(agentName);
  if (roleNames.length === 0) return;
  const ts = nowIso();
  for (const roleName of roleNames) {
    const row = db.query<{ id: string }, [string]>(
      "SELECT id FROM roles WHERE name = ? AND is_builtin = 1",
    ).get(roleName);
    if (!row) continue;
    db.run(
      "INSERT INTO agent_roles (agent_id, role_id, assigned_at) VALUES (?, ?, ?)",
      [agentId, row.id, ts],
    );
  }
}

function seedAgentRolesByNameMap(db: Database): void {
  for (const agent of db.query<{ id: string; name: string }, []>(
    "SELECT id, name FROM agents",
  ).all()) {
    assignDefaultRolesForAgent(db, agent.id, agent.name);
  }
}

function repairCurrentSchema(db: Database): void {
  db.transaction(() => {
    ensurePeerPolicyRulesTable(db);
    ensureMessageDeliveryColumns(db);
    ensureChannelTables(db);
    ensureKanbanTables(db);
    ensureKanbanEpicSchema(db);
    ensureKanbanEpicNotificationSchema(db);
    ensureAgentPersonasTable(db);
    ensureAgentSessionCredentialsTable(db);
    backfillDeliveredMessagesAsRead(db);
  })();
}

function ensureAgentPersonasTable(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS agent_personas (
    agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    description TEXT NOT NULL DEFAULT '',
    responsibilities TEXT NOT NULL DEFAULT '',
    boundaries TEXT NOT NULL DEFAULT '',
    skills TEXT NOT NULL DEFAULT '',
    working_style TEXT NOT NULL DEFAULT '',
    extra_prompt TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
}

function ensureAgentSessionCredentialsTable(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS agent_session_credentials (
    id TEXT PRIMARY KEY,
    role_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    credential_hash TEXT NOT NULL UNIQUE,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    launch_token_id TEXT REFERENCES launch_tokens(id) ON DELETE SET NULL
  )`);
  db.run("CREATE INDEX IF NOT EXISTS agent_session_credentials_session_idx ON agent_session_credentials(role_id, session_id, expires_at)");
}

function ensurePeerPolicyRulesTable(db: Database): void {
  // Post-RBAC-Phase-1: reference `agents`. Existing rows untouched (the FK
  // arrow on already-created tables was rewritten in sqlite_master by
  // migration 14 already; this string is for fresh-install / IF NOT EXISTS
  // fallback paths only).
  db.run(`CREATE TABLE IF NOT EXISTS peer_policy_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_a_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    role_b_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    UNIQUE(role_a_id, role_b_id)
  )`);
}

function ensureMessageDeliveryColumns(db: Database): void {
  addColumnIfMissing(db, "messages", "delivery_kind", "TEXT NOT NULL DEFAULT 'direct'");
  addColumnIfMissing(db, "messages", "broadcast_id", "TEXT");
}

function ensureChannelTables(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS channel_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    from_role_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    from_session_id TEXT,
    body TEXT NOT NULL,
    parent_message_id INTEGER REFERENCES channel_messages(id),
    root_message_id INTEGER REFERENCES channel_messages(id),
    sent_at TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS channel_reads (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    last_message_id INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(channel_id, role_id)
  )`);
  db.run(
    "INSERT INTO channels (id, name, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
    [DEFAULT_CHANNEL_ID, DEFAULT_CHANNEL_NAME, nowIso()],
  );
}

function ensureKanbanTables(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS kanban_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    display_id TEXT NOT NULL UNIQUE,
    sequence INTEGER NOT NULL UNIQUE,
    title TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    effort TEXT NOT NULL,
    created_by_role_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    assigned_role_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    github_url TEXT,
    github_number INTEGER,
    github_title TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    archived_at TEXT,
    archived_by_role_id TEXT REFERENCES agents(id) ON DELETE SET NULL
  )`);
  db.run("CREATE INDEX IF NOT EXISTS kanban_tasks_status_idx ON kanban_tasks(status)");
  db.run("CREATE INDEX IF NOT EXISTS kanban_tasks_assigned_role_idx ON kanban_tasks(assigned_role_id)");
  db.run("CREATE INDEX IF NOT EXISTS kanban_tasks_created_by_role_idx ON kanban_tasks(created_by_role_id)");
  db.run("CREATE INDEX IF NOT EXISTS kanban_tasks_archived_idx ON kanban_tasks(archived_at)");

  db.run(`CREATE TABLE IF NOT EXISTS kanban_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    session_id TEXT,
    type TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  db.run("CREATE INDEX IF NOT EXISTS kanban_comments_task_idx ON kanban_comments(task_id, id)");

  db.run(`CREATE TABLE IF NOT EXISTS kanban_dependencies (
    task_id INTEGER NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
    depends_on_task_id INTEGER NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
    created_by_role_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    PRIMARY KEY(task_id, depends_on_task_id),
    CHECK(task_id != depends_on_task_id)
  )`);
  db.run("CREATE INDEX IF NOT EXISTS kanban_dependencies_depends_on_idx ON kanban_dependencies(depends_on_task_id)");

  db.run(`CREATE TABLE IF NOT EXISTS kanban_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    session_id TEXT,
    action TEXT NOT NULL,
    field TEXT,
    before_json TEXT,
    after_json TEXT,
    created_at TEXT NOT NULL
  )`);
  db.run("CREATE INDEX IF NOT EXISTS kanban_activity_task_idx ON kanban_activity(task_id, id)");

  db.run(`CREATE TABLE IF NOT EXISTS kanban_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
    to_role_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    actor_role_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    activity_id INTEGER REFERENCES kanban_activity(id) ON DELETE SET NULL,
    comment_id INTEGER REFERENCES kanban_comments(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    delivered_at TEXT,
    read_at TEXT
  )`);
  db.run("CREATE INDEX IF NOT EXISTS kanban_notifications_to_role_idx ON kanban_notifications(to_role_id, read_at, id)");
}

function ensureKanbanEpicSchema(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS kanban_epics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    display_id TEXT NOT NULL UNIQUE,
    sequence INTEGER NOT NULL UNIQUE,
    title TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    effort TEXT NOT NULL,
    created_by_role_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    assigned_role_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    github_url TEXT,
    github_number INTEGER,
    github_title TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    archived_at TEXT,
    archived_by_role_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    close_approval_status TEXT NOT NULL DEFAULT 'none',
    close_approval_requested_at TEXT,
    close_approval_requested_by_role_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    close_approval_approved_at TEXT,
    close_approval_approved_by TEXT
  )`);
  db.run("CREATE INDEX IF NOT EXISTS kanban_epics_status_idx ON kanban_epics(status)");
  db.run("CREATE INDEX IF NOT EXISTS kanban_epics_assigned_role_idx ON kanban_epics(assigned_role_id)");
  db.run("CREATE INDEX IF NOT EXISTS kanban_epics_created_by_role_idx ON kanban_epics(created_by_role_id)");
  db.run("CREATE INDEX IF NOT EXISTS kanban_epics_archived_idx ON kanban_epics(archived_at)");

  addColumnIfMissing(db, "kanban_tasks", "epic_id", "INTEGER REFERENCES kanban_epics(id) ON DELETE RESTRICT");
  db.run("CREATE INDEX IF NOT EXISTS kanban_tasks_epic_idx ON kanban_tasks(epic_id)");
}

function ensureKanbanEpicNotificationSchema(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS kanban_epic_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    epic_id INTEGER NOT NULL REFERENCES kanban_epics(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    session_id TEXT,
    type TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  db.run("CREATE INDEX IF NOT EXISTS kanban_epic_comments_epic_idx ON kanban_epic_comments(epic_id, id)");

  db.run(`CREATE TABLE IF NOT EXISTS kanban_epic_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    epic_id INTEGER NOT NULL REFERENCES kanban_epics(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    session_id TEXT,
    action TEXT NOT NULL,
    field TEXT,
    before_json TEXT,
    after_json TEXT,
    created_at TEXT NOT NULL
  )`);
  db.run("CREATE INDEX IF NOT EXISTS kanban_epic_activity_epic_idx ON kanban_epic_activity(epic_id, id)");

  db.run(`CREATE TABLE IF NOT EXISTS kanban_epic_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    epic_id INTEGER NOT NULL REFERENCES kanban_epics(id) ON DELETE CASCADE,
    to_role_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    actor_role_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    activity_id INTEGER REFERENCES kanban_epic_activity(id) ON DELETE SET NULL,
    comment_id INTEGER REFERENCES kanban_epic_comments(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    delivered_at TEXT,
    read_at TEXT
  )`);
  db.run("CREATE INDEX IF NOT EXISTS kanban_epic_notifications_to_role_idx ON kanban_epic_notifications(to_role_id, read_at, id)");
}

function backfillDeliveredMessagesAsRead(db: Database): void {
  db.run(
    `UPDATE messages
     SET acked_at = delivered_at
     WHERE state = 'delivered'
       AND delivered_at IS NOT NULL
       AND acked_at IS NULL
       AND COALESCE(delivery_kind, 'direct') != 'channel'`,
  );
}

function addColumnIfMissing(db: Database, table: string, column: string, definition: string): void {
  const columns = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function renameRole(db: Database, oldName: string, newName: string): AgentRow {
  if (!oldName || !newName) throw new Error("oldName and newName are required");
  if (oldName === newName) {
    const role = getRoleByName(db, oldName);
    if (!role) throw new Error(`role not found: ${oldName}`);
    return role;
  }
  const ts = nowIso();
  const target = getRoleByName(db, oldName);
  if (!target) throw new Error(`role not found: ${oldName}`);
  if (getRoleByName(db, newName)) throw new Error(`role "${newName}" already exists`);
  db.run("UPDATE agents SET name = ?, updated_at = ? WHERE name = ?", [newName, ts, oldName]);
  const renamed = getRoleByName(db, newName);
  if (!renamed) throw new Error(`rename failed: ${oldName} -> ${newName}`);
  return renamed;
}

export function listAgents(db: Database): AgentRow[] {
  return db.query<AgentRow, []>(
    `${agentSelectSql()} ORDER BY p.name ASC, r.name ASC`,
  ).all();
}

/**
 * Legacy by-name lookup (pre-decoupling). Names are no longer workspace-unique
 * — they're scoped by `(repo_id, name)` — so this returns the first match
 * sorted by repo name. Callers that need disambiguation should use
 * `getRoleByDisplayId(db, "repo:role")` from `workspace-decoupling-dao.ts`.
 * This function exists as a compat shim for the legacy snapshot/runner-
 * reconcile paths until WA-066 (EP-DEC-2) lands the new role API.
 */
export function getRoleByName(db: Database, name: string): AgentRow | null {
  return db.query<AgentRow, [string]>(
    `${agentSelectSql()} WHERE r.name = ? ORDER BY p.name ASC LIMIT 1`,
  ).get(name) ?? null;
}

export function listRunningSessionDetails(db: Database): RunningSessionDetail[] {
  return db.query<RunningSessionDetail, []>(
    `SELECT sessions.role_id, roles.name AS role_name, sessions.id AS session_id,
            sessions.host_type, sessions.status, sessions.cwd, sessions.started_at,
            sessions.last_seen, sessions.summary
     FROM sessions
     JOIN agents AS roles ON roles.id = sessions.role_id
     WHERE sessions.status = 'running'
     ORDER BY sessions.last_seen DESC`,
  ).all();
}

export function getSetting(db: Database, key: string): string | null {
  return db.query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? null;
}

export function setSetting(db: Database, key: string, value: string): void {
  db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, nowIso()],
  );
}

export function getPolicyMode(db: Database): PolicyMode {
  return normalizePolicyMode(getSetting(db, POLICY_MODE_KEY));
}

export function setPolicyMode(db: Database, value: unknown): PolicyMode {
  const mode = normalizePolicyMode(value);
  setSetting(db, POLICY_MODE_KEY, mode);
  return mode;
}

export function getPeerPolicySettings(db: Database): PeerPolicySettings {
  return { mode: getPeerRuleMode(db), rules: listPeerRules(db) };
}

export function getPeerRuleMode(db: Database): PeerRuleMode {
  return normalizePeerRuleMode(getSetting(db, PEER_RULE_MODE_KEY));
}

export function setPeerRuleMode(db: Database, value: unknown): PeerRuleMode {
  const mode = normalizePeerRuleMode(value);
  setSetting(db, PEER_RULE_MODE_KEY, mode);
  return mode;
}

export function listPeerRules(db: Database): PeerRuleRow[] {
  return db.query<PeerRuleRow, []>(peerRuleSelectSql("ORDER BY role_a.name ASC, role_b.name ASC")).all();
}

export function addPeerRule(db: Database, roleAId: string, roleBId: string): PeerRuleRow {
  const [a, b] = normalizePeerPair(roleAId, roleBId);
  db.run(
    `INSERT INTO peer_policy_rules (role_a_id, role_b_id, created_at) VALUES (?, ?, ?)
     ON CONFLICT(role_a_id, role_b_id) DO NOTHING`,
    [a, b, nowIso()],
  );
  const rule = getPeerRuleByPair(db, a, b);
  if (!rule) throw new Error("failed to add peer rule");
  return rule;
}

export function removePeerRule(db: Database, id: number): void {
  db.run("DELETE FROM peer_policy_rules WHERE id = ?", [Math.floor(Number(id))]);
}

export function peerRuleExists(db: Database, roleAId: string, roleBId: string): boolean {
  const [a, b] = normalizePeerPair(roleAId, roleBId);
  return Boolean(db.query<{ id: number }, [string, string]>("SELECT id FROM peer_policy_rules WHERE role_a_id = ? AND role_b_id = ?").get(a, b));
}

function getPeerRuleByPair(db: Database, roleAId: string, roleBId: string): PeerRuleRow | null {
  return db.query<PeerRuleRow, [string, string]>(peerRuleSelectSql("WHERE peer_policy_rules.role_a_id = ? AND peer_policy_rules.role_b_id = ?")).get(roleAId, roleBId) ?? null;
}

function normalizePeerPair(roleAId: string, roleBId: string): [string, string] {
  if (!roleAId || !roleBId) throw new Error("both roles are required");
  if (roleAId === roleBId) throw new Error("peer rule roles must be different");
  return roleAId < roleBId ? [roleAId, roleBId] : [roleBId, roleAId];
}

export function ensureDefaultChannel(db: Database): ChannelRow {
  db.run(
    "INSERT INTO channels (id, name, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
    [DEFAULT_CHANNEL_ID, DEFAULT_CHANNEL_NAME, nowIso()],
  );
  const channel = getChannelById(db, DEFAULT_CHANNEL_ID);
  if (!channel) throw new Error("default channel is missing");
  return channel;
}

export function listChannels(db: Database): ChannelRow[] {
  ensureDefaultChannel(db);
  return db.query<ChannelRow, []>("SELECT id, name, created_at FROM channels ORDER BY name ASC").all();
}

export function getChannelById(db: Database, id: string): ChannelRow | null {
  return db.query<ChannelRow, [string]>("SELECT id, name, created_at FROM channels WHERE id = ?").get(id) ?? null;
}

export function postChannelMessage(db: Database, input: ChannelMessageInput): ChannelMessageRow {
  const body = String(input.body ?? "").trim();
  if (!body) throw new Error("body is required");
  const channel = input.channelId ? getChannelById(db, input.channelId) : ensureDefaultChannel(db);
  if (!channel) throw new Error(`Unknown channel: ${input.channelId}`);
  let parentMessageId: number | null = null;
  if (input.parentMessageId != null) {
    parentMessageId = Math.floor(Number(input.parentMessageId));
    if (!Number.isFinite(parentMessageId) || parentMessageId <= 0) throw new Error("parentMessageId must be a positive integer");
  }
  let insertedId = 0;

  db.transaction(() => {
    let rootMessageId: number | null = null;
    if (parentMessageId) {
      const parent = getChannelMessageById(db, parentMessageId);
      if (!parent || parent.channel_id !== channel.id) throw new Error("parent channel message was not found");
      rootMessageId = parent.root_message_id ?? parent.id;
    }
    // Human-origin sends carry no `fromRoleId`. Stamp `from_display =
    // 'human-web'` mirroring the DM messaging path so the channel
    // SELECT's COALESCE picks it up instead of falling through to
    // '(deleted)'. Without this, the channel-mode UI rendered every
    // human-originated message as "(deleted)".
    const fromDisplay = computeRoleDisplay(db, input.fromRoleId) ?? (input.fromRoleId ? null : "human-web");
    const result = db.query<unknown, [string, string | null, string | null, string | null, string, number | null, number | null, string]>(
      `INSERT INTO channel_messages (channel_id, from_role_id, from_session_id, from_display, body, parent_message_id, root_message_id, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    ).get(channel.id, input.fromRoleId, input.fromSessionId, fromDisplay, body, parentMessageId, rootMessageId, nowIso()) as { id: number } | null;
    if (!result) throw new Error("failed to insert channel message");
    insertedId = result.id;
    if (!rootMessageId) db.run("UPDATE channel_messages SET root_message_id = ? WHERE id = ?", [insertedId, insertedId]);
    if (input.fromRoleId) advanceChannelReadCursor(db, input.fromRoleId, channel.id, insertedId);
  })();

  const message = getChannelMessageById(db, insertedId);
  if (!message) throw new Error("inserted channel message was not found");
  return message;
}

export function getChannelMessageById(db: Database, id: number): ChannelMessageRow | null {
  return db.query<ChannelMessageRow, [number]>(channelMessageSelectSql("WHERE channel_messages.id = ?")).get(Math.floor(Number(id))) ?? null;
}

export function listChannelMessages(db: Database, opts: { channelId?: string; limit?: number; sinceId?: number; beforeId?: number; latest?: boolean } = {}): ChannelMessageRow[] {
  ensureDefaultChannel(db);
  const limit = Math.max(1, Math.min(500, Math.floor(opts.limit ?? 100)));
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (opts.channelId) {
    clauses.push("channel_messages.channel_id = ?");
    params.push(opts.channelId);
  }
  const sinceId = Math.floor(Number(opts.sinceId ?? 0));
  const beforeId = Math.floor(Number(opts.beforeId ?? 0));
  if (sinceId > 0) {
    clauses.push("channel_messages.id > ?");
    params.push(sinceId);
  }
  if (beforeId > 0) {
    clauses.push("channel_messages.id < ?");
    params.push(beforeId);
  }
  const latest = Boolean(opts.latest) && sinceId <= 0;
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const order = latest ? "ORDER BY channel_messages.id DESC" : "ORDER BY channel_messages.id ASC";
  const rows = db.query<ChannelMessageRow, Array<string | number>>(channelMessageSelectSql(`${where} ${order} LIMIT ?`)).all(...params, limit);
  return latest ? rows.reverse() : rows;
}

export function listUnreadChannelMessages(db: Database, roleId: string, limit = 50): ChannelMessageRow[] {
  ensureDefaultChannel(db);
  const rows = db.query<{ id: number }, [string, string, number]>(
    `SELECT channel_messages.id
     FROM channel_messages
     LEFT JOIN channel_reads ON channel_reads.channel_id = channel_messages.channel_id AND channel_reads.role_id = ?
     WHERE channel_messages.id > COALESCE(channel_reads.last_message_id, 0)
       AND (channel_messages.from_role_id IS NULL OR channel_messages.from_role_id != ?)
     ORDER BY channel_messages.id ASC LIMIT ?`,
  ).all(roleId, roleId, Math.max(1, Math.min(100, Math.floor(limit))));
  return rows.map((row) => getChannelMessageById(db, row.id)).filter((row): row is ChannelMessageRow => Boolean(row));
}

export function markChannelMessagesRead(db: Database, roleId: string, messageIds: number[]): ChannelMessageRow[] {
  const ids = [...new Set(messageIds.map((id) => Math.floor(Number(id))).filter((id) => Number.isFinite(id) && id > 0))];
  if (ids.length === 0) return [];
  const messages = ids
    .map((id) => getChannelMessageById(db, id))
    .filter((row): row is ChannelMessageRow => Boolean(row && row.from_role_id !== roleId));
  const maxByChannel = new Map<string, number>();
  for (const message of messages) maxByChannel.set(message.channel_id, Math.max(maxByChannel.get(message.channel_id) ?? 0, message.id));
  db.transaction(() => {
    for (const [channelId, lastMessageId] of maxByChannel) advanceChannelReadCursor(db, roleId, channelId, lastMessageId);
  })();
  return messages;
}

export function markRoleJoinedChannel(db: Database, roleId: string, channelId = DEFAULT_CHANNEL_ID): number {
  const channel = channelId === DEFAULT_CHANNEL_ID ? ensureDefaultChannel(db) : getChannelById(db, channelId);
  if (!channel) throw new Error(`Unknown channel: ${channelId}`);
  const latest = db.query<{ id: number | null }, [string]>("SELECT MAX(id) AS id FROM channel_messages WHERE channel_id = ?").get(channel.id)?.id ?? 0;
  const lastMessageId = Math.max(0, Math.floor(Number(latest ?? 0)));
  advanceChannelReadCursor(db, roleId, channel.id, lastMessageId);
  return lastMessageId;
}

export function deliverUnreadChannelMessages(db: Database, roleId: string, limit = 50): ChannelMessageRow[] {
  const messages = listUnreadChannelMessages(db, roleId, limit);
  markChannelMessagesRead(db, roleId, messages.map((message) => message.id));
  return messages;
}

export function channelMessageToInboxRow(message: ChannelMessageRow, recipient: AgentRow, recipientSessionId: string | null, state: MessageState): MessageRow {
  return {
    id: message.id,
    thread_id: `channel:${message.channel_id}`,
    from_role_id: message.from_role_id,
    from_role_name: message.from_role_name,
    to_role_id: recipient.id,
    to_role_name: recipient.name,
    from_session_id: message.from_session_id,
    to_session_id: recipientSessionId,
    body: message.body,
    state,
    delivery_kind: "channel",
    broadcast_id: null,
    channel_id: message.channel_id,
    channel_name: message.channel_name,
    parent_message_id: message.parent_message_id,
    root_message_id: message.root_message_id,
    sent_at: message.sent_at,
    delivered_at: state === "delivered" ? nowIso() : null,
    acked_at: null,
    pushed_at: null,
    error: null,
  };
}

export function kanbanNotificationToInboxRow(notification: KanbanNotificationRow, recipient: AgentRow, recipientSessionId: string | null, state: MessageState): MessageRow {
  return {
    id: notification.id,
    thread_id: `kanban:${notification.task_display_id}`,
    from_role_id: notification.actor_role_id,
    from_role_name: notification.actor_role_name,
    to_role_id: recipient.id,
    to_role_name: recipient.name,
    from_session_id: null,
    to_session_id: recipientSessionId,
    body: notification.body,
    state,
    delivery_kind: "kanban",
    broadcast_id: null,
    sent_at: notification.created_at,
    delivered_at: notification.delivered_at,
    acked_at: notification.read_at,
    pushed_at: null,
    error: null,
    kanban_notification_id: notification.id,
    kanban_task_id: notification.task_id,
    kanban_task_display_id: notification.task_display_id,
    kanban_event_type: notification.event_type,
  };
}

export function kanbanEpicNotificationToInboxRow(notification: KanbanEpicNotificationRow, recipient: AgentRow, recipientSessionId: string | null, state: MessageState): MessageRow {
  return {
    id: notification.id,
    thread_id: `kanban-epic:${notification.epic_display_id}`,
    from_role_id: notification.actor_role_id,
    from_role_name: notification.actor_role_name,
    to_role_id: recipient.id,
    to_role_name: recipient.name,
    from_session_id: null,
    to_session_id: recipientSessionId,
    body: notification.body,
    state,
    delivery_kind: "kanban",
    broadcast_id: null,
    sent_at: notification.created_at,
    delivered_at: notification.delivered_at,
    acked_at: notification.read_at,
    pushed_at: null,
    error: null,
    kanban_epic_notification_id: notification.id,
    kanban_epic_id: notification.epic_id,
    kanban_epic_display_id: notification.epic_display_id,
    kanban_event_type: notification.event_type,
  };
}

function advanceChannelReadCursor(db: Database, roleId: string, channelId: string, lastMessageId: number): void {
  db.run(
    `INSERT INTO channel_reads (channel_id, role_id, last_message_id, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(channel_id, role_id) DO UPDATE SET
       last_message_id = MAX(channel_reads.last_message_id, excluded.last_message_id),
       updated_at = excluded.updated_at`,
    [channelId, roleId, Math.max(0, Math.floor(Number(lastMessageId))), nowIso()],
  );
}

export function getKanbanSettings(db: Database): KanbanSettings {
  return {
    taskIdPrefix: normalizeKanbanTaskIdPrefix(getSetting(db, KANBAN_TASK_ID_PREFIX_KEY), DEFAULT_KANBAN_TASK_ID_PREFIX),
    epicIdPrefix: normalizeKanbanEpicIdPrefix(getSetting(db, KANBAN_EPIC_ID_PREFIX_KEY), DEFAULT_KANBAN_EPIC_ID_PREFIX),
  };
}

export function setKanbanSettings(db: Database, input: unknown): KanbanSettings {
  const value = input && typeof input === "object" ? input as Partial<{ taskIdPrefix: unknown; epicIdPrefix: unknown }> : {};
  const current = getKanbanSettings(db);
  const taskIdPrefix = value.taskIdPrefix === undefined
    ? current.taskIdPrefix
    : normalizeKanbanTaskIdPrefix(value.taskIdPrefix, DEFAULT_KANBAN_TASK_ID_PREFIX);
  const epicIdPrefix = value.epicIdPrefix === undefined
    ? current.epicIdPrefix
    : normalizeKanbanEpicIdPrefix(value.epicIdPrefix, DEFAULT_KANBAN_EPIC_ID_PREFIX);
  setSetting(db, KANBAN_TASK_ID_PREFIX_KEY, taskIdPrefix);
  setSetting(db, KANBAN_EPIC_ID_PREFIX_KEY, epicIdPrefix);
  return { taskIdPrefix, epicIdPrefix };
}

export function createKanbanTask(db: Database, input: KanbanTaskInput): KanbanTaskRow {
  const title = normalizeRequiredText(input.title, "title", 500);
  const details = normalizeOptionalText(input.details, 16_000);
  const status = normalizeKanbanStatus(input.status ?? "Backlog");
  const priority = normalizeKanbanPriority(input.priority ?? "P2");
  const effort = normalizeKanbanEffort(input.effort ?? "M");
  const githubUrl = normalizeNullableHttpUrl(input.githubUrl, 2000, "githubUrl");
  const githubTitle = normalizeNullableText(input.githubTitle, 500);
  const githubNumber = normalizeNullableInteger(input.githubNumber, "githubNumber");
  const epicId = input.epicId === undefined ? null : resolveKanbanEpicLinkId(db, input.epicId);
  let insertedId = 0;

  db.transaction(() => {
    const sequence = (db.query<{ value: number | null }, []>("SELECT MAX(sequence) AS value FROM kanban_tasks").get()?.value ?? 0) + 1;
    const displayId = `${getKanbanSettings(db).taskIdPrefix}-${String(sequence).padStart(3, "0")}`;
    const ts = nowIso();
    const createdByDisplay = computeRoleDisplay(db, input.createdByRoleId);
    const assigneeDisplay = computeRoleDisplay(db, input.assignedRoleId);
    const result = db.query<unknown, [string, number, string, string, KanbanStatus, KanbanPriority, KanbanEffort, string, string, string | null, string | null, string | null, number | null, string | null, string, string, string | null, number | null]>(
      `INSERT INTO kanban_tasks (display_id, sequence, title, details, status, priority, effort, created_by_role_id, assigned_role_id, created_by_display, assignee_display, github_url, github_number, github_title, created_at, updated_at, completed_at, epic_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    ).get(displayId, sequence, title, details, status, priority, effort, input.createdByRoleId, input.assignedRoleId, createdByDisplay, assigneeDisplay, githubUrl, githubNumber, githubTitle, ts, ts, status === "Completed" ? ts : null, epicId) as { id: number } | null;
    if (!result) throw new Error("failed to insert kanban task");
    insertedId = result.id;
    insertKanbanActivity(db, {
      taskId: insertedId,
      roleId: input.createdByRoleId,
      sessionId: null,
      action: "created",
      field: null,
      before: null,
      after: { displayId, title, status, priority, effort, assignedRoleId: input.assignedRoleId, epicId },
    });
  })();

  const task = getKanbanTaskById(db, insertedId);
  if (!task) throw new Error("inserted kanban task was not found");
  return task;
}

function resolveKanbanEpicLinkId(db: Database, value: string | number | null): number | null {
  if (value === null) return null;
  if (typeof value === "string" && value.trim().toLowerCase() === "none") return null;
  const epic = getKanbanEpic(db, value);
  if (!epic) throw new Error(`kanban epic was not found: ${value}`);
  if (epic.archived_at) throw new Error(`kanban epic ${epic.display_id} is archived; cannot link a task to an archived epic`);
  return epic.id;
}

export function updateKanbanTask(db: Database, taskId: string | number, input: KanbanTaskUpdateInput): KanbanTaskRow {
  const existing = getKanbanTask(db, taskId);
  if (!existing) throw new Error("kanban task was not found");
  const next: Partial<KanbanTaskRow> = {};
  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];
  const setField = <K extends keyof KanbanTaskRow>(field: K, value: KanbanTaskRow[K]) => {
    if (existing[field] === value) return;
    next[field] = value;
    changes.push({ field: String(field), before: existing[field], after: value });
  };

  if (input.title !== undefined) setField("title", normalizeRequiredText(input.title, "title", 500));
  if (input.details !== undefined) setField("details", normalizeOptionalText(input.details, 16_000));
  if (input.status !== undefined) setField("status", normalizeKanbanStatus(input.status));
  if (input.priority !== undefined) setField("priority", normalizeKanbanPriority(input.priority));
  if (input.effort !== undefined) setField("effort", normalizeKanbanEffort(input.effort));
  if (input.assignedRoleId !== undefined) setField("assigned_role_id", String(input.assignedRoleId));
  if (input.githubUrl !== undefined) setField("github_url", normalizeNullableHttpUrl(input.githubUrl, 2000, "githubUrl"));
  if (input.githubNumber !== undefined) setField("github_number", normalizeNullableInteger(input.githubNumber, "githubNumber"));
  if (input.githubTitle !== undefined) setField("github_title", normalizeNullableText(input.githubTitle, 500));
  if (input.epicId !== undefined) setField("epic_id", resolveKanbanEpicLinkId(db, input.epicId));

  db.transaction(() => {
    if (changes.length > 0) {
      const status = (next.status ?? existing.status) as KanbanStatus;
      const completedAt = status === "Completed" ? (existing.completed_at ?? nowIso()) : null;
      const newAssigneeId = next.assigned_role_id ?? existing.assigned_role_id;
      const assigneeDisplay = computeRoleDisplay(db, newAssigneeId);
      db.run(
        `UPDATE kanban_tasks SET title = ?, details = ?, status = ?, priority = ?, effort = ?, assigned_role_id = ?, assignee_display = ?, github_url = ?, github_number = ?, github_title = ?, completed_at = ?, updated_at = ?, epic_id = ? WHERE id = ?`,
        [
          next.title ?? existing.title,
          next.details ?? existing.details,
          status,
          next.priority ?? existing.priority,
          next.effort ?? existing.effort,
          newAssigneeId,
          assigneeDisplay,
          next.github_url === undefined ? existing.github_url : next.github_url,
          next.github_number === undefined ? existing.github_number : next.github_number,
          next.github_title === undefined ? existing.github_title : next.github_title,
          completedAt,
          nowIso(),
          next.epic_id === undefined ? existing.epic_id : next.epic_id,
          existing.id,
        ],
      );
      for (const change of changes) {
        insertKanbanActivity(db, { taskId: existing.id, roleId: input.actorRoleId, sessionId: input.actorSessionId ?? null, action: "updated", field: change.field, before: change.before, after: change.after });
      }
    }
    if (input.dependsOnTaskIds !== undefined) {
      replaceKanbanDependencies(db, existing.id, input.dependsOnTaskIds, input.actorRoleId, input.actorSessionId ?? null);
    }
  })();

  const updated = getKanbanTaskById(db, existing.id);
  if (!updated) throw new Error("updated kanban task was not found");
  return updated;
}

export function archiveKanbanTask(db: Database, taskId: string | number, actorRoleId: string, actorSessionId: string | null = null): KanbanTaskRow {
  const task = getKanbanTask(db, taskId);
  if (!task) throw new Error("kanban task was not found");
  if (!task.archived_at) {
    const ts = nowIso();
    const archivedByDisplay = computeRoleDisplay(db, actorRoleId);
    db.transaction(() => {
      db.run("UPDATE kanban_tasks SET archived_at = ?, archived_by_role_id = ?, archived_by_display = ?, updated_at = ? WHERE id = ?", [ts, actorRoleId, archivedByDisplay, ts, task.id]);
      insertKanbanActivity(db, { taskId: task.id, roleId: actorRoleId, sessionId: actorSessionId, action: "archived", field: "archived_at", before: null, after: ts });
    })();
  }
  const archived = getKanbanTaskById(db, task.id);
  if (!archived) throw new Error("archived kanban task was not found");
  return archived;
}

export function getKanbanEpic(db: Database, epicId: string | number): KanbanEpicRow | null {
  if (typeof epicId === "number" || /^\d+$/.test(String(epicId).trim())) {
    return getKanbanEpicById(db, Math.floor(Number(epicId)));
  }
  return db.query<KanbanEpicRow, [string]>(kanbanEpicSelectSql("WHERE UPPER(kanban_epics.display_id) = UPPER(?)")).get(String(epicId).trim()) ?? null;
}

export function getKanbanEpicById(db: Database, id: number): KanbanEpicRow | null {
  return db.query<KanbanEpicRow, [number]>(kanbanEpicSelectSql("WHERE kanban_epics.id = ?")).get(Math.floor(Number(id))) ?? null;
}

export function listKanbanEpics(db: Database, opts: { includeArchived?: boolean; status?: KanbanStatus; assignedRoleId?: string; createdByRoleId?: string; priority?: KanbanPriority; search?: string; limit?: number } = {}): KanbanEpicRow[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (!opts.includeArchived) clauses.push("kanban_epics.archived_at IS NULL");
  if (opts.status) {
    clauses.push("kanban_epics.status = ?");
    params.push(opts.status);
  }
  if (opts.assignedRoleId) {
    clauses.push("kanban_epics.assigned_role_id = ?");
    params.push(opts.assignedRoleId);
  }
  if (opts.createdByRoleId) {
    clauses.push("kanban_epics.created_by_role_id = ?");
    params.push(opts.createdByRoleId);
  }
  if (opts.priority) {
    clauses.push("kanban_epics.priority = ?");
    params.push(opts.priority);
  }
  if (opts.search) {
    clauses.push("(LOWER(kanban_epics.display_id) LIKE ? OR LOWER(kanban_epics.title) LIKE ? OR LOWER(kanban_epics.details) LIKE ?)");
    const needle = `%${opts.search.toLowerCase()}%`;
    params.push(needle, needle, needle);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(1000, Math.floor(Number(opts.limit ?? 200))));
  return db.query<KanbanEpicRow, Array<string | number>>(kanbanEpicSelectSql(`${where} ORDER BY kanban_epics.sequence ASC LIMIT ?`)).all(...params, limit);
}

export function createKanbanEpic(db: Database, input: KanbanEpicInput): KanbanEpicRow {
  const title = normalizeRequiredText(input.title, "title", 500);
  const details = normalizeOptionalText(input.details, 16_000);
  const status = normalizeKanbanStatus(input.status ?? "Backlog");
  const priority = normalizeKanbanPriority(input.priority ?? "P2");
  const effort = normalizeKanbanEffort(input.effort ?? "M");
  const githubUrl = normalizeNullableHttpUrl(input.githubUrl, 2000, "githubUrl");
  const githubTitle = normalizeNullableText(input.githubTitle, 500);
  const githubNumber = normalizeNullableInteger(input.githubNumber, "githubNumber");
  let insertedId = 0;

  db.transaction(() => {
    const sequence = (db.query<{ value: number | null }, []>("SELECT MAX(sequence) AS value FROM kanban_epics").get()?.value ?? 0) + 1;
    const displayId = `${getKanbanSettings(db).epicIdPrefix}-${String(sequence).padStart(3, "0")}`;
    const ts = nowIso();
    const createdByDisplay = computeRoleDisplay(db, input.createdByRoleId);
    const assigneeDisplay = computeRoleDisplay(db, input.assignedRoleId);
    const result = db.query<unknown, [string, number, string, string, KanbanStatus, KanbanPriority, KanbanEffort, string, string, string | null, string | null, string | null, number | null, string | null, string, string, string | null]>(
      `INSERT INTO kanban_epics (display_id, sequence, title, details, status, priority, effort, created_by_role_id, assigned_role_id, created_by_display, assignee_display, github_url, github_number, github_title, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    ).get(displayId, sequence, title, details, status, priority, effort, input.createdByRoleId, input.assignedRoleId, createdByDisplay, assigneeDisplay, githubUrl, githubNumber, githubTitle, ts, ts, status === "Completed" ? ts : null) as { id: number } | null;
    if (!result) throw new Error("failed to insert kanban epic");
    insertedId = result.id;
    insertKanbanEpicActivity(db, {
      epicId: insertedId,
      roleId: input.createdByRoleId,
      sessionId: null,
      action: "created",
      field: null,
      before: null,
      after: { displayId, title, status, priority, effort, assignedRoleId: input.assignedRoleId },
    });
  })();

  const epic = getKanbanEpicById(db, insertedId);
  if (!epic) throw new Error("inserted kanban epic was not found");
  return epic;
}

export function updateKanbanEpic(db: Database, epicId: string | number, input: KanbanEpicUpdateInput): KanbanEpicRow {
  const existing = getKanbanEpic(db, epicId);
  if (!existing) throw new Error("kanban epic was not found");
  const next: Partial<KanbanEpicRow> = {};
  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];
  const setField = <K extends keyof KanbanEpicRow>(field: K, value: KanbanEpicRow[K]) => {
    if (existing[field] === value) return;
    next[field] = value;
    changes.push({ field: String(field), before: existing[field], after: value });
  };

  if (input.title !== undefined) setField("title", normalizeRequiredText(input.title, "title", 500));
  if (input.details !== undefined) setField("details", normalizeOptionalText(input.details, 16_000));
  if (input.status !== undefined) setField("status", normalizeKanbanStatus(input.status));
  if (input.priority !== undefined) setField("priority", normalizeKanbanPriority(input.priority));
  if (input.effort !== undefined) setField("effort", normalizeKanbanEffort(input.effort));
  if (input.assignedRoleId !== undefined) setField("assigned_role_id", String(input.assignedRoleId));
  if (input.githubUrl !== undefined) setField("github_url", normalizeNullableHttpUrl(input.githubUrl, 2000, "githubUrl"));
  if (input.githubNumber !== undefined) setField("github_number", normalizeNullableInteger(input.githubNumber, "githubNumber"));
  if (input.githubTitle !== undefined) setField("github_title", normalizeNullableText(input.githubTitle, 500));

  db.transaction(() => {
    if (changes.length > 0) {
      const status = (next.status ?? existing.status) as KanbanStatus;
      const completedAt = status === "Completed" ? (existing.completed_at ?? nowIso()) : null;
      const newAssigneeId = next.assigned_role_id ?? existing.assigned_role_id;
      const assigneeDisplay = computeRoleDisplay(db, newAssigneeId);
      db.run(
        `UPDATE kanban_epics SET title = ?, details = ?, status = ?, priority = ?, effort = ?, assigned_role_id = ?, assignee_display = ?, github_url = ?, github_number = ?, github_title = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
        [
          next.title ?? existing.title,
          next.details ?? existing.details,
          status,
          next.priority ?? existing.priority,
          next.effort ?? existing.effort,
          newAssigneeId,
          assigneeDisplay,
          next.github_url === undefined ? existing.github_url : next.github_url,
          next.github_number === undefined ? existing.github_number : next.github_number,
          next.github_title === undefined ? existing.github_title : next.github_title,
          completedAt,
          nowIso(),
          existing.id,
        ],
      );
      for (const change of changes) {
        insertKanbanEpicActivity(db, { epicId: existing.id, roleId: input.actorRoleId, sessionId: input.actorSessionId ?? null, action: "updated", field: change.field, before: change.before, after: change.after });
      }
    }
  })();

  const updated = getKanbanEpicById(db, existing.id);
  if (!updated) throw new Error("updated kanban epic was not found");
  return updated;
}

export function listKanbanEpicChildren(db: Database, epicId: number, opts: { includeArchived?: boolean } = {}): KanbanTaskRow[] {
  const where = opts.includeArchived
    ? "WHERE kanban_tasks.epic_id = ?"
    : "WHERE kanban_tasks.epic_id = ? AND kanban_tasks.archived_at IS NULL";
  return db.query<KanbanTaskRow, [number]>(kanbanTaskSelectSql(`${where} ORDER BY kanban_tasks.sequence ASC`)).all(epicId);
}

export function listUnclassifiedKanbanTasks(db: Database, opts: { includeArchived?: boolean } = {}): KanbanTaskRow[] {
  const where = opts.includeArchived ? "WHERE kanban_tasks.epic_id IS NULL" : "WHERE kanban_tasks.epic_id IS NULL AND kanban_tasks.archived_at IS NULL";
  return db.query<KanbanTaskRow, []>(kanbanTaskSelectSql(`${where} ORDER BY kanban_tasks.sequence ASC`)).all();
}

export function countOpenKanbanEpicChildren(db: Database, epicId: number): number {
  return db.query<{ count: number }, [number]>(
    "SELECT COUNT(*) AS count FROM kanban_tasks WHERE epic_id = ? AND status != 'Completed' AND archived_at IS NULL",
  ).get(epicId)?.count ?? 0;
}

export function listOpenKanbanEpicChildren(db: Database, epicId: number): Array<{ id: number; display_id: string; status: KanbanStatus; title: string }> {
  return db.query<{ id: number; display_id: string; status: KanbanStatus; title: string }, [number]>(
    "SELECT id, display_id, status, title FROM kanban_tasks WHERE epic_id = ? AND status != 'Completed' AND archived_at IS NULL ORDER BY sequence ASC",
  ).all(epicId);
}

export function setKanbanEpicStatus(db: Database, epicId: number, nextStatus: KanbanStatus, actorRoleId: string, actorSessionId: string | null = null): KanbanEpicRow {
  const status = normalizeKanbanStatus(nextStatus);
  const epic = getKanbanEpicById(db, epicId);
  if (!epic) throw new Error("kanban epic was not found");
  if (epic.status === status) return epic;
  const ts = nowIso();
  db.transaction(() => {
    const completedAt = status === "Completed" ? (epic.completed_at ?? ts) : null;
    db.run(
      "UPDATE kanban_epics SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?",
      [status, completedAt, ts, epic.id],
    );
    insertKanbanEpicActivity(db, { epicId: epic.id, roleId: actorRoleId, sessionId: actorSessionId, action: "updated", field: "status", before: epic.status, after: status });
  })();
  const updated = getKanbanEpicById(db, epic.id);
  if (!updated) throw new Error("updated kanban epic was not found");
  return updated;
}

export function setKanbanEpicCloseApprovalPending(db: Database, epicId: number, actorRoleId: string, actorSessionId: string | null = null): KanbanEpicRow {
  const epic = getKanbanEpicById(db, epicId);
  if (!epic) throw new Error("kanban epic was not found");
  const ts = nowIso();
  const requestedByDisplay = computeRoleDisplay(db, actorRoleId);
  db.transaction(() => {
    db.run(
      "UPDATE kanban_epics SET close_approval_status = 'pending', close_approval_requested_at = ?, close_approval_requested_by_role_id = ?, close_approval_requested_by_display = ?, close_approval_approved_at = NULL, close_approval_approved_by = NULL, updated_at = ? WHERE id = ?",
      [ts, actorRoleId, requestedByDisplay, ts, epic.id],
    );
    insertKanbanEpicActivity(db, { epicId: epic.id, roleId: actorRoleId, sessionId: actorSessionId, action: "close_approval_requested", field: "close_approval_status", before: epic.close_approval_status, after: "pending" });
  })();
  const updated = getKanbanEpicById(db, epic.id);
  if (!updated) throw new Error("kanban epic update failed");
  return updated;
}

export function clearKanbanEpicCloseApproval(db: Database, epicId: number, actorRoleId: string, actorSessionId: string | null = null): KanbanEpicRow {
  const epic = getKanbanEpicById(db, epicId);
  if (!epic) throw new Error("kanban epic was not found");
  if (epic.close_approval_status === "none") return epic;
  const ts = nowIso();
  db.transaction(() => {
    db.run(
      "UPDATE kanban_epics SET close_approval_status = 'none', close_approval_requested_at = NULL, close_approval_requested_by_role_id = NULL, close_approval_approved_at = NULL, close_approval_approved_by = NULL, updated_at = ? WHERE id = ?",
      [ts, epic.id],
    );
    insertKanbanEpicActivity(db, { epicId: epic.id, roleId: actorRoleId, sessionId: actorSessionId, action: "close_approval_cancelled", field: "close_approval_status", before: epic.close_approval_status, after: "none" });
  })();
  const updated = getKanbanEpicById(db, epic.id);
  if (!updated) throw new Error("kanban epic update failed");
  return updated;
}

export function completeKanbanEpicWithApproval(db: Database, epicId: number, approvedBy: string, actorRoleId: string, actorSessionId: string | null = null): KanbanEpicRow {
  const epic = getKanbanEpicById(db, epicId);
  if (!epic) throw new Error("kanban epic was not found");
  const ts = nowIso();
  db.transaction(() => {
    const completedAt = epic.completed_at ?? ts;
    db.run(
      "UPDATE kanban_epics SET close_approval_status = 'approved', close_approval_approved_at = ?, close_approval_approved_by = ?, status = 'Completed', completed_at = ?, updated_at = ? WHERE id = ?",
      [ts, approvedBy, completedAt, ts, epic.id],
    );
    insertKanbanEpicActivity(db, { epicId: epic.id, roleId: actorRoleId, sessionId: actorSessionId, action: "close_approved", field: "close_approval_status", before: epic.close_approval_status, after: "approved" });
    if (epic.status !== "Completed") {
      insertKanbanEpicActivity(db, { epicId: epic.id, roleId: actorRoleId, sessionId: actorSessionId, action: "updated", field: "status", before: epic.status, after: "Completed" });
    }
  })();
  const updated = getKanbanEpicById(db, epic.id);
  if (!updated) throw new Error("kanban epic update failed");
  return updated;
}

export function archiveKanbanEpic(db: Database, epicId: string | number, actorRoleId: string, actorSessionId: string | null = null): KanbanEpicRow {
  const epic = getKanbanEpic(db, epicId);
  if (!epic) throw new Error("kanban epic was not found");
  if (!epic.archived_at) {
    const openChildren = db.query<{ display_id: string }, [number]>(
      "SELECT display_id FROM kanban_tasks WHERE epic_id = ? AND archived_at IS NULL ORDER BY sequence ASC",
    ).all(epic.id);
    if (openChildren.length > 0) {
      const ids = openChildren.map((row) => row.display_id).join(", ");
      const error = new Error(`kanban epic ${epic.display_id} cannot be archived while it has ${openChildren.length} open child issue(s): ${ids}`);
      (error as Error & { code?: string; childDisplayIds?: string[] }).code = "EPIC_HAS_CHILDREN";
      (error as Error & { code?: string; childDisplayIds?: string[] }).childDisplayIds = openChildren.map((row) => row.display_id);
      throw error;
    }
    const ts = nowIso();
    const archivedByDisplay = computeRoleDisplay(db, actorRoleId);
    db.transaction(() => {
      db.run("UPDATE kanban_epics SET archived_at = ?, archived_by_role_id = ?, archived_by_display = ?, updated_at = ? WHERE id = ?", [ts, actorRoleId, archivedByDisplay, ts, epic.id]);
      insertKanbanEpicActivity(db, { epicId: epic.id, roleId: actorRoleId, sessionId: actorSessionId, action: "archived", field: "archived_at", before: null, after: ts });
    })();
  }
  const archived = getKanbanEpicById(db, epic.id);
  if (!archived) throw new Error("archived kanban epic was not found");
  return archived;
}

export function addKanbanComment(db: Database, taskId: string | number, input: { roleId: string; sessionId?: string | null; type: KanbanCommentType; body: string }): KanbanCommentRow {
  const task = getKanbanTask(db, taskId);
  if (!task) throw new Error("kanban task was not found");
  const type = normalizeKanbanCommentType(input.type);
  const body = normalizeRequiredText(input.body, "body", 16_000);
  let insertedId = 0;
  db.transaction(() => {
    const actorDisplay = computeRoleDisplay(db, input.roleId);
    const result = db.query<unknown, [number, string, string | null, string | null, KanbanCommentType, string, string]>(
      `INSERT INTO kanban_comments (task_id, role_id, session_id, actor_display, type, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    ).get(task.id, input.roleId, input.sessionId ?? null, actorDisplay, type, body, nowIso()) as { id: number } | null;
    if (!result) throw new Error("failed to insert kanban comment");
    insertedId = result.id;
    insertKanbanActivity(db, { taskId: task.id, roleId: input.roleId, sessionId: input.sessionId ?? null, action: "commented", field: type, before: null, after: body });
    db.run("UPDATE kanban_tasks SET updated_at = ? WHERE id = ?", [nowIso(), task.id]);
  })();
  const comment = getKanbanCommentById(db, insertedId);
  if (!comment) throw new Error("inserted kanban comment was not found");
  return comment;
}

export function getKanbanTask(db: Database, taskId: string | number): KanbanTaskRow | null {
  if (typeof taskId === "number" || /^\d+$/.test(String(taskId).trim())) {
    return getKanbanTaskById(db, Math.floor(Number(taskId)));
  }
  return db.query<KanbanTaskRow, [string]>(kanbanTaskSelectSql("WHERE UPPER(kanban_tasks.display_id) = UPPER(?)")).get(String(taskId).trim()) ?? null;
}

export function getKanbanTaskById(db: Database, id: number): KanbanTaskRow | null {
  return db.query<KanbanTaskRow, [number]>(kanbanTaskSelectSql("WHERE kanban_tasks.id = ?")).get(Math.floor(Number(id))) ?? null;
}

export function listKanbanTasks(db: Database, opts: { includeArchived?: boolean; status?: KanbanStatus; assignedRoleId?: string; createdByRoleId?: string; priority?: KanbanPriority; search?: string; limit?: number; epicId?: string | number | null } = {}): KanbanTaskRow[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (!opts.includeArchived) clauses.push("kanban_tasks.archived_at IS NULL");
  if (opts.status) {
    clauses.push("kanban_tasks.status = ?");
    params.push(normalizeKanbanStatus(opts.status));
  }
  if (opts.assignedRoleId) {
    clauses.push("kanban_tasks.assigned_role_id = ?");
    params.push(opts.assignedRoleId);
  }
  if (opts.createdByRoleId) {
    clauses.push("kanban_tasks.created_by_role_id = ?");
    params.push(opts.createdByRoleId);
  }
  if (opts.priority) {
    clauses.push("kanban_tasks.priority = ?");
    params.push(normalizeKanbanPriority(opts.priority));
  }
  if (opts.epicId !== undefined) {
    if (opts.epicId === null || (typeof opts.epicId === "string" && opts.epicId.trim().toLowerCase() === "none")) {
      clauses.push("kanban_tasks.epic_id IS NULL");
    } else {
      const epic = getKanbanEpic(db, opts.epicId);
      if (!epic) throw new Error(`kanban epic was not found: ${opts.epicId}`);
      clauses.push("kanban_tasks.epic_id = ?");
      params.push(epic.id);
    }
  }
  const search = String(opts.search ?? "").trim();
  if (search) {
    clauses.push("(UPPER(kanban_tasks.display_id) LIKE UPPER(?) OR UPPER(kanban_tasks.title) LIKE UPPER(?) OR UPPER(kanban_tasks.details) LIKE UPPER(?))");
    const pattern = `%${search}%`;
    params.push(pattern, pattern, pattern);
  }
  const limit = Math.max(1, Math.min(1000, Math.floor(opts.limit ?? 500)));
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.query<KanbanTaskRow, Array<string | number>>(kanbanTaskSelectSql(`${where} ORDER BY kanban_tasks.sequence ASC LIMIT ?`)).all(...params, limit);
}

// Resolve a numeric kanban_tasks.id from either an internal id (number / numeric
// string) or a display id like "TASK-001". The display-id branch is a single
// cheap SELECT id; the join-heavy `kanbanTaskSelectSql` lookup that the four
// list functions previously used five times per detail render is gone.
function resolveKanbanTaskId(db: Database, taskId: string | number): number | null {
  if (typeof taskId === "number") {
    return Number.isFinite(taskId) && taskId > 0 ? Math.floor(taskId) : null;
  }
  const trimmed = String(taskId).trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const n = Math.floor(Number(trimmed));
    return n > 0 ? n : null;
  }
  const row = db.query<{ id: number }, [string]>("SELECT id FROM kanban_tasks WHERE UPPER(display_id) = UPPER(?)").get(trimmed);
  return row?.id ?? null;
}

export function listKanbanComments(db: Database, taskId: string | number): KanbanCommentRow[] {
  const id = resolveKanbanTaskId(db, taskId);
  if (id === null) throw new Error("kanban task was not found");
  return db.query<KanbanCommentRow, [number]>(kanbanCommentSelectSql("WHERE kanban_comments.task_id = ? ORDER BY kanban_comments.id ASC")).all(id);
}

export function listKanbanActivity(db: Database, taskId: string | number): KanbanActivityRow[] {
  const id = resolveKanbanTaskId(db, taskId);
  if (id === null) throw new Error("kanban task was not found");
  return db.query<KanbanActivityRow, [number]>(kanbanActivitySelectSql("WHERE kanban_activity.task_id = ? ORDER BY kanban_activity.id ASC")).all(id);
}

export function listKanbanDependencies(db: Database, taskId: string | number): KanbanDependencyRow[] {
  const id = resolveKanbanTaskId(db, taskId);
  if (id === null) throw new Error("kanban task was not found");
  return db.query<KanbanDependencyRow, [number]>(kanbanDependencySelectSql("WHERE kanban_dependencies.task_id = ? ORDER BY depends_on.sequence ASC")).all(id);
}

export function listAllKanbanDependencies(db: Database): KanbanDependencyRow[] {
  return db.query<KanbanDependencyRow, []>(kanbanDependencySelectSql("ORDER BY kanban_dependencies.task_id ASC")).all();
}

export function listKanbanDependedBy(db: Database, taskId: string | number): KanbanDependedByRow[] {
  const id = resolveKanbanTaskId(db, taskId);
  if (id === null) throw new Error("kanban task was not found");
  return db.query<KanbanDependedByRow, [number]>(kanbanDependedBySelectSql("WHERE kanban_dependencies.depends_on_task_id = ? ORDER BY task.sequence ASC")).all(id);
}

export function insertKanbanNotification(db: Database, input: { taskId: number; toRoleId: string; actorRoleId?: string | null; eventType: string; activityId?: number | null; commentId?: number | null; body: string }): KanbanNotificationRow {
  const body = normalizeRequiredText(input.body, "body", 4000);
  const eventType = normalizeRequiredText(input.eventType, "eventType", 100);
  const toDisplay = computeRoleDisplay(db, input.toRoleId);
  const actorDisplay = computeRoleDisplay(db, input.actorRoleId ?? null);
  const result = db.query<unknown, [number, string, string | null, string | null, string | null, string, number | null, number | null, string, string]>(
    `INSERT INTO kanban_notifications (task_id, to_role_id, actor_role_id, to_display, actor_display, event_type, activity_id, comment_id, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
  ).get(input.taskId, input.toRoleId, input.actorRoleId ?? null, toDisplay, actorDisplay, eventType, input.activityId ?? null, input.commentId ?? null, body, nowIso()) as { id: number } | null;
  if (!result) throw new Error("failed to insert kanban notification");
  const notification = getKanbanNotificationById(db, result.id);
  if (!notification) throw new Error("inserted kanban notification was not found");
  return notification;
}

export function listPendingKanbanNotifications(db: Database, roleId: string, limit = 50): KanbanNotificationRow[] {
  return db.query<KanbanNotificationRow, [string, number]>(kanbanNotificationSelectSql(
    "WHERE kanban_notifications.to_role_id = ? AND kanban_notifications.read_at IS NULL ORDER BY kanban_notifications.id ASC LIMIT ?",
  )).all(roleId, Math.max(1, Math.min(100, Math.floor(limit))));
}

export function markKanbanNotificationsRead(db: Database, roleId: string, notificationIds: number[]): KanbanNotificationRow[] {
  const ids = [...new Set(notificationIds.map((id) => Math.floor(Number(id))).filter((id) => Number.isFinite(id) && id > 0))];
  if (ids.length === 0) return [];
  const ts = nowIso();
  const marked: number[] = [];
  db.transaction(() => {
    const update = db.query<{ id: number }, [string, string, number, string]>(
      `UPDATE kanban_notifications
       SET delivered_at = COALESCE(delivered_at, ?), read_at = COALESCE(read_at, ?)
       WHERE id = ? AND to_role_id = ?
       RETURNING id`,
    );
    for (const id of ids) {
      const row = update.get(ts, ts, id, roleId);
      if (row) marked.push(row.id);
    }
  })();
  return marked.map((id) => getKanbanNotificationById(db, id)).filter((row): row is KanbanNotificationRow => Boolean(row));
}

export function insertKanbanEpicNotification(db: Database, input: { epicId: number; toRoleId: string; actorRoleId?: string | null; eventType: string; activityId?: number | null; commentId?: number | null; body: string }): KanbanEpicNotificationRow {
  const body = normalizeRequiredText(input.body, "body", 4000);
  const eventType = normalizeRequiredText(input.eventType, "eventType", 100);
  const toDisplay = computeRoleDisplay(db, input.toRoleId);
  const actorDisplay = computeRoleDisplay(db, input.actorRoleId ?? null);
  const result = db.query<unknown, [number, string, string | null, string | null, string | null, string, number | null, number | null, string, string]>(
    `INSERT INTO kanban_epic_notifications (epic_id, to_role_id, actor_role_id, to_display, actor_display, event_type, activity_id, comment_id, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
  ).get(input.epicId, input.toRoleId, input.actorRoleId ?? null, toDisplay, actorDisplay, eventType, input.activityId ?? null, input.commentId ?? null, body, nowIso()) as { id: number } | null;
  if (!result) throw new Error("failed to insert kanban epic notification");
  const notification = getKanbanEpicNotificationById(db, result.id);
  if (!notification) throw new Error("inserted kanban epic notification was not found");
  return notification;
}

export function notifyKanbanEpicEvent(db: Database, epic: { id: number; assigned_role_id: string; created_by_role_id: string }, actorRoleId: string | null, eventType: string, body: string, opts: { activityId?: number | null; commentId?: number | null } = {}): KanbanEpicNotificationRow[] {
  const recipients = [...new Set([epic.assigned_role_id, epic.created_by_role_id])]
    .filter((roleId): roleId is string => Boolean(roleId) && roleId !== actorRoleId);
  return recipients.map((toRoleId) => insertKanbanEpicNotification(db, {
    epicId: epic.id,
    toRoleId,
    actorRoleId,
    eventType,
    activityId: opts.activityId ?? null,
    commentId: opts.commentId ?? null,
    body,
  }));
}

export function listPendingKanbanEpicNotifications(db: Database, roleId: string, limit = 50): KanbanEpicNotificationRow[] {
  return db.query<KanbanEpicNotificationRow, [string, number]>(kanbanEpicNotificationSelectSql(
    "WHERE kanban_epic_notifications.to_role_id = ? AND kanban_epic_notifications.read_at IS NULL ORDER BY kanban_epic_notifications.id ASC LIMIT ?",
  )).all(roleId, Math.max(1, Math.min(100, Math.floor(limit))));
}

export function markKanbanEpicNotificationsRead(db: Database, roleId: string, notificationIds: number[]): KanbanEpicNotificationRow[] {
  const ids = [...new Set(notificationIds.map((id) => Math.floor(Number(id))).filter((id) => Number.isFinite(id) && id > 0))];
  if (ids.length === 0) return [];
  const ts = nowIso();
  const marked: number[] = [];
  db.transaction(() => {
    const update = db.query<{ id: number }, [string, string, number, string]>(
      `UPDATE kanban_epic_notifications
       SET delivered_at = COALESCE(delivered_at, ?), read_at = COALESCE(read_at, ?)
       WHERE id = ? AND to_role_id = ?
       RETURNING id`,
    );
    for (const id of ids) {
      const row = update.get(ts, ts, id, roleId);
      if (row) marked.push(row.id);
    }
  })();
  return marked.map((id) => getKanbanEpicNotificationById(db, id)).filter((row): row is KanbanEpicNotificationRow => Boolean(row));
}

export function addKanbanEpicComment(db: Database, epicId: number, input: { roleId: string; sessionId?: string | null; type: KanbanCommentType; body: string }): KanbanEpicCommentRow {
  const type = normalizeKanbanCommentType(input.type);
  const body = normalizeRequiredText(input.body, "body", 16_000);
  let insertedId = 0;
  db.transaction(() => {
    const actorDisplay = computeRoleDisplay(db, input.roleId);
    const result = db.query<unknown, [number, string, string | null, string | null, KanbanCommentType, string, string]>(
      `INSERT INTO kanban_epic_comments (epic_id, role_id, session_id, actor_display, type, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    ).get(epicId, input.roleId, input.sessionId ?? null, actorDisplay, type, body, nowIso()) as { id: number } | null;
    if (!result) throw new Error("failed to insert kanban epic comment");
    insertedId = result.id;
    insertKanbanEpicActivity(db, { epicId, roleId: input.roleId, sessionId: input.sessionId ?? null, action: "commented", field: type, before: null, after: body });
    db.run("UPDATE kanban_epics SET updated_at = ? WHERE id = ?", [nowIso(), epicId]);
  })();
  const comment = getKanbanEpicCommentById(db, insertedId);
  if (!comment) throw new Error("inserted kanban epic comment was not found");
  return comment;
}

export function listKanbanEpicComments(db: Database, epicId: number): KanbanEpicCommentRow[] {
  return db.query<KanbanEpicCommentRow, [number]>(kanbanEpicCommentSelectSql("WHERE kanban_epic_comments.epic_id = ? ORDER BY kanban_epic_comments.id ASC")).all(epicId);
}

export function listKanbanEpicActivity(db: Database, epicId: number): KanbanEpicActivityRow[] {
  return db.query<KanbanEpicActivityRow, [number]>(kanbanEpicActivitySelectSql("WHERE kanban_epic_activity.epic_id = ? ORDER BY kanban_epic_activity.id ASC")).all(epicId);
}

function fts5EscapeQuery(raw: string): string {
  const inner = String(raw ?? "").trim();
  if (!inner) throw new Error("empty_query");
  return `"${inner.replace(/"/g, '""')}"*`;
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function searchPreview(text: string, rawQuery: string): string {
  const value = String(text ?? "");
  const normalized = normalizeSearchText(value);
  const terms = normalizeSearchText(rawQuery).split(/\s+/).filter(Boolean);
  const first = terms.map((term) => normalized.indexOf(term)).filter((idx) => idx >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, first - 100);
  return value.slice(start, Math.min(value.length, first + 140));
}

function matchedKanbanFields(row: { display_id: string; title: string; details: string }, rawQuery: string): Array<"display_id" | "title" | "details"> {
  const needle = normalizeSearchText(rawQuery).trim();
  const matches = (value: string) => normalizeSearchText(value).includes(needle);
  const fields: Array<"display_id" | "title" | "details"> = [];
  if (matches(row.display_id)) fields.push("display_id");
  if (matches(row.title)) fields.push("title");
  if (matches(row.details)) fields.push("details");
  return fields;
}

function clampSearchLimit(limit: number): number {
  return Math.max(1, Math.min(100, Math.floor(Number(limit || 20))));
}

export function searchDirectMessages(db: Database, opts: {
  callerRoleId: string | null;
  q: string;
  senderRoleId?: string | null;
  limit: number;
}): DirectMessageSearchRow[] {
  const query = fts5EscapeQuery(opts.q);
  const clauses = ["messages_fts MATCH ?"];
  const params: Array<string | number | null> = [query];
  if (opts.callerRoleId) {
    clauses.push("(messages.from_role_id = ? OR messages.to_role_id = ?)");
    params.push(opts.callerRoleId, opts.callerRoleId);
  }
  if (opts.senderRoleId) {
    clauses.push("messages.from_role_id = ?");
    params.push(opts.senderRoleId);
  }
  const rows = db.query<MessageRow & { rank: number }, Array<string | number | null>>(
    messageSelectSql(`JOIN messages_fts ON messages_fts.rowid = messages.id WHERE ${clauses.join(" AND ")} ORDER BY rank ASC LIMIT ?`).replace(
      "SELECT messages.id,",
      "SELECT messages.id, bm25(messages_fts) AS rank,",
    ),
  ).all(...params, clampSearchLimit(opts.limit));
  return rows.map((row) => ({
    id: row.id,
    sentAt: row.sent_at,
    from: { displayId: row.from_role_name ?? "(deleted)", name: row.from_role_name ?? "(deleted)" },
    to: { displayId: row.to_role_name ?? "(deleted)", name: row.to_role_name ?? "(deleted)" },
    bodyPreview: searchPreview(row.body, opts.q),
    rank: row.rank,
  }));
}

export function searchChannelMessages(db: Database, opts: {
  q: string;
  senderRoleId?: string | null;
  channelId?: string | null;
  limit: number;
}): ChannelMessageSearchRow[] {
  const query = fts5EscapeQuery(opts.q);
  const clauses = ["channel_messages_fts MATCH ?"];
  const params: Array<string | number | null> = [query];
  if (opts.senderRoleId) {
    clauses.push("channel_messages.from_role_id = ?");
    params.push(opts.senderRoleId);
  }
  if (opts.channelId) {
    clauses.push("channel_messages.channel_id = ?");
    params.push(opts.channelId);
  }
  const rows = db.query<ChannelMessageRow & { rank: number }, Array<string | number | null>>(
    channelMessageSelectSql(`JOIN channel_messages_fts ON channel_messages_fts.rowid = channel_messages.id WHERE ${clauses.join(" AND ")} ORDER BY rank ASC LIMIT ?`).replace(
      "SELECT channel_messages.id,",
      "SELECT channel_messages.id, bm25(channel_messages_fts) AS rank,",
    ),
  ).all(...params, clampSearchLimit(opts.limit));
  return rows.map((row) => ({
    id: row.id,
    sentAt: row.sent_at,
    channelId: row.channel_id,
    channelName: row.channel_name,
    from: row.from_role_name ? { displayId: row.from_role_name, name: row.from_role_name } : null,
    bodyPreview: searchPreview(row.body, opts.q),
    parentMessageId: row.parent_message_id,
    rootMessageId: row.root_message_id,
    rank: row.rank,
  }));
}

type KanbanSearchBaseRow = KanbanTaskRow & { rank: number };
type KanbanCommentSearchBaseRow = KanbanTaskRow & { comment_id: number; comment_author: string; comment_type: KanbanCommentType; comment_body: string; comment_created_at: string; rank: number };
type KanbanEpicSearchBaseRow = KanbanEpicRow & { rank: number };
type KanbanEpicCommentSearchBaseRow = KanbanEpicRow & { comment_id: number; comment_author: string; comment_type: KanbanCommentType; comment_body: string; comment_created_at: string; rank: number };

export function searchKanbanTasks(db: Database, opts: {
  q: string;
  status?: KanbanStatus | null;
  assignedRoleId?: string | null;
  includeArchived: boolean;
  limit: number;
}): KanbanTaskSearchRow[] {
  const limit = clampSearchLimit(opts.limit);
  const query = fts5EscapeQuery(opts.q);
  const baseClauses: string[] = [];
  const baseParams: Array<string | number | null> = [];
  if (!opts.includeArchived) baseClauses.push("kanban_tasks.archived_at IS NULL");
  if (opts.status) {
    baseClauses.push("kanban_tasks.status = ?");
    baseParams.push(normalizeKanbanStatus(opts.status));
  }
  if (opts.assignedRoleId) {
    baseClauses.push("kanban_tasks.assigned_role_id = ?");
    baseParams.push(opts.assignedRoleId);
  }
  const filter = baseClauses.length ? `AND ${baseClauses.join(" AND ")}` : "";
  const byFields = db.query<KanbanSearchBaseRow, Array<string | number | null>>(
    kanbanTaskSelectSql(`JOIN kanban_tasks_fts ON kanban_tasks_fts.rowid = kanban_tasks.id WHERE kanban_tasks_fts MATCH ? ${filter} ORDER BY rank ASC LIMIT ?`).replace(
      "SELECT kanban_tasks.id,",
      "SELECT kanban_tasks.id, bm25(kanban_tasks_fts) AS rank,",
    ),
  ).all(query, ...baseParams, limit);
  const byComments = db.query<KanbanCommentSearchBaseRow, Array<string | number | null>>(
    kanbanTaskSelectSql(`JOIN kanban_comments ON kanban_comments.task_id = kanban_tasks.id JOIN kanban_comments_fts ON kanban_comments_fts.rowid = kanban_comments.id LEFT JOIN agents AS comment_role ON comment_role.id = kanban_comments.role_id LEFT JOIN workspace_repos AS comment_repo ON comment_repo.id = comment_role.repo_id WHERE kanban_comments_fts MATCH ? ${filter} ORDER BY rank ASC, kanban_comments.id DESC LIMIT ?`).replace(
      "SELECT kanban_tasks.id,",
      "SELECT kanban_tasks.id, kanban_comments.id AS comment_id, COALESCE(comment_repo.name || ':' || comment_role.name, kanban_comments.actor_display, '(deleted)') AS comment_author, kanban_comments.type AS comment_type, kanban_comments.body AS comment_body, kanban_comments.created_at AS comment_created_at, bm25(kanban_comments_fts) AS rank,",
    ),
  ).all(query, ...baseParams, limit);
  const merged = new Map<number, KanbanTaskSearchRow>();
  for (const row of byFields) {
    merged.set(row.id, {
      displayId: row.display_id,
      title: row.title,
      status: row.status,
      priority: row.priority,
      assignee: row.assigned_role_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      matchedIn: matchedKanbanFields(row, opts.q),
      bodyPreview: searchPreview(`${row.display_id} ${row.title} ${row.details}`, opts.q),
      rank: row.rank,
    });
  }
  for (const row of byComments) {
    const existing = merged.get(row.id);
    const target = existing ?? {
      displayId: row.display_id,
      title: row.title,
      status: row.status,
      priority: row.priority,
      assignee: row.assigned_role_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      matchedIn: [],
      bodyPreview: searchPreview(row.comment_body, opts.q),
      rank: row.rank,
    };
    if (!target.matchedIn.includes("comments")) target.matchedIn.push("comments");
    target.rank = Math.min(target.rank, row.rank);
    target.matchingComment ??= { id: row.comment_id, author: row.comment_author, type: row.comment_type, bodyPreview: searchPreview(row.comment_body, opts.q), createdAt: row.comment_created_at };
    merged.set(row.id, target);
  }
  return [...merged.values()].sort((a, b) => a.rank - b.rank).slice(0, limit);
}

export function searchKanbanEpics(db: Database, opts: {
  q: string;
  status?: KanbanStatus | null;
  assignedRoleId?: string | null;
  includeArchived: boolean;
  limit: number;
}): KanbanEpicSearchRow[] {
  const limit = clampSearchLimit(opts.limit);
  const query = fts5EscapeQuery(opts.q);
  const baseClauses: string[] = [];
  const baseParams: Array<string | number | null> = [];
  if (!opts.includeArchived) baseClauses.push("kanban_epics.archived_at IS NULL");
  if (opts.status) {
    baseClauses.push("kanban_epics.status = ?");
    baseParams.push(normalizeKanbanStatus(opts.status));
  }
  if (opts.assignedRoleId) {
    baseClauses.push("kanban_epics.assigned_role_id = ?");
    baseParams.push(opts.assignedRoleId);
  }
  const filter = baseClauses.length ? `AND ${baseClauses.join(" AND ")}` : "";
  const byFields = db.query<KanbanEpicSearchBaseRow, Array<string | number | null>>(
    kanbanEpicSelectSql(`JOIN kanban_epics_fts ON kanban_epics_fts.rowid = kanban_epics.id WHERE kanban_epics_fts MATCH ? ${filter} ORDER BY rank ASC LIMIT ?`).replace(
      "SELECT kanban_epics.id,",
      "SELECT kanban_epics.id, bm25(kanban_epics_fts) AS rank,",
    ),
  ).all(query, ...baseParams, limit);
  const byComments = db.query<KanbanEpicCommentSearchBaseRow, Array<string | number | null>>(
    kanbanEpicSelectSql(`JOIN kanban_epic_comments ON kanban_epic_comments.epic_id = kanban_epics.id JOIN kanban_epic_comments_fts ON kanban_epic_comments_fts.rowid = kanban_epic_comments.id LEFT JOIN agents AS comment_role ON comment_role.id = kanban_epic_comments.role_id LEFT JOIN workspace_repos AS comment_repo ON comment_repo.id = comment_role.repo_id WHERE kanban_epic_comments_fts MATCH ? ${filter} ORDER BY rank ASC, kanban_epic_comments.id DESC LIMIT ?`).replace(
      "SELECT kanban_epics.id,",
      "SELECT kanban_epics.id, kanban_epic_comments.id AS comment_id, COALESCE(comment_repo.name || ':' || comment_role.name, kanban_epic_comments.actor_display, '(deleted)') AS comment_author, kanban_epic_comments.type AS comment_type, kanban_epic_comments.body AS comment_body, kanban_epic_comments.created_at AS comment_created_at, bm25(kanban_epic_comments_fts) AS rank,",
    ),
  ).all(query, ...baseParams, limit);
  const merged = new Map<number, KanbanEpicSearchRow>();
  for (const row of byFields) {
    merged.set(row.id, {
      displayId: row.display_id,
      title: row.title,
      status: row.status,
      priority: row.priority,
      assignee: row.assigned_role_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      matchedIn: matchedKanbanFields(row, opts.q),
      bodyPreview: searchPreview(`${row.display_id} ${row.title} ${row.details}`, opts.q),
      rank: row.rank,
    });
  }
  for (const row of byComments) {
    const existing = merged.get(row.id);
    const target = existing ?? {
      displayId: row.display_id,
      title: row.title,
      status: row.status,
      priority: row.priority,
      assignee: row.assigned_role_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      matchedIn: [],
      bodyPreview: searchPreview(row.comment_body, opts.q),
      rank: row.rank,
    };
    if (!target.matchedIn.includes("comments")) target.matchedIn.push("comments");
    target.rank = Math.min(target.rank, row.rank);
    target.matchingComment ??= { id: row.comment_id, author: row.comment_author, type: row.comment_type, bodyPreview: searchPreview(row.comment_body, opts.q), createdAt: row.comment_created_at };
    merged.set(row.id, target);
  }
  return [...merged.values()].sort((a, b) => a.rank - b.rank).slice(0, limit);
}

export function getRuntimeSettings(db: Database): RuntimeSettings {
  return {
    globalDefaultHost: normalizeHostTypeOrNull(getSetting(db, RUNTIME_GLOBAL_DEFAULT_HOST_KEY)),
    commands: getRuntimeCommands(db),
  };
}

export function setRuntimeSettings(db: Database, input: unknown): RuntimeSettings {
  const value = input && typeof input === "object" ? input as Partial<{ globalDefaultHost: unknown; commands: unknown }> : {};
  const globalDefaultHost = normalizeHostTypeOrNull(value.globalDefaultHost);
  const commands = normalizeRuntimeCommands(value.commands, getRuntimeCommands(db));
  setSetting(db, RUNTIME_GLOBAL_DEFAULT_HOST_KEY, globalDefaultHost ?? "");
  setSetting(db, RUNTIME_COMMANDS_KEY, JSON.stringify(commands));
  return { globalDefaultHost, commands };
}

export function getChatHistorySettings(db: Database): ChatHistorySettings {
  const stored = getSetting(db, CHAT_HISTORY_RETENTION_DAYS_KEY);
  return { retentionDays: stored == null ? DEFAULT_CHAT_HISTORY_RETENTION_DAYS : normalizeChatHistoryRetentionDays(stored, DEFAULT_CHAT_HISTORY_RETENTION_DAYS) };
}

export function setChatHistorySettings(db: Database, input: unknown): ChatHistorySettings {
  const value = input && typeof input === "object" ? input as Partial<{ retentionDays: unknown }> : {};
  const retentionDays = normalizeChatHistoryRetentionDays(value.retentionDays, DEFAULT_CHAT_HISTORY_RETENTION_DAYS);
  setSetting(db, CHAT_HISTORY_RETENTION_DAYS_KEY, retentionDays == null ? "forever" : String(retentionDays));
  return { retentionDays };
}

export function getMessageSettings(db: Database): MessageSettings {
  const stored = getSetting(db, MESSAGE_MAX_BODY_CHARS_KEY);
  return { maxBodyChars: normalizeMessageMaxBodyChars(stored, DEFAULT_MESSAGE_MAX_BODY_CHARS) };
}

export function setMessageSettings(db: Database, input: unknown): MessageSettings {
  const value = input && typeof input === "object" ? input as Partial<{ maxBodyChars: unknown }> : {};
  const maxBodyChars = normalizeMessageMaxBodyChars(value.maxBodyChars, DEFAULT_MESSAGE_MAX_BODY_CHARS);
  setSetting(db, MESSAGE_MAX_BODY_CHARS_KEY, String(maxBodyChars));
  return { maxBodyChars };
}

export function pruneChatHistoryByRetention(db: Database, now: Date = new Date()): ChatHistoryCleanupResult {
  const { retentionDays } = getChatHistorySettings(db);
  if (retentionDays == null) return { messages: 0, channelMessages: 0, total: 0 };
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  return pruneChatHistoryBefore(db, cutoff);
}

export function pruneChatHistoryBefore(db: Database, cutoffIso: string): ChatHistoryCleanupResult {
  let messages = 0;
  let channelMessages = 0;
  db.transaction(() => {
    messages = db.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM messages WHERE sent_at < ?").get(cutoffIso)?.count ?? 0;
    channelMessages = db.query<{ count: number }, [string]>(
      `WITH RECURSIVE doomed(id) AS (
         SELECT id FROM channel_messages WHERE sent_at < ?
         UNION
         SELECT channel_messages.id
         FROM channel_messages
         JOIN doomed ON channel_messages.parent_message_id = doomed.id OR channel_messages.root_message_id = doomed.id
       )
       SELECT COUNT(*) AS count FROM doomed`,
    ).get(cutoffIso)?.count ?? 0;
    db.run("DELETE FROM messages WHERE sent_at < ?", [cutoffIso]);
    db.run(
      `WITH RECURSIVE doomed(id) AS (
         SELECT id FROM channel_messages WHERE sent_at < ?
         UNION
         SELECT channel_messages.id
         FROM channel_messages
         JOIN doomed ON channel_messages.parent_message_id = doomed.id OR channel_messages.root_message_id = doomed.id
       )
       DELETE FROM channel_messages WHERE id IN (SELECT id FROM doomed)`,
      [cutoffIso],
    );
  })();
  return { messages, channelMessages, total: messages + channelMessages };
}

export function clearChatHistory(db: Database): ChatHistoryCleanupResult {
  const messages = db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM messages").get()?.count ?? 0;
  const channelMessages = db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM channel_messages").get()?.count ?? 0;
  db.transaction(() => {
    db.run("DELETE FROM messages");
    db.run("DELETE FROM channel_reads");
    db.run("DELETE FROM channel_messages");
  })();
  return { messages, channelMessages, total: messages + channelMessages };
}

export function setRoleDefaultHost(db: Database, roleName: string, host: unknown): AgentRow {
  const value = normalizeHostTypeOrNull(host);
  const role = getRoleByName(db, roleName);
  if (!role) throw new Error(`Unknown role: ${roleName}`);
  db.run(
    "UPDATE agents SET host_default = ?, default_host_type = ?, updated_at = ? WHERE name = ?",
    [value ?? "claude-code", value, nowIso(), roleName],
  );
  const updated = getRoleByName(db, roleName);
  if (!updated) throw new Error(`Unknown role: ${roleName}`);
  return updated;
}

/**
 * EP-DEC-RUN WA-004 (advisor msg #18): id-keyed default-runtime setter
 * for the new `/roles-by-id/:id/default-runtime` route. Bare-name keying
 * via `setRoleDefaultHost` would update the wrong repo's row once WA-006
 * permits duplicate role names across repos. Returns the bare role.name
 * after update so the caller can re-resolve via the DAO if needed.
 */
export function setRoleDefaultHostByIdRaw(db: Database, roleId: string, host: unknown): { id: string; name: string; host_default: HostType | null } {
  const value = normalizeHostTypeOrNull(host);
  db.run(
    "UPDATE agents SET host_default = ?, default_host_type = ?, updated_at = ? WHERE id = ?",
    [value ?? "claude-code", value, nowIso(), roleId],
  );
  const after = db.query<{ id: string; name: string; host_default: HostType | null }, [string]>(
    "SELECT id, name, host_default FROM agents WHERE id = ?",
  ).get(roleId);
  if (!after) throw new Error(`Unknown role id: ${roleId}`);
  return after;
}

function replaceKanbanDependencies(db: Database, taskId: number, dependsOnTaskIds: Array<string | number>, actorRoleId: string, actorSessionId: string | null): void {
  const before = listKanbanDependencies(db, taskId).map((dependency) => dependency.depends_on_display_id);
  const dependencyIds = [...new Set(dependsOnTaskIds.map((id) => {
    const task = getKanbanTask(db, id);
    if (!task) throw new Error(`kanban dependency was not found: ${id}`);
    if (task.id === taskId) throw new Error("kanban task cannot depend on itself");
    return task.id;
  }))];

  db.run("DELETE FROM kanban_dependencies WHERE task_id = ?", [taskId]);
  const createdByDisplay = computeRoleDisplay(db, actorRoleId);
  const insert = db.query<unknown, [number, number, string, string | null, string]>(
    `INSERT INTO kanban_dependencies (task_id, depends_on_task_id, created_by_role_id, created_by_display, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(task_id, depends_on_task_id) DO NOTHING`,
  );
  for (const dependencyId of dependencyIds) insert.run(taskId, dependencyId, actorRoleId, createdByDisplay, nowIso());
  const after = listKanbanDependencies(db, taskId).map((dependency) => dependency.depends_on_display_id);
  if (before.join("\0") !== after.join("\0")) {
    insertKanbanActivity(db, { taskId, roleId: actorRoleId, sessionId: actorSessionId, action: "updated", field: "dependencies", before, after });
    db.run("UPDATE kanban_tasks SET updated_at = ? WHERE id = ?", [nowIso(), taskId]);
  }
}

function insertKanbanActivity(db: Database, input: { taskId: number; roleId: string; sessionId: string | null; action: string; field: string | null; before: unknown; after: unknown }): KanbanActivityRow {
  const actorDisplay = computeRoleDisplay(db, input.roleId);
  const result = db.query<unknown, [number, string, string | null, string | null, string, string | null, string | null, string | null, string]>(
    `INSERT INTO kanban_activity (task_id, role_id, session_id, actor_display, action, field, before_json, after_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
  ).get(
    input.taskId,
    input.roleId,
    input.sessionId,
    actorDisplay,
    normalizeRequiredText(input.action, "action", 100),
    input.field,
    input.before === undefined || input.before === null ? null : JSON.stringify(input.before),
    input.after === undefined || input.after === null ? null : JSON.stringify(input.after),
    nowIso(),
  ) as { id: number } | null;
  if (!result) throw new Error("failed to insert kanban activity");
  const activity = db.query<KanbanActivityRow, [number]>(kanbanActivitySelectSql("WHERE kanban_activity.id = ?")).get(result.id);
  if (!activity) throw new Error("inserted kanban activity was not found");
  return activity;
}

function getKanbanCommentById(db: Database, id: number): KanbanCommentRow | null {
  return db.query<KanbanCommentRow, [number]>(kanbanCommentSelectSql("WHERE kanban_comments.id = ?")).get(Math.floor(Number(id))) ?? null;
}

function getKanbanNotificationById(db: Database, id: number): KanbanNotificationRow | null {
  return db.query<KanbanNotificationRow, [number]>(kanbanNotificationSelectSql("WHERE kanban_notifications.id = ?")).get(Math.floor(Number(id))) ?? null;
}

function getKanbanEpicCommentById(db: Database, id: number): KanbanEpicCommentRow | null {
  return db.query<KanbanEpicCommentRow, [number]>(kanbanEpicCommentSelectSql("WHERE kanban_epic_comments.id = ?")).get(Math.floor(Number(id))) ?? null;
}

function getKanbanEpicNotificationById(db: Database, id: number): KanbanEpicNotificationRow | null {
  return db.query<KanbanEpicNotificationRow, [number]>(kanbanEpicNotificationSelectSql("WHERE kanban_epic_notifications.id = ?")).get(Math.floor(Number(id))) ?? null;
}

function insertKanbanEpicActivity(db: Database, input: { epicId: number; roleId: string; sessionId: string | null; action: string; field: string | null; before: unknown; after: unknown }): KanbanEpicActivityRow {
  const actorDisplay = computeRoleDisplay(db, input.roleId);
  const result = db.query<unknown, [number, string, string | null, string | null, string, string | null, string | null, string | null, string]>(
    `INSERT INTO kanban_epic_activity (epic_id, role_id, session_id, actor_display, action, field, before_json, after_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
  ).get(
    input.epicId,
    input.roleId,
    input.sessionId,
    actorDisplay,
    normalizeRequiredText(input.action, "action", 100),
    input.field,
    input.before === undefined || input.before === null ? null : JSON.stringify(input.before),
    input.after === undefined || input.after === null ? null : JSON.stringify(input.after),
    nowIso(),
  ) as { id: number } | null;
  if (!result) throw new Error("failed to insert kanban epic activity");
  const activity = db.query<KanbanEpicActivityRow, [number]>(kanbanEpicActivitySelectSql("WHERE kanban_epic_activity.id = ?")).get(result.id);
  if (!activity) throw new Error("inserted kanban epic activity was not found");
  return activity;
}

function normalizeRequiredText(value: unknown, name: string, maxChars: number): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${name} is required`);
  if (text.length > maxChars) throw new Error(`${name} must be ${maxChars} characters or fewer`);
  return text;
}

function normalizeOptionalText(value: unknown, maxChars: number): string {
  const text = String(value ?? "").trim();
  if (text.length > maxChars) throw new Error(`text must be ${maxChars} characters or fewer`);
  return text;
}

function normalizeNullableText(value: unknown, maxChars: number): string | null {
  if (value === null) return null;
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length > maxChars) throw new Error(`text must be ${maxChars} characters or fewer`);
  return text;
}

function normalizeNullableHttpUrl(value: unknown, maxChars: number, name: string): string | null {
  const text = normalizeNullableText(value, maxChars);
  if (text === null) return null;
  if (!/^https?:\/\//i.test(text)) throw new Error(`${name} must start with http:// or https://`);
  return text;
}

function normalizeNullableInteger(value: unknown, name: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`);
  return number;
}

export function normalizeKanbanTaskIdPrefix(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === "") return fallback;
  const prefix = String(value).trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{0,11}$/.test(prefix)) throw new Error("kanban task id prefix must be 1-12 letters/numbers and start with a letter");
  return prefix;
}

function normalizeKanbanEpicIdPrefix(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === "") return fallback;
  const prefix = String(value).trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{0,11}$/.test(prefix)) throw new Error("kanban epic id prefix must be 1-12 letters/numbers and start with a letter");
  return prefix;
}

function normalizeKanbanStatus(value: unknown): KanbanStatus {
  if (value === "Backlog" || value === "Queued" || value === "In Progress" || value === "Blocked" || value === "Review" || value === "Completed") return value;
  throw new Error("kanban status must be Backlog, Queued, In Progress, Blocked, Review, or Completed");
}

function normalizeKanbanPriority(value: unknown): KanbanPriority {
  if (value === "P0" || value === "P1" || value === "P2" || value === "P3") return value;
  throw new Error("kanban priority must be P0, P1, P2, or P3");
}

function normalizeKanbanEffort(value: unknown): KanbanEffort {
  if (KANBAN_EFFORTS.includes(value as KanbanEffort)) return value as KanbanEffort;
  throw new Error("kanban effort must be XS, S, M, L, or XL");
}

function normalizeKanbanCommentType(value: unknown): KanbanCommentType {
  if (value === "progress" || value === "note" || value === "blocker") return value;
  throw new Error("kanban comment type must be progress, note, or blocker");
}

function getRuntimeCommands(db: Database): RuntimeCommands {
  const stored = getSetting(db, RUNTIME_COMMANDS_KEY);
  if (!stored) return DEFAULT_RUNTIME_COMMANDS;
  try {
    return normalizeRuntimeCommands(JSON.parse(stored), DEFAULT_RUNTIME_COMMANDS);
  } catch {
    return DEFAULT_RUNTIME_COMMANDS;
  }
}

export function normalizeRuntimeCommands(input: unknown, fallback: RuntimeCommands): RuntimeCommands {
  const value = input && typeof input === "object" ? input as Partial<Record<keyof RuntimeCommands, unknown>> : {};
  return {
    claudeCode: normalizeRuntimeCommand(value.claudeCode, fallback.claudeCode),
    openCode: normalizeRuntimeCommand(value.openCode, fallback.openCode),
    codex: normalizeRuntimeCommand(value.codex, fallback.codex),
    pi: normalizeRuntimeCommand(value.pi, fallback.pi),
  };
}

function normalizeRuntimeCommand(input: unknown, fallback: RuntimeCommandConfig): RuntimeCommandConfig {
  const value = input && typeof input === "object" ? input as Partial<RuntimeCommandConfig> : {};
  const command = typeof value.command === "string" && value.command.trim() ? value.command.trim().slice(0, 1000) : fallback.command;
  const args = Array.isArray(value.args) ? value.args.filter((arg): arg is string => typeof arg === "string").map((arg) => arg.slice(0, 4000)) : fallback.args;
  const enabled = typeof value.enabled === "boolean" ? value.enabled : fallback.enabled;
  return { command, args, enabled };
}

function normalizeChatHistoryRetentionDays(value: unknown, fallback: number | null): number | null {
  if (value === null || value === "forever") return null;
  if (value === undefined || value === "") return fallback;
  const days = Number(value);
  if (!Number.isFinite(days) || !Number.isInteger(days) || days < 1 || days > 3650) throw new Error("chat history retention must be forever or 1-3650 days");
  return days;
}

function normalizeMessageMaxBodyChars(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const chars = Number(value);
  if (!Number.isFinite(chars) || !Number.isInteger(chars) || chars < 1 || chars > DEFAULT_MESSAGE_MAX_BODY_CHARS) {
    throw new Error(`message length limit must be 1-${DEFAULT_MESSAGE_MAX_BODY_CHARS} characters`);
  }
  return chars;
}

function normalizePolicyMode(value: unknown): PolicyMode {
  if (value === "strict-star" || value === "loose-star" || value === "star") return "star";
  return value === "peer-to-peer" || value === "channel" ? value : DEFAULT_POLICY_MODE;
}

function normalizePeerRuleMode(value: unknown): PeerRuleMode {
  return value === "allow-list" || value === "deny-list" ? value : DEFAULT_PEER_RULE_MODE;
}

function normalizeHostTypeOrNull(value: unknown): HostType | null {
  return value === "claude-code" || value === "opencode" || value === "codex" || value === "pi" ? value : null;
}

export function setMainRole(db: Database, roleName: string): AgentRow {
  const role = getRoleByName(db, roleName);
  if (!role) throw new Error(`Unknown role: ${roleName}`);
  setSetting(db, "main_role_id", role.id);
  return role;
}

export function clearMainRole(db: Database): void {
  db.run("DELETE FROM settings WHERE key = ?", ["main_role_id"]);
}

export function getMainAgent(db: Database): AgentRow | null {
  const id = getSetting(db, "main_role_id");
  if (!id) return null;
  return db.query<AgentRow, [string]>(
    `${agentSelectSql()} WHERE r.id = ?`,
  ).get(id) ?? null;
}

// Re-export the address parser from `workspace-decoupling-dao.ts` so the
// many existing import-from-`db.ts` callers can adopt `repo:role` parsing
// without yet another module-path churn.
export { parseRoleAddress, buildRoleDisplayId, type ParsedRoleAddress } from "./workspace-decoupling-dao.ts";

/**
 * Look up the canonical `<repo>:<role>` display id for a role row by id.
 * Returns null when the id does not resolve. Used at write time in
 * messaging/channel/kanban insert paths so historical rows render
 * correctly after the live FK is nulled out by ON DELETE SET NULL.
 */
export function computeRoleDisplay(db: Database, roleId: string | null | undefined): string | null {
  if (!roleId) return null;
  const row = db.query<{ display: string }, [string]>(
    `SELECT p.name || ':' || r.name AS display
     FROM agents r JOIN workspace_repos p ON p.id = r.repo_id
     WHERE r.id = ?`,
  ).get(roleId);
  return row?.display ?? null;
}

/**
 * Compat SELECT: project the new repo+role schema into the legacy
 * `AgentRow` shape so existing callers (snapshot, listAgents, runner reconcile,
 * messaging/kanban handlers) keep working without an in-place rewrite.
 * `path` + `git_root` come from the role's repo and `last_discovered_at` is null. Replaced wholesale
 * by `RoleWithDisplayRow` queries in `workspace-decoupling-dao.ts` once the
 * EP-DEC-2 API cutover (WA-066) lands.
 */
function agentSelectSql(): string {
  return `SELECT
    r.id              AS id,
    r.name            AS name,
    p.absolute_path   AS path,
    p.git_root        AS git_root,
    r.default_host_type AS host_default,
    p.missing_at      AS missing_at,
    NULL              AS last_discovered_at,
    r.created_at      AS created_at,
    r.updated_at      AS updated_at,
    r.repo_id         AS repo_id,
    p.name            AS repo_name,
    p.name || ':' || r.name AS display_id
  FROM agents r
  JOIN workspace_repos p ON p.id = r.repo_id`;
}

export function recordRunnerLaunch(db: Database, record: RunnerLaunchRecord): void {
  db.transaction(() => {
    db.run(
      `INSERT INTO sessions (id, role_id, host_type, pid, child_pid, runner_pid, status, cwd, started_at, last_seen, summary)
       VALUES (?, ?, ?, NULL, NULL, ?, 'running', ?, ?, ?, '')`,
      [record.sessionId, record.roleId, record.hostType, record.runnerPid, record.cwd, record.startedAt, record.startedAt],
    );
    db.run(
      `INSERT INTO agent_locks (agent_id, session_id, acquired_at) VALUES (?, ?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET session_id = excluded.session_id, acquired_at = excluded.acquired_at`,
      [record.roleId, record.sessionId, record.startedAt],
    );
    db.run(
      `INSERT INTO runners (agent_id, session_id, runner_pid, socket_path, metadata_path, status, started_at, last_seen)
       VALUES (?, ?, ?, ?, ?, 'running', ?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET
         session_id = excluded.session_id,
         runner_pid = excluded.runner_pid,
         socket_path = excluded.socket_path,
         metadata_path = excluded.metadata_path,
         status = excluded.status,
         started_at = excluded.started_at,
         last_seen = excluded.last_seen`,
      [record.roleId, record.sessionId, record.runnerPid, record.socketPath, record.metadataPath, record.startedAt, record.startedAt],
    );
  })();
}

export function stopRunnerSession(db: Database, roleId: string, sessionId: string): void {
  const ts = nowIso();
  db.transaction(() => {
    db.run(
      "UPDATE sessions SET status = 'stopped', ended_at = COALESCE(ended_at, ?), last_seen = ? WHERE id = ?",
      [ts, ts, sessionId],
    );
    db.run("DELETE FROM agent_locks WHERE agent_id = ? AND session_id = ?", [roleId, sessionId]);
    db.run("DELETE FROM runners WHERE agent_id = ? AND session_id = ?", [roleId, sessionId]);
  })();
}

export function insertMessage(db: Database, input: MessageInput): MessageRow {
  const ts = nowIso();
  const deliveryKind = input.deliveryKind === "broadcast" ? "broadcast" : "direct";
  // Human-origin sends carry no `from_role_id`. Stamp `from_display = 'human-web'`
  // so renderer fallbacks distinguish "web user sent this" from "role was deleted".
  // The `to` side may be a sentinel string (e.g. `human-web` for agent →
  // human-web messaging in star/p2p — EP-DEC-3). Sentinels are NOT real
  // role rows, so to satisfy the `messages.to_role_id` FK we translate
  // them to NULL and stash the sentinel value in `to_display` instead.
  const fromDisplay = input.fromRoleId
    ? computeRoleDisplay(db, input.fromRoleId)
    : "human-web";
  const toIsSentinel = input.toRoleId === "human-web" || !input.toRoleId;
  const toRoleIdForFk = toIsSentinel ? null : input.toRoleId;
  const toDisplay = toIsSentinel
    ? "human-web"
    : (computeRoleDisplay(db, input.toRoleId) ?? null);
  const result = db.query<unknown, [string, string | null, string | null, string | null, string | null, string | null, string | null, string, MessageState, MessageDeliveryKind, string | null, string, string | null]>(
    `INSERT INTO messages (thread_id, from_role_id, to_role_id, from_session_id, to_session_id, from_display, to_display, body, state, delivery_kind, broadcast_id, sent_at, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
  ).get(input.threadId, input.fromRoleId, toRoleIdForFk, input.fromSessionId, input.toSessionId, fromDisplay, toDisplay, input.body, input.state, deliveryKind, input.broadcastId ?? null, ts, input.error ?? null) as { id: number } | null;
  if (!result) throw new Error("failed to insert message");
  const message = getMessageById(db, result.id);
  if (!message) throw new Error("inserted message was not found");
  return message;
}

export function getMessageById(db: Database, id: number): MessageRow | null {
  return db.query<MessageRow, [number]>(messageSelectSql("WHERE messages.id = ?")).get(id) ?? null;
}

export function listMessages(db: Database, opts: { roleId?: string; limit?: number; latest?: boolean; beforeId?: number; sinceId?: number } = {}): MessageRow[] {
  const limit = Math.max(1, Math.min(500, Math.floor(opts.limit ?? 100)));
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (opts.roleId) {
    clauses.push("(messages.from_role_id = ? OR messages.to_role_id = ?)");
    params.push(opts.roleId, opts.roleId);
  }
  const sinceId = Math.floor(Number(opts.sinceId ?? 0));
  const beforeId = Math.floor(Number(opts.beforeId ?? 0));
  if (sinceId > 0) {
    clauses.push("messages.id > ?");
    params.push(sinceId);
  }
  if (beforeId > 0) {
    clauses.push("messages.id < ?");
    params.push(beforeId);
  }
  const latest = (opts.latest ?? true) && sinceId <= 0;
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const order = latest ? "ORDER BY messages.id DESC" : "ORDER BY messages.id ASC";
  const rows = db.query<MessageRow, Array<string | number>>(messageSelectSql(`${where} ${order} LIMIT ?`)).all(...params, limit);
  return latest ? rows.reverse() : rows;
}

export function deliverPendingMessages(db: Database, roleId: string, sessionId: string, limit = 50): MessageRow[] {
  const rows = listPendingMessages(db, roleId, sessionId, limit);
  return markMessagesDelivered(db, roleId, sessionId, rows.map((row) => row.id));
}

export function listPendingMessages(db: Database, roleId: string, sessionId: string, limit = 50): MessageRow[] {
  const rows = db.query<{ id: number }, [string, string, number]>(
    `SELECT id FROM messages
     WHERE to_role_id = ? AND to_session_id = ? AND state = 'pending'
     ORDER BY id ASC LIMIT ?`,
  ).all(roleId, sessionId, Math.max(1, Math.min(100, Math.floor(limit))));
  return rows.map((row) => getMessageById(db, row.id)).filter((row): row is MessageRow => Boolean(row));
}

/**
 * EP-030 / WA-123: agent-inbox source. Returns rows in `pending` OR `pushed`
 * state for the current role/session, plus rows stranded on a session that is
 * no longer the role's active runner. This lets Stop+Launch recover
 * pushed-but-unacked rows instead of binding them forever to the dead session id.
 */
export function listAgentInboxRows(db: Database, roleId: string, sessionId: string, limit = 50): MessageRow[] {
  const rows = db.query<{ id: number }, [string, string, number]>(
    `SELECT id FROM messages
     WHERE to_role_id = ?
       AND state IN ('pending', 'pushed')
       AND to_session_id IS NOT NULL
       AND (
         to_session_id = ?
         OR NOT EXISTS (
           SELECT 1 FROM runners
           WHERE runners.agent_id = messages.to_role_id
             AND runners.session_id = messages.to_session_id
             AND runners.status = 'running'
         )
       )
     ORDER BY id ASC LIMIT ?`,
  ).all(roleId, sessionId, Math.max(1, Math.min(100, Math.floor(limit))));
  return rows.map((row) => getMessageById(db, row.id)).filter((row): row is MessageRow => Boolean(row));
}

/**
 * EP-030: native-push plugins (opencode, claude) call this AFTER a successful
 * `tui.appendPrompt`+`tui.submitPrompt` (or equivalent) round-trip. SDK
 * "success" only means the runtime accepted the prompt — the LLM consumption
 * step is unobservable. Marking pushed (not delivered) keeps the row eligible
 * for redelivery via `listAgentInboxRows` if the LLM never sees the body.
 *
 * Idempotent: only transitions `pending → pushed`. Returns the rows actually
 * transitioned (empty if all ids are already `pushed`/`delivered`/etc). Pending
 * rows stranded on a previous inactive runner session are claimed by the
 * current session when pushed again.
 */
/**
 * EP-030 / WA-139: workspace-wide push-state stats for the Diagnostics panel.
 * - `pending` — rows still in `state='pending'`, no plugin push attempted yet.
 * - `pushed` — rows where the plugin reported success but the agent's
 *   check_messages has not flipped delivered yet. A growing count signals
 *   the silent-loss surface that EP-030 protects against.
 * - `oldestPushedAt` — earliest `pushed_at` among pushed rows (ISO string),
 *   or `null` when count is zero. Operator signal for stuck pile-up.
 * Channel + kanban rows are out of scope (separate state tables).
 */
export interface PushStateStats {
  pending: number;
  pushed: number;
  oldestPushedAt: string | null;
}

export function getPushStateStats(db: Database): PushStateStats {
  // EP-030 / advisor review fix #4: only count rows that actually go
  // through the native-push pipeline. `to_role_id IS NOT NULL` excludes
  // human-web sentinel addressees (sendFleetMessage stashes those as a
  // `to_display='human-web'` with FK NULL), and `to_session_id IS NOT
  // NULL` excludes rows queued for offline targets that no plugin will
  // ever push from. Both shapes can sit in `state='pending'` indefinitely
  // and would otherwise inflate the operator-facing counter.
  const counts = db.query<{ state: string; count: number }, []>(
    `SELECT state, COUNT(*) AS count FROM messages
      WHERE state IN ('pending', 'pushed')
        AND to_role_id IS NOT NULL
        AND to_session_id IS NOT NULL
      GROUP BY state`,
  ).all();
  const oldest = db.query<{ pushed_at: string | null }, []>(
    `SELECT MIN(pushed_at) AS pushed_at FROM messages
      WHERE state = 'pushed'
        AND to_role_id IS NOT NULL
        AND to_session_id IS NOT NULL`,
  ).get();
  let pending = 0;
  let pushed = 0;
  for (const row of counts) {
    if (row.state === "pending") pending = Number(row.count);
    else if (row.state === "pushed") pushed = Number(row.count);
  }
  return { pending, pushed, oldestPushedAt: oldest?.pushed_at ?? null };
}

export function markMessagesPushed(db: Database, roleId: string, sessionId: string, messageIds: number[]): MessageRow[] {
  const ids = [...new Set(messageIds.map((id) => Math.floor(Number(id))).filter((id) => Number.isFinite(id) && id > 0))];
  if (ids.length === 0) return [];
  const ts = nowIso();
  const pushed: number[] = [];
  db.transaction(() => {
    const update = db.query<{ id: number }, [string, string, number, string, string]>(
      `UPDATE messages
       SET state = 'pushed', pushed_at = ?, to_session_id = ?
       WHERE id = ?
         AND to_role_id = ?
         AND state = 'pending'
         AND to_session_id IS NOT NULL
         AND (
           to_session_id = ?
           OR NOT EXISTS (
             SELECT 1 FROM runners
             WHERE runners.agent_id = messages.to_role_id
               AND runners.session_id = messages.to_session_id
               AND runners.status = 'running'
           )
         )
       RETURNING id`,
    );
    for (const id of ids) {
      const row = update.get(ts, sessionId, id, roleId, sessionId);
      if (row) pushed.push(row.id);
    }
  })();
  return pushed.map((id) => getMessageById(db, id)).filter((row): row is MessageRow => Boolean(row));
}

export function markMessagesDelivered(db: Database, roleId: string, sessionId: string, messageIds: number[]): MessageRow[] {
  const ids = [...new Set(messageIds.map((id) => Math.floor(Number(id))).filter((id) => Number.isFinite(id) && id > 0))];
  if (ids.length === 0) return [];
  const ts = nowIso();
  const delivered: number[] = [];
  db.transaction(() => {
    const update = db.query<{ id: number }, [string, string, number, string, string]>(
      `UPDATE messages
       SET state = 'delivered', delivered_at = ?, acked_at = COALESCE(acked_at, ?)
       WHERE id = ? AND to_role_id = ? AND to_session_id = ? AND state = 'pending'
       RETURNING id`,
    );
    for (const id of ids) {
      const row = update.get(ts, ts, id, roleId, sessionId);
      if (row) delivered.push(row.id);
    }
  })();
  return delivered.map((id) => getMessageById(db, id)).filter((row): row is MessageRow => Boolean(row));
}

export function markMessagesRead(db: Database, roleId: string, sessionId: string, messageIds: number[]): MessageRow[] {
  const ids = [...new Set(messageIds.map((id) => Math.floor(Number(id))).filter((id) => Number.isFinite(id) && id > 0))];
  if (ids.length === 0) return [];
  const ts = nowIso();
  const acked: number[] = [];
  db.transaction(() => {
    const update = db.query<{ id: number }, [string, string, string, number, string, string]>(
      `UPDATE messages
       SET state = 'delivered', to_session_id = ?, delivered_at = COALESCE(delivered_at, ?), acked_at = COALESCE(acked_at, ?)
       WHERE id = ?
         AND to_role_id = ?
         AND to_session_id IS NOT NULL
         AND (
           to_session_id = ?
           OR (
             state IN ('pending', 'pushed')
             AND NOT EXISTS (
               SELECT 1 FROM runners
               WHERE runners.agent_id = messages.to_role_id
                 AND runners.session_id = messages.to_session_id
                 AND runners.status = 'running'
             )
           )
         )
       RETURNING id`,
    );
    for (const id of ids) {
      const row = update.get(sessionId, ts, ts, id, roleId, sessionId);
      if (row) acked.push(row.id);
    }
  })();
  return acked.map((id) => getMessageById(db, id)).filter((row): row is MessageRow => Boolean(row));
}

export function setSessionSummary(db: Database, roleId: string, sessionId: string, summary: string): void {
  db.run(
    "UPDATE sessions SET summary = ?, last_seen = ? WHERE id = ? AND role_id = ? AND status = 'running'",
    [summary, nowIso(), sessionId, roleId],
  );
}

function messageSelectSql(clause: string): string {
  return `SELECT messages.id, messages.thread_id, messages.from_role_id,
                 COALESCE(from_repos.name || ':' || from_roles.name, messages.from_display, '(deleted)') AS from_role_name,
                 messages.to_role_id,
                 COALESCE(to_repos.name || ':' || to_roles.name, messages.to_display, messages.to_role_id, '(deleted)') AS to_role_name,
                 messages.from_session_id, messages.to_session_id,
                 messages.body, messages.state, messages.delivery_kind, messages.broadcast_id,
                 messages.sent_at, messages.delivered_at, messages.acked_at, messages.pushed_at, messages.error
          FROM messages
          LEFT JOIN agents AS from_roles ON from_roles.id = messages.from_role_id
          LEFT JOIN workspace_repos AS from_repos ON from_repos.id = from_roles.repo_id
          LEFT JOIN agents AS to_roles ON to_roles.id = messages.to_role_id
          LEFT JOIN workspace_repos AS to_repos ON to_repos.id = to_roles.repo_id
          ${clause}`;
}

function kanbanTaskSelectSql(clause: string): string {
  return `SELECT kanban_tasks.id, kanban_tasks.display_id, kanban_tasks.sequence,
                 kanban_tasks.title, kanban_tasks.details, kanban_tasks.status,
                 kanban_tasks.priority, kanban_tasks.effort,
                 kanban_tasks.created_by_role_id,
                 COALESCE(created_by_repo.name || ':' || created_by.name, kanban_tasks.created_by_display, '(deleted)') AS created_by_role_name,
                 kanban_tasks.assigned_role_id,
                 COALESCE(assigned_repo.name || ':' || assigned.name, kanban_tasks.assignee_display, '(deleted)') AS assigned_role_name,
                 kanban_tasks.github_url, kanban_tasks.github_number, kanban_tasks.github_title,
                 kanban_tasks.created_at, kanban_tasks.updated_at, kanban_tasks.completed_at,
                 kanban_tasks.archived_at, kanban_tasks.archived_by_role_id,
                 COALESCE(archived_by_repo.name || ':' || archived_by.name, kanban_tasks.archived_by_display) AS archived_by_role_name,
                 kanban_tasks.epic_id
          FROM kanban_tasks
          LEFT JOIN agents AS created_by ON created_by.id = kanban_tasks.created_by_role_id
          LEFT JOIN workspace_repos AS created_by_repo ON created_by_repo.id = created_by.repo_id
          LEFT JOIN agents AS assigned ON assigned.id = kanban_tasks.assigned_role_id
          LEFT JOIN workspace_repos AS assigned_repo ON assigned_repo.id = assigned.repo_id
          LEFT JOIN agents AS archived_by ON archived_by.id = kanban_tasks.archived_by_role_id
          LEFT JOIN workspace_repos AS archived_by_repo ON archived_by_repo.id = archived_by.repo_id
          ${clause}`;
}

function kanbanCommentSelectSql(clause: string): string {
  return `SELECT kanban_comments.id, kanban_comments.task_id, kanban_tasks.display_id AS task_display_id,
                 kanban_comments.role_id,
                 COALESCE(role_repo.name || ':' || roles.name, kanban_comments.actor_display, '(deleted)') AS role_name,
                 kanban_comments.session_id,
                 kanban_comments.type, kanban_comments.body, kanban_comments.created_at
          FROM kanban_comments
          JOIN kanban_tasks ON kanban_tasks.id = kanban_comments.task_id
          LEFT JOIN agents AS roles ON roles.id = kanban_comments.role_id
          LEFT JOIN workspace_repos AS role_repo ON role_repo.id = roles.repo_id
          ${clause}`;
}

function kanbanActivitySelectSql(clause: string): string {
  return `SELECT kanban_activity.id, kanban_activity.task_id, kanban_tasks.display_id AS task_display_id,
                 kanban_activity.role_id,
                 COALESCE(role_repo.name || ':' || roles.name, kanban_activity.actor_display, '(deleted)') AS role_name,
                 kanban_activity.session_id,
                 kanban_activity.action, kanban_activity.field, kanban_activity.before_json,
                 kanban_activity.after_json, kanban_activity.created_at
          FROM kanban_activity
          JOIN kanban_tasks ON kanban_tasks.id = kanban_activity.task_id
          LEFT JOIN agents AS roles ON roles.id = kanban_activity.role_id
          LEFT JOIN workspace_repos AS role_repo ON role_repo.id = roles.repo_id
          ${clause}`;
}

function kanbanDependencySelectSql(clause: string): string {
  return `SELECT kanban_dependencies.task_id, task.display_id AS task_display_id,
                 kanban_dependencies.depends_on_task_id, depends_on.display_id AS depends_on_display_id,
                 depends_on.title AS depends_on_title, depends_on.status AS depends_on_status,
                 depends_on.priority AS depends_on_priority,
                 kanban_dependencies.created_by_role_id,
                 COALESCE(role_repo.name || ':' || roles.name, kanban_dependencies.created_by_display, '(deleted)') AS created_by_role_name,
                 kanban_dependencies.created_at
          FROM kanban_dependencies
          JOIN kanban_tasks AS task ON task.id = kanban_dependencies.task_id
          JOIN kanban_tasks AS depends_on ON depends_on.id = kanban_dependencies.depends_on_task_id
          LEFT JOIN agents AS roles ON roles.id = kanban_dependencies.created_by_role_id
          LEFT JOIN workspace_repos AS role_repo ON role_repo.id = roles.repo_id
          ${clause}`;
}

function kanbanDependedBySelectSql(clause: string): string {
  return `SELECT task.id AS task_id, task.display_id AS task_display_id, task.title,
                 task.status, task.priority,
                 kanban_dependencies.depends_on_task_id, depends_on.display_id AS depends_on_display_id,
                 kanban_dependencies.created_by_role_id,
                 COALESCE(role_repo.name || ':' || roles.name, kanban_dependencies.created_by_display, '(deleted)') AS created_by_role_name,
                 kanban_dependencies.created_at
          FROM kanban_dependencies
          JOIN kanban_tasks AS task ON task.id = kanban_dependencies.task_id
          JOIN kanban_tasks AS depends_on ON depends_on.id = kanban_dependencies.depends_on_task_id
          LEFT JOIN agents AS roles ON roles.id = kanban_dependencies.created_by_role_id
          LEFT JOIN workspace_repos AS role_repo ON role_repo.id = roles.repo_id
          ${clause}`;
}

function kanbanNotificationSelectSql(clause: string): string {
  return `SELECT kanban_notifications.id, kanban_notifications.task_id,
                 kanban_tasks.display_id AS task_display_id,
                 kanban_notifications.to_role_id,
                 COALESCE(to_repo.name || ':' || to_role.name, kanban_notifications.to_display, '(deleted)') AS to_role_name,
                 kanban_notifications.actor_role_id,
                 COALESCE(actor_repo.name || ':' || actor_role.name, kanban_notifications.actor_display) AS actor_role_name,
                 kanban_notifications.event_type, kanban_notifications.activity_id,
                 kanban_notifications.comment_id, kanban_notifications.body,
                 kanban_notifications.created_at, kanban_notifications.delivered_at,
                 kanban_notifications.read_at
          FROM kanban_notifications
          JOIN kanban_tasks ON kanban_tasks.id = kanban_notifications.task_id
          LEFT JOIN agents AS to_role ON to_role.id = kanban_notifications.to_role_id
          LEFT JOIN workspace_repos AS to_repo ON to_repo.id = to_role.repo_id
          LEFT JOIN agents AS actor_role ON actor_role.id = kanban_notifications.actor_role_id
          LEFT JOIN workspace_repos AS actor_repo ON actor_repo.id = actor_role.repo_id
          ${clause}`;
}

function kanbanEpicSelectSql(clause: string): string {
  return `SELECT kanban_epics.id, kanban_epics.display_id, kanban_epics.sequence,
                 kanban_epics.title, kanban_epics.details, kanban_epics.status,
                 kanban_epics.priority, kanban_epics.effort,
                 kanban_epics.created_by_role_id,
                 COALESCE(created_by_repo.name || ':' || created_by.name, kanban_epics.created_by_display, '(deleted)') AS created_by_role_name,
                 kanban_epics.assigned_role_id,
                 COALESCE(assigned_repo.name || ':' || assigned.name, kanban_epics.assignee_display, '(deleted)') AS assigned_role_name,
                 kanban_epics.github_url, kanban_epics.github_number, kanban_epics.github_title,
                 kanban_epics.created_at, kanban_epics.updated_at, kanban_epics.completed_at,
                 kanban_epics.archived_at, kanban_epics.archived_by_role_id,
                 COALESCE(archived_by_repo.name || ':' || archived_by.name, kanban_epics.archived_by_display) AS archived_by_role_name,
                 kanban_epics.close_approval_status,
                 kanban_epics.close_approval_requested_at,
                 kanban_epics.close_approval_requested_by_role_id,
                 COALESCE(close_requested_by_repo.name || ':' || close_requested_by.name, kanban_epics.close_approval_requested_by_display) AS close_approval_requested_by_role_name,
                 kanban_epics.close_approval_approved_at,
                 kanban_epics.close_approval_approved_by
          FROM kanban_epics
          LEFT JOIN agents AS created_by ON created_by.id = kanban_epics.created_by_role_id
          LEFT JOIN workspace_repos AS created_by_repo ON created_by_repo.id = created_by.repo_id
          LEFT JOIN agents AS assigned ON assigned.id = kanban_epics.assigned_role_id
          LEFT JOIN workspace_repos AS assigned_repo ON assigned_repo.id = assigned.repo_id
          LEFT JOIN agents AS archived_by ON archived_by.id = kanban_epics.archived_by_role_id
          LEFT JOIN workspace_repos AS archived_by_repo ON archived_by_repo.id = archived_by.repo_id
          LEFT JOIN agents AS close_requested_by ON close_requested_by.id = kanban_epics.close_approval_requested_by_role_id
          LEFT JOIN workspace_repos AS close_requested_by_repo ON close_requested_by_repo.id = close_requested_by.repo_id
          ${clause}`;
}

function kanbanEpicCommentSelectSql(clause: string): string {
  return `SELECT kanban_epic_comments.id, kanban_epic_comments.epic_id,
                 kanban_epics.display_id AS epic_display_id,
                 kanban_epic_comments.role_id,
                 COALESCE(role_repo.name || ':' || roles.name, kanban_epic_comments.actor_display, '(deleted)') AS role_name,
                 kanban_epic_comments.session_id, kanban_epic_comments.type,
                 kanban_epic_comments.body, kanban_epic_comments.created_at
          FROM kanban_epic_comments
          JOIN kanban_epics ON kanban_epics.id = kanban_epic_comments.epic_id
          LEFT JOIN agents AS roles ON roles.id = kanban_epic_comments.role_id
          LEFT JOIN workspace_repos AS role_repo ON role_repo.id = roles.repo_id
          ${clause}`;
}

function kanbanEpicActivitySelectSql(clause: string): string {
  return `SELECT kanban_epic_activity.id, kanban_epic_activity.epic_id,
                 kanban_epics.display_id AS epic_display_id,
                 kanban_epic_activity.role_id,
                 COALESCE(role_repo.name || ':' || roles.name, kanban_epic_activity.actor_display, '(deleted)') AS role_name,
                 kanban_epic_activity.session_id, kanban_epic_activity.action,
                 kanban_epic_activity.field, kanban_epic_activity.before_json,
                 kanban_epic_activity.after_json, kanban_epic_activity.created_at
          FROM kanban_epic_activity
          JOIN kanban_epics ON kanban_epics.id = kanban_epic_activity.epic_id
          LEFT JOIN agents AS roles ON roles.id = kanban_epic_activity.role_id
          LEFT JOIN workspace_repos AS role_repo ON role_repo.id = roles.repo_id
          ${clause}`;
}

function kanbanEpicNotificationSelectSql(clause: string): string {
  return `SELECT kanban_epic_notifications.id, kanban_epic_notifications.epic_id,
                 kanban_epics.display_id AS epic_display_id,
                 kanban_epic_notifications.to_role_id,
                 COALESCE(to_repo.name || ':' || to_role.name, kanban_epic_notifications.to_display, '(deleted)') AS to_role_name,
                 kanban_epic_notifications.actor_role_id,
                 COALESCE(actor_repo.name || ':' || actor_role.name, kanban_epic_notifications.actor_display) AS actor_role_name,
                 kanban_epic_notifications.event_type, kanban_epic_notifications.activity_id,
                 kanban_epic_notifications.comment_id, kanban_epic_notifications.body,
                 kanban_epic_notifications.created_at, kanban_epic_notifications.delivered_at,
                 kanban_epic_notifications.read_at
          FROM kanban_epic_notifications
          JOIN kanban_epics ON kanban_epics.id = kanban_epic_notifications.epic_id
          LEFT JOIN agents AS to_role ON to_role.id = kanban_epic_notifications.to_role_id
          LEFT JOIN workspace_repos AS to_repo ON to_repo.id = to_role.repo_id
          LEFT JOIN agents AS actor_role ON actor_role.id = kanban_epic_notifications.actor_role_id
          LEFT JOIN workspace_repos AS actor_repo ON actor_repo.id = actor_role.repo_id
          ${clause}`;
}

function channelMessageSelectSql(clause: string): string {
  return `SELECT channel_messages.id, channel_messages.channel_id, channels.name AS channel_name,
                 channel_messages.from_role_id,
                 COALESCE(from_repo.name || ':' || roles.name, channel_messages.from_display, '(deleted)') AS from_role_name,
                 channel_messages.from_session_id, channel_messages.body,
                 channel_messages.parent_message_id, channel_messages.root_message_id,
                 channel_messages.sent_at
          FROM channel_messages
          JOIN channels ON channels.id = channel_messages.channel_id
          LEFT JOIN agents AS roles ON roles.id = channel_messages.from_role_id
          LEFT JOIN workspace_repos AS from_repo ON from_repo.id = roles.repo_id
          ${clause}`;
}

function peerRuleSelectSql(clause: string): string {
  return `SELECT peer_policy_rules.id, peer_policy_rules.role_a_id, role_a.name AS role_a_name,
                 peer_policy_rules.role_b_id, role_b.name AS role_b_name, peer_policy_rules.created_at
          FROM peer_policy_rules
          JOIN agents AS role_a ON role_a.id = peer_policy_rules.role_a_id
          JOIN agents AS role_b ON role_b.id = peer_policy_rules.role_b_id
          ${clause}`;
}

export function insertLaunchToken(db: Database, input: LaunchTokenInput): void {
  db.run(
    `INSERT INTO launch_tokens (id, role_id, session_id, token_hash, expires_at, consumed_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
    [input.id, input.roleId, input.sessionId, input.tokenHash, input.expiresAt],
  );
}

export function getLaunchTokenForValidation(db: Database, roleName: string, sessionId: string): LaunchTokenRow | null {
  return db.query<LaunchTokenRow, [string, string, string]>(
    `SELECT launch_tokens.id, launch_tokens.role_id, roles.name AS role_name, launch_tokens.session_id,
            launch_tokens.token_hash, launch_tokens.expires_at, launch_tokens.consumed_at
     FROM launch_tokens
     JOIN agents AS roles ON roles.id = launch_tokens.role_id
     WHERE roles.name = ?
       AND launch_tokens.session_id = ?
       AND launch_tokens.expires_at > ?
       AND launch_tokens.consumed_at IS NULL
     ORDER BY launch_tokens.expires_at DESC
     LIMIT 1`,
  ).get(roleName, sessionId, nowIso()) ?? null;
}

export function consumeLaunchToken(db: Database, launchTokenId: string): boolean {
  const result = db.run("UPDATE launch_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL", [nowIso(), launchTokenId]);
  return result.changes > 0;
}

export function insertAgentSessionCredential(db: Database, input: AgentSessionCredentialInput): AgentSessionCredentialRow {
  db.run(
    `INSERT INTO agent_session_credentials (id, role_id, session_id, credential_hash, issued_at, expires_at, revoked_at, launch_token_id)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    [input.id, input.roleId, input.sessionId, input.credentialHash, input.issuedAt, input.expiresAt, input.launchTokenId ?? null],
  );
  const row = db.query<AgentSessionCredentialRow, [string]>(
    `SELECT c.id, c.role_id, roles.name AS role_name, c.session_id, c.credential_hash, c.issued_at, c.expires_at, c.revoked_at, c.launch_token_id
     FROM agent_session_credentials c
     JOIN agents AS roles ON roles.id = c.role_id
     WHERE c.id = ?`,
  ).get(input.id);
  if (!row) throw new Error("agent session credential insert failed");
  return row;
}

export function getAgentSessionCredentialForValidation(db: Database, roleName: string, sessionId: string, credentialHash: string): AgentSessionCredentialRow | null {
  return db.query<AgentSessionCredentialRow, [string, string, string, string]>(
    `SELECT c.id, c.role_id, roles.name AS role_name, c.session_id, c.credential_hash, c.issued_at, c.expires_at, c.revoked_at, c.launch_token_id
     FROM agent_session_credentials c
     JOIN agents AS roles ON roles.id = c.role_id
     WHERE roles.name = ?
       AND c.session_id = ?
       AND c.credential_hash = ?
       AND c.expires_at > ?
       AND c.revoked_at IS NULL
     ORDER BY c.expires_at DESC
     LIMIT 1`,
  ).get(roleName, sessionId, credentialHash, nowIso()) ?? null;
}

export function revokeAgentSessionCredential(db: Database, credentialId: string): void {
  db.run("UPDATE agent_session_credentials SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?", [nowIso(), credentialId]);
}

export function hasActiveRunnerSession(db: Database, roleId: string, sessionId: string): boolean {
  return Boolean(db.query<{ one: number }, [string, string]>(
    "SELECT 1 AS one FROM runners WHERE agent_id = ? AND session_id = ? AND status = 'running' LIMIT 1",
  ).get(roleId, sessionId));
}
