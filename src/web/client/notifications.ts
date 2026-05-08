// @ts-nocheck
// Notifications V2 feature module.
// Lift of installNotificationsV2 IIFE per
// docs/superpowers/specs/2026-05-01-web-client-modularisation-design.md.
// Owns: notification ledger, prefs (V2->V3 migration), browser-popup
// + toast + sound emission, leader-tab election, popover UI, settings
// panel for the `notifications` tab, and the legacy emitter wraps
// (notifyNewMessages, notifyRunnerExits, updateNotificationButton,
// enableNotifications, launch failure-notify).

let _ctx = null;
function ctx() {
  if (!_ctx) throw new Error('notifications context not bound; call installNotifications(ctx) first');
  return _ctx;
}
function getState() { return ctx().getState(); }
function getPage() { return ctx().getPage(); }
function getSelectedSettingsTab() { return ctx().getSelectedSettingsTab(); }
function setSelectedSettingsTab(value) { ctx().setSelectedSettingsTab(value); }
function getSelectedThread() { return ctx().getSelectedThread(); }
function getSelectedPeer() { return ctx().getSelectedPeer(); }
function getActiveTerminal() { return ctx().getActiveTerminal(); }
function setActiveTerminal(next) { ctx().setActiveTerminal(next); }
function setPage(next) { ctx().setPage(next); }
function getSelectedLaunchRole() { return ctx().getSelectedLaunchRole(); }
function getSelectedLaunchHost() { return ctx().getSelectedLaunchHost(); }
function setOpenLaunchMenuRole(next) { ctx().setOpenLaunchMenuRole(next); }
function workspaceFetch(suffix, init) { return ctx().workspaceFetch(suffix, init); }
function $(id) { return ctx().$(id); }
function settingsDropdown(name, value, options, opts) { return ctx().settingsDropdown(name, value, options, opts); }
function settingRow(title, sub, control) { return ctx().settingRow(title, sub, control); }
function appendTerminal(role, text, type) { ctx().appendTerminal(role, text, type); }
function clearAttention(role) { ctx().clearAttention(role); }
function scheduleTerminalPoll() { ctx().scheduleTerminalPoll(); }
function refresh() { return ctx().refresh(); }
function getTabId() { return ctx().getTabId(); }
function showPage(next) { ctx().showPage(next); }
function getMessages() { return ctx().getMessages(); }
function getNotificationLog() { return ctx().getNotificationLog(); }
function setNotificationLog(value) { ctx().setNotificationLog(value); }
function getNotificationPrefs() { return ctx().getNotificationPrefs(); }
function setNotificationPrefs(value) { ctx().setNotificationPrefs(value); }
function getNotificationPopoverOpen() { return ctx().getNotificationPopoverOpen(); }
function setNotificationPopoverOpen(value) { ctx().setNotificationPopoverOpen(value); }
function getNotificationToastQueue() { return ctx().getNotificationToastQueue(); }
function getLastSoundPlayAt() { return ctx().getLastSoundPlayAt(); }
function setLastSoundPlayAt(value) { ctx().setLastSoundPlayAt(value); }
function getPreviousRunnerStateForNotifs() { return ctx().getPreviousRunnerStateForNotifs(); }
function setTerminalStatusNotified(role, value) { ctx().setTerminalStatusNotified(role, value); }

const MAX_ENTRIES = 200;
const LEADER_TTL_MS = 30000;
const LEADER_HEARTBEAT_MS = 10000;
const NOTIFICATION_LOG_KEY_PREFIX = 'whatsagent.notification.log';
const NOTIFICATION_PREFS_KEY = 'whatsagent.notification.preferences';
const NOTIFICATION_LEADER_KEY_PREFIX = 'whatsagent.notification.leader';
const TOAST_AUTO_DISMISS_MS = 6000;
const TOAST_MAX_VISIBLE = 3;
const DEFAULT_PREFS_V3 = {"version":3,"enabled":true,"browserEnabled":true,"toastEnabled":true,"defaultSound":"Chime","soundThrottle":"standard","events":{"new_message":{"browser":true,"toast":true,"sound":"Default"},"runner_exit":{"browser":true,"toast":true,"sound":"Default"},"approval_waiting":{"browser":true,"toast":true,"sound":"Default"},"codex_nudge_blocked":{"browser":true,"toast":true,"sound":"Default"},"codex_inbox_pending":{"browser":true,"toast":true,"sound":"Default"},"launch_failure":{"browser":true,"toast":true,"sound":"Default"}}};

function ledgerInsert(log, event) {
  for (const existing of log.events)
    if (existing.dedupKey === event.dedupKey) {
      existing.ts = event.ts;
      existing.body = event.body;
      existing.title = event.title;
      existing.read = false;
      return false;
    }
  log.events.unshift(event);
  while (log.events.length > 200)
    log.events.pop();
  return true;
}

function parseLogSafe(raw) {
  function isValid(e) {
    if (!e || typeof e !== "object") return false;
    const ev = e;
    return typeof ev.id === "string" && typeof ev.dedupKey === "string" && typeof ev.ts === "number" && typeof ev.kind === "string" && typeof ev.title === "string" && typeof ev.body === "string" && typeof ev.read === "boolean";
  }
  let parsed = raw;
  if (typeof parsed === "string") try { parsed = JSON.parse(parsed); } catch { parsed = null; }
  if (!parsed || typeof parsed !== "object") return { version: 1, events: [], lastReadAt: 0 };
  const obj = parsed;
  if (obj.version !== 1) return { version: 1, events: [], lastReadAt: 0 };
  const events = Array.isArray(obj.events) ? obj.events.filter(isValid).slice(0, 200) : [];
  const lastReadAt = typeof obj.lastReadAt === "number" ? obj.lastReadAt : 0;
  return { version: 1, events, lastReadAt };
}

function migratePrefsV2ToV3(rawNotif, rawUiPrefs) {
  const ALL_KINDS = ["new_message", "runner_exit", "approval_waiting", "codex_nudge_blocked", "codex_inbox_pending", "launch_failure"];
  const VALID_SOUNDS = ["Chime", "Pulse", "Signal", "Tap", "Off"];
  const VALID_EVENT_SOUNDS = ["Default", ...VALID_SOUNDS];
  function asSoundName(value, fallback) { return VALID_SOUNDS.indexOf(value) >= 0 ? value : fallback; }
  function asEventSoundName(value) { return VALID_EVENT_SOUNDS.indexOf(value) >= 0 ? value : "Default"; }
  function asThrottle(value) { return value === "short" || value === "long" ? value : "standard"; }
  const fromV2 = {
    new_message: rawUiPrefs.notifyMessages !== false,
    runner_exit: rawUiPrefs.notifyRunnerExits !== false,
    approval_waiting: rawNotif.approvalWaiting !== false,
    codex_nudge_blocked: rawNotif.nudgeBlocked !== false,
    codex_inbox_pending: rawNotif.codexInboxPending !== false,
    launch_failure: rawNotif.launchFailures !== false,
  };
  const inputEvents = rawNotif.events && typeof rawNotif.events === "object" ? rawNotif.events : {};
  const events = {};
  for (const kind of ALL_KINDS) {
    const v2on = fromV2[kind] ?? true;
    const v3 = inputEvents[kind];
    events[kind] = {
      browser: typeof v3?.browser === "boolean" ? v3.browser : v2on,
      toast: typeof v3?.toast === "boolean" ? v3.toast : v2on,
      sound: asEventSoundName(v3?.sound),
    };
  }
  return {
    version: 3,
    enabled: rawNotif.enabled !== false,
    browserEnabled: rawNotif.browserEnabled !== false,
    toastEnabled: rawNotif.toastEnabled !== false,
    defaultSound: asSoundName(rawNotif.defaultSound, "Chime"),
    soundThrottle: asThrottle(rawNotif.soundThrottle),
    events,
  };
}

function isLeaderTab(record, ourTabId, now) {
  if (!record) return true;
  if (now - record.ts > 30000) return true;
  return record.tabId === ourTabId;
}

function shouldFire(channel, kind, prefs) {
  if (channel === "browser" && !prefs.browserEnabled) return false;
  if (channel === "toast" && !prefs.toastEnabled) return false;
  if (channel === "sound" && !prefs.enabled) return false;
  if (channel === "sound") {
    const sound = prefs.events[kind].sound;
    return sound === "Default" ? prefs.defaultSound !== "Off" : sound !== "Off";
  }
  return prefs.events[kind][channel];
}

function truncate(value, limit) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? text.slice(0, limit - 3) + "…" : text;
}

function buildEventForMessage(msg) {
  return { kind: "new_message", title: (msg.from_role_name ?? "?") + " -> " + (msg.to_role_name ?? "?"), body: truncate(msg.body, 180), role: msg.from_role_name, link: { page: "messages", inbox: msg.to_role_name, peer: msg.from_role_name, messageId: msg.id }, dedupKey: "new_message:" + msg.id };
}
// EP-DEC-RUN WA-006 (advisor msg #28): notification role + link + dedup
// keys use display_id (`repo:role`) so duplicate same-bare-name runners
// surface independent notifications and click through to the right agent.
function runnerAddr(runner) { return runner.display_id || runner.role; }
function buildEventForRunnerExit(runner) {
  const detail = runner.exit_code != null ? "exit code " + runner.exit_code : runner.exit_signal ? "signal " + runner.exit_signal : "offline";
  const addr = runnerAddr(runner);
  return { kind: "runner_exit", title: "Agent exited: " + addr, body: detail, role: addr, link: { page: "agents", role: addr }, dedupKey: "runner_exit:" + addr + ":" + (runner.session_id ?? "") };
}
function buildEventForApprovalWaiting(runner) {
  const at = runner.attention?.approval_waiting?.at ?? "";
  const addr = runnerAddr(runner);
  return { kind: "approval_waiting", title: "Approval waiting: " + addr, body: "The background TUI appears to be waiting for permission approval.", role: addr, link: { page: "agents", role: addr }, dedupKey: "approval_waiting:" + addr + ":" + at };
}
function buildEventForCodexNudgeBlocked(runner) {
  const queued = runner.pending_nudge?.queued_at ?? "";
  const addr = runnerAddr(runner);
  return { kind: "codex_nudge_blocked", title: "Inbox waiting: " + addr, body: "A Codex draft is delaying the check_messages nudge.", role: addr, link: { page: "agents", role: addr }, dedupKey: "codex_nudge_blocked:" + addr + ":" + queued };
}
function buildEventForCodexInboxPending(runner) {
  const queued = runner.pending_nudge?.queued_at ?? "";
  const addr = runnerAddr(runner);
  return { kind: "codex_inbox_pending", title: "Inbox queued: " + addr, body: "New inbox waiting for " + addr + ".", role: addr, link: { page: "agents", role: addr }, dedupKey: "codex_inbox_pending:" + addr + ":" + queued };
}
function buildEventForLaunchFailure(role, message, ts) {
  return { kind: "launch_failure", title: "Launch failed: " + role, body: truncate(message, 180), role, link: { page: "agents", role }, dedupKey: "launch_failure:" + role + ":" + ts };
}

function activeWsIdForKeys() {
  const state = getState();
  return state.nextWorkspace?.id || state.currentWorkspace?.id || 'no-workspace';
}
function notificationLogKey(id = activeWsIdForKeys()) {
  return NOTIFICATION_LOG_KEY_PREFIX + ':' + (id || 'no-workspace');
}
function notificationLeaderKey(id = activeWsIdForKeys()) {
  return NOTIFICATION_LEADER_KEY_PREFIX + ':' + (id || 'no-workspace');
}
function loadLog(id) {
  try { return parseLogSafe(localStorage.getItem(notificationLogKey(id)) || ''); }
  catch { return { version: 1, events: [], lastReadAt: 0 }; }
}
function saveLog() {
  try { localStorage.setItem(notificationLogKey(), JSON.stringify(getNotificationLog())); } catch {}
}
function loadPrefs() {
  let rawNotif = {};
  let rawUiPrefs = {};
  try { rawNotif = JSON.parse(localStorage.getItem(NOTIFICATION_PREFS_KEY) || '{}') || {}; } catch {}
  try { rawUiPrefs = JSON.parse(localStorage.getItem('whatsagent.ui.preferences') || '{}') || {}; } catch {}
  return migratePrefsV2ToV3(rawNotif, rawUiPrefs);
}
function savePrefs() {
  try { localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(getNotificationPrefs())); } catch {}
}

function makeEventId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

function notify(event, options) {
  options = options || {};
  const log = getNotificationLog();
  const enriched = Object.assign({}, event, { id: makeEventId(), ts: Date.now(), read: false });
  const inserted = ledgerInsert(log, enriched);
  if (!inserted) return;
  if (!options.silent) fanout(enriched);
  saveLog();
  refreshBadge();
  if (getNotificationPopoverOpen()) renderNotificationPopover();
}

function fanout(event) {
  const prefs = getNotificationPrefs();
  if (shouldFire('toast', event.kind, prefs) && shouldFireToast(event)) enqueueToast(event);
  if (shouldFire('browser', event.kind, prefs) && shouldFireBrowser(event)) fireBrowserPopup(event);
  if (shouldFire('sound', event.kind, prefs)) playSound(resolveEventSound(prefs.events[event.kind].sound));
}

function shouldFireBrowser(event) {
  return document.visibilityState !== 'visible' || !document.hasFocus();
}

let pendingBrowserMessageBatch = [];
let pendingBatchScheduled = false;

function fireBrowserPopup(event) {
  if (typeof Notification !== 'function' || !window.isSecureContext || Notification.permission !== 'granted') return;
  if (event.kind === 'new_message') {
    pendingBrowserMessageBatch.push(event);
    if (!pendingBatchScheduled) { pendingBatchScheduled = true; queueMicrotask(flushBrowserMessageBatch); }
    return;
  }
  firePopupSingle(event);
}
function flushBrowserMessageBatch() {
  pendingBatchScheduled = false;
  const batch = pendingBrowserMessageBatch;
  pendingBrowserMessageBatch = [];
  if (batch.length === 0) return;
  if (batch.length === 1) { firePopupSingle(batch[0]); return; }
  try {
    const notif = new Notification(batch.length + ' new WhatsAgent messages', { body: batch.slice(0, 5).map(e => e.title).join('\n'), tag: 'whatsagent-messages' });
    notif.onclick = () => window.focus();
    setTimeout(() => notif.close(), 8000);
  } catch {}
}
function firePopupSingle(event) {
  try {
    const notif = new Notification('WhatsAgent: ' + event.title, { body: event.body, tag: 'whatsagent-' + event.kind + '-' + (event.role || '') + '-' + event.id });
    notif.onclick = () => { window.focus(); handleEntryClick(event); };
    setTimeout(() => notif.close(), 8000);
  } catch {}
}

function shouldFireToast(event) {
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return false;
  if (getNotificationPopoverOpen()) return false;
  if (event.link?.page === 'agents' && getActiveTerminal() === event.link.role && getPage() === 'agents') return false;
  if (event.link?.page === 'messages' && getPage() === 'messages' && getSelectedThread() === event.link.inbox && getSelectedPeer() === event.link.peer) return false;
  return true;
}

function enqueueToast(event) {
  const queue = getNotificationToastQueue();
  queue.push({ id: event.id, event, expiresAt: Date.now() + TOAST_AUTO_DISMISS_MS, paused: false, remainingMs: TOAST_AUTO_DISMISS_MS });
  renderToasts();
  scheduleToastPrune();
}
function renderToasts() {
  const stack = document.getElementById('notificationToastStack');
  if (!stack) return;
  const queue = getNotificationToastQueue();
  while (queue.length > TOAST_MAX_VISIBLE) queue.shift();
  stack.innerHTML = queue.map(renderToast).join('');
  for (const t of queue) attachToastHover(t);
}
function renderToast(t) {
  return '<div class="notification-toast" role="status" data-toast-id="' + escapeHtml(t.id) + '">'
    + '<div class="notification-toast-title">' + escapeHtml(t.event.title) + '</div>'
    + '<div class="notification-toast-body">' + escapeHtml(t.event.body) + '</div>'
    + '<div class="notification-toast-actions">'
    +   '<button class="btn secondary small notification-toast-action" data-action="open-toast" data-toast-id="' + escapeHtml(t.id) + '">Open</button>'
    +   '<button class="btn secondary small notification-toast-action" data-action="dismiss-toast" data-toast-id="' + escapeHtml(t.id) + '" aria-label="Dismiss">×</button>'
    + '</div>'
    + '</div>';
}
function attachToastHover(t) {
  const els = document.querySelectorAll('.notification-toast');
  let el = null;
  for (const candidate of els) { if (candidate.dataset.toastId === t.id) { el = candidate; break; } }
  if (!el) return;
  el.addEventListener('mouseenter', () => { t.paused = true; t.remainingMs = t.expiresAt - Date.now(); });
  el.addEventListener('mouseleave', () => {
    t.paused = false;
    const fullResume = (t.remainingMs ?? 0) >= 4000;
    t.expiresAt = Date.now() + (fullResume ? TOAST_AUTO_DISMISS_MS : (t.remainingMs ?? 0));
    scheduleToastPrune();
  });
}
let toastPruneTimer = null;
function scheduleToastPrune() {
  if (toastPruneTimer) return;
  toastPruneTimer = setTimeout(pruneToasts, 250);
}
function pruneToasts() {
  toastPruneTimer = null;
  const now = Date.now();
  const queue = getNotificationToastQueue();
  const before = queue.length;
  for (let i = queue.length - 1; i >= 0; i--) {
    const t = queue[i];
    if (!t.paused && t.expiresAt <= now) queue.splice(i, 1);
  }
  if (queue.length !== before) renderToasts();
  if (queue.length > 0) scheduleToastPrune();
}
function dismissToast(id) {
  const queue = getNotificationToastQueue();
  const idx = queue.findIndex(t => t.id === id);
  if (idx >= 0) queue.splice(idx, 1);
  renderToasts();
}

function refreshBadge() {
  const badge = document.getElementById('notificationBadge');
  if (!badge) return;
  const log = getNotificationLog();
  const unread = log.events.filter(e => !e.read).length;
  if (unread === 0) {
    badge.hidden = true;
    badge.textContent = '0';
  } else {
    badge.hidden = false;
    badge.textContent = unread > 9 ? '9+' : String(unread);
  }
}

function loadLeaderRecord() {
  try {
    const raw = localStorage.getItem(notificationLeaderKey());
    if (!raw) return null;
    const rec = JSON.parse(raw);
    if (rec && typeof rec.tabId === 'string' && typeof rec.ts === 'number') return rec;
    return null;
  } catch { return null; }
}
function claimLeadership() {
  try { localStorage.setItem(notificationLeaderKey(), JSON.stringify({ tabId: getTabId(), ts: Date.now() })); } catch {}
}
function ourTabIsLeader() {
  return isLeaderTab(loadLeaderRecord(), getTabId(), Date.now());
}

const audioCache = {};
function throttleMs() {
  switch (getNotificationPrefs().soundThrottle) {
    case 'short':    return 100;
    case 'long':     return 500;
    default:         return 250;
  }
}
function resolveEventSound(name) {
  return name === 'Default' ? getNotificationPrefs().defaultSound : name;
}
function playSound(name) {
  if (!name || name === 'Off') return;
  if (!getNotificationPrefs().enabled) return;
  if (!ourTabIsLeader()) return;
  claimLeadership();
  const now = Date.now();
  if (now - getLastSoundPlayAt() < throttleMs()) return;
  let audio = audioCache[name];
  if (!audio) { audio = new Audio('/assets/sounds/' + name + '.wav'); audio.preload = 'auto'; audioCache[name] = audio; }
  try { audio.currentTime = 0; audio.play().catch(() => {}); } catch {}
  setLastSoundPlayAt(now);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[ch]));
}
function notificationPillToggle(isOn, action, attrs, label) {
  const attrText = Object.entries(attrs || {}).map(([k, v]) => 'data-' + k + '="' + escapeHtml(v) + '"').join(' ');
  return '<button type="button" class="notification-pill-toggle ' + (isOn ? 'on' : 'off') + '" data-action="' + action + '" aria-pressed="' + (isOn ? 'true' : 'false') + '" aria-label="' + escapeHtml(label + ': ' + (isOn ? 'On' : 'Off')) + '" ' + attrText + '>'
    + '<span class="notification-pill-track"><span class="notification-pill-knob"></span></span>'
    + '<span class="notification-pill-state">' + (isOn ? 'On' : 'Off') + '</span>'
    + '</button>';
}

const SOUND_OPTIONS = ['Off', 'Chime', 'Pulse', 'Signal', 'Tap'].map(o => [o, o]);
const EVENT_SOUND_OPTIONS = [['Default', 'Use default'], ...SOUND_OPTIONS];

function notificationSoundDropdown(name, currentValue, inputAttrs, options) {
  const choices = options || SOUND_OPTIONS;
  return settingsDropdown(name, currentValue, choices, { inputAttrs, className: 'notification-sound-dropdown' });
}

let notificationClearReturnFocus = null;
function ensureNotificationClearModal() {
  let modal = document.getElementById('notificationClearModal');
  if (modal) return modal;
  document.body.insertAdjacentHTML('beforeend',
    '<div id="notificationClearModal" class="modal-backdrop hidden notification-clear-modal-backdrop">'
    + '<div class="modal notification-clear-modal" role="dialog" aria-modal="true" aria-labelledby="notificationClearModalTitle">'
    + '<div class="modal-title" id="notificationClearModalTitle">Clear notifications?</div>'
    + '<div class="modal-sub">Clear notification history? This cannot be undone.</div>'
    + '<div class="modal-actions">'
    + '<button type="button" class="btn secondary" data-action="cancel-clear-notifications">Cancel</button>'
    + '<button type="button" class="btn danger" data-action="confirm-clear-notifications">Clear all</button>'
    + '</div></div></div>'
  );
  modal = document.getElementById('notificationClearModal');
  modal.addEventListener('click', e => { if (e.target === modal) closeNotificationClearModal(); });
  return modal;
}
function openNotificationClearModal(trigger) {
  const log = getNotificationLog();
  if (log.events.length === 0) return;
  notificationClearReturnFocus = trigger || document.activeElement;
  const modal = ensureNotificationClearModal();
  modal.classList.remove('hidden');
  modal.querySelector('[data-action="cancel-clear-notifications"]')?.focus?.();
}
function closeNotificationClearModal() {
  const modal = document.getElementById('notificationClearModal');
  if (modal) modal.classList.add('hidden');
  notificationClearReturnFocus?.focus?.();
  notificationClearReturnFocus = null;
}
function clearNotificationsConfirmed() {
  const log = getNotificationLog();
  log.events = [];
  saveLog();
  refreshBadge();
  if (getNotificationPopoverOpen()) renderNotificationPopover();
  if (getPage() === 'settings') ctx().renderSettings();
  closeNotificationClearModal();
}

function formatRelativeTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderNotificationPopover() {
  const el = document.getElementById('notificationPopover');
  if (!el) return;
  const log = getNotificationLog();
  const prefs = getNotificationPrefs();
  const unread = log.events.filter(e => !e.read).length;
  const entriesHtml = log.events.length === 0
    ? '<div class="notification-popover-empty">No notifications yet.</div>'
    : log.events.map(renderEntry).join('');
  el.innerHTML = ''
    + '<div class="notification-popover-header">'
    +   '<h3>Notifications</h3>'
    +   '<button class="btn secondary small" data-action="open-notification-settings" aria-label="Open Notification Settings">Settings</button>'
    +   '<button class="btn secondary small" data-action="request-clear-notifications" aria-label="Clear all notifications">Clear all</button>'
    +   '<button class="btn secondary small" data-action="close-notifications" aria-label="Close">\xd7</button>'
    + '</div>'
    + '<div class="notification-popover-mute-row">'
    +   '<span class="notification-mute-label">Sound</span>'
    +   notificationPillToggle(prefs.enabled, 'toggle-sound-master', {}, 'Sound')
    + '</div>'
    + '<div class="notification-popover-list" role="list">' + entriesHtml + '</div>'
    + '<div class="notification-popover-footer">'
    +   '<button class="btn secondary small" data-action="mark-all-read" ' + (unread === 0 ? 'disabled' : '') + '>Mark all read</button>'
    + '</div>';
}
function renderEntry(e) {
  const time = formatRelativeTime(e.ts);
  const cls = 'notification-entry ' + (e.read ? '' : 'unread');
  return '<div class="' + cls + '" data-action="open-notification-entry" data-event-id="' + escapeHtml(e.id) + '" role="listitem">'
    + '<div class="notification-entry-meta">' + escapeHtml(time) + (e.role ? ' \xb7 ' + escapeHtml(e.role) : '') + '</div>'
    + '<div class="notification-entry-title">' + escapeHtml(e.title) + '</div>'
    + '<div class="notification-entry-body">' + escapeHtml(e.body) + '</div>'
    + '</div>';
}
function openNotificationPopover() {
  const el = document.getElementById('notificationPopover');
  const btn = document.getElementById('notificationBtn');
  if (!el || !btn) return;
  setNotificationPopoverOpen(true);
  renderNotificationPopover();
  const rect = btn.getBoundingClientRect();
  el.style.left = (rect.right + 8) + 'px';
  el.style.bottom = (window.innerHeight - rect.bottom + 8) + 'px';
  el.style.top = '';
  el.hidden = false;
  el.classList.remove('hidden');
  btn.setAttribute('aria-expanded', 'true');
  const log = getNotificationLog();
  log.lastReadAt = Date.now();
  for (const ev of log.events) ev.read = true;
  saveLog();
  refreshBadge();
  renderNotificationPopover();
  setTimeout(() => {
    document.addEventListener('click', notificationOutsideClickHandler, true);
    document.addEventListener('keydown', notificationEscHandler, true);
  }, 0);
}
function closeNotificationPopover() {
  const el = document.getElementById('notificationPopover');
  const btn = document.getElementById('notificationBtn');
  setNotificationPopoverOpen(false);
  if (el) { el.hidden = true; el.classList.add('hidden'); }
  if (btn) btn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('click', notificationOutsideClickHandler, true);
  document.removeEventListener('keydown', notificationEscHandler, true);
}
function notificationOutsideClickHandler(e) {
  const el = document.getElementById('notificationPopover');
  const btn = document.getElementById('notificationBtn');
  if (!el || !btn) return;
  if (el.contains(e.target) || btn.contains(e.target)) return;
  closeNotificationPopover();
}
function notificationEscHandler(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeNotificationPopover(); }
}
function handleEntryClick(ev) {
  if (!ev.link) return;
  if (ev.link.page === 'messages') {
    const url = '/messages/' + encodeURIComponent(ev.link.inbox || '') + (ev.link.peer ? '/' + encodeURIComponent(ev.link.peer) : '');
    window.location.href = url;
  } else if (ev.link.page === 'agents') {
    const url = '/agents' + (ev.link.role ? '/' + encodeURIComponent(ev.link.role) : '');
    window.location.href = url;
  }
}

function renderNotificationSettingsPanel() {
  const supported = typeof Notification === 'function';
  const permission = supported ? Notification.permission : 'unsupported';
  const origin = location.origin + ' · secure=' + (window.isSecureContext ? 'yes' : 'no');
  const enableLabel = permission === 'granted' ? 'Permission Granted' : 'Enable';
  const prefs = getNotificationPrefs();
  const log = getNotificationLog();
  const eventRows = [
    ['new_message', 'New messages', 'When an agent sends a message.'],
    ['runner_exit', 'Runner exits', 'When a live agent session exits.'],
    ['approval_waiting', 'Approval waiting', 'When a TUI is waiting on permission approval.'],
    ['codex_nudge_blocked', 'Codex nudge blocked', 'When a Codex draft delays a check_messages nudge.'],
    ['codex_inbox_pending', 'Codex inbox queued', 'When a Codex agent has a fresh check_messages nudge.'],
    ['launch_failure', 'Launch failures', 'When launching an agent fails.'],
  ];
  function seg(label, value, currentValue, action, ds) {
    const dsAttrs = Object.entries(ds || {}).map(([k,v]) => 'data-' + k + '="' + escapeHtml(v) + '"').join(' ');
    return '<button class="seg-option ' + (String(currentValue) === String(value) ? 'active' : '') + '" data-action="' + action + '" data-value="' + escapeHtml(value) + '" ' + dsAttrs + '>' + escapeHtml(label) + '</button>';
  }
  function statusValue(value, mono) {
    return '<div class="' + (mono ? 'notification-status-value mono' : 'notification-status-value') + '">' + escapeHtml(value) + '</div>';
  }
  const channelMastersHtml = ''
    + '<h3 class="notification-settings-heading">Channels</h3>'
    + settingRow('Browser popups', 'Show OS-level popups when WhatsAgent is not focused.', notificationPillToggle(prefs.browserEnabled, 'toggle-channel-master', { channel: 'browserEnabled' }, 'Browser popups'))
    + settingRow('In-page toasts', 'Show toasts at the bottom-left while WhatsAgent is open.', notificationPillToggle(prefs.toastEnabled, 'toggle-channel-master', { channel: 'toastEnabled' }, 'In-page toasts'))
    + settingRow('Sound', 'Play a short local sound for notification events.', notificationPillToggle(prefs.enabled, 'toggle-channel-master', { channel: 'enabled' }, 'Sound'))
    + settingRow('Default sound', 'Used by event preferences set to Use default.', notificationSoundDropdown('Default sound', prefs.defaultSound, 'data-notification-default-sound'))
    + settingRow('Throttle', 'Rate-limit sound playback across rapid events.', '<div class="segmented">'
    +   seg('Short', 'short', prefs.soundThrottle, 'set-throttle', {})
    +   seg('Standard', 'standard', prefs.soundThrottle, 'set-throttle', {})
    +   seg('Long', 'long', prefs.soundThrottle, 'set-throttle', {})
    + '</div>');
  const perEventRowsHtml = '<h3 class="notification-settings-heading">Per-event</h3>'
    + '<div class="notification-event-list">'
    + '<div class="notification-event-row notification-event-header-row">'
    + '<div class="notification-event-header notification-event-name-header">Event</div>'
    + '<div class="notification-event-controls notification-event-controls-header">'
    + '<div class="notification-event-header">Browser</div>'
    + '<div class="notification-event-header">Toast</div>'
    + '<div class="notification-event-header">Sound</div>'
    + '</div>'
    + '</div>'
    + eventRows.map(row => {
      const kind = row[0]; const label = row[1]; const desc = row[2];
      const ev = prefs.events[kind];
      return '<div class="notification-event-row">'
        + '<div class="notification-event-name">'
        + '<span class="setting-title">' + escapeHtml(label) + '</span>'
        + '<span class="setting-sub">' + escapeHtml(desc) + '</span>'
        + '</div>'
        + '<div class="notification-event-controls">'
        + '<div class="notification-channel-control">' + notificationPillToggle(ev.browser, 'toggle-event-channel', { kind, channel: 'browser' }, label + ' browser') + '</div>'
        + '<div class="notification-channel-control">' + notificationPillToggle(ev.toast, 'toggle-event-channel', { kind, channel: 'toast' }, label + ' toast') + '</div>'
        + '<div class="notification-channel-control">' + notificationSoundDropdown(label + ' sound', ev.sound, 'data-notification-event-sound="' + escapeHtml(kind) + '"', EVENT_SOUND_OPTIONS) + '</div>'
        + '</div>'
        + '</div>';
    }).join('')
    + '</div>';
  const status = supported && !window.isSecureContext ? 'Browser notifications require HTTPS or localhost.' : '';
  return '<section class="card card-pad settings-wide notification-settings">'
    + '<div class="section-head"><div><h2>Notifications</h2><p>Browser permission, channels, per-event filters, and history.</p></div>'
    + '<div class="agent-text-actions"><button class="btn secondary small" data-action="enable-notifications" ' + (permission === 'granted' ? 'disabled' : '') + '>' + enableLabel + '</button><button class="btn secondary small" data-action="test-notification">Send Test</button></div></div>'
    + (status ? '<div class="agent-text-status">' + escapeHtml(status) + '</div>' : '')
    + '<h3 class="notification-settings-heading">Status</h3>'
    + settingRow('Browser permission', 'Current browser permission state.', statusValue(permission, true))
    + settingRow('Secure context', 'Browser requirement for OS-level popups.', statusValue(window.isSecureContext ? 'yes' : 'no', true))
    + settingRow('Origin', 'Permission scope.', statusValue(origin, true))
    + settingRow('WhatsAgent sound', 'Local sound master state.', statusValue(prefs.enabled ? 'enabled' : 'muted', false))
    + settingRow('History stored', 'Stored events.', statusValue(log.events.length + ' / ' + MAX_ENTRIES, true))
    + channelMastersHtml
    + perEventRowsHtml
    + '<h3 class="notification-settings-heading">History</h3>'
    + settingRow('Notification history', 'Clears notification history.', '<button class="btn danger small" data-action="request-clear-notifications">Clear notification history</button>')
    + '</section>';
}

async function requestPermissionV2() {
  if (typeof Notification !== 'function') return;
  if (Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch {}
  }
  ctx().updateNotificationButtonViaCurrent();
  if (getPage() === 'settings') ctx().renderSettings();
}
function sendTestV2() {
  const prefs = getNotificationPrefs();
  if (prefs.toastEnabled) {
    enqueueToast({ id: 'test-' + Date.now(), kind: 'launch_failure', ts: Date.now(), title: 'WhatsAgent test', body: 'In-page toast is working.', read: true, dedupKey: 'test', link: null });
  }
  if (prefs.browserEnabled && typeof Notification === 'function' && Notification.permission === 'granted') {
    try { const n = new Notification('WhatsAgent test', { body: 'Browser popup is working.', tag: 'whatsagent-test-' + Date.now() }); setTimeout(() => n.close(), 4000); } catch {}
  }
  if (prefs.enabled) playSound(prefs.defaultSound);
}

export function handleTerminalAttentionNotification(role, attention) {
  const approval = attention?.approval_waiting;
  if (!role || !approval?.at) return;
  const key = 'approval:' + role;
  const prevState = getPreviousRunnerStateForNotifs();
  if (prevState[key]?.at === approval.at) return;
  prevState[key] = { at: approval.at };
  notify(buildEventForApprovalWaiting({ role, attention }));
}

let _delegationInstalled = false;

export function installNotifications(c) {
  _ctx = c;
  if (_delegationInstalled) return;
  _delegationInstalled = true;

  window.__notificationsV2 = true;

  setNotificationLog(loadLog());
  setNotificationPrefs(loadPrefs());

  c.registerResetHook((targetId) => {
    setNotificationLog(loadLog(targetId));
    setNotificationPopoverOpen(false);
    getNotificationToastQueue().length = 0;
    refreshBadge();
  });

  window.__notifyV2 = notify;
  window.__handleRunnerAttentionNotification = handleTerminalAttentionNotification;

  // Wrap notifyNewMessages
  const baseNotifyNewMessages = c.getNotifyNewMessages();
  c.setNotifyNewMessages(function notifyNewMessagesV2(newMessages) {
    try { baseNotifyNewMessages(newMessages); } catch {}
    if (!Array.isArray(newMessages)) return;
    const pending = newMessages.filter(m => m && m.state === 'pending' && m.from_role_name);
    for (const msg of pending) notify(buildEventForMessage(msg));
  });

  // Wrap notifyRunnerExits
  const baseNotifyRunnerExits = c.getNotifyRunnerExits();
  c.setNotifyRunnerExits(function notifyRunnerExitsV2(nextRunners, previousRunners) {
    try { baseNotifyRunnerExits(nextRunners, previousRunners); } catch {}
    if (!Array.isArray(nextRunners)) return;
    // EP-DEC-RUN WA-006 (advisor msg #28): key V2 notification state by
    // display_id (`repo:role`) so two same-bare-name runners do not
    // suppress / misattribute each other's exit / approval / nudge events.
    const addrOf = (r) => r.display_id || r.role;
    const previousByAddr = new Map();
    const previousBySession = new Map();
    for (const r of (previousRunners || [])) {
      previousByAddr.set(addrOf(r), r);
      previousBySession.set(addrOf(r) + ':' + r.session_id, r);
    }
    const prevState = getPreviousRunnerStateForNotifs();
    for (const runner of nextRunners) {
      const addr = addrOf(runner);
      const prev = previousBySession.get(addr + ':' + runner.session_id);
      if (!runner.reachable && (prev?.reachable || runner.status === 'exited')) {
        const key = addr + ':' + runner.session_id;
        if (!prevState[key] || !prevState[key].exited) {
          prevState[key] = { exited: true };
          notify(buildEventForRunnerExit(runner));
        }
      }
      const prevByRoleEntry = previousByAddr.get(addr);
      const curApproval = runner.attention?.approval_waiting;
      const prevApproval = prevByRoleEntry?.attention?.approval_waiting;
      if (curApproval && curApproval.at && curApproval.at !== prevApproval?.at) {
        const approvalKey = 'approval:' + addr;
        if (prevState[approvalKey]?.at !== curApproval.at) {
          prevState[approvalKey] = { at: curApproval.at };
          notify(buildEventForApprovalWaiting(runner));
        }
      }
      if (runner.host_type === 'codex') {
        const cur = runner.pending_nudge;
        const prevNudge = prevByRoleEntry?.pending_nudge;
        if (cur?.blocked_by_draft && (!prevNudge?.blocked_by_draft || prevNudge?.queued_at !== cur.queued_at)) {
          notify(buildEventForCodexNudgeBlocked(runner));
        }
        if (cur?.queued_at && !cur.blocked_by_draft && prevNudge?.queued_at !== cur.queued_at) {
          notify(buildEventForCodexInboxPending(runner));
        }
      }
    }
  });

  // Wrap settingsPanel: notifications tab uses our renderer
  const baseSettingsPanel = c.getSettingsPanel();
  c.setSettingsPanel(function settingsPanelV2(cfg) {
    if (getSelectedSettingsTab() === 'notifications') return renderNotificationSettingsPanel();
    return baseSettingsPanel(cfg);
  });

  // Wrap updateNotificationButton: keep base + refreshBadge
  const baseUpdateNotificationButton = c.getUpdateNotificationButton();
  c.setUpdateNotificationButton(function updateNotificationButtonV2() {
    try { baseUpdateNotificationButton(); } catch {}
    refreshBadge();
  });

  // Repurpose enableNotifications as silent permission-request
  c.setEnableNotifications(async function enableNotificationsV2() {
    requestPermissionV2();
  });

  // Wrap launch with failure-notify
  const baseLaunch = c.getLaunch();
  c.setLaunch(async function launchV2(role, hostOverride) {
    const targetRole = role || getSelectedLaunchRole() || document.getElementById('launchRole')?.value || '';
    if (!targetRole) return;
    const host = hostOverride || (role ? 'default' : (getSelectedLaunchHost() || 'default'));
    // EP-DEC-RUN WA-006: UUID-keyed route. Legacy /roles/:name/launch
    // is now 410; if state lacks the row, surface an explicit failure
    // rather than firing into a dead URL.
    // EP-DEC-RUN WA-006 (advisor msg #28): resolve via display_id /
    // bare-name lookup, then carry the displayId through every state /
    // failure path. Terminal/attention state keys are displayId.
    const target = (getState().roles || []).find((r) => r.name === targetRole || `${r.repo_name || ''}:${r.name}` === targetRole || r.display_id === targetRole || r.displayId === targetRole);
    if (!target?.id) {
      return baseLaunch ? baseLaunch(role, hostOverride) : undefined;
    }
    const targetDisplayId = target.display_id || target.displayId || `${target.repo_name || ''}:${target.name}`;
    const url = '/roles-by-id/' + encodeURIComponent(target.id) + '/launch';
    const res = await workspaceFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host }),
    }).then(async r => ({ ok: r.ok, body: await r.json().catch(() => ({})) })).catch(e => ({ ok: false, body: { error: String(e?.message || e) } }));
    setTerminalStatusNotified(targetDisplayId, '');
    clearAttention(targetDisplayId);
    setOpenLaunchMenuRole('');
    setActiveTerminal(targetDisplayId);
    setPage('agents');
    document.getElementById('launchModal')?.classList.add('hidden');
    await refresh();
    if (!res.ok || res.body?.ok === false) {
      const message = res.body?.message || res.body?.error || JSON.stringify(res.body, null, 2);
      notify(buildEventForLaunchFailure(targetDisplayId, message, Date.now()));
      appendTerminal(targetDisplayId, '\\n' + message + '\\n', 'status');
    }
    scheduleTerminalPoll();
  });

  // Leader-tab election
  window.addEventListener('focus', claimLeadership);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) claimLeadership(); });
  setInterval(() => { if (document.hasFocus()) claimLeadership(); }, LEADER_HEARTBEAT_MS);
  (function bootClaim() {
    const rec = loadLeaderRecord();
    if (!rec || (Date.now() - rec.ts) > LEADER_TTL_MS) claimLeadership();
  })();

  // Toast click handlers (capture phase)
  document.addEventListener('click', e => {
    const target = e.target?.closest?.('[data-action][data-toast-id]');
    if (!target) return;
    const id = target.dataset.toastId;
    const action = target.dataset.action;
    if (action === 'dismiss-toast') {
      e.preventDefault(); e.stopImmediatePropagation();
      dismissToast(id);
    } else if (action === 'open-toast') {
      e.preventDefault(); e.stopImmediatePropagation();
      const queue = getNotificationToastQueue();
      const t = queue.find(x => x.id === id);
      if (t) handleEntryClick(t.event);
      dismissToast(id);
    }
  }, true);

  // Popover/notification action click handlers (capture phase)
  document.addEventListener('click', e => {
    const target = e.target?.closest?.('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'toggle-notifications-popover') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (getNotificationPopoverOpen()) closeNotificationPopover();
      else openNotificationPopover();
    } else if (action === 'close-notifications') {
      e.preventDefault(); e.stopImmediatePropagation();
      closeNotificationPopover();
    } else if (action === 'mark-all-read') {
      e.preventDefault(); e.stopImmediatePropagation();
      const log = getNotificationLog();
      for (const ev of log.events) ev.read = true;
      log.lastReadAt = Date.now();
      saveLog();
      refreshBadge();
      renderNotificationPopover();
    } else if (action === 'request-clear-notifications') {
      e.preventDefault(); e.stopImmediatePropagation();
      openNotificationClearModal(target);
    } else if (action === 'toggle-sound-master') {
      e.preventDefault(); e.stopImmediatePropagation();
      const prefs = getNotificationPrefs();
      prefs.enabled = !prefs.enabled;
      savePrefs();
      refreshBadge();
      renderNotificationPopover();
    } else if (action === 'cancel-clear-notifications') {
      e.preventDefault(); e.stopImmediatePropagation();
      closeNotificationClearModal();
    } else if (action === 'confirm-clear-notifications') {
      e.preventDefault(); e.stopImmediatePropagation();
      clearNotificationsConfirmed();
    } else if (action === 'open-notification-entry') {
      e.preventDefault(); e.stopImmediatePropagation();
      const id = target.dataset.eventId;
      const log = getNotificationLog();
      const ev = log.events.find(x => x.id === id);
      if (ev) handleEntryClick(ev);
      closeNotificationPopover();
    } else if (action === 'open-notification-settings') {
      e.preventDefault(); e.stopImmediatePropagation();
      closeNotificationPopover();
      setSelectedSettingsTab('notifications');
      showPage('settings');
    }
  }, true);

  // Settings panel click handlers (capture phase)
  document.addEventListener('click', e => {
    const target = e.target?.closest?.('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const prefs = getNotificationPrefs();
    if (action === 'toggle-channel-master') {
      e.preventDefault(); e.stopImmediatePropagation();
      const channel = target.dataset.channel;
      prefs[channel] = !prefs[channel];
      savePrefs();
      refreshBadge();
      ctx().renderSettings();
    } else if (action === 'toggle-event-channel') {
      e.preventDefault(); e.stopImmediatePropagation();
      const kind = target.dataset.kind;
      const channel = target.dataset.channel;
      prefs.events[kind][channel] = !prefs.events[kind][channel];
      savePrefs();
      ctx().renderSettings();
    } else if (action === 'set-throttle') {
      e.preventDefault(); e.stopImmediatePropagation();
      prefs.soundThrottle = target.dataset.value;
      savePrefs();
      ctx().renderSettings();
    }
  }, true);

  document.addEventListener('change', e => {
    const prefs = getNotificationPrefs();
    const defaultSound = e.target?.closest?.('[data-notification-default-sound]');
    if (defaultSound) {
      prefs.defaultSound = defaultSound.value;
      savePrefs();
      return;
    }
    const eventSound = e.target?.closest?.('[data-notification-event-sound]');
    if (eventSound) {
      const kind = eventSound.dataset.notificationEventSound;
      prefs.events[kind].sound = eventSound.value;
      savePrefs();
    }
  }, true);

  document.addEventListener('click', e => {
    const target = e.target?.closest?.('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'enable-notifications') {
      e.preventDefault(); e.stopImmediatePropagation();
      void requestPermissionV2();
    } else if (target.dataset.action === 'test-notification') {
      e.preventDefault(); e.stopImmediatePropagation();
      sendTestV2();
    }
  }, true);

  // Cross-tab storage handler
  window.addEventListener('storage', function notificationsStorageHandler(e) {
    if (e.key === notificationLogKey() && e.newValue !== null) {
      setNotificationLog(parseLogSafe(e.newValue));
      refreshBadge();
      if (getNotificationPopoverOpen()) renderNotificationPopover();
    }
    if (e.key === NOTIFICATION_PREFS_KEY && e.newValue !== null) {
      try { setNotificationPrefs(migratePrefsV2ToV3(JSON.parse(e.newValue), {})); } catch {}
      refreshBadge();
    }
  });

  refreshBadge();

  // Backfill from existing messages list
  let backfillDone = false;
  function maybeBackfill() {
    if (backfillDone) return;
    const log = getNotificationLog();
    if (log.events.length > 0 || log.lastReadAt > 0) { backfillDone = true; return; }
    const messages = getMessages();
    if (!Array.isArray(messages) || messages.length === 0) return;
    backfillDone = true;
    const pending = messages.filter(m => m && m.state === 'pending' && m.from_role_name).slice(0, 50);
    for (const msg of pending) notify(buildEventForMessage(msg), { silent: true });
    refreshBadge();
  }
  window.addEventListener('load', maybeBackfill);
  const _backfillInterval = setInterval(() => {
    maybeBackfill();
    if (backfillDone) clearInterval(_backfillInterval);
  }, 1000);
}
