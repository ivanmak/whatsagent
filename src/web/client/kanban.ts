// @ts-nocheck
// Kanban feature module.
// Carved out of src/web/client/main.ts per
// docs/superpowers/specs/2026-05-01-web-client-modularisation-design.md.
// Module-state-and-handlers come from the former installKanbanUi() IIFE;
// references to main.ts globals (state, page, render, route helpers, fetch
// helpers, formatters) flow through ClientRenderContext.

import { KANBAN_EFFORTS } from "../../kanban-effort.ts";
import { identiconFor } from "./identicon.ts";
import { truncatedAttrs } from "./truncate-tooltip.ts";
import { pluralize } from "./util.ts";

let _ctx = null;
function ctx() {
  if (!_ctx) throw new Error('kanban context not bound; call installKanban(ctx) first');
  return _ctx;
}
function getState() { return ctx().getState(); }
function patchState(partial) { ctx().patchState(partial); }
function getPage() { return ctx().getPage(); }
function setPage(next) { ctx().setPage(next); }
function render() { ctx().render(); }
function updateUrl(replace) { ctx().updateUrl(replace); }
function workspaceFetch(suffix, init) { return ctx().workspaceFetch(suffix, init); }
function shouldPollWorkspace() { return ctx().shouldPollWorkspace(); }
function workspacePath(id, suffix) { return ctx().workspacePath(id, suffix); }
function disposeXterm() { ctx().disposeXterm(); }
function $(id) { return ctx().$(id); }
function esc(value) { return ctx().esc(value); }
function roleByName(name) { return ctx().roleByName(name); }
function roleAvatarWithPresence(role, size) { return ctx().roleAvatarWithPresence(role, size); }
function mobileSidebarTab() { return ctx().mobileSidebarTab ? ctx().mobileSidebarTab() : ''; }
function renderSafeMarkdown(value) { return ctx().renderSafeMarkdown(value); }

const KANBAN_EFFORT_SET = new Set(KANBAN_EFFORTS);

function effortPillClass(value) {
  const effort = String(value || '').trim();
  return KANBAN_EFFORT_SET.has(effort) ? (' effort-' + effort.toLowerCase()) : '';
}

function renderEffortPill(value, fallback = '') {
  const effort = value || fallback;
  return '<span class="kanban-pill effort' + effortPillClass(effort) + '">' + esc(effort || '') + '</span>';
}

// EP-003 WA-011: deterministic identicon seed for a role-name reference
// (assigned_role_name etc.). Mirrors `agents.ts` -> repo:role wherever the
// role row resolves; falls back to the bare name string when it doesn't.
function kanbanIdenticonSeed(roleName) {
  if (!roleName) return 'unassigned';
  const role = roleByName(roleName);
  if (role) {
    const display = role.display_id || role.displayId || '';
    if (display) return display;
    const repo = role.repo_name || role.repoName || '';
    if (repo) return repo + ':' + role.name;
    return role.name || roleName;
  }
  return String(roleName);
}

function kanbanIssueIdenticon(roleName, size = 28) {
  const seed = kanbanIdenticonSeed(roleName);
  return '<span class="kanban-epic-issue-avatar kanban-epic-issue-avatar-identicon" aria-hidden="true" style="width:' + size + 'px;height:' + size + 'px">' + identiconFor(seed, size) + '</span>';
}
function settingsDropdown(name, value, options, opts) { return ctx().settingsDropdown(name, value, options, opts); }
function formatMessageTime(value) { return ctx().formatMessageTime(value); }

const statuses = ['Backlog', 'Queued', 'In Progress', 'Blocked', 'Review', 'Completed'];
const priorities = ['P0', 'P1', 'P2', 'P3'];
const KANBAN_SEARCH_DEBOUNCE_MS = 250;
const KANBAN_AUTO_REFRESH_MS = 5000;
const kanbanStatuses = ['Backlog', 'Queued', 'In Progress', 'Blocked', 'Review', 'Completed'];
const KANBAN_EPIC_VIS_KEY_PREFIX = 'whatsagent.kanbanEpicVisualizeDeps.';

let kanbanTasks = [];
let kanbanSettings = { taskIdPrefix: 'WA', epicIdPrefix: 'EP' };
let kanbanLoaded = false;
let kanbanLoading = false;
let kanbanError = '';
let kanbanSelectedTaskId = '';
let kanbanDetail = null;
let kanbanDetailLoading = false;
let kanbanDetailError = '';
let kanbanSearch = '';
let kanbanAssignee = '';
let kanbanPriority = '';
let kanbanSearchTimer = 0;
let kanbanTab = 'board';
let kanbanEpicExpand = '';
let kanbanEpics = [];
let kanbanEpicChildren = {};
let kanbanEpicUnclassified = [];
let kanbanEpicDependencies = [];
let kanbanEpicsLoaded = false;
let kanbanEpicsLoading = false;
let kanbanEpicsError = '';
let kanbanEpicStatusFilter = '';
let kanbanEpicVisualizeDeps = false;
let kanbanEpicDrawerId = '';
let kanbanEpicDrawerDetail = null;
let kanbanEpicDrawerLoading = false;
let kanbanEpicDrawerError = '';

function kanbanEpicMobileQuery() {
  try { return window.matchMedia('(max-width: 760px)'); } catch { return null; }
}
function kanbanEpicVisualiseEffective() {
  const mq = kanbanEpicMobileQuery();
  if (mq && mq.matches) return false;
  return Boolean(kanbanEpicVisualizeDeps);
}
function kanbanEpicVisStorageKey() {
  const id = getState().currentWorkspace?.id || 'default';
  return KANBAN_EPIC_VIS_KEY_PREFIX + id;
}
function loadKanbanEpicVisFromStorage() {
  try { kanbanEpicVisualizeDeps = window.localStorage.getItem(kanbanEpicVisStorageKey()) === '1'; } catch { kanbanEpicVisualizeDeps = false; }
}
function saveKanbanEpicVisToStorage() {
  try { window.localStorage.setItem(kanbanEpicVisStorageKey(), kanbanEpicVisualizeDeps ? '1' : '0'); } catch {}
}

export function resetKanban() {
  kanbanTasks = [];
  kanbanSettings = getState().kanban || { taskIdPrefix: 'WA', epicIdPrefix: 'EP' };
  kanbanLoaded = false;
  kanbanLoading = false;
  kanbanError = '';
  kanbanSelectedTaskId = '';
  kanbanDetail = null;
  kanbanDetailLoading = false;
  kanbanDetailError = '';
  kanbanSearch = '';
  kanbanAssignee = '';
  kanbanPriority = '';
  kanbanTab = 'board';
  kanbanEpicExpand = '';
  kanbanEpics = [];
  kanbanEpicChildren = {};
  kanbanEpicUnclassified = [];
  kanbanEpicDependencies = [];
  kanbanEpicsLoaded = false;
  kanbanEpicsLoading = false;
  kanbanEpicsError = '';
  kanbanEpicStatusFilter = '';
  kanbanEpicVisualizeDeps = false;
  kanbanEpicDrawerId = '';
  kanbanEpicDrawerDetail = null;
  kanbanEpicDrawerLoading = false;
  kanbanEpicDrawerError = '';
  if (kanbanSearchTimer) clearTimeout(kanbanSearchTimer);
  kanbanSearchTimer = 0;
}

export function applyKanbanRoute(parts) {
  const kanbanParts = parts.page;
  if (kanbanParts[0] !== 'kanban') return false;
  // WA-047: deep-link / browser back/forward should also force a fresh
  // load when entering /kanban from a non-kanban page. Internal pathParts
  // changes (selecting a task, opening epics) re-enter applyKanbanRoute
  // with page already 'kanban' and skip the invalidation.
  const wasKanban = getPage() === 'kanban';
  setPage('kanban');
  if (kanbanParts[1] === 'epics') {
    kanbanTab = 'epics';
    kanbanSelectedTaskId = '';
    try {
      const url = new URL(window.location.href);
      kanbanEpicExpand = url.searchParams.get('expand') || '';
    } catch { kanbanEpicExpand = ''; }
    loadKanbanEpicVisFromStorage();
  } else if (kanbanParts[1] === 'archive') {
    kanbanTab = 'archive';
    kanbanSelectedTaskId = kanbanParts[2] || '';
    kanbanEpicExpand = '';
  } else {
    kanbanTab = 'board';
    kanbanSelectedTaskId = kanbanParts[1] || '';
    kanbanEpicExpand = '';
  }
  if (!wasKanban) {
    kanbanLoaded = false;
    kanbanEpicsLoaded = false;
  }
  return true;
}

export function kanbanPathSegments() {
  if (kanbanTab === 'epics') {
    const base = workspacePath(getState().currentWorkspace?.id ?? null, '/kanban/epics');
    return kanbanEpicExpand ? base + '?expand=' + encodeURIComponent(kanbanEpicExpand) : base;
  }
  if (kanbanTab === 'archive') {
    const tail = kanbanSelectedTaskId ? '/kanban/archive/' + encodeURIComponent(kanbanSelectedTaskId) : '/kanban/archive';
    return workspacePath(getState().currentWorkspace?.id ?? null, tail);
  }
  const tail = kanbanSelectedTaskId ? '/kanban/' + encodeURIComponent(kanbanSelectedTaskId) : '/kanban';
  return workspacePath(getState().currentWorkspace?.id ?? null, tail);
}

export function onKanbanPageSwitch(next, opts = {}) {
  if (next !== 'kanban') return false;
  // WA-047: entering /kanban from a non-kanban page should force a fresh
  // load so stale tasks/epics from a prior session are replaced. Internal
  // route tweaks, drawer open/close, and tab switches keep the cached
  // state because they re-enter onKanbanPageSwitch with page already
  // 'kanban' (or do not re-enter it at all).
  const wasKanban = getPage() === 'kanban';
  setPage('kanban');
  kanbanTab = 'board';
  kanbanSelectedTaskId = '';
  kanbanEpicExpand = '';
  if (!wasKanban) {
    kanbanLoaded = false;
    kanbanEpicsLoaded = false;
  }
  render();
  if (!opts.skipRoute) updateUrl();
  return true;
}

async function loadKanbanTasks(opts = {}) {
  if (!shouldPollWorkspace()) return;
  if (kanbanLoading) return;
  const gen = getState().workspaceGeneration;
  kanbanLoading = true;
  kanbanError = '';
  let stale = false;
  try {
    const params = new URLSearchParams({ limit: '500' });
    if (kanbanTab === 'archive') params.set('includeArchived', 'true');
    if (kanbanSearch.trim()) params.set('search', kanbanSearch.trim());
    if (kanbanAssignee) params.set('assignedTo', kanbanAssignee);
    if (kanbanPriority) params.set('priority', kanbanPriority);
    const res = await workspaceFetch('/kanban/tasks?' + params.toString());
    const body = await res.json();
    if (gen !== getState().workspaceGeneration) { stale = true; return; }
    if (!res.ok || body.ok === false) throw new Error(body.error || 'Kanban load failed');
    kanbanTasks = Array.isArray(body.tasks) ? body.tasks : [];
    kanbanSettings = body.kanban || kanbanSettings;
    patchState({ kanban: kanbanSettings });
    kanbanLoaded = true;
  } catch (e) {
    stale = gen !== getState().workspaceGeneration;
    if (!stale) kanbanError = String(e?.message || e);
  } finally {
    kanbanLoading = false;
    if (!stale && getPage() === 'kanban') renderKanban({ preserveSearchFocus: Boolean(opts.preserveSearchFocus) });
  }
}

async function loadKanbanDetail(taskId, opts = {}) {
  if (!shouldPollWorkspace()) return;
  if (!taskId || kanbanDetailLoading) return;
  const gen = getState().workspaceGeneration;
  const requestedTaskId = taskId;
  kanbanDetailLoading = true;
  kanbanDetailError = '';
  let stale = false;
  try {
    const res = await workspaceFetch('/kanban/tasks/' + encodeURIComponent(taskId));
    const body = await res.json();
    if (gen !== getState().workspaceGeneration) { stale = true; return; }
    if (!res.ok || body.ok === false) throw new Error(body.error || 'Kanban task load failed');
    kanbanDetail = body;
    kanbanSelectedTaskId = body.task?.display_id || taskId;
  } catch (e) {
    stale = gen !== getState().workspaceGeneration;
    if (!stale) {
      kanbanDetailError = String(e?.message || e);
      kanbanDetail = null;
    }
  } finally {
    kanbanDetailLoading = false;
    if (!stale && getPage() === 'kanban' && kanbanSelectedTaskId === requestedTaskId) renderKanban({ preserveSearchFocus: Boolean(opts.preserveSearchFocus) });
  }
}

function refreshKanbanTasks(opts = {}) {
  kanbanLoaded = false;
  void loadKanbanTasks({ preserveSearchFocus: Boolean(opts.preserveSearchFocus) });
  if (kanbanSelectedTaskId) {
    kanbanDetail = null;
    void loadKanbanDetail(kanbanSelectedTaskId, { preserveSearchFocus: Boolean(opts.preserveSearchFocus) });
  }
  renderKanban({ preserveSearchFocus: Boolean(opts.preserveSearchFocus) });
}

function openKanbanTask(taskId) {
  kanbanSelectedTaskId = taskId || '';
  kanbanDetail = null;
  kanbanDetailError = '';
  // EP-003 WA-014 fix-up (advisor msg #40): both `.kanban-detail` and
  // `.kanban-epic-drawer` land in grid column 2 row 2 of the epics tab,
  // so they overlap if both stay open. Close the epic drawer when the
  // user drills into a task from it (or anywhere else on the epics tab).
  if (kanbanEpicDrawerId) {
    kanbanEpicDrawerId = '';
    kanbanEpicDrawerDetail = null;
    kanbanEpicDrawerError = '';
    kanbanEpicDrawerLoading = false;
  }
  render();
  updateUrl();
}

function closeKanbanTask() {
  kanbanSelectedTaskId = '';
  kanbanDetail = null;
  kanbanDetailError = '';
  render();
  updateUrl();
}

function selectKanbanTab(tab) {
  const next = tab === 'epics' || tab === 'archive' ? tab : 'board';
  if (kanbanTab === next) return;
  const needsTaskReload = (kanbanTab === 'archive') !== (next === 'archive');
  kanbanTab = next;
  if (next === 'board') {
    kanbanEpicExpand = '';
    if (needsTaskReload) kanbanLoaded = false;
  } else if (next === 'archive') {
    kanbanSelectedTaskId = '';
    kanbanDetail = null;
    kanbanDetailError = '';
    kanbanEpicExpand = '';
    if (needsTaskReload) kanbanLoaded = false;
  } else {
    kanbanSelectedTaskId = '';
    kanbanDetail = null;
    kanbanDetailError = '';
    loadKanbanEpicVisFromStorage();
  }
  render();
  updateUrl();
}

function captureKanbanSearchFocus(opts = {}) {
  if (!opts.preserveSearchFocus) return null;
  const active = document.activeElement;
  if (!active?.matches?.('[data-kanban-search]')) return null;
  return { start: active.selectionStart, end: active.selectionEnd };
}

function restoreKanbanSearchFocus(snapshot) {
  if (!snapshot) return;
  const input = document.querySelector('[data-kanban-search]');
  if (!input) return;
  input.focus();
  try {
    if (Number.isFinite(snapshot.start) && Number.isFinite(snapshot.end)) input.setSelectionRange(snapshot.start, snapshot.end);
  } catch {}
}

function laneNameForCellScroll(scrollEl) {
  const row = scrollEl.closest('.kanban-row');
  return row?.dataset?.laneName || row?.querySelector('.kanban-lane-agent strong')?.textContent || '';
}

function captureKanbanScroll() {
  const snapshot = { board: 0, boardLeft: 0, detail: 0, detailView: 0, epicDrawer: 0, epics: 0, cells: {} };
  const board = document.querySelector('.kanban-board');
  if (board) { snapshot.board = board.scrollTop; snapshot.boardLeft = board.scrollLeft; }
  const detail = document.querySelector('.kanban-detail');
  if (detail) snapshot.detail = detail.scrollTop;
  const detailView = document.querySelector('.kanban-detail-view');
  if (detailView) snapshot.detailView = detailView.scrollTop;
  const epicDrawer = document.querySelector('.kanban-epic-drawer');
  if (epicDrawer) snapshot.epicDrawer = epicDrawer.scrollTop;
  // WA-052: epics page main scroller (overflow:auto on .kanban-epics-view).
  const epicsView = document.querySelector('.kanban-page-epics .kanban-epics-view');
  if (epicsView) snapshot.epics = epicsView.scrollTop;
  for (const cell of document.querySelectorAll('.kanban-cell-scroll')) {
    const cellWrap = cell.closest('.kanban-cell');
    const status = cellWrap?.dataset.status || '';
    const lane = laneNameForCellScroll(cell);
    if (status && lane) snapshot.cells[lane + '\\0' + status] = cell.scrollTop;
  }
  return snapshot;
}

function restoreKanbanScroll(snapshot) {
  if (!snapshot) return;
  requestAnimationFrame(() => {
    const board = document.querySelector('.kanban-board');
    if (board) {
      if (snapshot.board) board.scrollTop = snapshot.board;
      if (snapshot.boardLeft) board.scrollLeft = snapshot.boardLeft;
    }
    const detail = document.querySelector('.kanban-detail');
    if (detail && snapshot.detail) detail.scrollTop = snapshot.detail;
    const detailView = document.querySelector('.kanban-detail-view');
    if (detailView && snapshot.detailView) detailView.scrollTop = snapshot.detailView;
    const epicDrawer = document.querySelector('.kanban-epic-drawer');
    if (epicDrawer && snapshot.epicDrawer) epicDrawer.scrollTop = snapshot.epicDrawer;
    const epicsView = document.querySelector('.kanban-page-epics .kanban-epics-view');
    if (epicsView && snapshot.epics) epicsView.scrollTop = snapshot.epics;
    for (const cell of document.querySelectorAll('.kanban-cell-scroll')) {
      const cellWrap = cell.closest('.kanban-cell');
      const status = cellWrap?.dataset.status || '';
      const lane = laneNameForCellScroll(cell);
      const key = lane + '\\0' + status;
      if (snapshot.cells[key]) cell.scrollTop = snapshot.cells[key];
    }
  });
}

export function renderKanban(opts = {}) {
  disposeXterm();
  const content = $('content');
  if (!content) return;
  const searchFocus = captureKanbanSearchFocus(opts);
  const scrollSnapshot = captureKanbanScroll();
  if (kanbanTab === 'epics') {
    if (kanbanSelectedTaskId && (!kanbanDetail || kanbanDetail.task?.display_id !== kanbanSelectedTaskId) && !kanbanDetailLoading) void loadKanbanDetail(kanbanSelectedTaskId);
    const detailOpenClass = kanbanSelectedTaskId ? 'detail-open' : '';
    const drawerOpenClass = kanbanEpicDrawerId ? 'kanban-epic-drawer-open' : '';
    content.innerHTML = '<div class="kanban-page kanban-page-epics ' + detailOpenClass + ' ' + drawerOpenClass + '">' + kanbanTabbar() + kanbanEpicsView() + renderKanbanDetail() + renderKanbanEpicDrawer() + '</div>';
    restoreKanbanScroll(scrollSnapshot);
    return;
  }
  if (!kanbanLoaded && !kanbanLoading) void loadKanbanTasks();
  if (kanbanSelectedTaskId && (!kanbanDetail || kanbanDetail.task?.display_id !== kanbanSelectedTaskId) && !kanbanDetailLoading) void loadKanbanDetail(kanbanSelectedTaskId);
  content.innerHTML = '<div class="kanban-page ' + (kanbanTab === 'archive' ? 'kanban-page-archive ' : '') + (kanbanSelectedTaskId ? 'detail-open' : '') + '">' +
    kanbanTabbar() +
    '<section class="kanban-main">' + kanbanToolbar() + (kanbanTab === 'archive' ? kanbanArchiveBoard() : kanbanBoard()) + '</section>' +
    renderKanbanDetail() +
  '</div>';
  restoreKanbanSearchFocus(searchFocus);
  restoreKanbanScroll(scrollSnapshot);
}

function kanbanTabbar() {
  const boardActive = kanbanTab === 'board';
  const epicsActive = kanbanTab === 'epics';
  const archiveActive = kanbanTab === 'archive';
  return '<div class="tabbar kanban-tabbar">' + mobileSidebarTab() + '<div class="tabbar-scroll" role="tablist">'
    + '<button type="button" role="tab" aria-selected="' + (boardActive ? 'true' : 'false') + '" class="term-tab ' + (boardActive ? 'active' : '') + '" data-action="select-kanban-tab" data-tab="board">Kanban</button>'
    + '<button type="button" role="tab" aria-selected="' + (epicsActive ? 'true' : 'false') + '" class="term-tab ' + (epicsActive ? 'active' : '') + '" data-action="select-kanban-tab" data-tab="epics">Epic</button>'
    + '<button type="button" role="tab" aria-selected="' + (archiveActive ? 'true' : 'false') + '" class="term-tab ' + (archiveActive ? 'active' : '') + '" data-action="select-kanban-tab" data-tab="archive">Archive</button>'
    + '</div></div>';
}

function epicDisplayIdNumeric(id) {
  const match = String(id || '').match(/(\d+)\s*$/);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}
function compareEpicByDisplayId(a, b) {
  const aN = epicDisplayIdNumeric(a?.display_id);
  const bN = epicDisplayIdNumeric(b?.display_id);
  if (aN !== bN) return aN - bN;
  return String(a?.display_id || '').localeCompare(String(b?.display_id || ''));
}
function kanbanEpicsView() {
  if (!kanbanEpicsLoaded && !kanbanEpicsLoading) void loadKanbanEpics();
  if (kanbanEpicsLoading && !kanbanEpicsLoaded) return '<section class="kanban-epics-view"><div class="thread-empty">Loading epics…</div></section>';
  if (kanbanEpicsError) return '<section class="kanban-epics-view"><div class="thread-empty error">' + esc(kanbanEpicsError) + '</div></section>';
  // WA-049: sort epics by numeric display_id (EP-001 first), with a
  // stable string fallback for ids that lack a trailing number.
  const filtered = (kanbanEpicStatusFilter
    ? kanbanEpics.filter(epic => epic.status === kanbanEpicStatusFilter)
    : kanbanEpics.slice()
  ).sort(compareEpicByDisplayId);
  const totalSections = filtered.length + (kanbanEpicUnclassified.length > 0 ? 1 : 0);
  if (totalSections === 0 && kanbanEpics.length === 0) {
    return '<section class="kanban-epics-view">' + kanbanEpicsToolbar() + '<div class="thread-empty">No epics yet. Create one with create_kanban_epic from any agent.</div></section>';
  }
  if (totalSections === 0) {
    return '<section class="kanban-epics-view">' + kanbanEpicsToolbar() + '<div class="thread-empty">No epics match the selected status. Clear filter to see all.</div></section>';
  }
  const sections = filtered.map(renderKanbanEpicSection).join('');
  const unclassified = kanbanEpicUnclassified.length > 0 ? renderKanbanUnclassifiedSection() : '';
  return '<section class="kanban-epics-view">' + kanbanEpicsToolbar() + '<div class="kanban-epic-list">' + sections + unclassified + '</div></section>';
}

function kanbanEpicsToolbar() {
  const statusOptions = [['', 'All'], ...kanbanStatuses.map(status => [status, status])];
  const mq = kanbanEpicMobileQuery();
  const mobile = mq && mq.matches;
  const visDisabledAttr = mobile ? 'disabled aria-disabled="true"' : '';
  const visChecked = !mobile && kanbanEpicVisualizeDeps ? 'checked' : '';
  const visNotice = mobile ? '<span class="kanban-epics-vis-notice">Dependency view hidden on mobile</span>' : '';
  return '<div class="kanban-epics-toolbar">' +
    '<div class="kanban-epics-status-filter">' + settingsDropdown('Epic status', kanbanEpicStatusFilter, statusOptions, { inputAttrs: 'data-action="select-kanban-epic-status"' }) + '</div>' +
    '<label class="kanban-epics-vis-toggle"><input type="checkbox" data-action="toggle-kanban-epic-visualise" ' + visDisabledAttr + ' ' + visChecked + ' /> Visualise dependencies</label>' +
    visNotice +
    '<button class="btn secondary small" data-action="refresh-kanban-epics">Refresh</button>' +
  '</div>';
}

function renderKanbanEpicSection(epic) {
  const expanded = kanbanEpicExpand === epic.display_id;
  const caret = expanded ? '▾' : '▸';
  const children = kanbanEpicChildren[epic.display_id] || [];
  const childCount = children.length;
  const closeApprovalPill = epic.close_approval_status === 'pending'
    ? '<button type="button" class="kanban-epic-close-pill" data-action="open-kanban-epic-details" data-epic-id="' + esc(epic.display_id) + '">Close pending approval</button>'
    : '';
  const statusPill = '<span class="kanban-pill kanban-status-' + statusClass(epic.status) + '">' + esc(epic.status) + '</span>';
  const detailsBtn = '<button type="button" class="btn secondary small kanban-epic-details-btn" data-action="open-kanban-epic-details" data-epic-id="' + esc(epic.display_id) + '">Details</button>';
  const childCountBadge = '<span class="kanban-epic-child-count">' + childCount + ' ' + pluralize(childCount, 'task') + '</span>';
  const body = expanded ? renderKanbanEpicSectionBody(epic.display_id, children) : '';
  return '<section class="kanban-epic-section ' + (expanded ? 'expanded' : 'collapsed') + '" data-epic-id="' + esc(epic.display_id) + '">' +
    '<div class="kanban-epic-header" data-action="toggle-kanban-epic-section" data-epic-id="' + esc(epic.display_id) + '" role="button" tabindex="0">' +
      '<span class="kanban-epic-caret">' + caret + '</span>' +
      '<span class="kanban-epic-id">' + esc(epic.display_id) + '</span>' +
      '<span class="kanban-epic-title" ' + truncatedAttrs(epic.title || '') + '>' + esc(epic.title || '') + '</span>' +
      statusPill +
      closeApprovalPill +
      childCountBadge +
      detailsBtn +
    '</div>' + body +
  '</section>';
}

function renderKanbanUnclassifiedSection() {
  const expanded = kanbanEpicExpand === '__unclassified';
  const caret = expanded ? '▾' : '▸';
  const count = kanbanEpicUnclassified.length;
  const body = expanded ? renderKanbanEpicSectionBody('__unclassified', kanbanEpicUnclassified) : '';
  return '<section class="kanban-epic-section kanban-epic-unclassified ' + (expanded ? 'expanded' : 'collapsed') + '" data-epic-id="__unclassified">' +
    '<div class="kanban-epic-header" data-action="toggle-kanban-epic-section" data-epic-id="__unclassified" role="button" tabindex="0">' +
      '<span class="kanban-epic-caret">' + caret + '</span>' +
      '<span class="kanban-epic-title" ' + truncatedAttrs('Unclassified') + '>Unclassified</span>' +
      '<span class="kanban-epic-child-count">' + count + ' ' + pluralize(count, 'task') + '</span>' +
    '</div>' + body +
  '</section>';
}

function renderKanbanEpicSectionBody(sectionKey, sectionTasks) {
  const visEffective = kanbanEpicVisualiseEffective();
  if (sectionTasks.length === 0) return '<div class="kanban-epic-body" data-vis="off"><div class="thread-empty">No tasks linked to this epic yet.</div></div>';
  if (!visEffective) return '<div class="kanban-epic-body" data-vis="off">' + renderKanbanBoardForTasks(sectionTasks) + '</div>';
  const layout = layoutKanbanEpicDag(sectionKey, sectionTasks);
  if (layout.cycle) {
    const cycleNote = '<div class="kanban-epic-cycle-warning">Dependencies form a cycle (' + esc(layout.cycle.join(' → ')) + '); showing flat board.</div>';
    return '<div class="kanban-epic-body" data-vis="off">' + cycleNote + renderKanbanBoardForTasks(sectionTasks) + '</div>';
  }
  return '<div class="kanban-epic-body" data-vis="on">' + renderKanbanEpicDagSvg(layout, sectionKey, sectionTasks) + '</div>';
}

function epicIdForTask(task) {
  return task && task.epic_id != null
    ? (kanbanEpics.find((epic) => epic.id === task.epic_id)?.display_id || '__external__')
    : '__unclassified';
}

function depsForSection(sectionKey, sectionTasks) {
  const ids = new Set(sectionTasks.map((task) => task.display_id));
  return kanbanEpicDependencies.filter((edge) => ids.has(edge.task_display_id) && ids.has(edge.depends_on_display_id));
}

function computeExternalDeps(sectionKey, task) {
  const ownIds = new Set((sectionKey === '__unclassified' ? kanbanEpicUnclassified : (kanbanEpicChildren[sectionKey] || [])).map((row) => row.display_id));
  const dependsOn = kanbanEpicDependencies
    .filter((edge) => edge.task_display_id === task.display_id && !ownIds.has(edge.depends_on_display_id))
    .map((edge) => ({ display_id: edge.depends_on_display_id, title: edge.depends_on_title }));
  const dependedBy = kanbanEpicDependencies
    .filter((edge) => edge.depends_on_display_id === task.display_id && !ownIds.has(edge.task_display_id))
    .map((edge) => ({ display_id: edge.task_display_id, title: '' }));
  return { dependsOn, dependedBy };
}

function layoutKanbanEpicDag(sectionKey, sectionTasks) {
  const internalEdges = depsForSection(sectionKey, sectionTasks);
  const incoming = new Map();
  const outgoing = new Map();
  for (const task of sectionTasks) {
    incoming.set(task.display_id, []);
    outgoing.set(task.display_id, []);
  }
  for (const edge of internalEdges) {
    outgoing.get(edge.depends_on_display_id)?.push(edge.task_display_id);
    incoming.get(edge.task_display_id)?.push(edge.depends_on_display_id);
  }
  const cycle = detectKanbanEpicCycle(sectionTasks.map((task) => task.display_id), outgoing);
  if (cycle) return { cycle };
  const layer = new Map();
  const visiting = new Set();
  function computeLayer(id) {
    if (layer.has(id)) return layer.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const preds = incoming.get(id) || [];
    let max = 0;
    for (const pred of preds) {
      const value = computeLayer(pred);
      if (value + 1 > max) max = value + 1;
    }
    visiting.delete(id);
    layer.set(id, max);
    return max;
  }
  for (const task of sectionTasks) computeLayer(task.display_id);
  const maxLayer = Math.max(0, ...Array.from(layer.values()));
  const lanes = Array.from({ length: maxLayer + 1 }, () => []);
  for (const task of sectionTasks) lanes[layer.get(task.display_id) || 0].push(task);
  return { layers: lanes, edges: internalEdges, layer };
}

function detectKanbanEpicCycle(ids, outgoing) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(ids.map((id) => [id, WHITE]));
  const stack = [];
  function visit(id) {
    color.set(id, GRAY);
    stack.push(id);
    for (const next of outgoing.get(id) || []) {
      if (color.get(next) === GRAY) {
        const start = stack.indexOf(next);
        return stack.slice(start).concat(next);
      }
      if (color.get(next) === WHITE) {
        const found = visit(next);
        if (found) return found;
      }
    }
    color.set(id, BLACK);
    stack.pop();
    return null;
  }
  for (const id of ids) {
    if (color.get(id) === WHITE) {
      const found = visit(id);
      if (found) return found;
    }
  }
  return null;
}

function renderKanbanEpicDagSvg(layout, sectionKey, sectionTasks) {
  const layers = layout.layers || [];
  // EP-003 WA-013 fix-up (advisor msg #40): NODE_H bumped from 92 → 110
  // because the unified card now carries a repo:role line + 2-line title
  // clamp + meta + bottom-right id; 92px was cramped for long titles.
  const NODE_W = 240, NODE_H = 110, H_GAP = 64, V_GAP = 18;
  const layerHeights = layers.map((tasks) => tasks.length * NODE_H + Math.max(0, tasks.length - 1) * V_GAP);
  const totalH = Math.max(NODE_H, ...layerHeights);
  const totalW = Math.max(NODE_W, layers.length * NODE_W + Math.max(0, layers.length - 1) * H_GAP);
  const positions = new Map();
  layers.forEach((tasks, layerIdx) => {
    const yOffset = (totalH - layerHeights[layerIdx]) / 2;
    tasks.forEach((task, rank) => {
      const x = layerIdx * (NODE_W + H_GAP);
      const y = yOffset + rank * (NODE_H + V_GAP);
      positions.set(task.display_id, { x, y });
    });
  });
  const edgePaths = (layout.edges || []).map((edge) => {
    const prereq = positions.get(edge.depends_on_display_id);
    const dependent = positions.get(edge.task_display_id);
    if (!prereq || !dependent) return '';
    const x1 = prereq.x + NODE_W;
    const y1 = prereq.y + NODE_H / 2;
    const x2 = dependent.x;
    const y2 = dependent.y + NODE_H / 2;
    const cx = (x1 + x2) / 2;
    return '<path class="kanban-epic-dag-edge" d="M' + x1 + ',' + y1 + ' C' + cx + ',' + y1 + ' ' + cx + ',' + y2 + ' ' + x2 + ',' + y2 + '" />';
  }).join('');
  const nodes = sectionTasks.map((task) => {
    const pos = positions.get(task.display_id);
    if (!pos) return '';
    const ext = computeExternalDeps(sectionKey, task);
    // WA-055: flip popup above when the node sits in the bottom third of
    // the DAG so the dependency popup doesn't get cropped off-screen.
    const popupAbove = totalH > 0 && pos.y > totalH * 0.6;
    const popupSide = popupAbove ? ' data-popup-side="above"' : '';
    const inwardBtn = ext.dependsOn.length
      ? '<button type="button" class="kanban-epic-dag-external inward" data-task-id="' + esc(task.display_id) + '"' + popupSide + ' aria-label="Cross-epic dependencies (inward)">←</button>'
        + '<div class="kanban-epic-dag-external-popup" role="tooltip">'
          + '<div class="kanban-epic-dag-popup-group"><strong>Depends on:</strong>' + ext.dependsOn.map((row) => '<a data-action="open-kanban-task" data-task-id="' + esc(row.display_id) + '">' + esc(row.display_id) + (row.title ? ' ' + esc(row.title) : '') + '</a>').join('') + '</div>'
        + '</div>'
      : '';
    const outwardBtn = ext.dependedBy.length
      ? '<button type="button" class="kanban-epic-dag-external" data-task-id="' + esc(task.display_id) + '"' + popupSide + ' aria-label="Cross-epic dependants (outward)">→</button>'
        + '<div class="kanban-epic-dag-external-popup" role="tooltip">'
          + '<div class="kanban-epic-dag-popup-group"><strong>Depended on by:</strong>' + ext.dependedBy.map((row) => '<a data-action="open-kanban-task" data-task-id="' + esc(row.display_id) + '">' + esc(row.display_id) + (row.title ? ' ' + esc(row.title) : '') + '</a>').join('') + '</div>'
        + '</div>'
      : '';
    const externalBtn = inwardBtn + outwardBtn;
    return '<div class="kanban-epic-dag-node priority-' + esc(String(task.priority || '').toLowerCase()) + '" style="left:' + pos.x + 'px;top:' + pos.y + 'px;width:' + NODE_W + 'px;height:' + NODE_H + 'px">'
      + renderKanbanCardCore(task, {
          extraClass: 'kanban-card-dag kanban-epic-dag-card',
          repoLine: taskRepoRoleLabel(task),
        })
      + externalBtn
      + '</div>';
  }).join('');
  return '<div class="kanban-epic-dag" style="width:' + totalW + 'px;height:' + totalH + 'px">'
    + '<svg class="kanban-epic-dag-edges" width="' + totalW + '" height="' + totalH + '" viewBox="0 0 ' + totalW + ' ' + totalH + '" aria-hidden="true">' + edgePaths + '</svg>'
    + nodes
  + '</div>';
}

// EP-003 WA-013 (advisor msg #34): shared content contract + styling
// tokens between the kanban board card, the epic full-width row, and the
// epic dependency DAG node. Single helper renders the button body so we
// don't keep three copies of the title/meta markup that drift apart.
function taskRepoRoleLabel(task) {
  const roleName = task.assigned_role_name || '';
  if (!roleName) return 'unassigned';
  const role = roleByName(roleName);
  if (role) {
    const repoName = role.repo_name || role.repoName || laneRepoName(role);
    const name = role.name || roleName;
    return repoName ? (repoName + ':' + name) : name;
  }
  return roleName;
}

function renderKanbanCardCore(task, opts = {}) {
  const extraClass = opts.extraClass || '';
  const archived = task.archived_at ? '<span class="kanban-pill archived">archived</span>' : '';
  const github = task.github_number ? '<span class="kanban-pill github">#' + esc(task.github_number) + '</span>' : '';
  const title = String(task.title || '');
  const statusPill = opts.includeStatusPill
    ? '<span class="kanban-pill kanban-status-' + statusClass(task.status) + '">' + esc(task.status) + '</span>'
    : '';
  const repoLine = opts.repoLine
    ? '<span class="kanban-card-repo-line" ' + truncatedAttrs(opts.repoLine) + '>' + esc(opts.repoLine) + '</span>'
    : '';
  const cardClass = ('kanban-card ' + extraClass + (task.archived_at ? ' archived' : '') + ' priority-' + esc(String(task.priority || '').toLowerCase())).replace(/\s+/g, ' ').trim();
  return '<button type="button" class="' + cardClass + '" data-action="open-kanban-task" data-task-id="' + esc(task.display_id) + '">' +
    repoLine +
    '<span class="kanban-card-title" ' + truncatedAttrs(title) + '>' + esc(title) + '</span>' +
    '<span class="kanban-card-meta"><span class="kanban-pill">' + esc(task.priority || 'P?') + '</span>' + renderEffortPill(task.effort, 'M') + github + statusPill + archived + '<span class="kanban-id">' + esc(task.display_id) + '</span></span>' +
  '</button>';
}

function renderKanbanEpicIssueRow(task) {
  return renderKanbanCardCore(task, {
    extraClass: 'kanban-epic-issue-card',
    includeStatusPill: true,
    repoLine: taskRepoRoleLabel(task),
  });
}

async function loadKanbanEpics(opts = {}) {
  if (!shouldPollWorkspace()) return;
  if (kanbanEpicsLoading) return;
  kanbanEpicsLoading = true;
  kanbanEpicsError = '';
  try {
    const params = new URLSearchParams({ includeUnclassified: 'true' });
    const res = await workspaceFetch('/kanban/epics?' + params.toString());
    const body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || ('HTTP ' + res.status));
    kanbanEpics = Array.isArray(body.epics) ? body.epics : [];
    kanbanEpicChildren = body.children && typeof body.children === 'object' ? body.children : {};
    kanbanEpicUnclassified = Array.isArray(body.unclassified) ? body.unclassified : [];
    kanbanEpicDependencies = Array.isArray(body.dependencies) ? body.dependencies : [];
    kanbanEpicsLoaded = true;
  } catch (e) {
    kanbanEpicsError = e instanceof Error ? e.message : String(e);
  } finally {
    kanbanEpicsLoading = false;
    if (getPage() === 'kanban' && kanbanTab === 'epics' && !opts.silent) renderKanban();
  }
}

function refreshKanbanEpics() {
  kanbanEpicsLoaded = false;
  void loadKanbanEpics();
  renderKanban();
}

function selectKanbanEpicStatus(value) {
  kanbanEpicStatusFilter = kanbanStatuses.includes(value) ? value : '';
  renderKanban();
}

function toggleKanbanEpicVisualise(checked) {
  const mq = kanbanEpicMobileQuery();
  if (mq && mq.matches) return;
  kanbanEpicVisualizeDeps = Boolean(checked);
  saveKanbanEpicVisToStorage();
  renderKanban();
}

function toggleKanbanEpicSection(epicId) {
  const id = String(epicId || '');
  if (!id) return;
  kanbanEpicExpand = kanbanEpicExpand === id ? '' : id;
  renderKanban();
  updateUrl();
}

function kanbanToolbar() {
  const assigneeOptions = [['', 'All assignees'], ...(getState().roles || []).map(role => [role.name, role.name])];
  const priorityOptions = [['', 'All priorities'], ...priorities.map(priority => [priority, priority])];
  const visibleCount = kanbanVisibleTasks().length;
  const archiveSummary = kanbanTab === 'archive' ? '<div class="archive-summary" aria-live="polite"><strong>' + visibleCount + '</strong> archived task' + (visibleCount === 1 ? '' : 's') + '</div>' : '';
  const searchLabel = kanbanTab === 'archive' ? 'Search archived tasks' : 'Search tasks';
  return '<div class="kanban-toolbar"><div class="kanban-search"><input data-kanban-search placeholder="' + esc(searchLabel) + '" aria-label="' + esc(searchLabel) + '" value="' + esc(kanbanSearch) + '" /></div>' +
    settingsDropdown('Kanban assignee', kanbanAssignee, assigneeOptions, { inputAttrs: 'data-kanban-assignee' }) +
    settingsDropdown('Kanban priority', kanbanPriority, priorityOptions, { inputAttrs: 'data-kanban-priority' }) +
    '<button class="btn secondary small" data-action="refresh-kanban">Refresh</button>' + archiveSummary + '</div>' +
    (kanbanError ? '<div class="thread-empty error">' + esc(kanbanError) + '</div>' : '');
}

function kanbanVisibleTasks() {
  return kanbanTab === 'archive'
    ? kanbanTasks.filter(task => task.archived_at)
    : kanbanTasks.filter(task => !task.archived_at);
}

function kanbanBoard() {
  if (kanbanLoading && !kanbanLoaded) return '<div class="thread-empty">Loading tasks…</div>';
  const lanes = kanbanLanes();
  if (!lanes.length) return '<div class="thread-empty">No Kanban tasks match the current filters.</div>';
  const tasks = kanbanVisibleTasks();
  return '<div class="kanban-board" style="--kanban-status-count:' + statuses.length + ';--kanban-status-total-min:' + (statuses.length * 200) + 'px">' +
    '<div class="kanban-board-head"><div class="kanban-board-agent-head">Repo &amp; Agent</div><div class="kanban-board-status-heads">' + statuses.map(status => '<div class="kanban-board-status-head kanban-status-' + statusClass(status) + '"><span class="kanban-status-dot"></span><span>' + esc(status) + '</span><strong>' + tasks.filter(task => task.status === status).length + '</strong></div>').join('') + '</div></div>' +
    '<div class="kanban-board-rows">' + lanes.map(lane => renderKanbanLane(lane)).join('') + '</div>' +
  '</div>';
}

function compareArchivedTasks(a, b) {
  const at = Date.parse(a?.archived_at || '') || 0;
  const bt = Date.parse(b?.archived_at || '') || 0;
  if (at !== bt) return bt - at;
  return String(a?.display_id || '').localeCompare(String(b?.display_id || ''));
}

function kanbanArchiveBoard() {
  if (kanbanLoading && !kanbanLoaded) return '<div class="thread-empty">Loading archived tasks…</div>';
  const tasks = kanbanVisibleTasks().slice().sort(compareArchivedTasks);
  const lanes = kanbanLanesFromTasks(tasks, { allowEmptyRoles: false });
  if (!lanes.length) return '<div class="thread-empty">No archived tasks yet.</div>';
  return '<div class="archive-board" role="region" aria-label="Kanban archive">' +
    '<div class="archive-head"><div class="archive-agent-head">Repo &amp; Agent</div><div class="archive-table-head"><span>ID</span><span>Title</span><span>Status</span><span>Effort</span><span>Priority</span><span>Archived at</span><span>Archived by</span><span>Detail</span></div></div>' +
    '<div class="archive-rows">' + lanes.map(renderKanbanArchiveLane).join('') + '</div>' +
  '</div>';
}

function kanbanLanes() {
  return kanbanLanesFromTasks(kanbanVisibleTasks(), { allowEmptyRoles: kanbanTab !== 'archive' });
}

function kanbanLanesFromTasks(tasks, opts) {
  const allowEmptyRoles = Boolean(opts && opts.allowEmptyRoles);
  const assignedNames = tasks.map(task => kanbanLaneName(task.assigned_role_name));
  const roleNames = (getState().roles || []).map(role => roleDisplayName(role));
  const names = kanbanAssignee ? [kanbanLaneName(kanbanAssignee)] : Array.from(new Set([...(allowEmptyRoles ? roleNames : []), ...assignedNames]));
  const showEmptyKnownRoles = allowEmptyRoles && !kanbanSearch.trim() && !kanbanPriority;
  return names.filter(Boolean).sort((a, b) => a.localeCompare(b)).map(name => ({ name, tasks: tasks.filter(task => kanbanLaneName(task.assigned_role_name) === name) })).filter(lane => lane.tasks.length || kanbanAssignee || (showEmptyKnownRoles && roleByName(lane.name)));
}

function renderKanbanBoardForTasks(tasks) {
  const lanes = kanbanLanesFromTasks(tasks, { allowEmptyRoles: false });
  if (!lanes.length) return '<div class="thread-empty">No tasks.</div>';
  return '<div class="kanban-board kanban-board-epic" style="--kanban-status-count:' + statuses.length + ';--kanban-status-total-min:' + (statuses.length * 200) + 'px">' +
    '<div class="kanban-board-head"><div class="kanban-board-agent-head">Repo &amp; Agent</div><div class="kanban-board-status-heads">' + statuses.map(status => '<div class="kanban-board-status-head kanban-status-' + statusClass(status) + '"><span class="kanban-status-dot"></span><span>' + esc(status) + '</span><strong>' + tasks.filter(task => task.status === status).length + '</strong></div>').join('') + '</div></div>' +
    '<div class="kanban-board-rows">' + lanes.map(lane => renderKanbanLane(lane)).join('') + '</div>' +
  '</div>';
}

// EP-003 WA-012: lane head shows the repoName above the roleName so two
// agents named `main` in different repos remain visually distinct, plus
// the same identicon used in the Agents Overview / messaging surfaces.
function laneRepoName(role) {
  if (!role) return '';
  const inline = role.repo_name || role.repoName || '';
  if (inline) return String(inline);
  const repos = (getState().repos || []);
  const repoId = role.repo_id || role.repoId || '';
  const found = repoId ? repos.find(repo => String(repo.id || '') === String(repoId)) : null;
  return found ? String(found.name || '') : '';
}

function roleDisplayName(role) {
  return role?.display_id || role?.displayId || role?.name || '';
}

function kanbanLaneName(assignedRoleName) {
  const name = assignedRoleName || 'unassigned';
  const role = roleByName(name);
  return role ? roleDisplayName(role) : name;
}

function laneAgentHtml(role, laneName) {
  const repoName = laneRepoName(role);
  const roleName = role?.name || laneName;
  if (!repoName) return '<strong class="kanban-lane-agent-name">' + esc(roleName) + '</strong>';
  return '<span class="kanban-lane-agent-label"><span class="kanban-lane-agent-repo">' + esc(repoName) + '</span><strong class="kanban-lane-agent-name">' + esc(roleName) + '</strong></span>';
}

function renderKanbanLane(lane) {
  const role = roleByName(lane.name);
  const done = lane.tasks.filter(task => task.status === 'Completed').length;
  const progress = lane.tasks.length ? Math.round((done / lane.tasks.length) * 100) : 0;
  const avatar = role ? roleAvatarWithPresence(role, 26) : kanbanIssueIdenticon(lane.name, 26);
  return '<div class="kanban-row" data-lane-name="' + esc(lane.name) + '"><div class="kanban-lane-head">' +
    '<div class="kanban-lane-agent">' + avatar + '<div class="kanban-lane-agent-text">' + laneAgentHtml(role, lane.name) + '<span class="kanban-lane-agent-count">' + lane.tasks.length + ' task' + (lane.tasks.length === 1 ? '' : 's') + '</span></div></div>' +
    '<div class="kanban-progress"><span style="width:' + progress + '%"></span></div>' +
  '</div><div class="kanban-row-cells">' + statuses.map(status => renderKanbanCell(lane, status)).join('') + '</div></div>';
}

function archiveLaneAgentHtml(role, laneName) {
  const repoName = laneRepoName(role);
  const roleName = role?.name || laneName;
  if (!repoName) return '<div class="lane-label"><strong class="lane-name" ' + truncatedAttrs(roleName) + '>' + esc(roleName) + '</strong></div>';
  return '<div class="lane-label"><span class="lane-repo" ' + truncatedAttrs(repoName) + '>' + esc(repoName) + '</span><strong class="lane-name" ' + truncatedAttrs(roleName) + '>' + esc(roleName) + '</strong></div>';
}

function renderKanbanArchiveLane(lane) {
  const role = roleByName(lane.name);
  const avatar = role ? roleAvatarWithPresence(role, 26) : kanbanIssueIdenticon(lane.name, 26);
  const count = lane.tasks.length;
  return '<div class="archive-row" data-lane-name="' + esc(lane.name) + '"><div class="archive-lane-head">' +
    '<div class="lane-agent">' + avatar + archiveLaneAgentHtml(role, lane.name) + '</div>' +
    '<span class="lane-count">' + count + ' archived</span>' +
    '<div class="archive-progress" aria-hidden="true"><span style="width:' + (count ? '100' : '0') + '%"></span></div>' +
  '</div><div class="archive-table">' + (count ? lane.tasks.map(renderKanbanArchiveItem).join('') : '<div class="archive-empty-line">(no archived tasks)</div>') + '</div></div>';
}

function renderKanbanArchiveItem(task) {
  const selected = task.display_id === kanbanSelectedTaskId;
  const github = task.github_title || (task.github_number ? ('#' + task.github_number) : '');
  return '<button type="button" class="archive-item ' + (selected ? 'selected' : '') + '" data-action="open-kanban-task" data-task-id="' + esc(task.display_id) + '">' +
    '<span class="archive-id">' + esc(task.display_id || '') + '</span>' +
    '<span class="archive-title"><strong ' + truncatedAttrs(task.title || '') + '>' + esc(task.title || '') + '</strong><span ' + truncatedAttrs(github || task.details || 'Archived task') + '>' + esc(github || task.details || 'Archived task') + '</span></span>' +
    '<span><span class="kanban-pill status">' + esc(task.status || '') + '</span></span>' +
    '<span>' + renderEffortPill(task.effort) + '</span>' +
    '<span><span class="kanban-pill ' + esc(String(task.priority || '').toLowerCase()) + '">' + esc(task.priority || '') + '</span></span>' +
    '<span class="archive-date">' + esc(formatMessageTime(task.archived_at || task.updated_at || task.created_at)) + '</span>' +
    '<span class="archive-muted">' + esc(task.archived_by_role_name || '') + '</span>' +
    '<span class="archive-detail-link">Open</span>' +
  '</button>';
}

function renderKanbanCell(lane, status) {
  const tasks = lane.tasks.filter(task => task.status === status);
  return '<div class="kanban-cell kanban-status-' + statusClass(status) + '" data-status="' + esc(status) + '">' +
    '<div class="kanban-cell-scroll">' + tasks.map(renderKanbanCard).join('') + '</div>' +
  '</div>';
}

function renderKanbanCard(task) {
  const selected = task.display_id === kanbanSelectedTaskId;
  return renderKanbanCardCore(task, { extraClass: selected ? 'selected' : '' });
}

function renderKanbanSidebar(opts) {
  const tag = opts.headTag || 'div';
  const closeLabel = opts.closeLabel || 'Close';
  const closeAria = opts.closeAria || closeLabel;
  const head = '<' + tag + ' class="' + esc(opts.headClass || '') + '">' + (opts.head || '') + '<button type="button" class="btn secondary small" data-action="' + esc(opts.closeAction) + '" aria-label="' + esc(closeAria) + '">' + esc(closeLabel) + '</button></' + tag + '>';
  return '<aside class="' + esc(opts.className || '') + '" role="complementary" aria-label="' + esc(opts.ariaLabel || '') + '">' + head + (opts.body || '') + '</aside>';
}

function renderKanbanDetail() {
  if (!kanbanSelectedTaskId) return '';
  const shell = (head, body) => renderKanbanSidebar({ className: 'kanban-detail', ariaLabel: 'Task details', headClass: 'kanban-detail-head', closeAction: 'close-kanban-task', head, body });
  if (kanbanDetailLoading && !kanbanDetail) return shell('', '<div class="thread-empty">Loading task detail…</div>');
  if (kanbanDetailError) return shell('', '<div class="thread-empty error">' + esc(kanbanDetailError) + '</div>');
  const task = kanbanDetail?.task || kanbanTasks.find(item => item.display_id === kanbanSelectedTaskId);
  if (!task) return shell('', '<div class="thread-empty">Task not found.</div>');
  const head = '<div><p class="kanban-kicker">' + esc(task.display_id) + '</p><h2>' + esc(task.title || '') + '</h2></div>';
  const body =
    '<div class="kanban-detail-badges"><span class="kanban-pill status">' + esc(task.status || '') + '</span><span class="kanban-pill">' + esc(task.priority || '') + '</span>' + renderEffortPill(task.effort) + '</div>' +
    '<div class="kanban-detail-grid"><div><span>Assigned</span><strong ' + truncatedAttrs(task.assigned_role_name || '') + '>' + esc(task.assigned_role_name || '') + '</strong></div><div><span>Created by</span><strong ' + truncatedAttrs(task.created_by_role_name || '') + '>' + esc(task.created_by_role_name || '') + '</strong></div><div><span>Updated</span><strong ' + truncatedAttrs(formatMessageTime(task.updated_at || task.created_at)) + '>' + esc(formatMessageTime(task.updated_at || task.created_at)) + '</strong></div></div>' +
    (task.github_url ? (/^https?:\/\//i.test(task.github_url)
      ? '<a class="kanban-github" href="' + esc(task.github_url) + '" target="_blank" rel="noopener noreferrer">' + esc(task.github_title || ('GitHub #' + (task.github_number || ''))) + '</a>'
      : '<span class="kanban-github">' + esc(task.github_title || task.github_url) + '</span>') : '') +
    '<section><h3>Details</h3><div class="kanban-detail-text markdown-body">' + renderSafeMarkdown(task.details || 'No task details yet.') + '</div></section>' +
    renderKanbanDependencySection('Dependencies', kanbanDetail?.dependencies || [], 'depends_on_display_id', 'depends_on_title') +
    renderKanbanDependencySection('Depended On By', kanbanDetail?.dependedBy || [], 'task_display_id', 'title') +
    renderKanbanComments(kanbanDetail?.comments || []) +
    renderKanbanActivity(kanbanDetail?.activity || []);
  return shell(head, body);
}

function statusClass(status) {
  return String(status || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function renderKanbanDependencySection(title, items, idField, titleField) {
  if (!items.length) return '<section><h3>' + esc(title) + '</h3><div class="kanban-empty-line">None</div></section>';
  return '<section><h3>' + esc(title) + '</h3><div class="kanban-linked-list">' + items.map(item => '<button type="button" data-action="open-kanban-task" data-task-id="' + esc(item[idField]) + '"><strong>' + esc(item[idField]) + '</strong><span>' + esc(item[titleField] || '') + '</span></button>').join('') + '</div></section>';
}

function renderKanbanComments(comments) {
  return '<section><h3>Comments</h3>' + (comments.length ? '<div class="kanban-comments">' + comments.map(comment => '<article class="kanban-comment ' + esc(comment.type || 'note') + '"><div><strong>' + esc(comment.role_name || '') + '</strong><span>' + esc(comment.type || 'note') + ' · ' + esc(formatMessageTime(comment.created_at)) + '</span></div><div class="kanban-comment-body markdown-body">' + renderSafeMarkdown(comment.body || '') + '</div></article>').join('') + '</div>' : '<div class="kanban-empty-line">No comments yet.</div>') + '</section>';
}

function renderKanbanActivity(activity) {
  return '<section><h3>Activity</h3>' + (activity.length ? '<div class="kanban-activity">' + activity.map(item => '<div><span>' + esc(formatMessageTime(item.created_at)) + '</span><strong>' + esc(item.role_name || '') + '</strong><em>' + esc(item.action || '') + (item.field ? ' · ' + esc(item.field) : '') + '</em></div>').join('') + '</div>' : '<div class="kanban-empty-line">No activity yet.</div>') + '</section>';
}

function openKanbanEpicDetails(epicId, opts) {
  const id = String(epicId || '').trim();
  if (!id) return;
  const scrollToBanner = Boolean(opts && opts.scrollToBanner);
  if (kanbanEpicDrawerId !== id) {
    kanbanEpicDrawerId = id;
    kanbanEpicDrawerDetail = null;
    kanbanEpicDrawerError = '';
    void loadKanbanEpicDrawer(id);
  }
  renderKanban();
  setTimeout(() => {
    const drawer = document.querySelector('.kanban-epic-drawer');
    if (!(drawer instanceof HTMLElement)) return;
    if (scrollToBanner) {
      const banner = drawer.querySelector('#kanban-epic-drawer-close-banner');
      if (banner instanceof HTMLElement) {
        banner.scrollIntoView({ behavior: 'auto', block: 'start' });
        const approve = banner.querySelector('[data-action="approve-kanban-epic-close"]');
        if (approve instanceof HTMLElement) { approve.focus(); return; }
      }
    }
    const closeBtn = drawer.querySelector('[data-action="close-kanban-epic-drawer"]');
    if (closeBtn instanceof HTMLElement) closeBtn.focus();
  }, 0);
}

function closeKanbanEpicDetails() {
  if (!kanbanEpicDrawerId) return;
  kanbanEpicDrawerId = '';
  kanbanEpicDrawerDetail = null;
  kanbanEpicDrawerError = '';
  renderKanban();
}

async function loadKanbanEpicDrawer(epicId) {
  if (!shouldPollWorkspace()) return;
  kanbanEpicDrawerLoading = true;
  kanbanEpicDrawerError = '';
  try {
    const res = await workspaceFetch('/kanban/epics/' + encodeURIComponent(epicId));
    const body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error || ('HTTP ' + res.status));
    if (kanbanEpicDrawerId === epicId) {
      kanbanEpicDrawerDetail = body;
    }
  } catch (e) {
    if (kanbanEpicDrawerId === epicId) kanbanEpicDrawerError = e instanceof Error ? e.message : String(e);
  } finally {
    kanbanEpicDrawerLoading = false;
    if (getPage() === 'kanban' && kanbanTab === 'epics' && kanbanEpicDrawerId === epicId) renderKanban();
  }
}

function renderKanbanEpicDrawer() {
  if (!kanbanEpicDrawerId) return '';
  const epic = kanbanEpicDrawerDetail?.epic;
  const shell = (head, body) => renderKanbanSidebar({ className: 'kanban-epic-drawer', ariaLabel: 'Epic details', headClass: 'kanban-epic-drawer-head', headTag: 'header', closeAction: 'close-kanban-epic-drawer', closeAria: 'Close epic details', head, body });
  const head =
    '<div><span class="kanban-epic-drawer-id">' + esc(kanbanEpicDrawerId) + '</span>' +
      (epic ? '<h2>' + esc(epic.title || '') + '</h2>' : '<h2>Loading…</h2>') +
      (epic ? '<span class="kanban-pill kanban-status-' + statusClass(epic.status) + '">' + esc(epic.status) + '</span>' : '') +
    '</div>';
  if (kanbanEpicDrawerLoading && !kanbanEpicDrawerDetail) {
    return shell(head, '<div class="thread-empty">Loading epic detail…</div>');
  }
  if (kanbanEpicDrawerError) {
    return shell(head, '<div class="thread-empty error">' + esc(kanbanEpicDrawerError) + '</div>');
  }
  if (!epic) {
    return shell(head, '<div class="thread-empty">Epic not found.</div>');
  }
  const githubLink = epic.github_url && /^https?:\/\//i.test(epic.github_url)
    ? '<a class="kanban-github" href="' + esc(epic.github_url) + '" target="_blank" rel="noopener noreferrer">' + esc(epic.github_title || ('GitHub #' + (epic.github_number || ''))) + '</a>'
    : '';
  const meta = '<div class="kanban-epic-drawer-meta">' +
    '<div class="kanban-epic-drawer-meta-row">' + kanbanIssueIdenticon(epic.assigned_role_name || '', 24) + '<strong>' + esc(epic.assigned_role_name || 'unassigned') + '</strong></div>' +
    '<div class="kanban-epic-drawer-pills"><span class="kanban-pill">' + esc(epic.priority || 'P?') + '</span>' + renderEffortPill(epic.effort, 'M') + (githubLink ? githubLink : '') + '</div>' +
  '</div>';
  const details = '<section class="kanban-epic-drawer-section"><h3>Details</h3><div class="kanban-detail-text markdown-body">' + renderSafeMarkdown(epic.details || 'No epic details yet.') + '</div></section>';
  const closeBanner = renderKanbanEpicCloseApprovalBanner(epic);
  const children = Array.isArray(kanbanEpicDrawerDetail?.children) ? kanbanEpicDrawerDetail.children : [];
  const childrenSection = '<section class="kanban-epic-drawer-section"><h3>Child tasks</h3>' + (children.length
    ? '<div class="kanban-linked-list">' + children.map(child => '<button type="button" data-action="open-kanban-task" data-task-id="' + esc(child.display_id) + '"><strong>' + esc(child.display_id) + '</strong><span>' + esc(child.title || '') + '</span></button>').join('') + '</div>'
    : '<div class="kanban-empty-line">No child tasks yet.</div>') + '</section>';
  const comments = Array.isArray(kanbanEpicDrawerDetail?.comments) ? kanbanEpicDrawerDetail.comments : [];
  const commentsSection = renderKanbanEpicDrawerComments(comments);
  const activity = Array.isArray(kanbanEpicDrawerDetail?.activity) ? kanbanEpicDrawerDetail.activity : [];
  const activitySection = renderKanbanEpicDrawerActivity(activity);
  return shell(head, closeBanner + meta + details + childrenSection + commentsSection + activitySection);
}

function renderKanbanEpicCloseApprovalBanner(epic) {
  if (epic.close_approval_status !== 'pending') return '';
  const requester = epic.close_approval_requested_by_role_name || 'unknown';
  const childrenCount = Array.isArray(kanbanEpicDrawerDetail?.children)
    ? kanbanEpicDrawerDetail.children.filter((child) => child && child.status !== 'Completed' && !child.archived_at).length
    : 0;
  const childList = Array.isArray(kanbanEpicDrawerDetail?.children)
    ? kanbanEpicDrawerDetail.children
        .filter((child) => child && child.status !== 'Completed' && !child.archived_at)
        .map((child) => '<a data-action="open-kanban-task" data-task-id="' + esc(child.display_id) + '">' + esc(child.display_id) + '</a>')
        .join(', ')
    : '';
  const childSummary = childrenCount > 0
    ? '<div class="kanban-epic-drawer-close-banner-children">' + childrenCount + ' open child ' + pluralize(childrenCount, 'task') + ': ' + childList + '</div>'
    : '<div class="kanban-epic-drawer-close-banner-children">No open child tasks remaining.</div>';
  return '<div class="kanban-epic-drawer-close-banner" data-epic-id="' + esc(epic.display_id) + '" id="kanban-epic-drawer-close-banner">' +
    '<strong>Close requested by ' + esc(requester) + '</strong>' +
    childSummary +
    '<div class="kanban-epic-drawer-close-banner-actions">' +
      '<button type="button" class="btn kanban-epic-drawer-approve" data-action="approve-kanban-epic-close" data-epic-id="' + esc(epic.display_id) + '">Approve close</button>' +
      '<button type="button" class="btn secondary kanban-epic-drawer-cancel-close" data-action="cancel-kanban-epic-close-web" data-epic-id="' + esc(epic.display_id) + '">Cancel</button>' +
    '</div>' +
  '</div>';
}

async function approveKanbanEpicClose(epicId) {
  if (!epicId) return;
  try {
    const res = await workspaceFetch('/kanban/epics/' + encodeURIComponent(epicId) + '/close-approval/approve', { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (res.status === 403) {
      kanbanEpicDrawerError = 'Close approval requires a human web session; agent tokens are not authorised.';
      renderKanban();
      return;
    }
    if (!res.ok || body.ok === false) throw new Error(body.error || ('HTTP ' + res.status));
    kanbanEpicsLoaded = false;
    await loadKanbanEpics({ silent: true });
    await loadKanbanEpicDrawer(epicId);
  } catch (e) {
    kanbanEpicDrawerError = e instanceof Error ? e.message : String(e);
    renderKanban();
  }
}

async function cancelKanbanEpicCloseFromWeb(epicId) {
  if (!epicId) return;
  try {
    const res = await workspaceFetch('/kanban/epics/' + encodeURIComponent(epicId) + '/close-approval/cancel', { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(body.error || ('HTTP ' + res.status));
    kanbanEpicsLoaded = false;
    await loadKanbanEpics({ silent: true });
    await loadKanbanEpicDrawer(epicId);
  } catch (e) {
    kanbanEpicDrawerError = e instanceof Error ? e.message : String(e);
    renderKanban();
  }
}

function renderKanbanEpicDrawerComments(comments) {
  return '<section class="kanban-epic-drawer-section"><h3>Comments</h3>' + (comments.length
    ? '<div class="kanban-comments">' + comments.map(comment => '<article class="kanban-comment ' + esc(comment.type || 'note') + '"><div><strong>' + esc(comment.role_name || '') + '</strong><span>' + esc(comment.type || 'note') + ' · ' + esc(formatMessageTime(comment.created_at)) + '</span></div><div class="kanban-comment-body markdown-body">' + renderSafeMarkdown(comment.body || '') + '</div></article>').join('') + '</div>'
    : '<div class="kanban-empty-line">No comments yet.</div>') + '</section>';
}

function renderKanbanEpicDrawerActivity(activity) {
  return '<section class="kanban-epic-drawer-section"><h3>Activity</h3>' + (activity.length
    ? '<div class="kanban-activity">' + activity.map(item => '<div><span>' + esc(formatMessageTime(item.created_at)) + '</span><strong>' + esc(item.role_name || '') + '</strong><em>' + esc(item.action || '') + (item.field ? ' · ' + esc(item.field) : '') + '</em></div>').join('') + '</div>'
    : '<div class="kanban-empty-line">No activity yet.</div>') + '</section>';
}

let kanbanLastInteraction = 0;
let kanbanPointerHeld = false;
function inKanbanInteractionArea(target) {
  return Boolean(target?.closest?.('.kanban-page, .kanban-board, .kanban-detail, .kanban-detail-view'));
}

let _delegationInstalled = false;

export function installKanban(c) {
  _ctx = c;
  if (_delegationInstalled) return;
  _delegationInstalled = true;

  document.addEventListener('click', e => {
    const target = e.target?.closest?.('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'open-kanban-task') { e.preventDefault(); openKanbanTask(target.dataset.taskId || ''); }
    if (target.dataset.action === 'close-kanban-task') { e.preventDefault(); closeKanbanTask(); }
    if (target.dataset.action === 'refresh-kanban') { e.preventDefault(); refreshKanbanTasks({ preserveSearchFocus: true }); }
    if (target.dataset.action === 'select-kanban-tab') { e.preventDefault(); selectKanbanTab(target.dataset.tab || 'board'); }
    if (target.dataset.action === 'toggle-kanban-epic-section') { e.preventDefault(); toggleKanbanEpicSection(target.dataset.epicId || ''); }
    if (target.dataset.action === 'open-kanban-epic-details') { e.preventDefault(); e.stopPropagation(); openKanbanEpicDetails(target.dataset.epicId || '', { scrollToBanner: target.classList.contains('kanban-epic-close-pill') }); }
    if (target.dataset.action === 'close-kanban-epic-drawer') { e.preventDefault(); closeKanbanEpicDetails(); }
    if (target.dataset.action === 'refresh-kanban-epics') { e.preventDefault(); refreshKanbanEpics(); }
    if (target.dataset.action === 'approve-kanban-epic-close') { e.preventDefault(); void approveKanbanEpicClose(target.dataset.epicId || ''); }
    if (target.dataset.action === 'cancel-kanban-epic-close-web') { e.preventDefault(); void cancelKanbanEpicCloseFromWeb(target.dataset.epicId || ''); }
  });

  document.addEventListener('input', e => {
    if (!e.target?.matches?.('[data-kanban-search]')) return;
    kanbanSearch = e.target.value || '';
    kanbanLoaded = false;
    if (kanbanSearchTimer) clearTimeout(kanbanSearchTimer);
    kanbanSearchTimer = setTimeout(() => {
      kanbanSearchTimer = 0;
      void loadKanbanTasks({ preserveSearchFocus: true });
    }, KANBAN_SEARCH_DEBOUNCE_MS);
  });

  document.addEventListener('change', e => {
    if (e.target?.matches?.('[data-kanban-assignee]')) kanbanAssignee = e.target.value || '';
    else if (e.target?.matches?.('[data-kanban-priority]')) kanbanPriority = e.target.value || '';
    else return;
    if (kanbanSearchTimer) {
      clearTimeout(kanbanSearchTimer);
      kanbanSearchTimer = 0;
    }
    kanbanLoaded = false;
    void loadKanbanTasks();
    renderKanban();
  });

  document.addEventListener('change', e => {
    if (e.target?.matches?.('[data-action="select-kanban-epic-status"]')) {
      selectKanbanEpicStatus(e.target.value || '');
    } else if (e.target?.matches?.('[data-action="toggle-kanban-epic-visualise"]')) {
      toggleKanbanEpicVisualise(Boolean(e.target.checked));
    }
  });

  document.addEventListener('keydown', e => {
    if (!kanbanEpicDrawerId || getPage() !== 'kanban' || kanbanTab !== 'epics') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeKanbanEpicDetails();
    }
    // EP-003 WA-014: epic detail is no longer modal — drop the Tab focus
    // trap. Per advisor msg #34, an in-grid sidebar should not trap focus.
  });

  document.addEventListener('pointerdown', e => {
    if (!inKanbanInteractionArea(e.target)) return;
    kanbanPointerHeld = true;
    kanbanLastInteraction = Date.now();
  }, true);
  document.addEventListener('pointerup', () => { kanbanPointerHeld = false; kanbanLastInteraction = Date.now(); }, true);
  document.addEventListener('pointercancel', () => { kanbanPointerHeld = false; }, true);
  document.addEventListener('wheel', e => {
    if (!inKanbanInteractionArea(e.target)) return;
    kanbanLastInteraction = Date.now();
  }, { capture: true, passive: true });
  document.addEventListener('keydown', e => {
    const active = document.activeElement;
    if (!active || !inKanbanInteractionArea(active)) return;
    if (active.matches?.('input, textarea, [contenteditable="true"]')) kanbanLastInteraction = Date.now();
  }, true);

  setInterval(() => {
    if (getPage() !== 'kanban' || kanbanSearchTimer || document.hidden) return;
    if (kanbanPointerHeld) return;
    if (Date.now() - kanbanLastInteraction < 1500) return;
    if (kanbanTab === 'epics') {
      void loadKanbanEpics({ silent: false });
      return;
    }
    void loadKanbanTasks({ preserveSearchFocus: true });
    if (kanbanSelectedTaskId) void loadKanbanDetail(kanbanSelectedTaskId, { preserveSearchFocus: true });
  }, KANBAN_AUTO_REFRESH_MS);
}
