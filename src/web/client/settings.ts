// @ts-nocheck
import { truncatedAttrs } from "./truncate-tooltip.ts";
import { pluralize } from "./util.ts";

// Settings (agent-text + messaging) feature module.
// Carved out of src/web/client/main.ts per
// docs/superpowers/specs/2026-05-01-web-client-modularisation-design.md.
// Owns: settingsTabOrder, settingsTabAliases, validSettingsTab, the subnav
// builder, and the messaging + prompts (agent-text) tab content. Other
// tabs (fleet, runtime, runners, agents) stay in main.ts and later feature
// modules (agents.ts, codex.ts).

let _ctx = null;
function ctx() {
  if (!_ctx) throw new Error('settings context not bound; call installSettings(ctx) first');
  return _ctx;
}
function getPrefs() { return ctx().getPrefs ? ctx().getPrefs() : {}; }
function prefControl(...args) { return ctx().prefControl(...args); }
function captureStatus() { return ctx().captureStatus ? ctx().captureStatus() : { enabled: false, bufferFill: 0, bufferMax: 0, shippedTotal: 0, droppedTotal: 0, lastFlushAt: 0, lastError: '', backoffStep: 0 }; }
function flushDebugCaptureNow() { return ctx().flushDebugCaptureNow ? ctx().flushDebugCaptureNow() : null; }
function getState() { return ctx().getState(); }
function patchState(partial) { ctx().patchState(partial); }
function getPage() { return ctx().getPage(); }
function getSelectedSettingsTab() { return ctx().getSelectedSettingsTab(); }
function renderSettings() { ctx().renderSettings(); }
function workspaceFetch(suffix, init) { return ctx().workspaceFetch(suffix, init); }
function daemonApiUrl(suffix) { return ctx().daemonApiUrl(suffix); }
function clearMessageCache() { ctx().clearMessageCache(); }
function updateMessageLengthCounters() { ctx().updateMessageLengthCounters(); }
function settingsBottomActionBar(section, status, opts) { return ctx().settingsBottomActionBar(section, status, opts); }
function settingsWorkspaceSubtitle(scope) { return ctx().settingsWorkspaceSubtitle(scope); }
function settingsDropdown(name, value, options, opts) { return ctx().settingsDropdown(name, value, options, opts); }
function openConfirm(opts) { return ctx().openConfirm(opts); }
function esc(value) { return ctx().esc(value); }
function mobileSidebarTab() { return ctx().mobileSidebarTab ? ctx().mobileSidebarTab() : ''; }

export const settingsTabOrder = ['preferences', 'notifications', 'messaging', 'runtime', 'prompts', 'roles', 'user', 'diagnostics', 'about'];
export const settingsTabAliases = { fleet: 'runtime', runners: 'diagnostics', 'chat-history': 'messaging', 'agent-text': 'prompts', workspaces: 'preferences' };

export function validSettingsTab(value) {
  const normalized = settingsTabAliases[value] || value;
  return settingsTabOrder.includes(normalized) ? normalized : 'preferences';
}

let chatHistorySettings = null;
let chatHistoryLoading = false;
let chatHistorySaving = false;
let chatHistoryClearing = false;
let chatHistoryStatus = '';
let messageSettings = null;
let messageSettingsLoading = false;
let messageSettingsSaving = false;
let messageSettingsStatus = '';
let messagingPolicyDraftMode = '';
let messagingPeerRuleDraftMode = '';
let messagingSettingsSaving = false;
let messagingSettingsStatus = '';
let messagingPolicyStatus = '';
let messagingPolicySaving = false;
let agentTextSettings = null;
let agentTextDefaults = null;
let agentTextLoading = false;
let agentTextSaving = false;
let agentTextStatus = '';
let customPrompts = null;
let customPromptsLoading = false;
let customPromptsStatus = '';
let promptExpanded = { 'builtin:pushedInboxInstructions': true };
let userSettings = null;
let userSessions = null;
let userSettingsLoading = false;
let userSettingsStatus = '';
let userRecoveryCode = '';
let authPasswordModalOpen = false;
// EP-030 / WA-139 — Diagnostics → Push delivery panel state.
let pushStateStats = null; // null until first fetch; { pending, pushed, oldestPushedAt | null }
let pushStateLoadedAt = 0;
let pushStateLoading = false;
let tuiRedrawSaving = false;
let tuiRedrawStatus = '';

// RBAC roles tab (Phase 2b) — Settings → Roles UI.
let rbacRoles = null;          // null until first load; then array of RbacRoleWithGrants.
let rbacRolesLoading = false;
let rbacRolesStatus = '';
const rbacExpanded = new Set(); // role ids whose accordion body is open
let rbacViewSubtab = 'list';    // 'list' | 'matrix' | 'audit'
// RBAC Phase 3 slice 6 — Audit subtab state.
let rbacAuditEntries = null;             // null = not loaded; array of AuditLogEntry
let rbacAuditLoading = false;
let rbacAuditError = '';
let rbacAuditSummary = null;             // { violations24h, violations7d, passes24h, actorsWithMisses24h }
let rbacAuditPermissions = { audit_read: false, audit_admin: false }; // WA-090: gates CSV export button
let rbacAuditPagination = { total: 0, limit: 50, offset: 0 };
let rbacAuditFilterKind = 'grant_miss_hard';  // 'grant_miss_hard' | 'grant_miss_soft' | 'grant_check_pass'
let rbacAuditFilterWindow = '24h';            // '24h' | '7d' | 'all'
let rbacAuditFilterActor = '';                // empty = all
let rbacAuditExpanded = new Set();            // audit ids whose detail row is open
// Tracks the last successful audit load so the auto-refresh path can
// skip re-fetching on every render tick. Audit data is append-only +
// grows between renders; refreshing on focus / page-mount catches new
// rows without spamming the server on every internal renderSettings()
// call (which fires on every grant draft toggle, etc.).
let rbacAuditLastLoadAt = 0;
const RBAC_AUDIT_AUTOREFRESH_MS = 1500;
// Inputs are uncontrolled; we read .value from the DOM at save time. The
// in-flight Set drives the Saving… button label.
const rbacSaving = new Set();
// Per-role inline save status — `{ kind: 'ok' | 'err', text: string }`. Lives
// next to the Save button inside the expander so success/failure feedback
// stays anchored to the row instead of bubbling to the panel-level banner.
const rbacRoleSaveStatus = Object.create(null);
// Per-role active grant-category tab. Keys are role.id, values one of
// 'tool_family' | 'kanban_action' | 'comment_type' | 'channel_action' |
// 'audit_grant' | 'meta'. Defaults to 'tool_family' on first expand.
const rbacGrantTab = Object.create(null);
let rbacAddModalOpen = false;
let rbacAddModalStatus = '';
let rbacAddModalSaving = false;
const rbacDeleting = new Set();
// Per-role draft grant set. Built on first expand from role.grants; mutated
// in-place on toggle; Save fires PUT /grants. Cleared on collapse.
//   rbacGrantDraft[roleId] = Array<{ grant_kind, grant_value, scope_qualifier|null }>
const rbacGrantDraft = Object.create(null);

// Catalog of known grants per category, including a short plain-language
// description. Mirrors the seed data in src/db.ts BUILTIN_ROLE_DEFINITIONS.
// Used to render the grant-editor chip list inside the role expander.
const RBAC_BOOLEAN_GRANT_CATEGORIES = [
  { kind: 'tool_family', label: 'Tools visibility', hint: 'Tools shown to the agent. Untick = tool hidden from the agent’s MCP menu (cannot be called). Tick = tool visible; the specific verb is still gated by Kanban actions / Comment types / Channel actions tabs. Live agents need to relaunch to pick up changes (the visibility filter is a snapshot taken at MCP boot).', items: [
    { value: 'messaging', desc: 'Send and receive direct messages with other agents.' },
    { value: 'channel-read', desc: 'Read messages from shared channels.' },
    { value: 'channel-write', desc: 'Post, reply, and broadcast in shared channels.' },
    { value: 'summary', desc: 'Read agent identity and current-work summaries.' },
    { value: 'kanban-read', desc: 'View Kanban tasks and epics.' },
    { value: 'kanban-comment', desc: 'Add comments to tasks and epics.' },
    { value: 'kanban-status', desc: 'Move tasks through Backlog → Review → Completed.' },
    { value: 'kanban-admin', desc: 'Create, edit, and archive tasks and epics.' },
  ] },
  { kind: 'comment_type', label: 'Comment types', hint: 'Which comment kinds the role may post on tasks and epics. Requires the kanban-comment family on the Tools visibility tab; without it, the comment MCP tool is hidden regardless of these checks.', items: [
    { value: 'progress', desc: 'Routine progress updates.' },
    { value: 'note', desc: 'Annotations for context, not a status change.' },
    { value: 'blocker', desc: 'Flags work that is stuck.' },
    { value: 'verdict_go', desc: 'Sign off — work is approved to ship.' },
    { value: 'verdict_no_go', desc: 'Reject — work cannot ship.' },
    { value: 'verdict_needs_revision', desc: 'Conditional — fix the called-out items, then re-review.' },
  ] },
  { kind: 'channel_action', label: 'Channel actions', hint: 'Specific channel operations this role can invoke. read_channel_messages requires the channel-read family on the Tools visibility tab; post / reply / broadcast require channel-write. Topology (who can post into which channel) is governed by peer policy and is separate from these grants.', items: [
    { value: 'post_channel_message', desc: 'Post a new message in a channel.' },
    { value: 'reply_channel_thread', desc: 'Reply within an existing channel thread.' },
    { value: 'read_channel_messages', desc: 'Read messages from channels.' },
    { value: 'broadcast_message', desc: 'Send one message to all online agents.' },
  ] },
  { kind: 'audit_grant', label: 'Audit', hint: 'Visibility into the audit log of agent actions and system events.', items: [
    { value: 'audit_read', desc: 'Read audit log entries.' },
    { value: 'audit_admin', desc: 'Full audit access plus retention controls.' },
  ] },
  { kind: 'meta', label: 'Meta', hint: 'Special-purpose flags. Compose alongside another role; not a standalone grant set.', items: [
    { value: 'is_operator_surrogate', desc: 'Marks this role as the human-facing operator (typically `human-web` or workspace main); active-push permission gates on this.' },
  ] },
];

// Kanban actions take an additional scope qualifier per grant. "any"
// renders as a chip mapped to `scope_qualifier = null` (unrestricted).
// Specific scopes (`own_assignment`, `created_by_self`, etc) can be
// checked alongside or instead of `any` — additive set semantics
// inside a single (kind, value) pair.
const RBAC_KANBAN_ACTION_GRANTS = [
  { value: 'create_task', desc: 'Create a new Kanban task.', scopes: ['any'] },
  { value: 'create_epic', desc: 'Create a new Kanban epic.', scopes: ['any'] },
  { value: 'update_task', desc: 'Edit task title, description, priority, effort, dependencies.', scopes: ['any'] },
  { value: 'update_epic', desc: 'Edit epic metadata.', scopes: ['any'] },
  { value: 'update_task_status', desc: 'Move a task between Backlog/In Progress/Review/etc.', scopes: ['any', 'own_assignment'] },
  { value: 'update_epic_status', desc: 'Move an epic between status columns.', scopes: ['any', 'own_assignment'] },
  { value: 'archive_task', desc: 'Move a task into Archive.', scopes: ['any'] },
  { value: 'archive_epic', desc: 'Move an epic into Archive.', scopes: ['any'] },
  { value: 'request_epic_close', desc: 'Initiate the close-approval workflow for an epic.', scopes: ['any', 'own_assignment'] },
  { value: 'cancel_epic_close', desc: 'Cancel a pending close-approval request.', scopes: ['any', 'own_assignment'] },
  { value: 'comment_task', desc: 'Add comments to a task.', scopes: ['any', 'own_assignment', 'created_by_self'] },
  { value: 'comment_epic', desc: 'Add comments to an epic.', scopes: ['any'] },
];

const RBAC_SCOPE_LABELS = {
  any: 'any',
  own_assignment: 'own assignment',
  created_by_self: 'created by self',
  assigned_to_agent: 'assigned to agent',
  workspace_main: 'workspace main',
};

// Map UI scope chip → grant.scope_qualifier value. "any" stores as NULL.
function scopeChipToQualifier(chip) {
  return chip === 'any' ? null : chip;
}
function qualifierToScopeChip(scope) {
  return scope == null ? 'any' : scope;
}

function ensureMessageSettingsSeed() {
  if (messageSettings) return;
  messageSettings = getState().messageSettings || null;
}
function ensureChatHistorySeed() {
  if (chatHistorySettings) return;
  chatHistorySettings = getState().chatHistory || null;
}

export function settingsTabsHtml() {
  const labels = {
    preferences: 'Preferences',
    notifications: 'Notifications',
    messaging: 'Messaging',
    runtime: 'Runtime',
    prompts: 'Prompts',
    roles: 'Roles',
    user: 'User',
    diagnostics: 'Diagnostics',
    about: 'About',
  };
  const tab = getSelectedSettingsTab();
  return '<div class="tabbar settings-subnav" aria-label="Settings sections">' + mobileSidebarTab() + '<div class="tabbar-scroll" role="tablist">' + settingsTabOrder.map(id => {
    return '<button class="term-tab settings-subnav-item ' + (tab === id ? 'active' : '') + '" role="tab" aria-selected="' + (tab === id ? 'true' : 'false') + '" data-action="select-settings-tab" data-settings-tab="' + id + '"><span>' + esc(labels[id] || id) + '</span></button>';
  }).join('') + '</div></div>';
}

export function renderSettingsTabContent(tab) {
  if (tab === 'messaging') {
    ensureMessageSettingsSeed();
    ensureChatHistorySeed();
    if (!messageSettings && !messageSettingsLoading) void loadMessageSettings();
    if (!chatHistorySettings && !chatHistoryLoading) void loadChatHistorySettings();
    return messagingPanel();
  }
  if (tab === 'prompts') {
    if (!agentTextSettings && !agentTextLoading) void loadAgentTextSettings();
    if (!customPrompts && !customPromptsLoading) void loadCustomPrompts();
    return agentTextPanel();
  }
  if (tab === 'about') return aboutPanel();
  if (tab === 'diagnostics') {
    // EP-030 / WA-139: lazy-load + throttle push-state fetch so internal
    // re-renders don't hammer the daemon. 5 s window matches the panel's
    // operator-pace; sustained pushed > 0 is the signal, not real-time count.
    // The `pushStateLoading` guard plus the post-failure timestamp bump
    // (advisor review fix #2) keeps a 5xx response from pegging the
    // endpoint via the finally→render→fetch loop.
    const PUSH_STATE_AUTOREFRESH_MS = 5000;
    if (!pushStateLoading && Date.now() - pushStateLoadedAt > PUSH_STATE_AUTOREFRESH_MS) void loadPushStateStats();
    return diagnosticsPanel();
  }
  if (tab === 'user') {
    if (!userSettings && !userSettingsLoading) void loadUserSettings();
    return userPanel();
  }
  if (tab === 'roles') {
    if (!rbacRoles && !rbacRolesLoading) void loadRbacRoles();
    // Audit subtab data is append-only and grows between renders.
    // Auto-refresh on every render tick when the audit subtab is
    // active, throttled by `RBAC_AUDIT_AUTOREFRESH_MS` so internal
    // re-renders (chip toggles, tab switches) don't hammer the server.
    if (rbacViewSubtab === 'audit' && !rbacAuditLoading) {
      const elapsed = Date.now() - rbacAuditLastLoadAt;
      if (elapsed >= RBAC_AUDIT_AUTOREFRESH_MS) void loadRbacAudit();
    }
    return rolesPanel();
  }
  return null;
}

// =============================================================================
// RBAC roles tab — Phase 2b
// =============================================================================

function rbacRoleSummaryCounts(role) {
  const grants = role?.grants || [];
  const counts = { tool_family: 0, kanban_action: 0, comment_type: 0, channel_action: 0, audit_grant: 0, meta: 0 };
  for (const g of grants) {
    if (g.grant_kind in counts) counts[g.grant_kind] += 1;
  }
  return counts;
}

function rbacRoleAvatarLetter(name) {
  return (name || '?').charAt(0).toUpperCase();
}

function rolesPanel() {
  const loadingHtml = rbacRolesLoading && !rbacRoles
    ? '<div class="thread-empty" style="min-height:90px">Loading roles…</div>'
    : '';
  const roles = Array.isArray(rbacRoles) ? rbacRoles : [];
  const builtinCount = roles.filter(r => r.is_builtin === 1).length;
  const customCount = roles.filter(r => r.is_builtin !== 1).length;
  const counts = '<div class="roles-counts" aria-live="polite">' +
    '<span><strong>' + builtinCount + '</strong> built-in</span>' +
    '<span class="dot" aria-hidden="true"></span>' +
    '<span><strong>' + customCount + '</strong> custom</span>' +
    '<span class="dot" aria-hidden="true"></span>' +
    '<span><strong>' + roles.length + '</strong> total</span>' +
    '</div>';
  const list = roles.length
    ? '<div class="role-list" role="list">' + roles.map(rolesRowHtml).join('') + '</div>'
    : (rbacRoles ? '<div class="peer-rule-empty">No roles defined.</div>' : '');
  const status = rbacRolesStatus
    ? '<div class="settings-status">' + esc(rbacRolesStatus) + '</div>'
    : '';
  const addBtn = '<button type="button" class="btn primary small" data-action="rbac-open-add-role-modal">+ Add custom role</button>';
  const auditBadge = rbacAuditSummary && rbacAuditSummary.violations24h > 0
    ? ' <span class="audit-tab-badge">' + esc(String(rbacAuditSummary.violations24h)) + '</span>'
    : '';
  // EP-022 / WA-100: workspace-RBAC-mode selector row above the inner
  // subtab bar. Click flips the cached workspace mode via PATCH; the
  // flip-to-Off path goes through `openConfirm` (memory rule
  // `feedback_custom_ui` — never native confirm for destructive ops).
  const rolesPanelState = getState();
  const currentRbacMode = (rolesPanelState.currentWorkspace && rolesPanelState.currentWorkspace.rbac_mode) || 'enforce';
  const rbacModeRow = '<div class="rbac-mode-row" role="radiogroup" aria-label="Workspace RBAC mode">' +
    '<span class="rbac-mode-label">RBAC Mode</span>' +
    ['enforce', 'soft', 'off'].map(function (mode) {
      const isCurrent = mode === currentRbacMode;
      const cls = 'rbac-mode-option' + (isCurrent ? ' selected' : '');
      const label = mode.charAt(0).toUpperCase() + mode.slice(1);
      return '<button type="button" class="' + cls + '" data-action="rbac-select-workspace-mode" data-rbac-mode="' + mode + '" role="radio" aria-checked="' + (isCurrent ? 'true' : 'false') + '">' + label + '</button>';
    }).join('') +
    '</div>';
  const subTabbar = '<div class="roles-inner-tabbar tabbar" role="tablist" aria-label="Roles view">' +
    '<button type="button" role="tab" class="term-tab' + (rbacViewSubtab === 'list' ? ' active' : '') + '" aria-selected="' + (rbacViewSubtab === 'list' ? 'true' : 'false') + '" data-action="rbac-select-view-subtab" data-rbac-subtab="list">Roles</button>' +
    '<button type="button" role="tab" class="term-tab' + (rbacViewSubtab === 'matrix' ? ' active' : '') + '" aria-selected="' + (rbacViewSubtab === 'matrix' ? 'true' : 'false') + '" data-action="rbac-select-view-subtab" data-rbac-subtab="matrix">Permissions Overview</button>' +
    '<button type="button" role="tab" class="term-tab' + (rbacViewSubtab === 'audit' ? ' active' : '') + '" aria-selected="' + (rbacViewSubtab === 'audit' ? 'true' : 'false') + '" data-action="rbac-select-view-subtab" data-rbac-subtab="audit">Audit' + auditBadge + '</button>' +
    '</div>';
  const body = rbacViewSubtab === 'matrix'
    ? rolesMatrixHtml(roles)
    : rbacViewSubtab === 'audit'
    ? rolesAuditHtml(currentRbacMode)
    : ('<div class="roles-action-row">' + counts + addBtn + '</div>' + list + status);
  return '<section class="card card-pad settings-wide rbac-roles-settings">' +
    '<div class="section-head"><div><h2>Roles <span class="roles-scope-badge">Applies to current workspace</span></h2><p>Permission sets you assign to agents. Built-in roles are locked by name; their description and permissions are still editable.</p></div></div>' +
    rbacModeRow +
    loadingHtml +
    subTabbar +
    body +
    '</section>' +
    rbacAddRoleModalHtml();
}

function rolesMatrixHtml(roles) {
  // Operator role omitted per mockup (no explicit grants — meta marker
  // only). Caller-side ordering: the DAO `listRbacRoles` already returns
  // builtin-first then ABC by name (ORDER BY is_builtin DESC, name ASC),
  // so the matrix columns inherit that order without an additional sort.
  // If a future caller passes an unsorted array, sort here defensively.
  const visible = roles
    .filter(r => r.name !== 'operator')
    .slice()
    .sort((a, b) => {
      if ((b.is_builtin === 1 ? 1 : 0) !== (a.is_builtin === 1 ? 1 : 0)) {
        return (b.is_builtin === 1 ? 1 : 0) - (a.is_builtin === 1 ? 1 : 0);
      }
      return (a.name || '').localeCompare(b.name || '');
    });
  if (visible.length === 0) return '<div class="peer-rule-empty">No roles to compare.</div>';

  const cell = (role, kind, value, scopes) => {
    const matches = (role.grants || []).filter(g => g.grant_kind === kind && g.grant_value === value);
    if (matches.length === 0) return '<td class="matrix-cell matrix-cell-off" aria-label="off"></td>';
    if (!scopes || scopes.length === 0 || (matches.length === 1 && matches[0].scope_qualifier == null)) {
      return '<td class="matrix-cell matrix-cell-on" aria-label="granted">✓</td>';
    }
    // Show scopes inline as compact badges.
    const labels = matches.map(m => m.scope_qualifier == null ? 'any' : m.scope_qualifier).sort().join(', ');
    return '<td class="matrix-cell matrix-cell-on matrix-cell-scoped" aria-label="' + esc(labels) + '">'
      + '<span class="matrix-tick">✓</span>'
      + '<span class="matrix-scope" title="' + esc(labels) + '">' + esc(labels.replace(/_/g, ' ')) + '</span>'
      + '</td>';
  };

  const headerCells = visible.map(r => {
    const isBuiltin = r.is_builtin === 1;
    return '<th class="matrix-role-head' + (isBuiltin ? ' builtin' : ' custom') + '" scope="col">' +
      '<span class="matrix-role-name">' + esc(r.name) + '</span>' +
      (isBuiltin
        ? '<span class="matrix-role-tag" aria-hidden="true">🔒</span>'
        : '<span class="matrix-role-tag matrix-role-tag-custom" aria-hidden="true">★</span>') +
      '</th>';
  }).join('');

  const sectionRows = (label, kind, items, scoped) =>
    '<tr class="matrix-section-row">' +
      // Wrap the label text in a sticky-left inner span so the section
      // heading stays visible during horizontal scroll. The TH spans every
      // column for the divider background; without the inner sticky span
      // the leftmost text gets clipped behind the sticky first-column body
      // cells when the user scrolls right.
      '<th class="matrix-section-head" colspan="' + (visible.length + 1) + '" scope="colgroup">' +
        '<span class="matrix-section-label">' + esc(label) + '</span>' +
      '</th>' +
    '</tr>' +
    items.map(item => {
      const value = typeof item === 'string' ? item : item.value;
      const cells = visible.map(r => cell(r, kind, value, scoped ? (typeof item === 'object' ? item.scopes : null) : null)).join('');
      return '<tr class="matrix-grant-row">' +
        '<th class="matrix-grant-cell" scope="row">' +
          '<code>' + esc(value) + '</code>' +
        '</th>' + cells +
      '</tr>';
    }).join('');

  const toolFamilyItems = RBAC_BOOLEAN_GRANT_CATEGORIES.find(c => c.kind === 'tool_family').items.map(i => i.value);
  const commentTypeItems = RBAC_BOOLEAN_GRANT_CATEGORIES.find(c => c.kind === 'comment_type').items.map(i => i.value);
  const channelActionItems = RBAC_BOOLEAN_GRANT_CATEGORIES.find(c => c.kind === 'channel_action').items.map(i => i.value);
  const auditItems = RBAC_BOOLEAN_GRANT_CATEGORIES.find(c => c.kind === 'audit_grant').items.map(i => i.value);
  const metaItems = RBAC_BOOLEAN_GRANT_CATEGORIES.find(c => c.kind === 'meta').items.map(i => i.value);

  return '<div class="permissions-matrix-wrap">' +
    '<p class="grant-category-hint matrix-operator-note">Operator role omitted — it carries only the <code>is_operator_surrogate</code> meta marker and is composed alongside another role.</p>' +
    '<div class="permissions-matrix-scroll">' +
      '<table class="permissions-matrix" role="grid">' +
        '<thead><tr><th class="matrix-corner" scope="col">Permission</th>' + headerCells + '</tr></thead>' +
        '<tbody>' +
          sectionRows('Tools visibility', 'tool_family', toolFamilyItems, false) +
          sectionRows('Kanban actions', 'kanban_action', RBAC_KANBAN_ACTION_GRANTS, true) +
          sectionRows('Comment types', 'comment_type', commentTypeItems, false) +
          sectionRows('Channel actions', 'channel_action', channelActionItems, false) +
          sectionRows('Audit', 'audit_grant', auditItems, false) +
          sectionRows('Meta', 'meta', metaItems, false) +
        '</tbody>' +
      '</table>' +
    '</div>' +
    '</div>';
}

function rbacAddRoleModalHtml() {
  return '<div class="modal-backdrop ' + (rbacAddModalOpen ? '' : 'hidden') + '" data-rbac-add-modal>' +
    '<div class="modal rbac-add-role-modal" role="dialog" aria-modal="true" aria-labelledby="rbacAddRoleTitle">' +
      '<div class="modal-title" id="rbacAddRoleTitle">Add custom role</div>' +
      '<div class="modal-sub">Custom roles can be renamed, edited, or deleted. Built-in roles are locked.</div>' +
      '<label class="field-label" for="rbacAddRoleName">Name</label>' +
      '<input id="rbacAddRoleName" class="field-input rbac-modal-name" type="text" autocomplete="off" placeholder="release-manager" />' +
      '<span class="rbac-modal-help">Letters, digits, hyphen, underscore. Max 64 chars. Names are normalized to lowercase.</span>' +
      '<label class="field-label" for="rbacAddRoleDesc">Description</label>' +
      '<textarea id="rbacAddRoleDesc" class="field-input rbac-modal-desc" rows="5" placeholder="What does this role do?"></textarea>' +
      '<div class="workspace-add-status">' + (rbacAddModalStatus ? esc(rbacAddModalStatus) : '') + '</div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn secondary" data-action="rbac-close-add-role-modal">Cancel</button>' +
        '<button type="button" class="btn" data-action="rbac-submit-add-role"' + (rbacAddModalSaving ? ' disabled aria-disabled="true"' : '') + '>' + (rbacAddModalSaving ? 'Adding…' : 'Add role') + '</button>' +
      '</div>' +
    '</div></div>';
}

// ----- RBAC Phase 4: Audit subtab -----------------------------------------

const RBAC_AUDIT_KIND_LABELS = {
  grant_miss_soft: 'Missing grant (legacy)',
  grant_check_pass: 'Grant check passed',
  grant_miss_hard: 'Denied',
};

const RBAC_AUDIT_KIND_TOOLTIPS = {
  grant_miss_soft: 'Legacy soft-enforcement record. Pre-Phase-4 the call was logged + allowed; under Phase 4 the dispatcher denies these (see Denied rows). Surface for retro investigation only.',
  grant_check_pass: 'Tool call that passed the grant check. Recorded for completeness; high volume.',
  grant_miss_hard: 'Tool call denied at the grant gate. The 403 body shape is in `payload.expected_grant` / `payload.agent_roles`.',
};

function rolesAuditHtml(rbacMode) {
  // EP-022 / WA-100: when the workspace is in `off` mode the
  // dispatcher writes no audit rows for new calls; existing rows from
  // prior `enforce` / `soft` periods still render. Banner makes the
  // gap explicit so operators don't read low row counts as "things
  // are quiet" when the truth is "no audit at all."
  const offBanner = rbacMode === 'off'
    ? '<div class="rbac-audit-off-banner">RBAC is off for this workspace. Showing historical audit only.</div>'
    : '';
  return '<div class="audit-page" data-rbac-audit-page>' +
    offBanner +
    rolesAuditSummaryHtml() +
    rolesAuditAdminToolbarHtml() +
    rolesAuditFilterHtml() +
    rolesAuditListHtml() +
    rolesAuditPaginationHtml() +
    '</div>';
}

// Phase 4 slice 4-9 / WA-090: surfaces admin actions (CSV export). The
// button is rendered only when the workspace's audit-admin grant is
// satisfied — without `audit_admin`, the row is empty and the GET
// /audit/export call would 403. Source of truth is the `permissions`
// object on the /audit response.
function rolesAuditAdminToolbarHtml() {
  if (!rbacAuditPermissions || !rbacAuditPermissions.audit_admin) return '';
  return '<div class="audit-admin-toolbar">' +
    '<button type="button" class="btn secondary" data-action="rbac-audit-export-csv">Export CSV</button>' +
    '<span class="audit-admin-toolbar-hint">Requires audit_admin grant.</span>' +
    '</div>';
}

function rolesAuditSummaryHtml() {
  const s = rbacAuditSummary || { violations24h: 0, violations7d: 0, passes24h: 0, actorsWithMisses24h: 0 };
  const violationCard = function(num, suffix, warn) {
    return '<div class="audit-summary-card' + (warn && num > 0 ? ' warn' : '') + '">' +
      '<div><div class="num">' + esc(String(num)) + '<span class="num-suffix">' + esc(suffix) + '</span></div>' +
      '<div class="lbl">Violations</div></div></div>';
  };
  return '<div class="audit-summary-row">' +
    violationCard(s.violations24h, '/last 24h', true) +
    violationCard(s.violations7d, '/last 7d', false) +
    '<div class="audit-summary-card"><div><div class="num">' + esc(String(s.passes24h)) + '<span class="num-suffix">/last 24h</span></div><div class="lbl">Grant checks (pass)</div></div></div>' +
    '<div class="audit-summary-card"><div><div class="num">' + esc(String(s.actorsWithMisses24h)) + '</div><div class="lbl">Agents w/ misses</div></div></div>' +
    '</div>';
}

function rolesAuditFilterHtml() {
  const kindPill = function(kind) {
    const active = rbacAuditFilterKind === kind;
    return '<button type="button" class="filter-pill' + (active ? ' active' : '') + '"' +
      ' data-action="rbac-audit-set-kind" data-audit-kind="' + esc(kind) + '"' +
      ' title="' + esc(RBAC_AUDIT_KIND_TOOLTIPS[kind] || '') + '">' +
      esc(RBAC_AUDIT_KIND_LABELS[kind] || kind) +
      '</button>';
  };
  const windowPill = function(label, value) {
    const active = rbacAuditFilterWindow === value;
    return '<button type="button" class="filter-pill' + (active ? ' active' : '') + '"' +
      ' data-action="rbac-audit-set-window" data-audit-window="' + esc(value) + '">' +
      esc(label) +
      '</button>';
  };
  return '<div class="audit-filter-row">' +
    '<span class="filter-label">Kind</span>' +
    kindPill('grant_miss_hard') +
    kindPill('grant_miss_soft') +
    kindPill('grant_check_pass') +
    '<span class="filter-label" style="margin-left:8px">Window</span>' +
    windowPill('24h', '24h') +
    windowPill('7d', '7d') +
    windowPill('All', 'all') +
    '<span class="filter-spacer"></span>' +
    (rbacAuditFilterActor || rbacAuditFilterKind !== 'grant_miss_hard' || rbacAuditFilterWindow !== '24h'
      ? '<button type="button" class="filter-clear" data-action="rbac-audit-clear-filters">Clear filters</button>'
      : '') +
    '<button type="button" class="btn small" data-action="rbac-audit-refresh"' + (rbacAuditLoading ? ' disabled' : '') + '>' + (rbacAuditLoading ? 'Refreshing…' : 'Refresh') + '</button>' +
    '</div>';
}

function rolesAuditListHtml() {
  if (rbacAuditLoading && !rbacAuditEntries) {
    return '<div class="audit-list"><div class="audit-empty"><strong>Loading audit log…</strong></div></div>';
  }
  if (rbacAuditError) {
    return '<div class="audit-list"><div class="audit-empty"><strong>Failed to load:</strong>' + esc(rbacAuditError) + '</div></div>';
  }
  const entries = rbacAuditEntries || [];
  if (entries.length === 0) {
    return '<div class="audit-list"><div class="audit-empty"><strong>No audit entries match.</strong>No matching rows in the selected window. Adjust filters or widen the window.</div></div>';
  }
  const head = '<thead><tr>' +
    '<th style="width:130px">Time</th>' +
    '<th class="col-actor-roles" style="width:180px">Agent</th>' +
    '<th>Tool</th>' +
    '<th style="width:280px">Grant check</th>' +
    '<th class="col-target">Target</th>' +
    '<th style="width:130px">Kind</th>' +
    '<th style="width:60px"></th>' +
    '</tr></thead>';
  const rows = entries.map(rolesAuditRowHtml).join('');
  return '<div class="audit-list"><table class="audit-table">' + head + '<tbody>' + rows + '</tbody></table></div>';
}

function rolesAuditRowHtml(entry) {
  const isMiss = entry.kind === 'grant_miss_soft' || entry.kind === 'grant_miss_hard';
  const isOpen = rbacAuditExpanded.has(entry.id);
  const ts = formatAuditTs(entry.ts);
  const payload = entry.payload || {};
  const expectedGrant = payload.expected_grant || {};
  const matchKind = payload.match || (isMiss ? 'has-none' : 'has-exact');
  const matchedScope = payload.matched_scope ?? null;
  const expectedPill = '<span class="grant-pill expected"><span class="lbl">expected</span> ' +
    esc(formatGrantTriple(expectedGrant.kind, expectedGrant.value, expectedGrant.scope)) + '</span>';
  let hasPill;
  if (matchKind === 'has-exact') {
    hasPill = '<span class="grant-pill has-exact"><span class="lbl">has</span> exact</span>';
  } else if (matchKind === 'has-close') {
    hasPill = '<span class="grant-pill has-close"><span class="lbl">has</span> ' + esc(formatGrantTriple(expectedGrant.kind, expectedGrant.value, matchedScope)) + '</span>';
  } else {
    hasPill = '<span class="grant-pill has-none"><span class="lbl">has</span> none</span>';
  }
  const target = entry.target_kind ? '<strong>' + esc(entry.target_id || '') + '</strong><br/>' + esc(entry.target_kind) : '—';
  const kindLabel = RBAC_AUDIT_KIND_LABELS[entry.kind] || entry.kind;
  const kindClass = isMiss ? '' : ' pass';
  const actorRoles = Array.isArray(payload.agent_roles) ? payload.agent_roles.join(', ') : '';
  const chevron = isOpen ? '▴' : '▾';
  const tool = typeof payload.tool === 'string' ? payload.tool : entry.kind;
  const rowOpenClass = (isMiss ? ' miss' : '') + (isOpen ? ' open' : '');
  const detailRow = isOpen ? rolesAuditDetailHtml(entry) : '';
  return '<tr class="audit-row' + rowOpenClass + '">' +
    '<td class="ts-cell"><strong>' + esc(ts.time) + '</strong>' + esc(ts.date) + '</td>' +
    '<td class="col-actor-roles"><span class="actor-cell">' + esc(formatAuditActor(entry)) + '</span>' +
      (actorRoles ? '<span class="actor-roles">' + esc(actorRoles) + '</span>' : '') + '</td>' +
    '<td class="tool-cell">' + esc(tool) + '</td>' +
    '<td><div class="grant-cell">' + expectedPill + hasPill + '</div></td>' +
    '<td class="col-target target-cell">' + target + '</td>' +
    '<td><span class="kind-cell' + kindClass + '" title="' + esc(RBAC_AUDIT_KIND_TOOLTIPS[entry.kind] || '') + '">' + esc(kindLabel) + '</span></td>' +
    '<td><button type="button" class="btn ghost small" data-action="rbac-audit-toggle-row" data-audit-id="' + esc(entry.id) + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '">' + chevron + '</button></td>' +
    '</tr>' + detailRow;
}

function rolesAuditDetailHtml(entry) {
  const payload = entry.payload || {};
  const rolesList = Array.isArray(payload.agent_roles) ? '[' + payload.agent_roles.join(', ') + ']' : '—';
  const outcome = typeof payload.outcome === 'string' ? payload.outcome : '—';
  const expectedGrant = payload.expected_grant || {};
  const fix = rolesAuditSuggestedFix(entry);
  return '<tr class="audit-row-detail"><td colspan="7"><div class="detail-body">' +
    '<div class="detail-key">Audit id</div><div class="detail-val">' + esc(entry.id) + '</div>' +
    '<div class="detail-key">Internal kind</div><div class="detail-val">' + esc(entry.kind) + '</div>' +
    '<div class="detail-key">Actor</div><div class="detail-val">' + esc(formatAuditActor(entry)) + '</div>' +
    '<div class="detail-key">Actor agent_id</div><div class="detail-val">' + esc(entry.actor_agent_id || '—') + '</div>' +
    '<div class="detail-key">Roles at time of call</div><div class="detail-val">' + esc(rolesList) + '</div>' +
    '<div class="detail-key">Expected grant</div><div class="detail-val">' + esc(formatGrantTriple(expectedGrant.kind, expectedGrant.value, expectedGrant.scope)) + '</div>' +
    '<div class="detail-key">Outcome</div><div class="detail-val">' + esc(outcome) + '</div>' +
    (fix ? '<div class="detail-key">Suggested fix</div><div class="detail-val">' + esc(fix) + '</div>' : '') +
    '<div class="detail-key">Raw payload</div><div class="detail-val"><pre>' + esc(JSON.stringify(payload, null, 2)) + '</pre></div>' +
    '</div></td></tr>';
}

function rolesAuditSuggestedFix(entry) {
  const payload = entry.payload || {};
  if (entry.kind !== 'grant_miss_soft' && entry.kind !== 'grant_miss_hard') return '';
  const matchKind = payload.match;
  const expected = payload.expected_grant || {};
  const tool = payload.tool || '';
  if (matchKind === 'has-close') {
    return 'Agent has ' + (expected.kind || '') + ':' + (expected.value || '') + ' but at narrower scope (' +
      (payload.matched_scope ?? 'unset') + '). Either reassign the agent so the action targets its own scope, broaden the role to scope=any, or hand off to an agent with a wider grant.';
  }
  if (matchKind === 'has-none') {
    return 'Agent has no ' + (expected.kind || '') + ':' + (expected.value || '') + ' grant. Add the grant to one of the agent’s roles, assign a role that already has it, or hand the action to an agent that does.';
  }
  return 'Tool ' + tool + ' missed grant ' + (expected.kind || '') + ':' + (expected.value || '') + '. Review the role assignments.';
}

function rolesAuditPaginationHtml() {
  const p = rbacAuditPagination;
  const start = (p.total === 0) ? 0 : p.offset + 1;
  const end = Math.min(p.total, p.offset + p.limit);
  const filterLabel = (RBAC_AUDIT_KIND_LABELS[rbacAuditFilterKind] || rbacAuditFilterKind) + ' · ' + (rbacAuditFilterWindow === 'all' ? 'all time' : 'last ' + rbacAuditFilterWindow);
  return '<div class="audit-pagination">' +
    '<span class="pag-info">Showing <strong>' + esc(String(start)) + '–' + esc(String(end)) + '</strong> of <strong>' + esc(String(p.total)) + '</strong> entries · ' + esc(filterLabel) + '</span>' +
    '<div class="pag-buttons">' +
      '<button type="button" class="btn small" data-action="rbac-audit-prev"' + (p.offset === 0 ? ' disabled' : '') + '>‹ Prev</button>' +
      '<button type="button" class="btn small" data-action="rbac-audit-next"' + (end >= p.total ? ' disabled' : '') + '>Next ›</button>' +
    '</div></div>';
}

function formatAuditActor(entry) {
  // Prefer the joined `<repo>:<agent>` display id from the server. Fall
  // back to a short UUID prefix when the agent has been deleted (display
  // id resolves to NULL) — full UUID still surfaces in the detail row.
  if (entry && entry.actor_display_id) return entry.actor_display_id;
  if (entry && entry.actor_agent_id) {
    const id = String(entry.actor_agent_id);
    return id.length > 12 ? id.slice(0, 8) + '… (deleted)' : id;
  }
  return '—';
}

function formatAuditTs(iso) {
  // Keep the format simple + locale-stable. Operator just needs a
  // sortable timestamp; the absolute date sits below the time.
  if (!iso) return { time: '—', date: '' };
  try {
    const d = new Date(iso);
    const time = d.toISOString().slice(11, 19);
    const date = d.toISOString().slice(0, 10);
    return { time, date };
  } catch {
    return { time: iso, date: '' };
  }
}

function formatGrantTriple(kind, value, scope) {
  const k = kind || '?';
  const v = value || '?';
  const s = scope === undefined || scope === null ? 'any' : String(scope);
  return k + ':' + v + ' (' + s + ')';
}

async function loadRbacAudit() {
  rbacAuditLoading = true;
  rbacAuditError = '';
  renderSettings();
  try {
    const params = new URLSearchParams();
    params.set('kind', rbacAuditFilterKind);
    params.set('limit', String(rbacAuditPagination.limit));
    params.set('offset', String(rbacAuditPagination.offset));
    if (rbacAuditFilterActor) params.set('actor_agent_id', rbacAuditFilterActor);
    if (rbacAuditFilterWindow !== 'all') {
      const hours = rbacAuditFilterWindow === '24h' ? 24 : 24 * 7;
      const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
      params.set('since', since);
    }
    const res = await workspaceFetch('/audit?' + params.toString());
    const body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'audit load failed');
    rbacAuditEntries = body.entries || [];
    rbacAuditSummary = body.summary || null;
    rbacAuditPagination = body.pagination || rbacAuditPagination;
    rbacAuditPermissions = body.permissions || { audit_read: false, audit_admin: false };
    rbacAuditLastLoadAt = Date.now();
  } catch (e) {
    rbacAuditError = String(e?.message || e);
  } finally {
    rbacAuditLoading = false;
    renderSettings();
  }
}

// Phase 4 slice 4-9 / WA-090: trigger a CSV download of the current
// audit view. Reuses the same filter state as the table so the export
// mirrors what the operator sees. Server gates on audit_admin; this
// path only fires when the toolbar button rendered (audit_admin true).
async function exportRbacAuditCsv() {
  const params = new URLSearchParams();
  params.set('kind', rbacAuditFilterKind);
  if (rbacAuditFilterActor) params.set('actor_agent_id', rbacAuditFilterActor);
  if (rbacAuditFilterWindow !== 'all') {
    const hours = rbacAuditFilterWindow === '24h' ? 24 : 24 * 7;
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    params.set('since', since);
  }
  // Force a generous limit so the export captures the whole filtered window.
  params.set('limit', '10000');
  try {
    const res = await workspaceFetch('/audit/export?' + params.toString());
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || ('export failed (' + res.status + ')'));
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'audit-export-' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    rbacAuditError = String(e?.message || e);
    renderSettings();
  }
}

function rolesRowHtml(role) {
  const expanded = rbacExpanded.has(role.id);
  const counts = rbacRoleSummaryCounts(role);
  const builtinChip = role.is_builtin === 1
    ? '<span class="role-builtin"><span class="lock-glyph" aria-hidden="true">🔒</span>Built-in</span>'
    : '<span class="role-custom-chip">Custom</span>';
  const summaryParts = [
    '<span><strong>' + counts.tool_family + '</strong> tools visible</span>',
    '<span><strong>' + counts.kanban_action + '</strong> kanban actions</span>',
    '<span><strong>' + counts.comment_type + '</strong> comment types</span>',
  ];
  const summary = summaryParts.join('<span class="pip" aria-hidden="true"></span>');
  const chevron = '<span class="role-chevron" aria-hidden="true">' + (expanded ? '▾' : '❯') + '</span>';
  const description = (role.description || '').trim();
  const desc = description
    ? '<span class="role-desc" ' + truncatedAttrs(description) + '>' + esc(description) + '</span>'
    : '<span class="role-desc role-desc-empty">No description.</span>';
  return '<article class="role-row ' + (expanded ? 'expanded' : '') + '" role="listitem">' +
    '<button type="button" class="role-row-header" aria-expanded="' + (expanded ? 'true' : 'false') + '" data-action="rbac-toggle-role-row" data-role-id="' + esc(role.id) + '">' +
      '<span class="role-icon" aria-hidden="true">' + esc(rbacRoleAvatarLetter(role.name)) + '</span>' +
      '<div class="role-name-cell">' +
        '<span class="role-name">' + esc(role.name) + '</span>' +
        builtinChip +
      '</div>' +
      desc +
      '<span class="role-summary">' + summary + '</span>' +
      chevron +
    '</button>' +
    (expanded ? rolesRowBodyHtml(role) : '') +
    '</article>';
}

function rolesRowBodyHtml(role) {
  const isBuiltin = role.is_builtin === 1;
  const saving = rbacSaving.has(role.id);
  const nameField = isBuiltin
    ? '<input id="rbac-name-' + esc(role.id) + '" type="text" value="' + esc(role.name || '') + '" readonly aria-readonly="true" data-rbac-role-name="' + esc(role.id) + '" />'
        + '<span class="role-field-help">Built-in roles can&apos;t be renamed.</span>'
    : '<input id="rbac-name-' + esc(role.id) + '" type="text" value="' + esc(role.name || '') + '" data-rbac-role-name="' + esc(role.id) + '" />'
        + '<span class="role-field-help">Letters, digits, hyphen, underscore. Names are normalized to lowercase.</span>';
  return '<div class="role-row-body">' +
    '<div class="role-field-row">' +
      '<div class="role-field">' +
        '<label for="rbac-name-' + esc(role.id) + '">Name</label>' +
        nameField +
      '</div>' +
      '<div class="role-field">' +
        '<label for="rbac-desc-' + esc(role.id) + '">Description</label>' +
        '<textarea id="rbac-desc-' + esc(role.id) + '" rows="3" data-rbac-role-desc="' + esc(role.id) + '">' + esc(role.description || '') + '</textarea>' +
        '<span class="role-field-help">Shown in the role picker and on agent tooltips.</span>' +
      '</div>' +
    '</div>' +
    rolesGrantsEditorHtml(role) +
    '<div class="role-row-footer">' +
      '<span class="role-meta">' +
        '<span>id</span><code>' + esc(role.id) + '</code>' +
        '<span>·</span>' +
        '<span>source</span><code>' + (isBuiltin ? 'built-in' : 'custom') + '</code>' +
      '</span>' +
      rolesRowSaveStatusHtml(role) +
      '<span class="role-actions">' +
        (!isBuiltin
          ? '<button type="button" class="btn secondary small role-delete-btn" data-action="rbac-delete-role" data-role-id="' + esc(role.id) + '"' + (rbacDeleting.has(role.id) ? ' disabled aria-disabled="true"' : '') + '>' + (rbacDeleting.has(role.id) ? 'Deleting…' : 'Delete role') + '</button>'
          : '') +
        '<button type="button" class="btn primary small" data-action="rbac-save-role" data-role-id="' + esc(role.id) + '"' + (saving ? ' disabled aria-disabled="true"' : '') + '>' +
          (saving ? 'Saving…' : 'Save changes') +
        '</button>' +
      '</span>' +
    '</div>' +
    '</div>';
}

function rolesRowSaveStatusHtml(role) {
  const s = rbacRoleSaveStatus[role.id];
  if (!s || !s.text) return '';
  const kindClass = s.kind === 'err' ? ' role-save-status-err' : ' role-save-status-ok';
  return '<span class="role-save-status' + kindClass + '" role="status" aria-live="polite">' + esc(s.text) + '</span>';
}

function ensureGrantDraft(role) {
  if (!rbacGrantDraft[role.id]) {
    rbacGrantDraft[role.id] = (role.grants || []).map(g => ({
      grant_kind: g.grant_kind,
      grant_value: g.grant_value,
      scope_qualifier: g.scope_qualifier ?? null,
    }));
  }
  return rbacGrantDraft[role.id];
}

function draftHasGrant(draft, kind, value) {
  return draft.some(g => g.grant_kind === kind && g.grant_value === value);
}

function rolesGrantsEditorHtml(role) {
  const draft = ensureGrantDraft(role);
  // Build a unified category list — boolean categories first then the
  // Kanban-actions category — so the per-role tabbar can switch between
  // them. Default tab: 'tool_family'.
  const allCategories = [
    ...RBAC_BOOLEAN_GRANT_CATEGORIES.slice(0, 1),  // tool_family
    { kind: 'kanban_action', label: 'Kanban actions' },
    ...RBAC_BOOLEAN_GRANT_CATEGORIES.slice(1),     // comment_type, channel_action, audit_grant, meta
  ];
  const activeKind = rbacGrantTab[role.id] || allCategories[0].kind;

  const grantCountByKind = (kind) => kind === 'kanban_action'
    ? draft.filter(g => g.grant_kind === 'kanban_action').length
    : draft.filter(g => g.grant_kind === kind).length;

  const tabbar = '<div class="grant-category-tabbar" role="tablist" aria-label="Permission categories">' +
    allCategories.map(cat => {
      const isActive = cat.kind === activeKind;
      return '<button type="button" role="tab" class="grant-category-tab' + (isActive ? ' active' : '') + '" aria-selected="' + (isActive ? 'true' : 'false') + '" data-action="rbac-select-grant-tab" data-role-id="' + esc(role.id) + '" data-grant-tab="' + esc(cat.kind) + '">' +
        esc(cat.label) +
        ' <span class="gc-count">' + grantCountByKind(cat.kind) + '</span>' +
      '</button>';
    }).join('') +
    '</div>';

  let body = '';
  if (activeKind === 'kanban_action') {
    body = rolesKanbanCategoryHtml(role, draft);
  } else {
    const cat = RBAC_BOOLEAN_GRANT_CATEGORIES.find(c => c.kind === activeKind);
    if (cat) body = rolesBooleanCategoryHtml(role, draft, cat);
  }

  return '<div class="role-grants" role="group" aria-label="Permissions">' +
    tabbar +
    '<div class="grant-category-body" role="tabpanel">' + body + '</div>' +
    '</div>';
}

function rolesBooleanCategoryHtml(role, draft, category) {
  const checkedCount = category.items.filter(item => draftHasGrant(draft, category.kind, item.value)).length;
  const chips = category.items.map(item => {
    const checked = draftHasGrant(draft, category.kind, item.value);
    return '<label class="grant-chip ' + (checked ? 'checked' : '') + '">' +
      '<input type="checkbox" class="grant-chip-input" data-action="rbac-toggle-grant" data-role-id="' + esc(role.id) + '" data-grant-kind="' + esc(category.kind) + '" data-grant-value="' + esc(item.value) + '"' + (checked ? ' checked' : '') + ' />' +
      '<span class="gc-mark" aria-hidden="true">' + (checked ? '✓' : '') + '</span>' +
      '<span class="grant-chip-text">' +
        '<span class="grant-chip-id">' + esc(item.value) + '</span>' +
        '<span class="grant-chip-desc">' + esc(item.desc) + '</span>' +
      '</span>' +
    '</label>';
  }).join('');
  return '<section class="grant-category">' +
    '<header class="grant-category-head">' +
      '<h4>' + esc(category.label) + '</h4>' +
      '<span class="grant-category-count"><strong>' + checkedCount + '</strong>/' + category.items.length + '</span>' +
    '</header>' +
    '<p class="grant-category-hint">' + esc(category.hint) + '</p>' +
    '<div class="grant-chip-list">' + chips + '</div>' +
    '</section>';
}

function rolesKanbanCategoryHtml(role, draft) {
  // Kanban actions: grant_value × scope chip grid. Each row is one Kanban
  // mutation; chips inside select valid scope qualifiers. Multiple chips
  // can be checked per row (additive scopes — useful for `comment_task`'s
  // `own_assignment` ∪ `created_by_self` engineer default). The "any" chip
  // maps to `scope_qualifier = NULL` (unrestricted).
  const kanbanRows = RBAC_KANBAN_ACTION_GRANTS.map(action => {
    const checkedScopes = draft
      .filter(g => g.grant_kind === 'kanban_action' && g.grant_value === action.value)
      .map(g => qualifierToScopeChip(g.scope_qualifier));
    const checkedSet = new Set(checkedScopes);
    const chips = action.scopes.map(scope => {
      const checked = checkedSet.has(scope);
      return '<label class="grant-chip grant-scope-chip ' + (checked ? 'checked' : '') + '">' +
        '<input type="checkbox" class="grant-chip-input" data-action="rbac-toggle-kanban-grant" data-role-id="' + esc(role.id) + '" data-grant-value="' + esc(action.value) + '" data-scope="' + esc(scope) + '"' + (checked ? ' checked' : '') + ' />' +
        '<span class="gc-mark" aria-hidden="true">' + (checked ? '✓' : '') + '</span>' +
        '<span class="grant-chip-id">' + esc(RBAC_SCOPE_LABELS[scope] || scope) + '</span>' +
      '</label>';
    }).join('');
    return '<div class="grant-action-row ' + (checkedSet.size > 0 ? 'checked' : '') + '">' +
      '<div class="grant-action-head">' +
        '<span class="grant-action-name">' + esc(action.value) + '</span>' +
        '<span class="grant-action-desc">' + esc(action.desc) + '</span>' +
      '</div>' +
      '<div class="grant-action-scopes">' + chips + '</div>' +
    '</div>';
  }).join('');
  const kanbanCheckedCount = draft.filter(g => g.grant_kind === 'kanban_action').length;
  return '<section class="grant-category grant-category-kanban">' +
    '<header class="grant-category-head"><h4>Kanban actions</h4><span class="grant-category-count"><strong>' + kanbanCheckedCount + '</strong>/' + RBAC_KANBAN_ACTION_GRANTS.length + ' actions</span></header>' +
    '<p class="grant-category-hint">Per-mutation Kanban grants. Requires the matching kanban-* family on the Tools visibility tab (kanban-status for status moves, kanban-admin for archive/close-epic, kanban-comment for comment_task/comment_epic). Tick the scopes the role may act under; <code>any</code> means unrestricted, <code>own_assignment</code> means the agent must be the assignee, <code>created_by_self</code> means the agent must be the creator. Multiple scopes per row stack additively.</p>' +
    '<div class="grant-action-list">' + kanbanRows + '</div>' +
    '</section>';
}

async function loadRbacRoles() {
  rbacRolesLoading = true;
  rbacRolesStatus = '';
  try {
    const res = await workspaceFetch('/rbac/roles');
    const body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'rbac roles load failed');
    rbacRoles = Array.isArray(body.roles) ? body.roles : [];
  } catch (e) {
    rbacRolesStatus = 'Failed to load roles: ' + String(e?.message || e);
  } finally {
    rbacRolesLoading = false;
    if (getPage() === 'settings' && getSelectedSettingsTab() === 'roles') renderSettings();
  }
}

function rbacRoleById(id) {
  return Array.isArray(rbacRoles) ? rbacRoles.find(r => r.id === id) : null;
}

function toggleRbacGrant(roleId, kind, value) {
  const role = rbacRoleById(roleId);
  if (!role) return;
  const draft = ensureGrantDraft(role);
  const idx = draft.findIndex(g => g.grant_kind === kind && g.grant_value === value);
  if (idx >= 0) {
    draft.splice(idx, 1);
  } else {
    draft.push({ grant_kind: kind, grant_value: value, scope_qualifier: null });
  }
  syncGrantChipDom(roleId);
}

function toggleRbacKanbanGrant(roleId, grantValue, scopeChip) {
  const role = rbacRoleById(roleId);
  if (!role || !grantValue || !scopeChip) return;
  const draft = ensureGrantDraft(role);
  const targetScope = scopeChipToQualifier(scopeChip);
  const idx = draft.findIndex(g =>
    g.grant_kind === 'kanban_action'
    && g.grant_value === grantValue
    && (g.scope_qualifier ?? null) === targetScope,
  );
  if (idx >= 0) {
    draft.splice(idx, 1);
  } else {
    draft.push({ grant_kind: 'kanban_action', grant_value: grantValue, scope_qualifier: targetScope });
  }
  syncGrantChipDom(roleId);
}

/**
 * After mutating the draft for a chip toggle, mirror the chip state in the
 * DOM without a full re-render (which would steal focus from the description
 * textarea). Called from the boolean and Kanban toggle handlers.
 */
function syncGrantChipDom(roleId) {
  // Boolean chips: query each input by data attrs and reflect into label.
  const inputs = document.querySelectorAll(
    'input.grant-chip-input[data-role-id="' + roleId + '"]',
  );
  inputs.forEach((input) => {
    const label = input.closest('.grant-chip');
    if (!label) return;
    label.classList.toggle('checked', input.checked);
    const mark = label.querySelector('.gc-mark');
    if (mark) mark.textContent = input.checked ? '✓' : '';
  });
  // Kanban action row "checked" parent: any scope checked → row gets accent.
  const rows = document.querySelectorAll('.grant-action-row');
  rows.forEach((row) => {
    const anyChecked = row.querySelector('input.grant-chip-input:checked');
    row.classList.toggle('checked', Boolean(anyChecked));
  });
}

async function saveRbacRole(id) {
  if (!id) return;
  const role = rbacRoleById(id);
  if (!role) return;
  // Read current input values straight from the DOM (uncontrolled inputs).
  // Role ids are UUIDs but `getElementById` is bullet-proof regardless of
  // characters, so prefer that over a CSS selector.
  const nameInput = document.getElementById('rbac-name-' + id);
  const descInput = document.getElementById('rbac-desc-' + id);
  const isBuiltin = role.is_builtin === 1;
  const patch = {};
  if (!isBuiltin && nameInput) {
    const next = (nameInput.value || '').trim();
    if (next !== role.name) patch.name = next;
  }
  if (descInput) {
    const next = descInput.value || '';
    if (next !== (role.description || '')) patch.description = next;
  }
  // Detect grant draft drift vs server-side current grants.
  const draft = ensureGrantDraft(role);
  const grantsDirty = !grantsEqual(draft, role.grants || []);

  if (Object.keys(patch).length === 0 && !grantsDirty) {
    rbacRoleSaveStatus[id] = { kind: 'ok', text: 'Nothing to save.' };
    renderSettings();
    return;
  }
  rbacSaving.add(id);
  delete rbacRoleSaveStatus[id];
  renderSettings();
  try {
    let nextRole = role;
    if (Object.keys(patch).length > 0) {
      const res = await workspaceFetch('/rbac/roles/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (!res.ok || body.ok === false) throw new Error(body.error || 'save failed');
      if (body.role) nextRole = body.role;
    }
    if (grantsDirty) {
      const res = await workspaceFetch('/rbac/roles/' + encodeURIComponent(id) + '/grants', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grants: draft }),
      });
      const body = await res.json();
      if (!res.ok || body.ok === false) throw new Error(body.error || 'grants save failed');
      if (body.role) nextRole = body.role;
    }
    if (Array.isArray(rbacRoles) && nextRole) {
      rbacRoles = rbacRoles.map(r => r.id === id ? nextRole : r);
    }
    delete rbacGrantDraft[id];
    rbacRoleSaveStatus[id] = { kind: 'ok', text: 'Saved ' + (nextRole?.name || '') + '.' };
  } catch (e) {
    rbacRoleSaveStatus[id] = { kind: 'err', text: 'Failed to save: ' + String(e?.message || e) };
  } finally {
    rbacSaving.delete(id);
    renderSettings();
  }
}

function openRbacAddRoleModal() {
  rbacAddModalOpen = true;
  rbacAddModalStatus = '';
  renderSettings();
  // Defer focus until DOM is mounted.
  requestAnimationFrame(() => {
    const input = document.getElementById('rbacAddRoleName');
    input?.focus();
  });
}

function closeRbacAddRoleModal() {
  rbacAddModalOpen = false;
  rbacAddModalStatus = '';
  rbacAddModalSaving = false;
  renderSettings();
}

async function submitAddRbacRole() {
  if (rbacAddModalSaving) return;
  const nameInput = document.getElementById('rbacAddRoleName');
  const descInput = document.getElementById('rbacAddRoleDesc');
  const name = (nameInput?.value || '').trim();
  const description = (descInput?.value || '').trim();
  if (!name) {
    rbacAddModalStatus = 'Name is required.';
    renderSettings();
    return;
  }
  rbacAddModalSaving = true;
  rbacAddModalStatus = '';
  renderSettings();
  try {
    const res = await workspaceFetch('/rbac/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    });
    const body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'failed');
    if (body.role) {
      const roles = Array.isArray(rbacRoles) ? rbacRoles.slice() : [];
      roles.push(body.role);
      rbacRoles = roles;
      // Auto-expand so user lands on the new role's editor.
      rbacExpanded.add(body.role.id);
    }
    rbacAddModalOpen = false;
    rbacAddModalStatus = '';
    rbacRolesStatus = 'Added role "' + esc(name) + '".';
  } catch (e) {
    rbacAddModalStatus = String(e?.message || e);
  } finally {
    rbacAddModalSaving = false;
    renderSettings();
  }
}

/**
 * EP-022 / WA-100: flip the current workspace's RBAC mode via the
 * dedicated PATCH endpoint. Click handler on the
 * `rbac-select-workspace-mode` button row above the Roles inner
 * tabbar. Flip-to-`off` goes through `openConfirm` first because the
 * dispatcher then writes no audit rows + skips the visibility filter
 * for already-running agents (relaunch needed); operators benefit
 * from a confirmation before the dial-down.
 */
async function selectWorkspaceRbacMode(next) {
  if (next !== 'enforce' && next !== 'soft' && next !== 'off') return;
  const localState = getState();
  const wsId = localState.currentWorkspace && localState.currentWorkspace.id;
  if (!wsId) return;
  const previous = localState.currentWorkspace.rbac_mode || 'enforce';
  if (previous === next) return;
  if (next === 'off') {
    const confirmed = await openConfirm({
      title: 'Disable RBAC for this workspace?',
      body: 'New tool calls will not be checked or audited. Live agents need to relaunch to pick up the change. Continue?',
      confirmLabel: 'Turn RBAC off',
      danger: true,
    });
    if (!confirmed) return;
  }
  try {
    const res = await workspaceFetch('/rbac-mode', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rbacMode: next }),
    });
    const body = await res.json().catch(function () { return {}; });
    if (!res.ok || body.ok === false) throw new Error(body.error || 'mode change failed');
    patchState({
      currentWorkspace: { ...localState.currentWorkspace, rbac_mode: next },
    });
    rbacRolesStatus = 'RBAC mode set to ' + next + '.';
  } catch (e) {
    rbacRolesStatus = 'Failed to change RBAC mode: ' + String(e?.message || e);
  }
  renderSettings();
}

async function deleteRbacRole(id) {
  if (!id) return;
  const role = rbacRoleById(id);
  if (!role) return;
  if (role.is_builtin === 1) {
    rbacRolesStatus = 'Built-in roles cannot be deleted.';
    renderSettings();
    return;
  }
  const ok = await openConfirm({
    title: 'Delete role?',
    body: 'Delete role "' + (role.name || 'this role') + '"? Agents currently assigned to it will need a different role first.',
    confirmLabel: 'Delete role',
    danger: true,
  });
  if (!ok) return;
  rbacDeleting.add(id);
  rbacRolesStatus = '';
  renderSettings();
  try {
    const res = await workspaceFetch('/rbac/roles/' + encodeURIComponent(id), { method: 'DELETE' });
    const body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'delete failed');
    rbacRoles = (rbacRoles || []).filter(r => r.id !== id);
    rbacExpanded.delete(id);
    delete rbacGrantDraft[id];
    rbacRolesStatus = 'Deleted role "' + (role.name || '') + '".';
  } catch (e) {
    rbacRolesStatus = 'Failed to delete: ' + String(e?.message || e);
  } finally {
    rbacDeleting.delete(id);
    renderSettings();
  }
}

function grantsEqual(a, b) {
  if (a.length !== b.length) return false;
  // Order-insensitive comparison keyed on (kind, value, scope-or-empty).
  const key = g => g.grant_kind + '\x00' + g.grant_value + '\x00' + (g.scope_qualifier ?? '');
  const aSet = new Set(a.map(key));
  for (const g of b) if (!aSet.has(key(g))) return false;
  return true;
}

const ABOUT_NETWORK_NODES: ReadonlyArray<readonly [number, number]> = [
  [60, 40], [180, 90], [120, 200], [40, 300], [280, 50], [340, 180],
  [260, 300], [440, 60], [480, 240], [600, 40], [640, 140], [560, 250],
  [660, 340], [780, 80], [820, 220], [740, 340], [30, 380], [200, 420],
  [420, 400], [620, 420], [800, 400],
];
const ABOUT_NETWORK_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [1, 4], [4, 5], [5, 6], [2, 6], [4, 7], [7, 8],
  [5, 8], [8, 9], [9, 10], [10, 11], [11, 12], [10, 13], [13, 14], [14, 15],
  [2, 17], [17, 18], [6, 18], [12, 19], [15, 20], [11, 19], [19, 20], [3, 16], [16, 17],
];
const ABOUT_ICON_ACCENTS = new Set(['indigo', 'violet', 'blue', 'teal', 'rose', 'amber']);

function aboutNetworkSvg(): string {
  let edges = '';
  for (const [a, b] of ABOUT_NETWORK_EDGES) {
    const p = ABOUT_NETWORK_NODES[a];
    const q = ABOUT_NETWORK_NODES[b];
    edges += '<line x1="' + p[0] + '" y1="' + p[1] + '" x2="' + q[0] + '" y2="' + q[1] + '" class="about-network-edge"/>';
  }
  let dots = '';
  for (let i = 0; i < ABOUT_NETWORK_NODES.length; i++) {
    const n = ABOUT_NETWORK_NODES[i];
    const r = i % 5 === 0 ? 5 : 3;
    dots += '<circle cx="' + n[0] + '" cy="' + n[1] + '" r="' + r + '" class="about-network-dot"/>';
  }
  return '<svg class="about-network" viewBox="0 0 860 460" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' + edges + dots + '</svg>';
}

function aboutIconAccent(): string {
  const accent = String(getPrefs().accentColor || 'indigo');
  return ABOUT_ICON_ACCENTS.has(accent) ? accent : 'indigo';
}

function aboutAppIconImg(): string {
  const accent = aboutIconAccent();
  const src = '/assets/icons/whatsagent-' + accent + '-256.png';
  const srcset = src + ' 1x, /assets/icons/whatsagent-' + accent + '-512.png 2x';
  return '<img class="about-app-icon" src="' + src + '" srcset="' + srcset + '" width="160" height="160" alt="" aria-hidden="true" decoding="async" />';
}

function aboutPanel() {
  const state = getState();
  const version = state.appVersion || '0.1.0';
  const build = state.appBuild || '';
  return '<section class="card settings-wide about-card">' +
    '<div class="about-hero">' +
      aboutNetworkSvg() +
      '<div class="about-hero-overlays" aria-hidden="true"></div>' +
      '<div class="about-hero-content">' +
        '<div class="about-hero-icon-large">' + aboutAppIconImg() + '</div>' +
        '<div class="about-hero-text">' +
          '<div class="about-wordmark">WhatsAgent</div>' +
          '<div class="about-tagline">Messaging and task tracking for coding agents.<br/>Your agents collaborate, not just compute.</div>' +
          '<a class="about-github-link" href="https://github.com/ivanmak/whatsagent" target="_blank" rel="noopener noreferrer">' +
            '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>' +
            'GitHub' +
          '</a>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="about-info">' +
      '<div class="about-info-row"><span class="about-info-label">Version</span><span class="about-info-value mono">v' + esc(version) + '-beta</span></div>' +
      '<div class="about-info-row"><span class="about-info-label">Build</span><span class="about-info-value mono">' + esc(build) + '</span></div>' +
      '<div class="about-info-row"><span class="about-info-label">Author</span><span class="about-info-value">Ivan Mak</span></div>' +
    '</div>' +
    '<div class="about-legal">' +
      '© 2026 Ivan Mak. Released under the MIT License. Portions use open-source software; see LICENSES.md for full attribution.' +
    '</div>' +
    '</section>';
}

// EP-023 / WA-106 — Settings → Diagnostics panel. Wires the
// xtermDebugCapture toggle (debug aid for WA-071 mouse failure, the
// keyboard-dead-until-refresh observation, recurring TUI distortion,
// and the stopped-session garble mockup). The panel reads live capture
// status via ctx().captureStatus() each render tick so the user sees
// events flowing while the toggle is ON.
const DIAGNOSTICS_LOG_PATH = '~/.whatsagent/logs/xterm-debug.log';
function diagnosticsPanel() {
  const prefs = getPrefs() || {};
  const status = captureStatus();
  const enabled = prefs.xtermDebugCapture === true;
  const lastFlushLabel = status.lastFlushAt > 0 ? new Date(status.lastFlushAt).toLocaleTimeString() : 'never';
  return '<section class="card card-pad settings-wide diagnostics-settings">' +
    '<div class="section-head"><div><h2>Diagnostics</h2><p>Log terminal events to file for reproducing display, scroll, and click bugs.</p></div></div>' +
    '<div class="setting-row"><span class="setting-title">Terminal debug logs</span><span class="setting-sub">When ON, mount/dispose, connection open/close, agent status, mouse + keyboard, focus, and a 5 s periodic snapshot are batched and sent to the daemon, which appends them to <span class="mono">' + esc(DIAGNOSTICS_LOG_PATH) + '</span>. Capture stops within 1 s when toggled off.</span>' +
    prefControl('xtermDebugCapture', [[true, 'On'], [false, 'Off']]) +
    '</div>' +
    '<div class="setting-row diagnostics-status"><span class="setting-title">Capture status</span><span class="setting-sub">Counts reset on page reload. Updates live while this tab is visible.</span>' +
    '<div class="diagnostics-status-grid" id="diagnosticsStatusGrid">' +
      '<div class="diagnostics-status-row"><span class="diagnostics-status-label">State</span><span class="diagnostics-status-value" id="diagnosticsStatusState">' + (enabled ? 'Capturing' : 'Off') + '</span></div>' +
      '<div class="diagnostics-status-row"><span class="diagnostics-status-label">Buffer</span><span class="diagnostics-status-value" id="diagnosticsStatusBuffer">' + esc(String(status.bufferFill)) + ' / ' + esc(String(status.bufferMax)) + '</span></div>' +
      '<div class="diagnostics-status-row"><span class="diagnostics-status-label">Shipped</span><span class="diagnostics-status-value" id="diagnosticsStatusShipped">' + esc(String(status.shippedTotal)) + '</span></div>' +
      '<div class="diagnostics-status-row"><span class="diagnostics-status-label">Dropped</span><span class="diagnostics-status-value" id="diagnosticsStatusDropped">' + esc(String(status.droppedTotal)) + '</span></div>' +
      '<div class="diagnostics-status-row"><span class="diagnostics-status-label">Last flush</span><span class="diagnostics-status-value" id="diagnosticsStatusLastFlush">' + esc(lastFlushLabel) + '</span></div>' +
      '<div class="diagnostics-status-row" id="diagnosticsStatusErrorRow" ' + (status.lastError ? '' : 'style="display:none"') + '><span class="diagnostics-status-label">Last error</span><span class="diagnostics-status-value" id="diagnosticsStatusError" style="color:var(--red, #f87171)">' + esc(status.lastError || '') + '</span></div>' +
      '<div class="diagnostics-status-row" id="diagnosticsStatusBackoffRow" ' + (status.backoffStep > 0 ? '' : 'style="display:none"') + '><span class="diagnostics-status-label">Back-off step</span><span class="diagnostics-status-value" id="diagnosticsStatusBackoff">' + esc(String(status.backoffStep)) + '</span></div>' +
    '</div>' +
    '</div>' +
    '<div class="setting-row"><span class="setting-title">Log file</span><span class="setting-sub">Append-only JSON-line log on the daemon host. Run <span class="mono">tail -f ' + esc(DIAGNOSTICS_LOG_PATH) + '</span> to follow live.</span>' +
    '<div class="diagnostics-log-row"><code class="mono diagnostics-log-path">' + esc(DIAGNOSTICS_LOG_PATH) + '</code><button class="btn secondary small" type="button" data-action="diagnostics-copy-log-path">Copy path</button><button class="btn secondary small" type="button" data-action="diagnostics-flush-now"' + (enabled ? '' : ' disabled') + '>Snapshot now</button></div>' +
    '</div>' +
    '<div class="setting-row"><span class="setting-title">Privacy</span><span class="setting-sub">Capture is metadata only. Raw terminal output, keyboard input (key / code), and clipboard / URL fields are excluded by design and the daemon recursively redacts secret-shaped keys (token, secret, password, api_key, authorization, cookie, url, href, search, hash, pathname, clipboard, selection, input, data, text, value, key, code) before writing each line.</span><div class="diagnostics-status-value" style="color:var(--muted)">No terminal bytes captured</div></div>' +
    tuiRedrawPanel() +
    pushDeliveryPanel() +
    '</section>';
}

function currentTuiRedrawSettings() {
  return getState().daemonSettings?.tuiRedraw || { workaround: 'on' };
}

function tuiRedrawPanel() {
  const settings = currentTuiRedrawSettings();
  const workaround = settings.workaround === 'off' ? 'off' : 'on';
  const savingStatus = tuiRedrawSaving ? '<span class="settings-inline-status" data-tui-redraw-status role="status" aria-live="polite">Saving…</span>' : '';
  return '<div class="setting-row diagnostics-status tui-redraw-settings"><span class="setting-title">TUI redraw workaround</span>' +
    '<span class="setting-sub">Forces a brief PTY resize when long output bursts cause render staleness in Claude Code or Codex TUIs. Recommended on.</span>' +
    '<div class="tui-redraw-controls">' +
      prefControl('tuiRedrawWorkaround', [['on', 'On'], ['off', 'Off']], { currentValue: workaround, action: 'set-tui-redraw-workaround', className: 'tui-redraw-toggle', disabled: tuiRedrawSaving }) +
      savingStatus +
    '</div>' +
    '</div>';
}

async function saveTuiRedrawSettings(workaround) {
  const next = workaround === 'off' ? 'off' : 'on';
  tuiRedrawSaving = true;
  tuiRedrawStatus = '';
  renderSettings();
  try {
    const res = await fetch(daemonApiUrl('/settings/tui-redraw'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workaround: next }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(body.error || 'Failed to save TUI redraw settings');
    const current = getState().daemonSettings || {};
    patchState({ daemonSettings: { ...current, tuiRedraw: body.tuiRedraw || { workaround: next } } });
    tuiRedrawStatus = 'Saved.';
  } catch (error) {
    tuiRedrawStatus = error?.message || String(error);
  } finally {
    tuiRedrawSaving = false;
    if (getPage() === 'settings' && getSelectedSettingsTab() === 'diagnostics') renderSettings();
  }
}

// EP-030 / WA-139 — Push delivery panel. `pushed` should idle near zero;
// a sustained pile-up signals native-push runtimes (opencode/claude) are
// accepting prompts at the SDK layer but the LLMs aren't consuming them.
// `oldestPushedAt` makes the stuck-row visible.
function pushDeliveryPanel() {
  const stats = pushStateStats || { pending: 0, pushed: 0, oldestPushedAt: null };
  const oldest = stats.oldestPushedAt ? new Date(stats.oldestPushedAt).toLocaleString() : '—';
  return '<div class="setting-row diagnostics-status"><span class="setting-title">Push delivery</span>' +
    '<span class="setting-sub"><span class="mono">pending</span> = waiting for first send to the agent. <span class="mono">pushed</span> = sent to the agent but not yet confirmed via <span class="mono">check_messages</span>. A non-zero <span class="mono">pushed</span> count that does not drop suggests the agent is not checking its inbox.</span>' +
    '<div class="diagnostics-status-grid" id="diagnosticsPushStateGrid">' +
      '<div class="diagnostics-status-row"><span class="diagnostics-status-label">Pending</span><span class="diagnostics-status-value" id="diagnosticsPushStatePending">' + esc(String(stats.pending)) + '</span></div>' +
      '<div class="diagnostics-status-row"><span class="diagnostics-status-label">Pushed</span><span class="diagnostics-status-value" id="diagnosticsPushStatePushed">' + esc(String(stats.pushed)) + '</span></div>' +
      '<div class="diagnostics-status-row"><span class="diagnostics-status-label">Oldest pushed</span><span class="diagnostics-status-value" id="diagnosticsPushStateOldest">' + esc(oldest) + '</span></div>' +
    '</div>' +
    '</div>';
}

function authSessionLabel(session) {
  return session.user_agent || 'Unknown browser';
}

function authSessionLastSeen(session) {
  return session.last_seen_at ? 'Last seen ' + session.last_seen_at : 'Last seen unknown';
}

function userPanel() {
  const user = userSettings?.user || {};
  const session = userSettings?.session || {};
  const sessions = Array.isArray(userSessions?.sessions) ? userSessions.sessions : [];
  const loading = userSettingsLoading && !userSettings ? '<div class="thread-empty" style="min-height:90px">Loading user settings…</div>' : '';
  const rows = sessions.length ? sessions.map(s => '<div class="peer-rule-row auth-session-row"><span class="auth-session-meta"><span class="auth-session-agent" ' + truncatedAttrs(authSessionLabel(s)) + '>' + esc(authSessionLabel(s)) + (s.id === userSessions.currentSessionId ? ' <strong>(current)</strong>' : '') + '</span><span class="auth-session-last-seen">' + esc(authSessionLastSeen(s)) + '</span></span><button type="button" class="btn secondary small" data-action="delete-auth-session" data-session-id="' + esc(s.id) + '">Sign out</button></div>').join('') : '<div class="peer-rule-empty">No sessions.</div>';
  return '<section class="card card-pad settings-wide user-settings"><div class="section-head"><div><h2>User</h2><p>Manage the local web account, sessions, and recovery code.</p></div></div>' + loading +
    '<div class="setting-row"><span class="setting-title">Account</span><span class="setting-sub">Local web user for this daemon.</span><div class="user-account-name mono">' + esc(user.username || '') + '</div></div>' +
    '<div class="setting-row"><span class="setting-title">Recovery code</span><span class="setting-sub">Regenerating invalidates the previous recovery code and shows the new code once.</span><div class="auth-recovery-actions"><button type="button" class="btn secondary small" data-action="regenerate-auth-recovery">Regenerate recovery code</button><div class="mono auth-recovery-result" data-auth-recovery-result>' + esc(userRecoveryCode) + '</div></div></div>' +
    '<div class="setting-row"><span class="setting-title">Change password</span><span class="setting-sub">Current session remains active; other sessions are revoked.</span><button type="button" class="btn secondary small" data-action="open-auth-password-modal">Change password</button></div>' +
    '<div class="setting-row auth-sessions-row"><span class="setting-title">Sessions</span><span class="setting-sub">Created ' + esc(session.created_at || '') + '; expires ' + esc(session.expires_at || '') + '</span><div class="auth-sessions-panel"><div class="peer-rule-list auth-session-list">' + rows + '</div><button type="button" class="btn secondary small" data-action="sign-out-other-auth-sessions">Sign out all other sessions</button></div></div>' +
    (userSettingsStatus ? '<div class="settings-status">' + esc(userSettingsStatus) + '</div>' : '') +
    '</section>' + authPasswordModal();
}

function authPasswordModal() {
  return '<div class="modal-backdrop ' + (authPasswordModalOpen ? '' : 'hidden') + '" data-auth-password-modal><div class="modal auth-password-modal" role="dialog" aria-modal="true" aria-labelledby="authPasswordModalTitle">' +
    '<div class="modal-title" id="authPasswordModalTitle">Change password</div>' +
    '<div class="modal-sub">Enter your current password, then choose and confirm the replacement.</div>' +
    '<label class="field-label" for="authCurrentPassword">Current password</label><input id="authCurrentPassword" class="field-input" type="password" autocomplete="current-password" data-auth-current-password />' +
    '<label class="field-label" for="authNewPassword">New password</label><input id="authNewPassword" class="field-input" type="password" autocomplete="new-password" data-auth-new-password />' +
    '<label class="field-label" for="authConfirmPassword">Confirm new password</label><input id="authConfirmPassword" class="field-input" type="password" autocomplete="new-password" data-auth-confirm-password />' +
    '<div class="workspace-add-status" data-auth-password-modal-status></div>' +
    '<div class="modal-actions"><button type="button" class="btn secondary" data-action="close-auth-password-modal">Cancel</button><button type="button" class="btn" data-action="change-auth-password">Change password</button></div>' +
    '</div></div>';
}

async function loadUserSettings() {
  userSettingsLoading = true;
  userSettingsStatus = '';
  try {
    let res = await fetch(daemonApiUrl('/auth/me'));
    let body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'user load failed');
    userSettings = body;
    res = await fetch(daemonApiUrl('/auth/sessions'));
    body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'sessions load failed');
    userSessions = body;
  } catch (e) {
    userSettingsStatus = 'Failed to load user settings: ' + String(e?.message || e);
  } finally {
    userSettingsLoading = false;
    if (getPage() === 'settings' && getSelectedSettingsTab() === 'user') renderSettings();
  }
}

async function changeAuthPassword() {
  userSettingsStatus = '';
  try {
    const currentPassword = document.querySelector('[data-auth-current-password]')?.value || '';
    const newPassword = document.querySelector('[data-auth-new-password]')?.value || '';
    const confirmPassword = document.querySelector('[data-auth-confirm-password]')?.value || '';
    if (newPassword !== confirmPassword) throw new Error('new passwords do not match');
    const res = await fetch(daemonApiUrl('/auth/change-password'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }) });
    const body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'password change failed');
    userSettingsStatus = 'Password changed; other sessions were revoked.';
    authPasswordModalOpen = false;
    await loadUserSettings();
  } catch (e) {
    const message = 'Failed to change password: ' + String(e?.message || e);
    const modalStatus = document.querySelector('[data-auth-password-modal-status]');
    if (modalStatus) modalStatus.textContent = message;
    userSettingsStatus = message;
    if (!modalStatus) renderSettings();
  }
}

function openAuthPasswordModal() {
  authPasswordModalOpen = true;
  renderSettings();
  setTimeout(() => document.querySelector('[data-auth-current-password]')?.focus(), 0);
}

function closeAuthPasswordModal() {
  authPasswordModalOpen = false;
  renderSettings();
}

async function deleteAuthSession(id) {
  const res = await fetch(daemonApiUrl('/auth/sessions/' + encodeURIComponent(id)), { method: 'DELETE' });
  if (res.status === 401) { location.href = '/login'; return; }
  await loadUserSettings();
}

async function signOutOtherAuthSessions() {
  await fetch(daemonApiUrl('/auth/sessions/sign-out-others'), { method: 'POST' });
  await loadUserSettings();
}

async function regenerateAuthRecovery() {
  userSettingsStatus = '';
  try {
    const res = await fetch(daemonApiUrl('/auth/regenerate-recovery'), { method: 'POST' });
    const body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'recovery regenerate failed');
    userRecoveryCode = body.recoveryCode || '';
    userSettingsStatus = 'New recovery code shown once. Copy it now.';
  } catch (e) { userSettingsStatus = 'Failed to regenerate recovery: ' + String(e?.message || e); }
  renderSettings();
}

function messagingPanel() {
  return messageSettingsPanel() + messagingPolicyPanel() + chatHistoryPanel() + settingsBottomActionBar('messaging', messagingSaveBarStatus(), { saveAction: 'save-messaging-settings', cancelAction: 'cancel-messaging-settings', saving: messagingSettingsSaving });
}

function messagingSaveBarStatus() {
  return messagingSettingsStatus || messageSettingsStatus || messagingPolicyStatus || chatHistoryStatus || 'Unsaved changes.';
}

function messageSettingsPanel() {
  const current = messageSettings || getState().messageSettings || { maxBodyChars: 32000 };
  const maxBodyChars = Number(current.maxBodyChars || 32000);
  const loading = messageSettingsLoading && !messageSettings ? '<div class="thread-empty" style="min-height:90px">Loading message settings…</div>' : '';
  return '<section class="card card-pad settings-wide message-settings"><div class="section-head"><div><h2>Workspace messaging</h2>' + settingsWorkspaceSubtitle('workspace') + '<p>Control message length limits for web and agent sends.</p></div></div>' +
    loading +
    '<div class="setting-row"><span class="setting-title">Maximum message length</span><span class="setting-sub">Applies to direct, broadcast, and Channel messages. Default and maximum is 32000 characters.</span><div class="message-settings-limit"><input class="setting-select" type="number" min="1" max="32000" data-message-max-body-chars aria-label="Maximum message length in characters" value="' + esc(maxBodyChars) + '" /><span class="setting-sub">characters</span></div></div>' +
  '</section>';
}

function messagingPolicyPanel() {
  return '<section class="card card-pad settings-wide messaging-policy-settings"><div class="section-head"><div><h2>Communication Policy</h2><p>Choose how WhatsAgent routes direct, peer, and Channel messages.</p></div></div>' +
    messagingPolicyCards() +
    messagingPeerPolicyPanel() +
    '</section>';
}

function messagingPolicyCards() {
  const state = getState();
  const current = messagingPolicyDraftMode || state.policy?.mode || state.config?.policy?.mode || 'star';
  const options = [
    ['star', 'Star Topology', 'Main can message repo roles, repo roles can message main, and repo-to-repo messaging is blocked.'],
    ['peer-to-peer', 'Peer To Peer', 'Allows live repo roles to message one another directly.'],
    ['channel', 'Channel', 'Agents and humans communicate in one shared channel. Direct role messages are disabled.'],
  ];
  return '<div class="setting-row policy-setting"><span class="setting-title">Policy</span><span class="setting-sub">Controls server-side message routing for the fleet.</span><div><input type="hidden" data-messaging-policy-mode value="' + esc(current) + '" /><div class="policy-card-grid">' +
    options.map(([value, title, description]) => '<button type="button" class="policy-card ' + (current === value ? 'active' : '') + '" data-action="select-messaging-policy-mode" data-policy-mode-value="' + value + '"><span>' + esc(title) + '</span><small>' + esc(description) + '</small></button>').join('') +
    '</div></div></div>';
}

function messagingPeerPolicyPanel() {
  const state = getState();
  const policyMode = messagingPolicyDraftMode || state.policy?.mode || state.config?.policy?.mode || 'star';
  const peer = state.peerPolicy || { mode: 'deny-list', rules: [] };
  const peerMode = messagingPeerRuleDraftMode || peer.mode || 'deny-list';
  const visibleStyle = policyMode === 'peer-to-peer' ? '' : ' style="display:none"';
  const rules = Array.isArray(peer.rules) ? peer.rules : [];
  const roleOptions = messagingPeerRoleOptions();
  const defaultRole = roleOptions[0]?.[0] || '';
  const rows = rules.length
    ? rules.map(rule => '<div class="peer-rule-row"><span ' + truncatedAttrs(rule.role_a_name) + '>' + esc(rule.role_a_name) + '</span><span>&lt;-&gt;</span><span ' + truncatedAttrs(rule.role_b_name) + '>' + esc(rule.role_b_name) + '</span><button type="button" class="btn secondary small" data-action="remove-messaging-peer-rule" data-rule-id="' + rule.id + '">Remove</button></div>').join('')
    : '<div class="peer-rule-empty">No peer pairs configured.</div>';
  return '<div class="setting-row peer-policy-panel"' + visibleStyle + '><span class="setting-title">Peer rules</span><span class="setting-sub">Control repo-to-repo messaging with undirected allow or deny pairs. Main-role messaging is always allowed.</span><div class="peer-policy-controls">' +
    '<div class="segmented peer-mode-segment"><button type="button" class="seg-option ' + (peerMode === 'deny-list' ? 'active' : '') + '" data-action="select-messaging-peer-rule-mode" data-mode="deny-list">Deny-list</button><button type="button" class="seg-option ' + (peerMode === 'allow-list' ? 'active' : '') + '" data-action="select-messaging-peer-rule-mode" data-mode="allow-list">Allow-list</button></div>' +
    '<div class="peer-rule-add">' + settingsDropdown('Role A', defaultRole, roleOptions, { inputAttrs: 'data-messaging-peer-role-a' }) + settingsDropdown('Role B', defaultRole, roleOptions, { inputAttrs: 'data-messaging-peer-role-b' }) + '<button type="button" class="btn secondary small" data-action="add-messaging-peer-rule">Add Pair</button></div>' +
    '<div class="peer-rule-list">' + rows + '</div></div></div>';
}

function messagingPeerRoleOptions() {
  // EP-DEC-RUN WA-006 (advisor msg #28): submit displayId so duplicate
  // bare-name roles can be paired distinctly.
  return (getState().roles || []).map(role => {
    const addr = role.display_id || role.displayId || role.name;
    return [addr, addr];
  });
}

async function loadMessageSettings() {
  if (messageSettingsLoading) return;
  messageSettingsLoading = true;
  messageSettingsStatus = '';
  try {
    const res = await workspaceFetch('/settings');
    const body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'settings load failed');
    messageSettings = body.messageSettings || { maxBodyChars: 32000 };
    patchState({ messageSettings });
  } catch (e) {
    messageSettingsStatus = 'Failed to load message settings: ' + String(e?.message || e);
  } finally {
    messageSettingsLoading = false;
    if (getPage() === 'settings' && getSelectedSettingsTab() === 'messaging') renderSettings();
  }
}

async function saveMessageSettings() {
  const maxBodyChars = Number(document.querySelector('[data-message-max-body-chars]')?.value || 0);
  messageSettingsSaving = true;
  messageSettingsStatus = '';
  try {
    const res = await workspaceFetch('/settings/message', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ maxBodyChars }) });
    const body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'save failed');
    messageSettings = body.messageSettings || { maxBodyChars: 32000 };
    patchState({ messageSettings });
    messageSettingsStatus = 'Saved messaging settings.';
  } catch (e) {
    messageSettingsStatus = 'Failed to save message settings: ' + String(e?.message || e);
  } finally {
    messageSettingsSaving = false;
    if (getPage() === 'settings' && getSelectedSettingsTab() === 'messaging') renderSettings();
    updateMessageLengthCounters();
  }
}

async function saveMessagingPolicy() {
  const state = getState();
  const mode = document.querySelector('[data-messaging-policy-mode]')?.value || messagingPolicyDraftMode || state.policy?.mode || 'star';
  messagingPolicySaving = true;
  messagingPolicyStatus = '';
  try {
    const res = await workspaceFetch('/settings/policy', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
    const body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'policy save failed');
    patchState({ policy: body.policy, config: { ...getState().config, policy: body.policy } });
    messagingPolicyDraftMode = '';
    messagingPolicyStatus = 'Saved communication policy.';
  } catch (e) {
    messagingPolicyStatus = 'Failed to save communication policy: ' + String(e?.message || e);
  } finally {
    messagingPolicySaving = false;
    if (getPage() === 'settings' && getSelectedSettingsTab() === 'messaging') renderSettings();
  }
}

async function saveMessagingSettings() {
  const stateNow = getState();
  const maxBodyChars = Number(document.querySelector('[data-message-max-body-chars]')?.value || 0);
  const mode = document.querySelector('[data-messaging-policy-mode]')?.value || messagingPolicyDraftMode || stateNow.policy?.mode || 'star';
  const peerMode = messagingPeerRuleDraftMode || stateNow.peerPolicy?.mode || 'deny-list';
  const chatHistory = collectChatHistorySettings();
  messagingSettingsSaving = true;
  messageSettingsSaving = true;
  messagingPolicySaving = true;
  chatHistorySaving = true;
  messagingSettingsStatus = '';
  messageSettingsStatus = '';
  messagingPolicyStatus = '';
  chatHistoryStatus = '';
  try {
    let res = await workspaceFetch('/settings/message', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ maxBodyChars }) });
    let body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'message settings save failed');
    messageSettings = body.messageSettings || { maxBodyChars: 32000 };
    patchState({ messageSettings });

    res = await workspaceFetch('/settings/policy', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
    body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'policy save failed');
    patchState({ policy: body.policy, config: { ...getState().config, policy: body.policy } });

    res = await workspaceFetch('/settings/peer-policy', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: peerMode }) });
    body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'peer rule mode save failed');
    patchState({ peerPolicy: body.peerPolicy });

    res = await workspaceFetch('/settings/chat-history', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chatHistory) });
    body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'history retention save failed');
    chatHistorySettings = body.chatHistory;
    patchState({ chatHistory: body.chatHistory });

    messagingPolicyDraftMode = '';
    messagingPeerRuleDraftMode = '';
    messagingSettingsStatus = 'Saved settings. Pruned ' + formatCleanupResult(body.pruned) + '.';
  } catch (e) {
    messagingSettingsStatus = 'Failed to save settings: ' + String(e?.message || e);
  } finally {
    messagingSettingsSaving = false;
    messageSettingsSaving = false;
    messagingPolicySaving = false;
    chatHistorySaving = false;
    if (getPage() === 'settings' && getSelectedSettingsTab() === 'messaging') renderSettings();
    updateMessageLengthCounters();
  }
}

function cancelMessagingSettings() {
  messagingPolicyDraftMode = '';
  messagingPeerRuleDraftMode = '';
  messagingSettingsStatus = 'Discarded unsaved changes.';
  messageSettingsStatus = '';
  messagingPolicyStatus = '';
  chatHistoryStatus = '';
  if (getPage() === 'settings' && getSelectedSettingsTab() === 'messaging') renderSettings();
  updateMessageLengthCounters();
}

async function saveMessagingPeerRuleMode(mode) {
  messagingSettingsStatus = '';
  const res = await workspaceFetch('/settings/peer-policy', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
  const body = await res.json();
  if (res.ok && body.ok !== false) {
    patchState({ peerPolicy: body.peerPolicy });
    messagingPolicyStatus = 'Saved peer rule mode.';
  } else {
    messagingPolicyStatus = 'Failed to save peer rule mode: ' + (body.error || 'request failed');
  }
  if (getPage() === 'settings' && getSelectedSettingsTab() === 'messaging') renderSettings();
}

async function addMessagingPeerRule() {
  const roleA = document.querySelector('[data-messaging-peer-role-a]')?.value || '';
  const roleB = document.querySelector('[data-messaging-peer-role-b]')?.value || '';
  messagingSettingsStatus = '';
  const res = await workspaceFetch('/settings/peer-policy/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roleA, roleB }) });
  const body = await res.json();
  if (res.ok && body.ok !== false) {
    patchState({ peerPolicy: body.peerPolicy });
    messagingPolicyStatus = 'Added peer rule.';
  } else {
    messagingPolicyStatus = 'Failed to add peer rule: ' + (body.error || 'request failed');
  }
  if (getPage() === 'settings' && getSelectedSettingsTab() === 'messaging') renderSettings();
}

async function removeMessagingPeerRule(id) {
  if (!id) return;
  messagingSettingsStatus = '';
  const res = await workspaceFetch('/settings/peer-policy/rules/' + encodeURIComponent(id), { method: 'DELETE' });
  const body = await res.json();
  if (res.ok && body.ok !== false) {
    patchState({ peerPolicy: body.peerPolicy });
    messagingPolicyStatus = 'Removed peer rule.';
  } else {
    messagingPolicyStatus = 'Failed to remove peer rule: ' + (body.error || 'request failed');
  }
  if (getPage() === 'settings' && getSelectedSettingsTab() === 'messaging') renderSettings();
}

function chatHistoryPanel() {
  const current = chatHistorySettings || getState().chatHistory || { retentionDays: 30 };
  const retentionDays = current.retentionDays;
  const preset = retentionDays == null ? 'forever' : ([7, 30, 90, 365].includes(Number(retentionDays)) ? String(retentionDays) : 'custom');
  const customValue = preset === 'custom' ? String(retentionDays) : '';
  const loading = chatHistoryLoading && !chatHistorySettings ? '<div class="thread-empty" style="min-height:90px">Loading chat history settings…</div>' : '';
  const retentionOptions = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['365', '365 days'], ['forever', 'Forever'], ['custom', 'Custom days']];
  return '<section class="card card-pad settings-wide chat-history-settings"><div class="section-head"><div><h2>History</h2><p>Control retained direct, broadcast, and Channel chat history.</p></div></div>' +
    loading +
    '<div class="setting-row"><span class="setting-title">Retention period</span><span class="setting-sub">Expired chat history is pruned on daemon start and when this setting is saved.</span><div class="chat-history-retention">' + settingsDropdown('Retention period', preset, retentionOptions, { inputAttrs: 'data-chat-history-retention' }) + '<input class="chat-history-custom" type="number" min="1" max="3650" placeholder="Custom days" data-chat-history-custom aria-label="Custom retention days" value="' + esc(customValue) + '" /></div></div>' +
    '<div class="agent-text-warning inline">Permanently deletes all messages (direct, broadcast, channel — including unread and pending). Type CLEAR to confirm.</div>' +
    '<div class="chat-history-clear"><input class="chat-history-confirm-input" data-chat-history-clear-confirm placeholder="Type CLEAR" aria-label="Type CLEAR to confirm wiping chat history" /><button class="btn danger" data-action="clear-chat-history" ' + (chatHistoryClearing ? 'disabled' : '') + '>Clear All Chat History</button></div>' +
  '</section>';
}

async function loadChatHistorySettings() {
  if (chatHistoryLoading) return;
  chatHistoryLoading = true;
  chatHistoryStatus = '';
  try {
    const res = await workspaceFetch('/settings');
    const body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'settings load failed');
    chatHistorySettings = body.chatHistory || { retentionDays: 30 };
    patchState({ chatHistory: chatHistorySettings });
  } catch (e) {
    chatHistoryStatus = 'Failed to load chat history settings: ' + String(e?.message || e);
  } finally {
    chatHistoryLoading = false;
    if (getPage() === 'settings' && getSelectedSettingsTab() === 'messaging') renderSettings();
  }
}

function collectChatHistorySettings() {
  const mode = document.querySelector('[data-chat-history-retention]')?.value || '30';
  if (mode === 'forever') return { retentionDays: null };
  if (mode === 'custom') return { retentionDays: Number(document.querySelector('[data-chat-history-custom]')?.value || 0) };
  return { retentionDays: Number(mode) };
}

function formatCleanupResult(result) {
  const messages = Number(result?.messages || 0);
  const channelMessages = Number(result?.channelMessages || 0);
  return messages + ' DM/broadcast · ' + channelMessages + ' channel';
}

async function saveChatHistorySettings() {
  const next = collectChatHistorySettings();
  chatHistorySaving = true;
  chatHistoryStatus = '';
  try {
    const res = await workspaceFetch('/settings/chat-history', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
    const body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'save failed');
    chatHistorySettings = body.chatHistory;
    patchState({ chatHistory: body.chatHistory });
    chatHistoryStatus = 'Saved retention. Pruned ' + formatCleanupResult(body.pruned) + '.';
  } catch (e) {
    chatHistoryStatus = 'Failed to save retention: ' + String(e?.message || e);
  } finally {
    chatHistorySaving = false;
    if (getPage() === 'settings' && getSelectedSettingsTab() === 'messaging') renderSettings();
  }
}

async function clearAllChatHistory() {
  const confirmValue = document.querySelector('[data-chat-history-clear-confirm]')?.value || '';
  chatHistoryClearing = true;
  messagingSettingsStatus = '';
  chatHistoryStatus = '';
  try {
    const res = await workspaceFetch('/settings/chat-history/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: confirmValue }) });
    const body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'clear failed');
    clearMessageCache();
    chatHistoryStatus = 'Cleared ' + formatCleanupResult(body.cleared) + '.';
  } catch (e) {
    chatHistoryStatus = 'Failed to clear history: ' + String(e?.message || e);
  } finally {
    chatHistoryClearing = false;
    if (getPage() === 'settings' && getSelectedSettingsTab() === 'messaging') renderSettings();
  }
}

function agentTextPanel() {
  const current = agentTextSettings || agentTextDefaults || { colleagueProtocol: '', inboxInstructions: '', pushedInboxInstructions: '' };
  const loading = agentTextLoading && !agentTextSettings ? '<div class="thread-empty" style="min-height:120px">Loading shared agent text settings…</div>' : '';
  const customLoading = customPromptsLoading && !customPrompts ? '<div class="thread-empty" style="min-height:90px">Loading custom prompts…</div>' : '';
  const prompts = customPrompts || [];
  return '<section class="card card-pad settings-wide agent-text-settings"><div class="section-head"><div><h2>Prompts</h2>' + settingsWorkspaceSubtitle('daemon') + '<p>Daemon-wide instructions used by launched agents and inbox delivery across every workspace.</p></div></div>' +
    '<div class="agent-text-actions"><button type="button" class="btn secondary small" data-action="create-custom-prompt">+ New Prompt</button></div>' +
    '<div class="agent-text-warning"><strong>Warning:</strong> editing these text settings can change or break agent behavior. Keep required tool names, message metadata, and reply-action expectations intact.</div>' +
    loading +
    promptExpander({ kind: 'builtin', id: 'colleagueProtocol', title: 'Colleague protocol', sub: 'Settings-only startup instructions for integrations that support agent context.', body: current.colleagueProtocol, rows: 14, resettable: true }) +
    promptExpander({ kind: 'builtin', id: 'inboxInstructions', title: 'Inbox instructions', sub: 'Text inserted above each inbox header before message metadata.', body: current.inboxInstructions, rows: 7, resettable: true }) +
    '<div class="agent-text-warning inline"><strong>Inbox warning:</strong> editing this option can change or break message-handling behavior. The fixed metadata block is preserved by WhatsAgent, but confusing instructions may cause agents to miss, ignore, or incorrectly reply to messages.</div>' +
    promptExpander({ kind: 'builtin', id: 'pushedInboxInstructions', title: 'Inbox nudge', sub: 'Reminder sent to agent when there are unread inbox items', body: current.pushedInboxInstructions, rows: 4, resettable: true }) +
    customLoading +
    prompts.map(prompt => promptExpander({ kind: 'custom', id: prompt.id, title: prompt.title, sub: 'Custom Quick Prompt preset shown for all runtimes.', body: prompt.body, rows: 5, editableTitle: true })).join('') +
    (agentTextStatus || customPromptsStatus ? '<div class="agent-text-status">' + esc(agentTextStatus || customPromptsStatus) + '</div>' : '') +
  '</section>';
}

function promptExpander(prompt) {
  const key = prompt.kind + ':' + prompt.id;
  const expanded = Boolean(promptExpanded[key]);
  const chevron = expanded ? '▴' : '▾';
  let body = '';
  if (expanded && prompt.kind === 'builtin') {
    const resetDisabled = agentTextSaving || !agentTextDefaults ? ' disabled' : '';
    body = '<div class="prompt-expander-body"><textarea rows="' + prompt.rows + '" spellcheck="false" aria-label="' + esc(prompt.title) + '" data-agent-text-field="' + esc(prompt.id) + '">' + esc(prompt.body || '') + '</textarea>' +
      '<div class="prompt-expander-footer"><span class="agent-text-status">Built-in prompt. Saved changes affect new launches and future inbox delivery.</span><div class="agent-text-actions"><button type="button" class="btn secondary small" data-action="reset-agent-text-field" data-agent-text-reset-field="' + esc(prompt.id) + '"' + resetDisabled + '>Reset</button><button type="button" class="btn secondary small" data-action="cancel-prompt-expander" data-prompt-key="' + esc(key) + '">Cancel</button><button type="button" class="btn small" data-action="save-agent-text-field" data-agent-text-field-save="' + esc(prompt.id) + '"' + (agentTextSaving ? ' disabled' : '') + '>Save</button></div></div></div>';
  } else if (expanded) {
    body = '<div class="prompt-expander-body"><label class="setting-title" for="customPromptTitle-' + esc(prompt.id) + '">Title</label><input id="customPromptTitle-' + esc(prompt.id) + '" class="setting-input" data-custom-prompt-title="' + esc(prompt.id) + '" value="' + esc(prompt.title || '') + '">' +
      '<textarea rows="' + prompt.rows + '" spellcheck="false" aria-label="' + esc(prompt.title) + '" data-custom-prompt-body="' + esc(prompt.id) + '">' + esc(prompt.body || '') + '</textarea>' +
      '<div class="prompt-expander-footer"><span class="agent-text-status">Custom prompt preset.</span><div class="agent-text-actions"><button type="button" class="btn secondary small" data-action="delete-custom-prompt" data-custom-prompt-id="' + esc(prompt.id) + '">Delete</button><button type="button" class="btn secondary small" data-action="cancel-prompt-expander" data-prompt-key="' + esc(key) + '">Cancel</button><button type="button" class="btn small" data-action="save-custom-prompt" data-custom-prompt-id="' + esc(prompt.id) + '">Save</button></div></div></div>';
  }
  return '<div class="prompt-expander" data-prompt-kind="' + esc(prompt.kind) + '"><div class="prompt-expander-head"><button type="button" class="prompt-expander-title" data-action="toggle-prompt-expander" data-prompt-key="' + esc(key) + '"><span class="setting-title">' + esc(prompt.title) + '</span><span class="setting-sub">' + esc(prompt.sub) + '</span></button><div class="agent-text-actions"><button type="button" class="btn secondary small prompt-expander-chevron" data-action="toggle-prompt-expander" data-prompt-key="' + esc(key) + '" aria-expanded="' + (expanded ? 'true' : 'false') + '">' + chevron + '</button></div></div>' + body + '</div>';
}

function agentTextSavedValue(field) {
  const source = agentTextSettings || agentTextDefaults || {};
  return String(source[field] ?? '');
}

function agentTextDefaultValue(field) {
  const source = agentTextDefaults || {};
  return String(source[field] ?? '');
}

async function loadPushStateStats() {
  if (pushStateLoading) return;
  pushStateLoading = true;
  try {
    const res = await workspaceFetch('/diagnostics/push-state', undefined);
    if (res?.ok) {
      const body = await res.json();
      if (body?.ok !== false) {
        pushStateStats = { pending: Number(body.pending) || 0, pushed: Number(body.pushed) || 0, oldestPushedAt: body.oldestPushedAt ?? null };
      }
    }
  } catch {
    // Silent — diagnostics is informational; the panel falls back to its
    // last-known values.
  } finally {
    // Always bump the timestamp so a failed/non-ok response respects the
    // throttle window; otherwise the finally→render→tab-handler loop would
    // immediately re-fetch (advisor review fix #2).
    pushStateLoadedAt = Date.now();
    pushStateLoading = false;
    if (getPage() === 'settings' && getSelectedSettingsTab() === 'diagnostics') renderSettings();
  }
}

async function loadAgentTextSettings() {
  if (agentTextLoading) return;
  agentTextLoading = true;
  agentTextStatus = '';
  try {
    const res = await fetch(daemonApiUrl('/settings/agent-text'));
    const body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'settings load failed');
    agentTextSettings = body.agentText;
    agentTextDefaults = body.defaults?.agentText || body.agentText;
  } catch (e) {
    agentTextStatus = 'Failed to load shared agent text settings: ' + String(e?.message || e);
  } finally {
    agentTextLoading = false;
    if (getPage() === 'settings' && getSelectedSettingsTab() === 'prompts') renderSettings();
  }
}

async function loadCustomPrompts() {
  if (customPromptsLoading) return;
  customPromptsLoading = true;
  customPromptsStatus = '';
  try {
    const res = await fetch(daemonApiUrl('/settings/custom-prompts'));
    const body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'custom prompts load failed');
    customPrompts = body.prompts || [];
  } catch (e) {
    customPromptsStatus = 'Failed to load custom prompts: ' + String(e?.message || e);
  } finally {
    customPromptsLoading = false;
    if (getPage() === 'settings' && getSelectedSettingsTab() === 'prompts') renderSettings();
  }
}

async function saveAgentTextField(field) {
  const input = document.querySelector('[data-agent-text-field="' + field + '"]');
  if (!input) return;
  const next = { ...(agentTextSettings || agentTextDefaults || {}), [field]: input.value };
  agentTextSaving = true;
  agentTextStatus = '';
  try {
    const res = await fetch(daemonApiUrl('/settings/agent-text'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
    const body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'settings save failed');
    agentTextSettings = body.agentText;
    agentTextDefaults = body.defaults?.agentText || agentTextDefaults;
    agentTextStatus = 'Saved ' + agentTextPromptTitle(field) + '.';
  } catch (e) {
    agentTextSettings = next;
    agentTextStatus = 'Failed to save shared agent text settings: ' + String(e?.message || e);
  } finally {
    agentTextSaving = false;
    if (getPage() === 'settings' && getSelectedSettingsTab() === 'prompts') renderSettings();
  }
}

function agentTextPromptTitle(field) {
  return ({ colleagueProtocol: 'Colleague protocol', inboxInstructions: 'Inbox instructions', pushedInboxInstructions: 'Inbox nudge' })[field] || 'prompt';
}

async function resetAgentTextField(field) {
  const input = document.querySelector('[data-agent-text-field="' + field + '"]');
  if (!input) return;
  input.value = agentTextDefaultValue(field);
  await saveAgentTextField(field);
}

function cancelPromptExpander(key) {
  delete promptExpanded[key];
  agentTextStatus = 'Discarded unsaved prompt edits.';
  if (getPage() === 'settings' && getSelectedSettingsTab() === 'prompts') renderSettings();
}

async function createCustomPrompt() {
  customPromptsStatus = '';
  for (let i = 1; i <= 20; i++) {
    const title = i === 1 ? 'Untitled' : 'Untitled ' + i;
    try {
      const res = await fetch(daemonApiUrl('/settings/custom-prompts'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body: '' }) });
      const body = await res.json();
      if (!res.ok || body.ok === false) throw new Error(body.error || 'custom prompt create failed');
      customPrompts = [...(customPrompts || []), body.prompt].sort((a, b) => String(a.title).localeCompare(String(b.title)));
      promptExpanded['custom:' + body.prompt.id] = true;
      customPromptsStatus = 'Created custom prompt.';
      renderSettings();
      return;
    } catch (e) {
      if (!String(e?.message || e).includes('already exists')) {
        customPromptsStatus = 'Failed to create custom prompt: ' + String(e?.message || e);
        renderSettings();
        return;
      }
    }
  }
  customPromptsStatus = 'Failed to create custom prompt: too many Untitled prompts.';
  renderSettings();
}

async function saveCustomPrompt(id) {
  const title = document.querySelector('[data-custom-prompt-title="' + id + '"]')?.value || '';
  const bodyText = document.querySelector('[data-custom-prompt-body="' + id + '"]')?.value || '';
  customPromptsStatus = '';
  try {
    const res = await fetch(daemonApiUrl('/settings/custom-prompts/' + encodeURIComponent(id)), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body: bodyText }) });
    const body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'custom prompt save failed');
    customPrompts = (customPrompts || []).map(prompt => prompt.id === id ? body.prompt : prompt).sort((a, b) => String(a.title).localeCompare(String(b.title)));
    customPromptsStatus = 'Saved custom prompt.';
  } catch (e) {
    customPromptsStatus = 'Failed to save custom prompt: ' + String(e?.message || e);
  } finally {
    if (getPage() === 'settings' && getSelectedSettingsTab() === 'prompts') renderSettings();
  }
}

async function deleteCustomPrompt(id) {
  const prompt = (customPrompts || []).find(prompt => prompt.id === id);
  const ok = await openConfirm({ title: 'Delete custom prompt?', body: 'Delete "' + (prompt?.title || 'this prompt') + '"? This removes it from Quick Prompts.', confirmLabel: 'Delete', danger: true });
  if (!ok) return;
  customPromptsStatus = '';
  try {
    const res = await fetch(daemonApiUrl('/settings/custom-prompts/' + encodeURIComponent(id)), { method: 'DELETE' });
    const body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'custom prompt delete failed');
    customPrompts = (customPrompts || []).filter(prompt => prompt.id !== id);
    delete promptExpanded['custom:' + id];
    customPromptsStatus = 'Deleted custom prompt.';
  } catch (e) {
    customPromptsStatus = 'Failed to delete custom prompt: ' + String(e?.message || e);
  } finally {
    if (getPage() === 'settings' && getSelectedSettingsTab() === 'prompts') renderSettings();
  }
}

let _delegationInstalled = false;

export function installSettings(c) {
  _ctx = c;
  if (_delegationInstalled) return;
  _delegationInstalled = true;

  // Refresh audit data when the browser tab regains focus while the
  // audit subtab is active. Catches "left tab open in background, came
  // back later" without forcing the user to click Refresh.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (getPage() !== 'settings') return;
    if (getSelectedSettingsTab() !== 'roles') return;
    if (rbacViewSubtab !== 'audit') return;
    if (rbacAuditLoading) return;
    void loadRbacAudit();
  });

  document.addEventListener('click', e => {
    const target = e.target?.closest?.('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'save-message-settings') { e.preventDefault(); void saveMessageSettings(); }
    if (target.dataset.action === 'save-messaging-settings') { e.preventDefault(); void saveMessagingSettings(); }
    if (target.dataset.action === 'cancel-messaging-settings') { e.preventDefault(); cancelMessagingSettings(); }
    if (target.dataset.action === 'select-messaging-policy-mode') { e.preventDefault(); messagingPolicyDraftMode = target.dataset.policyModeValue || 'star'; messagingSettingsStatus = ''; messagingPolicyStatus = ''; renderSettings(); }
    if (target.dataset.action === 'save-messaging-policy') { e.preventDefault(); void saveMessagingPolicy(); }
    if (target.dataset.action === 'select-messaging-peer-rule-mode') { e.preventDefault(); messagingPeerRuleDraftMode = target.dataset.mode || 'deny-list'; messagingSettingsStatus = ''; messagingPolicyStatus = ''; renderSettings(); }
    if (target.dataset.action === 'add-messaging-peer-rule') { e.preventDefault(); void addMessagingPeerRule(); }
    if (target.dataset.action === 'remove-messaging-peer-rule') { e.preventDefault(); void removeMessagingPeerRule(target.dataset.ruleId); }
    if (target.dataset.action === 'toggle-prompt-expander') { e.preventDefault(); const key = target.dataset.promptKey; promptExpanded[key] = !promptExpanded[key]; renderSettings(); }
    if (target.dataset.action === 'save-agent-text-field') { e.preventDefault(); void saveAgentTextField(target.dataset.agentTextFieldSave); }
    if (target.dataset.action === 'cancel-prompt-expander') { e.preventDefault(); cancelPromptExpander(target.dataset.promptKey); }
    if (target.dataset.action === 'reset-agent-text-field') { e.preventDefault(); void resetAgentTextField(target.dataset.agentTextResetField); }
    if (target.dataset.action === 'create-custom-prompt') { e.preventDefault(); void createCustomPrompt(); }
    if (target.dataset.action === 'save-custom-prompt') { e.preventDefault(); void saveCustomPrompt(target.dataset.customPromptId); }
    if (target.dataset.action === 'delete-custom-prompt') { e.preventDefault(); void deleteCustomPrompt(target.dataset.customPromptId); }
    if (target.dataset.action === 'save-chat-history') { e.preventDefault(); void saveChatHistorySettings(); }
    if (target.dataset.action === 'clear-chat-history') { e.preventDefault(); void clearAllChatHistory(); }
    if (target.dataset.action === 'set-tui-redraw-workaround') { e.preventDefault(); void saveTuiRedrawSettings(target.dataset.value); }
    if (target.dataset.action === 'open-auth-password-modal') { e.preventDefault(); openAuthPasswordModal(); }
    if (target.dataset.action === 'close-auth-password-modal') { e.preventDefault(); closeAuthPasswordModal(); }
    if (target.dataset.action === 'change-auth-password') { e.preventDefault(); void changeAuthPassword(); }
    if (target.dataset.action === 'delete-auth-session') { e.preventDefault(); void deleteAuthSession(target.dataset.sessionId); }
    if (target.dataset.action === 'sign-out-other-auth-sessions') { e.preventDefault(); void signOutOtherAuthSessions(); }
    if (target.dataset.action === 'regenerate-auth-recovery') { e.preventDefault(); void regenerateAuthRecovery(); }
    if (target.dataset.action === 'rbac-toggle-role-row') {
      e.preventDefault();
      const id = target.dataset.roleId;
      if (!id) return;
      if (rbacExpanded.has(id)) {
        rbacExpanded.delete(id);
        // Drop the grant draft on collapse so re-expand starts fresh from
        // the server-side state. Matches collapse-discards-edit pattern.
        delete rbacGrantDraft[id];
        delete rbacRoleSaveStatus[id];
      } else {
        rbacExpanded.add(id);
      }
      renderSettings();
    }
    if (target.dataset.action === 'rbac-save-role') { e.preventDefault(); void saveRbacRole(target.dataset.roleId); }
    // Grant chip toggle — checkbox click bubbles up; we update the in-memory
    // draft and let the chip's `checked` class flip locally without a full
    // re-render.
    if (target.dataset.action === 'rbac-toggle-grant') {
      // Don't preventDefault here — let the browser flip the checkbox state
      // naturally so future click events read the right state from the DOM.
      toggleRbacGrant(target.dataset.roleId, target.dataset.grantKind, target.dataset.grantValue);
    }
    if (target.dataset.action === 'rbac-toggle-kanban-grant') {
      toggleRbacKanbanGrant(target.dataset.roleId, target.dataset.grantValue, target.dataset.scope);
    }
    if (target.dataset.action === 'rbac-open-add-role-modal') { e.preventDefault(); openRbacAddRoleModal(); }
    if (target.dataset.action === 'rbac-close-add-role-modal') { e.preventDefault(); closeRbacAddRoleModal(); }
    if (target.dataset.action === 'rbac-submit-add-role') { e.preventDefault(); void submitAddRbacRole(); }
    if (target.dataset.action === 'rbac-delete-role') { e.preventDefault(); void deleteRbacRole(target.dataset.roleId); }
    if (target.dataset.action === 'rbac-select-view-subtab') {
      e.preventDefault();
      const sub = target.dataset.rbacSubtab;
      const next = sub === 'matrix' ? 'matrix' : sub === 'audit' ? 'audit' : 'list';
      if (rbacViewSubtab !== next) {
        rbacViewSubtab = next;
        renderSettings();
        // Audit data is server-side append-only and grows between visits.
        // Always refetch on tab entry rather than caching from first load.
        if (next === 'audit') void loadRbacAudit();
      }
    }
    if (target.dataset.action === 'rbac-select-workspace-mode') {
      e.preventDefault();
      const next = target.dataset.rbacMode;
      void selectWorkspaceRbacMode(next);
    }
    if (target.dataset.action === 'rbac-audit-set-kind') {
      e.preventDefault();
      const kind = target.dataset.auditKind;
      if (kind && rbacAuditFilterKind !== kind) {
        rbacAuditFilterKind = kind;
        rbacAuditPagination = { ...rbacAuditPagination, offset: 0 };
        rbacAuditExpanded = new Set();
        void loadRbacAudit();
      }
    }
    if (target.dataset.action === 'rbac-audit-set-window') {
      e.preventDefault();
      const win = target.dataset.auditWindow;
      if (win && rbacAuditFilterWindow !== win) {
        rbacAuditFilterWindow = win;
        rbacAuditPagination = { ...rbacAuditPagination, offset: 0 };
        rbacAuditExpanded = new Set();
        void loadRbacAudit();
      }
    }
    if (target.dataset.action === 'rbac-audit-clear-filters') {
      e.preventDefault();
      rbacAuditFilterKind = 'grant_miss_hard';
      rbacAuditFilterWindow = '24h';
      rbacAuditFilterActor = '';
      rbacAuditPagination = { ...rbacAuditPagination, offset: 0 };
      rbacAuditExpanded = new Set();
      void loadRbacAudit();
    }
    if (target.dataset.action === 'rbac-audit-toggle-row') {
      e.preventDefault();
      const id = target.dataset.auditId;
      if (!id) return;
      if (rbacAuditExpanded.has(id)) rbacAuditExpanded.delete(id);
      else rbacAuditExpanded.add(id);
      renderSettings();
    }
    if (target.dataset.action === 'rbac-audit-prev') {
      e.preventDefault();
      const next = Math.max(0, rbacAuditPagination.offset - rbacAuditPagination.limit);
      if (next !== rbacAuditPagination.offset) {
        rbacAuditPagination = { ...rbacAuditPagination, offset: next };
        rbacAuditExpanded = new Set();
        void loadRbacAudit();
      }
    }
    if (target.dataset.action === 'rbac-audit-next') {
      e.preventDefault();
      const next = rbacAuditPagination.offset + rbacAuditPagination.limit;
      if (next < rbacAuditPagination.total) {
        rbacAuditPagination = { ...rbacAuditPagination, offset: next };
        rbacAuditExpanded = new Set();
        void loadRbacAudit();
      }
    }
    if (target.dataset.action === 'rbac-audit-refresh') {
      e.preventDefault();
      if (!rbacAuditLoading) void loadRbacAudit();
    }
    if (target.dataset.action === 'rbac-audit-export-csv') {
      e.preventDefault();
      void exportRbacAuditCsv();
    }
    if (target.dataset.action === 'rbac-select-grant-tab') {
      e.preventDefault();
      const id = target.dataset.roleId;
      const tab = target.dataset.grantTab;
      if (!id || !tab) return;
      if (rbacGrantTab[id] !== tab) {
        rbacGrantTab[id] = tab;
        renderSettings();
      }
    }
  });

  document.addEventListener('input', e => {
    if (e.target?.matches?.('[data-agent-text-field]')) {
      agentTextStatus = '';
    }
    if (e.target?.matches?.('[data-custom-prompt-title], [data-custom-prompt-body]')) customPromptsStatus = '';
  });
}
