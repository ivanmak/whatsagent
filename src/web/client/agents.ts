// @ts-nocheck
// Agents + Runtime feature module.
// Lift of installAgentListAndSettingsUi() per
// docs/superpowers/specs/2026-05-01-web-client-modularisation-design.md.
// Owns: Agents Overview list render, sort persistence, add/edit/delete
// flows, per-role default-runtime dialog, plus the runtime + diagnostics
// settings tabs (closure-shared with the overview).

import { identiconFor } from "./identicon.ts";
import { truncatedAttrs } from "./truncate-tooltip.ts";

let _ctx = null;
function ctx() {
  if (!_ctx) throw new Error('agents context not bound; call installAgents(ctx) first');
  return _ctx;
}
function getState() { return ctx().getState(); }
function patchState(partial) { ctx().patchState(partial); }
function getPage() { return ctx().getPage(); }
function getSelectedSettingsTab() { return ctx().getSelectedSettingsTab(); }
function getActiveTerminal() { return ctx().getActiveTerminal(); }
function setAgentsSubView(next, role) { ctx().setAgentsSubView(next, role); }
function updateUrl(replace) { ctx().updateUrl(replace); }
function getOpenLaunchMenuRole() { return ctx().getOpenLaunchMenuRole(); }
function setOpenLaunchMenuRole(value) { ctx().setOpenLaunchMenuRole(value); }
function getSelectedLaunchRole() { return ctx().getSelectedLaunchRole(); }
function setSelectedLaunchRole(value) { ctx().setSelectedLaunchRole(value); }
function getSelectedLaunchHost() { return ctx().getSelectedLaunchHost(); }
function setSelectedLaunchHost(value) { ctx().setSelectedLaunchHost(value); }
function render() { ctx().render(); }
function renderSettings() { ctx().renderSettings(); }
function renderAgentOverview() { ctx().renderAgentOverview(); }
function disposeXterm() { ctx().disposeXterm(); }
function workspaceFetch(suffix, init) { return ctx().workspaceFetch(suffix, init); }
function $(id) { return ctx().$(id); }
function esc(value) { return ctx().esc(value); }
function shortPath(value) { return ctx().shortPath(value); }
function roleByName(name) { return ctx().roleByName(name); }
function runnerFor(name) { return ctx().runnerFor(name); }
function roleDisplayId(role) { return ctx().roleDisplayId(role); }
function hostLabel(host) { return ctx().hostLabel(host); }
function peerIcon(host, size) { return ctx().peerIcon(host, size); }
function roleAvatarGrid(role, size) { return ctx().roleAvatarGrid(role, size); }
function badge(text, kind, live) { return ctx().badge(text, kind, live); }
function kv(label, value, secondary) { return ctx().kv(label, value, secondary); }
function settingRow(title, sub, control) { return ctx().settingRow(title, sub, control); }
function runnerDiagnostics() { return ctx().runnerDiagnostics(); }
function settingsBottomActionBar(section, status, opts) { return ctx().settingsBottomActionBar(section, status, opts); }
function settingsWorkspaceSubtitle(scope) { return ctx().settingsWorkspaceSubtitle(scope); }
function settingsDropdown(name, value, options, opts) { return ctx().settingsDropdown(name, value, options, opts); }
function openConfirm(opts) { return ctx().openConfirm(opts); }
function showToast(message, opts) { return ctx().showToast(message, opts); }
function setModalCloseHandler(modal, handler) { ctx().setModalCloseHandler(modal, handler); }
function closeLaunchMenu() { ctx().closeLaunchMenu(); }

const SORT_KEY = 'whatsagent.agent.sort';
let agentSort = loadAgentSort();
let sortMenuOpen = false;
let runtimePolicyDraftMode = '';
let runtimeSettingsStatus = '';
let runtimeSettingsSaving = false;
let runtimeRedetectInFlight = false;
let defaultRuntimeDialogRole = '';
let defaultRuntimeDialogHost = '';
let defaultRuntimeDialogStatus = '';
let defaultRuntimeDialogSaving = false;
let addAgentSaving = false;
let addAgentRepoId = '';
let addAgentRuntime = 'default';
let agentOverviewMenuRole = '';
let agentEditingRole = null;
let agentEditRuntime = 'default';
let agentEditSaving = false;
// RBAC Phase 3 slice 5 — Agents-page Roles multi-select state.
// Loaded once per modal open; mutated as the user toggles chips; PUT
// to /agents/:id/roles on save. `null` = not loaded yet.
let agentEditAvailableRoles = null;     // [{ id, name, description, is_builtin }]
let agentEditAssignedRoleIds = new Set();
let agentEditRolesLoading = false;
let agentEditRolesError = '';
// Add-agent modal mirrors the same shape (slice 5b). Defaults are
// seeded from the agent name via NAME_DEFAULTS_FOR_NEW_AGENT to mirror
// the v15 seed-on-existing-agents migration logic — operators see
// what they'd get from `whatsagent register` / migration baseline,
// then can override before creating.
let addAgentAvailableRoles = null;
let addAgentAssignedRoleIds = new Set();
let addAgentRolesLoading = false;
let addAgentRolesError = '';
const NAME_DEFAULTS_FOR_NEW_AGENT = {
  main: ['pm', 'operator'],
  worker: ['engineer'],
  advisor: ['reviewer', 'engineer'],
  researcher: ['researcher'],
  'human-web': ['pm', 'operator'],
};
const NAME_DEFAULT_FALLBACK = ['engineer'];
let agentDeleteSaving = false;
let agentPageMode = '';
let agentPageRole = '';
let agentPageStatus = '';
let agentsHeaderMenuOpen = false;
let repoMenuOpenId = '';
let repoEditState = null; // { id, name, absolutePath, mode: 'add'|'edit' }
let repoEditSaving = false;
let scanDirsManageList = [];
let scanDirsManageStatus = '';
let scanDirsLoading = false;
let scanDirsRefreshing = false;
const collapsedRepoIds = new Set();

function loadAgentSort() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SORT_KEY) || '{}');
    return { field: parsed.field || 'name', dir: parsed.dir === 'desc' ? 'desc' : 'asc' };
  } catch {
    return { field: 'name', dir: 'asc' };
  }
}

function saveAgentSort() {
  localStorage.setItem(SORT_KEY, JSON.stringify(agentSort));
}

function roleRuntime(role) {
  // EP-DEC-RUN WA-006 (advisor msg #26): runner lookup keys on displayId.
  const runner = runnerFor(roleDisplayId(role));
  return runner?.host_type || role.host_default || getState().runtime?.globalDefaultHost || '';
}

function roleRuntimeLabel(role) {
  const host = roleRuntime(role);
  return host ? hostLabel(host) : 'No default runtime';
}

function runtimeKeyForHost(host) {
  if (host === 'opencode') return 'openCode';
  if (host === 'codex') return 'codex';
  if (host === 'claude-code') return 'claudeCode';
  if (host === 'pi') return 'pi';
  return null;
}

function hostForRuntimeKey(key) {
  if (key === 'openCode') return 'opencode';
  if (key === 'codex') return 'codex';
  if (key === 'claudeCode') return 'claude-code';
  if (key === 'pi') return 'pi';
  return null;
}

function detectionForHost(host) {
  return getState().runtimeDetection ? getState().runtimeDetection[host] || null : null;
}

function commandConfigForHost(host) {
  const key = runtimeKeyForHost(host);
  if (!key) return null;
  const state = getState();
  const commands = (state.runtime && state.runtime.commands) || (state.config && state.config.commands) || {};
  return commands[key] || null;
}

function isHostLaunchable(host) {
  const detection = detectionForHost(host);
  const cfg = commandConfigForHost(host);
  if (!detection) return cfg ? cfg.enabled !== false : true;
  return detection.detected && (!cfg || cfg.enabled !== false);
}

function defaultHostForRole(role) {
  const state = getState();
  return role?.host_default || (state.runtime && state.runtime.globalDefaultHost) || '';
}

function sortedAgentRoles() {
  const state = getState();
  const roles = [...(state.roles || [])];
  const mainId = state.mainRole?.id || '';
  // EP-DEC-RUN WA-006 (advisor msg #26): identify by id/displayId; bare
  // name comparisons would group two `main` agents together by mistake.
  const online = role => runnerFor(roleDisplayId(role))?.reachable ? 1 : 0;
  const value = role => {
    if (agentSort.field === 'agent-role') return role.id === mainId ? 0 : 1;
    if (agentSort.field === 'runtime') return roleRuntimeLabel(role).toLowerCase();
    if (agentSort.field === 'online') return online(role);
    return roleDisplayId(role).toLowerCase();
  };
  roles.sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    const result = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
    return (agentSort.dir === 'desc' ? -result : result) || roleDisplayId(a).localeCompare(roleDisplayId(b));
  });
  return roles;
}

function avatarForRole(role) {
  const seed = String(role.repo_name || role.repoName || '') + ':' + String(role.name || '');
  return '<span class="agent-avatar agent-avatar-identicon">' + identiconFor(seed, 48) + '</span>';
}

function sortControls() {
  return '<div class="agent-sortbar"><div class="launch-split agent-sort-menu"><button class="btn secondary small agent-sort-trigger" data-action="toggle-agent-sort-menu" aria-expanded="' + (sortMenuOpen ? 'true' : 'false') + '">Sort by: <strong>' + esc(sortLabel(agentSort.field, agentSort.dir)) + '</strong></button><button class="launch-arrow" data-action="toggle-agent-sort-menu" aria-label="Choose sort order" aria-expanded="' + (sortMenuOpen ? 'true' : 'false') + '">\u25BC</button>' +
    (sortMenuOpen ? '<div class="launch-menu agent-sort-options" role="menu">' + sortChoices() + '</div>' : '') +
    '</div></div>';
}

function sortChoices() {
  return [
    sortChoice('name', 'asc', 'Name A-Z'),
    sortChoice('name', 'desc', 'Name Z-A'),
    sortChoice('agent-role', 'asc', 'Agent role: main first'),
    sortChoice('agent-role', 'desc', 'Agent role: repos first'),
    sortChoice('runtime', 'asc', 'Runtime A-Z'),
    sortChoice('runtime', 'desc', 'Runtime Z-A'),
    sortChoice('online', 'desc', 'Online first'),
    sortChoice('online', 'asc', 'Offline first'),
  ].join('');
}

function sortChoice(field, dir, label) {
  const active = agentSort.field === field && agentSort.dir === dir;
  return '<button type="button" role="menuitem" class="' + (active ? 'active' : '') + '" data-action="agent-sort-choice" data-sort-field="' + field + '" data-sort-dir="' + dir + '"><span>' + esc(label) + '</span></button>';
}

function sortLabel(field, dir) {
  const labels = {
    name: dir === 'desc' ? 'Name Z-A' : 'Name A-Z',
    'agent-role': dir === 'desc' ? 'Repos first' : 'Main first',
    runtime: dir === 'desc' ? 'Runtime Z-A' : 'Runtime A-Z',
    online: dir === 'asc' ? 'Offline first' : 'Online first',
  };
  return labels[field] || 'Name A-Z';
}

export function renderAgentsOverview() {
  disposeXterm();
  const rows = repoGroupedAgentRows();
  const banner = starModeMissingMainBanner();
  const previousAgentScroll = document.querySelector('.agent-list-overview')?.scrollTop || 0;
  // All dynamic values are run through esc() before interpolation; pattern matches the rest of this file.
  $('agentTabContent').innerHTML = '<div class="agent-overview agent-list-overview">' + agentsOverviewHeader() + banner + rows + '</div>';
  if (previousAgentScroll) requestAnimationFrame(() => {
    const next = document.querySelector('.agent-list-overview');
    if (next) next.scrollTop = previousAgentScroll;
  });
}

function starModeMissingMainBanner() {
  const state = getState();
  const mode = state.policy?.mode || '';
  if (mode !== 'star') return '';
  if (state.mainRole?.id) return '';
  if (!(state.roles || []).length) return '';
  return '<div class="agent-overview-warning" role="status">'
    + '<strong>No main agent set.</strong> '
    + 'Star topology routes every direct message through a main agent. '
    + 'Until you mark one, agents cannot send DMs to each other and broadcasts will fail. '
    + 'Open an agent overflow menu and choose Set main.'
    + '</div>';
}

function agentsOverviewHeader() {
  const state = getState();
  const repos = state.repos || [];
  const hasRepos = repos.length > 0;
  const headerMenu = agentsHeaderMenuOpen ? agentsHeaderMenuItems() : '';
  return '<div class="agents-overview-header">'
    + '<div class="agents-overview-header-left">' + (hasRepos ? sortControls() : '') + '</div>'
    + '<div class="agents-overview-header-right">'
      + '<button class="btn small" data-action="open-add-repo">+ Add Repository</button>'
      + '<div class="agents-overview-overflow">'
        + '<button type="button" class="workspace-card-icon-btn" data-action="toggle-agents-overflow-menu" aria-haspopup="menu" aria-expanded="' + (agentsHeaderMenuOpen ? 'true' : 'false') + '" aria-label="More actions">⋯</button>'
        + headerMenu
      + '</div>'
    + '</div>'
  + '</div>';
}

function agentsHeaderMenuItems() {
  const refreshLabel = scanDirsRefreshing ? 'Refreshing…' : 'Refresh Scan Directories';
  const refreshDisabled = scanDirsRefreshing ? ' disabled' : '';
  return '<div class="workspace-card-menu agents-overview-menu" role="menu">'
    + '<button type="button" data-action="open-manage-scan-dirs">Manage Scan Directories</button>'
    + '<button type="button" data-action="refresh-all-scan-dirs"' + refreshDisabled + '>' + refreshLabel + '</button>'
  + '</div>';
}

function repoGroupedAgentRows() {
  const state = getState();
  const repos = state.repos || [];
  if (!repos.length) return emptyReposState();
  return '<div class="repo-group-list">' + repos.map(repoGroupSection).join('') + '</div>';
}

function emptyReposState() {
  return '<div class="empty-state agents-empty-state">'
    + '<div class="agents-empty-title">No repositories yet</div>'
    + '<button class="btn" data-action="open-add-repo">+ Add Repository</button>'
  + '</div>';
}

function repoGroupSection(repo) {
  const roles = rolesForRepo(repo);
  const roleRows = roles.length ? roles.map(agentCard).join('') : '<div class="repo-empty-pill">no agents yet</div>';
  const menuOpen = repoMenuOpenId === repo.id;
  const collapsed = collapsedRepoIds.has(repo.id);
  const overflow = '<div class="repo-group-overflow">'
    + '<button type="button" class="workspace-card-icon-btn" data-action="toggle-repo-menu" data-repo-id="' + esc(repo.id) + '" aria-haspopup="menu" aria-expanded="' + (menuOpen ? 'true' : 'false') + '" aria-label="Repository actions">⋯</button>'
    + (menuOpen ? '<div class="workspace-card-menu repo-group-menu" role="menu">'
        + '<button type="button" data-action="open-edit-repo" data-repo-id="' + esc(repo.id) + '">Edit Repository</button>'
        + '<button type="button" class="danger" data-action="delete-repo" data-repo-id="' + esc(repo.id) + '">Delete Repository</button>'
      + '</div>' : '')
  + '</div>';
  const chevron = '<button type="button" class="repo-group-collapse" data-action="toggle-repo-collapse" data-repo-id="' + esc(repo.id) + '" aria-expanded="' + (collapsed ? 'false' : 'true') + '" aria-label="' + (collapsed ? 'Expand' : 'Collapse') + ' agent list">▼</button>';
  return '<section class="repo-group ' + (collapsed ? 'collapsed' : '') + '" data-repo-id="' + esc(repo.id) + '">'
    + '<div class="repo-group-head">'
      + '<div class="repo-group-id">' + chevron + '<div class="repo-group-id-text"><span>' + esc(repo.name) + '</span>' + (repo.absolutePath ? '<small class="repo-group-id-sep">·</small><small class="mono">' + esc(repo.absolutePath) + '</small>' : '') + '</div></div>'
      + '<div class="repo-group-actions">'
        + '<button class="btn secondary small" data-action="open-add-agent" data-repo-id="' + esc(repo.id) + '">+ Add Agent</button>'
        + overflow
      + '</div>'
    + '</div>'
    + '<div class="agent-row-list">' + roleRows + '</div>'
  + '</section>';
}

function rolesForRepo(repo) {
  return sortedAgentRoles().filter(role =>
    role.repo_id === repo.id || role.repoId === repo.id || role.repo_name === repo.name || role.repoName === repo.name
  );
}

function agentCard(role) {
  const state = getState();
  // EP-DEC-RUN WA-006 (advisor msg #24): identify by displayId so two
  // same-bare-name roles in different repos render + control distinctly.
  const addr = roleDisplayId(role);
  const runner = runnerFor(addr);
  const online = Boolean(runner?.reachable);
  const missing = Boolean(role.missing_at);
  const isMain = state.mainRole?.id === role.id;
  const menuOpen = agentOverviewMenuRole === addr;
  const overflowMenu = menuOpen ? agentCardMenu(role, runner, isMain) : '';
  const overflow = '<button type="button" class="workspace-card-icon-btn agent-card-overflow" data-action="toggle-agent-card-menu" data-role="' + esc(addr) + '" aria-haspopup="menu" aria-expanded="' + (menuOpen ? 'true' : 'false') + '" aria-label="Agent actions">' + esc('\u22EF') + '</button>';
  const assignedRoles = Array.isArray(role.roles) ? role.roles.map(item => typeof item === 'string' ? item : item?.name).filter(Boolean) : [];
  const roleChips = assignedRoles.length ? assignedRoles.map(name => badge(name, '', false)).join('') : '<span class="agent-card-roles-empty">&mdash;</span>';
  const currentSummary = String(role.summary || '').trim() || '&mdash;';
  return '<article class="workspace-card agent-card ' + (missing ? 'missing' : '') + '" data-role="' + esc(addr) + '">' +
    '<div class="workspace-card-head">' +
      '<div class="agent-card-id">' + avatarForRole(role) +
        '<div>' +
          '<h2 class="workspace-card-title" ' + truncatedAttrs(addr) + '>' + esc(addr) + agentCardBadges(online, missing, isMain) + '</h2>' +
          '<div class="agent-card-meta">' + esc(roleRuntimeLabel(role)) + ' | Roles: <span class="agent-card-rbac-chips">' + roleChips + '</span></div>' +
          '<div class="agent-card-summary">Current summary: ' + currentSummary + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="workspace-card-actions agent-card-actions">' + rowRuntimeActions(role, runner, missing) + overflow + '</div>' +
    '</div>' +
    staleRunnerBanner(runner) +
    overflowMenu +
  '</article>';
}

function agentCardBadges(online, missing, isMain) {
  return statusBadge(online, missing) + (isMain ? badge('main', 'main', true) : '');
}

function staleRunnerBanner(runner) {
  if (!runner?.stale_pulse_endpoint) return '';
  return '<div class="agent-stale-runner-banner" role="status">Stale runner \u2014 restart for TUI redraw fix</div>';
}

function agentCardMenu(role, runner, isMain) {
  const addr = roleDisplayId(role);
  const items = [];
  items.push('<button type="button" data-action="open-agent-edit" data-role="' + esc(addr) + '">Edit</button>');
  if (isMain) {
    items.push('<button type="button" data-action="unset-main" data-role="' + esc(addr) + '">Remove main</button>');
  } else {
    items.push('<button type="button" data-action="set-main" data-role="' + esc(addr) + '">Set main</button>');
  }
  if (!isMain) items.push('<button type="button" class="danger" data-action="delete-agent-role" data-role="' + esc(addr) + '">Delete</button>');
  return '<div class="workspace-card-menu agent-card-menu" role="menu">' + items.join('') + '</div>';
}

function statusBadge(online, missing) {
  if (missing) return badge('missing', 'missing', false);
  return online ? badge('online', 'online', true) : badge('offline', 'offline', false);
}

function rowRuntimeActions(role, runner, missing) {
  const addr = roleDisplayId(role);
  if (runner?.reachable) {
    return '<button class="btn small icon-btn agent-stop-btn" data-action="confirm-stop-role" data-role="' + esc(addr) + '" title="Stop" aria-label="Stop">' + iconStop() + '</button>';
  }
  if (missing) return '<button class="btn small icon-btn" disabled aria-label="Launch unavailable">' + iconLaunch() + '</button>';
  return agentsLaunchControl(role, runner);
}

function iconLaunch() {
  return '<svg class="agent-action-icon" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 2 L11 7 L3 12 Z" fill="currentColor"/></svg>';
}

function iconStop() {
  return '<svg class="agent-action-icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" fill="currentColor"/></svg>';
}

export function agentsLaunchControl(role, runner) {
  const addr = roleDisplayId(role);
  if (runner) return '<button class="btn small" data-action="launch" data-role="' + esc(addr) + '">Attach</button>';
  const defaultRuntime = defaultHostForRole(role);
  const defaultLaunchable = defaultRuntime ? isHostLaunchable(defaultRuntime) : false;
  const hasUsableDefault = Boolean(defaultRuntime) && defaultLaunchable;
  const launchAction = hasUsableDefault ? 'launch' : 'toggle-launch-menu';
  const launchableHosts = ['claude-code', 'opencode', 'codex', 'pi'].filter(host => isHostLaunchable(host));
  const launchDisabled = !hasUsableDefault && launchableHosts.length === 0;
  const hostMenuItems = launchableHosts
    .map(host => '<button data-action="launch-host" data-role="' + esc(addr) + '" data-host="' + host + '">' + peerIcon(host, 18) + hostLabel(host) + '</button>')
    .join('');
  const menu = getOpenLaunchMenuRole() === addr
    ? '<div class="launch-menu">' + (hostMenuItems || '<div class="launch-menu-empty">No runtimes detected. Configure in Settings &rarr; Runtime.</div>') + '</div>'
    : '';
  return '<div class="launch-split"><button class="btn small icon-btn agent-launch-btn" data-action="' + launchAction + '" data-role="' + esc(addr) + '" data-host="default" ' + (launchDisabled ? 'disabled' : '') + ' title="Launch" aria-label="Launch">' + iconLaunch() + '</button><button class="launch-arrow" data-action="toggle-launch-menu" data-role="' + esc(addr) + '" aria-label="Choose agent type" aria-expanded="' + (getOpenLaunchMenuRole() === addr ? 'true' : 'false') + '">&#9660;</button>' + menu + '</div>';
}

export function agentsRenderLaunchDialog() {
  const state = getState();
  $('modalRoot').textContent = shortPath(state.root);
  // EP-DEC-RUN WA-006 (advisor msg #26): selectedLaunchRole stores
  // displayId; resolve via address (accepts either form for back-compat).
  const selectedRaw = getSelectedLaunchRole();
  const selected = (state.roles || []).find((r) => r.name === selectedRaw || roleDisplayId(r) === selectedRaw) || state.roles[0];
  if (selected && roleDisplayId(selected) !== selectedRaw) setSelectedLaunchRole(roleDisplayId(selected));
  const defaultRuntime = defaultHostForRole(selected);
  const defaultLaunchable = defaultRuntime ? isHostLaunchable(defaultRuntime) : false;
  const allHosts = [
    ['default', 'Role default', defaultRuntime
      ? (defaultLaunchable ? hostLabel(defaultRuntime) + ' default' : 'Default unavailable - ' + hostLabel(defaultRuntime) + ' not detected')
      : 'No default; choose a runtime below'],
    ['claude-code', 'Claude Code', 'Anthropic CLI agent'],
    ['opencode', 'OpenCode', 'OpenCode TUI agent'],
    ['codex', 'Codex', 'Codex CLI agent with WhatsAgent MCP tools'],
    ['pi', 'Pi', 'Pi TUI agent with generated WhatsAgent extension'],
  ];
  const hosts = allHosts.filter(([id]) => id === 'default' || isHostLaunchable(id));
  if (!hosts.some(([id]) => id === getSelectedLaunchHost())) setSelectedLaunchHost('default');
  $('launchHostCards').innerHTML = hosts.map(([id, label, sub]) => {
    const disabled = id === 'default' ? !defaultLaunchable : false;
    return '<button class="choice ' + (getSelectedLaunchHost() === id ? 'active' : '') + '" data-action="select-host" data-host="' + id + '" ' + (disabled ? 'disabled' : '') + '><div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' + peerIcon(id === 'default' ? (defaultRuntime || 'claude-code') : id, 20) + '<span style="font-size:13px;font-weight:700">' + label + '</span></div><div style="font-size:11px;color:var(--muted)">' + esc(sub) + '</div></button>';
  }).join('');
  // EP-DEC-RUN WA-006 (advisor msg #26): role-pick buttons key on
  // displayId so two `main` agents in different repos render distinctly.
  const launchRoleListHtml = state.roles.map(role => {
    const addr = roleDisplayId(role);
    return '<button class="role-pick ' + (getSelectedLaunchRole() === addr ? 'active' : '') + '" data-action="select-launch-role" data-role="' + esc(addr) + '" ' + (role.missing_at ? 'disabled' : '') + '><span style="font-size:14px">' + (role.git_root ? '\u2387' : '\u25A1') + '</span><div style="flex:1"><div class="mono" style="font-size:13px;font-weight:600">' + esc(role.name) + '</div><div style="font-size:11px;color:var(--muted);margin-top:1px">' + esc(role.path) + '</div></div>' + (runnerFor(addr) ? badge('attach', 'live', true) : role.missing_at ? badge('missing', 'missing', false) : '') + '</button>';
  }).join('');
  $('launchRoleList').innerHTML = launchRoleListHtml;
}

function quoteArg(value) {
  const text = String(value ?? '');
  return /^[A-Za-z0-9_./:=@%+-]+$/.test(text) ? text : JSON.stringify(text);
}

function commandLine(value) {
  const command = String(value?.command || '').trim();
  const args = Array.isArray(value?.args) ? value.args : [];
  return [command || '<unset-command>', ...args.map(arg => String(arg))].map(quoteArg).join(' ');
}

export function renderAgentsSettingsTabContent(tab, cfg) {
  if (tab === 'runtime') return runtimeSettingsPanel(cfg);
  if (tab === 'diagnostics') return diagnosticsPanel(cfg);
  return null;
}

function runtimeSettingsPanel(cfg) {
  const state = getState();
  const runtime = state.runtime || { commands: cfg.commands || {} };
  const commands = runtime.commands || cfg.commands || {};
  const redetectButton = '<div class="runtime-redetect-row"><button type="button" class="btn secondary small" data-action="redetect-all-runtimes" ' + (runtimeRedetectInFlight ? 'disabled' : '') + '>' + (runtimeRedetectInFlight ? 'Re-detecting…' : 'Re-detect All') + '</button><span class="runtime-redetect-help">Re-runs version probes for every runtime. Use after installing a runtime in another terminal.</span></div>';
  return '<section class="card card-pad settings-wide runtime-settings"><div class="section-head"><div><h2>Runtime</h2>' + settingsWorkspaceSubtitle('daemon') + '<p>Launch defaults and runtime command settings for all roles.</p></div></div>' +
    globalDefaultRuntimeRow() +
    runtimeCommandFields('claudeCode', 'Claude Code', commands.claudeCode) + runtimeCommandFields('codex', 'Codex', commands.codex) + runtimeCommandFields('openCode', 'OpenCode', commands.openCode) + runtimeCommandFields('pi', 'Pi', commands.pi) +
    redetectButton +
  '</section>' + settingsBottomActionBar('runtime', runtimeSettingsStatus || 'Unsaved runtime changes.', { saveAction: 'save-runtime-settings', cancelAction: 'cancel-runtime-settings', saving: runtimeSettingsSaving });
}

function diagnosticsPanel(cfg) {
  const state = getState();
  const runtime = state.runtime || { globalDefaultHost: null, commands: cfg.commands || {} };
  const globalDefault = runtime.globalDefaultHost ? hostLabel(runtime.globalDefaultHost) : 'not set';
  const ws = state.currentWorkspace || null;
  const workspaceCount = typeof state.workspacesAvailable === 'number' ? state.workspacesAvailable : (ws ? 1 : 0);
  return '<section class="card card-pad settings-wide diagnostics-info"><div class="section-head"><div><h2>Fleet Info</h2><p>Read-only state and paths used by this daemon.</p></div></div><div class="settings-kv-wrap">' +
    kv('Workspace', ws ? ws.name + ' (' + ws.type + ')' : 'no workspace registered', false) +
    kv('Workspace path', ws ? ws.path : 'n/a', true) +
    kv('Workspaces (active)', String(workspaceCount), true) +
    kv('Fleet', cfg.fleet.name, true) + kv('Root', state.root, true) + kv('UI', cfg.ui.host + ':' + cfg.ui.port, true) + kv('Policy', state.policy?.mode || cfg.policy.mode, true) + kv('Main role', state.mainRole?.name || 'not set', true) + kv('Global default runtime', globalDefault, true) + kv('Daemon log', state.logPath || '.whatsagent/logs/daemon.log', true) + kv('Runner logs', '.whatsagent/logs/runner-<role>.log', true) +
    '</div></section><section class="card card-pad settings-wide diagnostics-runners"><div class="section-head"><div><h2>Runner Diagnostics</h2><p>Native push capability and current runner metadata.</p></div></div>' + runnerDiagnostics() + '</section>';
}

function globalDefaultRuntimeRow() {
  const current = getState().runtime?.globalDefaultHost || '';
  const options = [['', 'No default'], ['claude-code', 'Claude Code'], ['opencode', 'OpenCode'], ['codex', 'Codex'], ['pi', 'Pi']];
  return settingRow('Global default runtime', 'Used for newly discovered roles and Launch when a role has no override.', settingsDropdown('Global default runtime', current, options, { inputAttrs: 'data-global-default-runtime' }));
}

function runtimeCommandFields(key, label, value) {
  const command = value?.command || '';
  const args = (value?.args || []).join('\n');
  const enabled = value?.enabled !== false;
  const host = hostForRuntimeKey(key);
  const detection = host ? detectionForHost(host) : null;
  const chip = renderDetectionChip(detection);
  const enabledDisabled = !detection?.detected;
  const enabledChecked = enabled && detection?.detected;
  const enabledTitle = enabledDisabled ? 'Runtime not detected. Set a valid command path to enable.' : '';
  return '<div class="setting-row runtime-command" data-runtime-key="' + key + '">' +
    '<span class="setting-title">' + esc(label) + '</span>' +
    '<div class="runtime-command-controls">' +
      '<label class="runtime-enabled-row" title="' + esc(enabledTitle) + '"><span class="runtime-field-label">Enabled</span><input type="checkbox" data-runtime-enabled="' + key + '" ' + (enabledChecked ? 'checked' : '') + ' ' + (enabledDisabled ? 'disabled' : '') + ' /></label>' +
      '<label class="runtime-field"><span>Command ' + chip + '</span><input data-runtime-command="' + key + '" value="' + esc(command) + '" placeholder="' + esc(label.toLowerCase()) + '" /></label>' +
      '<label class="runtime-field"><span>Arguments (one per line)</span><textarea rows="3" spellcheck="false" data-runtime-args="' + key + '">' + esc(args) + '</textarea></label>' +
      '<label class="runtime-field"><span>Command preview</span><input class="runtime-command-preview-input" readonly data-command-preview="' + key + '" value="' + esc(commandLine(value || { command, args: [] })) + '" /></label>' +
    '</div></div>';
}

function renderDetectionChip(detection) {
  if (!detection) return '<span class="runtime-detect-chip detect-pending">probing…</span>';
  if (detection.detected) {
    const ver = detection.version ? ' &middot; ' + esc(detection.version) : '';
    return '<span class="runtime-detect-chip detect-ok" title="' + esc(detection.resolvedPath || '') + '">&#9679; ' + esc(detection.resolvedPath || 'detected') + ver + '</span>';
  }
  if (detection.error === 'not_found') return '<span class="runtime-detect-chip detect-missing">&#9675; not found</span>';
  const reason = detection.error || 'probe failed';
  return '<span class="runtime-detect-chip detect-error">&#9888; probe failed: ' + esc(reason) + '</span>';
}

function updateRuntimeCommandPreview(key) {
  const command = document.querySelector('[data-runtime-command="' + key + '"]')?.value || '';
  const argsText = document.querySelector('[data-runtime-args="' + key + '"]')?.value || '';
  const preview = document.querySelector('[data-command-preview="' + key + '"]');
  if (!preview) return;
  const text = commandLine({ command, args: argsText.split(/\r?\n/).map(item => item.trim()).filter(Boolean) });
  if (preview.tagName === 'INPUT' || preview.tagName === 'TEXTAREA') preview.value = text;
  else preview.textContent = text;
}

async function copyCommandPreview(button) {
  const preview = button.closest('.command-preview')?.querySelector('code');
  const text = preview?.textContent || '';
  if (!text) return;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
  } catch {}
}

async function saveRuntimeSettings() {
  const state = getState();
  const runtime = state.runtime || { globalDefaultHost: null, commands: state.config.commands };
  const commands = { ...(runtime.commands || state.config.commands) };
  document.querySelectorAll('[data-runtime-command]').forEach(input => {
    const key = input.dataset.runtimeCommand;
    const argsEl = document.querySelector('[data-runtime-args="' + key + '"]');
    const enabledEl = document.querySelector('[data-runtime-enabled="' + key + '"]');
    const previousEnabled = (commands[key]?.enabled !== false);
    const enabledFromCheckbox = enabledEl ? Boolean(enabledEl.checked) : previousEnabled;
    commands[key] = {
      command: input.value,
      args: String(argsEl?.value || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean),
      enabled: enabledFromCheckbox,
    };
  });
  const globalDefaultHost = document.querySelector('[data-global-default-runtime]')?.value || null;
  runtimeSettingsSaving = true;
  try {
    const runtimeRes = await fetch('/api/v1/settings/runtime', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...runtime, globalDefaultHost, commands }) });
    const runtimeBody = await runtimeRes.json();
    if (!runtimeRes.ok || runtimeBody.ok === false) throw new Error(runtimeBody.error || 'runtime save failed');
    patchState({
      runtime: runtimeBody.runtime,
      runtimeDetection: runtimeBody.runtimeDetection || getState().runtimeDetection,
      config: { ...getState().config, commands: runtimeBody.runtime.commands },
    });
    runtimePolicyDraftMode = '';
    runtimeSettingsStatus = 'Saved runtime settings.';
  } catch (e) {
    runtimeSettingsStatus = 'Failed to save runtime settings: ' + String(e?.message || e);
  } finally {
    runtimeSettingsSaving = false;
    if (getPage() === 'settings') renderSettings();
  }
}

const runtimeCommandProbeTimers = {};
function scheduleRuntimeCommandProbe(key, command) {
  const host = hostForRuntimeKey(key);
  if (!host) return;
  if (runtimeCommandProbeTimers[key]) clearTimeout(runtimeCommandProbeTimers[key]);
  runtimeCommandProbeTimers[key] = setTimeout(() => {
    delete runtimeCommandProbeTimers[key];
    void runRuntimeCommandProbe(host, key, command);
  }, 400);
}

async function runRuntimeCommandProbe(host, key, command) {
  const trimmed = String(command || '').trim();
  try {
    const url = '/api/v1/settings/runtime/detect/' + encodeURIComponent(host) + '?command=' + encodeURIComponent(trimmed);
    const res = await fetch(url, { method: 'POST' });
    const body = await res.json();
    if (!res.ok || body.ok === false) return;
    const state = getState();
    if (!state.runtimeDetection) state.runtimeDetection = {};
    state.runtimeDetection[host] = body.detection;
    updateRuntimeDetectionChip(key, body.detection);
  } catch {
    // network errors ignored.
  }
}

function updateRuntimeDetectionChip(key, detection) {
  const card = document.querySelector('[data-runtime-key="' + key + '"]');
  if (!card) return;
  const span = card.querySelector('.runtime-field span');
  if (!span) return;
  const chipNode = span.querySelector('.runtime-detect-chip');
  const fresh = renderDetectionChip(detection);
  if (chipNode) {
    chipNode.outerHTML = fresh;
  } else {
    span.insertAdjacentHTML('beforeend', ' ' + fresh);
  }
  const enabledEl = card.querySelector('[data-runtime-enabled="' + key + '"]');
  if (enabledEl) {
    if (!detection?.detected) {
      enabledEl.checked = false;
      enabledEl.disabled = true;
    } else {
      enabledEl.disabled = false;
    }
  }
}

async function redetectAllRuntimes() {
  if (runtimeRedetectInFlight) return;
  runtimeRedetectInFlight = true;
  if (getPage() === 'settings' && getSelectedSettingsTab() === 'runtime') renderSettings();
  try {
    const res = await fetch('/api/v1/settings/runtime/detect', { method: 'POST' });
    const body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'detect failed');
    patchState({ runtimeDetection: body.runtimeDetection || getState().runtimeDetection });
    runtimeSettingsStatus = 'Re-detected runtimes.';
  } catch (e) {
    runtimeSettingsStatus = 'Failed to re-detect runtimes: ' + String(e?.message || e);
  } finally {
    runtimeRedetectInFlight = false;
    if (getPage() === 'settings' && getSelectedSettingsTab() === 'runtime') renderSettings();
  }
}

function cancelRuntimeSettings() {
  runtimePolicyDraftMode = '';
  runtimeSettingsStatus = 'Discarded unsaved runtime changes.';
  if (getPage() === 'settings' && getSelectedSettingsTab() === 'runtime') renderSettings();
}

async function savePeerRuleMode(mode) {
  const res = await workspaceFetch('/settings/peer-policy', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
  const body = await res.json();
  if (res.ok && body.ok !== false) {
    patchState({ peerPolicy: body.peerPolicy });
    runtimeSettingsStatus = 'Saved peer rule mode.';
  } else {
    runtimeSettingsStatus = 'Failed to save peer rule mode: ' + (body.error || 'request failed');
  }
  if (getPage() === 'settings') renderSettings();
}

async function addPeerRuleFromSettings() {
  const roleA = document.querySelector('[data-peer-role-a]')?.value || '';
  const roleB = document.querySelector('[data-peer-role-b]')?.value || '';
  const res = await workspaceFetch('/settings/peer-policy/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roleA, roleB }) });
  const body = await res.json();
  if (res.ok && body.ok !== false) {
    patchState({ peerPolicy: body.peerPolicy });
    runtimeSettingsStatus = 'Added peer rule.';
  } else {
    runtimeSettingsStatus = 'Failed to add peer rule: ' + (body.error || 'request failed');
  }
  if (getPage() === 'settings') renderSettings();
}

async function removePeerRuleFromSettings(id) {
  if (!id) return;
  const res = await workspaceFetch('/settings/peer-policy/rules/' + encodeURIComponent(id), { method: 'DELETE' });
  const body = await res.json();
  if (res.ok && body.ok !== false) {
    patchState({ peerPolicy: body.peerPolicy });
    runtimeSettingsStatus = 'Removed peer rule.';
  } else {
    runtimeSettingsStatus = 'Failed to remove peer rule: ' + (body.error || 'request failed');
  }
  if (getPage() === 'settings') renderSettings();
}

async function saveGlobalRuntimeDefault() {
  const state = getState();
  const host = document.querySelector('[data-global-default-runtime]')?.value || null;
  const runtime = state.runtime || { commands: state.config.commands };
  const res = await fetch('/api/v1/settings/runtime', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...runtime, globalDefaultHost: host }) });
  const body = await res.json();
  if (res.ok && body.ok !== false) patchState({ runtime: body.runtime });
  if (getPage() === 'settings') renderSettings();
}

function changeDefaultRuntime(roleName) {
  openDefaultRuntimeDialog(roleName);
}

function ensureDefaultRuntimeDialog() {
  let modal = $('defaultRuntimeModal');
  if (!modal) {
    document.body.insertAdjacentHTML('beforeend', '<div id="defaultRuntimeModal" class="modal-backdrop hidden"></div>');
    modal = $('defaultRuntimeModal');
    setModalCloseHandler(modal, closeDefaultRuntimeDialog);
  }
  return modal;
}

function openDefaultRuntimeDialog(roleName) {
  const role = roleByName(roleName);
  if (!role) return;
  defaultRuntimeDialogRole = role.name;
  defaultRuntimeDialogHost = role.host_default || '';
  defaultRuntimeDialogStatus = '';
  defaultRuntimeDialogSaving = false;
  renderDefaultRuntimeDialog();
  ensureDefaultRuntimeDialog().classList.remove('hidden');
}

function renderDefaultRuntimeDialog() {
  const state = getState();
  const modal = ensureDefaultRuntimeDialog();
  const role = roleByName(defaultRuntimeDialogRole);
  const globalDefault = state.runtime?.globalDefaultHost || '';
  const status = defaultRuntimeDialogStatus ? '<div class="agent-text-status">' + esc(defaultRuntimeDialogStatus) + '</div>' : '';
  modal.innerHTML = '<div class="modal default-runtime-modal"><div class="modal-title">Change Default Runtime</div><div class="modal-sub">Choose the default runtime for <span class="mono">' + esc(role?.name || defaultRuntimeDialogRole) + '</span>. Launch dropdown choices still run once and do not change this default.</div>' +
    '<div class="runtime-default-grid">' +
    runtimeDefaultChoice('', 'Use global default', globalDefault ? 'Falls back to ' + hostLabel(globalDefault) : 'No global default is set') +
    runtimeDefaultChoice('claude-code', 'Claude Code', 'Use Anthropic Claude Code for this role') +
    runtimeDefaultChoice('opencode', 'OpenCode', 'Use OpenCode TUI for this role') +
    runtimeDefaultChoice('codex', 'Codex', 'Use Codex CLI with WhatsAgent MCP tools') +
    runtimeDefaultChoice('pi', 'Pi', 'Use Pi TUI with generated WhatsAgent extension') +
    '</div>' + status +
    '<div class="modal-actions"><button class="btn secondary" data-action="close-default-runtime-dialog" ' + (defaultRuntimeDialogSaving ? 'disabled' : '') + '>Cancel</button><button class="btn" data-action="save-default-runtime-dialog" ' + (defaultRuntimeDialogSaving ? 'disabled' : '') + '>Save Default</button></div></div>';
}

function runtimeDefaultChoice(host, label, sub) {
  const value = host || '';
  const active = defaultRuntimeDialogHost === value;
  const iconHost = host || getState().runtime?.globalDefaultHost || 'claude-code';
  return '<button type="button" class="choice runtime-default-choice pill ' + (active ? 'active' : '') + '" data-action="select-default-runtime" data-host="' + esc(value) + '"><div class="runtime-choice-head">' + peerIcon(iconHost, 20) + '<span>' + esc(label) + '</span></div><div class="runtime-choice-sub">' + esc(sub) + '</div></button>';
}

function closeDefaultRuntimeDialog() {
  const modal = $('defaultRuntimeModal');
  if (modal) modal.classList.add('hidden');
  defaultRuntimeDialogRole = '';
  defaultRuntimeDialogHost = '';
  defaultRuntimeDialogStatus = '';
  defaultRuntimeDialogSaving = false;
}

async function saveDefaultRuntimeDialog() {
  if (!defaultRuntimeDialogRole || defaultRuntimeDialogSaving) return;
  const roleName = defaultRuntimeDialogRole;
  const role = roleByName(roleName);
  if (!role || !role.id) {
    defaultRuntimeDialogStatus = 'Failed to update default runtime: role not found';
    renderDefaultRuntimeDialog();
    return;
  }
  const host = defaultRuntimeDialogHost || null;
  defaultRuntimeDialogSaving = true;
  defaultRuntimeDialogStatus = '';
  renderDefaultRuntimeDialog();
  try {
    // EP-DEC-RUN WA-005 (advisor msg #20): UUID-keyed route. Has the role
    // row in scope so no encoding needed; bare-name path would target the
    // wrong repo's row once WA-006 permits duplicate role names.
    const res = await workspaceFetch('/roles-by-id/' + encodeURIComponent(role.id) + '/default-runtime', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host }) });
    const body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || 'Failed to update default runtime');
    const state = getState();
    patchState({ roles: state.roles.map(item => item.id === role.id ? body.role : item) });
    closeDefaultRuntimeDialog();
    render();
  } catch (e) {
    defaultRuntimeDialogSaving = false;
    defaultRuntimeDialogStatus = 'Failed to update default runtime: ' + String(e?.message || e);
    renderDefaultRuntimeDialog();
  }
}

async function refreshDiscoveredRoles() {
  const next = await workspaceFetch('/status').then(r => r.json());
  patchState({ ...next });
  render();
}

const RUNTIME_PILLS = [
  ['default', 'Global default'],
  ['claude-code', 'Claude Code'],
  ['codex', 'Codex'],
  ['opencode', 'OpenCode'],
  ['pi', 'Pi'],
];

function runtimePillsHtml(scope, current) {
  return RUNTIME_PILLS.map(([value, label]) => {
    const active = current === value;
    return '<button type="button" class="runtime-pill ' + (active ? 'active' : '') + '" role="radio" aria-checked="' + (active ? 'true' : 'false') + '" data-action="select-runtime-pill" data-scope="' + scope + '" data-value="' + esc(value) + '">' + esc(label) + '</button>';
  }).join('');
}

function renderRuntimePills(containerId, scope, current) {
  const el = $(containerId);
  if (!el) return;
  el.innerHTML = runtimePillsHtml(scope, current);
}

function openAddAgentModal(repoId = '') {
  const state = getState();
  const modal = $('addAgentModal');
  if (!modal) return;
  addAgentRepoId = repoId || (state.repos || [])[0]?.id || '';
  addAgentRuntime = 'default';
  $('addAgentName').value = '';
  // Reset operator checkbox proactively — `renderAddAgentRoles` re-syncs
  // once roles load, but a stale `checked` state would flash in between.
  if ($('addAgentOperatorCheckbox')) $('addAgentOperatorCheckbox').checked = false;
  renderRuntimePills('addAgentRuntimePills', 'add-agent', addAgentRuntime);
  const repoRow = $('addAgentRepoRow');
  const repoContainer = $('addAgentRepoContainer');
  repoRow?.classList.remove('hidden');
  const repoOptions = (state.repos || []).map(repo => [repo.id, repo.name + ' - ' + repo.absolutePath]);
  if (repoContainer) repoContainer.innerHTML = repoOptions.length
    ? settingsDropdown('add-agent-repo', addAgentRepoId, repoOptions, { inputAttrs: 'data-add-agent-repo' })
    : '<div class="thread-empty">Add a repository before adding agents.</div>';
  $('addAgentStatus').textContent = '';
  $('addAgentStatus').classList.remove('error');
  addAgentAvailableRoles = null;
  addAgentAssignedRoleIds = new Set();
  addAgentRolesError = '';
  addAgentRolesLoading = false;
  renderAddAgentRoles();
  void loadAddAgentRoles();
  modal.classList.remove('hidden');
  setTimeout(() => $('addAgentName')?.focus(), 0);
}

async function loadAddAgentRoles() {
  addAgentRolesLoading = true;
  renderAddAgentRoles();
  try {
    const res = await workspaceFetch('/rbac/roles');
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(body.error || 'failed to load roles');
    addAgentAvailableRoles = (body.roles || []).map(r => ({
      id: r.id, name: r.name, description: r.description || '', is_builtin: r.is_builtin === 1,
    }));
    applyAddAgentNameDefault();
    addAgentRolesError = '';
  } catch (e) {
    addAgentRolesError = String(e?.message || e);
  } finally {
    addAgentRolesLoading = false;
    renderAddAgentRoles();
  }
}

// Re-seed the chip selection from the current Name input value. Called
// on first load and whenever the user types in the Name field. Idempotent —
// always replaces the set rather than merging, so typing then clearing
// resets cleanly.
function applyAddAgentNameDefault() {
  if (!addAgentAvailableRoles) return;
  const nameInput = $('addAgentPageName') || $('addAgentName');
  // Lowercase the lookup key — agents.name is sanitized to lowercase
  // server-side at insert time, so a user typing `Main` should still
  // resolve to the `main` defaults (pm + operator). Without this the
  // typed-case mismatch silently fell back to the generic engineer
  // default. Per advisor non-blocking note on slice 5b (msg 347).
  const name = String(nameInput?.value || '').trim().toLowerCase();
  const defaults = NAME_DEFAULTS_FOR_NEW_AGENT[name] || NAME_DEFAULT_FALLBACK;
  const idByName = new Map(addAgentAvailableRoles.map(r => [r.name, r.id]));
  addAgentAssignedRoleIds = new Set();
  for (const roleName of defaults) {
    const id = idByName.get(roleName);
    if (id) addAgentAssignedRoleIds.add(id);
  }
}

// RBAC Phase 4 (WA-089): operator role is promoted to a top-level
// Operator-surrogate checkbox. Hiding it from the chip picker prevents
// duplicate toggles and keeps the internal taxonomy out of the chrome.
function getOperatorRoleId(roles) {
  if (!roles) return '';
  const hit = roles.find(r => r && r.name === 'operator' && r.is_builtin);
  return hit ? hit.id : '';
}

function syncAddAgentOperatorCheckbox() {
  const id = getOperatorRoleId(addAgentAvailableRoles);
  for (const checkbox of [$("addAgentOperatorCheckbox"), $("addAgentPageOperatorCheckbox")]) {
    if (!checkbox) continue;
    checkbox.checked = Boolean(id) && addAgentAssignedRoleIds.has(id);
  }
}

function addAgentRolesHtml() {
  if (addAgentRolesLoading) return '<div class="agent-edit-roles-empty">Loading roles…</div>';
  if (addAgentRolesError) return '<div class="agent-edit-roles-empty">Failed to load: ' + esc(addAgentRolesError) + '</div>';
  if (!addAgentAvailableRoles || addAgentAvailableRoles.length === 0) return '<div class="agent-edit-roles-empty">No roles defined.</div>';
  return addAgentAvailableRoles
    .filter(r => !(r.name === 'operator' && r.is_builtin))
    .map(r => {
      const selected = addAgentAssignedRoleIds.has(r.id);
      const builtinTag = r.is_builtin ? '<span class="agent-role-builtin">built-in</span>' : '';
      return '<button type="button" class="agent-role-chip' + (selected ? ' selected' : '') +
        '" data-action="toggle-add-agent-role" data-role-id="' + esc(r.id) + '"' +
        ' aria-pressed="' + (selected ? 'true' : 'false') + '"' +
        ' title="' + esc(r.description || r.name) + '">' +
        esc(r.name) + builtinTag + '</button>';
    }).join('');
}

function renderAddAgentRoles() {
  const html = addAgentRolesHtml();
  for (const el of [$("addAgentRolesPicker"), $("addAgentPageRolesPicker")]) {
    if (el) el.innerHTML = html;
  }
  syncAddAgentOperatorCheckbox();
}

function toggleAddAgentOperatorCheckbox(checked) {
  const id = getOperatorRoleId(addAgentAvailableRoles);
  if (!id) return;
  if (checked) addAgentAssignedRoleIds.add(id);
  else addAgentAssignedRoleIds.delete(id);
  // Re-render to keep aria states + checkbox UI in sync.
  renderAddAgentRoles();
}

function toggleAddAgentRole(roleId) {
  if (!roleId) return;
  if (addAgentAssignedRoleIds.has(roleId)) addAgentAssignedRoleIds.delete(roleId);
  else addAgentAssignedRoleIds.add(roleId);
  renderAddAgentRoles();
}

function closeAddAgentModal() {
  if (addAgentSaving) return;
  $('addAgentModal')?.classList.add('hidden');
}

async function submitAddAgent() {
  if (addAgentSaving) return;
  const name = inputValue(['addAgentPageName', 'addAgentName']).trim();
  if (!name) { setAddAgentStatus('Name is required.', true); return; }
  const runtime = addAgentRuntime || 'default';
  const repoId = String(document.querySelector('[data-add-agent-repo-page]')?.value || document.querySelector('[data-add-agent-repo]')?.value || '').trim();
  if (!repoId) { setAddAgentStatus('repoId is required.', true); return; }
  addAgentSaving = true;
  if ($('addAgentSubmitBtn')) $('addAgentSubmitBtn').disabled = true;
  document.querySelectorAll('[data-action="submit-add-agent-page"]').forEach(btn => { btn.disabled = true; });
  setAddAgentStatus('Creating…', false);
  setAgentPageStatus('Creating…', false);
  try {
    const res = await workspaceFetch('/roles-by-id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repoId, name, host: runtime === 'default' ? null : runtime }) });
    const respBody = await res.json().catch(() => ({}));
    if (!res.ok || respBody.ok === false) throw new Error(respBody.error || 'create failed');
    // RBAC Phase 3 slice 5b: persist role selection on the freshly-created
    // agent. Only PUT when role-list load succeeded — transient load
    // failure leaves the agent role-less rather than half-creating.
    const newAgentId = respBody.role?.id;
    if (newAgentId && addAgentAvailableRoles !== null) {
      const rolesRes = await workspaceFetch('/agents/' + encodeURIComponent(newAgentId) + '/roles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_ids: Array.from(addAgentAssignedRoleIds) }),
      });
      const rolesBody = await rolesRes.json().catch(() => ({}));
      if (!rolesRes.ok || rolesBody.ok === false) {
        // Agent already created; surface the role-save failure but don't
        // tear down the create.
        setAddAgentStatus('Agent created but roles save failed: ' + (rolesBody.error || rolesRes.statusText), true);
        setAgentPageStatus('Agent created but roles save failed: ' + (rolesBody.error || rolesRes.statusText), true);
        await refreshDiscoveredRoles();
        return;
      }
    }
    $('addAgentModal')?.classList.add('hidden');
    await refreshDiscoveredRoles();
    if (agentPageMode === 'create') openAgentsOverviewPage();
  } catch (e) {
    setAddAgentStatus('Failed to add agent: ' + String(e?.message || e), true);
    setAgentPageStatus('Failed to add agent: ' + String(e?.message || e), true);
  } finally {
    addAgentSaving = false;
    if ($('addAgentSubmitBtn')) $('addAgentSubmitBtn').disabled = false;
    document.querySelectorAll('[data-action="submit-add-agent-page"]').forEach(btn => { btn.disabled = false; });
  }
}

function setAddAgentStatus(message, error) {
  const el = $('addAgentStatus');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('error', Boolean(error));
}

function openAgentEditModal(roleName) {
  const role = roleByName(roleName);
  if (!role) return;
  agentEditingRole = { id: role.id, name: role.name, originalName: role.name, hostDefault: role.host_default || 'default' };
  agentEditRuntime = String(role.host_default || 'default');
  const modal = $('agentEditModal');
  if (!modal) return;
  $('agentEditName').value = role.name;
  renderRuntimePills('agentEditRuntimePills', 'agent-edit', agentEditRuntime);
  $('agentEditStatus').textContent = '';
  $('agentEditStatus').classList.remove('error');
  agentEditAvailableRoles = null;
  agentEditAssignedRoleIds = new Set();
  agentEditRolesError = '';
  agentEditRolesLoading = false;
  if ($('agentEditOperatorCheckbox')) $('agentEditOperatorCheckbox').checked = false;
  renderAgentEditRoles();
  void loadAgentEditRoles(role.id);
  modal.classList.remove('hidden');
  setTimeout(() => $('agentEditName')?.focus(), 0);
}

async function loadAgentEditRoles(agentId) {
  agentEditRolesLoading = true;
  renderAgentEditRoles();
  try {
    const [rolesRes, assignedRes] = await Promise.all([
      workspaceFetch('/rbac/roles'),
      workspaceFetch('/agents/' + encodeURIComponent(agentId) + '/roles'),
    ]);
    const rolesBody = await rolesRes.json().catch(() => ({}));
    const assignedBody = await assignedRes.json().catch(() => ({}));
    if (!rolesRes.ok || rolesBody.ok === false) throw new Error(rolesBody.error || 'failed to load roles');
    if (!assignedRes.ok || assignedBody.ok === false) throw new Error(assignedBody.error || 'failed to load assignments');
    agentEditAvailableRoles = (rolesBody.roles || []).map(r => ({
      id: r.id, name: r.name, description: r.description || '', is_builtin: r.is_builtin === 1,
    }));
    agentEditAssignedRoleIds = new Set((assignedBody.roles || []).map(r => r.role_id));
    agentEditRolesError = '';
  } catch (e) {
    agentEditRolesError = String(e?.message || e);
  } finally {
    agentEditRolesLoading = false;
    renderAgentEditRoles();
  }
}

// RBAC Phase 4 (WA-089): operator promoted to checkbox in the edit modal too.
function syncAgentEditOperatorCheckbox() {
  const id = getOperatorRoleId(agentEditAvailableRoles);
  for (const checkbox of [$("agentEditOperatorCheckbox"), $("agentEditPageOperatorCheckbox")]) {
    if (!checkbox) continue;
    checkbox.checked = Boolean(id) && agentEditAssignedRoleIds.has(id);
  }
}

function agentEditRolesHtml() {
  if (agentEditRolesLoading) return '<div class="agent-edit-roles-empty">Loading roles…</div>';
  if (agentEditRolesError) return '<div class="agent-edit-roles-empty">Failed to load: ' + esc(agentEditRolesError) + '</div>';
  if (!agentEditAvailableRoles || agentEditAvailableRoles.length === 0) return '<div class="agent-edit-roles-empty">No roles defined.</div>';
  return agentEditAvailableRoles
    .filter(r => !(r.name === 'operator' && r.is_builtin))
    .map(r => {
      const selected = agentEditAssignedRoleIds.has(r.id);
      const builtinTag = r.is_builtin ? '<span class="agent-role-builtin">built-in</span>' : '';
      return '<button type="button" class="agent-role-chip' + (selected ? ' selected' : '') +
        '" data-action="toggle-agent-edit-role" data-role-id="' + esc(r.id) + '"' +
        ' aria-pressed="' + (selected ? 'true' : 'false') + '"' +
        ' title="' + esc(r.description || r.name) + '">' +
        esc(r.name) + builtinTag + '</button>';
    }).join('');
}

function renderAgentEditRoles() {
  const html = agentEditRolesHtml();
  for (const el of [$("agentEditRolesPicker"), $("agentEditPageRolesPicker")]) {
    if (el) el.innerHTML = html;
  }
  syncAgentEditOperatorCheckbox();
}

function toggleAgentEditOperatorCheckbox(checked) {
  const id = getOperatorRoleId(agentEditAvailableRoles);
  if (!id) return;
  if (checked) agentEditAssignedRoleIds.add(id);
  else agentEditAssignedRoleIds.delete(id);
  renderAgentEditRoles();
}

function toggleAgentEditRole(roleId) {
  if (!roleId) return;
  if (agentEditAssignedRoleIds.has(roleId)) {
    agentEditAssignedRoleIds.delete(roleId);
  } else {
    agentEditAssignedRoleIds.add(roleId);
  }
  renderAgentEditRoles();
}

function closeAgentEditModal() {
  if (agentEditSaving) return;
  $('agentEditModal')?.classList.add('hidden');
  agentEditingRole = null;
}

async function submitAgentEdit() {
  if (!agentEditingRole || agentEditSaving) return;
  const name = inputValue(['agentEditPageName', 'agentEditName']).trim();
  if (!name) { setAgentEditStatus('Name is required.', true); return; }
  const runtime = agentEditRuntime || 'default';
  agentEditSaving = true;
  if ($('agentEditSubmitBtn')) $('agentEditSubmitBtn').disabled = true;
  document.querySelectorAll('[data-action="submit-agent-edit-page"]').forEach(btn => { btn.disabled = true; });
  setAgentEditStatus('Saving…', false);
  setAgentPageStatus('Saving…', false);
  try {
    if (!agentEditingRole.id) throw new Error('role id missing');
    const body = { name, host: runtime === 'default' ? null : runtime };
    const res = await workspaceFetch('/roles-by-id/' + encodeURIComponent(agentEditingRole.id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const respBody = await res.json().catch(() => ({}));
    if (!res.ok || respBody.ok === false) throw new Error(respBody.error || 'edit failed');
    // RBAC Phase 3 slice 5: persist role assignment alongside name+runtime.
    // Only PUT when the role list actually loaded — avoids clobbering on
    // a transient load failure.
    if (agentEditAvailableRoles !== null) {
      const rolesRes = await workspaceFetch('/agents/' + encodeURIComponent(agentEditingRole.id) + '/roles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_ids: Array.from(agentEditAssignedRoleIds) }),
      });
      const rolesBody = await rolesRes.json().catch(() => ({}));
      if (!rolesRes.ok || rolesBody.ok === false) {
        throw new Error('roles save failed: ' + (rolesBody.error || rolesRes.statusText));
      }
    }
    $('agentEditModal')?.classList.add('hidden');
    agentEditingRole = null;
    await refreshDiscoveredRoles();
    if (agentPageMode === 'config') openAgentsOverviewPage();
  } catch (e) {
    setAgentEditStatus('Failed to save: ' + String(e?.message || e), true);
    setAgentPageStatus('Failed to save: ' + String(e?.message || e), true);
  } finally {
    agentEditSaving = false;
    if ($('agentEditSubmitBtn')) $('agentEditSubmitBtn').disabled = false;
    document.querySelectorAll('[data-action="submit-agent-edit-page"]').forEach(btn => { btn.disabled = false; });
  }
}

function setAgentEditStatus(message, error) {
  const el = $('agentEditStatus');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('error', Boolean(error));
}

function inputValue(ids) {
  for (const id of ids) {
    const el = $(id);
    if (el) return String(el.value || '');
  }
  return '';
}

function setTextInput(id, value) {
  const el = $(id);
  if (el) el.value = value || '';
}

function setAgentPageStatus(message, error) {
  agentPageStatus = message || '';
  for (const el of [$("agentCreatePageStatus"), $("agentConfigPageStatus")]) {
    if (!el) continue;
    el.textContent = agentPageStatus;
    el.classList.toggle('error', Boolean(error));
  }
}

function runtimePillsSection(scope, current) {
  return '<div class="runtime-pill-group" role="radiogroup" aria-label="Agent runtime">' + runtimePillsHtml(scope, current) + '</div>';
}

function operatorCheckboxHtml(id, checked) {
  return '<label class="agent-operator-checkbox-label" for="' + esc(id) + '"><input id="' + esc(id) + '" type="checkbox" ' + (checked ? 'checked ' : '') + '/> Acts on behalf of human</label>'
    + '<div class="agent-operator-checkbox-help">Marks this agent as a human surrogate. Compose alongside another role for actual permissions.</div>';
}

function personaPlaceholderHtml() {
  return '<section class="card settings-wide agent-config-section agent-config-persona-placeholder"><div class="section-head"><div><h2>Persona</h2><p>Persona fields land in the next EP-037 track after the config-page shell.</p></div></div><div class="thread-empty">Persona profile editor not wired in WA-212.</div></section>';
}

function agentConfigHeader(role) {
  if (!role) return '';
  const addr = roleDisplayId(role);
  const runner = runnerFor(addr);
  const online = Boolean(runner?.reachable);
  const runtime = roleRuntimeLabel(role);
  return '<div class="agent-config-head">'
    + roleAvatarGrid(role, 48)
    + '<div class="agent-config-head-copy"><div class="agent-config-kicker">' + esc(addr) + '</div><h1>' + esc(role.name || addr) + '</h1><p>' + esc(runtime) + ' · ' + (online ? 'online' : 'offline') + '</p></div>'
    + '<div class="agent-config-head-actions"><button type="button" class="btn secondary danger" data-action="delete-agent-role" data-role="' + esc(addr) + '" ' + (online ? 'disabled' : '') + '>Delete agent</button></div>'
  + '</div>';
}

export function renderAgentCreatePage() {
  const state = getState();
  if (agentPageMode !== 'create') {
    agentPageMode = 'create';
    agentPageRole = '';
    agentPageStatus = '';
    addAgentRepoId = addAgentRepoId || (state.repos || [])[0]?.id || '';
    addAgentRuntime = 'default';
    addAgentAvailableRoles = null;
    addAgentAssignedRoleIds = new Set();
    addAgentRolesError = '';
    addAgentRolesLoading = false;
  }
  const repoOptions = (state.repos || []).map(repo => [repo.id, repo.name + ' - ' + repo.absolutePath]);
  const repoSelect = repoOptions.length
    ? settingsDropdown('agent-create-repo', addAgentRepoId, repoOptions, { inputAttrs: 'data-add-agent-repo-page' })
    : '<div class="thread-empty">Add a repository before adding agents.</div>';
  $('content').innerHTML = '<div class="agent-config-page agent-config-create">'
    + '<div class="agent-config-crumbs"><button type="button" class="btn secondary small" data-action="agent-config-cancel">← Agents</button><span>New agent</span></div>'
    + '<section class="card settings-wide agent-config-section"><div class="section-head"><div><h2>Identity</h2><p>Repository, name, and default runtime.</p></div></div>'
      + settingRow('Repository', 'Which repo this agent belongs to.', repoSelect)
      + settingRow('Name', 'Unique within the repo; used in repo:name addressing.', '<input id="addAgentPageName" class="setting-input" type="text" autocomplete="off" placeholder="frontend-test" />')
      + settingRow('Default runtime', 'Global default means host_default = null.', runtimePillsSection('add-agent', addAgentRuntime))
    + '</section>'
    + '<section class="card settings-wide agent-config-section"><div class="section-head"><div><h2>Access · RBAC roles</h2><p>Defaults are seeded by name; toggle to override before creating.</p></div></div>'
      + operatorCheckboxHtml('addAgentPageOperatorCheckbox', false)
      + '<div id="addAgentPageRolesPicker" class="agent-edit-roles" role="group" aria-label="Agent roles"></div>'
    + '</section>'
    + personaPlaceholderHtml()
    + settingsBottomActionBar('agent-create-page', agentPageStatus, { cancelAction: 'agent-config-cancel', saveAction: 'submit-add-agent-page', saving: addAgentSaving })
    + '<div class="workspace-add-status" id="agentCreatePageStatus">' + esc(agentPageStatus) + '</div>'
  + '</div>';
  renderAddAgentRoles();
  if (addAgentAvailableRoles === null && !addAgentRolesLoading) void loadAddAgentRoles();
}

export function renderAgentConfigPage(roleAddress) {
  const role = roleByName(roleAddress);
  if (!role) {
    $('content').innerHTML = '<div class="agent-config-page"><div class="thread-empty">Agent not found.</div><button type="button" class="btn secondary" data-action="agent-config-cancel">Back to agents</button></div>';
    return;
  }
  const addr = roleDisplayId(role);
  if (agentPageMode !== 'config' || agentPageRole !== addr) {
    agentPageMode = 'config';
    agentPageRole = addr;
    agentPageStatus = '';
    agentEditingRole = { id: role.id, name: role.name, originalName: role.name, hostDefault: role.host_default || 'default' };
    agentEditRuntime = String(role.host_default || 'default');
    agentEditAvailableRoles = null;
    agentEditAssignedRoleIds = new Set();
    agentEditRolesError = '';
    agentEditRolesLoading = false;
  }
  $('content').innerHTML = '<div class="agent-config-page">'
    + '<div class="agent-config-crumbs"><button type="button" class="btn secondary small" data-action="agent-config-cancel">← Agents</button><span>' + esc(addr) + '</span></div>'
    + agentConfigHeader(role)
    + '<section class="card settings-wide agent-config-section"><div class="section-head"><div><h2>Identity</h2><p>Rename the agent or change its default runtime.</p></div></div>'
      + settingRow('Repository', 'Repository is fixed after creation.', '<div class="thread-empty">' + esc(role.repo_name || role.repoName || '') + '</div>')
      + settingRow('Name', 'Unique within the repo.', '<input id="agentEditPageName" class="setting-input" type="text" autocomplete="off" value="' + esc(role.name || '') + '" />')
      + settingRow('Default runtime', 'Global default means host_default = null.', runtimePillsSection('agent-edit', agentEditRuntime))
    + '</section>'
    + '<section class="card settings-wide agent-config-section"><div class="section-head"><div><h2>Access · RBAC roles</h2><p>Roles compose. Clear all roles for an unprivileged agent.</p></div></div>'
      + operatorCheckboxHtml('agentEditPageOperatorCheckbox', false)
      + '<div id="agentEditPageRolesPicker" class="agent-edit-roles" role="group" aria-label="Agent roles"></div>'
    + '</section>'
    + personaPlaceholderHtml()
    + settingsBottomActionBar('agent-config-page', agentPageStatus, { cancelAction: 'agent-config-cancel', saveAction: 'submit-agent-edit-page', saving: agentEditSaving, dangerAction: 'delete-agent-role', dangerLabel: 'Delete agent', dangerDisabled: Boolean(runnerFor(addr)) })
    + '<div class="workspace-add-status" id="agentConfigPageStatus">' + esc(agentPageStatus) + '</div>'
  + '</div>';
  renderAgentEditRoles();
  if (agentEditAvailableRoles === null && !agentEditRolesLoading) void loadAgentEditRoles(role.id);
}

function openAgentsOverviewPage() {
  agentPageMode = '';
  agentPageRole = '';
  agentPageStatus = '';
  setAgentsSubView('overview');
  render();
  updateUrl();
}

function workspaceBasePath() {
  const ws = getState().currentWorkspace;
  if (!ws?.id) return '';
  return '/workspaces/' + encodeURIComponent(ws.id);
}

function daemonApi(suffix) {
  // Mirror the daemonApiUrl pattern from main.ts: /api/v1 base.
  return '/api/v1' + suffix;
}

async function refreshAfterRepoMutation() {
  const next = await workspaceFetch('/status').then(r => r.json());
  patchState({ ...next });
  render();
}

function openRepoEditModal(repoId) {
  const state = getState();
  const repo = repoId ? (state.repos || []).find(r => r.id === repoId) : null;
  repoEditState = repo
    ? { id: repo.id, name: repo.name || '', absolutePath: repo.absolutePath || '', mode: 'edit' }
    : { id: '', name: '', absolutePath: '', mode: 'add' };
  const modal = $('repoEditModal');
  if (!modal) return;
  const titleEl = $('repoEditModalTitle');
  const subEl = $('repoEditModalSub');
  const submitBtn = $('repoEditSubmitBtn');
  if (titleEl) titleEl.textContent = repoEditState.mode === 'edit' ? 'Edit Repository' : 'Add Repository';
  if (subEl) subEl.textContent = repoEditState.mode === 'edit'
    ? 'Rename this repository. Path is read-only after creation.'
    : 'Register a repository.';
  if (submitBtn) submitBtn.textContent = repoEditState.mode === 'edit' ? 'Save' : 'Add';
  $('repoEditName').value = repoEditState.name;
  $('repoEditPath').value = repoEditState.absolutePath;
  $('repoEditPath').disabled = repoEditState.mode === 'edit';
  $('repoEditStatus').textContent = '';
  $('repoEditStatus').classList.remove('error');
  modal.classList.remove('hidden');
  setTimeout(() => {
    if (repoEditState.mode === 'edit') $('repoEditName')?.focus();
    else $('repoEditPath')?.focus();
  }, 0);
}

function closeRepoEditModal() {
  if (repoEditSaving) return;
  $('repoEditModal')?.classList.add('hidden');
  repoEditState = null;
}

function setRepoEditStatus(message, error) {
  const el = $('repoEditStatus');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('error', Boolean(error));
}

async function submitRepoEdit() {
  if (!repoEditState || repoEditSaving) return;
  const base = workspaceBasePath();
  if (!base) { setRepoEditStatus('No active workspace.', true); return; }
  const name = String($('repoEditName')?.value || '').trim();
  const path = String($('repoEditPath')?.value || '').trim();
  if (repoEditState.mode === 'add' && !path) { setRepoEditStatus('Repository path is required.', true); return; }
  if (repoEditState.mode === 'edit' && !name) { setRepoEditStatus('Repository name is required.', true); return; }
  repoEditSaving = true;
  $('repoEditSubmitBtn').disabled = true;
  setRepoEditStatus('Saving…', false);
  try {
    if (repoEditState.mode === 'edit') {
      const res = await fetch(daemonApi(base + '/repos/' + encodeURIComponent(repoEditState.id)), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) throw new Error(body.error || 'rename failed');
    } else {
      const res = await fetch(daemonApi(base + '/repos'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ absolutePath: path, name: name || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) throw new Error(body.error || 'add failed');
    }
    $('repoEditModal')?.classList.add('hidden');
    repoEditState = null;
    await refreshAfterRepoMutation();
  } catch (e) {
    setRepoEditStatus('Failed: ' + String(e?.message || e), true);
  } finally {
    repoEditSaving = false;
    $('repoEditSubmitBtn').disabled = false;
  }
}

async function deleteRepoAction(repoId) {
  if (!repoId) return;
  const state = getState();
  const repo = (state.repos || []).find(r => r.id === repoId);
  if (!repo) return;
  const ok = await openConfirm({
    title: 'Delete repository ' + (repo.name || repoId) + '?',
    body: 'Agents in this repository will be removed after attached runners stop.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  const base = workspaceBasePath();
  if (!base) return;
  try {
    const res = await fetch(daemonApi(base + '/repos/' + encodeURIComponent(repoId)), { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(body.error || 'delete failed');
    await refreshAfterRepoMutation();
  } catch (e) {
    showToast('Failed to delete repository: ' + String(e?.message || e), { variant: 'error' });
  }
}

function openManageScanDirsModal() {
  const modal = $('scanDirsManageModal');
  if (!modal) return;
  scanDirsManageStatus = '';
  modal.classList.remove('hidden');
  void loadScanDirs();
}

function closeManageScanDirsModal() {
  $('scanDirsManageModal')?.classList.add('hidden');
}

function setScanDirsStatus(message, error) {
  scanDirsManageStatus = message || '';
  const el = $('scanDirsManageStatus');
  if (!el) return;
  el.textContent = scanDirsManageStatus;
  el.classList.toggle('error', Boolean(error));
}

function renderScanDirsList() {
  const root = $('scanDirsManageList');
  if (!root) return;
  if (scanDirsLoading) { root.innerHTML = '<div class="workspace-edit-empty">Loading…</div>'; return; }
  if (!scanDirsManageList.length) { root.innerHTML = '<div class="workspace-edit-empty">No scan directories yet.</div>'; return; }
  root.innerHTML = scanDirsManageList.map(scan => {
    const checked = scan.scanOnStartup ? ' checked' : '';
    const last = scan.lastScanAt ? 'Last scan ' + new Date(scan.lastScanAt).toLocaleString() : 'Never scanned';
    return '<div class="workspace-edit-row" data-scan-id="' + esc(scan.id) + '">'
      + '<div class="workspace-edit-row-main"><span class="mono">' + esc(scan.absolutePath || '') + '</span>'
        + '<label class="checkbox-row"><input type="checkbox" data-action="toggle-scan-dir-startup" data-scan-id="' + esc(scan.id) + '"' + checked + ' /> Scan on startup</label>'
        + '<small>' + esc(last) + '</small>'
      + '</div>'
      + '<div class="workspace-edit-row-actions">'
        + '<button type="button" class="btn secondary small" data-action="run-scan-dir" data-scan-id="' + esc(scan.id) + '">Scan now</button>'
        + '<button type="button" class="btn danger small" data-action="remove-scan-dir" data-scan-id="' + esc(scan.id) + '">Remove</button>'
      + '</div>'
    + '</div>';
  }).join('');
}

async function loadScanDirs() {
  const base = workspaceBasePath();
  if (!base) { setScanDirsStatus('No active workspace.', true); return; }
  scanDirsLoading = true;
  renderScanDirsList();
  try {
    const res = await fetch(daemonApi(base + '/scan-dirs'));
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(body.error || 'load failed');
    scanDirsManageList = Array.isArray(body.scanDirs) ? body.scanDirs : [];
  } catch (e) {
    setScanDirsStatus('Failed to load: ' + String(e?.message || e), true);
  } finally {
    scanDirsLoading = false;
    renderScanDirsList();
  }
}

async function addScanDir() {
  const base = workspaceBasePath();
  if (!base) return;
  const path = String($('scanDirsManageAddPath')?.value || '').trim();
  const startup = Boolean($('scanDirsManageAddStartup')?.checked);
  if (!path) { setScanDirsStatus('Path is required.', true); return; }
  try {
    const res = await fetch(daemonApi(base + '/scan-dirs'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ absolutePath: path, scanOnStartup: startup }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(body.error || 'add failed');
    $('scanDirsManageAddPath').value = '';
    $('scanDirsManageAddStartup').checked = false;
    setScanDirsStatus('Scan directory added.', false);
    await loadScanDirs();
  } catch (e) {
    setScanDirsStatus('Failed to add: ' + String(e?.message || e), true);
  }
}

async function toggleScanStartup(scanId, enabled) {
  const base = workspaceBasePath();
  if (!base || !scanId) return;
  try {
    const res = await fetch(daemonApi(base + '/scan-dirs/' + encodeURIComponent(scanId)), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanOnStartup: Boolean(enabled) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(body.error || 'save failed');
    await loadScanDirs();
  } catch (e) {
    setScanDirsStatus('Failed to update: ' + String(e?.message || e), true);
  }
}

async function runScanDir(scanId) {
  const base = workspaceBasePath();
  if (!base || !scanId) return;
  setScanDirsStatus('Scanning…', false);
  try {
    const res = await fetch(daemonApi(base + '/scan-dirs/' + encodeURIComponent(scanId) + '/scan'), { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(body.error || 'scan failed');
    setScanDirsStatus('Scan added ' + Number(body.added?.length || 0) + ' repositories.', false);
    await loadScanDirs();
    await refreshAfterRepoMutation();
  } catch (e) {
    setScanDirsStatus('Failed to scan: ' + String(e?.message || e), true);
  }
}

async function removeScanDir(scanId) {
  const base = workspaceBasePath();
  if (!base || !scanId) return;
  const ok = await openConfirm({
    title: 'Remove scan directory?',
    body: 'Existing repositories stay registered.',
    confirmLabel: 'Remove',
    danger: true,
  });
  if (!ok) return;
  try {
    const res = await fetch(daemonApi(base + '/scan-dirs/' + encodeURIComponent(scanId)), { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(body.error || 'remove failed');
    setScanDirsStatus('Scan directory removed.', false);
    await loadScanDirs();
  } catch (e) {
    setScanDirsStatus('Failed to remove: ' + String(e?.message || e), true);
  }
}

async function refreshAllScanDirs() {
  if (scanDirsRefreshing) return;
  const base = workspaceBasePath();
  if (!base) return;
  scanDirsRefreshing = true;
  agentsHeaderMenuOpen = false;
  renderAgentOverview();
  try {
    const listRes = await fetch(daemonApi(base + '/scan-dirs'));
    const listBody = await listRes.json().catch(() => ({}));
    if (!listRes.ok || listBody.ok === false) throw new Error(listBody.error || 'load failed');
    const scans = Array.isArray(listBody.scanDirs) ? listBody.scanDirs : [];
    let totalAdded = 0;
    let failed = 0;
    for (const scan of scans) {
      try {
        const r = await fetch(daemonApi(base + '/scan-dirs/' + encodeURIComponent(scan.id) + '/scan'), { method: 'POST' });
        const b = await r.json().catch(() => ({}));
        if (r.ok && b.ok !== false) totalAdded += Number(b.added?.length || 0);
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    await refreshAfterRepoMutation();
    const summary = 'Scanned ' + scans.length + ' director' + (scans.length === 1 ? 'y' : 'ies')
      + ', ' + totalAdded + ' new repositor' + (totalAdded === 1 ? 'y' : 'ies') + ' found'
      + (failed ? ' (' + failed + ' failed)' : '') + '.';
    showToast(summary, { variant: failed ? 'error' : 'info' });
  } catch (e) {
    showToast('Failed to refresh scan directories: ' + String(e?.message || e), { variant: 'error' });
  } finally {
    scanDirsRefreshing = false;
    renderAgentOverview();
  }
}

async function setRoleAsMain(roleName) {
  const role = roleByName(roleName);
  if (!role) return;
  try {
    const res = await workspaceFetch('/main-role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: roleName }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(body.error || 'set main failed');
    await refreshAfterRepoMutation();
  } catch (e) {
    showToast('Failed to set main: ' + String(e?.message || e), { variant: 'error' });
  }
}

async function unsetRoleAsMain() {
  try {
    const res = await workspaceFetch('/main-role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: null }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(body.error || 'unset main failed');
    await refreshAfterRepoMutation();
  } catch (e) {
    showToast('Failed to remove main: ' + String(e?.message || e), { variant: 'error' });
  }
}

async function deleteAgentRoleAction(roleName) {
  if (!roleName || agentDeleteSaving) return;
  const role = roleByName(roleName);
  if (!role || !role.id) return;
  const ok = await openConfirm({
    title: 'Delete agent ' + roleName + '?',
    body: 'This removes the agent role from this workspace. This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  agentDeleteSaving = true;
  try {
    const res = await workspaceFetch('/roles-by-id/' + encodeURIComponent(role.id), { method: 'DELETE' });
    const respBody = await res.json().catch(() => ({}));
    if (!res.ok || respBody.ok === false) {
      const reason = respBody.reason ? ' (' + respBody.reason + ')' : '';
      throw new Error((respBody.error || 'delete failed') + reason);
    }
    await refreshDiscoveredRoles();
  } catch (e) {
    showToast('Failed to delete agent: ' + String(e?.message || e), { variant: 'error' });
  } finally {
    agentDeleteSaving = false;
  }
}

let _delegationInstalled = false;

export function installAgents(c) {
  _ctx = c;
  if (_delegationInstalled) return;
  _delegationInstalled = true;

  // EP-004 WA-015: every agents-page popover opts into the unified
  // outside-click + Escape dismiss registry exposed by main.ts. The
  // legacy per-callsite handlers still exist; the registry is additive
  // and idempotent (dismiss() returns early when already closed).
  const registerDropdown = c.bindDropdownDismiss;
  if (typeof registerDropdown === 'function') {
    const dismissAndRender = (clear) => {
      clear();
      if (getPage() === 'agents' && getActiveTerminal() === 'overview') renderAgentOverview();
    };
    registerDropdown({
      rootSelector: '.agent-sort-menu',
      isOpen: () => sortMenuOpen,
      dismiss: () => dismissAndRender(() => { sortMenuOpen = false; }),
    });
    registerDropdown({
      rootSelector: '.agents-overview-header',
      isOpen: () => agentsHeaderMenuOpen,
      dismiss: () => dismissAndRender(() => { agentsHeaderMenuOpen = false; }),
    });
    registerDropdown({
      rootSelector: '.repo-group',
      isOpen: () => Boolean(repoMenuOpenId),
      dismiss: () => dismissAndRender(() => { repoMenuOpenId = ''; }),
    });
    registerDropdown({
      rootSelector: '.agent-card',
      isOpen: () => Boolean(agentOverviewMenuRole),
      dismiss: () => dismissAndRender(() => { agentOverviewMenuRole = ''; }),
    });
  }

  document.addEventListener('click', e => {
    const target = e.target?.closest?.('[data-action]');
    if (!target) {
      if (e.target?.id === 'defaultRuntimeModal') closeDefaultRuntimeDialog();
      if (sortMenuOpen && getPage() === 'agents' && getActiveTerminal() === 'overview') { sortMenuOpen = false; renderAgentOverview(); }
      return;
    }
    if (target.dataset.action === 'toggle-agent-sort-menu') { e.preventDefault(); sortMenuOpen = !sortMenuOpen; renderAgentOverview(); }
    if (target.dataset.action === 'agent-sort-choice') { e.preventDefault(); agentSort = { field: target.dataset.sortField || 'name', dir: target.dataset.sortDir === 'desc' ? 'desc' : 'asc' }; sortMenuOpen = false; saveAgentSort(); renderAgentOverview(); }
    if (target.dataset.action === 'select-policy-mode') {
      e.preventDefault();
      const mode = target.dataset.policyModeValue || 'star';
      runtimePolicyDraftMode = mode;
      const input = document.querySelector('[data-policy-mode]');
      if (input) input.value = mode;
      document.querySelectorAll('[data-policy-mode-value]').forEach(option => option.classList.toggle('active', option.dataset.policyModeValue === mode));
      const peerPanel = document.querySelector('.peer-policy-panel');
      if (peerPanel) peerPanel.style.display = mode === 'peer-to-peer' ? '' : 'none';
    }
    if (target.dataset.action === 'select-peer-rule-mode') { e.preventDefault(); void savePeerRuleMode(target.dataset.mode || 'deny-list'); }
    if (target.dataset.action === 'add-peer-rule') { e.preventDefault(); void addPeerRuleFromSettings(); }
    if (target.dataset.action === 'remove-peer-rule') { e.preventDefault(); void removePeerRuleFromSettings(target.dataset.ruleId); }
    if (target.dataset.action === 'select-default-runtime') { e.preventDefault(); defaultRuntimeDialogHost = target.dataset.host || ''; defaultRuntimeDialogStatus = ''; renderDefaultRuntimeDialog(); }
    if (target.dataset.action === 'close-default-runtime-dialog') { e.preventDefault(); closeDefaultRuntimeDialog(); }
    if (target.dataset.action === 'save-default-runtime-dialog') { e.preventDefault(); void saveDefaultRuntimeDialog(); }
    if (target.dataset.action === 'copy-command-preview') { e.preventDefault(); void copyCommandPreview(target); }
    if (target.dataset.action === 'discover-roles') { e.preventDefault(); void refreshDiscoveredRoles(); }
    if (target.dataset.action === 'open-add-agent') { e.preventDefault(); addAgentRepoId = target.dataset.repoId || ''; agentPageMode = ''; setAgentsSubView('create'); render(); updateUrl(); }
    if (target.dataset.action === 'close-add-agent') { e.preventDefault(); closeAddAgentModal(); }
    if (target.dataset.action === 'submit-add-agent') { e.preventDefault(); void submitAddAgent(); }
    if (target.dataset.action === 'submit-add-agent-page') { e.preventDefault(); void submitAddAgent(); }
    if (target.dataset.action === 'open-agent-edit') { e.preventDefault(); agentOverviewMenuRole = ''; agentPageMode = ''; setAgentsSubView('config', target.dataset.role || ''); render(); updateUrl(); }
    if (target.dataset.action === 'close-agent-edit') { e.preventDefault(); closeAgentEditModal(); }
    if (target.dataset.action === 'submit-agent-edit') { e.preventDefault(); void submitAgentEdit(); }
    if (target.dataset.action === 'submit-agent-edit-page') { e.preventDefault(); void submitAgentEdit(); }
    if (target.dataset.action === 'agent-config-cancel') { e.preventDefault(); openAgentsOverviewPage(); }
    if (target.dataset.action === 'toggle-agent-edit-role') { e.preventDefault(); toggleAgentEditRole(target.dataset.roleId || ''); }
    if (target.dataset.action === 'toggle-add-agent-role') { e.preventDefault(); toggleAddAgentRole(target.dataset.roleId || ''); }
    if (target.dataset.action === 'delete-agent-role') { e.preventDefault(); agentOverviewMenuRole = ''; void deleteAgentRoleAction(target.dataset.role || ''); }
    if (target.dataset.action === 'select-runtime-pill') {
      e.preventDefault();
      const scope = target.dataset.scope || '';
      const value = target.dataset.value || 'default';
      if (scope === 'add-agent') { addAgentRuntime = value; renderRuntimePills('addAgentRuntimePills', 'add-agent', value); const pagePills = document.querySelector('.agent-config-create .runtime-pill-group'); if (pagePills) pagePills.innerHTML = runtimePillsHtml('add-agent', value); }
      else if (scope === 'agent-edit') { agentEditRuntime = value; renderRuntimePills('agentEditRuntimePills', 'agent-edit', value); const pagePills = document.querySelector('.agent-config-page:not(.agent-config-create) .runtime-pill-group'); if (pagePills) pagePills.innerHTML = runtimePillsHtml('agent-edit', value); }
      return;
    }
    if (target.dataset.action === 'unset-main') { e.preventDefault(); agentOverviewMenuRole = ''; renderAgentOverview(); void unsetRoleAsMain(); return; }
    if (target.dataset.action === 'open-add-repo') { e.preventDefault(); agentsHeaderMenuOpen = false; openRepoEditModal(''); return; }
    if (target.dataset.action === 'open-edit-repo') { e.preventDefault(); repoMenuOpenId = ''; openRepoEditModal(target.dataset.repoId || ''); return; }
    if (target.dataset.action === 'close-repo-edit') { e.preventDefault(); closeRepoEditModal(); return; }
    if (target.dataset.action === 'submit-repo-edit') { e.preventDefault(); void submitRepoEdit(); return; }
    if (target.dataset.action === 'delete-repo') { e.preventDefault(); repoMenuOpenId = ''; renderAgentOverview(); void deleteRepoAction(target.dataset.repoId || ''); return; }
    if (target.dataset.action === 'toggle-repo-collapse') {
      e.preventDefault();
      e.stopPropagation();
      const id = target.dataset.repoId || '';
      if (!id) return;
      if (collapsedRepoIds.has(id)) collapsedRepoIds.delete(id); else collapsedRepoIds.add(id);
      if (getPage() === 'agents' && getActiveTerminal() === 'overview') renderAgentOverview();
      return;
    }
    if (target.dataset.action === 'toggle-repo-menu') {
      e.preventDefault();
      e.stopPropagation();
      const id = target.dataset.repoId || '';
      repoMenuOpenId = repoMenuOpenId === id ? '' : id;
      agentsHeaderMenuOpen = false;
      if (getPage() === 'agents' && getActiveTerminal() === 'overview') renderAgentOverview();
      return;
    }
    if (target.dataset.action === 'toggle-agents-overflow-menu') {
      e.preventDefault();
      e.stopPropagation();
      agentsHeaderMenuOpen = !agentsHeaderMenuOpen;
      repoMenuOpenId = '';
      if (getPage() === 'agents' && getActiveTerminal() === 'overview') renderAgentOverview();
      return;
    }
    if (target.dataset.action === 'open-manage-scan-dirs') { e.preventDefault(); agentsHeaderMenuOpen = false; renderAgentOverview(); openManageScanDirsModal(); return; }
    if (target.dataset.action === 'close-scan-dirs-manage') { e.preventDefault(); closeManageScanDirsModal(); return; }
    if (target.dataset.action === 'add-scan-dir') { e.preventDefault(); void addScanDir(); return; }
    if (target.dataset.action === 'run-scan-dir') { e.preventDefault(); void runScanDir(target.dataset.scanId || ''); return; }
    if (target.dataset.action === 'remove-scan-dir') { e.preventDefault(); void removeScanDir(target.dataset.scanId || ''); return; }
    if (target.dataset.action === 'refresh-all-scan-dirs') { e.preventDefault(); agentsHeaderMenuOpen = false; void refreshAllScanDirs(); return; }
    if (repoMenuOpenId && !target.closest('.repo-group')) {
      repoMenuOpenId = '';
      if (getPage() === 'agents' && getActiveTerminal() === 'overview') renderAgentOverview();
    }
    if (agentsHeaderMenuOpen && !target.closest('.agents-overview-header')) {
      agentsHeaderMenuOpen = false;
      if (getPage() === 'agents' && getActiveTerminal() === 'overview') renderAgentOverview();
    }
    if (target.dataset.action === 'toggle-agent-card-menu') {
      e.preventDefault();
      e.stopPropagation();
      const role = target.dataset.role || '';
      agentOverviewMenuRole = agentOverviewMenuRole === role ? '' : role;
      if (getPage() === 'agents' && getActiveTerminal() === 'overview') renderAgentOverview();
      return;
    }
    if (agentOverviewMenuRole && !target.closest('.agent-card')) {
      agentOverviewMenuRole = '';
      if (getPage() === 'agents' && getActiveTerminal() === 'overview') renderAgentOverview();
    }
    if (target.dataset.action === 'change-default-runtime') { e.preventDefault(); closeLaunchMenu(); void changeDefaultRuntime(target.dataset.role); }
    if (target.dataset.action === 'save-runtime-settings') { e.preventDefault(); void saveRuntimeSettings(); }
    if (target.dataset.action === 'cancel-runtime-settings') { e.preventDefault(); cancelRuntimeSettings(); }
    if (target.dataset.action === 'save-global-runtime-default') { e.preventDefault(); void saveGlobalRuntimeDefault(); }
    if (target.dataset.action === 'redetect-all-runtimes') { e.preventDefault(); void redetectAllRuntimes(); }
    if (!target.closest('.agent-sort-menu') && sortMenuOpen && getPage() === 'agents' && getActiveTerminal() === 'overview') { sortMenuOpen = false; renderAgentOverview(); }
  });

  document.addEventListener('input', e => {
    const target = e.target;
    const key = target?.dataset?.runtimeCommand || target?.dataset?.runtimeArgs;
    if (key) updateRuntimeCommandPreview(key);
    if (target?.dataset?.runtimeCommand) scheduleRuntimeCommandProbe(target.dataset.runtimeCommand, target.value);
    // RBAC Phase 3 slice 5b: re-seed default role selection as user types
    // the agent name. If user has manually toggled chips, typing a name
    // still resets — same as if they reopened the modal. Cheap; no async.
    if (target?.id === 'addAgentName' || target?.id === 'addAgentPageName') applyAddAgentNameDefault();
    if (target?.id === 'addAgentName' || target?.id === 'addAgentPageName') renderAddAgentRoles();
  });

  $('addAgentModal')?.addEventListener('click', e => { if (e.target === $('addAgentModal')) closeAddAgentModal(); });
  $('agentEditModal')?.addEventListener('click', e => { if (e.target === $('agentEditModal')) closeAgentEditModal(); });
  $('repoEditModal')?.addEventListener('click', e => { if (e.target === $('repoEditModal')) closeRepoEditModal(); });
  $('scanDirsManageModal')?.addEventListener('click', e => { if (e.target === $('scanDirsManageModal')) closeManageScanDirsModal(); });

  document.addEventListener('change', e => {
    // Direct id matches first — the operator checkboxes have no data-action.
    if (e.target?.id === 'addAgentOperatorCheckbox' || e.target?.id === 'addAgentPageOperatorCheckbox') {
      toggleAddAgentOperatorCheckbox(Boolean(e.target.checked));
      return;
    }
    if (e.target?.id === 'agentEditOperatorCheckbox' || e.target?.id === 'agentEditPageOperatorCheckbox') {
      toggleAgentEditOperatorCheckbox(Boolean(e.target.checked));
      return;
    }
    const target = e.target?.closest?.('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'toggle-scan-dir-startup') {
      void toggleScanStartup(target.dataset.scanId || '', target.checked);
    }
  });
}
