import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerWebSocket } from "bun";
import type { Database } from "bun:sqlite";

import { createWorkspace, resolveDaemonConfig, sanitizeRoleName, type WhatsAgentConfig } from "../config.ts";
import {
  getCurrentWorkspaceId,
  getDaemonGlobalDefaultHost,
  getDaemonRuntimeSettings,
  getTrashRetentionDays,
  getTuiRedrawSettings,
  getWorkspace,
  getWorkspaceRbacMode,
  isRbacMode,
  listWorkspaces,
  migrateDaemonDb,
  openDaemonDb,
  RBAC_MODES,
  renameWorkspace,
  setCurrentWorkspaceId,
  setDaemonRuntimeSettings,
  setTrashRetentionDays,
  setTuiRedrawSettings,
  setWorkspaceRbacMode,
  type RbacMode,
  type TuiRedrawSettings,
  type WorkspaceRow,
} from "../daemon-db.ts";
import { autoPurgeSweep, purgeWorkspace, repairOnStartup, restoreWorkspace, trashWorkspace, type LifecycleHooks } from "./workspace-lifecycle.ts";
import { activeWorkspacePaths, daemonHomePaths, type DaemonHomePaths } from "../paths.ts";
import { closeAllWorkspaceStates, closeWorkspaceState, hydrateActiveWorkspaces, loadWorkspaceState, type WorkspaceState } from "./workspace-state.ts";
import { searchChannelMessages, searchDirectMessages, searchKanbanEpics, searchKanbanTasks } from "../db.ts";
import { DEFAULT_KANBAN_TASK_ID_PREFIX, DEFAULT_MESSAGE_MAX_BODY_CHARS, addKanbanComment, addKanbanEpicComment, addPeerRule, archiveKanbanEpic, archiveKanbanTask, channelMessageToInboxRow, clearChatHistory, clearKanbanEpicCloseApproval, completeKanbanEpicWithApproval, countOpenKanbanEpicChildren, createKanbanEpic, createKanbanTask, getChatHistorySettings, getKanbanEpic, getKanbanSettings, getKanbanTask, getLaunchTokenForValidation, getAgentSessionCredentialForValidation, getMainAgent, getMessageSettings, getPeerPolicySettings, getPeerRuleMode, getPolicyMode, getPushStateStats, getRoleByName, insertKanbanNotification, insertMessage, insertAgentSessionCredential, renameRole, kanbanEpicNotificationToInboxRow, kanbanNotificationToInboxRow, listAllKanbanDependencies, listChannelMessages, listKanbanActivity, listKanbanComments, listKanbanDependedBy, listKanbanDependencies, listKanbanEpicActivity, listKanbanEpicChildren, listKanbanEpicComments, listKanbanEpics, listKanbanTasks, listMessages as listDbMessages, listOpenKanbanEpicChildren, listPendingKanbanEpicNotifications, listPendingKanbanNotifications, listAgentInboxRows, listPendingMessages, listAgents, listRunningSessionDetails, listUnclassifiedKanbanTasks, listUnreadChannelMessages, markChannelMessagesRead, markKanbanEpicNotificationsRead, markKanbanNotificationsRead, markMessagesPushed, markMessagesRead, markRoleJoinedChannel, migrate, normalizeKanbanTaskIdPrefix, notifyKanbanEpicEvent, openFleetDb, peerRuleExists, postChannelMessage, pruneChatHistoryByRetention, removePeerRule, runStartupRepair, setChatHistorySettings, setKanbanEpicCloseApprovalPending, setKanbanEpicStatus, setKanbanSettings, setMessageSettings, setPeerRuleMode, setPolicyMode, setRoleDefaultHost, setRoleDefaultHostByIdRaw, setSessionSummary, consumeLaunchToken, hasActiveRunnerSession, revokeAgentSessionCredential, stopRunnerSession, updateKanbanEpic, updateKanbanTask, type ChannelMessageRow, type ChatHistorySettings, type KanbanCommentType, type KanbanEffort, type KanbanEpicNotificationRow, type KanbanEpicRow, type KanbanNotificationRow, type KanbanPriority, type KanbanStatus, type KanbanTaskRow, type MessageRow, type MessageSettings, type PeerPolicySettings, type PolicyMode, type AgentRow, type RuntimeSettings } from "../db.ts";
import {
  deleteRepo as daoDeleteRepo,
  deleteRoleById as daoDeleteRoleById,
  deleteScanDir as daoDeleteScanDir,
  getRepoById,
  getRepoByName as daoGetRepoByName,
  getRepoByPath as daoGetRepoByPath,
  getRoleById as daoGetRoleById,
  getRoleByDisplayId,
  getScanDirById,
  insertRepo as daoInsertRepo,
  insertRole as daoInsertRole,
  insertScanDir as daoInsertScanDir,
  listRepos as daoListRepos,
  listAgentsByRepo,
  listAgentsByWorkspace,
  listScanDirs as daoListScanDirs,
  parseRoleAddress,
  refreshRepoMeta as daoRefreshRepoMeta,
  renameRepo as daoRenameRepo,
  renameRoleById as daoRenameRoleById,
  runScanDir as daoRunScanDir,
  setScanDirStartup as daoSetScanDirStartup,
  type RoleWithDisplayRow,
} from "../workspace-decoupling-dao.ts";
import { createCustomPrompt, deleteCustomPrompt, DuplicateCustomPromptTitleError, listCustomPrompts, updateCustomPrompt } from "../custom-prompts-dao.ts";
import { getAgentRoles, getEffectiveGrants } from "../rbac-dao.ts";
import { clearSessionForcePwdReset, consumeRecovery, countAuthUsers, createAuthUser, deleteSession, deleteSessionsForUser, getAuthUserByUsername, getSessionByTokenHash, incFailedAttempts, listSessionsForUser, regenerateRecovery, resetFailedAttempts, setLockedUntil, updateAuthUserPassword } from "../auth-dao.ts";
import { hashPassword, verifyPassword } from "../auth-hash.ts";
import { AUTH_COOKIE_NAME, attachSessionCookie, clearSessionCookie, createUserSession, csrfTokenFromRequest, getCookie, hashSessionToken, requireSession, validateCsrfTokenForSession } from "../auth-session.ts";
import { hashLaunchToken, launchTokenHashMatches } from "../integrations/launch-token.ts";
import { createLogger, type Logger } from "../logger.ts";
import { DEFAULT_AGENT_TEXT_SETTINGS, getAgentTextSettings, resetAgentTextSettings, setAgentTextSettings, type AgentTextSettings } from "../messages/agent-text-settings.ts";
import { formatInboxEnvelope, INBOX_ENVELOPE_NONCE_EXHAUSTION_MESSAGE, type InboxEnvelopeNonceCollisionInfo } from "../messages/inbox-envelope.ts";
import { appendAudit } from "../audit-log-dao.ts";
import { launchRunner, stopRunner } from "../runner/launcher.ts";
import { discoverRunners, type RunnerStatus } from "../runner/registry.ts";
import { TerminalStateMirror } from "../runner/terminal-state-mirror.ts";
import { HOST_TYPES, commandsKeyForHost, probeAllRuntimes, probeRuntime, type RuntimeDetection } from "../runner/runtime-detect.ts";
import { normalizeHostType, type HostType, type RunnerMetadata } from "../runner/protocol.ts";
import { buildClientBundle } from "../web/client/build.ts";
import { renderWebShell } from "../web/shell.ts";
import { parseInteger, parseIntegerArray, type IntegerParseOptions } from "./parse.ts";

export type HostCheckMode = "off" | "warn" | "enforce";

export interface DaemonState {
  /** Static daemon-global metadata: host/port, allow-list, shell hydration,
   * launch config. Loaded once from the bridge workspace's TOML at boot
   * (workspace registration is per-tree but the daemon itself is a
   * single process bound to one set of network defaults). */
  config: WhatsAgentConfig;
  logger: Logger;
  startedAt: string;
  daemonUrl?: string;
  // Pids of runner processes this daemon launched (or adopted on cold start
  // from .whatsagent/run/*.runner.json). Used to gate `stopRunner` so a
  // tampered metadata file pointing at an unrelated user pid doesn't get
  // SIGTERM'd. Permissive in this commit (warn-only); a follow-up will
  // refuse the kill outright.
  ownedRunnerPids: Set<number>;
  // Hostnames the daemon will accept in the Host header. Built from loopback
  // names + state.config.ui.host + LAN interface addresses (when bound to
  // 0.0.0.0/::) + WHATSAGENT_HOST_ALLOW additions. Used to defeat
  // DNS-rebinding attacks from browser tabs visiting attacker pages.
  hostAllowList: Set<string>;
  // Exact origins (scheme://host:port) accepted for browser Origin/Referer.
  // Local daemon origins are populated after Bun binds an actual port;
  // reverse-proxy origins must be configured explicitly.
  originAllowList: Set<string>;
  hostCheckMode: HostCheckMode;
  // Hostnames already warned about during this daemon run, so warn mode
  // doesn't spam stdio on every request from a known-non-allowlisted host
  // (e.g. a reverse proxy forwarding the original public hostname).
  hostCheckWarnedKeys: Set<string>;
  // Runtime probe results from `--version` checks at daemon start. Mutated
  // by /api/settings/runtime/detect handlers and after PUT /api/settings/runtime
  // when the user edits a runtime's command path. Source of truth for the
  // Settings detection chip and the Launch dialog filter.
  runtimeDetection: Record<HostType, RuntimeDetection>;
  /** Browser client bundle built once at daemon startup and inlined per shell render. */
  clientBundle: string;

  // -------- Phase 2 daemon-home additions ------------------------------------
  // Phase 2a-iii adds these alongside the legacy per-fleet state. Phase 2a-iv
  // will retire `db`, `root`, `paths`, `config` in favor of per-workspace
  // resolution via `workspaces`. For now both models coexist; the daemon
  // bootstraps a single workspace at the legacy fleet root so the new
  // registry is populated and observable via /api/workspaces.

  /** Daemon-global SQLite DB (workspaces registry + daemon settings). */
  daemonDb: Database;
  /** Resolved daemon home (`~/.whatsagent` in production; tmp dir in tests). */
  daemonHome: string;
  daemonHomePaths: DaemonHomePaths;
  /** Per-workspace runtime cache. Active workspaces only — trashed,
   * creating, deleting, restoring, purging, and error rows have no entry
   * here and are tracked exclusively via `state.daemonDb`. Presence in
   * this map is therefore the active-signal; dispatcher uses
   * `if (!ws) 404` for `/api/v1/workspaces/<id>/...`. */
  workspaces: Map<string, WorkspaceState>;
  /** Currently-active workspace id (mirrors daemon_settings.current_workspace_id). */
  currentWorkspaceId: string | null;
  /** Auto-purge sweep timer; cleared in stop(). */
  autoPurgeTimer?: ReturnType<typeof setInterval>;
  /**
   * EP-022 / WA-094 daemon-wide RBAC mode ceiling. Capped strictness for
   * the launch only — `min(workspace.rbac_mode, ceiling)` resolves the
   * effective per-call mode where ordering is `off < soft < enforce`. So
   * a CLI launch with `--rbac-mode=off` forces every workspace to `off`
   * regardless of stored mode; with `--rbac-mode=enforce` no workspace
   * is tightened beyond its stored mode (the cap is the most-permissive
   * reachable, never the floor).
   *
   * `null` = no ceiling (workspace mode wins as-is). The CLI flag is
   * launch-only; flipping ceiling without restart is intentionally not
   * supported (operators flip per-workspace via UI / PATCH instead).
   */
  rbacModeCeiling: RbacMode | null;

  // EP-023 / WA-103 — dedicated logger for client-shipped xterm debug
  // events (Settings → Diagnostics "Live xTerm debug logs" toggle). Lives
  // alongside daemon.log + runner-*.log so users can grep/share captures.
  // Append-only, no rotation in this PR (out-of-scope follow-up).
  clientDebugLogger: Logger;
  // Per-session sliding-window timestamps for /api/v1/client-debug rate
  // limit. Keys are auth_session id; values are ms-epoch timestamps of
  // accepted batches in the trailing 60 s. Cleared on stop().
  clientDebugRateWindow: Map<string, number[]>;

  // EP-029 T2 — server-side terminal state mirror per runner. Mirror is
  // the canonical PTY state served to browser WS connections. Keyed by
  // sessionId so two repos with same role-name (and therefore two distinct
  // sessions) get distinct mirrors. Lazy-created on first WS open for the
  // session; disposed when the consumer detects runner exit and last
  // subscriber leaves. Survives runner exit (mirror persists for exited-
  // replay); survives daemon restart via disk persistence.
  terminalMirrors: Map<string, TerminalStateMirror>;
  // Subscribers per sessionId. Each connected browser WS is added as soon
  // as its restore frame is sent so live deltas produced during the async
  // browser restore write window are captured. Sockets awaiting the
  // client's `restore_complete` ack buffer those deltas and drain them in
  // order after ack. Removed on WS close.
  terminalSubscribers: Map<string, Set<ServerWebSocket<TerminalWsData>>>;
  // Consumer handles per sessionId. One consumer per runner replaces the
  // pre-T2 per-WS pump loop: it polls runner /output, applies events to
  // the mirror, fans out to subscribers. Started on first subscribe;
  // stopped when runner exit drained AND no subscribers remain.
  terminalConsumers: Map<string, TerminalConsumerHandle>;
}

interface TerminalConsumerHandle {
  /** Cached runner control URL. */
  controlUrl: string;
  /** Cached WA-153 bearer for the runner control endpoint. */
  controlSecret?: string;
  /** Latest runner /output cursor consumed. */
  cursor: number;
  /** Last reported cols×rows the mirror was sized to. Used to detect a
   * resize that should be forwarded to the mirror even when the runner
   * itself doesn't report grid changes. */
  cols: number;
  rows: number;
  /** Current scheduled poll timer. Cleared by stop(). */
  timer?: ReturnType<typeof setTimeout>;
  /** True after stop() — guards against re-scheduled ticks racing close. */
  stopped: boolean;
}

export interface StartedDaemon {
  url: string;
  server: ReturnType<typeof Bun.serve>;
  state: DaemonState;
  stop(): Promise<void>;
}

type PublicRunnerStatus = Omit<RunnerStatus, "control_secret">;

interface TerminalWsData {
  state: DaemonState;
  /** Workspace this terminal connection is bound to. Resolved at upgrade
   * time from the URL prefix `/api/v1/workspaces/<id>/...`; if the
   * workspace transitions out of `active` mid-pump the next tick detects
   * the cache miss and self-closes the socket. */
  workspaceId: string;
  /** EP-DEC-RUN WA-006: identify the role by UUID `roles.id`, not bare
   * name. Two repos in the same workspace can hold a `main` role each;
   * pump used to look the runner up via bare name and would route to
   * whichever discovery picked first. */
  roleId: string;
  userId?: string;
  authRejected?: boolean;
  cursor: number;
  controlReady?: boolean;
  pendingResize?: { cols: number; rows: number };
  closed?: boolean;
  timer?: ReturnType<typeof setTimeout>;
  // Cached control endpoint for the active runner. Set after a successful
  // discovery pass; used directly on every subsequent tick so the 120 ms
  // pump doesn't re-run readdir + readFile + process.kill(pid,0) for every
  // runner in the fleet 8x/sec/connection. Cleared on fetch failure
  // (relaunch / runner death) so the next tick rediscovers.
  cachedControlUrl?: string;
  cachedControlSecret?: string;
  cachedSessionId?: string;
  // EP-029 T2 — sessionId this socket is subscribed to in
  // state.terminalSubscribers. Set immediately after a restore frame is
  // sent; live output buffers until the client acks `restore_complete`.
  // Cleared on runner-exit transition and on close. Used by the close
  // path to remove from the subscribers set without re-resolving the
  // runner.
  subscribedSessionId?: string;
  // WA-149 — while true, terminalConsumerTick buffers output payloads for
  // this WS instead of sending them. The client flips this by sending
  // `{type:"restore_complete"}` after xterm finishes applying the restore
  // snapshot.
  awaitingRestoreAck?: boolean;
  restoreBufferedOutputFrames?: string[];
}

interface AgentContextInput {
  role?: string;
  sessionId?: string;
  token?: string;
}

interface AgentContext {
  role: AgentRow;
  sessionId: string;
  runner: RunnerStatus;
}

function roleDisplayName(role: AgentRow): string {
  return role.display_id ?? role.name;
}

function formatAuditedInboxEnvelope(db: Database, messages: MessageRow[], agentText: AgentTextSettings, context: AgentContext, action: "check-messages" | "poll-messages"): string {
  return formatInboxEnvelope(messages, agentText, (info) => {
    recordEnvelopeNonceCollision(db, context, action, messages.length, info);
  });
}

function recordEnvelopeNonceCollision(db: Database, context: AgentContext, action: "check-messages" | "poll-messages", messageCount: number, info: InboxEnvelopeNonceCollisionInfo): void {
  const role = roleDisplayName(context.role);
  appendAudit(db, {
    kind: "envelope.nonce_collision",
    actor_agent_id: context.role.id,
    target_kind: "inbox_envelope",
    target_id: role,
    payload: {
      action,
      attempts: info.attempts,
      fallback: info.fallback,
      messageCount,
      role,
    },
  });
}

function recordEnvelopeNonceExhaustion(db: Database, context: AgentContext, action: "check-messages" | "poll-messages", messageCount: number): void {
  const role = roleDisplayName(context.role);
  appendAudit(db, {
    kind: "envelope.nonce_exhaustion",
    actor_agent_id: context.role.id,
    target_kind: "inbox_envelope",
    target_id: role,
    payload: {
      action,
      messageCount,
      role,
      reason: INBOX_ENVELOPE_NONCE_EXHAUSTION_MESSAGE,
    },
  });
}

function nonceExhaustionResponse(db: Database, context: AgentContext, action: "check-messages" | "poll-messages", messageCount: number): Response {
  recordEnvelopeNonceExhaustion(db, context, action, messageCount);
  return json({ ok: false, error: "inbox_envelope_nonce_exhaustion" }, { status: 500 });
}

function securityHeaders(headers?: HeadersInit, options: { html?: boolean } = {}): Headers {
  const out = new Headers(headers);
  out.set("X-Content-Type-Options", "nosniff");
  out.set("Referrer-Policy", "no-referrer");
  if (options.html) out.set("X-Frame-Options", "DENY");
  return out;
}

function json(body: unknown, init?: ResponseInit): Response {
  const headers = securityHeaders(init?.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body, null, 2), { ...init, headers });
}

function html(body: string, init?: ResponseInit): Response {
  const headers = securityHeaders(init?.headers, { html: true });
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(body, { ...init, headers });
}

function redirect(location: string, status = 302, headers?: HeadersInit): Response {
  const out = securityHeaders(headers);
  out.set("Location", location);
  return new Response(null, { status, headers: out });
}

function jsonWithHeaders(body: unknown, headers: Headers, init?: ResponseInit): Response {
  const out = securityHeaders(headers);
  out.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body, null, 2), { ...init, headers: out });
}

function asset(filePath: string, contentType: string, options: { cacheControl?: string } = {}): Response {
  const headers = securityHeaders({ "Content-Type": contentType });
  if (options.cacheControl) headers.set("Cache-Control", options.cacheControl);
  return new Response(Bun.file(filePath), { headers });
}

function messageBodyStats(body: string, maxChars: number): { charCount: number; wordCount: number; maxChars: number } {
  const text = String(body ?? "");
  const trimmed = text.trim();
  return {
    charCount: text.length,
    wordCount: trimmed ? trimmed.split(/\s+/).length : 0,
    maxChars,
  };
}

function overMessageLimit(body: string, maxChars: number): Response | null {
  const stats = messageBodyStats(body, maxChars);
  if (stats.charCount <= maxChars) return null;
  return json({ ok: false, error: `message is ${stats.charCount} characters; limit is ${maxChars}`, ...stats }, { status: 413 });
}

function tryParseInteger(value: unknown, opts: IntegerParseOptions): number | Response {
  try {
    return parseInteger(value, opts);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

function tryParseIntegerArray(value: unknown, opts: IntegerParseOptions): number[] | Response {
  try {
    return parseIntegerArray(value, opts);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

const XTERM_JS_PATH = fileURLToPath(new URL("../../node_modules/@xterm/xterm/lib/xterm.js", import.meta.url));
const XTERM_CSS_PATH = fileURLToPath(new URL("../../node_modules/@xterm/xterm/css/xterm.css", import.meta.url));
const XTERM_FIT_JS_PATH = fileURLToPath(new URL("../../node_modules/@xterm/addon-fit/lib/addon-fit.js", import.meta.url));
const XTERM_WEBGL_JS_PATH = fileURLToPath(new URL("../../node_modules/@xterm/addon-webgl/lib/addon-webgl.js", import.meta.url));
const XTERM_UNICODE11_JS_PATH = fileURLToPath(new URL("../../node_modules/@xterm/addon-unicode11/lib/addon-unicode11.js", import.meta.url));
const WEB_ICON_DIR = fileURLToPath(new URL("../web/assets/icons/", import.meta.url));
const WEB_ICON_RE = /^\/assets\/icons\/(whatsagent-(?:indigo|violet|blue|teal|rose|amber)-(?:512|256|128|64|32|16)\.png)$/;
const WEB_SOUND_DIR = fileURLToPath(new URL("../web/assets/sounds/", import.meta.url));
const WEB_SOUND_RE = /^\/assets\/sounds\/(Chime|Pulse|Signal|Tap)\.wav$/;

const MAX_REQUEST_BYTES = (() => {
  const override = Number(process.env.WHATSAGENT_MAX_REQUEST_BYTES);
  return Number.isInteger(override) && override > 0 ? override : 256 * 1024;
})();

class RequestEntityTooLarge extends Error {
  constructor(readonly size: number, readonly limit: number) {
    super(`request body is ${size} bytes; limit is ${limit}`);
    this.name = "RequestEntityTooLarge";
  }
}

function enforceBodySize(req: Request, maxBytes = MAX_REQUEST_BYTES): void {
  // Fast-path reject when the client advertises a length; the bounded stream
  // reader below is still authoritative for chunked / unsized bodies.
  const length = req.headers.get("content-length");
  if (length === null) return;
  const size = Number(length);
  if (Number.isFinite(size) && size > maxBytes) {
    throw new RequestEntityTooLarge(size, maxBytes);
  }
}

async function readBoundedRequestBody(req: Request, maxBytes = MAX_REQUEST_BYTES): Promise<Buffer> {
  enforceBodySize(req, maxBytes);
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > maxBytes) {
        try { await reader.cancel(); } catch { /* best effort */ }
        throw new RequestEntityTooLarge(size, maxBytes);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try { reader.releaseLock(); } catch { /* best effort */ }
  }
  return Buffer.concat(chunks, size);
}

async function readBoundedRequestText(req: Request, maxBytes = MAX_REQUEST_BYTES): Promise<string> {
  return (await readBoundedRequestBody(req, maxBytes)).toString("utf8");
}

async function readJson<T>(req: Request): Promise<T> {
  return JSON.parse(await readBoundedRequestText(req)) as T;
}

const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0", "::", "[::]"];

function resolveHostCheckMode(override?: HostCheckMode): HostCheckMode {
  if (override) return override;
  // Default flipped from "warn" to "enforce" in audit PR4 stage 2 after the
  // soft-launch observation period. Operators behind a reverse proxy should
  // set WHATSAGENT_HOST_ALLOW (or `[ui].allow_hosts` in `~/.whatsagent/daemon.toml`
  // once WA-071 lands); emergency escape is WHATSAGENT_HOST_CHECK=off.
  const value = (process.env.WHATSAGENT_HOST_CHECK ?? "enforce").toLowerCase();
  if (value === "off" || value === "warn" || value === "enforce") return value;
  return "enforce";
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function hostForAllowEntry(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const origin = normalizeOrigin(trimmed);
  if (origin) return new URL(origin).hostname;
  return trimmed;
}

function collectLocalHostAllowList(config: WhatsAgentConfig): Set<string> {
  const allow = new Set<string>(LOOPBACK_HOSTNAMES);
  const configured = config.ui.host;
  if (configured) allow.add(configured);
  // When bound to an unspecified address, enumerate the actual interface
  // addresses so LAN clients (browser at http://192.168.x.x:port) pass too.
  if (configured === "0.0.0.0" || configured === "::" || configured === "[::]") {
    try {
      const interfaces = networkInterfaces();
      for (const list of Object.values(interfaces)) {
        for (const iface of list ?? []) {
          allow.add(iface.address);
          if (iface.family === "IPv6" && !iface.address.startsWith("[")) allow.add(`[${iface.address}]`);
        }
      }
    } catch { /* ignore: env without networkInterfaces support */ }
  }
  return allow;
}

function buildHostAllowList(config: WhatsAgentConfig): Set<string> {
  const allow = collectLocalHostAllowList(config);
  // `daemon.toml` `[ui].allow_hosts` is the durable knob for proxy deployments;
  // env override (`WHATSAGENT_HOST_ALLOW`) replaces the toml list and lands
  // here pre-merged via `resolveDaemonConfig`. Entries may be bare hostnames
  // for Host checks or exact origins; exact-origin entries also authorize the
  // origin's hostname for Host.
  for (const entry of config.ui.allowHosts ?? []) {
    if (typeof entry !== "string") continue;
    const host = hostForAllowEntry(entry);
    if (host) allow.add(host);
  }
  return allow;
}

function formatOriginHost(host: string): string {
  if (host.startsWith("[") && host.endsWith("]")) return host;
  if (host.includes(":")) return `[${host}]`;
  return host;
}

function buildOriginAllowList(config: WhatsAgentConfig, port: number, extraOrigins: string[] = []): Set<string> {
  const allow = new Set<string>();
  for (const host of collectLocalHostAllowList(config)) {
    if (!host) continue;
    allow.add(`http://${formatOriginHost(host)}:${port}`);
  }
  for (const entry of config.ui.allowHosts ?? []) {
    if (typeof entry !== "string") continue;
    const origin = normalizeOrigin(entry.trim());
    if (origin) allow.add(origin);
  }
  for (const entry of extraOrigins) {
    const origin = normalizeOrigin(entry);
    if (origin) allow.add(origin);
  }
  return allow;
}

function parseHostHeader(value: string | null): { hostname: string; port: string | null } | null {
  if (!value) return null;
  const trimmed = value.trim();
  // Bracketed IPv6 form: [::1]:4017 or [::1]
  const ipv6Match = trimmed.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (ipv6Match) return { hostname: `[${ipv6Match[1]}]`, port: ipv6Match[2] ?? null };
  const idx = trimmed.lastIndexOf(":");
  if (idx === -1) return { hostname: trimmed, port: null };
  return { hostname: trimmed.slice(0, idx), port: trimmed.slice(idx + 1) };
}

function logHostCheckOnce(state: DaemonState, event: string, key: string, payload: Record<string, unknown>): void {
  // In warn mode the same offending hostname tends to repeat on every request
  // (e.g. a reverse proxy forwarding the public domain); enforce mode logs
  // every violation so the operator can audit attack attempts.
  if (state.hostCheckMode === "warn") {
    if (state.hostCheckWarnedKeys.has(key)) return;
    state.hostCheckWarnedKeys.add(key);
  }
  state.logger.warn(event, payload);
}

function checkHostHeader(req: Request, state: DaemonState): Response | null {
  if (state.hostCheckMode === "off") return null;
  const parsed = parseHostHeader(req.headers.get("host"));
  if (!parsed) {
    logHostCheckOnce(state, "host_check.violation", "host:<missing>", { reason: "missing_host_header", mode: state.hostCheckMode });
    return state.hostCheckMode === "enforce" ? json({ ok: false, error: "Host header required" }, { status: 403 }) : null;
  }
  if (!state.hostAllowList.has(parsed.hostname)) {
    logHostCheckOnce(state, "host_check.violation", `host:${parsed.hostname}`, { hostname: parsed.hostname, port: parsed.port, mode: state.hostCheckMode, hint: "add to WHATSAGENT_HOST_ALLOW" });
    return state.hostCheckMode === "enforce" ? json({ ok: false, error: `Host ${parsed.hostname} is not on the allow-list` }, { status: 403 }) : null;
  }
  return null;
}

function checkOriginHeader(req: Request, state: DaemonState): Response | null {
  if (state.hostCheckMode === "off") return null;
  const origin = req.headers.get("origin");
  // CLI/curl callers don't send Origin; allow them when Referer is also
  // absent. Browsers send Origin for cross-origin requests; some navigation
  // paths only leave Referer, so validate that exact origin too.
  const referer = req.headers.get("referer");
  const rawCandidate = origin ?? referer;
  const source = origin ? "origin" : referer ? "referer" : null;
  if (!rawCandidate || !source) return null;
  const candidate = normalizeOrigin(rawCandidate);
  if (!candidate) {
    logHostCheckOnce(state, "origin_check.violation", `${source}:<malformed>:${rawCandidate}`, { reason: `unparseable_${source}`, [source]: rawCandidate, mode: state.hostCheckMode });
    const label = source === "origin" ? "Origin" : "Referer";
    return state.hostCheckMode === "enforce" ? json({ ok: false, error: `${label} header is malformed` }, { status: 403 }) : null;
  }
  if (!state.originAllowList.has(candidate)) {
    logHostCheckOnce(state, "origin_check.violation", `${source}:${candidate}`, { [source]: rawCandidate, origin: candidate, mode: state.hostCheckMode, hint: "add exact origin (scheme://host:port) to WHATSAGENT_HOST_ALLOW or [ui].allow_hosts" });
    return state.hostCheckMode === "enforce" ? json({ ok: false, error: `Origin ${candidate} is not on the allow-list` }, { status: 403 }) : null;
  }
  return null;
}

function isStateChangingMethod(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH";
}

function authGate(state: DaemonState, req: Request, url: URL): Response | null {
  if (isAuthAllowlistedPath(url.pathname)) return null;
  const users = countAuthUsers(state.daemonDb);
  const apiRequest = url.pathname.startsWith("/api/");
  const htmlRequest = !apiRequest && req.method === "GET" && acceptsHtml(req);
  if (users === 0) {
    if (htmlRequest) return redirect("/setup");
    return json({ ok: false, error: "setup_required" }, { status: 401 });
  }
  const session = requireSession(state.daemonDb, req);
  if (session) {
    if (requiresCsrf(req, url) && !validateCsrfTokenForSession(state.daemonDb, session.session.id, csrfTokenFromRequest(req))) {
      return csrfForbidden();
    }
    return null;
  }
  // If a browser presents a stale auth cookie on a mutating request, keep the
  // failure in the CSRF class: logout/session expiry invalidates the nonce and
  // old cookie+token pairs must not remain usable for state changes.
  if (requiresCsrf(req, url) && getCookie(req.headers.get("cookie") ?? "", AUTH_COOKIE_NAME)) return csrfForbidden();
  if (htmlRequest) return redirect("/login");
  return json({ ok: false, error: "auth_required" }, { status: 401 });
}

function requiresCsrf(req: Request, url: URL): boolean {
  if (!isStateChangingMethod(req.method)) return false;
  if (url.pathname === "/api/v1/auth/login" || url.pathname === "/api/v1/auth/login-recovery" || url.pathname === "/api/v1/auth/setup") return false;
  if (url.pathname.startsWith("/api/v1/agent/") || url.pathname === "/api/v1/launch-token/validate") return false;
  if (url.pathname.startsWith("/api/agent/") || url.pathname === "/api/launch-token/validate") return false;
  return true;
}

function csrfForbidden(): Response {
  return json({ ok: false, error: "invalid_csrf_token" }, { status: 403 });
}

function isAuthAllowlistedPath(pathname: string): boolean {
  return pathname === "/health"
    || pathname === "/login"
    || pathname === "/setup"
    || pathname === "/api/v1/auth/login"
    || pathname === "/api/v1/auth/login-recovery"
    || pathname === "/api/v1/auth/setup"
    || pathname === "/api/v1/launch-token/validate"
    || pathname === "/api/launch-token/validate"
    || pathname.startsWith("/api/v1/agent/")
    || pathname.startsWith("/api/agent/")
    || pathname.startsWith("/assets/");
}

function acceptsHtml(req: Request): boolean {
  const accept = req.headers.get("accept") ?? "";
  return accept.includes("text/html");
}

/**
 * Resolve the active workspace from `state.currentWorkspaceId`. Used by every
 * handler that is workspace-scoped but accepts `(state: DaemonState, ...)` —
 * the dispatcher's URL contract has not yet introduced the
 * `/api/v1/workspaces/<id>/...` prefix, so the implicit current id is the
 * routing rule. Throws if no current is set or if the cache lost the entry.
 *
 * Not safe against concurrent `setCurrentWorkspaceEndpoint` calls — a
 * follow-up will plumb explicit `ws: WorkspaceState` through every signature
 * so the dispatcher can resolve once at request entry. For now,
 * `setCurrentWorkspaceId` only fires on explicit user action, so the race
 * window is narrow and matches pre-Phase-2b behavior.
 */
function currentWs(state: DaemonState): WorkspaceState {
  const id = state.currentWorkspaceId;
  if (!id) throw new Error("no_active_workspace");
  const ws = state.workspaces.get(id);
  if (!ws) throw new Error("current workspace missing from cache: " + id);
  return ws;
}

/**
 * EP-022 / WA-094: per-call effective mode resolver. The CLI flag caps
 * (most-permissive); the workspace stored mode wins when no ceiling.
 * Ordering on the strictness axis is `off < soft < enforce` and the
 * helper returns the LESSER (more permissive) of the two so a CLI
 * `off` ceiling forces every workspace effectively `off` while a CLI
 * `enforce` ceiling never tightens a stored `soft` or `off`.
 *
 * Pure function — exported for tests + adjacent helpers (e.g. the
 * dispatcher passes `effectiveRbacMode(ws.rbacMode, state.rbacModeCeiling)`).
 */
const RBAC_MODE_RANK: Record<RbacMode, number> = { off: 0, soft: 1, enforce: 2 };
export function effectiveRbacMode(workspaceMode: RbacMode, ceiling: RbacMode | null): RbacMode {
  if (ceiling === null) return workspaceMode;
  return RBAC_MODE_RANK[workspaceMode] < RBAC_MODE_RANK[ceiling] ? workspaceMode : ceiling;
}

function resolveRbacModeCeiling(override: RbacMode | null | undefined, logger: Logger): RbacMode | null {
  // CLI flag is the only source — env var was retired in EP-022 / WA-094.
  // `override` shape: `RbacMode` (capped at that strictness) | `null`
  // (no ceiling) | `undefined` (no flag passed; behaves as `null`).
  const ceiling = override ?? null;
  logger.info("rbac.mode_ceiling", {
    ceiling,
    source: override === undefined ? "default" : "cli",
  });
  return ceiling;
}

async function loadState(opts: { port?: number; consoleLogs?: boolean; hostCheckMode?: HostCheckMode; daemonHome?: string; rbacModeCeiling?: RbacMode | null } = {}): Promise<DaemonState> {
  // Daemon home defaults to `~/.whatsagent` (resolved inside daemonHomePaths).
  // Tests + scripts override via opts.daemonHome.
  const home = opts.daemonHome ?? process.env.WHATSAGENT_DAEMON_HOME;
  const homePaths = daemonHomePaths(home);
  await mkdir(homePaths.home, { recursive: true, mode: 0o700 });
  await mkdir(homePaths.logsDir, { recursive: true, mode: 0o700 });
  await mkdir(homePaths.workspacesDir, { recursive: true, mode: 0o700 });
  await mkdir(homePaths.trashDir, { recursive: true, mode: 0o700 });

  // Daemon-global config: defaults overlaid with `<daemonHome>/daemon.toml`
  // and per-key env overrides (`WHATSAGENT_PORT`, `WHATSAGENT_HOST_ALLOW`).
  // `opts.port` (e.g. tests using port 0) wins everything.
  const config = await resolveDaemonConfig({ daemonHome: homePaths.home, port: opts.port });
  const logger = createLogger(homePaths.daemonLogPath, { console: opts.consoleLogs });
  // EP-023 / WA-103 — separate file so xterm debug captures don't mix
  // with daemon.log noise. `console: false` keeps stdout quiet under the
  // continuous capture toggle (otherwise ~5 lines/s would drown the
  // operator log).
  const clientDebugLogger = createLogger(join(homePaths.logsDir, "xterm-debug.log"), { console: false });
  const hostCheckMode = resolveHostCheckMode(opts.hostCheckMode);
  const daemonDb = openDaemonDb(homePaths.daemonDbPath);
  migrateDaemonDb(daemonDb, {
    daemonHome: homePaths.home,
    log: (level, event, payload) => {
      const fn = level === "info" ? logger.info.bind(logger) : level === "warn" ? logger.warn.bind(logger) : logger.error.bind(logger);
      fn(event, payload);
    },
  });
  if (isNonLoopbackBind(config.ui.host) && countAuthUsers(daemonDb) === 0) {
    logger.warn("auth.unconfigured_bind", { host: config.ui.host, hint: "Complete /setup before exposing WhatsAgent on a network interface." });
  }

  // Phase 1: repair runs BEFORE the workspace cache exists. Hooks here
  // are logging-only — `openWorkspaceDb` / `closeWorkspaceDb` are NOT
  // wired because there is no `state.workspaces` map yet to mutate.
  // `restoreWorkspace` branches inside repair will call the hook (via
  // line 141 of workspace-lifecycle.ts), but the callback is undefined
  // here and is a no-op. The post-repair hydration loop below loads all
  // rows ending in `active` uniformly — no double-load risk.
  const repairHooks: LifecycleHooks = {
    log: (level, event, payload) => {
      const fn = level === "info" ? logger.info.bind(logger) : level === "warn" ? logger.warn.bind(logger) : logger.error.bind(logger);
      fn(event, payload);
    },
  };
  await repairOnStartup(daemonDb, homePaths.home, repairHooks);

  // Workspace decoupling: daemon always boots empty. Tests + scripts
  // explicitly create workspaces via the lifecycle/API surface (or via
  // the `seedTestWorkspace` helper for unit tests). The legacy
  // bootstrap-from-cwd path is gone.
  const workspaces = hydrateActiveWorkspaces(daemonDb, homePaths.home);
  runStartupScans(workspaces, logger);
  let currentWorkspaceId: string | null = getCurrentWorkspaceId(daemonDb);
  if (currentWorkspaceId && !workspaces.has(currentWorkspaceId)) {
    currentWorkspaceId = null;
    setCurrentWorkspaceId(daemonDb, null);
  }

  const runtimeDetection = await probeAllRuntimes(getDaemonRuntimeSettings(daemonDb).commands);
  const clientBundle = await buildClientBundle();
  const rbacModeCeiling = resolveRbacModeCeiling(opts.rbacModeCeiling, logger);

  return {
    config,
    logger,
    startedAt: new Date().toISOString(),
    ownedRunnerPids: new Set(),
    hostAllowList: buildHostAllowList(config),
    originAllowList: new Set(),
    hostCheckMode,
    hostCheckWarnedKeys: new Set(),
    runtimeDetection,
    clientBundle,
    daemonDb,
    daemonHome: homePaths.home,
    daemonHomePaths: homePaths,
    workspaces,
    currentWorkspaceId,
    rbacModeCeiling,
    clientDebugLogger,
    clientDebugRateWindow: new Map<string, number[]>(),
    terminalMirrors: new Map(),
    terminalSubscribers: new Map(),
    terminalConsumers: new Map(),
  };
}

function isNonLoopbackBind(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized !== "127.0.0.1" && normalized !== "localhost" && normalized !== "::1" && normalized !== "[::1]";
}

function agentOverviewRoles(db: Database, agents: AgentRow[]): Array<AgentRow & { roles: string[]; summary: string }> {
  const sessionByRoleId = new Map(listRunningSessionDetails(db).map((session) => [session.role_id, session]));
  return agents.map((agent) => ({
    ...agent,
    roles: getAgentRoles(db, agent.id).map((role) => role.name),
    summary: sessionByRoleId.get(agent.id)?.summary ?? "",
  }));
}

async function snapshot(state: DaemonState, ws: WorkspaceState): Promise<{
  fleet: WhatsAgentConfig["fleet"];
  policy: { mode: PolicyMode };
  ui: WhatsAgentConfig["ui"];
  config: WhatsAgentConfig;
  runtime: RuntimeSettings;
  runtimeDetection: Record<HostType, RuntimeDetection>;
  daemonSettings: { tuiRedraw: TuiRedrawSettings };
  chatHistory: ChatHistorySettings;
  messageSettings: MessageSettings;
  kanban: ReturnType<typeof getKanbanSettings>;
  peerPolicy: PeerPolicySettings;
  mainRole: AgentRow | null;
  roles: AgentRow[];
  repos: ApiRepo[];
  scanDirs: ApiScanDir[];
  runners: PublicRunnerStatus[];
  startedAt: string;
  logPath: string;
  currentWorkspace: { id: string; name: string };
}> {
  const db = ws.db;
  const policy = { mode: getPolicyMode(db) };
  const runtime = getDaemonRuntimeSettings(state.daemonDb);
  const chatHistory = getChatHistorySettings(db);
  const messageSettings = getMessageSettings(db);
  const kanban = getKanbanSettings(db);
  const peerPolicy = getPeerPolicySettings(db);
  return {
    fleet: state.config.fleet,
    policy,
    ui: state.config.ui,
    config: { ...state.config, policy, commands: runtime.commands },
    runtime,
    runtimeDetection: state.runtimeDetection,
    daemonSettings: { tuiRedraw: getTuiRedrawSettings(state.daemonDb) },
    chatHistory,
    messageSettings,
    kanban,
    peerPolicy,
    mainRole: getMainAgent(db),
    // Workspace-decoupling: legacy `roles` shape comes via the EP-DEC-1
    // compat shim which JOINs workspace_repos and projects `path`,
    // `git_root`, `missing_at`, `repo_id`, `repo_name`, `display_id`.
    // The new repo/scan-dir lists are surfaced alongside so the UI can
    // group roles by repo without an extra fetch.
    roles: agentOverviewRoles(db, listAgents(db)),
    repos: daoListRepos(db).map((row) => repoToApi(ws, row)),
    scanDirs: daoListScanDirs(db).map(scanDirToApi),
    runners: (await discoverAndReconcileRunners(state, ws)).map(publicRunnerStatus),
    startedAt: state.startedAt,
    logPath: state.logger.path,
    currentWorkspace: { id: ws.id, name: ws.name },
  };
}

function runStartupScans(workspaces: Map<string, WorkspaceState>, logger: ReturnType<typeof createLogger>): void {
  for (const ws of workspaces.values()) {
    let scanned = 0;
    let added = 0;
    for (const scan of daoListScanDirs(ws.db)) {
      if (scan.scan_on_startup !== 1) continue;
      scanned += 1;
      try {
        const result = daoRunScanDir(ws.db, scan.id);
        added += result.added.length;
        if (result.skipped.includes(scan.absolute_path)) {
          logger.warn("workspace.scan.failed", { workspaceId: ws.id, scanDir: scan.id, path: scan.absolute_path, error: "scan path unreadable" });
        }
      } catch (e) {
        logger.warn("workspace.scan.failed", { workspaceId: ws.id, scanDir: scan.id, path: scan.absolute_path, error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (scanned > 0) logger.info("workspace.scan.startup_complete", { workspaceId: ws.id, scanned, added });
  }
}

async function discoverAndReconcileRunners(state: DaemonState, ws: WorkspaceState): Promise<RunnerStatus[]> {
  const runners = await discoverRunners(ws.paths.runDir);
  const inactive = runners.filter((runner) => !runner.reachable && runner.session_id !== "unknown");
  if (inactive.length === 0) return runners;

  const db = ws.db;
  for (const runner of inactive) {
    // EP-DEC-RUN WA-006 (advisor msg #28): resolve by display_id so a
    // stale `beta:main` runner cannot reconcile-clear `alpha:main`.
    const role = getRoleByDisplayId(db, runner.display_id);
    if (!role) continue;
    stopRunnerSession(db, role.id, runner.session_id);
  }
  return runners;
}

function emptyRegistryShell(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>WhatsAgent</title></head>
<body style="font-family:system-ui;max-width:32em;margin:4em auto;padding:0 1em;">
<h1>No workspaces yet</h1>
<p>Register one from the CLI:</p>
<pre style="background:#f4f4f4;padding:1em;border-radius:4px;">whatsagent workspace add &lt;path&gt;</pre>
<p>Then refresh this page.</p>
</body></html>`;
}

function notFoundShell(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Workspace not found</title></head>
<body style="font-family:system-ui;max-width:32em;margin:4em auto;padding:0 1em;">
<h1>Workspace not found</h1>
<p>The URL refers to a workspace that does not exist or has been trashed.</p>
<p><a href="/">Return to current workspace</a></p>
</body></html>`;
}

async function shell(state: DaemonState, ws: WorkspaceState, req: Request): Promise<string> {
  const snap = await snapshot(state, ws);
  const auth = requireSession(state.daemonDb, req);
  refreshWorkspaceCache(state);
  const activeWorkspaces = await summarizeWorkspaces(state);
  return renderWebShell({
    clientBundle: state.clientBundle,
    root: ws.paths.slot,
    config: snap.config,
    runtime: snap.runtime,
    runtimeDetection: snap.runtimeDetection,
    daemonSettings: snap.daemonSettings,
    chatHistory: snap.chatHistory,
    messageSettings: snap.messageSettings,
    kanban: snap.kanban,
    peerPolicy: snap.peerPolicy,
    roles: snap.roles,
    mainRole: snap.mainRole,
    runners: snap.runners,
    currentWorkspace: { id: ws.id, name: ws.name },
    workspacesAvailable: activeWorkspaces.length,
    workspaces: activeWorkspaces,
    csrfToken: auth?.csrfToken ?? null,
  });
}

async function overviewShell(state: DaemonState, req: Request): Promise<string> {
  const auth = requireSession(state.daemonDb, req);
  refreshWorkspaceCache(state);
  const activeWorkspaces = await summarizeWorkspaces(state);
  const runtime = getDaemonRuntimeSettings(state.daemonDb);
  const daemonSettings = { tuiRedraw: getTuiRedrawSettings(state.daemonDb) };
  return renderWebShell({
    clientBundle: state.clientBundle,
    root: state.daemonHome,
    config: { ...state.config, commands: runtime.commands },
    runtime,
    runtimeDetection: state.runtimeDetection,
    daemonSettings,
    roles: [],
    mainRole: null,
    runners: [],
    currentWorkspace: null,
    workspacesAvailable: activeWorkspaces.length,
    workspaces: activeWorkspaces,
    view: "workspaces-overview",
    csrfToken: auth?.csrfToken ?? null,
  });
}

async function getSharedSettings(state: DaemonState, ws: WorkspaceState): Promise<Response> {
  const db = ws.db;
  return json({ ok: true, agentText: getAgentTextSettings(state.daemonDb), policy: { mode: getPolicyMode(db) }, peerPolicy: getPeerPolicySettings(db), runtime: getDaemonRuntimeSettings(state.daemonDb), runtimeDetection: state.runtimeDetection, daemonSettings: { tuiRedraw: getTuiRedrawSettings(state.daemonDb) }, chatHistory: getChatHistorySettings(db), messageSettings: getMessageSettings(db), kanban: getKanbanSettings(db), defaults: { agentText: DEFAULT_AGENT_TEXT_SETTINGS } });
}

async function getTuiRedrawSettingsEndpoint(state: DaemonState): Promise<Response> {
  const tuiRedraw = getTuiRedrawSettings(state.daemonDb);
  return json({ ok: true, ...tuiRedraw, tuiRedraw });
}

async function updateTuiRedrawSettingsEndpoint(state: DaemonState, input: unknown): Promise<Response> {
  try {
    const tuiRedraw = setTuiRedrawSettings(state.daemonDb, input);
    return json({ ok: true, ...tuiRedraw, tuiRedraw });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

async function updatePolicySettings(state: DaemonState, ws: WorkspaceState, input: unknown): Promise<Response> {
  const runners = await discoverAndReconcileRunners(state, ws);
  const db = ws.db;
  const body = input && typeof input === "object" ? input as { mode?: unknown } : {};
  const previousMode = getPolicyMode(db);
  const mode = setPolicyMode(db, body.mode);
  let channelJoined = 0;
  if (previousMode !== "channel" && mode === "channel") {
    for (const runner of runners) {
      if (!runner.reachable) continue;
      // EP-DEC-RUN WA-006 (advisor msg #28): resolve by display_id so
      // duplicate same-name roles each mark their own join.
      const role = getRoleByDisplayId(db, runner.display_id);
      if (!role) continue;
      markRoleJoinedChannel(db, role.id);
      channelJoined++;
    }
    state.logger.info("channel.policy.joined_online", { roles: channelJoined });
  }
  return json({ ok: true, policy: { mode }, channelJoined });
}

async function updatePeerPolicySettings(state: DaemonState, ws: WorkspaceState, input: unknown): Promise<Response> {
  const db = ws.db;
  const body = input && typeof input === "object" ? input as { mode?: unknown } : {};
  setPeerRuleMode(db, body.mode);
  return json({ ok: true, peerPolicy: getPeerPolicySettings(db) });
}

async function addPeerPolicyRule(state: DaemonState, ws: WorkspaceState, input: unknown): Promise<Response> {
  const db = ws.db;
  try {
    const body = input && typeof input === "object" ? input as { roleA?: unknown; roleB?: unknown } : {};
    const roleAAddr = String(body.roleA ?? "").trim();
    const roleBAddr = String(body.roleB ?? "").trim();
    // EP-DEC-RUN WA-006 (advisor msg #28): resolve by displayId/UUID;
    // bare-name lookup picks the wrong same-bare-name role.
    const roleA = roleAAddr ? (resolveRoleAddress(db, roleAAddr) ?? (daoGetRoleById(db, roleAAddr) ? adaptRoleWithDisplayToCompat(daoGetRoleById(db, roleAAddr)!) : null)) : null;
    const roleB = roleBAddr ? (resolveRoleAddress(db, roleBAddr) ?? (daoGetRoleById(db, roleBAddr) ? adaptRoleWithDisplayToCompat(daoGetRoleById(db, roleBAddr)!) : null)) : null;
    if (!roleA || !roleB) return json({ ok: false, error: "both roles must be addressed by `repo:role` displayId or UUID" }, { status: 400 });
    addPeerRule(db, roleA.id, roleB.id);
    return json({ ok: true, peerPolicy: getPeerPolicySettings(db) });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

async function removePeerPolicyRule(state: DaemonState, ws: WorkspaceState, id: number): Promise<Response> {
  const db = ws.db;
  removePeerRule(db, id);
  return json({ ok: true, peerPolicy: getPeerPolicySettings(db) });
}

async function updateRuntimeSettings(state: DaemonState, input: unknown): Promise<Response> {
  const previous = getDaemonRuntimeSettings(state.daemonDb).commands;
  const runtime = setDaemonRuntimeSettings(state.daemonDb, input);
  // Re-probe only runtimes whose `command` field changed; skip the rest so
  // toggling `enabled` doesn't burn 3x ~50-300ms probes for no reason.
  const probes: Promise<void>[] = [];
  for (const host of HOST_TYPES) {
    const key = commandsKeyForHost(host);
    if (previous[key].command !== runtime.commands[key].command) {
      probes.push(probeRuntime(host, runtime.commands[key].command).then((d) => { state.runtimeDetection[host] = d; }));
    }
  }
  if (probes.length > 0) await Promise.all(probes);
  return json({ ok: true, runtime, runtimeDetection: state.runtimeDetection });
}

async function detectAllRuntimes(state: DaemonState): Promise<Response> {
  const runtime = getDaemonRuntimeSettings(state.daemonDb);
  state.runtimeDetection = await probeAllRuntimes(runtime.commands);
  return json({ ok: true, runtimeDetection: state.runtimeDetection });
}

/**
 * Sync `state.currentWorkspaceId` from the daemon DB. The workspace runtime
 * cache (`state.workspaces`) is not touched here — it is mutated only by
 * `workspaceLifecycleHooks(state)` at lifecycle transitions and by boot-time
 * hydration. Call after operations that may have changed daemon-global
 * settings (current id) but not workspace lifecycle.
 */
function refreshWorkspaceCache(state: DaemonState): void {
  state.currentWorkspaceId = getCurrentWorkspaceId(state.daemonDb);
}

function workspaceLifecycleHooks(state: DaemonState): LifecycleHooks {
  return {
    log: (level, event, payload) => {
      const fn = level === "info" ? state.logger.info.bind(state.logger) : level === "warn" ? state.logger.warn.bind(state.logger) : state.logger.error.bind(state.logger);
      fn(event, payload);
    },
    openWorkspaceDb: (row) => {
      // Idempotent: skip if already cached. Restore can be invoked from
      // multiple paths (repair, endpoint) and we never want a stale handle.
      const existing = state.workspaces.get(row.id);
      if (existing) closeWorkspaceState(existing);
      state.workspaces.set(row.id, loadWorkspaceState(state.daemonHome, row));
    },
    closeWorkspaceDb: (id) => {
      const existing = state.workspaces.get(id);
      if (!existing) return;
      closeWorkspaceState(existing);
      state.workspaces.delete(id);
    },
  };
}

async function createWorkspaceEndpoint(state: DaemonState, input: unknown): Promise<Response> {
  const body = input && typeof input === "object" ? input as { name?: unknown; kanbanPrefix?: unknown; path?: unknown; type?: unknown; rbacMode?: unknown } : {};
  // Workspace decoupling: reject legacy path/type fields explicitly.
  if (body.path !== undefined || body.type !== undefined) {
    return json({ ok: false, error: "workspace decoupling: path/type are gone; manage repos via /repos endpoints" }, { status: 400 });
  }
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "";
  if (!name) return json({ ok: false, error: "name is required" }, { status: 400 });
  // EP-022 / WA-094: rbacMode is required (no implicit default) so the
  // operator makes a conscious enforcement choice at create time. The
  // schema NOT NULL DEFAULT 'enforce' is only the safety net for legacy
  // callers; the API rejects to surface UX-layer omission early.
  if (!isRbacMode(body.rbacMode)) {
    return json(
      { ok: false, error: `rbacMode is required and must be one of: ${RBAC_MODES.join(", ")}` },
      { status: 400 },
    );
  }
  const rbacMode = body.rbacMode;
  // EP-DEC-FIX (WA-089): mirror the PATCH path. Empty/non-string is a 400;
  // a malformed prefix is rejected up-front via the same normalizer the
  // Edit endpoint uses, so we never insert a workspace row that is doomed
  // to land in 'error' status.
  let kanbanPrefix: string | undefined;
  if (body.kanbanPrefix !== undefined) {
    if (typeof body.kanbanPrefix !== "string") {
      return json({ ok: false, error: "kanbanPrefix must be a string" }, { status: 400 });
    }
    const trimmed = body.kanbanPrefix.trim();
    if (!trimmed) return json({ ok: false, error: "kanbanPrefix cannot be empty" }, { status: 400 });
    try {
      kanbanPrefix = normalizeKanbanTaskIdPrefix(trimmed, DEFAULT_KANBAN_TASK_ID_PREFIX);
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
  }
  try {
    const ws = await createWorkspace(state.daemonDb, state.daemonHome, { name, kanbanPrefix, rbacMode });
    if (ws.status === "active" && !state.workspaces.has(ws.id)) {
      state.workspaces.set(ws.id, loadWorkspaceState(state.daemonHome, ws));
    }
    refreshWorkspaceCache(state);
    return json({ ok: true, workspace: ws });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

/**
 * EP-022 / WA-094 PATCH `/api/v1/workspaces/:id/rbac-mode`. Flips the
 * stored mode + refreshes the cached `WorkspaceState.rbacMode` so the
 * dispatcher picks up the new value without restart. Audit-write is
 * deliberately scoped to `daemon_settings` log line — the per-workspace
 * audit_log is a per-call signal, not a config-change signal.
 */
async function setWorkspaceRbacModeEndpoint(state: DaemonState, workspaceId: string, input: unknown): Promise<Response> {
  const ws = state.workspaces.get(workspaceId);
  if (!ws) return json({ ok: false, error: "workspace_not_found" }, { status: 404 });
  const body = input && typeof input === "object" ? input as { rbacMode?: unknown } : {};
  if (!isRbacMode(body.rbacMode)) {
    return json(
      { ok: false, error: `rbacMode is required and must be one of: ${RBAC_MODES.join(", ")}` },
      { status: 400 },
    );
  }
  const next = body.rbacMode;
  const previous = ws.rbacMode;
  setWorkspaceRbacMode(state.daemonDb, workspaceId, next);
  ws.rbacMode = next;
  state.logger.info("rbac.workspace_mode_changed", { workspaceId, previous, next });
  return json({ ok: true, workspaceId, rbacMode: next, previous });
}

async function listWorkspacesEndpoint(state: DaemonState, url: URL): Promise<Response> {
  refreshWorkspaceCache(state);
  const includeTrash = url.searchParams.get("include_trash") === "1" || url.searchParams.get("include_trash") === "true";
  const rows = await summarizeWorkspaces(state, { includeTrash });
  return json({
    ok: true,
    workspaces: rows,
    currentWorkspaceId: state.currentWorkspaceId,
    trashRetentionDays: getTrashRetentionDays(state.daemonDb),
  });
}

async function summarizeWorkspaces(state: DaemonState, opts: { includeTrash?: boolean } = {}): Promise<Array<WorkspaceRow & { repo_count: number; role_count: number; runner_count: number }>> {
  const rows = listWorkspaces(state.daemonDb, opts);
  const summaries: Array<WorkspaceRow & { repo_count: number; role_count: number; runner_count: number }> = [];
  for (const row of rows) {
    const cached = row.status === "active" ? state.workspaces.get(row.id) : undefined;
    const repoCount = cached ? daoListRepos(cached.db).length : 0;
    const roleCount = cached ? listAgents(cached.db).length : 0;
    const runners = cached ? await discoverRunners(cached.paths.runDir) : [];
    summaries.push({ ...row, repo_count: repoCount, role_count: roleCount, runner_count: runners.filter((runner) => runner.reachable).length });
  }
  return summaries;
}

async function getCurrentWorkspaceEndpoint(state: DaemonState): Promise<Response> {
  const id = state.currentWorkspaceId;
  if (!id) return json({ ok: true, current: null });
  const ws = getWorkspace(state.daemonDb, id);
  return json({ ok: true, current: ws });
}

async function setCurrentWorkspaceEndpoint(state: DaemonState, input: unknown): Promise<Response> {
  const body = input && typeof input === "object" ? input as { id?: unknown } : {};
  const id = typeof body.id === "string" && body.id ? body.id : null;
  if (id !== null) {
    const ws = getWorkspace(state.daemonDb, id);
    if (!ws || ws.status === "trashed" || ws.status === "purging") {
      return json({ ok: false, error: `unknown or trashed workspace: ${id}` }, { status: 404 });
    }
  }
  setCurrentWorkspaceId(state.daemonDb, id);
  state.currentWorkspaceId = id;
  return json({ ok: true, currentWorkspaceId: id });
}

async function patchWorkspaceEndpoint(state: DaemonState, id: string, input: unknown): Promise<Response> {
  const existing = getWorkspace(state.daemonDb, id);
  if (!existing) return json({ ok: false, error: "not_found" }, { status: 404 });
  const body = input && typeof input === "object" ? input as { name?: unknown; kanbanPrefix?: unknown; path?: unknown; type?: unknown; rbacMode?: unknown } : {};
  // Workspace decoupling: reject legacy path/type fields explicitly so
  // stale clients fail loudly.
  if (body.path !== undefined || body.type !== undefined) {
    return json({ ok: false, error: "workspace decoupling: path/type are gone; manage repos via /repos endpoints" }, { status: 400 });
  }
  // EP-022 / WA-094 (advisor msg #411 ¶2): validate ALL fields BEFORE
  // applying any DB writes so a downstream validation failure cannot
  // leave the workspace in a half-applied state (e.g. rbacMode flipped
  // but rename rejected). Each pre-write check returns 400 on failure;
  // only the post-validation block touches the DAO + cache.
  let validatedRbacMode: RbacMode | null = null;
  if (body.rbacMode !== undefined) {
    if (!isRbacMode(body.rbacMode)) {
      return json(
        { ok: false, error: `rbacMode must be one of: ${RBAC_MODES.join(", ")}` },
        { status: 400 },
      );
    }
    if (!state.workspaces.get(id)) {
      return json({ ok: false, error: "workspace is not active; cannot update rbacMode" }, { status: 409 });
    }
    validatedRbacMode = body.rbacMode;
  }
  let validatedName: string | null = null;
  if (body.name !== undefined) {
    if (typeof body.name !== "string") {
      return json({ ok: false, error: "name must be a string" }, { status: 400 });
    }
    const name = body.name.trim();
    if (!name) return json({ ok: false, error: "name cannot be empty" }, { status: 400 });
    validatedName = name;
  }
  let validatedKanbanPrefix: string | null = null;
  if (body.kanbanPrefix !== undefined) {
    if (typeof body.kanbanPrefix !== "string") {
      return json({ ok: false, error: "kanbanPrefix must be a string" }, { status: 400 });
    }
    const prefix = body.kanbanPrefix.trim();
    if (!prefix) return json({ ok: false, error: "kanbanPrefix cannot be empty" }, { status: 400 });
    if (!state.workspaces.get(id)) {
      return json({ ok: false, error: "workspace is not active; cannot update settings" }, { status: 409 });
    }
    validatedKanbanPrefix = prefix;
  }

  // All fields validated — apply writes. If a name rename collision
  // (e.g. duplicate active-name UNIQUE INDEX violation) throws here
  // we catch + 400 below; previously-applied rbacMode would have been
  // similarly orphaned, but advisor msg #411 ¶2 wants the rbac flip to
  // happen LAST so a pre-flip throw bails before mode mutation.
  let row = existing;
  let rbacModeChanged: { previous: RbacMode; next: RbacMode } | null = null;
  try {
    if (validatedName !== null && validatedName !== row.name) {
      row = renameWorkspace(state.daemonDb, id, validatedName);
    }
    if (validatedKanbanPrefix !== null) {
      const cached = state.workspaces.get(id)!; // null-checked above
      const { setKanbanSettings, getKanbanSettings } = await import("../db.ts");
      const current = getKanbanSettings(cached.db);
      setKanbanSettings(cached.db, { ...current, taskIdPrefix: validatedKanbanPrefix });
    }
    if (validatedRbacMode !== null) {
      const cached = state.workspaces.get(id)!;
      if (validatedRbacMode !== cached.rbacMode) {
        rbacModeChanged = { previous: cached.rbacMode, next: validatedRbacMode };
        setWorkspaceRbacMode(state.daemonDb, id, validatedRbacMode);
        cached.rbacMode = validatedRbacMode;
        state.logger.info("rbac.workspace_mode_changed", { workspaceId: id, previous: rbacModeChanged.previous, next: rbacModeChanged.next, source: "patch" });
      }
    }
    const cached = state.workspaces.get(id);
    if (cached) cached.name = row.name;
    // Re-read the row so the response reflects the freshly-updated
    // rbac_mode column when the caller flipped mode in this PATCH.
    const refreshed = rbacModeChanged ? getWorkspace(state.daemonDb, id) ?? row : row;
    return json({ ok: true, workspace: refreshed });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

async function updateTrashRetentionEndpoint(state: DaemonState, input: unknown): Promise<Response> {
  const body = input && typeof input === "object" ? input as { days?: unknown } : {};
  const days = typeof body.days === "number" ? body.days : Number(body.days);
  try {
    return json({ ok: true, trashRetentionDays: setTrashRetentionDays(state.daemonDb, days) });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

async function trashWorkspaceEndpoint(state: DaemonState, id: string): Promise<Response> {
  const ws = getWorkspace(state.daemonDb, id);
  if (!ws) return json({ ok: false, error: "not_found" }, { status: 404 });
  const next = await trashWorkspace(state.daemonDb, state.daemonHome, ws, workspaceLifecycleHooks(state));
  refreshWorkspaceCache(state);
  return json({ ok: true, workspace: next });
}

async function restoreWorkspaceEndpoint(state: DaemonState, id: string): Promise<Response> {
  const ws = getWorkspace(state.daemonDb, id);
  if (!ws) return json({ ok: false, error: "not_found" }, { status: 404 });
  try {
    const next = await restoreWorkspace(state.daemonDb, state.daemonHome, ws, workspaceLifecycleHooks(state));
    refreshWorkspaceCache(state);
    return json({ ok: true, workspace: next });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

async function purgeWorkspaceEndpoint(state: DaemonState, id: string): Promise<Response> {
  const ws = getWorkspace(state.daemonDb, id);
  if (!ws) return json({ ok: false, error: "not_found" }, { status: 404 });
  try {
    await purgeWorkspace(state.daemonDb, state.daemonHome, ws, workspaceLifecycleHooks(state));
    refreshWorkspaceCache(state);
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

async function detectOneRuntime(state: DaemonState, hostParam: string, customCommand: string | null): Promise<Response> {
  let host: HostType;
  try {
    host = normalizeHostType(hostParam);
  } catch {
    return json({ ok: false, error: `Unknown runtime: ${hostParam}` }, { status: 400 });
  }
  // ?command=<path> probes an ad-hoc command without persisting it. Used by
  // the Settings panel to update the detection chip while the user is still
  // typing in the Command field. We update state.runtimeDetection so the
  // chip stays consistent across re-renders, but the user's saved settings
  // don't change until they hit Save.
  const probeCommand = customCommand !== null
    ? customCommand
    : getDaemonRuntimeSettings(state.daemonDb).commands[commandsKeyForHost(host)].command;
  state.runtimeDetection[host] = await probeRuntime(host, probeCommand);
  return json({ ok: true, host, detection: state.runtimeDetection[host] });
}

async function updateChatHistorySettings(state: DaemonState, ws: WorkspaceState, input: unknown): Promise<Response> {
  const db = ws.db;
  try {
    const chatHistory = setChatHistorySettings(db, input);
    const pruned = pruneChatHistoryByRetention(db);
    if (pruned.total > 0) state.logger.info("chat_history.pruned", { source: "settings", ...pruned });
    return json({ ok: true, chatHistory, pruned });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

async function updateMessageSettings(state: DaemonState, ws: WorkspaceState, input: unknown): Promise<Response> {
  const db = ws.db;
  try {
    return json({ ok: true, messageSettings: setMessageSettings(db, input) });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

async function updateKanbanSettings(state: DaemonState, ws: WorkspaceState, input: unknown): Promise<Response> {
  const db = ws.db;
  try {
    return json({ ok: true, kanban: setKanbanSettings(db, input) });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

async function clearChatHistorySettings(state: DaemonState, ws: WorkspaceState, input: unknown): Promise<Response> {
  const body = input && typeof input === "object" ? input as { confirm?: unknown } : {};
  if (body.confirm !== "CLEAR") return json({ ok: false, error: "confirmation must be CLEAR" }, { status: 400 });
  const db = ws.db;
  const cleared = clearChatHistory(db);
  state.logger.info("chat_history.cleared", { ...cleared });
  return json({ ok: true, chatHistory: getChatHistorySettings(db), cleared });
}

async function updateAgentTextSettings(state: DaemonState, input: unknown): Promise<Response> {
  return json({ ok: true, agentText: setAgentTextSettings(state.daemonDb, input), defaults: { agentText: DEFAULT_AGENT_TEXT_SETTINGS } });
}

async function resetSharedAgentTextSettings(state: DaemonState): Promise<Response> {
  return json({ ok: true, agentText: resetAgentTextSettings(state.daemonDb), defaults: { agentText: DEFAULT_AGENT_TEXT_SETTINGS } });
}

async function listCustomPromptsEndpoint(state: DaemonState): Promise<Response> {
  return json({ ok: true, prompts: listCustomPrompts(state.daemonDb) });
}

async function createCustomPromptEndpoint(state: DaemonState, input: unknown): Promise<Response> {
  try {
    const prompt = createCustomPrompt(state.daemonDb, input && typeof input === "object" ? input as { title?: unknown; body?: unknown } : {});
    return json({ ok: true, prompt }, { status: 201 });
  } catch (e) {
    return customPromptErrorResponse(e);
  }
}

async function updateCustomPromptEndpoint(state: DaemonState, id: string, input: unknown): Promise<Response> {
  try {
    const prompt = updateCustomPrompt(state.daemonDb, id, input && typeof input === "object" ? input as { title?: unknown; body?: unknown } : {});
    return json({ ok: true, prompt });
  } catch (e) {
    return customPromptErrorResponse(e);
  }
}

async function deleteCustomPromptEndpoint(state: DaemonState, id: string): Promise<Response> {
  const deleted = deleteCustomPrompt(state.daemonDb, id);
  if (!deleted) return json({ ok: false, error: "custom prompt not found" }, { status: 404 });
  return json({ ok: true, deleted: true });
}

function customPromptErrorResponse(e: unknown): Response {
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof DuplicateCustomPromptTitleError) return json({ ok: false, error: message }, { status: 409 });
  if (message === "custom prompt not found") return json({ ok: false, error: message }, { status: 404 });
  return json({ ok: false, error: message }, { status: 400 });
}

let dummyPasswordHashPromise: Promise<string> | null = null;

function renderLoginPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WhatsAgent Login</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#e5e7eb;font:15px/1.4 system-ui,-apple-system,Segoe UI,sans-serif}.card{width:min(420px,calc(100vw - 32px));background:#111827;border:1px solid #334155;border-radius:18px;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.35)}h1{margin:0 0 8px;font-size:24px}.muted{color:#94a3b8;margin:0 0 22px}label{display:block;margin:14px 0 6px;color:#cbd5e1}input{width:100%;box-sizing:border-box;border:1px solid #334155;border-radius:10px;background:#020617;color:#f8fafc;padding:11px 12px;font:inherit}button{margin-top:18px;width:100%;border:0;border-radius:10px;background:#6366f1;color:white;padding:12px;font-weight:700;cursor:pointer}.secondary{background:#334155}.error{display:none;margin-top:14px;color:#fecaca;background:#7f1d1d;border:1px solid #991b1b;border-radius:10px;padding:10px}.row{display:grid;gap:10px;margin-top:10px}</style>
</head><body><main class="card"><h1>WhatsAgent</h1><p class="muted">Sign in to manage this local daemon.</p><form id="login"><label for="username">Username</label><input id="username" name="username" autocomplete="username" required autofocus><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button>Log in</button><div class="error" id="error"></div></form><div class="row"><form id="recovery"><label for="recoveryCode">Recovery code</label><input id="recoveryCode" name="recoveryCode" autocomplete="one-time-code"><button class="secondary">Use recovery code</button></form></div></main><script>
const show=e=>{const box=document.getElementById('error');box.textContent=e;box.style.display='block'};
function safeReturnPath(value){if(!value)return '/';const raw=String(value);if(!raw.startsWith('/')||raw.startsWith('//'))return '/';for(let i=0;i<raw.length;i++){const c=raw.charCodeAt(i);if(c===92||c<32||c===127||c===8232||c===8233)return '/';}try{const url=new URL(raw,location.origin);if(url.origin!==location.origin)return '/';if(url.protocol!=='http:'&&url.protocol!=='https:')return '/';return url.pathname+url.search+url.hash;}catch{return '/';}}
async function post(path,body){const res=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await res.json().catch(()=>({}));if(!res.ok||data.ok===false)throw new Error(data.error||'login failed');const returnTo=new URLSearchParams(location.search).get('return');location.href=safeReturnPath(returnTo);}
document.getElementById('login').addEventListener('submit',e=>{e.preventDefault();post('/api/v1/auth/login',{username:username.value,password:password.value}).catch(err=>show(err.message));});
document.getElementById('recovery').addEventListener('submit',e=>{e.preventDefault();post('/api/v1/auth/login-recovery',{username:username.value,recoveryCode:recoveryCode.value}).catch(err=>show(err.message));});
</script></body></html>`;
}

function renderSetupPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WhatsAgent Setup</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#e5e7eb;font:15px/1.4 system-ui,-apple-system,Segoe UI,sans-serif}.card{width:min(480px,calc(100vw - 32px));background:#111827;border:1px solid #334155;border-radius:18px;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.35)}h1{margin:0 0 8px;font-size:24px}.muted{color:#94a3b8;margin:0 0 22px}label{display:block;margin:14px 0 6px;color:#cbd5e1}input{width:100%;box-sizing:border-box;border:1px solid #334155;border-radius:10px;background:#020617;color:#f8fafc;padding:11px 12px;font:inherit}button{margin-top:18px;width:100%;border:0;border-radius:10px;background:#6366f1;color:white;padding:12px;font-weight:700;cursor:pointer}button:disabled{opacity:.5;cursor:not-allowed}.error{display:none;margin-top:14px;color:#fecaca;background:#7f1d1d;border:1px solid #991b1b;border-radius:10px;padding:10px}.meter{height:8px;border-radius:999px;background:#1e293b;overflow:hidden}.meter span{display:block;height:100%;width:0;background:#ef4444;transition:width .15s,background .15s}.code{font:700 16px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;background:#020617;border:1px solid #334155;border-radius:12px;padding:16px;word-break:break-all}.hidden{display:none}.ok{color:#bbf7d0}</style>
</head><body><main class="card"><h1>Set up WhatsAgent</h1><p class="muted">Create the first local web user. This account protects all workspaces on this daemon.</p><form id="setup"><label for="username">Username</label><input id="username" name="username" autocomplete="username" required autofocus><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="new-password" required minlength="8"><div class="meter" aria-label="password strength"><span id="strengthBar"></span></div><p class="muted" id="strengthText">Use at least 8 chars; mix cases, numbers, or symbols.</p><label for="passwordConfirm">Confirm password</label><input id="passwordConfirm" name="passwordConfirm" type="password" autocomplete="new-password" required minlength="8"><button id="submitSetup">Create user</button><div class="error" id="error"></div></form><section id="recovery" class="hidden"><h1>Recovery code</h1><p class="muted">Copy this now. It is shown once and lets you regain access if you forget the password.</p><div class="code" id="recoveryCode"></div><button id="copyRecovery">Copy recovery code</button><button id="continueBtn" disabled>I have copied this — continue</button><p class="muted ok" id="copyStatus"></p></section></main><script>
const $=id=>document.getElementById(id);const show=e=>{const box=$('error');box.textContent=e;box.style.display='block'};
function strength(v){let s=0;if(v.length>=8)s++;if(/[a-z]/.test(v)&&/[A-Z]/.test(v))s++;if(/\d/.test(v))s++;if(/[^A-Za-z0-9]/.test(v))s++;return s}
password.addEventListener('input',()=>{const s=strength(password.value);strengthBar.style.width=(s*25)+'%';strengthBar.style.background=s<2?'#ef4444':s<4?'#f59e0b':'#22c55e';strengthText.textContent=s<2?'Weak password':s<4?'Medium password':'Strong password'});
setup.addEventListener('submit',async e=>{e.preventDefault();if(password.value!==passwordConfirm.value)return show('passwords do not match');const res=await fetch('/api/v1/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:username.value,password:password.value,passwordConfirm:passwordConfirm.value})});const data=await res.json().catch(()=>({}));if(!res.ok||data.ok===false)return show(data.error||'setup failed');setup.classList.add('hidden');recovery.classList.remove('hidden');recoveryCode.textContent=data.recoveryCode;});
copyRecovery.addEventListener('click',async()=>{await navigator.clipboard?.writeText(recoveryCode.textContent||'').catch(()=>{});continueBtn.disabled=false;copyStatus.textContent='Copied. Continue is enabled.'});
continueBtn.addEventListener('click',()=>{location.href='/'});
</script></body></html>`;
}

async function setupEndpoint(state: DaemonState, req: Request, input: unknown): Promise<Response> {
  if (countAuthUsers(state.daemonDb) > 0) return json({ ok: false, error: "already_set_up" }, { status: 409 });
  const body = input && typeof input === "object" ? input as { username?: unknown; password?: unknown; passwordConfirm?: unknown } : {};
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const passwordConfirm = typeof body.passwordConfirm === "string" ? body.passwordConfirm : "";
  if (!username) return json({ ok: false, error: "username is required" }, { status: 400 });
  if (password.length < 8) return json({ ok: false, error: "password must be at least 8 characters" }, { status: 400 });
  if (password !== passwordConfirm) return json({ ok: false, error: "passwords do not match" }, { status: 400 });
  const recoveryCode = createRecoveryCode();
  const passwordHash = await hashPassword(password);
  const recoveryHash = await hashPassword(recoveryCode);
  try {
    const created = state.daemonDb.transaction(() => {
      if (countAuthUsers(state.daemonDb) > 0) throw new Error("already_set_up");
      const user = createAuthUser(state.daemonDb, {
        username,
        passwordHash,
        recoveryHash,
      });
      const session = createUserSession(state.daemonDb, { userId: user.id, req });
      return { user, ...session };
    })();
    const headers = new Headers();
    attachSessionCookie(headers, created.token, req);
    state.logger.info("auth.setup_completed", { user: created.user.username, userId: created.user.id, sessionId: created.session.id });
    return jsonWithHeaders({ ok: true, user: publicAuthUser(created.user), session: publicAuthSession(created.session), csrfToken: created.csrfToken, recoveryCode }, headers, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message === "already_set_up") return json({ ok: false, error: "already_set_up" }, { status: 409 });
    return json({ ok: false, error: message }, { status: 400 });
  }
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const LOGIN_FAILURE_WINDOW_MS = 60_000;
const LOGIN_LOCKOUT_MS = 15 * 60_000;
const LOGIN_MAX_FAILURES_PER_WINDOW = 5;
const loginFailureWindows = new Map<string, { startedAt: number; count: number }>();
const RECOVERY_FAILURE_WINDOW_MS = 60_000;
const RECOVERY_MAX_FAILURES_PER_WINDOW = 10;
const recoveryFailureWindows = new Map<string, { startedAt: number; count: number }>();

function createRecoveryCode(): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of randomBytes(20)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{1,4}/g)!.join("-");
}

async function loginEndpoint(state: DaemonState, req: Request, input: unknown): Promise<Response> {
  const body = input && typeof input === "object" ? input as { username?: unknown; password?: unknown } : {};
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) return json({ ok: false, error: "username and password are required" }, { status: 400 });
  const user = getAuthUserByUsername(state.daemonDb, username);
  if (!user) {
    await verifyAgainstDummyPassword(password);
    return json({ ok: false, error: "invalid credentials" }, { status: 401 });
  }
  if (user.locked_until && Date.parse(user.locked_until) > Date.now()) {
    return json({ ok: false, error: "account_locked" }, { status: 423, headers: { "Retry-After": String(Math.ceil((Date.parse(user.locked_until) - Date.now()) / 1000)) } });
  }
  if (!await verifyPassword(user.password_hash, password)) {
    const now = Date.now();
    const existingWindow = loginFailureWindows.get(user.id);
    const window = existingWindow && now - existingWindow.startedAt < LOGIN_FAILURE_WINDOW_MS ? existingWindow : { startedAt: now, count: 0 };
    if (window.count === 0) resetFailedAttempts(state.daemonDb, user.id);
    window.count += 1;
    loginFailureWindows.set(user.id, window);
    const failed = incFailedAttempts(state.daemonDb, user.id);
    if (window.count >= LOGIN_MAX_FAILURES_PER_WINDOW) {
      loginFailureWindows.delete(user.id);
      const locked = setLockedUntil(state.daemonDb, user.id, new Date(now + LOGIN_LOCKOUT_MS).toISOString());
      return json({ ok: false, error: "account_locked" }, { status: 423, headers: { "Retry-After": String(Math.ceil((Date.parse(locked.locked_until!) - Date.now()) / 1000)) } });
    }
    return json({ ok: false, error: "invalid credentials" }, { status: 401 });
  }
  loginFailureWindows.delete(user.id);
  resetFailedAttempts(state.daemonDb, user.id);
  const { token, session, csrfToken } = createUserSession(state.daemonDb, { userId: user.id, req });
  const headers = new Headers();
  attachSessionCookie(headers, token, req);
  state.logger.info("auth.login", { userId: user.id, sessionId: session.id });
  return jsonWithHeaders({ ok: true, user: publicAuthUser(user), session: publicAuthSession(session), csrfToken }, headers);
}

async function loginRecoveryEndpoint(state: DaemonState, req: Request, input: unknown): Promise<Response> {
  const body = input && typeof input === "object" ? input as { username?: unknown; recoveryCode?: unknown } : {};
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const recoveryCode = typeof body.recoveryCode === "string" ? body.recoveryCode.trim() : "";
  if (!username || !recoveryCode) return json({ ok: false, error: "username and recoveryCode are required" }, { status: 400 });
  const user = getAuthUserByUsername(state.daemonDb, username);
  if (!user?.recovery_hash) {
    await verifyAgainstDummyPassword(recoveryCode);
    return json({ ok: false, error: "invalid credentials" }, { status: 401 });
  }
  const slot = reserveRecoverySlot(user.id);
  if (!slot.ok) return json({ ok: false, error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(slot.retryAfter) } });
  if (!await verifyPassword(user.recovery_hash, recoveryCode)) {
    return json({ ok: false, error: "invalid credentials" }, { status: 401 });
  }
  recoveryFailureWindows.delete(user.id);
  let consumed;
  try { consumed = consumeRecovery(state.daemonDb, user.id, user.recovery_hash); }
  catch { return json({ ok: false, error: "invalid credentials" }, { status: 401 }); }
  const { token, session, csrfToken } = createUserSession(state.daemonDb, { userId: consumed.id, req, forcePwdReset: true });
  const headers = new Headers();
  attachSessionCookie(headers, token, req);
  state.logger.info("auth.recovery_login", { userId: consumed.id, sessionId: session.id });
  return jsonWithHeaders({ ok: true, user: publicAuthUser(consumed), session: publicAuthSession(session), csrfToken, forcePwdReset: true }, headers);
}

function reserveRecoverySlot(userId: string): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const existing = recoveryFailureWindows.get(userId);
  if (existing && now - existing.startedAt < RECOVERY_FAILURE_WINDOW_MS) {
    if (existing.count >= RECOVERY_MAX_FAILURES_PER_WINDOW) {
      return { ok: false, retryAfter: Math.ceil((existing.startedAt + RECOVERY_FAILURE_WINDOW_MS - now) / 1000) };
    }
    existing.count += 1;
    return { ok: true };
  }
  recoveryFailureWindows.set(userId, { startedAt: now, count: 1 });
  return { ok: true };
}

async function logoutEndpoint(state: DaemonState, req: Request): Promise<Response> {
  const token = getCookie(req.headers.get("cookie") ?? "", AUTH_COOKIE_NAME);
  if (token) {
    const session = getSessionByTokenHash(state.daemonDb, hashSessionToken(token));
    if (session) state.daemonDb.run("DELETE FROM auth_sessions WHERE id = ?", [session.id]);
  }
  const headers = new Headers();
  clearSessionCookie(headers, req);
  return redirect("/login", 302, headers);
}

function requireWebSessionResponse(state: DaemonState, req: Request) {
  const session = requireSession(state.daemonDb, req);
  if (!session) return { error: json({ ok: false, error: "auth_required" }, { status: 401 }) };
  return { session };
}

async function authMeEndpoint(state: DaemonState, req: Request): Promise<Response> {
  const auth: any = requireWebSessionResponse(state, req);
  if (auth.error) return auth.error;
  return json({ ok: true, user: publicAuthUser(auth.session.user), session: publicAuthSession(auth.session.session), csrfToken: auth.session.csrfToken });
}

async function authSessionsEndpoint(state: DaemonState, req: Request): Promise<Response> {
  const auth: any = requireWebSessionResponse(state, req);
  if (auth.error) return auth.error;
  return json({ ok: true, currentSessionId: auth.session.session.id, sessions: listSessionsForUser(state.daemonDb, auth.session.user.id).map(publicAuthSession) });
}

async function changePasswordEndpoint(state: DaemonState, req: Request, input: unknown): Promise<Response> {
  const auth: any = requireWebSessionResponse(state, req);
  if (auth.error) return auth.error;
  const body = input && typeof input === "object" ? input as { currentPassword?: unknown; newPassword?: unknown } : {};
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (newPassword.length < 8) return json({ ok: false, error: "newPassword must be at least 8 characters" }, { status: 400 });
  if (auth.session.session.force_pwd_reset !== 1 && !await verifyPassword(auth.session.user.password_hash, currentPassword)) return json({ ok: false, error: "invalid credentials" }, { status: 401 });
  const passwordHash = await hashPassword(newPassword);
  const user = updateAuthUserPassword(state.daemonDb, auth.session.user.id, passwordHash);
  deleteSessionsForUser(state.daemonDb, user.id, auth.session.session.id);
  clearSessionForcePwdReset(state.daemonDb, auth.session.session.id);
  state.logger.info("auth.password_changed", { userId: user.id, sessionId: auth.session.session.id });
  return json({ ok: true, user: publicAuthUser(user) });
}

async function deleteAuthSessionEndpoint(state: DaemonState, req: Request, sessionId: string): Promise<Response> {
  const auth: any = requireWebSessionResponse(state, req);
  if (auth.error) return auth.error;
  const session = listSessionsForUser(state.daemonDb, auth.session.user.id).find((row) => row.id === sessionId);
  if (!session) return json({ ok: false, error: "session not found" }, { status: 404 });
  deleteSession(state.daemonDb, sessionId);
  const headers = new Headers();
  if (sessionId === auth.session.session.id) clearSessionCookie(headers, req);
  return jsonWithHeaders({ ok: true, deleted: true }, headers);
}

async function signOutOtherSessionsEndpoint(state: DaemonState, req: Request): Promise<Response> {
  const auth: any = requireWebSessionResponse(state, req);
  if (auth.error) return auth.error;
  const deleted = deleteSessionsForUser(state.daemonDb, auth.session.user.id, auth.session.session.id);
  return json({ ok: true, deleted });
}

async function regenerateRecoveryEndpoint(state: DaemonState, req: Request): Promise<Response> {
  const auth: any = requireWebSessionResponse(state, req);
  if (auth.error) return auth.error;
  const recoveryCode = createRecoveryCode();
  const user = regenerateRecovery(state.daemonDb, auth.session.user.id, await hashPassword(recoveryCode));
  state.logger.info("auth.recovery_regenerated", { userId: user.id });
  return json({ ok: true, recoveryCode, user: publicAuthUser(user) });
}

// EP-023 / WA-103 — POST /api/v1/client-debug. Receives batched xterm
// debug events from authed browsers and appends them to
// `~/.whatsagent/logs/xterm-debug.log` via state.clientDebugLogger.
//
// Caps (advisor-reviewed 2026-05-05): 30 batches / 60s / session, 50
// events / batch, 32 KB / request body.
//
// Redaction: the shared `redact()` in src/logger.ts is top-level only,
// so a payload like `{ events: [{ token: "abc" }] }` would otherwise log
// unredacted. `sanitizeClientDebugEvent` walks each event's `payload`
// object recursively, replaces values under any key matching
// CLIENT_DEBUG_REDACT_KEYS with `"[redacted]"`, caps string length, caps
// recursion depth, and caps array length. Capture is intended for
// metadata + lifecycle only — never raw PTY bytes — and the redact
// keyset doubles as a safety net if a future tap accidentally captures
// user input or a URL with a token in the query string.
const CLIENT_DEBUG_WINDOW_MS = 60_000;
const CLIENT_DEBUG_MAX_BATCHES_PER_WINDOW = 30;
const CLIENT_DEBUG_MAX_EVENTS_PER_BATCH = 50;
const CLIENT_DEBUG_MAX_BODY_BYTES = 32 * 1024;
const CLIENT_DEBUG_MAX_STRING_LEN = 512;
const CLIENT_DEBUG_MAX_DEPTH = 6;
const CLIENT_DEBUG_MAX_ARRAY_LEN = 50;
const CLIENT_DEBUG_REDACT_KEYS = /^(token|secret|password|api[_-]?key|authorization|cookie|url|href|search|hash|pathname|clipboard|selection|input|data|text|value|key|code)$/i;

function sanitizeClientDebugValue(value: unknown, depth = 0): unknown {
  if (depth > CLIENT_DEBUG_MAX_DEPTH) return "[truncated]";
  if (value === null) return null;
  if (typeof value === "string") {
    return value.length > CLIENT_DEBUG_MAX_STRING_LEN
      ? value.slice(0, CLIENT_DEBUG_MAX_STRING_LEN) + "…[truncated]"
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const slice = value.slice(0, CLIENT_DEBUG_MAX_ARRAY_LEN);
    const sanitized = slice.map((item) => sanitizeClientDebugValue(item, depth + 1));
    if (value.length > CLIENT_DEBUG_MAX_ARRAY_LEN) sanitized.push(`[+${value.length - CLIENT_DEBUG_MAX_ARRAY_LEN} truncated]`);
    return sanitized;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (CLIENT_DEBUG_REDACT_KEYS.test(k)) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = sanitizeClientDebugValue(v, depth + 1);
    }
    return out;
  }
  return undefined;
}

async function clientDebugIngestEndpoint(state: DaemonState, req: Request): Promise<Response> {
  const auth: any = requireWebSessionResponse(state, req);
  if (auth.error) return auth.error;
  const sessionId = auth.session.session.id as string;
  const userId = auth.session.user.id as string;

  const text = await readBoundedRequestText(req, CLIENT_DEBUG_MAX_BODY_BYTES);

  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const body = parsed && typeof parsed === "object" ? parsed as { events?: unknown } : {};
  if (!Array.isArray(body.events)) return json({ ok: false, error: "events must be an array" }, { status: 400 });
  if (body.events.length > CLIENT_DEBUG_MAX_EVENTS_PER_BATCH) {
    return json({ ok: false, error: `events length ${body.events.length} exceeds cap ${CLIENT_DEBUG_MAX_EVENTS_PER_BATCH}` }, { status: 413 });
  }

  // Sliding-window rate limit, session-keyed. Prune-and-check then push.
  const now = Date.now();
  const window = state.clientDebugRateWindow.get(sessionId) ?? [];
  const fresh = window.filter((ts) => now - ts < CLIENT_DEBUG_WINDOW_MS);
  if (fresh.length >= CLIENT_DEBUG_MAX_BATCHES_PER_WINDOW) {
    state.clientDebugRateWindow.set(sessionId, fresh);
    const oldest = fresh[0]!;
    const retryAfterSec = Math.max(1, Math.ceil((CLIENT_DEBUG_WINDOW_MS - (now - oldest)) / 1000));
    return json({ ok: false, error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(retryAfterSec) } });
  }
  fresh.push(now);
  state.clientDebugRateWindow.set(sessionId, fresh);

  const userAgent = req.headers.get("user-agent") || "";
  let accepted = 0;
  for (const evt of body.events) {
    if (!evt || typeof evt !== "object") continue;
    const e = evt as Record<string, unknown>;
    const category = typeof e.category === "string" ? e.category.slice(0, 64) : "";
    if (!category) continue;
    const payload = e.payload === undefined ? undefined : sanitizeClientDebugValue(e.payload);
    const clientTs = typeof e.ts === "number" && Number.isFinite(e.ts) ? e.ts : null;
    state.clientDebugLogger.info("xterm_client_event", {
      category,
      payload,
      clientTs,
      sessionId,
      userId,
      userAgent,
    });
    accepted += 1;
  }
  return json({ ok: true, accepted });
}

async function verifyAgainstDummyPassword(password: string): Promise<void> {
  dummyPasswordHashPromise ??= hashPassword("whatsagent dummy password");
  await verifyPassword(await dummyPasswordHashPromise, password).catch(() => false);
}

function publicAuthUser(user: { id: string; username: string; created_at: string; updated_at: string }): Record<string, string> {
  return { id: user.id, username: user.username, created_at: user.created_at, updated_at: user.updated_at };
}

function publicAuthSession(session: { id: string; expires_at: string; created_at: string; last_seen_at: string; user_agent?: string | null; force_pwd_reset?: number }): Record<string, unknown> {
  return { id: session.id, expires_at: session.expires_at, created_at: session.created_at, last_seen_at: session.last_seen_at, user_agent: session.user_agent ?? null, force_pwd_reset: session.force_pwd_reset === 1 };
}

// -----------------------------------------------------------------------------
// EP-DEC-RUN WA-006: address resolution requires `repo:role` displayId.
// The bare-name compat fallback is gone — once two repos can hold roles
// with the same bare name, "send to dev" cannot disambiguate. Callers
// that previously passed a bare name now get null and must surface
// "address must be `repo:role`" to the user.
// -----------------------------------------------------------------------------
function resolveRoleAddress(db: Database, address: string): AgentRow | null {
  if (!address || !address.includes(":")) return null;
  const role = getRoleByDisplayId(db, address);
  // EP-DEC-RUN WA-006 (advisor msg #24): adapt the resolved
  // RoleWithDisplayRow directly. The previous round-trip via
  // getRoleByName(role.name) re-introduced the cross-repo collision —
  // the same bare role.name lookup it was meant to avoid.
  return role ? adaptRoleWithDisplayToCompat(role) : null;
}

function resolveRoleAddressInRepo(db: Database, address: string, repoName: string): AgentRow | null {
  if (!address || !address.includes(":")) return null;
  const parsed = parseRoleAddress(address);
  if (parsed.repoName !== repoName) return null;
  const role = getRoleByDisplayId(db, address);
  return role ? adaptRoleWithDisplayToCompat(role) : null;
}

// -----------------------------------------------------------------------------
// EP-DEC-2: workspace_repos + workspace_scan_dirs endpoints (WA-064, WA-065)
// -----------------------------------------------------------------------------

interface ApiRepo {
  id: string;
  name: string;
  absolutePath: string;
  gitRoot: string | null;
  sourceScanId: string | null;
  missingAt: string | null;
  roleCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ApiScanDir {
  id: string;
  absolutePath: string;
  scanOnStartup: boolean;
  lastScanAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function repoToApi(ws: WorkspaceState, row: { id: string; name: string; absolute_path: string; git_root: string | null; source_scan_id: string | null; missing_at: string | null; created_at: string; updated_at: string }): ApiRepo {
  const roleCount = listAgentsByRepo(ws.db, row.id).length;
  return {
    id: row.id,
    name: row.name,
    absolutePath: row.absolute_path,
    gitRoot: row.git_root,
    sourceScanId: row.source_scan_id,
    missingAt: row.missing_at,
    roleCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function scanDirToApi(row: { id: string; absolute_path: string; scan_on_startup: number; last_scan_at: string | null; created_at: string; updated_at: string }): ApiScanDir {
  return {
    id: row.id,
    absolutePath: row.absolute_path,
    scanOnStartup: row.scan_on_startup === 1,
    lastScanAt: row.last_scan_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listReposEndpoint(_state: DaemonState, ws: WorkspaceState): Promise<Response> {
  return json({ ok: true, repos: daoListRepos(ws.db).map((row) => repoToApi(ws, row)) });
}

async function addRepoEndpoint(state: DaemonState, ws: WorkspaceState, input: unknown): Promise<Response> {
  const body = input && typeof input === "object" ? input as { absolutePath?: unknown; name?: unknown } : {};
  const absolutePath = typeof body.absolutePath === "string" ? body.absolutePath.trim() : "";
  if (!absolutePath) return json({ ok: false, error: "absolutePath is required" }, { status: 400 });
  // Manual add accepts any existing dir (no marker requirement, per spec).
  // Round-5 fix: require dir, not just any path — files were silently
  // accepted before.
  const { statSync } = await import("node:fs");
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(absolutePath);
  } catch {
    return json({ ok: false, error: `path does not exist: ${absolutePath}` }, { status: 400 });
  }
  if (!stat.isDirectory()) return json({ ok: false, error: `path is not a directory: ${absolutePath}` }, { status: 400 });
  if (daoGetRepoByPath(ws.db, absolutePath)) return json({ ok: false, error: "absolutePath is already registered" }, { status: 409 });
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined;
  if (name && daoGetRepoByName(ws.db, name)) return json({ ok: false, error: `repo name "${name}" already in use` }, { status: 409 });
  try {
    const repo = daoInsertRepo(ws.db, { absolutePath, name });
    state.logger.info("repo.created", { workspace: ws.id, repo: repo.id, name: repo.name, path: repo.absolute_path });
    return json({ ok: true, repo: repoToApi(ws, repo) });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

async function patchRepoEndpoint(state: DaemonState, ws: WorkspaceState, repoId: string, input: unknown): Promise<Response> {
  const repo = getRepoById(ws.db, repoId);
  if (!repo) return json({ ok: false, error: "repo not found" }, { status: 404 });
  const body = input && typeof input === "object" ? input as { name?: unknown } : {};
  if (typeof body.name !== "string") return json({ ok: false, error: "name is required" }, { status: 400 });
  // EP-DEC-RUN WA-003: a repo rename moves every child role's display_id
  // (`<repo.name>:<role.name>`), which moves every runner metadata FS path
  // and would orphan any live runner under the repo. Refuse with 409 if
  // any role under this repo has a live runner — same shape + reasoning
  // as the role-rename guard in patchRoleByIdEndpoint (advisor msg #2 + #8).
  if (body.name !== repo.name) {
    const rolesUnderRepo = listAgentsByRepo(ws.db, repoId);
    if (rolesUnderRepo.length > 0) {
      const runners = await discoverAndReconcileRunners(state, ws);
      // Match by display_id (advisor msg #14): once same-bare-name across
      // repos is allowed, `runner.role === r.name` would fire on a
      // `beta:main` runner while renaming `alpha`. display_id is unique.
      const liveDisplayIds = new Set(rolesUnderRepo.map((r) => r.display_id));
      const liveRunner = runners.find((r) => liveDisplayIds.has(r.display_id) && r.reachable);
      if (liveRunner) {
        return json({ ok: false, error: `repo "${repo.name}" has a live runner under role "${liveRunner.display_id || liveRunner.role}"; stop the runner before renaming (EP-DEC-RUN cascade)` }, { status: 409 });
      }
    }
  }
  try {
    const updated = daoRenameRepo(ws.db, repoId, body.name);
    state.logger.info("repo.renamed", { workspace: ws.id, repo: repoId, name: updated.name });
    return json({ ok: true, repo: repoToApi(ws, updated) });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

async function refreshRepoEndpoint(state: DaemonState, ws: WorkspaceState, repoId: string): Promise<Response> {
  const repo = daoRefreshRepoMeta(ws.db, repoId);
  if (!repo) return json({ ok: false, error: "repo not found" }, { status: 404 });
  state.logger.info("repo.refreshed", { workspace: ws.id, repo: repoId, missing: Boolean(repo.missing_at) });
  return json({ ok: true, repo: repoToApi(ws, repo) });
}

async function deleteRepoEndpoint(state: DaemonState, ws: WorkspaceState, repoId: string): Promise<Response> {
  const repo = getRepoById(ws.db, repoId);
  if (!repo) return json({ ok: false, error: "repo not found" }, { status: 404 });
  // Stop every runner attached to roles under this repo BEFORE the DB
  // delete cascades. If any runner refuses to stop, return 409 with the
  // sticky runner state so the caller can retry once the runner is gone.
  const roles = listAgentsByRepo(ws.db, repoId);
  // Match by display_id (advisor msg #14): a same-bare-name runner from a
  // different repo (e.g. `beta:main` while deleting `alpha`) must NOT be
  // stopped or have its metadata unlinked. Build the displayId index once.
  const rolesByDisplayId = new Map(roles.map((r) => [r.display_id, r] as const));
  if (rolesByDisplayId.size > 0) {
    const runners = await discoverAndReconcileRunners(state, ws);
    const stuck: Array<{ role: string; runnerPid: number; reason: string }> = [];
    for (const runner of runners) {
      const role = rolesByDisplayId.get(runner.display_id);
      if (!role) continue;
      try {
        // The compat shim returns AgentRow shape — close enough for stopRunner.
        const compatRoleRow = { id: role.id, name: role.name, path: repo.absolute_path, git_root: repo.git_root, host_default: role.host_default, missing_at: null, last_discovered_at: null, created_at: role.created_at, updated_at: role.updated_at };
        await stopRunner({ paths: ws.paths, role: compatRoleRow as AgentRow, runner, logger: state.logger, source: "repo-delete", path: `/repos/${repoId}` });
        state.ownedRunnerPids.delete(runner.runner_pid);
      } catch (e) {
        stuck.push({ role: runner.role, runnerPid: runner.runner_pid, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    if (stuck.length > 0) {
      return json({ ok: false, error: "one or more runners failed to stop", stuck }, { status: 409 });
    }
  }
  daoDeleteRepo(ws.db, repoId);
  state.logger.info("repo.deleted", { workspace: ws.id, repo: repoId, name: repo.name, cascadedRoles: roles.length });
  return json({ ok: true });
}

async function listScanDirsEndpoint(_state: DaemonState, ws: WorkspaceState): Promise<Response> {
  return json({ ok: true, scanDirs: daoListScanDirs(ws.db).map(scanDirToApi) });
}

async function addScanDirEndpoint(state: DaemonState, ws: WorkspaceState, input: unknown): Promise<Response> {
  const body = input && typeof input === "object" ? input as { absolutePath?: unknown; scanOnStartup?: unknown } : {};
  const absolutePath = typeof body.absolutePath === "string" ? body.absolutePath.trim() : "";
  if (!absolutePath) return json({ ok: false, error: "absolutePath is required" }, { status: 400 });
  const { statSync } = await import("node:fs");
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(absolutePath);
  } catch {
    return json({ ok: false, error: `path does not exist: ${absolutePath}` }, { status: 400 });
  }
  if (!stat.isDirectory()) return json({ ok: false, error: `path is not a directory: ${absolutePath}` }, { status: 400 });
  const scanOnStartup = body.scanOnStartup === true;
  try {
    const row = daoInsertScanDir(ws.db, { absolutePath, scanOnStartup });
    state.logger.info("scan_dir.created", { workspace: ws.id, scanDir: row.id, path: row.absolute_path });
    return json({ ok: true, scanDir: scanDirToApi(row) });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

async function patchScanDirEndpoint(state: DaemonState, ws: WorkspaceState, scanId: string, input: unknown): Promise<Response> {
  const scan = getScanDirById(ws.db, scanId);
  if (!scan) return json({ ok: false, error: "scan dir not found" }, { status: 404 });
  const body = input && typeof input === "object" ? input as { scanOnStartup?: unknown } : {};
  if (typeof body.scanOnStartup !== "boolean") return json({ ok: false, error: "scanOnStartup boolean required" }, { status: 400 });
  const updated = daoSetScanDirStartup(ws.db, scanId, body.scanOnStartup);
  state.logger.info("scan_dir.patched", { workspace: ws.id, scanDir: scanId, scanOnStartup: body.scanOnStartup });
  return json({ ok: true, scanDir: scanDirToApi(updated) });
}

async function deleteScanDirEndpoint(state: DaemonState, ws: WorkspaceState, scanId: string): Promise<Response> {
  const scan = getScanDirById(ws.db, scanId);
  if (!scan) return json({ ok: false, error: "scan dir not found" }, { status: 404 });
  daoDeleteScanDir(ws.db, scanId);
  state.logger.info("scan_dir.deleted", { workspace: ws.id, scanDir: scanId });
  return json({ ok: true });
}

async function runScanDirEndpoint(state: DaemonState, ws: WorkspaceState, scanId: string): Promise<Response> {
  const scan = getScanDirById(ws.db, scanId);
  if (!scan) return json({ ok: false, error: "scan dir not found" }, { status: 404 });
  try {
    const result = daoRunScanDir(ws.db, scanId);
    state.logger.info("scan_dir.scanned", { workspace: ws.id, scanDir: scanId, added: result.added.length, skipped: result.skipped.length });
    return json({
      ok: true,
      added: result.added.map((row) => repoToApi(ws, row)),
      skipped: result.skipped,
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

// -----------------------------------------------------------------------------
// EP-DEC-2: role CRUD by UUID under /api/v1/workspaces/:id/roles-by-id (WA-066)
// -----------------------------------------------------------------------------
//
// Lives alongside the legacy `/roles[/:name]` route family during the
// EP-DEC-2 → EP-DEC-5 cutover; the legacy POST/PATCH/DELETE handlers
// still return 410 to fail loud, while launch/stop/output/etc. continue
// to address by name via the `AgentRow` compat shim from EP-DEC-1.
// Once the web UI flips onto `:roleId` the legacy routes will be dropped.

interface ApiRole {
  id: string;
  name: string;
  repoId: string;
  repoName: string;
  displayId: string;
  hostDefault: HostType | null;
  defaultHostType: HostType | null;
  createdAt: string;
  updatedAt: string;
}

function roleToApi(role: RoleWithDisplayRow): ApiRole {
  return {
    id: role.id,
    name: role.name,
    repoId: role.repo_id,
    repoName: role.repo_name,
    displayId: role.display_id,
    hostDefault: role.host_default,
    defaultHostType: role.default_host_type,
    createdAt: role.created_at,
    updatedAt: role.updated_at,
  };
}

async function listRolesByIdEndpoint(_state: DaemonState, ws: WorkspaceState): Promise<Response> {
  return json({ ok: true, roles: listAgentsByWorkspace(ws.db).map(roleToApi) });
}

async function addRoleByIdEndpoint(state: DaemonState, ws: WorkspaceState, input: unknown): Promise<Response> {
  const body = input && typeof input === "object" ? input as { repoId?: unknown; name?: unknown; host?: unknown } : {};
  const repoId = typeof body.repoId === "string" && body.repoId.trim() ? body.repoId.trim() : "";
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "";
  if (!repoId) return json({ ok: false, error: "repoId is required" }, { status: 400 });
  if (!name) return json({ ok: false, error: "name is required" }, { status: 400 });
  if (name.includes(":")) return json({ ok: false, error: "name cannot contain ':'" }, { status: 400 });
  if (!getRepoById(ws.db, repoId)) return json({ ok: false, error: "repo not found" }, { status: 404 });
  // Round-6 fix: sanitize BEFORE the workspace-wide uniqueness check.
  // The DAO `insertRole` sanitizes too, so a raw `dev!` would slip past
  // the duplicate check then collide as `dev` post-sanitization.
  const canonicalName = sanitizeRoleName(name);
  if (!canonicalName) return json({ ok: false, error: "name resolved to empty after sanitisation" }, { status: 400 });
  // EP-DEC-RUN WA-006: workspace-wide name guard removed. Schema
  // `UNIQUE(repo_id, name)` is now the only constraint, so two repos
  // can each host a `main` role. Runner metadata + per-role action
  // URLs key on `display_id` everywhere (WA-002..005), so the cross-
  // repo collision the guard prevented no longer exists.
  let host: HostType | null = null;
  if (body.host !== undefined && body.host !== null && body.host !== "default") {
    try { host = normalizeHostType(typeof body.host === "string" ? body.host : undefined); }
    catch { return json({ ok: false, error: "invalid host" }, { status: 400 }); }
  }
  try {
    const role = daoInsertRole(ws.db, { repoId, name: canonicalName, host });
    state.logger.info("role.created", { workspace: ws.id, role: role.id, displayId: role.display_id });
    return json({ ok: true, role: roleToApi(role) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: msg }, { status: msg.includes("already exists") ? 409 : 400 });
  }
}

async function patchRoleByIdEndpoint(state: DaemonState, ws: WorkspaceState, roleId: string, input: unknown): Promise<Response> {
  const role = daoGetRoleById(ws.db, roleId);
  if (!role) return json({ ok: false, error: "role not found" }, { status: 404 });
  const body = input && typeof input === "object" ? input as { name?: unknown; host?: unknown } : {};
  let next = role;
  try {
    if (typeof body.name === "string") {
      const rawName = body.name.trim();
      if (rawName.includes(":")) return json({ ok: false, error: "name cannot contain ':'" }, { status: 400 });
      // Round-6 fix: sanitize before the workspace-wide uniqueness
      // check; otherwise a raw `dev!` slips past then collides as `dev`
      // post-sanitization in the DAO.
      const canonicalName = sanitizeRoleName(rawName);
      if (!canonicalName) return json({ ok: false, error: "name resolved to empty after sanitisation" }, { status: 400 });
      // EP-DEC-RUN WA-006: workspace-wide name guard removed. Per-repo
      // UNIQUE(repo_id, name) still applies via the DAO; cross-repo
      // duplicates are now allowed because runner addressing keys on
      // display_id everywhere.
      // EP-DEC-RUN WA-002: a rename moves displayId → moves the runner
      // metadata FS path, which would orphan a live runner writing to the
      // old path. Refuse with 409 (advisor msg #2 + #8: cascade-stop in
      // endpoint, not DAO; preferred semantics is reject not auto-stop
      // because rename is a metadata op, not a destructive one).
      // Filter on `reachable` (advisor msg #10) so stale metadata that
      // discoverAndReconcileRunners has already marked dead does not
      // block a rename. Mirrors the live-only `&& item.reachable` check
      // used at the launch / push-nudge call sites in this file.
      if (canonicalName !== role.name) {
        const runners = await discoverAndReconcileRunners(state, ws);
        // Match by display_id (advisor msg #14): once two repos can each
        // have a `main` role, matching by bare name would reject this
        // role's rename whenever ANY same-bare-name runner is live.
        if (runners.some((r) => r.display_id === role.display_id && r.reachable)) {
          return json({ ok: false, error: `role "${role.display_id || role.name}" has a live runner; stop the runner before renaming (EP-DEC-RUN cascade)` }, { status: 409 });
        }
      }
      next = daoRenameRoleById(ws.db, roleId, canonicalName);
    }
    if (body.host !== undefined) {
      const ts = new Date().toISOString();
      const host = body.host === null || body.host === "default"
        ? null
        : normalizeHostType(typeof body.host === "string" ? body.host : undefined);
      ws.db.run("UPDATE agents SET host_default = ?, default_host_type = ?, updated_at = ? WHERE id = ?",
        [host ?? "claude-code", host, ts, roleId]);
      next = daoGetRoleById(ws.db, roleId)!;
    }
    state.logger.info("role.patched", { workspace: ws.id, role: roleId, displayId: next.display_id });
    return json({ ok: true, role: roleToApi(next) });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

async function deleteRoleByIdEndpoint(state: DaemonState, ws: WorkspaceState, roleId: string): Promise<Response> {
  const role = daoGetRoleById(ws.db, roleId);
  if (!role) return json({ ok: false, error: "role not found" }, { status: 404 });
  // Cascade runner stop: find the runner attached to this role, stop it,
  // then drop the row. Mirror the repo-delete semantics. Match by
  // display_id (advisor msg #14): a same-bare-name runner from another
  // repo must NOT be stopped here.
  const runners = await discoverAndReconcileRunners(state, ws);
  const runner = runners.find((r) => r.display_id === role.display_id);
  if (runner) {
    const compatRoleRow = {
      id: role.id, name: role.name, path: "", git_root: null,
      host_default: role.host_default, missing_at: null,
      last_discovered_at: null, created_at: role.created_at, updated_at: role.updated_at,
    } as AgentRow;
    try {
      await stopRunner({ paths: ws.paths, role: compatRoleRow, runner, logger: state.logger, source: "role-delete", path: `/roles-by-id/${roleId}` });
      state.ownedRunnerPids.delete(runner.runner_pid);
    } catch (e) {
      return json({ ok: false, error: "runner failed to stop", reason: e instanceof Error ? e.message : String(e) }, { status: 409 });
    }
  }
  daoDeleteRoleById(ws.db, roleId);
  state.logger.info("role.deleted", { workspace: ws.id, role: roleId, displayId: role.display_id });
  return json({ ok: true });
}

// =============================================================================
// RBAC Phase 2a — RBAC role + grant CRUD endpoints
// =============================================================================
// New routes under /api/v1/workspaces/:id/rbac/roles, kept under a dedicated
// /rbac/ prefix so they never collide with the deprecated /api/v1/roles agent
// alias from Phase 1. No enforcement yet (Phase 4); these endpoints are
// admin-UI fed via cookie-auth'd web origin only.

async function listRbacRolesEndpoint(_state: DaemonState, ws: WorkspaceState): Promise<Response> {
  const { listRbacRoles } = await import("../rbac-dao.ts");
  return json({ ok: true, roles: listRbacRoles(ws.db) });
}

async function createRbacRoleEndpoint(state: DaemonState, ws: WorkspaceState, input: unknown): Promise<Response> {
  const body = input && typeof input === "object" ? input as { name?: unknown; description?: unknown } : {};
  const name = typeof body.name === "string" ? body.name : "";
  const description = typeof body.description === "string" ? body.description : "";
  try {
    const { createRbacRole } = await import("../rbac-dao.ts");
    const role = createRbacRole(ws.db, { name, description });
    state.logger.info("rbac_role.created", { workspace: ws.id, role: role.id, name: role.name });
    return json({ ok: true, role });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: msg }, { status: msg.includes("already exists") ? 409 : 400 });
  }
}

async function patchRbacRoleEndpoint(state: DaemonState, ws: WorkspaceState, roleId: string, input: unknown): Promise<Response> {
  const body = input && typeof input === "object" ? input as { name?: unknown; description?: unknown } : {};
  try {
    const { getRbacRoleById, updateRbacRole } = await import("../rbac-dao.ts");
    const existing = getRbacRoleById(ws.db, roleId);
    if (!existing) return json({ ok: false, error: "role not found" }, { status: 404 });
    const patch: { name?: string; description?: string } = {};
    if (typeof body.name === "string") patch.name = body.name;
    if (typeof body.description === "string") patch.description = body.description;
    const updated = updateRbacRole(ws.db, roleId, patch);
    state.logger.info("rbac_role.patched", { workspace: ws.id, role: roleId, name: updated.name });
    return json({ ok: true, role: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    let status = 400;
    if (msg.includes("built-in")) status = 409;
    else if (msg.includes("already exists")) status = 409;
    else if (msg.includes("not found")) status = 404;
    return json({ ok: false, error: msg }, { status });
  }
}

async function deleteRbacRoleEndpoint(state: DaemonState, ws: WorkspaceState, roleId: string): Promise<Response> {
  try {
    const { getRbacRoleById, deleteRbacRole } = await import("../rbac-dao.ts");
    const existing = getRbacRoleById(ws.db, roleId);
    if (!existing) return json({ ok: false, error: "role not found" }, { status: 404 });
    if (existing.is_builtin === 1) {
      return json({ ok: false, error: "cannot delete a built-in role" }, { status: 409 });
    }
    deleteRbacRole(ws.db, roleId);
    state.logger.info("rbac_role.deleted", { workspace: ws.id, role: roleId, name: existing.name });
    return json({ ok: true });
  } catch (e) {
    // FK RESTRICT surfaces here when an agent_roles row still references this role.
    const msg = e instanceof Error ? e.message : String(e);
    let status = 400;
    if (msg.includes("FOREIGN KEY") || msg.includes("constraint failed")) status = 409;
    return json({ ok: false, error: msg }, { status });
  }
}

async function replaceRbacRoleGrantsEndpoint(state: DaemonState, ws: WorkspaceState, roleId: string, input: unknown): Promise<Response> {
  const body = input && typeof input === "object" ? input as { grants?: unknown } : {};
  if (!Array.isArray(body.grants)) {
    return json({ ok: false, error: "grants array is required" }, { status: 400 });
  }
  // Validate each grant input shape; reject anything else with 400 to avoid
  // silently dropping malformed entries.
  const grants: Array<{ grant_kind: string; grant_value: string; scope_qualifier?: string | null }> = [];
  for (const g of body.grants) {
    if (!g || typeof g !== "object") {
      return json({ ok: false, error: "each grant must be an object" }, { status: 400 });
    }
    const gg = g as { grant_kind?: unknown; grant_value?: unknown; scope_qualifier?: unknown };
    if (typeof gg.grant_kind !== "string" || !gg.grant_kind) {
      return json({ ok: false, error: "grant_kind is required" }, { status: 400 });
    }
    if (typeof gg.grant_value !== "string" || !gg.grant_value) {
      return json({ ok: false, error: "grant_value is required" }, { status: 400 });
    }
    let scope: string | null = null;
    if (gg.scope_qualifier !== undefined && gg.scope_qualifier !== null) {
      if (typeof gg.scope_qualifier !== "string") {
        return json({ ok: false, error: "scope_qualifier must be a string or null" }, { status: 400 });
      }
      scope = gg.scope_qualifier;
    }
    grants.push({ grant_kind: gg.grant_kind, grant_value: gg.grant_value, scope_qualifier: scope });
  }
  try {
    const { getRbacRoleById, replaceRoleGrants } = await import("../rbac-dao.ts");
    const existing = getRbacRoleById(ws.db, roleId);
    if (!existing) return json({ ok: false, error: "role not found" }, { status: 404 });
    const updated = replaceRoleGrants(ws.db, roleId, grants);
    state.logger.info("rbac_role.grants_replaced", { workspace: ws.id, role: roleId, count: updated.grants.length });
    return json({ ok: true, role: updated });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

// Audit log read endpoint for the Settings → Roles → Audit subtab
// (Phase 3 slice 6). Slice 4 emits `grant_miss_soft` rows; this
// endpoint serves the paginated read path. Phase 4 (WA-090) returns
// `permissions.audit_read` / `permissions.audit_admin` so the UI can
// render or hide audit-admin affordances (CSV export). The cookie-
// authed admin context maps to the workspace's main agent for grant
// resolution; if no main is set the page is treated as no-audit-admin.

interface AuditPermissions {
  audit_read: boolean;
  audit_admin: boolean;
}

function resolveAuditPermissions(ws: WorkspaceState): AuditPermissions {
  const main = getMainAgent(ws.db);
  if (!main) return { audit_read: false, audit_admin: false };
  const grants = getEffectiveGrants(ws.db, main.id);
  return {
    audit_read: grants.audit_grants.includes("audit_read"),
    audit_admin: grants.audit_grants.includes("audit_admin"),
  };
}

async function listAuditEndpoint(_state: DaemonState, ws: WorkspaceState, url: URL): Promise<Response> {
  const { listAudit, countAudit, listAuditActors } = await import("../audit-log-dao.ts");
  const params = url.searchParams;

  // Filters
  const kindParam = params.getAll("kind");
  const filter: { kind?: string[]; actor_agent_id?: string; since?: string; limit?: number; offset?: number } = {};
  if (kindParam.length > 0) filter.kind = kindParam;
  const actor = params.get("actor_agent_id");
  if (actor) filter.actor_agent_id = actor;
  const since = params.get("since");
  if (since) filter.since = since;
  const limitRaw = params.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 50;
  if (Number.isFinite(limit)) filter.limit = limit;
  const offsetRaw = params.get("offset");
  const offset = offsetRaw ? Number(offsetRaw) : 0;
  if (Number.isFinite(offset)) filter.offset = offset;

  const entries = listAudit(ws.db, filter);
  // Always return a "totals" object computed for the same filter
  // minus pagination, so the UI summary cards + pagination footer
  // can render without a second round-trip.
  const totalForFilter = countAudit(ws.db, { kind: filter.kind, actor_agent_id: filter.actor_agent_id, since: filter.since });
  // Phase 4 (WA-091): violations now count `grant_miss_hard` (deny rows).
  // Pre-Phase-4 `grant_miss_soft` rows persist for retro investigation but
  // are not the live violation signal under hard enforcement. Audit chrome
  // surfaces both kinds via the kind-filter pills.
  const violations24h = countAudit(ws.db, { kind: ["grant_miss_hard", "grant_miss_soft"], since: hoursAgoIso(24) });
  const violations7d = countAudit(ws.db, { kind: ["grant_miss_hard", "grant_miss_soft"], since: hoursAgoIso(24 * 7) });
  const passes24h = countAudit(ws.db, { kind: "grant_check_pass", since: hoursAgoIso(24) });
  // Phase 4 (WA-091): both legacy soft + new hard miss rows count toward
  // "agents with misses" so the chrome pill stays accurate during the
  // mixed window where both kinds may appear.
  const actorsWithMisses24h = listAuditActors(ws.db, { kind: ["grant_miss_hard", "grant_miss_soft"], since: hoursAgoIso(24) }).length;

  return json({
    ok: true,
    entries,
    pagination: { total: totalForFilter, limit: filter.limit ?? 50, offset: filter.offset ?? 0 },
    summary: { violations24h, violations7d, passes24h, actorsWithMisses24h },
    permissions: resolveAuditPermissions(ws),
  });
}

/**
 * Phase 4 (WA-090): CSV export of audit_log rows. Gated on
 * `audit_grant:audit_admin` resolved from the workspace's main agent
 * (cookie-auth admin stand-in). Filters mirror the read endpoint so
 * the exported file matches what the operator sees in the table.
 *
 * Out of scope for this slice: retention controls, scheduled exports,
 * external sinks. Alpha-stage decision per spec L335.
 */
async function exportAuditEndpoint(_state: DaemonState, ws: WorkspaceState, url: URL): Promise<Response> {
  const perms = resolveAuditPermissions(ws);
  if (!perms.audit_admin) {
    return json({ ok: false, error: "audit_admin grant required" }, { status: 403 });
  }
  const { listAudit } = await import("../audit-log-dao.ts");
  const params = url.searchParams;
  const kindParam = params.getAll("kind");
  // Bulk export raises the listAudit clamp ceiling so the response is
  // not silently truncated to the read endpoint's 500-row cap (advisor
  // msg 391). The cap is intentional + capped at the same value the
  // request asks for.
  const EXPORT_MAX = 10_000;
  const filter: { kind?: string[]; actor_agent_id?: string; since?: string; limit?: number; offset?: number; maxLimit?: number } = { maxLimit: EXPORT_MAX };
  if (kindParam.length > 0) filter.kind = kindParam;
  const actor = params.get("actor_agent_id");
  if (actor) filter.actor_agent_id = actor;
  const since = params.get("since");
  if (since) filter.since = since;
  const limitRaw = params.get("limit");
  const limit = limitRaw ? Number(limitRaw) : EXPORT_MAX;
  if (Number.isFinite(limit)) filter.limit = limit;
  const offsetRaw = params.get("offset");
  const offset = offsetRaw ? Number(offsetRaw) : 0;
  if (Number.isFinite(offset)) filter.offset = offset;

  const rows = listAudit(ws.db, filter);
  const headers = ["id", "ts", "kind", "actor_agent_id", "actor_display_id", "target_kind", "target_id", "payload_json"];
  const escapeCell = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : String(v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    const cells = [
      row.id,
      row.ts,
      row.kind,
      row.actor_agent_id ?? "",
      (row as { actor_display_id?: string | null }).actor_display_id ?? "",
      row.target_kind ?? "",
      row.target_id ?? "",
      JSON.stringify(row.payload),
    ].map(escapeCell);
    lines.push(cells.join(","));
  }
  const body = lines.join("\r\n");
  const filename = `audit-export-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  return new Response(body, {
    headers: securityHeaders({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    }),
  });
}

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

// Agent role-assignment endpoints under /api/v1/workspaces/:id/agents/:agentId/roles.
// Phase 3 slice 2: read + replace the agent's full role-assignment set.

function agentExists(ws: WorkspaceState, agentId: string): boolean {
  return Boolean(ws.db.query<{ id: string }, [string]>(
    "SELECT id FROM agents WHERE id = ?",
  ).get(agentId));
}

async function listAgentRolesEndpoint(_state: DaemonState, ws: WorkspaceState, agentId: string): Promise<Response> {
  if (!agentExists(ws, agentId)) {
    return json({ ok: false, error: "agent not found" }, { status: 404 });
  }
  return json({ ok: true, agentId, roles: getAgentRoles(ws.db, agentId) });
}

async function replaceAgentRolesEndpoint(state: DaemonState, ws: WorkspaceState, agentId: string, input: unknown): Promise<Response> {
  if (!agentExists(ws, agentId)) {
    return json({ ok: false, error: "agent not found" }, { status: 404 });
  }
  const body = input && typeof input === "object" ? input as { role_ids?: unknown } : {};
  if (!Array.isArray(body.role_ids)) {
    return json({ ok: false, error: "role_ids array is required" }, { status: 400 });
  }
  const roleIds: string[] = [];
  for (const rid of body.role_ids) {
    if (typeof rid !== "string" || !rid) {
      return json({ ok: false, error: "each role_id must be a non-empty string" }, { status: 400 });
    }
    roleIds.push(rid);
  }
  try {
    const { setAgentRoles } = await import("../rbac-dao.ts");
    const assigned = setAgentRoles(ws.db, agentId, roleIds);
    state.logger.info("agent_roles.replaced", { workspace: ws.id, agent: agentId, count: assigned.length });
    return json({ ok: true, agentId, roles: assigned });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    let status = 400;
    if (msg.startsWith("unknown role ids:")) status = 400;
    return json({ ok: false, error: msg }, { status });
  }
}

// Workspace-decoupling: legacy role-by-name CRUD replaced by repo+role
// endpoints in EP-DEC-2 (WA-064/WA-066). Until those land, return 410
// with a pointer so callers fail loudly instead of silently misrouting.
const LEGACY_ROLE_API_REMOVED = "legacy role-by-name endpoints removed; use /workspaces/:id/repos and /workspaces/:id/roles (repoId+name) once WA-066 lands";

async function createWorkspaceRoleEndpoint(_state: DaemonState, _ws: WorkspaceState, _input: unknown): Promise<Response> {
  return json({ ok: false, error: LEGACY_ROLE_API_REMOVED }, { status: 410 });
}

async function patchWorkspaceRoleEndpoint(_state: DaemonState, _ws: WorkspaceState, _name: string, _input: unknown): Promise<Response> {
  return json({ ok: false, error: LEGACY_ROLE_API_REMOVED }, { status: 410 });
}

async function deleteWorkspaceRoleEndpoint(_state: DaemonState, _ws: WorkspaceState, _name: string): Promise<Response> {
  return json({ ok: false, error: LEGACY_ROLE_API_REMOVED }, { status: 410 });
}

async function setMainRoleByName(state: DaemonState, ws: WorkspaceState, roleName: string): Promise<AgentRow> {
  const db = ws.db;
  const { setMainRole } = await import("../db.ts");
  const role = setMainRole(db, roleName);
  state.logger.info("main_role.set", { role: role.name });
  return role;
}

async function setRoleDefaultRuntimeByName(state: DaemonState, ws: WorkspaceState, roleName: string, host: unknown): Promise<AgentRow> {
  const db = ws.db;
  const role = setRoleDefaultHost(db, roleName, host);
  state.logger.info("role.default_runtime.set", { role: role.name, host: role.host_default || "global" });
  return role;
}

/**
 * EP-DEC-RUN WA-004 (advisor msg #18): id-keyed default-runtime setter
 * for the new `/roles-by-id/:id/default-runtime` route. Bare-name keying
 * via `setRoleDefaultRuntimeByName` would update the wrong row once
 * WA-006 permits duplicate role names across repos. Returns the
 * AgentRow-shaped row resolved via the dao after the UPDATE so the
 * response shape matches the bare-name endpoint.
 */
async function setRoleDefaultRuntimeById(state: DaemonState, ws: WorkspaceState, roleId: string, host: unknown): Promise<AgentRow> {
  setRoleDefaultHostByIdRaw(ws.db, roleId, host);
  const refreshed = daoGetRoleById(ws.db, roleId);
  if (!refreshed) throw new Error(`Unknown role id: ${roleId}`);
  const adapted = adaptRoleWithDisplayToCompat(refreshed);
  state.logger.info("role.default_runtime.set", { role: adapted.name, displayId: adapted.display_id, host: adapted.host_default || "global" });
  return adapted;
}

async function roleByName(state: DaemonState, ws: WorkspaceState, roleName: string): Promise<AgentRow | null> {
  const db = ws.db;
  return getRoleByName(db, roleName);
}

function runnerControlUrl(runner: RunnerStatus): string | null {
  const value = (runner as RunnerStatus & { control_url?: unknown }).control_url;
  return typeof value === "string" ? value : null;
}

function runnerControlSecret(runner: RunnerStatus): string | null {
  const value = (runner as RunnerStatus & { control_secret?: unknown }).control_secret;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function runnerControlHeaders(controlSecret: string | null | undefined, headers?: HeadersInit): Headers {
  const next = new Headers(headers);
  if (controlSecret) next.set("Authorization", `Bearer ${controlSecret}`);
  return next;
}

async function markRunnerStalePulseEndpoint(state: DaemonState, runner: RunnerStatus, reason: string): Promise<void> {
  const message = "runner needs respawn for EP-034 (stale binary, missing /redraw-pulse)";
  const baseFields = { role: runner.role, displayId: runner.display_id, sessionId: runner.session_id, runnerPid: runner.runner_pid, reason, status: 404 };
  const fields = { ...baseFields, message };
  if (runner.stale_pulse_endpoint) {
    state.logger.debug("runner.tui_redraw_pulse_stale_suppressed", baseFields);
    return;
  }
  runner.stale_pulse_endpoint = true;
  try {
    const raw = await readFile(runner.metadata_path, "utf8");
    const metadata = JSON.parse(raw) as RunnerMetadata;
    if (metadata.session_id === runner.session_id && metadata.runner_pid === runner.runner_pid) {
      metadata.stale_pulse_endpoint = true;
      await writeFile(runner.metadata_path, JSON.stringify(metadata, null, 2), { encoding: "utf8", mode: 0o600 });
    }
  } catch (error) {
    state.logger.debug("runner.tui_redraw_pulse_stale_metadata_write_failed", { ...fields, error: error instanceof Error ? error.message : String(error) });
  }
  state.logger.warn("runner.tui_redraw_pulse_failed", fields);
}

function publicRunnerStatus(runner: RunnerStatus): PublicRunnerStatus {
  const { control_secret: _controlSecret, ...safeRunner } = runner;
  return safeRunner;
}

const RUNNER_CONTROL_TIMEOUT_MS = 10_000;

async function fetchRunnerControlUrl(controlUrl: string, controlSecret: string | null | undefined, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(new URL(path, controlUrl), {
    ...init,
    headers: runnerControlHeaders(controlSecret, init.headers),
    signal: init.signal ?? AbortSignal.timeout(RUNNER_CONTROL_TIMEOUT_MS),
  });
}

async function fetchRunnerControl(runner: RunnerStatus, path: string, init: RequestInit = {}): Promise<Response> {
  const controlUrl = runnerControlUrl(runner);
  if (!controlUrl) throw new Error("runner control endpoint is not ready");
  return fetchRunnerControlUrl(controlUrl, runnerControlSecret(runner), path, init);
}

export function isPulseEligibleRunner(runner: RunnerStatus): boolean {
  return runner.mode === "pty" && (runner.host_type === "claude-code" || runner.host_type === "codex");
}

function normalizePulseReason(value: unknown): "restore" | "burst" {
  return value === "restore" || value === "burst" ? value : "burst";
}

async function runnerForRole(state: DaemonState, ws: WorkspaceState, roleName: string): Promise<{ role: AgentRow; runner: RunnerStatus } | Response> {
  const role = await roleByName(state, ws, roleName);
  if (!role) return json({ error: `Unknown role: ${roleName}` }, { status: 404 });
  const runner = (await discoverAndReconcileRunners(state, ws)).find((item) => item.role === role.name && item.reachable);
  if (!runner) return json({ error: `${role.name} is offline` }, { status: 409 });
  if (!runnerControlUrl(runner)) return json({ error: `${role.name} runner control endpoint is not ready` }, { status: 409 });
  return { role, runner };
}

/**
 * EP-DEC-RUN WA-004: resolve a `:idOrDisplay` segment to a role row.
 * Order (advisor msg #16): UUID first, then `decodeURIComponent`-ed
 * displayId. No bare-name fallback. Malformed url-encoded segment → 400;
 * a string that is neither a known UUID nor a `repo:role` displayId
 * resolves to 404.
 */
function adaptRoleWithDisplayToCompat(row: { id: string; name: string; host_default: HostType | null; created_at: string; updated_at: string; repo_absolute_path: string; repo_git_root: string | null; repo_missing_at: string | null; repo_id: string; repo_name: string; display_id: string }): AgentRow {
  // RoleWithDisplayRow → AgentRow shape mirrors the existing compat shim
  // pattern at deleteRoleByIdEndpoint / deleteRepoEndpoint cascade. The
  // launch / stop / proxy paths only read id, name, path, git_root,
  // host_default, missing_at, display_id.
  return {
    id: row.id,
    name: row.name,
    path: row.repo_absolute_path,
    git_root: row.repo_git_root,
    host_default: row.host_default,
    missing_at: row.repo_missing_at,
    last_discovered_at: null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    repo_id: row.repo_id,
    repo_name: row.repo_name,
    display_id: row.display_id,
  };
}

function resolveRoleByIdOrDisplay(ws: WorkspaceState, raw: string): { role: AgentRow; decoded: string } | { error: Response } {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return { error: json({ ok: false, error: "malformed url-encoded role address" }, { status: 400 }) };
  }
  if (!decoded) {
    return { error: json({ ok: false, error: "role address is required" }, { status: 400 }) };
  }
  // UUID-shaped lookup first; daoGetRoleById returns null for any string
  // that does not match an `id` row, including non-UUID inputs.
  const byId = daoGetRoleById(ws.db, decoded);
  if (byId) return { role: adaptRoleWithDisplayToCompat(byId), decoded };
  // displayId form must contain `:`. Anything else is not addressable.
  if (!decoded.includes(":")) {
    return { error: json({ ok: false, error: `role not found: ${decoded}` }, { status: 404 }) };
  }
  const byDisplay = getRoleByDisplayId(ws.db, decoded);
  if (!byDisplay) {
    return { error: json({ ok: false, error: `role not found: ${decoded}` }, { status: 404 }) };
  }
  return { role: adaptRoleWithDisplayToCompat(byDisplay), decoded };
}

async function runnerForRoleByIdOrDisplay(state: DaemonState, ws: WorkspaceState, raw: string): Promise<{ role: AgentRow; runner: RunnerStatus } | Response> {
  const resolved = resolveRoleByIdOrDisplay(ws, raw);
  if ("error" in resolved) return resolved.error;
  const { role } = resolved;
  // Match by display_id (advisor msg #14) — bare role.name matching would
  // collide once two repos can each host a `main` agent.
  const runner = (await discoverAndReconcileRunners(state, ws)).find((item) => item.display_id === role.display_id && item.reachable);
  if (!runner) return json({ ok: false, error: `${role.display_id || role.name} is offline` }, { status: 409 });
  if (!runnerControlUrl(runner)) return json({ ok: false, error: `${role.display_id || role.name} runner control endpoint is not ready` }, { status: 409 });
  return { role, runner };
}

// EP-DEC-RUN WA-004 / WA-005: legacy `/roles/:name/<action>` routes log
// once per (route, name) on first hit so the access pattern is observable
// before WA-006 returns 410. Process-lifetime Set; cleared on daemon
// restart. Not load-bearing — purely diagnostic.
const legacyRouteAccessLogged = new Set<string>();
function logLegacyRoleRouteAccess(state: DaemonState, action: string, roleName: string): void {
  const key = `${action}:${roleName}`;
  if (legacyRouteAccessLogged.has(key)) return;
  legacyRouteAccessLogged.add(key);
  state.logger.info("legacy_role_route.access", {
    note: "Use /roles-by-id/:idOrDisplay/<action> instead. Returns 410 in WA-006.",
    action,
    role: roleName,
  });
}

/**
 * EP-DEC-RUN WA-004 launch helper. Shared by the legacy
 * `/roles/:name/launch` route + the new `/roles-by-id/:id/launch`
 * route. Owner-match for "is one already running" uses display_id
 * (advisor msg #14).
 */
async function executeRoleLaunch(
  state: DaemonState,
  ws: WorkspaceState,
  role: AgentRow,
  body: { host?: string; commandOverride?: unknown },
  daemonUrl: string,
): Promise<Response> {
  if (body.commandOverride !== undefined) {
    state.logger.warn("commandOverride.removed", { role: role.name });
    return json({ ok: false, error: "commandOverride is no longer supported; configure runtime command/args in Settings instead" }, { status: 400 });
  }
  if (role.missing_at) return json({ error: `${role.name} folder is missing`, role }, { status: 409 });
  const runners = await discoverAndReconcileRunners(state, ws);
  const existing = runners.find((runner) => runner.display_id === role.display_id && runner.reachable);
  if (existing) {
    state.logger.info("runner.attach_existing", { role: role.name, displayId: role.display_id, sessionId: existing.session_id, runnerPid: existing.runner_pid });
    return json({ ok: true, action: "attach", message: `Attached existing ${role.name} session.`, runner: publicRunnerStatus(existing) });
  }
  const runtime = await runtimeSettingsForState(state);
  const host = body.host && body.host !== "default" ? body.host : (role.host_default || runtime.globalDefaultHost);
  if (!host) return json({ ok: false, error: `${role.name} has no default runtime`, role, runtime }, { status: 409 });
  state.logger.info("runner.launch_requested", { role: role.name, displayId: role.display_id, host });
  const runner = await launchRunner({ root: ws.paths.slot, paths: ws.paths, config: { ...state.config, commands: runtime.commands }, logger: state.logger, role, daemonUrl, host, workspaceId: ws.id, colleagueProtocol: getAgentTextSettings(state.daemonDb).colleagueProtocol, tuiRedraw: getTuiRedrawSettings(state.daemonDb) });
  if (runner.runner_pid > 0) state.ownedRunnerPids.add(runner.runner_pid);
  return json({
    ok: true,
    action: "launch",
    role: role.name,
    displayId: role.display_id,
    host: runner.host_type,
    message: runner.mode === "pty"
      ? `Launched ${role.name} with a PTY runner. This session is attachable and daemon-restart safe.`
      : `Launched ${role.name} with the placeholder runner because the configured host command was unavailable.`,
    runner: publicRunnerStatus(runner),
  });
}

/**
 * EP-DEC-RUN WA-004 stop helper. Owner-match by display_id (advisor msg #14).
 */
async function executeRoleStop(
  state: DaemonState,
  ws: WorkspaceState,
  role: AgentRow,
  sourcePath: string,
): Promise<Response> {
  const runner = (await discoverAndReconcileRunners(state, ws)).find((item) => item.display_id === role.display_id);
  if (!runner) return json({ ok: true, action: "noop", message: `${role.name} has no runner metadata.` });
  if (!state.ownedRunnerPids.has(runner.runner_pid)) {
    state.logger.warn("runner.stop_unowned_pid", { role: role.name, displayId: role.display_id, sessionId: runner.session_id, runnerPid: runner.runner_pid, ownedCount: state.ownedRunnerPids.size });
  }
  state.ownedRunnerPids.delete(runner.runner_pid);
  await stopRunner({ paths: ws.paths, role, runner, logger: state.logger, source: "web-api", path: sourcePath });
  return json({ ok: true, action: "stop", role: role.name, displayId: role.display_id, runnerPid: runner.runner_pid });
}

async function proxyRunnerJson(runner: RunnerStatus, path: string, init?: RequestInit): Promise<Response> {
  const controlUrl = runnerControlUrl(runner);
  if (!controlUrl) return json({ error: "runner control endpoint is not ready" }, { status: 409 });
  const res = await fetchRunnerControl(runner, path, init);
  const body = await res.json().catch(() => ({ error: "runner returned non-json response" }));
  return json(body, { status: res.ok ? 200 : 502 });
}

async function pushInboxNudge(state: DaemonState, ws: WorkspaceState, runner: RunnerStatus, input: { messageId: number; fromRole: string; source: "agent" | "web" }): Promise<{ ok: boolean; skipped?: boolean; reason?: string; channel?: string; queued?: boolean; nudged?: boolean; throttled?: boolean; blocked_by_draft?: boolean; error?: string }> {
  if (runner.native_push) {
    state.logger.info("message.push_native", {
      role: runner.role,
      sessionId: runner.session_id,
      messageId: input.messageId,
      fromRole: input.fromRole,
      channel: runner.native_push,
    });
    return { ok: true, skipped: true, reason: "native-push", channel: runner.native_push };
  }
  const controlUrl = runnerControlUrl(runner);
  if (!controlUrl) return { ok: false, error: "runner control endpoint is not ready" };
  try {
    const res = await fetchRunnerControl(runner, "/nudge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await res.json().catch(() => ({})) as { ok?: boolean; queued?: boolean; nudged?: boolean; throttled?: boolean; blocked_by_draft?: boolean; error?: string };
    const ok = res.ok && body.ok !== false;
    state.logger.info(ok ? "message.push_nudge" : "message.push_nudge_failed", {
      role: runner.role,
      sessionId: runner.session_id,
      messageId: input.messageId,
      fromRole: input.fromRole,
      queued: body.queued,
      nudged: body.nudged,
      throttled: body.throttled,
      blockedByDraft: body.blocked_by_draft,
      error: ok ? undefined : body.error || `HTTP ${res.status}`,
    });
    return ok ? { ok: true, queued: body.queued, nudged: body.nudged, throttled: body.throttled, blocked_by_draft: body.blocked_by_draft } : { ok: false, error: body.error || `HTTP ${res.status}` };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    state.logger.warn("message.push_nudge_failed", { role: runner.role, sessionId: runner.session_id, messageId: input.messageId, fromRole: input.fromRole, error });
    return { ok: false, error };
  }
}

async function clearRunnerNudge(runner: RunnerStatus): Promise<void> {
  const controlUrl = runnerControlUrl(runner);
  if (!controlUrl) return;
  await fetchRunnerControl(runner, "/nudge-clear", { method: "POST" }).catch(() => undefined);
}

async function runnerStatusForRoleName(state: DaemonState, ws: WorkspaceState, roleName: string): Promise<RunnerStatus | null> {
  const role = await roleByName(state, ws, roleName);
  if (!role) return null;
  return (await discoverAndReconcileRunners(state, ws)).find((item) => item.role === role.name) ?? null;
}

/**
 * EP-DEC-RUN WA-006: id-keyed runner discovery for the terminal pump.
 * Bare-name `runnerStatusForRoleName` would route to the wrong runner
 * once two repos in one workspace each hold a `main` role.
 */
async function runnerStatusForRoleId(state: DaemonState, ws: WorkspaceState, roleId: string): Promise<RunnerStatus | null> {
  const role = daoGetRoleById(ws.db, roleId);
  if (!role) return null;
  return (await discoverAndReconcileRunners(state, ws)).find((item) => item.display_id === role.display_id) ?? null;
}

async function runtimeSettingsForState(state: DaemonState): Promise<RuntimeSettings> {
  return getDaemonRuntimeSettings(state.daemonDb);
}

function wsSend(socket: ServerWebSocket<TerminalWsData>, body: unknown): void {
  try {
    socket.send(JSON.stringify(body));
  } catch {
    terminalWsClose(socket);
  }
}

function terminalWsSchedule(socket: ServerWebSocket<TerminalWsData>, delay = 150): void {
  if (socket.data.closed) return;
  if (socket.data.timer) clearTimeout(socket.data.timer);
  socket.data.timer = setTimeout(() => void terminalWsPump(socket), delay);
}

function invalidateWsRunnerCache(socket: ServerWebSocket<TerminalWsData>): void {
  socket.data.cachedControlUrl = undefined;
  socket.data.cachedControlSecret = undefined;
  socket.data.cachedSessionId = undefined;
  socket.data.controlReady = false;
  terminalResetRestoreHandshake(socket);
  // Subscribe is sessionId-keyed; any rediscovery may resolve a new
  // sessionId (post Stop+Launch). Drop the subscription so the next pump
  // tick re-subscribes against the new mirror.
  if (socket.data.subscribedSessionId) {
    terminalUnsubscribe(socket.data.state, socket);
  }
}

function terminalPrepareRestoreHandshake(socket: ServerWebSocket<TerminalWsData>): void {
  socket.data.awaitingRestoreAck = true;
  socket.data.restoreBufferedOutputFrames = [];
}

function terminalResetRestoreHandshake(socket: ServerWebSocket<TerminalWsData>): void {
  socket.data.awaitingRestoreAck = false;
  socket.data.restoreBufferedOutputFrames = undefined;
}

function terminalCompleteRestoreHandshake(socket: ServerWebSocket<TerminalWsData>, sessionId?: string): void {
  if (sessionId && socket.data.subscribedSessionId && sessionId !== socket.data.subscribedSessionId) return;
  const buffered = socket.data.restoreBufferedOutputFrames ?? [];
  terminalResetRestoreHandshake(socket);
  for (const payload of buffered) {
    try {
      socket.send(payload);
    } catch {
      terminalWsClose(socket);
      return;
    }
  }
}

function terminalSendOrBufferOutput(socket: ServerWebSocket<TerminalWsData>, payload: string): void {
  if (socket.data.awaitingRestoreAck) {
    if (!socket.data.restoreBufferedOutputFrames) socket.data.restoreBufferedOutputFrames = [];
    socket.data.restoreBufferedOutputFrames.push(payload);
    return;
  }
  try {
    socket.send(payload);
  } catch {
    terminalWsClose(socket);
  }
}

// EP-029 T2 — per-runner output consumer. Replaces the pre-T2 per-WS pump
// loop so multi-viewer subscribers don't double-feed the mirror. Polls
// runner /output, applies events to the mirror, fans out the same events
// (minus the cursor field) to every WS in state.terminalSubscribers for
// the sessionId. WA-149: subscriber sockets still restoring buffer these
// payloads until the browser sends `restore_complete`.
function terminalConsumerScheduleTick(state: DaemonState, sessionId: string, delay = 120): void {
  const handle = state.terminalConsumers.get(sessionId);
  if (!handle || handle.stopped) return;
  if (handle.timer) clearTimeout(handle.timer);
  handle.timer = setTimeout(() => void terminalConsumerTick(state, sessionId), delay);
}

async function terminalConsumerTick(state: DaemonState, sessionId: string): Promise<void> {
  const handle = state.terminalConsumers.get(sessionId);
  const mirror = state.terminalMirrors.get(sessionId);
  const subscribers = state.terminalSubscribers.get(sessionId);
  if (!handle || handle.stopped || !mirror || !subscribers) return;
  let body: { cursor?: number; events?: Array<{ seq?: number; type?: string; data?: string }>; attention?: unknown };
  try {
    const res = await fetchRunnerControlUrl(handle.controlUrl, handle.controlSecret, `/output?cursor=${handle.cursor}`);
    body = await res.json().catch(() => ({ cursor: handle.cursor, events: [] })) as typeof body;
  } catch {
    // Runner endpoint stale (relaunch / runner death). Stop the consumer;
    // any subscriber's pump will rediscover via runnerStatusForRoleId on
    // its next scheduled tick.
    terminalConsumerStop(state, sessionId, "fetch_failed");
    return;
  }
  if (handle.stopped) return;
  const events = Array.isArray(body.events) ? body.events : [];
  for (const event of events) {
    // Apply every typed event's data to the mirror — `output` is PTY bytes,
    // `status` is runner-injected lifecycle text (launch banner, exit
    // notice), `input` is the fake-runner echo path. All three are visible
    // in browser scrollback today via `events.map(e=>e.data)`, so the
    // mirror's snapshot must include them or restore-frame replay would
    // be missing the banner / status lines.
    if (event && typeof event.data === "string") {
      mirror.applyOutput(event.data, event.seq);
    } else if (event?.seq !== undefined) {
      mirror.markLastAppliedSeq(event.seq);
    }
  }
  handle.cursor = terminalCursorFromBody(body.cursor, Math.max(handle.cursor, mirror.getLastAppliedSeq()));
  mirror.markLastAppliedSeq(handle.cursor);
  if (events.length > 0 || body.attention) {
    const payload = JSON.stringify({ type: "output", events, attention: body.attention });
    for (const sock of subscribers) {
      terminalSendOrBufferOutput(sock, payload);
    }
  }
  terminalConsumerScheduleTick(state, sessionId, 120);
}

async function terminalConsumerEnsure(state: DaemonState, sessionId: string, controlUrl: string, controlSecret: string | null | undefined, cols: number, rows: number, runDir?: string): Promise<TerminalStateMirror> {
  const existing = state.terminalConsumers.get(sessionId);
  let mirror = state.terminalMirrors.get(sessionId);
  // EP-029 T7 — disk persistence. Snapshot path is per-workspace runDir
  // + sessionId so a daemon restart recovers TUI state without rebuilding
  // from the runner's bounded ring-buffer tail. attachPersistence schedules
  // periodic flushes (override via WHATSAGENT_MIRROR_FLUSH_MS).
  const snapshotPath = runDir ? join(runDir, `${sessionId}.snapshot`) : null;
  if (!mirror) {
    if (snapshotPath) {
      mirror = TerminalStateMirror.loadFromDisk(snapshotPath, cols, rows) ?? new TerminalStateMirror(cols, rows);
    } else {
      mirror = new TerminalStateMirror(cols, rows);
    }
    state.terminalMirrors.set(sessionId, mirror);
    if (snapshotPath) {
      mirror.attachPersistence({ snapshotPath, flushIntervalMs: getMirrorFlushIntervalMs() });
    }
  }
  if (!state.terminalSubscribers.has(sessionId)) {
    state.terminalSubscribers.set(sessionId, new Set());
  }
  if (existing) {
    existing.controlUrl = controlUrl;
    existing.controlSecret = controlSecret ?? undefined;
    return mirror;
  }
  const handle: TerminalConsumerHandle = { controlUrl, controlSecret: controlSecret ?? undefined, cursor: mirror.getLastAppliedSeq(), cols, rows, stopped: false };
  state.terminalConsumers.set(sessionId, handle);
  // Runner-side backfill on first connect — events after the persisted
  // snapshot's last-applied seq. Replaying cursor=0 here is not
  // idempotent because xterm writes would duplicate visible bytes that
  // were already captured in the restored snapshot.
  try {
    const res = await fetchRunnerControlUrl(controlUrl, controlSecret, `/output?cursor=${handle.cursor}`);
    const body = await res.json().catch(() => ({ cursor: handle.cursor, events: [] })) as { cursor?: number; events?: Array<{ seq?: number; type?: string; data?: string }> };
    const events = Array.isArray(body.events) ? body.events : [];
    for (const event of events) {
      if (event && typeof event.data === "string") {
        mirror.applyOutput(event.data, event.seq);
      } else if (event?.seq !== undefined) {
        mirror.markLastAppliedSeq(event.seq);
      }
    }
    handle.cursor = terminalCursorFromBody(body.cursor, Math.max(handle.cursor, mirror.getLastAppliedSeq()));
    mirror.markLastAppliedSeq(handle.cursor);
  } catch {
    // Backfill best-effort; consumer will rediscover on next tick.
  }
  handle.cursor = Math.max(handle.cursor, mirror.getLastAppliedSeq());
  terminalConsumerScheduleTick(state, sessionId, 120);
  return mirror;
}

function terminalCursorFromBody(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

async function flushAllTerminalMirrors(state: DaemonState): Promise<void> {
  await Promise.all([...state.terminalMirrors.values()].map(async (mirror) => {
    try {
      await mirror.flushPersistence();
    } catch {
      // Best effort during shutdown. Callers awaiting stop() get a
      // deterministic flush when paths still exist; tests/CLI stop paths
      // may remove temp homes concurrently, and that should not make
      // shutdown noisy.
    }
  }));
}

function bearerTokenFromRequest(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1]!.trim() || null : null;
}

function getMirrorFlushIntervalMs(): number {
  const raw = process.env.WHATSAGENT_MIRROR_FLUSH_MS;
  if (!raw) return 1_000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 1_000;
}

function terminalConsumerStop(state: DaemonState, sessionId: string, reason: string): void {
  const handle = state.terminalConsumers.get(sessionId);
  if (handle) {
    handle.stopped = true;
    if (handle.timer) clearTimeout(handle.timer);
    state.terminalConsumers.delete(sessionId);
  }
  // EP-029 WA-136 — wake every WS subscribed to the dying session so its
  // pump rediscovers the runner and either pushes runner_status:exited (if
  // the runner exit hasn't been reported via the WS yet) or migrates the
  // subscription to a freshly-launched session for the same role. Without
  // this nudge the pump is idle after its first subscribe and the WS sits
  // on the stale mirror until the browser is refreshed.
  const subscribers = state.terminalSubscribers.get(sessionId);
  if (subscribers && subscribers.size > 0) {
    // Snapshot before iterating: invalidateWsRunnerCache() removes the
    // socket from the subscribers set via terminalUnsubscribe.
    const snapshot = [...subscribers];
    for (const sock of snapshot) {
      invalidateWsRunnerCache(sock);
      terminalWsSchedule(sock, 50);
    }
  }
  // Mirror persists for exited-replay viewing while subscribers exist.
  // Disposed only when last subscriber leaves (see terminalUnsubscribe).
  state.logger.info("terminal.consumer.stop", { sessionId, reason });
}

function terminalSubscribe(state: DaemonState, sessionId: string, socket: ServerWebSocket<TerminalWsData>): void {
  if (!state.terminalSubscribers.has(sessionId)) {
    state.terminalSubscribers.set(sessionId, new Set());
  }
  state.terminalSubscribers.get(sessionId)!.add(socket);
  socket.data.subscribedSessionId = sessionId;
}

function terminalUnsubscribe(state: DaemonState, socket: ServerWebSocket<TerminalWsData>): void {
  const sessionId = socket.data.subscribedSessionId;
  if (!sessionId) return;
  socket.data.subscribedSessionId = undefined;
  const set = state.terminalSubscribers.get(sessionId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0 && !state.terminalConsumers.has(sessionId)) {
    // Consumer already stopped (runner exited) and last subscriber gone:
    // dispose mirror + clear maps.
    const mirror = state.terminalMirrors.get(sessionId);
    if (mirror) {
      mirror.dispose();
      state.terminalMirrors.delete(sessionId);
    }
    state.terminalSubscribers.delete(sessionId);
  }
}

async function terminalWsPump(socket: ServerWebSocket<TerminalWsData>): Promise<void> {
  if (socket.data.closed) return;
  try {
    const wsForSocket = socket.data.state.workspaces.get(socket.data.workspaceId);
    if (!wsForSocket) {
      wsSend(socket, { type: "runner_status", status: "offline" });
      terminalWsClose(socket);
      return;
    }
    if (!socket.data.cachedControlUrl) {
      const runner = await runnerStatusForRoleId(socket.data.state, wsForSocket, socket.data.roleId);
      if (!runner) {
        socket.data.controlReady = false;
        wsSend(socket, { type: "runner_status", status: "offline" });
        terminalWsSchedule(socket, 1000);
        return;
      }
      const controlUrl = runnerControlUrl(runner);
      if (!runner.reachable) {
        // Runner exited. The pre-T2 per-WS pump drained final output via
        // /output here; under mirror-as-source the consumer for this
        // sessionId already drained on its last successful tick (or never
        // started). The mirror still holds the snapshot — emit it as a
        // restore frame so a freshly-connected viewer of an exited
        // session sees scrollback.
        const mirror = socket.data.state.terminalMirrors.get(runner.session_id);
        if (mirror && !socket.data.subscribedSessionId) {
          const snap = await mirror.getSnapshot();
          terminalPrepareRestoreHandshake(socket);
          wsSend(socket, { type: "restore", snapshot: snap.snapshot, cols: snap.cols, rows: snap.rows, sessionId: runner.session_id });
          if (socket.data.closed) return;
          terminalSubscribe(socket.data.state, runner.session_id, socket);
        }
        socket.data.controlReady = false;
        wsSend(socket, { type: "runner_status", status: runner.status ?? "offline", exitCode: runner.exit_code, exitSignal: runner.exit_signal, sessionId: runner.session_id });
        terminalWsSchedule(socket, 1000);
        return;
      }
      if (!controlUrl) {
        socket.data.controlReady = false;
        terminalWsSchedule(socket, 1000);
        return;
      }
      socket.data.cachedControlUrl = controlUrl;
      socket.data.cachedControlSecret = runnerControlSecret(runner) ?? undefined;
      socket.data.cachedSessionId = runner.session_id;
    }

    const controlUrl = socket.data.cachedControlUrl!;
    const controlSecret = socket.data.cachedControlSecret;
    const sessionId = socket.data.cachedSessionId!;

    // Mirror-as-source: ensure the per-runner consumer is running, send
    // restore frame to this WS once, register as subscriber, and stop
    // self-scheduling. Live deltas arrive from the consumer fan-out; while
    // the browser is still applying the restore snapshot they buffer per
    // WS and drain after the client sends `restore_complete`.
    if (!socket.data.subscribedSessionId) {
      const fallbackCols = socket.data.pendingResize?.cols ?? 80;
      const fallbackRows = socket.data.pendingResize?.rows ?? 24;
      const mirror = await terminalConsumerEnsure(socket.data.state, sessionId, controlUrl, controlSecret, fallbackCols, fallbackRows, wsForSocket.paths.runDir);
      const snap = await mirror.getSnapshot();
      terminalPrepareRestoreHandshake(socket);
      wsSend(socket, { type: "restore", snapshot: snap.snapshot, cols: snap.cols, rows: snap.rows, sessionId });
      if (socket.data.closed) return;
      terminalSubscribe(socket.data.state, sessionId, socket);
    }

    if (!socket.data.controlReady) {
      socket.data.controlReady = true;
      wsSend(socket, { type: "ready", sessionId });
    }

    // Apply any pending resize once, here (covers pre-subscribe resizes
    // and reconnect carry-over). Live resizes go through terminalWsMessage.
    if (socket.data.pendingResize) {
      const { cols, rows } = socket.data.pendingResize;
      socket.data.pendingResize = undefined;
      const mirror = socket.data.state.terminalMirrors.get(sessionId);
      mirror?.resize(cols, rows);
      try {
        await fetchRunnerControlUrl(controlUrl, controlSecret, "/resize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cols, rows }) });
      } catch {
        socket.data.pendingResize = { cols, rows };
        invalidateWsRunnerCache(socket);
        terminalWsSchedule(socket, 500);
        return;
      }
    }
    // No reschedule — live deltas come from the consumer fan-out.
  } catch (e) {
    wsSend(socket, { type: "error", error: e instanceof Error ? e.message : String(e) });
    invalidateWsRunnerCache(socket);
    terminalWsSchedule(socket, 1000);
  }
}

async function terminalWsMessage(socket: ServerWebSocket<TerminalWsData>, message: string | Buffer): Promise<void> {
  const payload = JSON.parse(message.toString()) as { type?: string; data?: string; cols?: number; rows?: number; sessionId?: string; reason?: string };
  if (payload.type === "restore_complete") {
    terminalCompleteRestoreHandshake(socket, typeof payload.sessionId === "string" ? payload.sessionId : undefined);
    return;
  }
  const wsForSocket = socket.data.state.workspaces.get(socket.data.workspaceId);
  if (!wsForSocket) {
    wsSend(socket, { type: "runner_status", status: "offline" });
    terminalWsClose(socket);
    return;
  }
  const runner = await runnerStatusForRoleId(socket.data.state, wsForSocket, socket.data.roleId);
  const controlUrl = runner ? runnerControlUrl(runner) : null;
  if (payload.type === "pulse") {
    const reason = normalizePulseReason(payload.reason);
    if (!runner || !runner.reachable || !controlUrl) return;
    const settings = getTuiRedrawSettings(socket.data.state.daemonDb);
    if (settings.workaround !== "on") return;
    if (!isPulseEligibleRunner(runner)) return;
    try {
      const res = await fetchRunnerControl(runner, "/redraw-pulse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        if (res.status === 404) await markRunnerStalePulseEndpoint(socket.data.state, runner, reason);
        else socket.data.state.logger.warn("runner.tui_redraw_pulse_failed", { role: runner.role, displayId: runner.display_id, sessionId: runner.session_id, reason, status: res.status });
      }
    } catch (error) {
      socket.data.state.logger.warn("runner.tui_redraw_pulse_failed", { role: runner.role, displayId: runner.display_id, sessionId: runner.session_id, reason, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  if (payload.type === "resize") {
    const cols = Math.max(2, Math.floor(Number(payload.cols || 0)));
    const rows = Math.max(1, Math.floor(Number(payload.rows || 0)));
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
    if (!runner || !runner.reachable || !controlUrl) {
      socket.data.pendingResize = { cols, rows };
      terminalWsSchedule(socket, 100);
      return;
    }
    // Forward to PTY AND apply to the mirror so its snapshot reflects the
    // current grid for any subsequent reconnect/restore.
    const mirror = socket.data.state.terminalMirrors.get(runner.session_id);
    mirror?.resize(cols, rows);
    await fetchRunnerControl(runner, "/resize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cols, rows }) });
    return;
  }
  if (!runner || !runner.reachable || !controlUrl) {
    wsSend(socket, { type: "runner_status", status: runner?.status ?? "offline", exitCode: runner?.exit_code, exitSignal: runner?.exit_signal, sessionId: runner?.session_id });
    return;
  }
  if (payload.type === "input") {
    const res = await fetchRunnerControl(runner, "/input", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: payload.data ?? "" }) });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { status?: string; exitCode?: number; exit_code?: number; exitSignal?: string; exit_signal?: string };
      wsSend(socket, { type: "runner_status", status: body.status ?? "offline", exitCode: body.exitCode ?? body.exit_code, exitSignal: body.exitSignal ?? body.exit_signal, sessionId: runner.session_id });
      invalidateWsRunnerCache(socket);
    }
    return;
  }
}

function terminalWsClose(socket: ServerWebSocket<TerminalWsData>): void {
  socket.data.closed = true;
  if (socket.data.timer) clearTimeout(socket.data.timer);
  socket.data.timer = undefined;
  terminalResetRestoreHandshake(socket);
  if (socket.data.subscribedSessionId) {
    terminalUnsubscribe(socket.data.state, socket);
  }
  socket.data.cachedControlUrl = undefined;
  socket.data.cachedControlSecret = undefined;
  socket.data.cachedSessionId = undefined;
  socket.data.controlReady = false;
}

const AGENT_SESSION_CREDENTIAL_TTL_MS = 15 * 60 * 1000;

function createAgentSessionCredential(db: Database, input: { roleId: string; sessionId: string; launchTokenId?: string | null }): { credential: string; expiresAt: string } {
  const credential = randomBytes(32).toString("base64url");
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + AGENT_SESSION_CREDENTIAL_TTL_MS).toISOString();
  insertAgentSessionCredential(db, {
    id: randomUUID(),
    roleId: input.roleId,
    sessionId: input.sessionId,
    credentialHash: hashLaunchToken(credential),
    issuedAt,
    expiresAt,
    launchTokenId: input.launchTokenId ?? null,
  });
  return { credential, expiresAt };
}

async function validateLaunchToken(state: DaemonState, ws: WorkspaceState, input: { role?: string; sessionId?: string; token?: string }, options: { refresh?: boolean } = {}): Promise<{ ok: false; reason: string } | { ok: true; roleId: string; sessionCredential?: string; sessionCredentialExpiresAt?: string; authKind: "bootstrap" | "session" }> {
  if (!input.role || !input.sessionId || !input.token) return { ok: false, reason: "role, sessionId, and token are required" };
  const db = ws.db;
  const credentialHash = hashLaunchToken(input.token);
  const sessionCredential = getAgentSessionCredentialForValidation(db, input.role, input.sessionId, credentialHash);
  if (sessionCredential) {
    if (!hasActiveRunnerSession(db, sessionCredential.role_id, input.sessionId)) return { ok: false, reason: "agent session is not active" };
    if (!options.refresh) {
      // EP-DEC-RUN WA-006 (advisor msg #26): return the launched role.id so
      // requireAgentContext can resolve by id, not by bare role.name.
      return { ok: true, roleId: sessionCredential.role_id, authKind: "session" };
    }
    const next = createAgentSessionCredential(db, { roleId: sessionCredential.role_id, sessionId: input.sessionId, launchTokenId: sessionCredential.launch_token_id });
    revokeAgentSessionCredential(db, sessionCredential.id);
    return { ok: true, roleId: sessionCredential.role_id, sessionCredential: next.credential, sessionCredentialExpiresAt: next.expiresAt, authKind: "session" };
  }

  const record = getLaunchTokenForValidation(db, input.role, input.sessionId);
  if (!record) return { ok: false, reason: "launch token not found or expired" };
  if (!launchTokenHashMatches(input.token, record.token_hash)) return { ok: false, reason: "launch token mismatch" };
  if (!consumeLaunchToken(db, record.id)) return { ok: false, reason: "launch token already consumed" };
  if (!hasActiveRunnerSession(db, record.role_id, input.sessionId)) return { ok: false, reason: "agent session is not active" };
  const next = createAgentSessionCredential(db, { roleId: record.role_id, sessionId: input.sessionId, launchTokenId: record.id });
  // EP-DEC-RUN WA-006 (advisor msg #26): return the launched role.id so
  // requireAgentContext can resolve by id, not by bare role.name.
  // Without this, an agent launched as `beta:main` could authenticate
  // by session token but execute tools as `alpha:main` (first match).
  return { ok: true, roleId: record.role_id, sessionCredential: next.credential, sessionCredentialExpiresAt: next.expiresAt, authKind: "bootstrap" };
}

async function requireAgentContext(state: DaemonState, ws: WorkspaceState, input: AgentContextInput): Promise<AgentContext | Response> {
  const token = await validateLaunchToken(state, ws, input);
  if (!token.ok) return json({ ok: false, error: token.reason }, { status: 401 });
  const roleRow = daoGetRoleById(ws.db, token.roleId);
  if (!roleRow) return json({ ok: false, error: `Unknown role id: ${token.roleId}` }, { status: 404 });
  const role = adaptRoleWithDisplayToCompat(roleRow);
  // Match runner by display_id + session_id (advisor msg #26): bare-name
  // role.name + session_id was already unique due to session_id, but
  // making the match displayId-keyed keeps the contract consistent with
  // every other owner-match site.
  const runner = (await discoverAndReconcileRunners(state, ws)).find((item) => item.display_id === role.display_id && item.session_id === input.sessionId && item.reachable);
  if (!runner) return json({ ok: false, error: `${role.display_id || role.name} session is not active` }, { status: 409 });
  return { role, sessionId: input.sessionId!, runner };
}

function threadIdFor(fromRole: AgentRow | null, toRole: AgentRow): string {
  // EP-DEC-RUN WA-006 (advisor msg #28): keep thread ids unique across
  // same-bare-name roles by using id (web threads) and id-pair sorted
  // (agent ↔ agent threads). Bare name would collapse `alpha:main ↔ X`
  // and `beta:main ↔ X` to one thread.
  const toId = toRole.id;
  if (!fromRole) return `web:${toId}`;
  return `role:${[fromRole.id, toId].sort().join(":")}`;
}

export const HUMAN_WEB_PEER = "human-web";
export function isHumanWebPeer(name: string | null | undefined): boolean {
  return name === HUMAN_WEB_PEER;
}

async function sendFleetMessage(state: DaemonState, ws: WorkspaceState, input: { fromRole: AgentRow | null; fromSessionId: string | null; toRoleName?: string; body?: string; source: "agent" | "web" }): Promise<Response> {
  const body = String(input.body ?? "").trim();
  if (!body) return json({ ok: false, error: "body is required" }, { status: 400 });
  const hardLimitError = overMessageLimit(body, DEFAULT_MESSAGE_MAX_BODY_CHARS);
  if (hardLimitError) return hardLimitError;
  if (!input.toRoleName) return json({ ok: false, error: "toRole is required" }, { status: 400 });

  if (isHumanWebPeer(input.toRoleName)) {
    return sendHumanWebMessage(state, ws, { fromRole: input.fromRole, fromSessionId: input.fromSessionId, body, source: input.source });
  }

  const runners = await discoverAndReconcileRunners(state, ws);
  const db = ws.db;
  const stats = messageBodyStats(body, getMessageSettings(db).maxBodyChars);
  if (stats.charCount > stats.maxChars) return overMessageLimit(body, stats.maxChars)!;
  // EP-DEC-2 round 5: accept either `repo:role` display id or bare name.
  // Display id is the new shape advertised by the protocol/MCP tool docs;
  // bare name keeps working via the compat shim until EP-DEC-5.
  const toRole = resolveRoleAddress(db, input.toRoleName);
  if (!toRole) return json({ ok: false, error: `Unknown role: ${input.toRoleName}` }, { status: 404 });
  const mainRole = getMainAgent(db);
  const policyMode = getPolicyMode(db);
  // EP-DEC-RUN WA-006 (advisor msg #24): match runner by display_id, not
  // bare role.name — same-bare-name across repos would route to wrong runner.
  const toRunner = runners.find((runner) => runner.display_id === toRole.display_id && runner.reachable);
  const reject = (status: number, error: string) => {
    const message = insertMessage(db, {
      threadId: threadIdFor(input.fromRole, toRole),
      fromRoleId: input.fromRole?.id ?? null,
      toRoleId: toRole.id,
      fromSessionId: input.fromSessionId,
      toSessionId: toRunner?.session_id ?? null,
      body,
      state: "rejected",
      error,
    });
    state.logger.info("message.rejected", { source: input.source, fromRole: input.fromRole?.name ?? "web", toRole: toRole.name, error });
    return json({ ok: false, error, message, ...stats }, { status });
  };

  if (policyMode === "channel") return reject(403, "channel policy rejects direct messages; use post_channel_message");
  if (!toRunner) return reject(409, `${toRole.name} is offline`);
  if (input.source === "agent") {
    if (!input.fromRole) return reject(400, "fromRole is required");
    if (input.fromRole.id === toRole.id) return reject(403, "messaging policy rejects self messages");
    if (policyMode === "star") {
      if (!mainRole) return reject(409, "main role is not set");
      if (input.fromRole.id !== mainRole.id && toRole.id !== mainRole.id) return reject(403, "star rejects role-to-role messages");
    }
    if (policyMode === "peer-to-peer" && !(mainRole && (input.fromRole.id === mainRole.id || toRole.id === mainRole.id))) {
      const peerRuleMode = getPeerRuleMode(db);
      const listed = peerRuleExists(db, input.fromRole.id, toRole.id);
      if (peerRuleMode === "allow-list" && !listed) return reject(403, "peer-to-peer allow-list rejects this role pair");
      if (peerRuleMode === "deny-list" && listed) return reject(403, "peer-to-peer deny-list rejects this role pair");
    }
  }

  const message = insertMessage(db, {
    threadId: threadIdFor(input.fromRole, toRole),
    fromRoleId: input.fromRole?.id ?? null,
    toRoleId: toRole.id,
    fromSessionId: input.fromSessionId,
    toSessionId: toRunner.session_id,
    body,
    state: "pending",
  });
  state.logger.info("message.sent", { source: input.source, fromRole: input.fromRole?.name ?? "web", toRole: toRole.name, messageId: message.id });
  const push = await pushInboxNudge(state, ws, toRunner, { messageId: message.id, fromRole: input.fromRole?.name ?? "human-web", source: input.source });
  return json({ ok: true, message, push, ...stats });
}

async function sendHumanWebMessage(state: DaemonState, ws: WorkspaceState, input: { fromRole: AgentRow | null; fromSessionId: string | null; body: string; source: "agent" | "web" }): Promise<Response> {
  const db = ws.db;
  const stats = messageBodyStats(input.body, getMessageSettings(db).maxBodyChars);
  if (stats.charCount > stats.maxChars) return overMessageLimit(input.body, stats.maxChars)!;
  const policyMode = getPolicyMode(db);
  const mainRole = getMainAgent(db);
  const threadId = input.fromRole ? `web:${input.fromRole.name}` : `web:${HUMAN_WEB_PEER}`;
  const reject = (status: number, error: string) => {
    const message = insertMessage(db, {
      threadId,
      fromRoleId: input.fromRole?.id ?? null,
      toRoleId: HUMAN_WEB_PEER,
      fromSessionId: input.fromSessionId,
      toSessionId: null,
      body: input.body,
      state: "rejected",
      error,
    });
    state.logger.info("message.rejected", { source: input.source, fromRole: input.fromRole?.name ?? "web", toRole: HUMAN_WEB_PEER, error });
    return json({ ok: false, error, message, ...stats }, { status });
  };
  if (policyMode === "channel") return reject(403, "channel policy rejects direct messages; use post_channel_message");
  if (input.source === "agent") {
    if (!input.fromRole) return reject(400, "fromRole is required");
    if (policyMode === "star") {
      if (!mainRole) return reject(409, "main role is not set");
      if (input.fromRole.id !== mainRole.id) return reject(403, "star policy: only the main role can message human-web");
    }
    // peer-to-peer: any role can reach human-web; no peer-rule gate (peer rules
    // govern role-to-role pairs; human-web is a virtual peer outside that table).
  }
  const message = insertMessage(db, {
    threadId,
    fromRoleId: input.fromRole?.id ?? null,
    toRoleId: HUMAN_WEB_PEER,
    fromSessionId: input.fromSessionId,
    toSessionId: null,
    body: input.body,
    state: "pending",
  });
  state.logger.info("message.sent", { source: input.source, fromRole: input.fromRole?.name ?? "web", toRole: HUMAN_WEB_PEER, messageId: message.id });
  return json({ ok: true, message, push: { delivered: false, reason: "human-web is a virtual peer" }, ...stats });
}

async function broadcastFleetMessage(state: DaemonState, ws: WorkspaceState, input: { fromRole: AgentRow | null; fromSessionId: string | null; body?: string; source: "agent" | "web" }): Promise<Response> {
  const body = String(input.body ?? "").trim();
  if (!body) return json({ ok: false, error: "body is required" }, { status: 400 });
  const hardLimitError = overMessageLimit(body, DEFAULT_MESSAGE_MAX_BODY_CHARS);
  if (hardLimitError) return hardLimitError;

  const runners = await discoverAndReconcileRunners(state, ws);
  const db = ws.db;
  const stats = messageBodyStats(body, getMessageSettings(db).maxBodyChars);
  if (stats.charCount > stats.maxChars) return overMessageLimit(body, stats.maxChars)!;
  const policyMode = getPolicyMode(db);
  // Topology gate stays in peer/messaging policy: broadcast is only valid
  // in Star/Peer-to-peer modes regardless of RBAC. (EP-022 / WA-096:
  // messaging topology Star is independent of RBAC; the legacy "only
  // the main role can broadcast" auth fallback was deleted alongside
  // the kanban-Star helpers — the RBAC dispatcher's
  // `role_grants(channel_action, broadcast_message)` check is now the
  // sole auth gate.)
  if (policyMode !== "star" && policyMode !== "peer-to-peer") return json({ ok: false, error: "broadcast_message is only available in Star or Peer-to-peer policy" }, { status: 403 });

  const broadcastId = randomUUID();
  // EP-DEC-RUN WA-006 (advisor msg #24): map runner → role by display_id,
  // not bare role.name. The bare-name lookup would route a broadcast to
  // the wrong same-name role in another repo.
  const fromDisplayId = input.fromRole?.display_id ?? null;
  const allRoles = listAgentsByWorkspace(db);
  const rolesByDisplayId = new Map(allRoles.map((r) => [r.display_id, adaptRoleWithDisplayToCompat(r)]));
  const onlineRecipients = runners
    .filter((runner) => runner.reachable && !(input.source === "agent" && fromDisplayId !== null && runner.display_id === fromDisplayId))
    .map((runner) => ({ runner, role: rolesByDisplayId.get(runner.display_id) }))
    .filter((item): item is { runner: typeof runners[number]; role: AgentRow } => Boolean(item.role));
  const messages = [];
  const pushes = [];
  for (const { runner, role } of onlineRecipients) {
    const message = insertMessage(db, {
      threadId: threadIdFor(input.fromRole, role),
      fromRoleId: input.fromRole?.id ?? null,
      toRoleId: role.id,
      fromSessionId: input.fromSessionId,
      toSessionId: runner.session_id,
      body,
      state: "pending",
      deliveryKind: "broadcast",
      broadcastId,
    });
    messages.push(message);
    pushes.push({ role: role.name, push: await pushInboxNudge(state, ws, runner, { messageId: message.id, fromRole: input.fromRole?.name ?? "human-web", source: input.source }) });
  }
  state.logger.info("message.broadcast", { source: input.source, fromRole: input.fromRole?.name ?? "web", broadcastId, recipients: messages.length });
  return json({ ok: true, broadcastId, messages, pushes, ...stats });
}

function channelInboxRows(messages: ChannelMessageRow[], recipient: AgentRow, sessionId: string | null, messageState: "pending" | "delivered"): MessageRow[] {
  return messages.map((message) => channelMessageToInboxRow(message, recipient, sessionId, messageState));
}

function kanbanInboxRows(notifications: KanbanNotificationRow[], recipient: AgentRow, sessionId: string | null, messageState: "pending" | "delivered"): MessageRow[] {
  return notifications.map((notification) => kanbanNotificationToInboxRow(notification, recipient, sessionId, messageState));
}

function kanbanEpicInboxRows(notifications: KanbanEpicNotificationRow[], recipient: AgentRow, sessionId: string | null, messageState: "pending" | "delivered"): MessageRow[] {
  return notifications.map((notification) => kanbanEpicNotificationToInboxRow(notification, recipient, sessionId, messageState));
}

function isEpicKanbanRow(message: MessageRow): boolean {
  return message.delivery_kind === "kanban" && message.kanban_epic_notification_id != null;
}

function normalizeInboxLimit(value: unknown): number {
  const limit = Math.floor(Number(value ?? 50));
  return Math.max(1, Math.min(100, Number.isFinite(limit) ? limit : 50));
}

function inboxRowKey(message: MessageRow): string {
  if (isEpicKanbanRow(message)) return `kanban-epic:${message.kanban_epic_notification_id ?? message.id}`;
  if (message.delivery_kind === "kanban") return `kanban:${message.kanban_notification_id ?? message.id}`;
  return `${message.delivery_kind}:${message.id}`;
}

function selectInboxRows(messages: MessageRow[], limit: number): MessageRow[] {
  return [...messages].sort((a, b) => {
    const byTime = Date.parse(a.sent_at) - Date.parse(b.sent_at);
    if (Number.isFinite(byTime) && byTime !== 0) return byTime;
    const byKind = a.delivery_kind.localeCompare(b.delivery_kind);
    if (byKind !== 0) return byKind;
    const aSource = isEpicKanbanRow(a) ? "epic" : "task";
    const bSource = isEpicKanbanRow(b) ? "epic" : "task";
    if (aSource !== bSource) return aSource < bSource ? -1 : 1;
    return a.id - b.id;
  }).slice(0, limit);
}

function listActionableInboxRows(db: Database, context: AgentContext, limit: number): MessageRow[] {
  // EP-030: switch direct/broadcast source from `listPendingMessages` to
  // `listAgentInboxRows` so rows in `state='pushed'` (push-success-but-LLM-
  // never-saw) resurface on the next `check_messages` pull. Channel + kanban
  // sources keep their own state machinery and are unaffected.
  const policyMessages = getPolicyMode(db) === "channel"
    ? channelInboxRows(listUnreadChannelMessages(db, context.role.id, limit), context.role, context.sessionId, "pending")
    : listAgentInboxRows(db, context.role.id, context.sessionId, limit);
  const kanbanMessages = kanbanInboxRows(listPendingKanbanNotifications(db, context.role.id, limit), context.role, context.sessionId, "pending");
  const kanbanEpicMessages = kanbanEpicInboxRows(listPendingKanbanEpicNotifications(db, context.role.id, limit), context.role, context.sessionId, "pending");
  return selectInboxRows([...policyMessages, ...kanbanMessages, ...kanbanEpicMessages], limit);
}

function markSelectedInboxRowsRead(db: Database, context: AgentContext, messages: MessageRow[]): MessageRow[] {
  const directIds = messages.filter((message) => message.delivery_kind === "direct" || message.delivery_kind === "broadcast").map((message) => message.id);
  const channelIds = messages.filter((message) => message.delivery_kind === "channel").map((message) => message.id);
  const kanbanIds = messages
    .filter((message) => message.delivery_kind === "kanban" && !isEpicKanbanRow(message))
    .map((message) => message.kanban_notification_id ?? message.id);
  const kanbanEpicIds = messages
    .filter(isEpicKanbanRow)
    .map((message) => message.kanban_epic_notification_id ?? message.id);
  const marked = [
    ...markMessagesRead(db, context.role.id, context.sessionId, directIds),
    ...channelInboxRows(markChannelMessagesRead(db, context.role.id, channelIds), context.role, context.sessionId, "delivered"),
    ...kanbanInboxRows(markKanbanNotificationsRead(db, context.role.id, kanbanIds), context.role, context.sessionId, "delivered"),
    ...kanbanEpicInboxRows(markKanbanEpicNotificationsRead(db, context.role.id, kanbanEpicIds), context.role, context.sessionId, "delivered"),
  ];
  const byKey = new Map(marked.map((message) => [inboxRowKey(message), message]));
  return messages.map((message) => byKey.get(inboxRowKey(message))).filter((message): message is MessageRow => Boolean(message));
}

function deliverActionableInboxRows(db: Database, context: AgentContext, limit: number): MessageRow[] {
  return markSelectedInboxRowsRead(db, context, listActionableInboxRows(db, context, limit));
}

/**
 * EP-030: emit `message.push_to_delivery_lag_ms` per pushed-then-delivered
 * row plus an aggregate `message.dropped_pushed_recovered` audit. Called
 * from `check-messages` only for rows whose pre-deliver state was `pushed`.
 *
 * `pushedBeforeDeliver` carries the snapshot taken before
 * `markSelectedInboxRowsRead`; `delivered` is the post-mark return value
 * (used to compute `delivered_at` per row). When the same row id is missing
 * from `delivered` (e.g. concurrent ack lost it) we skip the per-row lag
 * audit and let the aggregate carry the recovery signal.
 */
function auditPushDeliveryLag(db: Database, context: AgentContext, pushedBeforeDeliver: MessageRow[], delivered: MessageRow[]): void {
  // Filter `delivered` to direct/broadcast before keying by numeric id —
  // channel + kanban rows live on separate tables and their ids can
  // collide with messages.id. Without the filter, a coincidental id match
  // would bind a kanban delivered row's `delivered_at` to a direct row's
  // pushed_at and emit a corrupt lag audit (advisor review fix #3).
  const deliveredById = new Map(
    delivered
      .filter((row) => row.delivery_kind === "direct" || row.delivery_kind === "broadcast")
      .map((row) => [row.id, row]),
  );
  const targetId = context.role.display_id ?? context.role.name;
  for (const before of pushedBeforeDeliver) {
    const after = deliveredById.get(before.id);
    if (!after?.delivered_at || !before.pushed_at) continue;
    const lagMs = Date.parse(after.delivered_at) - Date.parse(before.pushed_at);
    if (!Number.isFinite(lagMs) || lagMs < 0) continue;
    appendAudit(db, {
      kind: "message.push_to_delivery_lag_ms",
      actor_agent_id: context.role.id,
      target_kind: "message",
      target_id: String(before.id),
      payload: {
        messageId: before.id,
        lagMs,
        pushedAt: before.pushed_at,
        deliveredAt: after.delivered_at,
        deliveryKind: before.delivery_kind,
        sessionId: context.sessionId,
      },
    });
  }
  appendAudit(db, {
    kind: "message.dropped_pushed_recovered",
    actor_agent_id: context.role.id,
    target_kind: "messages",
    target_id: targetId,
    payload: {
      action: "check-messages",
      count: pushedBeforeDeliver.length,
      messageIds: pushedBeforeDeliver.map((row) => row.id),
      sessionId: context.sessionId,
    },
  });
}

function markInboxIdsRead(db: Database, context: AgentContext, messageIds: number[], kanbanNotificationIds: number[], kanbanEpicNotificationIds: number[]): MessageRow[] {
  const policyMessages = getPolicyMode(db) === "channel"
    ? channelInboxRows(markChannelMessagesRead(db, context.role.id, messageIds), context.role, context.sessionId, "delivered")
    : markMessagesRead(db, context.role.id, context.sessionId, messageIds);
  return [
    ...policyMessages,
    ...kanbanInboxRows(markKanbanNotificationsRead(db, context.role.id, kanbanNotificationIds), context.role, context.sessionId, "delivered"),
    ...kanbanEpicInboxRows(markKanbanEpicNotificationsRead(db, context.role.id, kanbanEpicNotificationIds), context.role, context.sessionId, "delivered"),
  ];
}

async function postFleetChannelMessage(state: DaemonState, ws: WorkspaceState, input: { fromRole: AgentRow | null; fromSessionId: string | null; body?: string; parentMessageId?: number | null; source: "agent" | "web" }): Promise<Response> {
  const body = String(input.body ?? "").trim();
  if (!body) return json({ ok: false, error: "body is required" }, { status: 400 });
  const hardLimitError = overMessageLimit(body, DEFAULT_MESSAGE_MAX_BODY_CHARS);
  if (hardLimitError) return hardLimitError;

  const runners = await discoverAndReconcileRunners(state, ws);
  const db = ws.db;
  const stats = messageBodyStats(body, getMessageSettings(db).maxBodyChars);
  if (stats.charCount > stats.maxChars) return overMessageLimit(body, stats.maxChars)!;
  if (getPolicyMode(db) !== "channel") return json({ ok: false, error: "post_channel_message is only available in Channel policy" }, { status: 403 });
  let message: ChannelMessageRow;
  try {
    message = postChannelMessage(db, { fromRoleId: input.fromRole?.id ?? null, fromSessionId: input.fromSessionId, body, parentMessageId: input.parentMessageId });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  // EP-DEC-RUN WA-006 (advisor msg #26): map runner → role by display_id;
  // sender-self skip also keys on display_id.
  const fromDisplayIdChan = input.fromRole?.display_id ?? null;
  const allRolesForChannel = listAgentsByWorkspace(db);
  const channelRolesByDisplayId = new Map(allRolesForChannel.map((r) => [r.display_id, adaptRoleWithDisplayToCompat(r)]));
  const onlineRecipients = runners
    .filter((runner) => runner.reachable && !(fromDisplayIdChan !== null && runner.display_id === fromDisplayIdChan))
    .map((runner) => ({ runner, role: channelRolesByDisplayId.get(runner.display_id) }))
    .filter((item): item is { runner: typeof runners[number]; role: AgentRow } => Boolean(item.role));
  const pushes = [];
  for (const { runner, role } of onlineRecipients) {
    pushes.push({ role: role.display_id || role.name, push: await pushInboxNudge(state, ws, runner, { messageId: message.id, fromRole: input.fromRole?.display_id ?? input.fromRole?.name ?? "human-web", source: input.source }) });
  }
  state.logger.info("channel.message.posted", { source: input.source, fromRole: input.fromRole?.name ?? "web", channel: message.channel_name, messageId: message.id, recipients: pushes.length });
  return json({ ok: true, message, pushes, ...stats });
}

async function listFleetChannelMessages(state: DaemonState, ws: WorkspaceState, url: URL): Promise<Response> {
  const limit = tryParseInteger(url.searchParams.get("limit"), { min: 1, max: 500, default: 100 });
  if (limit instanceof Response) return limit;
  const db = ws.db;
  return json({ ok: true, messages: listChannelMessages(db, { limit }) });
}

async function readAgentChannelMessages(state: DaemonState, ws: WorkspaceState, input: unknown): Promise<Response> {
  const body = input && typeof input === "object" ? input as { limit?: unknown; sinceId?: unknown; beforeId?: unknown } : {};
  const limit = tryParseInteger(body.limit, { min: 1, max: 500, default: 50 });
  if (limit instanceof Response) return limit;
  const sinceId = tryParseInteger(body.sinceId, { min: 0, default: 0 });
  if (sinceId instanceof Response) return sinceId;
  const beforeId = tryParseInteger(body.beforeId, { min: 0, default: 0 });
  if (beforeId instanceof Response) return beforeId;
  const db = ws.db;
  if (getPolicyMode(db) !== "channel") return json({ ok: false, error: "read_channel_messages is only available in Channel policy" }, { status: 403 });
  const settings = getMessageSettings(db);
  const messages = listChannelMessages(db, { limit, sinceId, beforeId, latest: sinceId <= 0 }).map((message) => ({
    ...message,
    ...messageBodyStats(message.body, settings.maxBodyChars),
  }));
  return json({ ok: true, messages });
}

async function listFleetMessages(state: DaemonState, ws: WorkspaceState, url: URL): Promise<Response> {
  const limit = Number(url.searchParams.get("limit") ?? "100");
  const roleAddr = url.searchParams.get("role");
  const db = ws.db;
  // EP-DEC-RUN WA-006 (advisor msg #28): accept UUID first, then displayId.
  let role: AgentRow | null = null;
  if (roleAddr) {
    const byId = daoGetRoleById(db, roleAddr);
    if (byId) role = adaptRoleWithDisplayToCompat(byId);
    else if (roleAddr.includes(":")) role = resolveRoleAddress(db, roleAddr);
  }
  if (roleAddr && !role) return json({ ok: false, error: `Unknown role: ${roleAddr}` }, { status: 404 });
  return json({ ok: true, messages: listDbMessages(db, { roleId: role?.id, limit }) });
}

function parseSearchQueryInput(value: unknown): string | Response {
  const q = String(value ?? "").trim();
  if (q.length < 2 || q.length > 200) return json({ ok: false, error: "q must be 2..200 characters" }, { status: 400 });
  return q;
}

function searchLimitInput(value: unknown): number | Response {
  return tryParseInteger(value, { min: 1, max: 100, default: 20 });
}

function searchEnvelope(results: unknown[], limit: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ok: true, results, total: results.length, truncated: results.length >= limit, ...extra };
}

function parseOptionalKanbanStatusInput(value: unknown): KanbanStatus | null | Response {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  return parseKanbanStatusInput(value);
}

function currentWorkspace(state: DaemonState): WorkspaceState | null {
  return state.currentWorkspaceId ? state.workspaces.get(state.currentWorkspaceId) ?? null : null;
}

async function handleAgentSearchApi(ws: WorkspaceState, action: string, body: Record<string, unknown>, context: AgentContext): Promise<Response> {
  const db = ws.db;
  const q = parseSearchQueryInput(body.q);
  if (q instanceof Response) return q;
  const limit = searchLimitInput(body.limit);
  if (limit instanceof Response) return limit;
  try {
    if (action === "search-direct-messages") {
      const senderName = String(body.sender ?? "").trim();
      const sender = senderName ? resolveRoleAddress(db, senderName) : null;
      if (senderName && !sender) return json({ ok: false, error: `Unknown role: ${senderName}` }, { status: 404 });
      const results = searchDirectMessages(db, { callerRoleId: context.role.id, senderRoleId: sender?.id ?? null, q, limit });
      return json(searchEnvelope(results, limit));
    }
    if (action === "search-channel-messages") {
      const senderName = String(body.sender ?? "").trim();
      const sender = senderName ? resolveRoleAddress(db, senderName) : null;
      if (senderName && !sender) return json({ ok: false, error: `Unknown role: ${senderName}` }, { status: 404 });
      const channelId = String(body.channel ?? "").trim() || null;
      const results = searchChannelMessages(db, { senderRoleId: sender?.id ?? null, channelId, q, limit });
      return json(searchEnvelope(results, limit));
    }
    if (action === "search-kanban-tasks") {
      const assigneeName = String(body.assignee ?? body.assignedTo ?? "").trim();
      const assignee = assigneeName ? resolveRoleAddress(db, assigneeName) : null;
      if (assigneeName && !assignee) return json({ ok: false, error: `Unknown role: ${assigneeName}` }, { status: 404 });
      const status = parseOptionalKanbanStatusInput(body.status);
      if (status instanceof Response) return status;
      const results = searchKanbanTasks(db, { q, status, assignedRoleId: assignee?.id ?? null, includeArchived: booleanParam(body.includeArchived ?? body.include_archived), limit });
      return json(searchEnvelope(results, limit));
    }
    if (action === "search-kanban-epics") {
      const assigneeName = String(body.assignee ?? body.assignedTo ?? "").trim();
      const assignee = assigneeName ? resolveRoleAddress(db, assigneeName) : null;
      if (assigneeName && !assignee) return json({ ok: false, error: `Unknown role: ${assigneeName}` }, { status: 404 });
      const status = parseOptionalKanbanStatusInput(body.status);
      if (status instanceof Response) return status;
      const results = searchKanbanEpics(db, { q, status, assignedRoleId: assignee?.id ?? null, includeArchived: booleanParam(body.includeArchived ?? body.include_archived), limit });
      return json(searchEnvelope(results, limit));
    }
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  return json({ ok: false, error: "not found" }, { status: 404 });
}

/**
 * Owner-admin browser API: scope=global aggregates all DMs in the workspace.
 * Cookie auth is daemon-owner-equivalent, unlike agent-scoped MCP calls.
 */
async function searchDirectMessagesWebEndpoint(state: DaemonState, req: Request, url: URL): Promise<Response> {
  const auth: any = requireWebSessionResponse(state, req);
  if (auth instanceof Response) return auth;
  const ws = currentWorkspace(state);
  if (!ws) return json({ ok: false, error: "no_active_workspace" }, { status: 503 });
  const q = parseSearchQueryInput(url.searchParams.get("q"));
  if (q instanceof Response) return q;
  const limit = searchLimitInput(url.searchParams.get("limit"));
  if (limit instanceof Response) return limit;
  const scope = url.searchParams.get("scope") ?? "global";
  if (scope !== "global" && scope !== "agent") return json({ ok: false, error: "scope must be agent or global" }, { status: 400 });
  const agentId = url.searchParams.get("agentId") ?? url.searchParams.get("agent_id");
  if (scope === "agent" && !agentId) return json({ ok: false, error: "agentId is required when scope=agent" }, { status: 400 });
  const caller = scope === "agent" ? resolveRoleAddress(ws.db, agentId!) : null;
  if (scope === "agent" && !caller) return json({ ok: false, error: `Unknown role: ${agentId}` }, { status: 404 });
  const senderName = url.searchParams.get("sender") ?? "";
  const sender = senderName ? resolveRoleAddress(ws.db, senderName) : null;
  if (senderName && !sender) return json({ ok: false, error: `Unknown role: ${senderName}` }, { status: 404 });
  const results = searchDirectMessages(ws.db, { callerRoleId: caller?.id ?? null, senderRoleId: sender?.id ?? null, q, limit });
  return json(searchEnvelope(results, limit, { mode: scope === "global" ? "owner-equivalent" : "agent-scoped" }));
}

async function searchChannelMessagesWebEndpoint(state: DaemonState, req: Request, url: URL): Promise<Response> {
  const auth: any = requireWebSessionResponse(state, req);
  if (auth instanceof Response) return auth;
  const ws = currentWorkspace(state);
  if (!ws) return json({ ok: false, error: "no_active_workspace" }, { status: 503 });
  const q = parseSearchQueryInput(url.searchParams.get("q"));
  if (q instanceof Response) return q;
  const limit = searchLimitInput(url.searchParams.get("limit"));
  if (limit instanceof Response) return limit;
  const senderName = url.searchParams.get("sender") ?? "";
  const sender = senderName ? resolveRoleAddress(ws.db, senderName) : null;
  if (senderName && !sender) return json({ ok: false, error: `Unknown role: ${senderName}` }, { status: 404 });
  const results = searchChannelMessages(ws.db, { q, senderRoleId: sender?.id ?? null, channelId: url.searchParams.get("channel") || null, limit });
  return json(searchEnvelope(results, limit));
}

async function searchKanbanTasksWebEndpoint(state: DaemonState, req: Request, url: URL): Promise<Response> {
  const auth: any = requireWebSessionResponse(state, req);
  if (auth instanceof Response) return auth;
  const ws = currentWorkspace(state);
  if (!ws) return json({ ok: false, error: "no_active_workspace" }, { status: 503 });
  const q = parseSearchQueryInput(url.searchParams.get("q"));
  if (q instanceof Response) return q;
  const limit = searchLimitInput(url.searchParams.get("limit"));
  if (limit instanceof Response) return limit;
  const assigneeName = url.searchParams.get("assignee") ?? url.searchParams.get("assignedTo") ?? "";
  const assignee = assigneeName ? resolveRoleAddress(ws.db, assigneeName) : null;
  if (assigneeName && !assignee) return json({ ok: false, error: `Unknown role: ${assigneeName}` }, { status: 404 });
  const status = parseOptionalKanbanStatusInput(url.searchParams.get("status"));
  if (status instanceof Response) return status;
  const results = searchKanbanTasks(ws.db, { q, status, assignedRoleId: assignee?.id ?? null, includeArchived: booleanParam(url.searchParams.get("includeArchived") ?? url.searchParams.get("include_archived")), limit });
  return json(searchEnvelope(results, limit));
}

async function searchKanbanEpicsWebEndpoint(state: DaemonState, req: Request, url: URL): Promise<Response> {
  const auth: any = requireWebSessionResponse(state, req);
  if (auth instanceof Response) return auth;
  const ws = currentWorkspace(state);
  if (!ws) return json({ ok: false, error: "no_active_workspace" }, { status: 503 });
  const q = parseSearchQueryInput(url.searchParams.get("q"));
  if (q instanceof Response) return q;
  const limit = searchLimitInput(url.searchParams.get("limit"));
  if (limit instanceof Response) return limit;
  const assigneeName = url.searchParams.get("assignee") ?? url.searchParams.get("assignedTo") ?? "";
  const assignee = assigneeName ? resolveRoleAddress(ws.db, assigneeName) : null;
  if (assigneeName && !assignee) return json({ ok: false, error: `Unknown role: ${assigneeName}` }, { status: 404 });
  const status = parseOptionalKanbanStatusInput(url.searchParams.get("status"));
  if (status instanceof Response) return status;
  const results = searchKanbanEpics(ws.db, { q, status, assignedRoleId: assignee?.id ?? null, includeArchived: booleanParam(url.searchParams.get("includeArchived") ?? url.searchParams.get("include_archived")), limit });
  return json(searchEnvelope(results, limit));
}

async function listFleetKanbanTasks(state: DaemonState, ws: WorkspaceState, url: URL): Promise<Response> {
  const db = ws.db;
  try {
    const options = kanbanListOptionsFromInput(db, {
      includeArchived: url.searchParams.get("includeArchived") ?? url.searchParams.get("include_archived"),
      status: url.searchParams.get("status"),
      assignedTo: url.searchParams.get("assignedTo") ?? url.searchParams.get("assignee"),
      createdBy: url.searchParams.get("createdBy") ?? url.searchParams.get("creator"),
      priority: url.searchParams.get("priority"),
      search: url.searchParams.get("search") ?? url.searchParams.get("q"),
      limit: url.searchParams.get("limit"),
      epicId: url.searchParams.get("epicId") ?? url.searchParams.get("epic_id"),
    });
    if (options instanceof Response) return options;
    return json({ ok: true, tasks: listKanbanTasks(db, options), kanban: getKanbanSettings(db) });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

async function readFleetKanbanTask(state: DaemonState, ws: WorkspaceState, taskId: string): Promise<Response> {
  const db = ws.db;
  const detail = kanbanTaskDetail(db, taskId);
  if (!detail) return json({ ok: false, error: "kanban task was not found" }, { status: 404 });
  return json({ ok: true, ...detail });
}

async function listFleetKanbanEpics(state: DaemonState, ws: WorkspaceState, url: URL): Promise<Response> {
  const db = ws.db;
  try {
    const options = kanbanEpicListOptionsFromInput(db, {
      includeArchived: url.searchParams.get("includeArchived") ?? url.searchParams.get("include_archived"),
      status: url.searchParams.get("status"),
      assignedTo: url.searchParams.get("assignedTo") ?? url.searchParams.get("assignee"),
      createdBy: url.searchParams.get("createdBy") ?? url.searchParams.get("creator"),
      priority: url.searchParams.get("priority"),
      search: url.searchParams.get("search") ?? url.searchParams.get("q"),
      limit: url.searchParams.get("limit"),
    });
    if (options instanceof Response) return options;
    const epics = listKanbanEpics(db, options);
    const childrenByEpicId = new Map<number, KanbanTaskRow[]>();
    for (const epic of epics) childrenByEpicId.set(epic.id, listKanbanEpicChildren(db, epic.id, { includeArchived: options.includeArchived }));
    const includeUnclassifiedRaw = url.searchParams.get("includeUnclassified") ?? url.searchParams.get("include_unclassified");
    const includeUnclassified = includeUnclassifiedRaw === null ? true : booleanParam(includeUnclassifiedRaw);
    const unclassified = includeUnclassified ? listUnclassifiedKanbanTasks(db, { includeArchived: options.includeArchived }) : [];
    const children: Record<string, KanbanTaskRow[]> = {};
    for (const epic of epics) children[epic.display_id] = childrenByEpicId.get(epic.id) ?? [];
    const dependencies = listAllKanbanDependencies(db).map((row) => ({
      task_display_id: row.task_display_id,
      depends_on_display_id: row.depends_on_display_id,
      depends_on_title: row.depends_on_title,
      depends_on_status: row.depends_on_status,
    }));
    return json({ ok: true, epics, children, unclassified, dependencies, kanban: getKanbanSettings(db) });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

async function readFleetKanbanEpic(state: DaemonState, ws: WorkspaceState, epicId: string): Promise<Response> {
  const db = ws.db;
  const detail = kanbanEpicDetail(db, epicId);
  if (!detail) return json({ ok: false, error: "kanban epic was not found" }, { status: 404 });
  return json({ ok: true, ...detail });
}

function kanbanTaskDetail(db: Database, taskId: string | number): { task: KanbanTaskRow; comments: unknown[]; dependencies: unknown[]; dependedBy: unknown[]; activity: unknown[] } | null {
  const task = getKanbanTask(db, taskId);
  if (!task) return null;
  return {
    task,
    comments: listKanbanComments(db, task.id),
    dependencies: listKanbanDependencies(db, task.id),
    dependedBy: listKanbanDependedBy(db, task.id),
    activity: listKanbanActivity(db, task.id),
  };
}

function kanbanListOptionsFromInput(db: Database, input: Record<string, unknown>): { includeArchived?: boolean; status?: KanbanStatus; assignedRoleId?: string; createdByRoleId?: string; priority?: KanbanPriority; search?: string; limit?: number; epicId?: string | number | null } | Response {
  const assignedTo = String(input.assignedTo ?? input.assigned_to ?? "").trim();
  const createdBy = String(input.createdBy ?? input.created_by ?? "").trim();
  const assignedRole = assignedTo ? resolveRoleAddress(db, assignedTo) : null;
  const createdByRole = createdBy ? resolveRoleAddress(db, createdBy) : null;
  if (assignedTo && !assignedRole) return json({ ok: false, error: `Unknown role: ${assignedTo}` }, { status: 404 });
  if (createdBy && !createdByRole) return json({ ok: false, error: `Unknown role: ${createdBy}` }, { status: 404 });
  const epicIdRaw = input.epicId ?? input.epic_id;
  const epicId = epicIdRaw === undefined ? undefined
    : epicIdRaw === null ? null
    : typeof epicIdRaw === "number" ? epicIdRaw
    : String(epicIdRaw).trim() === "" ? undefined
    : String(epicIdRaw).trim();
  return {
    includeArchived: booleanParam(input.includeArchived ?? input.include_archived),
    status: input.status ? input.status as KanbanStatus : undefined,
    assignedRoleId: assignedRole?.id,
    createdByRoleId: createdByRole?.id,
    priority: input.priority ? input.priority as KanbanPriority : undefined,
    search: String(input.search ?? input.q ?? "").trim() || undefined,
    limit: input.limit == null || input.limit === "" ? undefined : Number(input.limit),
    epicId,
  };
}

function booleanParam(value: unknown): boolean {
  return value === true || value === "true" || value === "1" || value === 1;
}

function optionalStringInput(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return String(value);
}

function optionalNumberInput(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return Number(value);
}

function pickInput(body: Record<string, unknown>, primary: string, fallback: string): unknown {
  if (Object.prototype.hasOwnProperty.call(body, primary)) return body[primary];
  if (Object.prototype.hasOwnProperty.call(body, fallback)) return body[fallback];
  return undefined;
}

const KANBAN_ASSIGNEE_PROGRESS_FROM = new Set<KanbanStatus>(["Queued", "In Progress", "Blocked", "Review"]);
const KANBAN_ASSIGNEE_PROGRESS_TO = new Set<KanbanStatus>(["In Progress", "Blocked", "Review"]);
const KANBAN_STATUS_VALUES = new Set<KanbanStatus>(["Backlog", "Queued", "In Progress", "Blocked", "Review", "Completed"]);

/**
 * EP-022 / WA-096 — kanban-Star fallback removed.
 *
 * Phase 4 preserved a soft-mode legacy auth layer (`if (!mainRole) 409`,
 * `if (role !== mainRole) 403`) on every kanban write surface. Now that
 * per-workspace RBAC mode (T3 / WA-094) routes every dispatch through
 * `checkActionGrants`, the soft branch was the only remaining caller of
 * those Star-auth helpers, and it duplicated `role_grants`-based
 * authorization. The bare `*Policy` helpers without business rules
 * (Write / Update / EpicWrite) are deleted wholesale; the helpers that
 * additionally enforced narrow-scope source-state invariants (Status,
 * EpicStatus, EpicCloseRequest) are renamed to `*Invariant` with the
 * Star auth path stripped — they keep the enforce-mode invariant body
 * (a request with `update_task_status@own_assignment` may NOT move a
 * task out of the Queued/active source-state window even after the
 * RBAC dispatcher allows the call). Off mode short-circuits the
 * invariants too; soft is no longer a separate path.
 *
 * Star messaging topology (`peer_rules`, `getPolicyMode === 'star'` for
 * who-can-DM-whom routing) is INDEPENDENT of RBAC and untouched here.
 */

function requireKanbanStatusUpdateInvariant(db: Database, context: AgentContext, task: KanbanTaskRow, nextStatus: KanbanStatus, mode: RbacMode): Response | null {
  if (mode !== "enforce") return null;
  // Business-rule invariant (advisor msg 373): a narrow-scope grant
  // (`update_task_status@own_assignment`) does NOT permit transitions
  // outside the Queued/active → In Progress/Blocked/Review window.
  // An any-scope (NULL) grant — PM-class — allows every transition.
  const grants = getEffectiveGrants(db, context.role.id);
  const hasAnyScope = grants.kanban_actions.some((g) => g.value === "update_task_status" && g.scope === null);
  if (hasAnyScope) return null;
  if (isAssignedAgentProgressStatus(context, task, nextStatus)) return null;
  return json({ ok: false, error: "Narrow-scope kanban_action:update_task_status grant only permits assignee transitions from Queued/active states to In Progress, Blocked, or Review" }, { status: 403 });
}

function isAssignedAgentProgressStatus(context: AgentContext, task: KanbanTaskRow, nextStatus: KanbanStatus): boolean {
  if (context.role.id !== task.assigned_role_id) return false;
  return KANBAN_ASSIGNEE_PROGRESS_FROM.has(task.status) && KANBAN_ASSIGNEE_PROGRESS_TO.has(nextStatus);
}

function parseKanbanStatusInput(value: unknown): KanbanStatus | Response {
  if (typeof value === "string" && KANBAN_STATUS_VALUES.has(value as KanbanStatus)) return value as KanbanStatus;
  return json({ ok: false, error: "kanban status must be Backlog, Queued, In Progress, Blocked, Review, or Completed" }, { status: 400 });
}

function kanbanStatusNotificationEvent(status: KanbanStatus): string | null {
  return status === "Queued" || status === "Blocked" || status === "Review" || status === "Completed" ? `status_${status.toLowerCase().replace(/\s+/g, "_")}` : null;
}

function notifyKanbanEvent(db: Database, task: KanbanTaskRow, actorRoleId: string, eventType: string, body: string): KanbanNotificationRow[] {
  const recipients = [...new Set([task.assigned_role_id, task.created_by_role_id])].filter((roleId) => roleId && roleId !== actorRoleId);
  return recipients.map((toRoleId) => insertKanbanNotification(db, { taskId: task.id, toRoleId, actorRoleId, eventType, body }));
}

async function pushKanbanNotifications(state: DaemonState, ws: WorkspaceState, notifications: KanbanNotificationRow[], source: "agent" | "web"): Promise<Array<{ role: string; push: Awaited<ReturnType<typeof pushInboxNudge>> }>> {
  if (notifications.length === 0) return [];
  const runners = await discoverAndReconcileRunners(state, ws);
  // EP-DEC-RUN WA-006 (advisor msg #24): key the runner lookup by
  // display_id, not bare role.name. Resolve recipient role.id → role row
  // → display_id so a kanban notification routes to the recipient runner
  // even when another repo holds a same-bare-name role.
  const runnerByDisplayId = new Map(runners.filter((runner) => runner.reachable).map((runner) => [runner.display_id, runner]));
  const pushes = [];
  for (const notification of notifications) {
    const role = daoGetRoleById(ws.db, notification.to_role_id);
    if (!role) continue;
    const runner = runnerByDisplayId.get(role.display_id);
    if (!runner) continue;
    pushes.push({ role: role.display_id, push: await pushInboxNudge(state, ws, runner, { messageId: notification.id, fromRole: notification.actor_role_name ?? "kanban", source }) });
  }
  return pushes;
}

async function handleAgentKanbanApi(state: DaemonState, ws: WorkspaceState, action: string, body: Record<string, unknown>, context: AgentContext): Promise<Response> {
  const db = ws.db;
  try {
    if (action === "list-kanban-tasks") {
      const options = kanbanListOptionsFromInput(db, body);
      if (options instanceof Response) return options;
      return json({ ok: true, tasks: listKanbanTasks(db, options), kanban: getKanbanSettings(db) });
    }
    if (action === "read-kanban-task") {
      const taskId = String(body.taskId ?? body.task_id ?? body.id ?? "").trim();
      if (!taskId) return json({ ok: false, error: "taskId is required" }, { status: 400 });
      const detail = kanbanTaskDetail(db, taskId);
      if (!detail) return json({ ok: false, error: "kanban task was not found" }, { status: 404 });
      return json({ ok: true, ...detail });
    }

    if (action === "comment-kanban-task") {
      const taskId = String(body.taskId ?? body.task_id ?? body.id ?? "").trim();
      if (!taskId) return json({ ok: false, error: "taskId is required" }, { status: 400 });
      const comment = addKanbanComment(db, taskId, { roleId: context.role.id, sessionId: context.sessionId, type: String(body.type ?? "progress") as KanbanCommentType, body: String(body.body ?? "") });
      const task = getKanbanTask(db, comment.task_id)!;
      const notifications = comment.type === "blocker" ? notifyKanbanEvent(db, task, context.role.id, "blocker_comment", `${task.display_id} has a blocker comment from ${context.role.name}: ${task.title}`) : [];
      const pushes = await pushKanbanNotifications(state, ws, notifications, "agent");
      state.logger.info("kanban.task.commented", { role: context.role.name, taskId: task.display_id, type: comment.type, notifications: notifications.length });
      return json({ ok: true, comment, task, notifications, pushes });
    }

    if (action === "create-kanban-task") {
      // EP-022 / WA-096: legacy kanban-Star auth fallback removed; the
      // RBAC dispatcher (`checkActionGrants`) is the only auth gate.
      const assignedTo = String(body.assignedTo ?? body.assigned_to ?? body.assignee ?? "").trim();
      if (!assignedTo) return json({ ok: false, error: "assignedTo is required" }, { status: 400 });
      const assignedRole = resolveRoleAddress(db, assignedTo);
      if (!assignedRole) return json({ ok: false, error: `Unknown role: ${assignedTo}` }, { status: 404 });
      const epicIdRaw = pickInput(body, "epicId", "epic_id");
      const epicId = epicIdRaw === undefined ? undefined
        : epicIdRaw === null ? null
        : typeof epicIdRaw === "number" ? epicIdRaw
        : String(epicIdRaw);
      const task = createKanbanTask(db, {
        title: String(body.title ?? ""),
        details: String(body.details ?? ""),
        createdByRoleId: context.role.id,
        assignedRoleId: assignedRole.id,
        status: body.status as KanbanStatus | undefined,
        priority: body.priority as KanbanPriority | undefined,
        effort: body.effort as KanbanEffort | undefined,
        githubUrl: optionalStringInput(pickInput(body, "githubUrl", "github_url")),
        githubNumber: optionalNumberInput(pickInput(body, "githubNumber", "github_number")),
        githubTitle: optionalStringInput(pickInput(body, "githubTitle", "github_title")),
        ...(epicId === undefined ? {} : { epicId }),
      });
      const notifications = notifyKanbanEvent(db, task, context.role.id, "assignment", `${task.display_id} was assigned to ${task.assigned_role_name}: ${task.title}`);
      const pushes = await pushKanbanNotifications(state, ws, notifications, "agent");
      state.logger.info("kanban.task.created", { role: context.role.name, taskId: task.display_id, assignedTo: task.assigned_role_name, notifications: notifications.length });
      return json({ ok: true, task, notifications, pushes });
    }

    if (action === "update-kanban-task") {
      const taskId = String(body.taskId ?? body.task_id ?? body.id ?? "").trim();
      if (!taskId) return json({ ok: false, error: "taskId is required" }, { status: 400 });
      const before = getKanbanTask(db, taskId);
      if (!before) return json({ ok: false, error: "kanban task was not found" }, { status: 404 });
      // EP-022 / WA-096: legacy kanban-Star auth fallback removed; RBAC
      // dispatcher gates the write.
      const beforeDeps = listKanbanDependencies(db, before.id).map((dependency) => dependency.depends_on_display_id).join("\0");
      const assignedTo = body.assignedTo ?? body.assigned_to ?? body.assignee;
      const assignedRole = assignedTo == null || assignedTo === "" ? null : resolveRoleAddress(db, String(assignedTo));
      if (assignedTo != null && assignedTo !== "" && !assignedRole) return json({ ok: false, error: `Unknown role: ${assignedTo}` }, { status: 404 });
      const dependsOn = body.dependsOnTaskIds ?? body.depends_on_task_ids ?? body.dependsOn ?? body.depends_on;
      const epicIdProvided = Object.prototype.hasOwnProperty.call(body, "epicId") || Object.prototype.hasOwnProperty.call(body, "epic_id");
      const epicIdRaw = epicIdProvided ? pickInput(body, "epicId", "epic_id") : undefined;
      const epicIdInput = !epicIdProvided ? undefined
        : epicIdRaw === null ? null
        : typeof epicIdRaw === "number" ? epicIdRaw
        : String(epicIdRaw);
      const task = updateKanbanTask(db, before.id, {
        actorRoleId: context.role.id,
        actorSessionId: context.sessionId,
        ...(Object.prototype.hasOwnProperty.call(body, "title") ? { title: String(body.title ?? "") } : {}),
        ...(Object.prototype.hasOwnProperty.call(body, "details") ? { details: String(body.details ?? "") } : {}),
        ...(Object.prototype.hasOwnProperty.call(body, "status") ? { status: body.status as KanbanStatus } : {}),
        ...(Object.prototype.hasOwnProperty.call(body, "priority") ? { priority: body.priority as KanbanPriority } : {}),
        ...(Object.prototype.hasOwnProperty.call(body, "effort") ? { effort: body.effort as KanbanEffort } : {}),
        ...(assignedRole ? { assignedRoleId: assignedRole.id } : {}),
        ...(Object.prototype.hasOwnProperty.call(body, "githubUrl") || Object.prototype.hasOwnProperty.call(body, "github_url") ? { githubUrl: optionalStringInput(pickInput(body, "githubUrl", "github_url")) } : {}),
        ...(Object.prototype.hasOwnProperty.call(body, "githubNumber") || Object.prototype.hasOwnProperty.call(body, "github_number") ? { githubNumber: optionalNumberInput(pickInput(body, "githubNumber", "github_number")) } : {}),
        ...(Object.prototype.hasOwnProperty.call(body, "githubTitle") || Object.prototype.hasOwnProperty.call(body, "github_title") ? { githubTitle: optionalStringInput(pickInput(body, "githubTitle", "github_title")) } : {}),
        ...(Array.isArray(dependsOn) ? { dependsOnTaskIds: dependsOn.map((id) => String(id)) } : {}),
        ...(epicIdProvided ? { epicId: epicIdInput as string | number | null } : {}),
      });
      const afterDeps = listKanbanDependencies(db, task.id).map((dependency) => dependency.depends_on_display_id).join("\0");
      const notifications: KanbanNotificationRow[] = [];
      if (before.assigned_role_id !== task.assigned_role_id) notifications.push(...notifyKanbanEvent(db, task, context.role.id, "reassignment", `${task.display_id} was reassigned to ${task.assigned_role_name}: ${task.title}`));
      const statusEvent = kanbanStatusNotificationEvent(task.status);
      if (before.status !== task.status && statusEvent) notifications.push(...notifyKanbanEvent(db, task, context.role.id, statusEvent, `${task.display_id} moved to ${task.status}: ${task.title}`));
      if (beforeDeps !== afterDeps) notifications.push(...notifyKanbanEvent(db, task, context.role.id, "dependency_change", `${task.display_id} dependencies changed: ${task.title}`));
      const pushes = await pushKanbanNotifications(state, ws, notifications, "agent");
      state.logger.info("kanban.task.updated", { role: context.role.name, taskId: task.display_id, notifications: notifications.length });
      return json({ ok: true, task, notifications, pushes });
    }

    if (action === "update-kanban-task-status") {
      const taskId = String(body.taskId ?? body.task_id ?? body.id ?? "").trim();
      if (!taskId) return json({ ok: false, error: "taskId is required" }, { status: 400 });
      const status = parseKanbanStatusInput(body.status);
      if (status instanceof Response) return status;
      const before = getKanbanTask(db, taskId);
      if (!before) return json({ ok: false, error: "kanban task was not found" }, { status: 404 });
      const writeDenied = requireKanbanStatusUpdateInvariant(db, context, before, status, effectiveRbacMode(ws.rbacMode, state.rbacModeCeiling));
      if (writeDenied) return writeDenied;
      const task = updateKanbanTask(db, before.id, {
        actorRoleId: context.role.id,
        actorSessionId: context.sessionId,
        status,
      });
      const statusEvent = kanbanStatusNotificationEvent(task.status);
      const notifications = before.status !== task.status && statusEvent ? notifyKanbanEvent(db, task, context.role.id, statusEvent, `${task.display_id} moved to ${task.status}: ${task.title}`) : [];
      const pushes = await pushKanbanNotifications(state, ws, notifications, "agent");
      state.logger.info("kanban.task.status_updated", { role: context.role.name, taskId: task.display_id, status: task.status, notifications: notifications.length });
      return json({ ok: true, task, notifications, pushes });
    }

    if (action === "archive-kanban-task") {
      // EP-022 / WA-096: legacy kanban-Star auth fallback removed.
      const taskId = String(body.taskId ?? body.task_id ?? body.id ?? "").trim();
      if (!taskId) return json({ ok: false, error: "taskId is required" }, { status: 400 });
      const task = archiveKanbanTask(db, taskId, context.role.id, context.sessionId);
      state.logger.info("kanban.task.archived", { role: context.role.name, taskId: task.display_id });
      return json({ ok: true, task, notifications: [] });
    }
    return json({ ok: false, error: "not found" }, { status: 404 });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

function kanbanEpicListOptionsFromInput(db: Database, input: Record<string, unknown>): { includeArchived?: boolean; status?: KanbanStatus; assignedRoleId?: string; createdByRoleId?: string; priority?: KanbanPriority; search?: string; limit?: number } | Response {
  const assignedTo = String(input.assignedTo ?? input.assigned_to ?? "").trim();
  const createdBy = String(input.createdBy ?? input.created_by ?? "").trim();
  const assignedRole = assignedTo ? resolveRoleAddress(db, assignedTo) : null;
  const createdByRole = createdBy ? resolveRoleAddress(db, createdBy) : null;
  if (assignedTo && !assignedRole) return json({ ok: false, error: `Unknown role: ${assignedTo}` }, { status: 404 });
  if (createdBy && !createdByRole) return json({ ok: false, error: `Unknown role: ${createdBy}` }, { status: 404 });
  return {
    includeArchived: booleanParam(input.includeArchived ?? input.include_archived),
    status: input.status ? input.status as KanbanStatus : undefined,
    assignedRoleId: assignedRole?.id,
    createdByRoleId: createdByRole?.id,
    priority: input.priority ? input.priority as KanbanPriority : undefined,
    search: String(input.search ?? input.q ?? "").trim() || undefined,
    limit: input.limit == null || input.limit === "" ? undefined : Number(input.limit),
  };
}

function kanbanEpicDetail(db: Database, epicId: string | number): { epic: KanbanEpicRow; comments: unknown[]; activity: unknown[]; children: KanbanTaskRow[] } | null {
  const epic = getKanbanEpic(db, epicId);
  if (!epic) return null;
  return {
    epic,
    comments: listKanbanEpicComments(db, epic.id),
    activity: listKanbanEpicActivity(db, epic.id),
    children: listKanbanEpicChildren(db, epic.id),
  };
}

async function pushKanbanEpicNotifications(state: DaemonState, ws: WorkspaceState, notifications: KanbanEpicNotificationRow[], source: "agent" | "web"): Promise<Array<{ role: string; push: Awaited<ReturnType<typeof pushInboxNudge>> }>> {
  if (notifications.length === 0) return [];
  const runners = await discoverAndReconcileRunners(state, ws);
  // EP-DEC-RUN WA-006 (advisor msg #26): mirror pushKanbanNotifications.
  // Resolve recipient via role.id → display_id → runner; never bare-name.
  const runnerByDisplayId = new Map(runners.filter((runner) => runner.reachable).map((runner) => [runner.display_id, runner]));
  const pushes = [];
  for (const notification of notifications) {
    const role = daoGetRoleById(ws.db, notification.to_role_id);
    if (!role) continue;
    const runner = runnerByDisplayId.get(role.display_id);
    if (!runner) continue;
    pushes.push({ role: role.display_id, push: await pushInboxNudge(state, ws, runner, { messageId: notification.id, fromRole: notification.actor_role_name ?? "kanban", source }) });
  }
  return pushes;
}

function kanbanEpicStatusNotificationEvent(status: KanbanStatus): string | null {
  if (status === "Backlog") return "epic_status_backlog";
  if (status === "Queued") return "epic_status_queued";
  if (status === "In Progress") return "epic_status_in_progress";
  if (status === "Blocked") return "epic_status_blocked";
  if (status === "Review") return "epic_status_review";
  if (status === "Completed") return "epic_status_completed";
  return null;
}

async function handleAgentKanbanEpicApi(state: DaemonState, ws: WorkspaceState, action: string, body: Record<string, unknown>, context: AgentContext): Promise<Response> {
  const db = ws.db;
  try {
    if (action === "list-kanban-epics") {
      const options = kanbanEpicListOptionsFromInput(db, body);
      if (options instanceof Response) return options;
      return json({ ok: true, epics: listKanbanEpics(db, options), kanban: getKanbanSettings(db) });
    }
    if (action === "read-kanban-epic") {
      const epicId = String(body.epicId ?? body.epic_id ?? body.id ?? "").trim();
      if (!epicId) return json({ ok: false, error: "epicId is required" }, { status: 400 });
      const detail = kanbanEpicDetail(db, epicId);
      if (!detail) return json({ ok: false, error: "kanban epic was not found" }, { status: 404 });
      return json({ ok: true, ...detail });
    }
    if (action === "comment-kanban-epic") {
      const epicId = String(body.epicId ?? body.epic_id ?? body.id ?? "").trim();
      if (!epicId) return json({ ok: false, error: "epicId is required" }, { status: 400 });
      const epic = getKanbanEpic(db, epicId);
      if (!epic) return json({ ok: false, error: "kanban epic was not found" }, { status: 404 });
      const comment = addKanbanEpicComment(db, epic.id, { roleId: context.role.id, sessionId: context.sessionId, type: String(body.type ?? "progress") as KanbanCommentType, body: String(body.body ?? "") });
      const notifications = comment.type === "blocker"
        ? notifyKanbanEpicEvent(db, epic, context.role.id, "epic_blocker_comment", `${epic.display_id} has a blocker comment from ${context.role.name}: ${epic.title}`, { commentId: comment.id })
        : [];
      const pushes = await pushKanbanEpicNotifications(state, ws, notifications, "agent");
      state.logger.info("kanban.epic.commented", { role: context.role.name, epicId: epic.display_id, type: comment.type, notifications: notifications.length });
      return json({ ok: true, comment, epic, notifications, pushes });
    }
    if (action === "create-kanban-epic") {
      // EP-022 / WA-096: legacy kanban-Star auth fallback removed.
      const assignedTo = String(body.assignedTo ?? body.assigned_to ?? body.assignee ?? "").trim();
      if (!assignedTo) return json({ ok: false, error: "assignedTo is required" }, { status: 400 });
      const assignedRole = resolveRoleAddress(db, assignedTo);
      if (!assignedRole) return json({ ok: false, error: `Unknown role: ${assignedTo}` }, { status: 404 });
      if (body.status === "Completed") return json({ ok: false, error: "kanban epic cannot be created with status='Completed'; the Completed status is set only through the close-approval workflow (request_kanban_epic_close, lands in WA-012)" }, { status: 400 });
      const epic = createKanbanEpic(db, {
        title: String(body.title ?? ""),
        details: String(body.details ?? ""),
        createdByRoleId: context.role.id,
        assignedRoleId: assignedRole.id,
        status: body.status as KanbanStatus | undefined,
        priority: body.priority as KanbanPriority | undefined,
        effort: body.effort as KanbanEffort | undefined,
        githubUrl: optionalStringInput(pickInput(body, "githubUrl", "github_url")),
        githubNumber: optionalNumberInput(pickInput(body, "githubNumber", "github_number")),
        githubTitle: optionalStringInput(pickInput(body, "githubTitle", "github_title")),
      });
      const notifications: KanbanEpicNotificationRow[] = [];
      notifications.push(...notifyKanbanEpicEvent(db, epic, context.role.id, "epic_created", `${epic.display_id} created by ${context.role.name}: ${epic.title}`));
      if (epic.assigned_role_id !== context.role.id) {
        notifications.push(...notifyKanbanEpicEvent(db, epic, context.role.id, "epic_assigned", `${epic.display_id} was assigned to ${epic.assigned_role_name}: ${epic.title}`));
      }
      const pushes = await pushKanbanEpicNotifications(state, ws, notifications, "agent");
      state.logger.info("kanban.epic.created", { role: context.role.name, epicId: epic.display_id, assignedTo: epic.assigned_role_name, notifications: notifications.length });
      return json({ ok: true, epic, notifications, pushes });
    }
    if (action === "update-kanban-epic") {
      const epicId = String(body.epicId ?? body.epic_id ?? body.id ?? "").trim();
      if (!epicId) return json({ ok: false, error: "epicId is required" }, { status: 400 });
      const before = getKanbanEpic(db, epicId);
      if (!before) return json({ ok: false, error: "kanban epic was not found" }, { status: 404 });
      // EP-022 / WA-096: legacy kanban-Star auth fallback removed.
      if (before.close_approval_status === "pending") {
        return json({ ok: false, error: `kanban epic ${before.display_id} has a pending close-approval; broad updates are blocked. Cancel close-approval first via cancel_kanban_epic_close.` }, { status: 409 });
      }
      if (body.status === "Completed") return json({ ok: false, error: "kanban epic broad update cannot set status='Completed'; route through update_kanban_epic_status / request_kanban_epic_close (lands in WA-012) for the close-approval workflow" }, { status: 400 });
      const assignedTo = body.assignedTo ?? body.assigned_to ?? body.assignee;
      const assignedRole = assignedTo == null || assignedTo === "" ? null : resolveRoleAddress(db, String(assignedTo));
      if (assignedTo != null && assignedTo !== "" && !assignedRole) return json({ ok: false, error: `Unknown role: ${assignedTo}` }, { status: 404 });
      const epic = updateKanbanEpic(db, before.id, {
        actorRoleId: context.role.id,
        actorSessionId: context.sessionId,
        ...(Object.prototype.hasOwnProperty.call(body, "title") ? { title: String(body.title ?? "") } : {}),
        ...(Object.prototype.hasOwnProperty.call(body, "details") ? { details: String(body.details ?? "") } : {}),
        ...(Object.prototype.hasOwnProperty.call(body, "status") ? { status: body.status as KanbanStatus } : {}),
        ...(Object.prototype.hasOwnProperty.call(body, "priority") ? { priority: body.priority as KanbanPriority } : {}),
        ...(Object.prototype.hasOwnProperty.call(body, "effort") ? { effort: body.effort as KanbanEffort } : {}),
        ...(assignedRole ? { assignedRoleId: assignedRole.id } : {}),
        ...(Object.prototype.hasOwnProperty.call(body, "githubUrl") || Object.prototype.hasOwnProperty.call(body, "github_url") ? { githubUrl: optionalStringInput(pickInput(body, "githubUrl", "github_url")) } : {}),
        ...(Object.prototype.hasOwnProperty.call(body, "githubNumber") || Object.prototype.hasOwnProperty.call(body, "github_number") ? { githubNumber: optionalNumberInput(pickInput(body, "githubNumber", "github_number")) } : {}),
        ...(Object.prototype.hasOwnProperty.call(body, "githubTitle") || Object.prototype.hasOwnProperty.call(body, "github_title") ? { githubTitle: optionalStringInput(pickInput(body, "githubTitle", "github_title")) } : {}),
      });
      const notifications: KanbanEpicNotificationRow[] = [];
      if (before.assigned_role_id !== epic.assigned_role_id) {
        notifications.push(...notifyKanbanEpicEvent(db, epic, context.role.id, "epic_reassigned", `${epic.display_id} reassigned to ${epic.assigned_role_name}: ${epic.title}`));
      }
      const statusEvent = before.status !== epic.status ? kanbanEpicStatusNotificationEvent(epic.status) : null;
      if (statusEvent) {
        notifications.push(...notifyKanbanEpicEvent(db, epic, context.role.id, statusEvent, `${epic.display_id} moved to ${epic.status}: ${epic.title}`));
      }
      const pushes = await pushKanbanEpicNotifications(state, ws, notifications, "agent");
      state.logger.info("kanban.epic.updated", { role: context.role.name, epicId: epic.display_id, notifications: notifications.length });
      return json({ ok: true, epic, notifications, pushes });
    }
    if (action === "archive-kanban-epic") {
      // EP-022 / WA-096: legacy kanban-Star auth fallback removed.
      const epicId = String(body.epicId ?? body.epic_id ?? body.id ?? "").trim();
      if (!epicId) return json({ ok: false, error: "epicId is required" }, { status: 400 });
      try {
        const epic = archiveKanbanEpic(db, epicId, context.role.id, context.sessionId);
        state.logger.info("kanban.epic.archived", { role: context.role.name, epicId: epic.display_id });
        return json({ ok: true, epic, notifications: [] });
      } catch (e) {
        const err = e as Error & { code?: string; childDisplayIds?: string[] };
        if (err?.code === "EPIC_HAS_CHILDREN") {
          return json({ ok: false, error: err.message, childDisplayIds: err.childDisplayIds ?? [] }, { status: 409 });
        }
        throw e;
      }
    }
    if (action === "update-kanban-epic-status") {
      const epicId = String(body.epicId ?? body.epic_id ?? body.id ?? "").trim();
      if (!epicId) return json({ ok: false, error: "epicId is required" }, { status: 400 });
      const status = parseKanbanStatusInput(body.status);
      if (status instanceof Response) return status;
      const before = getKanbanEpic(db, epicId);
      if (!before) return json({ ok: false, error: "kanban epic was not found" }, { status: 404 });
      if (before.close_approval_status === "pending") {
        return json({ ok: false, error: `kanban epic ${before.display_id} has a pending close-approval; status moves are blocked. Cancel close-approval first via cancel_kanban_epic_close, or wait for the human web session to approve.` }, { status: 409 });
      }
      const policyDenied = requireKanbanEpicStatusUpdateInvariant(db, context, before, status, effectiveRbacMode(ws.rbacMode, state.rbacModeCeiling));
      if (policyDenied) return policyDenied;
      if (status === "Completed") return await executeKanbanEpicCloseRequest(state, ws, context, before);
      const epic = setKanbanEpicStatus(db, before.id, status, context.role.id, context.sessionId);
      const eventType = kanbanEpicStatusNotificationEvent(status);
      const notifications = eventType ? notifyKanbanEpicEvent(db, epic, context.role.id, eventType, `${epic.display_id} moved to ${epic.status}: ${epic.title}`) : [];
      const pushes = await pushKanbanEpicNotifications(state, ws, notifications, "agent");
      state.logger.info("kanban.epic.status_updated", { role: context.role.name, epicId: epic.display_id, status: epic.status, notifications: notifications.length });
      return json({ ok: true, epic, notifications, pushes });
    }
    if (action === "request-kanban-epic-close") {
      const epicId = String(body.epicId ?? body.epic_id ?? body.id ?? "").trim();
      if (!epicId) return json({ ok: false, error: "epicId is required" }, { status: 400 });
      const before = getKanbanEpic(db, epicId);
      if (!before) return json({ ok: false, error: "kanban epic was not found" }, { status: 404 });
      if (before.close_approval_status === "pending") {
        return json({ ok: false, error: `kanban epic ${before.display_id} already has a pending close-approval` }, { status: 409 });
      }
      const policyDenied = requireKanbanEpicCloseRequestInvariant(db, context, before, effectiveRbacMode(ws.rbacMode, state.rbacModeCeiling));
      if (policyDenied) return policyDenied;
      return await executeKanbanEpicCloseRequest(state, ws, context, before);
    }
    // cancel reuses the close-policy helper but passes the cancel action
    // value so the any-scope bypass keys on the right grant kind.
    if (action === "cancel-kanban-epic-close") {
      const epicId = String(body.epicId ?? body.epic_id ?? body.id ?? "").trim();
      if (!epicId) return json({ ok: false, error: "epicId is required" }, { status: 400 });
      const before = getKanbanEpic(db, epicId);
      if (!before) return json({ ok: false, error: "kanban epic was not found" }, { status: 404 });
      const policyDenied = requireKanbanEpicCloseRequestInvariant(db, context, before, effectiveRbacMode(ws.rbacMode, state.rbacModeCeiling), "cancel_epic_close");
      if (policyDenied) return policyDenied;
      if (before.close_approval_status !== "pending") {
        return json({ ok: false, error: `kanban epic ${before.display_id} has no pending close-approval to cancel` }, { status: 409 });
      }
      const epic = clearKanbanEpicCloseApproval(db, before.id, context.role.id, context.sessionId);
      state.logger.info("kanban.epic.close_cancelled", { role: context.role.name, epicId: epic.display_id });
      return json({ ok: true, epic, notifications: [] });
    }
    return json({ ok: false, error: "not found" }, { status: 404 });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

function requireKanbanEpicStatusUpdateInvariant(db: Database, context: AgentContext, epic: KanbanEpicRow, nextStatus: KanbanStatus, mode: RbacMode): Response | null {
  if (mode !== "enforce") return null;
  // Business-rule invariant (advisor msg 373): narrow-scope grants only
  // allow assignee transitions from Queued/active source states.
  const grants = getEffectiveGrants(db, context.role.id);
  const hasAnyScope = grants.kanban_actions.some((g) => g.value === "update_epic_status" && g.scope === null);
  if (hasAnyScope) return null;
  if (context.role.id === epic.assigned_role_id && KANBAN_ASSIGNEE_PROGRESS_FROM.has(epic.status)) {
    if (KANBAN_ASSIGNEE_PROGRESS_TO.has(nextStatus)) return null;
    if (nextStatus === "Completed") return null;
  }
  return json({ ok: false, error: "Narrow-scope kanban_action:update_epic_status grant only permits assignee transitions from Queued/active states to In Progress, Blocked, Review, or Completed (close-approval workflow)" }, { status: 403 });
}

function requireKanbanEpicCloseRequestInvariant(db: Database, context: AgentContext, epic: KanbanEpicRow, mode: RbacMode, actionValue: "request_epic_close" | "cancel_epic_close" = "request_epic_close"): Response | null {
  if (mode !== "enforce") return null;
  // Business-rule invariant (advisor msg 373): close-approval may only
  // originate from Queued/active states. Any-scope grants bypass the
  // assignee constraint. The any-scope check uses the SAME action value
  // the dispatcher gated on (advisor msg 375): request and cancel are
  // distinct grants and a custom role may hold one without the other.
  const grants = getEffectiveGrants(db, context.role.id);
  const hasAnyScope = grants.kanban_actions.some((g) => g.value === actionValue && g.scope === null);
  if (hasAnyScope) return null;
  if (context.role.id === epic.assigned_role_id) {
    if (!KANBAN_ASSIGNEE_PROGRESS_FROM.has(epic.status)) {
      return json({ ok: false, error: `Kanban epic close-approval can only be requested by the assignee from an active source state (Queued, In Progress, Blocked, Review); ${epic.display_id} is currently ${epic.status}` }, { status: 403 });
    }
    return null;
  }
  return json({ ok: false, error: `Narrow-scope kanban_action:${actionValue} grant only permits the assignee to drive close-approval` }, { status: 403 });
}

async function executeKanbanEpicCloseRequest(state: DaemonState, ws: WorkspaceState, context: AgentContext, before: KanbanEpicRow): Promise<Response> {
  const db = ws.db;
  if (before.status === "Completed" && before.close_approval_status !== "pending") {
    return json({ ok: false, error: `kanban epic ${before.display_id} is already Completed` }, { status: 409 });
  }
  const openCount = countOpenKanbanEpicChildren(db, before.id);
  if (openCount === 0) {
    const epic = setKanbanEpicStatus(db, before.id, "Completed", context.role.id, context.sessionId);
    const notifications = notifyKanbanEpicEvent(db, epic, context.role.id, "epic_completed", `${epic.display_id} completed: ${epic.title}`);
    const pushes = await pushKanbanEpicNotifications(state, ws, notifications, "agent");
    state.logger.info("kanban.epic.completed", { role: context.role.name, epicId: epic.display_id, openChildren: 0 });
    return json({ ok: true, epic, notifications, pushes, closeApproval: { status: "approved", openChildren: 0 } });
  }
  const epic = setKanbanEpicCloseApprovalPending(db, before.id, context.role.id, context.sessionId);
  const openChildren = listOpenKanbanEpicChildren(db, epic.id);
  const childList = openChildren.map((row) => row.display_id).join(", ");
  const notifications = notifyKanbanEpicEvent(db, epic, context.role.id, "epic_close_pending_approval", `${epic.display_id} close requested by ${context.role.name} while ${openChildren.length} child issue(s) open: ${childList}`);
  const pushes = await pushKanbanEpicNotifications(state, ws, notifications, "agent");
  state.logger.info("kanban.epic.close_pending", { role: context.role.name, epicId: epic.display_id, openChildren: openChildren.length });
  return json({ ok: true, epic, notifications, pushes, closeApproval: { status: "pending", openChildren: openChildren.length, childDisplayIds: openChildren.map((row) => row.display_id) } });
}

async function handleHumanWebKanbanEpicCloseApprove(state: DaemonState, ws: WorkspaceState, displayId: string): Promise<Response> {
  const db = ws.db;
  const epic = getKanbanEpic(db, displayId);
  if (!epic) return json({ ok: false, error: "kanban epic was not found" }, { status: 404 });
  if (epic.close_approval_status !== "pending") {
    return json({ ok: false, error: `kanban epic ${epic.display_id} has no pending close-approval to approve` }, { status: 409 });
  }
  const mainRole = getMainAgent(db);
  const actorRoleId = mainRole?.id ?? epic.assigned_role_id;
  const updated = completeKanbanEpicWithApproval(db, epic.id, "human-web", actorRoleId, null);
  const approvalNotifs = notifyKanbanEpicEvent(db, updated, null, "epic_close_approved", `${updated.display_id} close approved by human-web`);
  const completionNotifs = notifyKanbanEpicEvent(db, updated, null, "epic_completed", `${updated.display_id} completed: ${updated.title}`);
  const notifications = [...approvalNotifs, ...completionNotifs];
  const pushes = await pushKanbanEpicNotifications(state, ws, notifications, "web");
  state.logger.info("kanban.epic.close_approved", { epicId: updated.display_id, approver: "human-web" });
  return json({ ok: true, epic: updated, notifications, pushes });
}

async function handleHumanWebKanbanEpicCloseCancel(state: DaemonState, ws: WorkspaceState, displayId: string): Promise<Response> {
  const db = ws.db;
  const epic = getKanbanEpic(db, displayId);
  if (!epic) return json({ ok: false, error: "kanban epic was not found" }, { status: 404 });
  if (epic.close_approval_status !== "pending") {
    return json({ ok: false, error: `kanban epic ${epic.display_id} has no pending close-approval to cancel` }, { status: 409 });
  }
  const mainRole = getMainAgent(db);
  const actorRoleId = mainRole?.id ?? epic.assigned_role_id;
  const updated = clearKanbanEpicCloseApproval(db, epic.id, actorRoleId, null);
  state.logger.info("kanban.epic.close_cancelled", { epicId: updated.display_id, source: "human-web" });
  return json({ ok: true, epic: updated, notifications: [] });
}

/**
 * Extract a coarse target reference from an agent-API request body for
 * the audit_log row's `target_kind` + `target_id` columns. We pick the
 * most specific identifier present without parsing — Phase 3 needs
 * this only for Audit-tab display ("which task did the call try to
 * touch?"). Returns undefined when no obvious target id is present.
 */
function extractGrantTarget(body: Record<string, unknown>, action?: string): { kind?: string; id?: string } | undefined {
  if (typeof body.taskId === "string") return { kind: "task", id: body.taskId };
  if (typeof body.epicId === "string") return { kind: "epic", id: body.epicId };
  if (typeof body.channel === "string") return { kind: "channel", id: body.channel };
  if (typeof body.toRole === "string") return { kind: "agent", id: body.toRole };
  if (typeof body.toAgent === "string") return { kind: "agent", id: body.toAgent };
  // Handlers accept `body.id` as an alias for taskId/epicId. Use the
  // action name to disambiguate which target kind the id refers to.
  if (typeof body.id === "string" && action) {
    if (action.includes("kanban-task")) return { kind: "task", id: body.id };
    if (action.includes("kanban-epic")) return { kind: "epic", id: body.id };
  }
  return undefined;
}

/**
 * Resolve actor↔target relation into a `dynamicScope` qualifier for
 * `checkActionGrants`. Looks up the target kanban row and compares its
 * assignee + creator to the calling agent. Returns:
 *   `own_assignment`  — actor IS the assignee
 *   `created_by_self` — actor IS the creator (and not assignee)
 *   `null`            — neither (actor needs `any` scope)
 *   `undefined`       — non-kanban action / target not addressable / row not found
 *
 * `null` vs `undefined` distinction matters: `null` means "the call
 * needs `any` scope explicitly", `undefined` means "scope-insensitive
 * (boolean-style match)". `checkActionGrants` reads `req.scope ===
 * undefined` as "any candidate satisfies"; `=== null` as "needs any
 * scope, narrower scope = has-close miss".
 */
function resolveDynamicScope(
  ws: WorkspaceState,
  action: string,
  body: Record<string, unknown>,
  agentId: string,
): string | null | undefined {
  const KANBAN_TASK_ACTIONS = new Set([
    "update-kanban-task",
    "update-kanban-task-status",
    "comment-kanban-task",
    "archive-kanban-task",
  ]);
  const KANBAN_EPIC_ACTIONS = new Set([
    "update-kanban-epic",
    "update-kanban-epic-status",
    "comment-kanban-epic",
    "archive-kanban-epic",
    "request-kanban-epic-close",
    "cancel-kanban-epic-close",
  ]);

  // The kanban handlers accept `body.id` as an alias for taskId/epicId
  // (see `comment-kanban-task` / `update-kanban-task` / epic actions in
  // handleAgentKanbanApi). Without `body.id` in this lookup, callers
  // using the alias slipped past dynamicScope resolution and got the
  // slice-4 scope-insensitive bypass. Per advisor blocker on slice 4.5
  // (msg 353).
  if (KANBAN_TASK_ACTIONS.has(action)) {
    const taskId = body.taskId ?? body.task_id ?? body.id;
    if (typeof taskId !== "string" && typeof taskId !== "number") return undefined;
    const row = getKanbanTask(ws.db, taskId);
    if (!row) return undefined;
    if (row.assigned_role_id === agentId) return "own_assignment";
    if (row.created_by_role_id === agentId) return "created_by_self";
    return null;
  }
  if (KANBAN_EPIC_ACTIONS.has(action)) {
    const epicId = body.epicId ?? body.epic_id ?? body.id;
    if (typeof epicId !== "string" && typeof epicId !== "number") return undefined;
    const row = getKanbanEpic(ws.db, epicId);
    if (!row) return undefined;
    if (row.assigned_role_id === agentId) return "own_assignment";
    if (row.created_by_role_id === agentId) return "created_by_self";
    return null;
  }
  return undefined;
}

async function handleAgentApi(state: DaemonState, ws: WorkspaceState, action: string, body: Record<string, unknown>): Promise<Response> {
  const context = await requireAgentContext(state, ws, body as AgentContextInput);
  if (context instanceof Response) return context;
  // EP-022 / WA-094: grant check runs before dispatch on every gated
  // action. The behavior depends on the effective per-call mode resolved
  // from `min(ws.rbacMode, state.rbacModeCeiling)`:
  //   - `enforce`: miss logs `grant_miss_hard`, dispatcher returns 403
  //     `rbac_denied` before the action runs.
  //   - `soft`: miss logs `grant_miss_soft`, call proceeds (observation
  //     mode for operators staging RBAC adoption).
  //   - `off`: short-circuit — no grant lookup, no audit row, no deny.
  //
  // Per-workspace mode is the new operator-facing kill switch (replaces
  // the daemon-wide `WHATSAGENT_RBAC_HARD_ENFORCE` env); operators flip
  // via the Roles tab UI or `PATCH /api/v1/workspaces/:id/rbac-mode`.
  // CLI `--rbac-mode=<x>` provides a launch-only ceiling for emergency
  // daemon-wide override.
  //
  // Failure semantics (advisor msg 369): the grant check itself must not
  // fail-open under enforce mode. Audit-write failures are isolated
  // inside `checkActionGrants` so they cannot bypass miss detection. Any
  // other unexpected exception (DB failure resolving grants, denyResponse
  // render error) returns 500 under enforce and logs+continues under
  // soft / off.
  const effectiveMode = effectiveRbacMode(ws.rbacMode, state.rbacModeCeiling);
  let rbacOutcome: import("../rbac-enforce.ts").GrantMatchOutcome | null = null;
  try {
    const { checkActionGrants } = await import("../rbac-enforce.ts");
    const target = extractGrantTarget(body, action);
    // Resolve actor↔target relation BEFORE the grant check so kanban_action
    // requirements pick the narrowest matching scope. Without this, slice 4
    // ran scope-insensitive: engineer's `update_task_status (own_assignment)`
    // satisfied calls on tasks not assigned to engineer, masking the
    // violations Phase 4 hard-flip would surface. Per advisor blocker on
    // slice 4 (msg 349).
    const dynamicScope = resolveDynamicScope(ws, action, body, context.role.id);
    // Phase 4 (WA-087): for comment-* actions, surface body.type so the
    // dispatcher can require `comment_type:<type>` in addition to the
    // tool_family + kanban_action gates. Reviewers/PM hold verdict_*
    // grants; engineer/researcher do not. Empty/missing type skips the
    // extra requirement (handler will then default to its own type
    // validation logic for any-type-accepted endpoints).
    const dynamicCommentType = (action === "comment-kanban-task" || action === "comment-kanban-epic")
      ? (typeof body.type === "string" ? body.type.trim() : "")
      : undefined;
    rbacOutcome = checkActionGrants(ws.db, {
      agentId: context.role.id,
      action,
      target,
      dynamicScope,
      dynamicCommentType,
      mode: effectiveMode,
    });
  } catch (e) {
    state.logger.warn("rbac.check_failed", { action, error: e instanceof Error ? e.message : String(e) });
    if (effectiveMode === "enforce") {
      return json({ ok: false, error: "rbac_check_failed", tool: action }, { status: 500 });
    }
    // soft / off: log + continue with `rbacOutcome` left null → no deny.
  }
  if (rbacOutcome && !rbacOutcome.allowed && rbacOutcome.firstMissRequirement) {
    try {
      const { denyResponse } = await import("../rbac-enforce.ts");
      return json(
        denyResponse(ws.db, {
          tool: action,
          expectedGrant: rbacOutcome.firstMissRequirement,
          agentRoles: rbacOutcome.agentRolesSnapshot,
        }),
        { status: 403 },
      );
    } catch (e) {
      // Render failure under hard mode → fail closed with a minimal 403.
      // Audit row was already written by `checkActionGrants`; the call
      // must NOT proceed. Suppressing the rich body keeps the deny while
      // preserving the audit trail.
      state.logger.warn("rbac.deny_render_failed", { action, error: e instanceof Error ? e.message : String(e) });
      return json({ ok: false, error: "rbac_denied", tool: action }, { status: 403 });
    }
  }
  if (action === "whoami") {
    const db = ws.db;
    // RBAC Phase 3 slice 3: surface the agent's effective grants for
    // introspection ("can I call X?"). Soft enforcement (slice 4) uses
    // the same lookup at call time. Bucket-shape stays additive — older
    // MCP clients ignore unknown fields.
    const grants = getEffectiveGrants(db, context.role.id);
    // EP-022 / WA-097: surface effective RBAC mode so the MCP
    // integration layer can build its register-time visibility filter
    // off the same snapshot — agent boots, hits whoami, learns which
    // tool families it holds + the per-call mode the dispatcher will
    // apply. `effectiveMode` already factors in the CLI ceiling.
    return json({
      ok: true,
      role: context.role,
      sessionId: context.sessionId,
      mainRole: getMainAgent(db),
      policy: { mode: getPolicyMode(db) },
      grants,
      rbac: { mode: effectiveRbacMode(ws.rbacMode, state.rbacModeCeiling) },
    });
  }
  if (action === "list-peers") {
    const runners = await discoverAndReconcileRunners(state, ws);
    const details = Boolean(body.details);
    const db = ws.db;
    const mainRole = getMainAgent(db);
    // EP-DEC-RUN WA-006 (advisor msg #28): map runners by display_id so
    // duplicate-bare-name roles each see only their own runner status.
    const runnerByDisplayIdLR = new Map(runners.map((runner) => [runner.display_id, runner]));
    const sessionByRoleId = new Map(listRunningSessionDetails(db).map((session) => [session.role_id, session]));
    // EP-022 / WA-098: include each peer's RBAC role assignments so
    // callers can pick a peer by capability ("need verdict → find a
    // reviewer") instead of guessing from name. Also exclude the
    // caller themself — `whoami` already covers self-introspection.
    const peers = listAgents(db)
      .filter((agent) => agent.id !== context.role.id)
      .map((agent) => {
        const assignments = getAgentRoles(db, agent.id);
        const roleNames = assignments.map((a) => a.name);
        return {
          // Reshape per EP-022 / WA-098: drop the workspace-decoupling
          // identity-row internals (`path`, `git_root`, `repo_id`,
          // `host_default`, `missing_at`, `last_discovered_at`,
          // timestamps) and keep the addressing + status surface
          // peers actually need to route work.
          displayId: agent.display_id ?? `${agent.repo_name ?? ""}:${agent.name}`,
          repo: agent.repo_name ?? null,
          name: agent.name,
          roles: roleNames,
          isMain: agent.id === mainRole?.id,
          active: Boolean(runnerByDisplayIdLR.get(agent.display_id ?? "")?.reachable),
          ...(details ? (() => {
            const runner = runnerByDisplayIdLR.get(agent.display_id ?? "");
            const session = sessionByRoleId.get(agent.id);
            return {
              hostType: runner?.host_type ?? session?.host_type ?? agent.host_default,
              status: runner?.reachable ? (runner.status ?? "running") : (agent.missing_at ? "missing" : "offline"),
              sessionId: runner?.session_id ?? session?.session_id ?? null,
              summary: session?.summary ?? "",
              startedAt: runner?.started_at ?? session?.started_at ?? null,
              lastSeen: session?.last_seen ?? null,
              cwd: runner?.cwd ?? session?.cwd ?? null,
              nativePush: runner?.native_push ?? null,
              attention: runner?.attention ?? null,
              missing: Boolean(agent.missing_at),
            };
          })() : {}),
        };
      });
    return json({ ok: true, peers });
  }
  if (action === "settings") {
    const db = ws.db;
    return json({
      ok: true,
      agentText: getAgentTextSettings(state.daemonDb),
      policy: { mode: getPolicyMode(db) },
      peerPolicy: getPeerPolicySettings(db),
      runtime: getDaemonRuntimeSettings(state.daemonDb),
      runtimeDetection: state.runtimeDetection,
      daemonSettings: { tuiRedraw: getTuiRedrawSettings(state.daemonDb) },
      kanban: getKanbanSettings(db),
      defaults: { agentText: DEFAULT_AGENT_TEXT_SETTINGS },
    });
  }
  if (action === "send-message") {
    return sendFleetMessage(state, ws, { fromRole: context.role, fromSessionId: context.sessionId, toRoleName: String(body.toRole ?? ""), body: String(body.body ?? ""), source: "agent" });
  }
  if (action === "broadcast-message") {
    return broadcastFleetMessage(state, ws, { fromRole: context.role, fromSessionId: context.sessionId, body: String(body.body ?? ""), source: "agent" });
  }
  if (action === "post-channel-message") {
    if (Object.prototype.hasOwnProperty.call(body, "parentMessageId") || Object.prototype.hasOwnProperty.call(body, "parent_message_id")) {
      return json({ ok: false, error: "post_channel_message creates root Channel messages only; use reply_channel_thread for threaded replies" }, { status: 400 });
    }
    return postFleetChannelMessage(state, ws, { fromRole: context.role, fromSessionId: context.sessionId, body: String(body.body ?? ""), parentMessageId: null, source: "agent" });
  }
  if (action === "reply-channel-thread") {
    const messageId = tryParseInteger(body.messageId ?? body.message_id, { min: 1 });
    if (messageId instanceof Response) return messageId;
    return postFleetChannelMessage(state, ws, { fromRole: context.role, fromSessionId: context.sessionId, body: String(body.body ?? ""), parentMessageId: messageId, source: "agent" });
  }
  if (action === "read-channel-messages") {
    return readAgentChannelMessages(state, ws, body);
  }
  if (action === "search-direct-messages" || action === "search-channel-messages" || action === "search-kanban-tasks" || action === "search-kanban-epics") {
    return await handleAgentSearchApi(ws, action, body, context);
  }
  if (action === "check-messages") {
    const limit = normalizeInboxLimit(body.limit);
    const db = ws.db;
    const pendingMessages = listActionableInboxRows(db, context, limit);
    let envelope = "";
    try {
      envelope = formatAuditedInboxEnvelope(db, pendingMessages, getAgentTextSettings(state.daemonDb), context, "check-messages");
    } catch (error) {
      if (error instanceof Error && error.message === INBOX_ENVELOPE_NONCE_EXHAUSTION_MESSAGE) return nonceExhaustionResponse(db, context, "check-messages", pendingMessages.length);
      throw error;
    }
    // EP-030: capture the rows that were `pushed` BEFORE marking delivered so
    // we can emit per-row push-to-delivery-lag audits + an aggregate
    // dropped-pushed-recovered audit. The recovered audit is the operator
    // signal that the native-push path acknowledged a row but the LLM never
    // consumed it — only the agent's check_messages pull is actually
    // observable.
    const pushedBeforeDeliver = pendingMessages.filter((row) => row.state === "pushed");
    const messages = markSelectedInboxRowsRead(db, context, pendingMessages);
    if (pushedBeforeDeliver.length > 0) {
      auditPushDeliveryLag(db, context, pushedBeforeDeliver, messages);
    }
    await clearRunnerNudge(context.runner);
    const agentText = getAgentTextSettings(state.daemonDb);
    return json({ ok: true, messages, envelope, agentText });
  }
  if (action === "poll-messages") {
    const limit = normalizeInboxLimit(body.limit);
    const db = ws.db;
    const messages = listActionableInboxRows(db, context, limit);
    const agentText = getAgentTextSettings(state.daemonDb);
    try {
      return json({ ok: true, messages, envelope: formatAuditedInboxEnvelope(db, messages, agentText, context, "poll-messages"), agentText });
    } catch (error) {
      if (error instanceof Error && error.message === INBOX_ENVELOPE_NONCE_EXHAUSTION_MESSAGE) return nonceExhaustionResponse(db, context, "poll-messages", messages.length);
      throw error;
    }
  }
  if (action === "mark-messages-read") {
    const messageIds = tryParseIntegerArray(body.messageIds, { min: 1 });
    if (messageIds instanceof Response) return messageIds;
    const kanbanNotificationIds = tryParseIntegerArray(body.kanbanNotificationIds ?? body.kanban_notification_ids, { min: 1 });
    if (kanbanNotificationIds instanceof Response) return kanbanNotificationIds;
    const kanbanEpicNotificationIds = tryParseIntegerArray(body.kanbanEpicNotificationIds ?? body.kanban_epic_notification_ids, { min: 1 });
    if (kanbanEpicNotificationIds instanceof Response) return kanbanEpicNotificationIds;
    const db = ws.db;
    const messages = markInboxIdsRead(db, context, messageIds, kanbanNotificationIds, kanbanEpicNotificationIds);
    return json({
      ok: true,
      messages,
      read: messages.length,
      messageIds: messages.filter((message) => message.delivery_kind !== "kanban").map((message) => message.id),
      kanbanNotificationIds: messages.filter((message) => message.delivery_kind === "kanban" && !isEpicKanbanRow(message)).map((message) => message.kanban_notification_id ?? message.id),
      kanbanEpicNotificationIds: messages.filter(isEpicKanbanRow).map((message) => message.kanban_epic_notification_id ?? message.id),
    });
  }
  if (action === "mark-messages-pushed") {
    // EP-030: native-push plugins (opencode, claude) call this AFTER a
    // successful `tui.appendPrompt`+`tui.submitPrompt` (or equivalent) round
    // trip. The action transitions `pending → pushed` (NOT delivered);
    // delivered is reserved for the agent's own `check_messages` confirmation.
    // Idempotent: rows already `pushed`/`delivered` return as 0 transitions.
    const messageIds = tryParseIntegerArray(body.messageIds, { min: 1 });
    if (messageIds instanceof Response) return messageIds;
    const db = ws.db;
    const transitioned = markMessagesPushed(db, context.role.id, context.sessionId, messageIds);
    if (transitioned.length > 0) {
      appendAudit(db, {
        kind: "message.push_succeeded",
        actor_agent_id: context.role.id,
        target_kind: "messages",
        target_id: context.role.display_id ?? context.role.name,
        payload: {
          action: "mark-messages-pushed",
          messageIds: transitioned.map((row) => row.id),
          count: transitioned.length,
          sessionId: context.sessionId,
        },
      });
    }
    return json({
      ok: true,
      messages: transitioned,
      pushed: transitioned.length,
      messageIds: transitioned.map((row) => row.id),
    });
  }
  if (action === "list-kanban-tasks" || action === "read-kanban-task" || action === "create-kanban-task" || action === "update-kanban-task" || action === "update-kanban-task-status" || action === "comment-kanban-task" || action === "archive-kanban-task") {
    return await handleAgentKanbanApi(state, ws, action, body, context);
  }
  if (action === "list-kanban-epics" || action === "read-kanban-epic" || action === "create-kanban-epic" || action === "update-kanban-epic" || action === "comment-kanban-epic" || action === "archive-kanban-epic" || action === "update-kanban-epic-status" || action === "request-kanban-epic-close" || action === "cancel-kanban-epic-close") {
    return await handleAgentKanbanEpicApi(state, ws, action, body, context);
  }
  if (action === "set-summary") {
    const summary = String(body.summary ?? "").slice(0, 4000);
    const db = ws.db;
    setSessionSummary(db, context.role.id, context.sessionId, summary);
    return json({ ok: true, role: context.role.name, sessionId: context.sessionId, summary });
  }
  return json({ ok: false, error: "not found" }, { status: 404 });
}

export async function startDaemon(opts: { port?: number; consoleLogs?: boolean; hostCheckMode?: HostCheckMode; daemonHome?: string; rbacModeCeiling?: RbacMode | null } = {}): Promise<StartedDaemon> {
  const state = await loadState(opts);
  // Workspace decoupling: daemon boots empty. No automatic cwd-as-bridge
  // bootstrap. Tests use `seedTestWorkspace` (tests/helpers/seed-workspace.ts).
  for (const ws of state.workspaces.values()) {
    const pruned = pruneChatHistoryByRetention(ws.db);
    if (pruned.total > 0) state.logger.info("chat_history.pruned", { source: "startup", workspace: ws.id, ...pruned });
  }

  // Sweep expired trashed workspaces at startup, then every 6h.
  const lifecycleHooks: LifecycleHooks = {
    log: (level, event, payload) => {
      const fn = level === "info" ? state.logger.info.bind(state.logger) : level === "warn" ? state.logger.warn.bind(state.logger) : state.logger.error.bind(state.logger);
      fn(event, payload);
    },
  };
  await autoPurgeSweep(state.daemonDb, state.daemonHome, lifecycleHooks);
  state.autoPurgeTimer = setInterval(() => {
    void autoPurgeSweep(state.daemonDb, state.daemonHome, lifecycleHooks);
  }, 6 * 60 * 60 * 1000);
  state.autoPurgeTimer.unref?.();

  // Boot-time orphan sweep: walk every active workspace's runDir and
  // reconcile inactive runner metadata in that workspace's DB. Per
  // Phase 2b D2 — never cross workspace boundaries at request time.
  const runners: RunnerStatus[] = [];
  for (const cachedWs of state.workspaces.values()) {
    const wsRunners = await discoverAndReconcileRunners(state, cachedWs);
    for (const r of wsRunners) runners.push(r);
  }
  // Adopt every runner whose metadata survived a daemon restart as "owned".
  // The metadata files are 0o600 inside a 0o700 dir so trusting them on cold
  // start is consistent with the documented single-user threat model.
  for (const runner of runners) {
    if (runner.runner_pid > 0) state.ownedRunnerPids.add(runner.runner_pid);
  }
  const startupWs = state.currentWorkspaceId ? state.workspaces.get(state.currentWorkspaceId) ?? null : null;
  state.logger.info("daemon.start", {
    daemonHome: state.daemonHome,
    activeWorkspaceSlot: startupWs?.paths.slot ?? null,
    dbPath: startupWs?.paths.dbPath ?? null,
    host: state.config.ui.host,
    port: state.config.ui.port,
    runnerCount: runners.length,
    runtimeDetection: Object.fromEntries(
      HOST_TYPES.map((host) => [host, {
        detected: state.runtimeDetection[host].detected,
        version: state.runtimeDetection[host].version,
        path: state.runtimeDetection[host].resolvedPath,
        error: state.runtimeDetection[host].error,
      }] as const),
    ),
  });
  for (const runner of runners) {
    state.logger.info("runner.discovered", {
      role: runner.role,
      sessionId: runner.session_id,
      runnerPid: runner.runner_pid,
      reachable: runner.reachable,
    });
  }

  const server = Bun.serve<TerminalWsData>({
    hostname: state.config.ui.host,
    port: state.config.ui.port,
    async fetch(req, server) {
      const url = new URL(req.url);
      try {
        // /health is exempted so external liveness probes / the in-tree smoke
        // harness work regardless of allow-list configuration.
        if (url.pathname === "/health") return json({ ok: true, startedAt: state.startedAt });

        // DNS-rebinding defence: any non-/health route must carry a Host
        // header on the allow-list.
        const hostBlock = checkHostHeader(req, state);
        if (hostBlock) return hostBlock;

        // Static assets — independent of workspace.
        if (url.pathname === "/assets/xterm.js") return asset(XTERM_JS_PATH, "application/javascript; charset=utf-8");
        if (url.pathname === "/assets/xterm-addon-fit.js") return asset(XTERM_FIT_JS_PATH, "application/javascript; charset=utf-8");
        if (url.pathname === "/assets/xterm-addon-webgl.js") return asset(XTERM_WEBGL_JS_PATH, "application/javascript; charset=utf-8");
        if (url.pathname === "/assets/xterm-addon-unicode11.js") return asset(XTERM_UNICODE11_JS_PATH, "application/javascript; charset=utf-8");
        if (url.pathname === "/assets/xterm.css") return asset(XTERM_CSS_PATH, "text/css; charset=utf-8");
        const iconMatch = url.pathname.match(WEB_ICON_RE);
        if (iconMatch) return asset(`${WEB_ICON_DIR}${iconMatch[1]}`, "image/png");
        const soundMatch = WEB_SOUND_RE.exec(url.pathname);
        if (soundMatch) return asset(WEB_SOUND_DIR + soundMatch[1] + ".wav", "audio/wav", { cacheControl: "public, max-age=86400, immutable" });

        // EP-DEC-RUN WA-004: terminal WS sibling addressed by UUID or
        // displayId. Resolves the role row at upgrade time so the pump
        // loop downstream can keep using `roleName` (bare) for now.
        // (Full pump-side display_id routing lands in WA-006 alongside
        // the legacy path 410.)
        const terminalWsByIdMatch = url.pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/roles-by-id\/([^/]+)\/terminal\/ws$/);
        if (terminalWsByIdMatch) {
          const originBlock = checkOriginHeader(req, state);
          if (originBlock) return originBlock;
          const wsIdParam = decodeURIComponent(terminalWsByIdMatch[1]!);
          const targetWs = state.workspaces.get(wsIdParam);
          if (!targetWs) return json({ ok: false, error: "workspace_not_found" }, { status: 404 });
          const resolved = resolveRoleByIdOrDisplay(targetWs, terminalWsByIdMatch[2]!);
          if ("error" in resolved) return resolved.error;
          const session = requireSession(state.daemonDb, req);
          if (session && !validateCsrfTokenForSession(state.daemonDb, session.session.id, csrfTokenFromRequest(req, url))) {
            return csrfForbidden();
          }
          const upgraded = server.upgrade(req, {
            data: {
              state,
              workspaceId: targetWs.id,
              roleId: resolved.role.id,
              userId: session?.user.id,
              authRejected: !session,
              cursor: Number(url.searchParams.get("cursor") ?? "0"),
            } satisfies TerminalWsData,
          });
          if (upgraded) return undefined;
          return json({ error: "websocket upgrade failed" }, { status: 400 });
        }

        // EP-DEC-RUN WA-006: legacy /roles/:name/terminal/ws is gone.
        const terminalWsMatch = url.pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/roles\/([^/]+)\/terminal\/ws$/);
        if (terminalWsMatch) {
          const roleName = decodeURIComponent(terminalWsMatch[2]!);
          return json({
            ok: false,
            error: `legacy /roles/${roleName}/terminal/ws is gone (EP-DEC-RUN WA-006); use /roles-by-id/:idOrDisplay/terminal/ws`,
          }, { status: 410 });
        }

        // Origin check on state-changing routes outside non-browser paths.
        // /api/v1/agent/* are stdio-launched MCP children; the agent-side
        // launch flow POSTs to /api/v1/launch-token/validate before any
        // tool use. Both legitimately omit Origin/Referer. Legacy
        // /api/agent/* + /api/launch-token/validate get the same
        // treatment during the shim phase.
        if (
          isStateChangingMethod(req.method)
          && !url.pathname.startsWith("/api/v1/agent/")
          && url.pathname !== "/api/v1/launch-token/validate"
          && !url.pathname.startsWith("/api/agent/")
          && url.pathname !== "/api/launch-token/validate"
        ) {
          const originBlock = checkOriginHeader(req, state);
          if (originBlock) return originBlock;
        }

        const authBlock = authGate(state, req, url);
        if (authBlock) return authBlock;

        // Workspace-prefixed API: /api/v1/workspaces/<id>/<rest>
        const workspacePatchMatch = url.pathname.match(/^\/api\/v1\/workspaces\/([^/]+)$/);
        if (req.method === "PATCH" && workspacePatchMatch) {
          enforceBodySize(req);
          return await patchWorkspaceEndpoint(state, decodeURIComponent(workspacePatchMatch[1]!), await readJson<unknown>(req));
        }

        const wsApiMatch = url.pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/(.*)$/);
        if (wsApiMatch) {
          const wsId = decodeURIComponent(wsApiMatch[1]!);
          const rest = wsApiMatch[2]!;
          // Lifecycle actions on a specific id (workspace need not be active).
          if (req.method === "POST" && rest === "trash") return await trashWorkspaceEndpoint(state, wsId);
          if (req.method === "POST" && rest === "restore") return await restoreWorkspaceEndpoint(state, wsId);
          if (req.method === "POST" && rest === "purge") return await purgeWorkspaceEndpoint(state, wsId);

          // EP-022 / WA-094: PATCH `rbac-mode` runs BEFORE the active-cache
          // gate so it works on every active workspace; trashed/purging
          // rows still 404 below at the cache lookup as today.
          if (req.method === "PATCH" && rest === "rbac-mode") {
            return await setWorkspaceRbacModeEndpoint(state, wsId, await readJson<unknown>(req));
          }

          const ws = state.workspaces.get(wsId);
          if (!ws) return json({ ok: false, error: "workspace_not_found" }, { status: 404 });

          if (req.method === "GET" && rest === "status") return json(await snapshot(state, ws));
          if (req.method === "POST" && rest === "discover") {
            // Workspace-decoupling: auto-discover gone. Use /repos and
            // /scan-dirs (run-now) endpoints from EP-DEC-2 instead.
            return json({ ok: false, error: "discover removed; use /workspaces/:id/repos and /workspaces/:id/scan-dirs (workspace decoupling)" }, { status: 410 });
          }
          if (req.method === "GET" && rest === "settings") return await getSharedSettings(state, ws);
          if (req.method === "PUT" && rest === "settings/policy") return await updatePolicySettings(state, ws, await readJson<unknown>(req));
          if (req.method === "PUT" && rest === "settings/peer-policy") return await updatePeerPolicySettings(state, ws, await readJson<unknown>(req));
          if (req.method === "POST" && rest === "settings/peer-policy/rules") return await addPeerPolicyRule(state, ws, await readJson<unknown>(req));
          const wsPeerRuleMatch = rest.match(/^settings\/peer-policy\/rules\/(\d+)$/);
          if (req.method === "DELETE" && wsPeerRuleMatch) return await removePeerPolicyRule(state, ws, Number(wsPeerRuleMatch[1]));
          if (req.method === "PUT" && rest === "settings/chat-history") return await updateChatHistorySettings(state, ws, await readJson<unknown>(req));
          if (req.method === "PUT" && rest === "settings/message") return await updateMessageSettings(state, ws, await readJson<unknown>(req));
          if (req.method === "PUT" && rest === "settings/kanban") return await updateKanbanSettings(state, ws, await readJson<unknown>(req));
          if (req.method === "POST" && rest === "settings/chat-history/clear") return await clearChatHistorySettings(state, ws, await readJson<unknown>(req));
          if (req.method === "GET" && rest === "roles") return json((await snapshot(state, ws)).roles);
          if (req.method === "POST" && rest === "roles") return await createWorkspaceRoleEndpoint(state, ws, await readJson<unknown>(req));
          // Workspace decoupling: repo + scan-dir CRUD (WA-064 + WA-065).
          if (req.method === "GET" && rest === "repos") return await listReposEndpoint(state, ws);
          if (req.method === "POST" && rest === "repos") return await addRepoEndpoint(state, ws, await readJson<unknown>(req));
          const wsRepoRefreshMatch = rest.match(/^repos\/([^/]+)\/refresh$/);
          if (req.method === "POST" && wsRepoRefreshMatch) return await refreshRepoEndpoint(state, ws, decodeURIComponent(wsRepoRefreshMatch[1]!));
          const wsRepoMatch = rest.match(/^repos\/([^/]+)$/);
          if (req.method === "PATCH" && wsRepoMatch) return await patchRepoEndpoint(state, ws, decodeURIComponent(wsRepoMatch[1]!), await readJson<unknown>(req));
          if (req.method === "DELETE" && wsRepoMatch) return await deleteRepoEndpoint(state, ws, decodeURIComponent(wsRepoMatch[1]!));
          // Workspace-decoupling: role-by-id CRUD (WA-066). Lives next to
          // the legacy /roles[/:name] route while launch/stop/etc. URLs
          // still address by name via the compat shim.
          // RBAC Phase 2a: role + grant CRUD under /rbac/ prefix.
          if (req.method === "GET" && rest === "rbac/roles") return await listRbacRolesEndpoint(state, ws);
          if (req.method === "POST" && rest === "rbac/roles") return await createRbacRoleEndpoint(state, ws, await readJson<unknown>(req));
          const wsRbacRoleGrantsMatch = rest.match(/^rbac\/roles\/([^/]+)\/grants$/);
          if (req.method === "PUT" && wsRbacRoleGrantsMatch) return await replaceRbacRoleGrantsEndpoint(state, ws, decodeURIComponent(wsRbacRoleGrantsMatch[1]!), await readJson<unknown>(req));
          const wsRbacRoleMatch = rest.match(/^rbac\/roles\/([^/]+)$/);
          if (req.method === "PATCH" && wsRbacRoleMatch) return await patchRbacRoleEndpoint(state, ws, decodeURIComponent(wsRbacRoleMatch[1]!), await readJson<unknown>(req));
          if (req.method === "DELETE" && wsRbacRoleMatch) return await deleteRbacRoleEndpoint(state, ws, decodeURIComponent(wsRbacRoleMatch[1]!));
          // Agent role assignment (Phase 3 slice 2)
          const wsAgentRolesMatch = rest.match(/^agents\/([^/]+)\/roles$/);
          if (req.method === "GET" && wsAgentRolesMatch) return await listAgentRolesEndpoint(state, ws, decodeURIComponent(wsAgentRolesMatch[1]!));
          if (req.method === "PUT" && wsAgentRolesMatch) return await replaceAgentRolesEndpoint(state, ws, decodeURIComponent(wsAgentRolesMatch[1]!), await readJson<unknown>(req));
          // Audit log read (Phase 3 slice 6)
          if (req.method === "GET" && rest === "audit") return await listAuditEndpoint(state, ws, url);
          // EP-030 / WA-139: per-workspace push-state diagnostics surfaced
          // in Settings → Diagnostics. No auth gate beyond the workspace
          // path (matches `runners` / `messages` reads).
          if (req.method === "GET" && rest === "diagnostics/push-state") return json({ ok: true, ...getPushStateStats(ws.db) });
          // Audit log CSV export (Phase 4 slice 4-9 / WA-090). Gated on
          // `audit_grant:audit_admin` resolved from the workspace main agent.
          if (req.method === "GET" && rest === "audit/export") return await exportAuditEndpoint(state, ws, url);
          if (req.method === "GET" && rest === "roles-by-id") return await listRolesByIdEndpoint(state, ws);
          if (req.method === "POST" && rest === "roles-by-id") return await addRoleByIdEndpoint(state, ws, await readJson<unknown>(req));
          const wsRoleByIdMatch = rest.match(/^roles-by-id\/([^/]+)$/);
          if (req.method === "PATCH" && wsRoleByIdMatch) return await patchRoleByIdEndpoint(state, ws, decodeURIComponent(wsRoleByIdMatch[1]!), await readJson<unknown>(req));
          if (req.method === "DELETE" && wsRoleByIdMatch) return await deleteRoleByIdEndpoint(state, ws, decodeURIComponent(wsRoleByIdMatch[1]!));
          if (req.method === "GET" && rest === "scan-dirs") return await listScanDirsEndpoint(state, ws);
          if (req.method === "POST" && rest === "scan-dirs") return await addScanDirEndpoint(state, ws, await readJson<unknown>(req));
          const wsScanDirScanMatch = rest.match(/^scan-dirs\/([^/]+)\/scan$/);
          if (req.method === "POST" && wsScanDirScanMatch) return await runScanDirEndpoint(state, ws, decodeURIComponent(wsScanDirScanMatch[1]!));
          const wsScanDirMatch = rest.match(/^scan-dirs\/([^/]+)$/);
          if (req.method === "PATCH" && wsScanDirMatch) return await patchScanDirEndpoint(state, ws, decodeURIComponent(wsScanDirMatch[1]!), await readJson<unknown>(req));
          if (req.method === "DELETE" && wsScanDirMatch) return await deleteScanDirEndpoint(state, ws, decodeURIComponent(wsScanDirMatch[1]!));
          const wsRolePatchMatch = rest.match(/^roles\/([^/]+)$/);
          if (req.method === "PATCH" && wsRolePatchMatch) return await patchWorkspaceRoleEndpoint(state, ws, decodeURIComponent(wsRolePatchMatch[1]!), await readJson<unknown>(req));
          if (req.method === "DELETE" && wsRolePatchMatch) return await deleteWorkspaceRoleEndpoint(state, ws, decodeURIComponent(wsRolePatchMatch[1]!));
          if (req.method === "GET" && rest === "runners") return json((await discoverAndReconcileRunners(state, ws)).map(publicRunnerStatus));
          if (req.method === "GET" && rest === "messages") return await listFleetMessages(state, ws, url);
          if (req.method === "POST" && rest === "messages") {
            const body = await readJson<{ toRole?: string; body?: string }>(req);
            return await sendFleetMessage(state, ws, { fromRole: null, fromSessionId: null, toRoleName: body.toRole, body: body.body, source: "web" });
          }
          if (req.method === "POST" && rest === "messages/broadcast") {
            const body = await readJson<{ body?: string }>(req);
            return await broadcastFleetMessage(state, ws, { fromRole: null, fromSessionId: null, body: body.body, source: "web" });
          }
          if (req.method === "GET" && rest === "channel/messages") return await listFleetChannelMessages(state, ws, url);
          if (req.method === "POST" && rest === "channel/messages") {
            const body = await readJson<{ body?: string; parentMessageId?: number | null; parent_message_id?: number | null }>(req);
            return await postFleetChannelMessage(state, ws, { fromRole: null, fromSessionId: null, body: body.body, parentMessageId: body.parentMessageId ?? body.parent_message_id ?? null, source: "web" });
          }
          if (req.method === "GET" && rest === "kanban/tasks") return await listFleetKanbanTasks(state, ws, url);
          const wsKanbanTaskMatch = rest.match(/^kanban\/tasks\/([^/]+)$/);
          if (req.method === "GET" && wsKanbanTaskMatch) return await readFleetKanbanTask(state, ws, decodeURIComponent(wsKanbanTaskMatch[1]!));
          if (req.method === "GET" && rest === "kanban/epics") return await listFleetKanbanEpics(state, ws, url);
          const wsKanbanEpicApproveMatch = rest.match(/^kanban\/epics\/([^/]+)\/close-approval\/approve$/);
          if (req.method === "POST" && wsKanbanEpicApproveMatch) return await handleHumanWebKanbanEpicCloseApprove(state, ws, decodeURIComponent(wsKanbanEpicApproveMatch[1]!));
          const wsKanbanEpicCancelMatch = rest.match(/^kanban\/epics\/([^/]+)\/close-approval\/cancel$/);
          if (req.method === "POST" && wsKanbanEpicCancelMatch) return await handleHumanWebKanbanEpicCloseCancel(state, ws, decodeURIComponent(wsKanbanEpicCancelMatch[1]!));
          const wsKanbanEpicMatch = rest.match(/^kanban\/epics\/([^/]+)$/);
          if (req.method === "GET" && wsKanbanEpicMatch) return await readFleetKanbanEpic(state, ws, decodeURIComponent(wsKanbanEpicMatch[1]!));
          if (req.method === "POST" && rest === "main-role") {
            const body = await readJson<{ role?: string | null }>(req);
            if (body.role === null) {
              const { clearMainRole } = await import("../db.ts");
              clearMainRole(ws.db);
              state.logger.info("main_role.cleared", {});
              return json({ ok: true, role: null });
            }
            if (!body.role) return json({ error: "role is required" }, { status: 400 });
            // EP-DEC-RUN WA-006 (advisor msg #26 + #28): UUID first, then
            // displayId. Bare-name path rejects ambiguous lookups with 409
            // — silently picking the first match would misroute when two
            // repos each hold a same-bare-name role.
            let resolved: AgentRow | null = null;
            const byId = daoGetRoleById(ws.db, body.role);
            if (byId) {
              resolved = adaptRoleWithDisplayToCompat(byId);
            } else if (body.role.includes(":")) {
              const byDisplay = getRoleByDisplayId(ws.db, body.role);
              if (byDisplay) resolved = adaptRoleWithDisplayToCompat(byDisplay);
            } else {
              const matches = listAgentsByWorkspace(ws.db).filter((r) => r.name === body.role);
              if (matches.length > 1) return json({ ok: false, error: `bare name "${body.role}" is ambiguous (${matches.length} roles match); address by \`repo:role\` displayId or UUID` }, { status: 409 });
              if (matches.length === 1) resolved = adaptRoleWithDisplayToCompat(matches[0]!);
            }
            if (!resolved) return json({ ok: false, error: `Unknown role: ${body.role}` }, { status: 404 });
            // Stamp main_role_id by resolved.id directly. setMainRole's
            // bare-name lookup would re-introduce the cross-repo collision.
            const { setSetting } = await import("../db.ts");
            setSetting(ws.db, "main_role_id", resolved.id);
            state.logger.info("main_role.set", { role: resolved.name, displayId: resolved.display_id });
            return json({ ok: true, role: resolved });
          }
          // EP-DEC-RUN WA-006: legacy /roles/:name/default-runtime gone.
          // (Other /roles/:name/<action> routes 410 via wsLegacyActionMatch
          // below; default-runtime is matched here because the regex sits
          // alongside the workspace-namespace dispatch.)
          const wsDefaultRuntimeMatch = rest.match(/^roles\/([^/]+)\/default-runtime$/);
          if (req.method === "PUT" && wsDefaultRuntimeMatch) {
            const roleName = decodeURIComponent(wsDefaultRuntimeMatch[1]!);
            return json({
              ok: false,
              error: `legacy /roles/${roleName}/default-runtime is gone (EP-DEC-RUN WA-006); use /roles-by-id/:idOrDisplay/default-runtime`,
            }, { status: 410 });
          }
          // EP-DEC-RUN WA-004: per-role action routes addressed by UUID or
          // displayId (`repo:role`, percent-encoded). WA-006 dropped the
          // legacy /roles/:name/<action> family (now 410).
          const wsLaunchByIdMatch = rest.match(/^roles-by-id\/([^/]+)\/launch$/);
          if (req.method === "POST" && wsLaunchByIdMatch) {
            const resolved = resolveRoleByIdOrDisplay(ws, wsLaunchByIdMatch[1]!);
            if ("error" in resolved) return resolved.error;
            const body: { host?: string; commandOverride?: unknown } = await readBoundedRequestText(req)
              .then((text) => text ? JSON.parse(text) as { host?: string; commandOverride?: unknown } : {})
              .catch((e) => { if (e instanceof RequestEntityTooLarge) throw e; return {}; });
            return executeRoleLaunch(state, ws, resolved.role, body, state.daemonUrl ?? `http://${server.hostname}:${server.port}`);
          }
          const wsStopByIdMatch = rest.match(/^roles-by-id\/([^/]+)\/stop$/);
          if (req.method === "POST" && wsStopByIdMatch) {
            const resolved = resolveRoleByIdOrDisplay(ws, wsStopByIdMatch[1]!);
            if ("error" in resolved) return resolved.error;
            return executeRoleStop(state, ws, resolved.role, url.pathname);
          }
          const wsOutputByIdMatch = rest.match(/^roles-by-id\/([^/]+)\/output$/);
          if (req.method === "GET" && wsOutputByIdMatch) {
            const found = await runnerForRoleByIdOrDisplay(state, ws, wsOutputByIdMatch[1]!);
            if (found instanceof Response) return found;
            return proxyRunnerJson(found.runner, `/output${url.search}`);
          }
          const wsInputByIdMatch = rest.match(/^roles-by-id\/([^/]+)\/input$/);
          if (req.method === "POST" && wsInputByIdMatch) {
            const found = await runnerForRoleByIdOrDisplay(state, ws, wsInputByIdMatch[1]!);
            if (found instanceof Response) return found;
            const body = await readBoundedRequestText(req);
            return proxyRunnerJson(found.runner, "/input", { method: "POST", headers: { "Content-Type": "application/json" }, body });
          }
          const wsResizeByIdMatch = rest.match(/^roles-by-id\/([^/]+)\/resize$/);
          if (req.method === "POST" && wsResizeByIdMatch) {
            const found = await runnerForRoleByIdOrDisplay(state, ws, wsResizeByIdMatch[1]!);
            if (found instanceof Response) return found;
            const body = await readBoundedRequestText(req);
            return proxyRunnerJson(found.runner, "/resize", { method: "POST", headers: { "Content-Type": "application/json" }, body });
          }
          const wsDefaultRuntimeByIdMatch = rest.match(/^roles-by-id\/([^/]+)\/default-runtime$/);
          if (req.method === "PUT" && wsDefaultRuntimeByIdMatch) {
            const resolved = resolveRoleByIdOrDisplay(ws, wsDefaultRuntimeByIdMatch[1]!);
            if ("error" in resolved) return resolved.error;
            const body = await readJson<{ host?: unknown }>(req);
            // Update by role.id (advisor msg #18): bare-name UPDATE in
            // `setRoleDefaultRuntimeByName` would target the wrong repo's
            // row once WA-006 permits duplicate role names across repos.
            return json({ ok: true, role: await setRoleDefaultRuntimeById(state, ws, resolved.role.id, body.host) });
          }

          // EP-DEC-RUN WA-006: legacy `/roles/:name/<action>` family
          // returns 410 Gone. Multi-repo workspaces can host two roles
          // with the same bare name; bare-name action URLs would route
          // to whichever runner discovery picked first. Use
          // `/roles-by-id/:idOrDisplay/<action>` instead.
          const wsLegacyActionMatch = rest.match(/^roles\/([^/]+)\/(launch|stop|output|input|resize|default-runtime)$/);
          if (wsLegacyActionMatch) {
            const action = wsLegacyActionMatch[2]!;
            const roleName = decodeURIComponent(wsLegacyActionMatch[1]!);
            return json({
              ok: false,
              error: `legacy /roles/${roleName}/${action} is gone (EP-DEC-RUN WA-006); use /roles-by-id/:idOrDisplay/${action}`,
            }, { status: 410 });
          }
          return json({ ok: false, error: "not found" }, { status: 404 });
        }

        // Daemon-global v1 endpoints (no workspace prefix).
        if (req.method === "GET" && url.pathname === "/api/v1/workspaces") {
          return await listWorkspacesEndpoint(state, url);
        }
        if (req.method === "POST" && url.pathname === "/api/v1/workspaces") {
          return await createWorkspaceEndpoint(state, await readJson<unknown>(req));
        }
        if (req.method === "GET" && url.pathname === "/api/v1/workspaces/current") {
          return await getCurrentWorkspaceEndpoint(state);
        }
        if (req.method === "PUT" && url.pathname === "/api/v1/workspaces/current") {
          return await setCurrentWorkspaceEndpoint(state, await readJson<unknown>(req));
        }
        if (req.method === "PUT" && url.pathname === "/api/v1/settings/trash-retention-days") {
          return await updateTrashRetentionEndpoint(state, await readJson<unknown>(req));
        }
        if (req.method === "GET" && url.pathname === "/api/v1/settings/tui-redraw") {
          return await getTuiRedrawSettingsEndpoint(state);
        }
        if (req.method === "PUT" && url.pathname === "/api/v1/settings/tui-redraw") {
          return await updateTuiRedrawSettingsEndpoint(state, await readJson<unknown>(req));
        }
        // Runtime detection/settings are daemon-global. Launch options still
        // need a current workspace to include workspace-scoped roles/policy.
        const runtimeWs = state.currentWorkspaceId ? state.workspaces.get(state.currentWorkspaceId) : undefined;
        if (req.method === "PUT" && url.pathname === "/api/v1/settings/runtime") {
          return await updateRuntimeSettings(state, await readJson<unknown>(req));
        }
        if (req.method === "GET" && url.pathname === "/api/v1/settings/agent-text") {
          return json({ ok: true, agentText: getAgentTextSettings(state.daemonDb), defaults: { agentText: DEFAULT_AGENT_TEXT_SETTINGS } });
        }
        if (req.method === "PUT" && url.pathname === "/api/v1/settings/agent-text") {
          return await updateAgentTextSettings(state, await readJson<unknown>(req));
        }
        if (req.method === "POST" && url.pathname === "/api/v1/settings/agent-text/reset") {
          return await resetSharedAgentTextSettings(state);
        }
        if (req.method === "GET" && url.pathname === "/api/v1/settings/custom-prompts") {
          return await listCustomPromptsEndpoint(state);
        }
        if (req.method === "POST" && url.pathname === "/api/v1/settings/custom-prompts") {
          return await createCustomPromptEndpoint(state, await readJson<unknown>(req));
        }
        const customPromptMatch = url.pathname.match(/^\/api\/v1\/settings\/custom-prompts\/([^/]+)$/);
        if (customPromptMatch) {
          const id = decodeURIComponent(customPromptMatch[1]!);
          if (req.method === "PATCH") return await updateCustomPromptEndpoint(state, id, await readJson<unknown>(req));
          if (req.method === "DELETE") return await deleteCustomPromptEndpoint(state, id);
        }
        if (req.method === "POST" && url.pathname === "/api/v1/settings/runtime/detect") {
          return await detectAllRuntimes(state);
        }
        const detectOneMatch = url.pathname.match(/^\/api\/v1\/settings\/runtime\/detect\/([^/]+)$/);
        if (req.method === "POST" && detectOneMatch) {
          const customCommand = url.searchParams.has("command") ? url.searchParams.get("command") : null;
          return await detectOneRuntime(state, decodeURIComponent(detectOneMatch[1]!), customCommand);
        }
        if (url.pathname === "/api/v1/launch-options") {
          if (!runtimeWs) return json({ ok: false, error: "no_active_workspace" }, { status: 503 });
          const snap = await snapshot(state, runtimeWs);
          return json({
            roles: snap.roles,
            mainRole: snap.mainRole,
            commands: snap.runtime.commands,
            runtime: snap.runtime,
            policy: snap.policy,
          });
        }
        if (req.method === "POST" && url.pathname === "/api/v1/launch-token/validate") {
          const body = await readJson<{ workspaceId?: string; role?: string; sessionId?: string; token?: string }>(req);
          body.token = bearerTokenFromRequest(req) ?? body.token;
          const tokenWs = body.workspaceId ? state.workspaces.get(body.workspaceId) : undefined;
          if (!tokenWs) return json({ ok: false, error: "workspace_not_found" }, { status: 404 });
          const result = await validateLaunchToken(state, tokenWs, body, { refresh: true });
          // Workspace existence is the 404 trigger above. Once the
          // workspace resolves, token mismatch / role mismatch / expiry
          // are 401 — same shape as pre-2b behavior so MCP children can
          // distinguish "I'm pointing at the wrong workspace" from
          // "my token is wrong".
          return json(result, { status: result.ok ? 200 : 401 });
        }
        const agentMatch = url.pathname.match(/^\/api\/v1\/agent\/(whoami|list-peers|settings|send-message|broadcast-message|post-channel-message|reply-channel-thread|read-channel-messages|search-direct-messages|search-channel-messages|search-kanban-tasks|search-kanban-epics|check-messages|poll-messages|mark-messages-read|mark-messages-pushed|set-summary|list-kanban-tasks|read-kanban-task|create-kanban-task|update-kanban-task|update-kanban-task-status|comment-kanban-task|archive-kanban-task|list-kanban-epics|read-kanban-epic|create-kanban-epic|update-kanban-epic|comment-kanban-epic|archive-kanban-epic|update-kanban-epic-status|request-kanban-epic-close|cancel-kanban-epic-close)$/);
        if (req.method === "POST" && agentMatch) {
          const body = await readJson<Record<string, unknown>>(req);
          const bearerToken = bearerTokenFromRequest(req);
          if (bearerToken) body.token = bearerToken;
          const wsId = typeof body.workspaceId === "string" ? body.workspaceId : "";
          const agentWs = state.workspaces.get(wsId);
          if (!agentWs) return json({ ok: false, error: "workspace_not_found" }, { status: 404 });
          return await handleAgentApi(state, agentWs, agentMatch[1]!, body);
        }


        // Web routes. URL is the source of truth for which workspace to
        // render (Phase 2b D1 — multi-tab model).
        if (url.pathname === "/login" && req.method === "GET") return html(renderLoginPage());
        if (url.pathname === "/setup" && req.method === "GET") {
          if (countAuthUsers(state.daemonDb) > 0) return redirect("/login");
          return html(renderSetupPage());
        }
        if (url.pathname === "/api/v1/auth/login" && req.method === "POST") return await loginEndpoint(state, req, await readJson<unknown>(req));
        if (url.pathname === "/api/v1/auth/login-recovery" && req.method === "POST") return await loginRecoveryEndpoint(state, req, await readJson<unknown>(req));
        if (url.pathname === "/api/v1/auth/setup" && req.method === "POST") return await setupEndpoint(state, req, await readJson<unknown>(req));
        if (url.pathname === "/api/v1/auth/logout" && req.method === "POST") return await logoutEndpoint(state, req);
        if (url.pathname === "/api/v1/auth/me" && req.method === "GET") return await authMeEndpoint(state, req);
        if (url.pathname === "/api/v1/auth/change-password" && req.method === "POST") return await changePasswordEndpoint(state, req, await readJson<unknown>(req));
        if (url.pathname === "/api/v1/auth/sessions" && req.method === "GET") return await authSessionsEndpoint(state, req);
        if (url.pathname === "/api/v1/auth/sessions/sign-out-others" && req.method === "POST") return await signOutOtherSessionsEndpoint(state, req);
        const authSessionMatch = url.pathname.match(/^\/api\/v1\/auth\/sessions\/([^/]+)$/);
        if (authSessionMatch && req.method === "DELETE") return await deleteAuthSessionEndpoint(state, req, decodeURIComponent(authSessionMatch[1]!));
        if (url.pathname === "/api/v1/auth/regenerate-recovery" && req.method === "POST") return await regenerateRecoveryEndpoint(state, req);
        if (url.pathname === "/api/v1/client-debug" && req.method === "POST") return await clientDebugIngestEndpoint(state, req);
        if (url.pathname === "/api/v1/search/direct-messages" && req.method === "GET") return await searchDirectMessagesWebEndpoint(state, req, url);
        if (url.pathname === "/api/v1/search/channel-messages" && req.method === "GET") return await searchChannelMessagesWebEndpoint(state, req, url);
        if (url.pathname === "/api/v1/search/kanban-tasks" && req.method === "GET") return await searchKanbanTasksWebEndpoint(state, req, url);
        if (url.pathname === "/api/v1/search/kanban-epics" && req.method === "GET") return await searchKanbanEpicsWebEndpoint(state, req, url);

        if (url.pathname === "/" && req.method === "GET") {
          const id = state.currentWorkspaceId;
          if (id && state.workspaces.has(id)) {
            return redirect(`/workspaces/${encodeURIComponent(id)}/`);
          }
          return redirect("/workspaces");
        }
        if (url.pathname === "/workspaces" && req.method === "GET") {
          return html(await overviewShell(state, req));
        }
        const webWsMatch = url.pathname.match(/^\/workspaces\/([^/]+)(\/.*)?$/);
        if (webWsMatch && req.method === "GET") {
          const wsId = decodeURIComponent(webWsMatch[1]!);
          const targetWs = state.workspaces.get(wsId);
          if (!targetWs) return html(notFoundShell(), { status: 404 });
          return html(await shell(state, targetWs, req));
        }
        // Legacy SPA paths: 301 to prefixed equivalent under current.
        const legacyShellMatch = url.pathname.match(/^\/(agents|messages|kanban|settings)(\/.*)?$/);
        if (legacyShellMatch && req.method === "GET") {
          const id = state.currentWorkspaceId;
          if (id && state.workspaces.has(id)) {
            const tail = legacyShellMatch[1]! + (legacyShellMatch[2] ?? "");
            return redirect(`/workspaces/${encodeURIComponent(id)}/${tail}`, 301);
          }
          return redirect("/");
        }
        return json({ ok: false, error: "not found" }, { status: 404 });
      } catch (e) {
        if (e instanceof RequestEntityTooLarge) {
          state.logger.warn("http.body_too_large", { path: url.pathname, size: e.size, limit: e.limit });
          return json({ ok: false, error: e.message, size: e.size, limit: e.limit }, { status: 413 });
        }
        state.logger.error("http.error", { path: url.pathname, error: e instanceof Error ? e.message : String(e) });
        return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
      }
    },
    websocket: {
      open(ws: ServerWebSocket<TerminalWsData>) {
        if (ws.data.authRejected) {
          ws.close(4401, "auth_required");
          return;
        }
        terminalWsSchedule(ws, 0);
      },
      message(ws: ServerWebSocket<TerminalWsData>, message: string | Buffer) {
        void terminalWsMessage(ws, message).catch((e) => wsSend(ws, { type: "error", error: e instanceof Error ? e.message : String(e) }));
      },
      close(ws: ServerWebSocket<TerminalWsData>) {
        terminalWsClose(ws);
      },
    },
  });

  const bindUrl = `http://${server.hostname}:${server.port}`;
  // When the daemon is bound to an unspecified address (0.0.0.0, ::, [::]) the
  // bind hostname isn't routable from a connecting client. MCP children always
  // run on the same host as the daemon, so they must connect via loopback.
  // Loopback validation in requireLaunchContext (audit PR1) would otherwise
  // reject the env-supplied daemon URL and Claude/Codex MCP servers would fail
  // to start. The web UI keeps the public bind for LAN access.
  const url = rewriteToLoopback(bindUrl);
  state.daemonUrl = url;
  const boundPort = Number(new URL(bindUrl).port || state.config.ui.port);
  state.originAllowList = buildOriginAllowList(state.config, boundPort, [bindUrl, url]);
  state.logger.info("daemon.listen", { url, bindUrl });

  // Write daemon.pid + daemon.url next to the daemon DB so CLI subcommands
  // (stop, stop-all, workspace ...) can find a running daemon without
  // probing every port. These are best-effort: a missing/stale pid file
  // never blocks the daemon from running.
  await Bun.write(state.daemonHomePaths.daemonPidPath, `${process.pid}\n`).catch(() => undefined);
  await Bun.write(join(state.daemonHomePaths.home, "daemon.url"), `${url}\n`).catch(() => undefined);

  let stopPromise: Promise<void> | null = null;
  return {
    url,
    server,
    state,
    stop() {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        state.logger.info("daemon.stop", { url });
        const serverStop = server.stop(true);
        if (state.autoPurgeTimer) clearInterval(state.autoPurgeTimer);
        // EP-029 T2 — stop all per-runner consumers, drop subscribers,
        // flush+dispose mirrors. Done before workspace close so any
        // in-flight tick that references state.* sees the shutdown signal
        // cleanly. Keep this before the first await so legacy un-awaited
        // stop() call sites still synchronously quiesce timers/logging.
        for (const sessionId of [...state.terminalConsumers.keys()]) {
          terminalConsumerStop(state, sessionId, "daemon_stop");
        }
        await serverStop;
        // EP-029 T7 / WA-150 — await final snapshot flush so the next
        // daemon start recovers the latest mirror state deterministically.
        await flushAllTerminalMirrors(state);
        state.terminalSubscribers.clear();
        for (const mirror of state.terminalMirrors.values()) {
          try { mirror.dispose(); } catch { /* already disposed */ }
        }
        state.terminalMirrors.clear();
        // Per-workspace DB handles cached in state.workspaces. Close every
        // handle and clear the map; lifecycle hooks won't fire after stop.
        // Close last so any in-flight handler that referenced ws.db can
        // finish cleanly via server.stop(true).
        closeAllWorkspaceStates(state.workspaces);
        state.clientDebugRateWindow.clear();
        try { state.daemonDb.close(); } catch { /* already closed */ }
        // Best-effort cleanup of pid/url markers; both are advisory.
        await Bun.file(state.daemonHomePaths.daemonPidPath).delete?.().catch(() => undefined);
        await Bun.file(join(state.daemonHomePaths.home, "daemon.url")).delete?.().catch(() => undefined);
      })();
      return stopPromise;
    },
  };
}

function rewriteToLoopback(announceUrl: string): string {
  try {
    const parsed = new URL(announceUrl);
    const host = parsed.hostname;
    if (host === "0.0.0.0" || host === "::" || host === "[::]") {
      return `${parsed.protocol}//127.0.0.1:${parsed.port}`;
    }
    return announceUrl;
  } catch {
    return announceUrl;
  }
}
