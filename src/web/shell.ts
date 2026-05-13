import { homedir } from "node:os";
import type { ChangelogEntry } from "../changelog.ts";
import type { AgentRow } from "../db.ts";
import type { PeerPolicySettings, RuntimeSettings } from "../db.ts";
import type { ChatHistorySettings } from "../db.ts";
import type { MessageSettings } from "../db.ts";
import type { KanbanSettings } from "../db.ts";
import type { TuiRedrawSettings, WorkspaceStatus } from "../daemon-db.ts";
import type { WhatsAgentConfig } from "../config.ts";
import type { RunnerStatus } from "../runner/registry.ts";
import type { HostType } from "../runner/protocol.ts";
import type { RuntimeDetection } from "../runner/runtime-detect.ts";
import { WHATSAGENT_VERSION, WHATSAGENT_BUILD } from "../version.ts";
import { renderWebShellClientScript } from "./client-script.ts";
import { workspacePath } from "./client/router.ts";
import { WEB_SHELL_OVERRIDES } from "./shell-overrides.ts";
import { WEB_SHELL_STYLES } from "./shell-styles.ts";

export interface CurrentWorkspaceSummary {
  id: string;
  name: string;
  repo_count?: number;
}

export interface WorkspaceSummary extends CurrentWorkspaceSummary {
  status: WorkspaceStatus;
  role_count?: number;
  runner_count?: number;
  trashed_at?: string | null;
}

export interface WebShellData {
  clientBundle: string;
  root: string;
  config: WhatsAgentConfig;
  roles: AgentRow[];
  repos?: unknown[];
  scanDirs?: unknown[];
  mainRole: AgentRow | null;
  runners: RunnerStatus[];
  runtime?: RuntimeSettings;
  runtimeDetection?: Record<HostType, RuntimeDetection>;
  daemonSettings?: { tuiRedraw: TuiRedrawSettings };
  chatHistory?: ChatHistorySettings;
  messageSettings?: MessageSettings;
  kanban?: KanbanSettings;
  peerPolicy?: PeerPolicySettings;
  /** Phase 2 currently-active workspace (Phase 2a single workspace; 2b switcher). */
  currentWorkspace?: CurrentWorkspaceSummary | null;
  /** Phase 2 count of active (non-trashed) workspaces. */
  workspacesAvailable?: number;
  /** Phase 2 sidebar switcher summary list. */
  workspaces?: WorkspaceSummary[];
  /** Per-web-session CSRF token for browser state-changing routes. */
  csrfToken?: string | null;
  /** Optional initial SPA view hint for shell renders without a workspace. */
  view?: string;
  /** Parsed CHANGELOG.md entries loaded once at daemon startup. */
  changelog?: ChangelogEntry[];
}

export function renderWebShell(data: WebShellData): string {
  const userHome = (() => {
    try { return homedir() || "/home/user"; } catch { return "/home/user"; }
  })();
  const repoPathPlaceholder = `${userHome}/project`;
  const scanPathPlaceholder = userHome;
  const workspaces = data.workspaces ?? (data.currentWorkspace
    ? [{ ...data.currentWorkspace, status: "active" as WorkspaceStatus, role_count: data.roles.length, runner_count: data.runners.filter((runner) => runner.reachable).length, trashed_at: null }]
    : []);
  const workspacesAvailable = data.workspacesAvailable ?? workspaces.filter((workspace) => workspace.status !== "trashed" && workspace.status !== "purging").length;
  const workspaceHref = (tail: string) => data.currentWorkspace?.id ? workspacePath(data.currentWorkspace.id, tail) : "/";
  const initialState = JSON.stringify({
    root: data.root,
    fleet: data.config.fleet,
    policy: data.config.policy,
    ui: data.config.ui,
    config: data.config,
    appVersion: WHATSAGENT_VERSION,
    appBuild: WHATSAGENT_BUILD,
    runtime: data.runtime ?? { globalDefaultHost: null, commands: data.config.commands },
    runtimeDetection: data.runtimeDetection ?? null,
    daemonSettings: data.daemonSettings ?? { tuiRedraw: { workaround: "on" } },
    chatHistory: data.chatHistory ?? { retentionDays: 30 },
    messageSettings: data.messageSettings ?? { maxBodyChars: 32000 },
    kanban: data.kanban ?? { taskIdPrefix: "WA" },
    peerPolicy: data.peerPolicy ?? { mode: "deny-list", rules: [] },
    roles: data.roles,
    repos: data.repos ?? [],
    scanDirs: data.scanDirs ?? [],
    mainRole: data.mainRole,
    runners: data.runners,
    currentWorkspace: data.currentWorkspace ?? null,
    workspacesAvailable,
    workspaces,
    changelog: data.changelog ?? [],
    csrfToken: data.csrfToken ?? null,
    view: data.view ?? null,
  });

  return `<!doctype html>
<html lang="en" data-theme="auto">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>WhatsAgent - Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&family=Epilogue:wght@800&family=Space+Grotesk:wght@400;500&display=swap" rel="stylesheet" />
  <link id="favicon" rel="icon" type="image/png" sizes="16x16" href="/assets/icons/whatsagent-indigo-16.png" />
  <link rel="stylesheet" href="/assets/xterm.css" />
<style>
${WEB_SHELL_STYLES}
${WEB_SHELL_OVERRIDES}
  </style>
</head>
<body>
  <div class="app">
    <div class="mobile-sidebar-backdrop" data-action="close-mobile-sidebar" aria-hidden="true"></div>
    <aside class="sidebar" id="appSidebar">
      <button class="brand brand-toggle" data-action="toggle-mobile-sidebar" aria-label="Toggle navigation" aria-expanded="false" aria-controls="appSidebar" data-tip="Toggle navigation">
        <div class="brand-logo"><img id="brandIcon" src="/assets/icons/whatsagent-indigo-32.png" srcset="/assets/icons/whatsagent-indigo-32.png 1x, /assets/icons/whatsagent-indigo-64.png 2x" width="28" height="28" alt="" aria-hidden="true" /></div>
        <div class="brand-text"><div class="brand-title">WhatsAgent</div></div>
      </button>
      ${renderWorkspaceSwitcher(data.currentWorkspace ?? null, workspaces)}
      <nav class="nav">
        <a href="/workspaces" data-page="workspaces-overview" data-tip="Workspaces" aria-label="Workspaces"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2.5" width="5" height="4.5" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="2.5" width="5" height="4.5" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="2" y="9" width="5" height="4.5" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="9" width="5" height="4.5" rx="1" stroke="currentColor" stroke-width="1.2"/></svg><span class="nav-label">Workspaces</span></a>
        <a href="${workspaceHref("/agents")}" data-page="agents" class="active" data-tip="Agents" aria-label="Agents"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="2.5" fill="currentColor"/><circle cx="3" cy="11.5" r="2" fill="currentColor" opacity=".7"/><circle cx="13" cy="11.5" r="2" fill="currentColor" opacity=".7"/><path d="M6 11c0-2 4-2 4 0" stroke="currentColor" stroke-width="1.2" fill="none" opacity=".5"/></svg><span class="nav-label">Agents</span><span class="nav-badge" id="navAgentCount">0</span></a>
        <a href="${workspaceHref("/messages")}" data-page="messages" data-tip="Messages" aria-label="Messages"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="3" width="14" height="10" rx="2" fill="currentColor" opacity=".2" stroke="currentColor" stroke-width="1.2"/><path d="M4 6.5h8M4 9.5h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg><span class="nav-label">Messages</span><span class="nav-message-indicator" id="navMessageIndicator" hidden>New</span></a>
        <a href="${workspaceHref("/kanban")}" data-page="kanban" data-tip="Kanban" aria-label="Kanban"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="2" width="13" height="12" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M5.8 2v12M10.2 2v12" stroke="currentColor" stroke-width="1.2"/><rect x="2.9" y="4" width="1.8" height="3.2" rx=".5" fill="currentColor" opacity=".75"/><rect x="7.1" y="6" width="1.8" height="3.2" rx=".5" fill="currentColor" opacity=".55"/><rect x="11.3" y="4.8" width="1.8" height="3.2" rx=".5" fill="currentColor" opacity=".75"/></svg><span class="nav-label">Kanban</span></a>
        <a href="${workspaceHref("/settings/preferences")}" data-page="settings" data-tip="Settings" aria-label="Settings"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6.7 1.6h2.6l.35 1.55c.35.13.68.32.98.56l1.52-.5 1.3 2.25-1.18 1.05c.03.19.05.38.05.58s-.02.39-.05.58l1.18 1.05-1.3 2.25-1.52-.5c-.3.24-.63.43-.98.56L9.3 14.4H6.7l-.35-1.55a4.16 4.16 0 0 1-.98-.56l-1.52.5-1.3-2.25 1.18-1.05a3.77 3.77 0 0 1-.05-.58c0-.2.02-.39.05-.58L2.55 7.28l1.3-2.25 1.52.5c.3-.24.63-.43.98-.56L6.7 1.6Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><circle cx="8" cy="8" r="2.05" stroke="currentColor" stroke-width="1.25"/></svg><span class="nav-label">Settings</span></a>
      </nav>
      <div class="sidebar-actions" aria-label="Quick actions">
        <button class="sidebar-action notification-row" id="notificationBtn" data-action="toggle-notifications-popover" data-tip="Notifications" aria-label="Notifications" aria-haspopup="dialog" aria-expanded="false">
          <span class="notification-icon-wrap">
            <svg class="notification-icon notification-icon-on" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 14.2a2 2 0 0 0 1.86-1.25H6.14A2 2 0 0 0 8 14.2Z" fill="currentColor"/><path d="M3.35 11.9h9.3c.55 0 .86-.63.53-1.07-.58-.77-.91-1.7-.91-2.66V6.7a4.27 4.27 0 0 0-8.54 0v1.47c0 .96-.33 1.9-.91 2.66-.33.44-.02 1.07.53 1.07Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>
            <svg class="notification-icon notification-icon-muted" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 14.2a2 2 0 0 0 1.86-1.25H6.14A2 2 0 0 0 8 14.2Z" fill="currentColor"/><path d="M3.35 11.9h9.3c.55 0 .86-.63.53-1.07-.58-.77-.91-1.7-.91-2.66V6.7a4.27 4.27 0 0 0-8.54 0v1.47c0 .96-.33 1.9-.91 2.66-.33.44-.02 1.07.53 1.07Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M2.2 2.1 13.9 13.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <span class="notification-badge" id="notificationBadge" hidden>0</span>
          </span>
          <span class="sidebar-action-label">Notifications</span>
        </button>
        <button class="sidebar-action primary" id="topLaunchBtn" data-tip="Launch Agent" aria-label="Launch Agent"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><span class="sidebar-action-label">Launch Agent</span></button>
        <button class="sidebar-action hidden" id="topBroadcastBtn" data-tip="Broadcast" aria-label="Broadcast"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 8.5 13.5 2.7c.42-.21.88.2.71.64l-3.7 9.9c-.17.44-.78.45-.96.02L7.9 9.35 4 8.98c-.48-.05-.6-.7-.17-.92Z" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/><path d="M7.9 9.35 14 3.05" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/></svg><span class="sidebar-action-label">Broadcast</span></button>
        <button class="sidebar-action" data-action="auth-logout" data-tip="Log out" aria-label="Log out"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.5 3H3.8A1.8 1.8 0 0 0 2 4.8v6.4A1.8 1.8 0 0 0 3.8 13h2.7" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/><path d="M9.5 4.5 13 8l-3.5 3.5M5.5 8H13" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="sidebar-action-label">Log out</span></button>
      </div>
      <div class="sidebar-footer"><span class="live-dot" style="color:var(--green)"></span><div class="footer-main"><div class="footer-title">Daemon :<span id="daemonPort"></span></div><div class="footer-sub"><span id="liveRoleCount">0</span> agents live</div></div></div>
    </aside>

    <div class="shell">
      <main class="content" id="content"></main>
    </div>
  </div>

  <div id="launchModal" class="modal-backdrop hidden">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="launchModalTitle">
      <div class="modal-title" id="launchModalTitle">Launch Agent</div>
      <div class="modal-sub">Start or attach the active session for an agent under <span class="mono" id="modalRoot"></span></div>
      <label class="field-label">Agent type</label>
      <div class="choice-grid" id="launchHostCards"></div>
      <label class="field-label">Project directory</label>
      <div class="role-picker" id="launchRoleList"></div>
      <div class="modal-actions"><button class="btn secondary" id="closeLaunchBtn">Cancel</button><button class="btn" id="launchSubmitBtn">Launch / Attach</button></div>
    </div>
  </div>

  <div id="broadcastModal" class="modal-backdrop hidden">
    <div class="modal broadcast-modal" role="dialog" aria-modal="true" aria-labelledby="broadcastModalTitle">
      <div class="modal-title" id="broadcastModalTitle">Broadcast Message</div>
      <div class="modal-sub" id="broadcastModalSub">Send a message to all online agents.</div>
      <label class="field-label" for="broadcastBody">Message</label>
      <textarea id="broadcastBody" rows="8" placeholder="Write a broadcast for the online fleet…"></textarea>
      <div class="broadcast-status" id="broadcastStatus"></div>
      <div class="modal-actions"><button class="btn secondary" id="closeBroadcastBtn">Cancel</button><button class="btn" id="sendBroadcastBtn">Send Broadcast</button></div>
    </div>
  </div>

  <div id="confirmStopModal" class="modal-backdrop hidden">
    <div class="modal confirm-stop-modal" role="dialog" aria-modal="true" aria-labelledby="confirmStopModalTitle">
      <div class="modal-title" id="confirmStopModalTitle">Stop agent?</div>
      <div class="modal-sub" id="confirmStopModalSub">This will end the live session.</div>
      <div class="modal-actions"><button class="btn secondary" id="confirmStopCancelBtn" data-modal-initial-focus>Cancel</button><button class="btn danger" id="confirmStopActionBtn">Stop</button></div>
    </div>
  </div>

  <div id="confirmModal" class="modal-backdrop hidden">
    <div class="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirmModalTitle">
      <div class="modal-title" id="confirmModalTitle"></div>
      <div class="modal-sub" id="confirmModalBody"></div>
      <div class="modal-actions"><button class="btn secondary" id="confirmModalCancelBtn" data-modal-initial-focus>Cancel</button><button class="btn" id="confirmModalConfirmBtn">Confirm</button></div>
    </div>
  </div>

  <div id="addAgentModal" class="modal-backdrop hidden">
    <div class="modal workspace-edit-modal" role="dialog" aria-modal="true" aria-labelledby="addAgentModalTitle">
      <div class="modal-title" id="addAgentModalTitle">Add Agent</div>
      <div class="modal-sub" id="addAgentModalSub">Register a new agent.</div>
      <label class="field-label" for="addAgentName">Agent name</label>
      <input id="addAgentName" class="field-input" type="text" autocomplete="off" placeholder="frontend-test" />
      <label class="field-label">Agent Runtime</label>
      <div id="addAgentRuntimePills" class="runtime-pill-group" role="radiogroup" aria-label="Agent runtime"></div>
      <div id="addAgentRepoRow">
        <label class="field-label">Target repository</label>
        <div id="addAgentRepoContainer" class="settings-dropdown-host"></div>
      </div>
      <label class="agent-operator-checkbox-label" for="addAgentOperatorCheckbox">
        <input id="addAgentOperatorCheckbox" type="checkbox" /> Acts on behalf of human
      </label>
      <div class="agent-operator-checkbox-help">Marks this agent as a human surrogate. Notifications and approval requests that would otherwise reach a human are routed here. Compose alongside another role for actual permissions.</div>
      <label class="field-label">Roles</label>
      <div id="addAgentRolesPicker" class="agent-edit-roles" role="group" aria-label="Agent roles"></div>
      <div class="agent-edit-roles-help">Defaults seeded by name (main → pm + operator, worker → engineer, advisor → reviewer + engineer, researcher → researcher, anything else → engineer). Toggle to override before creating.</div>
      <div class="workspace-add-status" id="addAgentStatus"></div>
      <div class="modal-actions"><button class="btn secondary" data-action="close-add-agent">Cancel</button><button class="btn" id="addAgentSubmitBtn" data-action="submit-add-agent">Add</button></div>
    </div>
  </div>

  <div id="agentEditModal" class="modal-backdrop hidden">
    <div class="modal workspace-edit-modal" role="dialog" aria-modal="true" aria-labelledby="agentEditModalTitle">
      <div class="modal-title" id="agentEditModalTitle">Edit Agent</div>
      <div class="modal-sub" id="agentEditModalSub">Rename the agent or change its default runtime.</div>
      <label class="field-label" for="agentEditName">Agent name</label>
      <input id="agentEditName" class="field-input" type="text" autocomplete="off" />
      <label class="field-label">Agent Runtime</label>
      <div id="agentEditRuntimePills" class="runtime-pill-group" role="radiogroup" aria-label="Agent runtime"></div>
      <label class="agent-operator-checkbox-label" for="agentEditOperatorCheckbox">
        <input id="agentEditOperatorCheckbox" type="checkbox" /> Acts on behalf of human
      </label>
      <div class="agent-operator-checkbox-help">Marks this agent as a human surrogate. Notifications and approval requests that would otherwise reach a human are routed here. Compose alongside another role for actual permissions.</div>
      <label class="field-label">Roles</label>
      <div id="agentEditRolesPicker" class="agent-edit-roles" role="group" aria-label="Agent roles"></div>
      <div class="agent-edit-roles-help">Roles compose. Default seeded by agent name on create. Clear all roles for an unprivileged agent.</div>
      <div class="workspace-add-status" id="agentEditStatus"></div>
      <div class="modal-actions"><button class="btn secondary" data-action="close-agent-edit">Cancel</button><button class="btn" id="agentEditSubmitBtn" data-action="submit-agent-edit">Save</button></div>
    </div>
  </div>

  <div id="repoEditModal" class="modal-backdrop hidden">
    <div class="modal workspace-edit-modal" role="dialog" aria-modal="true" aria-labelledby="repoEditModalTitle">
      <div class="modal-title" id="repoEditModalTitle">Add Repository</div>
      <div class="modal-sub" id="repoEditModalSub">Register a repository.</div>
      <label class="field-label" for="repoEditName">Repository name</label>
      <input id="repoEditName" class="field-input" type="text" autocomplete="off" placeholder="Optional - defaults to folder name" />
      <label class="field-label" for="repoEditPath">Repository path</label>
      <input id="repoEditPath" class="field-input" type="text" autocomplete="off" placeholder="${escapeHtml(repoPathPlaceholder)}" />
      <div class="workspace-add-status" id="repoEditStatus"></div>
      <div class="modal-actions"><button class="btn secondary" data-action="close-repo-edit">Cancel</button><button class="btn" id="repoEditSubmitBtn" data-action="submit-repo-edit">Add</button></div>
    </div>
  </div>

  <div id="scanDirsManageModal" class="modal-backdrop hidden">
    <div class="modal workspace-edit-modal" role="dialog" aria-modal="true" aria-labelledby="scanDirsManageModalTitle">
      <div class="modal-title" id="scanDirsManageModalTitle">Manage Scan Directories</div>
      <div class="modal-sub">Scan directories auto-discover repositories at startup or on demand.</div>
      <div id="scanDirsManageList" class="workspace-edit-list"></div>
      <label class="field-label" for="scanDirsManageAddPath">Add scan directory</label>
      <input id="scanDirsManageAddPath" class="field-input" type="text" autocomplete="off" placeholder="${escapeHtml(scanPathPlaceholder)}" />
      <label class="checkbox-row"><input id="scanDirsManageAddStartup" type="checkbox" /> Scan on startup</label>
      <button type="button" class="btn secondary small" data-action="add-scan-dir">Add Scan Directory</button>
      <div class="workspace-add-status" id="scanDirsManageStatus"></div>
      <div class="modal-actions"><button class="btn" data-action="close-scan-dirs-manage">Done</button></div>
    </div>
  </div>

  <div id="workspaceAddModal" class="modal-backdrop hidden">
    <div class="modal workspace-add-modal" role="dialog" aria-modal="true" aria-labelledby="workspaceAddModalTitle">
      <div class="modal-title" id="workspaceAddModalTitle">Add Workspace</div>
      <div class="modal-sub">Create a logical workspace. Add repositories from the Agents page.</div>
      <label class="field-label" for="workspaceAddName">Name</label>
      <input id="workspaceAddName" class="field-input" type="text" autocomplete="off" placeholder="Project fleet" />
      <label class="field-label" for="workspaceAddKanbanPrefix">Kanban prefix</label>
      <input id="workspaceAddKanbanPrefix" class="field-input" type="text" maxlength="12" autocomplete="off" placeholder="WA" />
      <label class="field-label">RBAC Mode</label>
      <div class="rbac-mode-picker" id="workspaceAddRbacMode" role="radiogroup" aria-label="RBAC Mode">
        <button type="button" class="rbac-mode-option" data-action="select-add-rbac-mode" data-rbac-mode="enforce" role="radio" aria-checked="false">Enforce</button>
        <button type="button" class="rbac-mode-option" data-action="select-add-rbac-mode" data-rbac-mode="soft" role="radio" aria-checked="false">Soft</button>
        <button type="button" class="rbac-mode-option" data-action="select-add-rbac-mode" data-rbac-mode="off" role="radio" aria-checked="false">Off</button>
      </div>
      <ul class="rbac-mode-help">
        <li><strong>Enforce</strong> - block calls without grants. Audit denies.</li>
        <li><strong>Soft</strong> - allow all calls, log misses to audit. Use to watch what would break before turning Enforce on.</li>
        <li><strong>Off</strong> - no checks, no audit. Lowest friction, lowest safety. Use only for low-risk sandboxes.</li>
      </ul>
      <div class="workspace-add-status" id="workspaceAddStatus"></div>
      <div class="modal-actions"><button class="btn secondary" id="closeWorkspaceAddBtn" data-action="close-workspace-add">Cancel</button><button class="btn" id="workspaceAddSubmitBtn" data-action="submit-workspace-add">Add Workspace</button></div>
    </div>
  </div>

  <div id="workspaceEditModal" class="modal-backdrop hidden">
    <div class="modal workspace-edit-modal" role="dialog" aria-modal="true" aria-labelledby="workspaceEditModalTitle">
      <div class="modal-title" id="workspaceEditModalTitle">Edit Workspace</div>
      <div class="modal-sub" id="workspaceEditModalSub">Manage repositories and scan directories from the Agents page.</div>
      <section id="workspaceEditGeneralSection" class="workspace-edit-section">
        <label class="field-label" for="workspaceEditName">Name</label>
        <input id="workspaceEditName" class="field-input" type="text" autocomplete="off" />
        <label class="field-label" for="workspaceEditKanbanPrefix">Kanban prefix</label>
        <input id="workspaceEditKanbanPrefix" class="field-input" type="text" maxlength="12" autocomplete="off" placeholder="WA" />
        <label class="field-label">RBAC Mode</label>
        <div class="rbac-mode-picker" id="workspaceEditRbacMode" role="radiogroup" aria-label="RBAC Mode">
          <button type="button" class="rbac-mode-option" data-action="select-edit-rbac-mode" data-rbac-mode="enforce" role="radio" aria-checked="false">Enforce</button>
          <button type="button" class="rbac-mode-option" data-action="select-edit-rbac-mode" data-rbac-mode="soft" role="radio" aria-checked="false">Soft</button>
          <button type="button" class="rbac-mode-option" data-action="select-edit-rbac-mode" data-rbac-mode="off" role="radio" aria-checked="false">Off</button>
        </div>
        <ul class="rbac-mode-help">
          <li><strong>Enforce</strong> - block calls without grants. Audit denies.</li>
          <li><strong>Soft</strong> - allow all calls, log misses to audit. Use to watch what would break before turning Enforce on.</li>
          <li><strong>Off</strong> - no checks, no audit. Lowest friction, lowest safety. Use only for low-risk sandboxes.</li>
        </ul>
      </section>
      <div class="workspace-add-status" id="workspaceEditStatus"></div>
      <div class="modal-actions"><button class="btn secondary" data-action="close-workspace-edit">Cancel</button><button class="btn" id="workspaceEditSubmitBtn" data-action="submit-workspace-edit">Save</button></div>
    </div>
  </div>

  <div id="appTooltip" class="app-tooltip" role="tooltip" hidden></div>

  <script src="/assets/xterm.js"></script>
  <script src="/assets/xterm-addon-fit.js"></script>
  <script src="/assets/xterm-addon-webgl.js"></script>
  <script src="/assets/xterm-addon-unicode11.js"></script>
  ${renderWebShellClientScript(data.clientBundle, initialState)}
  <div id="notificationPopover" class="notification-popover hidden" role="dialog" aria-label="Notifications" aria-modal="false" hidden></div>
  <div id="notificationToastStack" class="notification-toast-stack" aria-live="polite" aria-atomic="false"></div>
</body>
</html>`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch] ?? ch));
}

function truncatedAttrs(value: unknown): string {
  return `data-truncate-tip="${escapeHtml(value)}"`;
}

function workspaceInitials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "WS";
  const parts = cleaned.split(/[^a-z0-9]+/i).filter(Boolean);
  const initials = (parts.length >= 2 ? (parts[0]?.charAt(0) ?? "") + (parts[1]?.charAt(0) ?? "") : cleaned.slice(0, 2)).toUpperCase();
  return initials || "WS";
}

function renderWorkspaceSwitcher(current: CurrentWorkspaceSummary | null, workspaces: WorkspaceSummary[]): string {
  const activeWorkspaces = workspaces.filter((workspace) => workspace.status !== "trashed" && workspace.status !== "purging");
  const currentWorkspace = current ?? activeWorkspaces[0] ?? null;
  const currentName = currentWorkspace?.name ?? "No workspace";
  const rows = activeWorkspaces.length
    ? activeWorkspaces.map((workspace) => {
      const active = currentWorkspace?.id === workspace.id;
      const repoCount = workspace.repo_count ?? 0;
      const roleCount = workspace.role_count ?? 0;
      const runnerCount = workspace.runner_count ?? 0;
      const counts = `${repoCount} repo${repoCount === 1 ? "" : "s"} / ${roleCount} role${roleCount === 1 ? "" : "s"} / ${runnerCount} live`;
      return `<button type="button" class="workspace-menu-row ${active ? "active" : ""}" data-action="switch-workspace" data-workspace-id="${escapeHtml(workspace.id)}" role="menuitem">
        <span class="workspace-avatar">${escapeHtml(workspaceInitials(workspace.name))}</span>
        <span class="workspace-menu-copy"><strong ${truncatedAttrs(workspace.name)}>${escapeHtml(workspace.name)}</strong><small ${truncatedAttrs(counts)}>${counts}</small></span>
      </button>`;
    }).join("")
    : `<div class="workspace-menu-empty">No workspaces registered</div>`;
  return `<div class="workspace-switcher" id="workspaceSwitcher">
    <button type="button" class="workspace-switcher-trigger" data-action="toggle-workspace-menu" aria-haspopup="menu" aria-expanded="false" data-tip="Switch workspace">
      <span class="workspace-avatar">${escapeHtml(workspaceInitials(currentName))}</span>
      <span class="workspace-switcher-copy">
        <span class="workspace-name" ${truncatedAttrs(currentName)}>${escapeHtml(currentName)}</span>
      </span>
      <span class="workspace-caret" aria-hidden="true">v</span>
    </button>
    <div class="workspace-menu hidden" id="workspaceMenu" role="menu" aria-label="Workspaces">
      ${rows}
      <div class="workspace-menu-footer">
        <button type="button" class="workspace-menu-add" data-action="open-workspace-add">Add Workspace</button>
      </div>
    </div>
  </div>`;
}
