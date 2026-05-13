// @ts-nocheck
import { pluralize } from "./util.ts";

// Messages + Channel feature module.
// Lift of installBroadcastUi, installChannelMessagesUi,
// installUnifiedMessageComposerUi, installMessageLengthCounterUi per
// docs/superpowers/specs/2026-05-01-web-client-modularisation-design.md.
// Owns: header broadcast button + dialog + send, Channel-mode message
// list and thread sidebar + send + export + safe markdown, unified
// message composer upgrade + Enter-send + composer/sidebar resize,
// message-length counters.

let _ctx = null;
function ctx() {
  if (!_ctx) throw new Error('messages context not bound; call installMessages(ctx) first');
  return _ctx;
}
function getState() { return ctx().getState(); }
function patchState(partial) { ctx().patchState(partial); }
function getPage() { return ctx().getPage(); }
function workspaceFetch(suffix, init) { return ctx().workspaceFetch(suffix, init); }
function shouldPollWorkspace() { return ctx().shouldPollWorkspace(); }
function disposeXterm() { ctx().disposeXterm(); }
function $(id) { return ctx().$(id); }
function esc(value) { return ctx().esc(value); }
function formatMessageTime(value) { return ctx().formatMessageTime(value); }
function liveRunners() { return ctx().liveRunners(); }
function setModalCloseHandler(modal, fn) { ctx().setModalCloseHandler(modal, fn); }
function applyMessageScroll(mode, wasNearBottom) { ctx().applyMessageScroll(mode, wasNearBottom); }
function messagePeerAvatar(peerId, size) { return ctx().messagePeerAvatar(peerId, size); }
function ensureMessageLengthCounter(input, id) { ctx().ensureMessageLengthCounter(input, id); }
function updateMessageLengthCounters() { ctx().updateMessageLengthCounters(); }
function renderMessageComposer(opts) { return ctx().renderMessageComposer(opts); }
function renderSafeMarkdown(value) { return ctx().renderSafeMarkdown(value); }
function applyMessageComposerSize(value) { ctx().applyMessageComposerSize(value); }
function applyChannelThreadWidth(value) { ctx().applyChannelThreadWidth(value); }
function channelThreadWidth(value) { return ctx().channelThreadWidth(value); }
function messageComposerHeight(value) { return ctx().messageComposerHeight(value); }
function saveUiNumber(key, value) { ctx().saveUiNumber(key, value); }
function getPendingMessageScroll() { return ctx().getPendingMessageScroll(); }
function setPendingMessageScroll(next) { ctx().setPendingMessageScroll(next); }
function getMessageError() { return ctx().getMessageError(); }
function setMessageError(next) { ctx().setMessageError(next); }
function getSelectedPeer() { return ctx().getSelectedPeer(); }
function setSelectedPeer(next) { ctx().setSelectedPeer(next); }
function clearMessages() { ctx().clearMessages(); }
function getMessageComposerHeightKey() { return ctx().getMessageComposerHeightKey(); }
function getChannelThreadWidthKey() { return ctx().getChannelThreadWidthKey(); }
function getHumanPeer() { return ctx().getHumanPeer(); }
function getSelectedThread() { return ctx().getSelectedThread(); }
function callRenderMessages(opts) { ctx().renderMessagesViaCurrent(opts); }
function callLoadMessages(opts) { return ctx().loadMessagesViaCurrent(opts); }
function mobileSidebarTab() { return ctx().mobileSidebarTab ? ctx().mobileSidebarTab() : ''; }
function noteNavMessages(count) { ctx().noteNavMessages?.(count); }

// ---------- Broadcast (was installBroadcastUi) ----------

function broadcastPolicyMode() {
  const state = getState();
  return state.policy?.mode || state.config?.policy?.mode || 'star';
}
function broadcastEnabled() {
  const mode = broadcastPolicyMode();
  return mode === 'star' || mode === 'peer-to-peer';
}
function broadcastAvailability() {
  const policyEnabled = broadcastEnabled();
  const onlineCount = liveRunners().length;
  return {
    visible: policyEnabled,
    enabled: policyEnabled && onlineCount > 0,
    title: !policyEnabled ? 'Broadcast is disabled in the current messaging policy.' : onlineCount > 0 ? 'Broadcast to all online agents' : 'Launch at least one agent to broadcast.',
  };
}
function updateHeaderBroadcastButton() {
  const button = $('topBroadcastBtn');
  if (!button) return;
  const availability = broadcastAvailability();
  button.classList.toggle('hidden', !availability.visible);
  button.disabled = !availability.enabled;
  button.title = availability.title;
}
function installBroadcastButton() {
  const availability = broadcastAvailability();
  if (!availability.visible) return;
  const compose = document.querySelector('.messages-page .compose');
  if (!compose) return;
  const existing = compose.querySelector('[data-action="send-broadcast"]');
  if (existing) {
    existing.disabled = !availability.enabled;
    existing.title = availability.title;
    return;
  }
  compose.insertAdjacentHTML('beforeend', '<button class="btn secondary" data-action="send-broadcast" title="' + esc(availability.title) + '" ' + (availability.enabled ? '' : 'disabled') + '>Broadcast</button>');
}
function setBroadcastStatus(text, error = false) {
  const status = $('broadcastStatus');
  if (!status) return;
  status.textContent = text;
  status.classList.toggle('error', error);
}
function openBroadcastDialog() {
  if (!broadcastAvailability().enabled) return;
  const modal = $('broadcastModal');
  const input = $('broadcastBody');
  const sub = $('broadcastModalSub');
  const onlineCount = liveRunners().length;
  if (sub) sub.textContent = 'Sending to ' + onlineCount + ' ' + pluralize(onlineCount, 'agent') + '.';
  if (input) input.value = '';
  setBroadcastStatus('', false);
  modal?.classList.remove('hidden');
  setTimeout(() => input?.focus(), 0);
}
function closeBroadcastDialog() {
  $('broadcastModal')?.classList.add('hidden');
  setBroadcastStatus('', false);
}
async function postWebBroadcast(body) {
  const res = await workspaceFetch('/messages/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.ok === false) throw new Error(payload.error || 'Broadcast failed');
  return payload;
}
async function sendHeaderBroadcast() {
  const input = $('broadcastBody');
  const body = String(input?.value || '').trim();
  if (!body) { setBroadcastStatus('Message is required.', true); return; }
  const sendButton = $('sendBroadcastBtn');
  if (sendButton) sendButton.disabled = true;
  setBroadcastStatus('Sending…', false);
  try {
    await postWebBroadcast(body);
    closeBroadcastDialog();
    setMessageError('');
    if (getPage() === 'messages') {
      setSelectedPeer(getHumanPeer());
      await callLoadMessages({ rerender: false });
      callRenderMessages({ scrollMode: 'bottom', wasNearBottom: true });
    }
  } catch (e) {
    setBroadcastStatus(String(e?.message || e || 'Broadcast failed'), true);
  } finally {
    if (sendButton) sendButton.disabled = false;
  }
}
async function sendWebBroadcast() {
  if (!broadcastAvailability().enabled) return;
  const input = $('messageCompose');
  const body = String(input?.value || '').trim();
  if (!body) return;
  try {
    await postWebBroadcast(body);
    if (input) input.value = '';
    setMessageError('');
    setSelectedPeer(getHumanPeer());
  } catch (e) {
    setMessageError(String(e?.message || e || 'Broadcast failed'));
  }
  await callLoadMessages({ rerender: false });
  callRenderMessages({ scrollMode: 'bottom', wasNearBottom: true });
}

// ---------- Channel (was installChannelMessagesUi) ----------

const CHANNEL_HISTORY_ROOT_PAGE_SIZE = 20;
const CHANNEL_REFRESH_ROOT_IDS_LIMIT = 50;
let channelMessages = [];
let channelSnapshot = '';
let channelMessagesLoaded = false;
let channelMessagesLoading = false;
let channelOlderExhausted = false;
let channelMessageError = '';
let channelExportMenuOpen = false;
let activeChannelThreadRootId = null;
let channelNewMarker = { markerId: 0, count: 0 };

// ---------- Drafts (WA-038) ----------
// Per-thread composer drafts. In-memory only (no localStorage by design).
// Keys: `direct:<thread>:<peer>`, `channel:root`, `channel:thread:<rootId>`.
const composerDrafts = new Map();
let sendingDirectMessage = false;

export function resetComposerDrafts() {
  composerDrafts.clear();
}

function directDraftKey() {
  const thread = getSelectedThread() || '';
  const peer = getSelectedPeer() || getHumanPeer();
  return 'direct:' + thread + ':' + peer;
}
function channelRootDraftKey() {
  return 'channel:root';
}
function channelThreadDraftKey(rootId) {
  const id = normalizeChannelMessageId(rootId);
  return id ? 'channel:thread:' + id : '';
}
function activeChannelThreadComposerRootId() {
  // Derive thread root from the live composer's send button, not the mutable
  // global. activeChannelThreadRootId is updated before re-render, so reading
  // it during a capture step would mislabel the OLD textarea as belonging to
  // the NEW thread and leak the draft across threads.
  const button = document.querySelector('[data-action="send-channel-thread-message"]');
  return normalizeChannelMessageId(button?.dataset?.parentId);
}
function currentDraftKeyForInput(input) {
  if (!input) return '';
  if (input.id === 'channelThreadCompose') return channelThreadDraftKey(activeChannelThreadComposerRootId());
  if (input.id !== 'messageCompose') return '';
  return isChannelMode() ? channelRootDraftKey() : directDraftKey();
}
function rememberComposerDraft(input) {
  const key = currentDraftKeyForInput(input);
  if (!key) return;
  const value = String(input?.value || '');
  if (value) composerDrafts.set(key, value);
  else composerDrafts.delete(key);
}
function populateDirectDraft() {
  if (sendingDirectMessage) return;
  const input = $('messageCompose');
  if (!input) return;
  if (input.value) return;
  const draft = composerDrafts.get(directDraftKey());
  if (draft) input.value = draft;
}
function populateChannelRootDraft() {
  const input = $('messageCompose');
  if (!input) return;
  if (input.value) return;
  const draft = composerDrafts.get(channelRootDraftKey());
  if (draft) input.value = draft;
}
function populateChannelThreadDraft() {
  const input = $('channelThreadCompose');
  if (!input) return;
  if (input.value) return;
  const key = channelThreadDraftKey(activeChannelThreadRootId);
  if (!key) return;
  const draft = composerDrafts.get(key);
  if (draft) input.value = draft;
}

export function resetChannel() {
  channelMessages = [];
  channelSnapshot = '';
  channelMessagesLoaded = false;
  channelMessagesLoading = false;
  channelOlderExhausted = false;
  channelMessageError = '';
  channelExportMenuOpen = false;
  activeChannelThreadRootId = null;
  clearChannelNewMarker();
  channelThreadScrollByRoot.clear();
}

function isChannelMode() {
  const state = getState();
  return (state.policy?.mode || state.config?.policy?.mode) === 'channel';
}

function channelRootNearBottom() {
  const el = $('messageThreadBody');
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

// WA-043: per-root sidebar scroll memory. Re-render of the channel thread
// sidebar (new arrival, own send, refresh) destroys the panel; without an
// explicit snapshot the user lands at top.
const channelThreadScrollByRoot = new Map();
function channelSidebarBody() {
  return document.querySelector('.channel-thread-sidebar-body');
}
function channelSidebarNearBottom(el) {
  const node = el || channelSidebarBody();
  if (!node) return true;
  return node.scrollHeight - node.scrollTop - node.clientHeight < 80;
}

function channelSnapshotFor(items) {
  return JSON.stringify((items || []).map(message => [message.id, message.channel_id || '', message.from_role_name || '', message.parent_message_id || '', message.root_message_id || '', message.sent_at || '', message.body || '']));
}

function maxChannelMessageId(items) {
  return (items || []).reduce((max, message) => Math.max(max, Number(message.id) || 0), 0);
}
function channelMessagesById(...groups) {
  const byId = new Map();
  for (const group of groups) {
    for (const message of group || []) {
      const id = normalizeChannelMessageId(message?.id);
      if (id) byId.set(id, message);
    }
  }
  return Array.from(byId.values()).sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
}
function channelRootMessagesFrom(items) {
  return (items || []).filter(channelMessageIsRoot);
}
function minChannelRootId(items) {
  const min = channelRootMessagesFrom(items).reduce((value, message) => {
    const id = normalizeChannelMessageId(message.id);
    return id ? Math.min(value, id) : value;
  }, Number.POSITIVE_INFINITY);
  return Number.isFinite(min) ? min : 0;
}
function channelRefreshRootIds() {
  const activeRootId = normalizeChannelMessageId(activeChannelThreadRootId);
  const loaded = channelRootMessagesFrom(channelMessages).map(message => normalizeChannelMessageId(message.id)).filter(Boolean);
  const withoutActive = activeRootId ? loaded.filter(id => id !== activeRootId) : loaded;
  const keep = withoutActive.slice(-(activeRootId ? CHANNEL_REFRESH_ROOT_IDS_LIMIT - 1 : CHANNEL_REFRESH_ROOT_IDS_LIMIT));
  if (activeRootId) keep.push(activeRootId);
  return Array.from(new Set(keep)).slice(-CHANNEL_REFRESH_ROOT_IDS_LIMIT);
}

function incomingChannelMessageCount(items) {
  return (items || []).filter(message => message.from_role_name).length;
}

function markChannelNewMarker(items, wasNearBottom) {
  if (getPage() !== 'messages' || !isChannelMode() || wasNearBottom) return;
  const incomingRoots = (items || []).filter(message => message.from_role_name && channelMessageIsRoot(message));
  if (incomingRoots.length === 0) return;
  if (!channelNewMarker.markerId) channelNewMarker = { markerId: Number(incomingRoots[0].id) || 0, count: 0 };
  channelNewMarker.count += incomingRoots.length;
}

function clearChannelNewMarker() {
  channelNewMarker = { markerId: 0, count: 0 };
  document.querySelector('[data-action="channel-jump-to-marker"]')?.remove();
}

function renderChannelNewMarkerPill() {
  if (!channelNewMarker.markerId || channelNewMarker.count <= 0) return '';
  const label = channelNewMarker.count + ' new ' + (channelNewMarker.count === 1 ? 'message' : 'messages') + ' ↓';
  return '<button class="messages-new-marker-pill" data-action="channel-jump-to-marker" data-marker-id="' + esc(channelNewMarker.markerId) + '">' + esc(label) + '</button>';
}

function installChannelNewMarkerScrollClear() {
  const body = $('messageThreadBody');
  if (!body) return;
  body.addEventListener('scroll', () => {
    if (channelNewMarker.markerId && channelRootNearBottom()) clearChannelNewMarker();
    if (body.scrollTop > 96 || channelMessagesLoading || channelOlderExhausted || !channelMessagesLoaded) return;
    const beforeId = minChannelRootId(channelMessages);
    if (beforeId > 0) void loadChannelMessages({ beforeId, rerender: true, silent: true, scrollMode: 'preserve' });
  }, { passive: true });
}

function jumpToChannelNewMarker(markerId) {
  const marker = document.querySelector('.channel-message-row[data-message-id="' + String(markerId || '').replace(/"/g, '\\"') + '"]');
  clearChannelNewMarker();
  if (marker) marker.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadChannelMessages(opts = {}) {
  if (!shouldPollWorkspace()) return false;
  if (channelMessagesLoading) return false;
  const beforeId = normalizeChannelMessageId(opts.beforeId);
  if (beforeId && channelOlderExhausted) return false;
  const gen = getState().workspaceGeneration;
  const wasNearBottomBeforeLoad = channelRootNearBottom();
  const wasNearBottom = channelRootNearBottom();
  const prependScroll = beforeId ? (() => {
    const el = $('messageThreadBody');
    return el ? { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop } : null;
  })() : null;
  channelMessagesLoading = true;
  let shouldRender = Boolean(opts.rerender);
  let stale = false;
  try {
    const includeRootIds = beforeId ? [] : channelRefreshRootIds();
    const suffix = '/channel/messages?rootLimit=' + CHANNEL_HISTORY_ROOT_PAGE_SIZE + (beforeId ? '&rootBeforeId=' + encodeURIComponent(String(beforeId)) : '') + (includeRootIds.length ? '&rootIds=' + encodeURIComponent(includeRootIds.join(',')) : '');
    const res = await workspaceFetch(suffix);
    const body = await res.json().catch(() => ({}));
    if (gen !== getState().workspaceGeneration) { stale = true; return false; }
    if (!res.ok || body.ok === false) throw new Error(body.error || 'Channel messages failed to load');
    const fetched = Array.isArray(body.messages) ? body.messages : [];
    const previousMaxId = maxChannelMessageId(channelMessages);
    const page = body.page || {};
    let next;
    if (beforeId) {
      next = channelMessagesById(fetched, channelMessages);
      const fetchedRootCount = channelRootMessagesFrom(fetched).length;
      channelOlderExhausted = page.hasMoreOlder === false || fetchedRootCount < CHANNEL_HISTORY_ROOT_PAGE_SIZE;
    } else {
      const minLatestRootId = normalizeChannelMessageId(page.oldestRootId) || minChannelRootId(fetched);
      const olderLoaded = minLatestRootId > 0 ? channelMessages.filter(message => (channelMessageRootId(message) || 0) < minLatestRootId) : [];
      next = channelMessagesLoaded ? channelMessagesById(olderLoaded, fetched) : fetched;
      channelOlderExhausted = page.hasMoreOlder === false;
    }
    const nextSnapshot = channelSnapshotFor(next);
    if (!beforeId && opts.onlyIfChanged && nextSnapshot === channelSnapshot) {
      shouldRender = false;
      return false;
    }
    if (channelMessagesLoaded && !beforeId) {
      const newMessages = next.filter(message => (Number(message.id) || 0) > previousMaxId);
      noteNavMessages(incomingChannelMessageCount(newMessages));
      markChannelNewMarker(newMessages, wasNearBottomBeforeLoad);
    }
    channelMessages = next;
    channelSnapshot = nextSnapshot;
    channelMessagesLoaded = true;
    channelMessageError = '';
    clearMessages();
    return true;
  } catch (e) {
    stale = gen !== getState().workspaceGeneration;
    if (!stale && !opts.silent) channelMessageError = String(e?.message || e);
    return false;
  } finally {
    channelMessagesLoading = false;
    if (!stale && shouldRender && getPage() === 'messages') callRenderMessages({ scrollMode: getPendingMessageScroll() || 'preserve', wasNearBottom, prependScroll });
  }
}

function renderChannelMessages(opts = {}) {
  disposeXterm();
  if (!channelMessagesLoaded && !channelMessagesLoading) void callLoadMessages({ rerender: true, silent: true });
  const previousRootBody = $('messageThreadBody');
  const previousRootScrollTop = previousRootBody ? previousRootBody.scrollTop : 0;
  const previousSidebarBody = channelSidebarBody();
  const previousSidebarRootId = activeChannelThreadComposerRootId();
  const previousSidebarScrollTop = previousSidebarBody ? previousSidebarBody.scrollTop : 0;
  const previousSidebarWasNearBottom = previousSidebarBody ? channelSidebarNearBottom(previousSidebarBody) : true;
  if (previousSidebarBody && previousSidebarRootId) {
    channelThreadScrollByRoot.set(previousSidebarRootId, previousSidebarScrollTop);
  }
  const composeState = channelComposeState();
  const sidebarComposeState = channelThreadComposeState();
  const activeThreadSidebar = renderChannelThreadSidebar();
  const rootMessages = channelRootMessages();
  const loading = channelMessagesLoading && !channelMessagesLoaded ? '<div class="thread-empty">Loading shared channel…</div>' : '';
  const empty = !loading && rootMessages.length === 0 ? '<div class="thread-empty">No message in the channel yet.</div>' : '';
  const error = channelMessageError ? '<div class="message-error">' + esc(channelMessageError) + '</div>' : '';
  const composer = renderMessageComposer({ id: 'messageCompose', counterId: 'messageComposeCounter', placeholder: 'Post to #shared for all roles. Enter sends. Shift+Enter adds a line.', action: 'send-channel-message', label: 'Post to Channel', value: composeState?.value || '', extraClass: 'channel-compose', iconOnly: true });
  $('content').innerHTML = '<div class="messages-page channel-mode ' + (activeChannelThreadRootId ? 'thread-open' : '') + '" style="--channel-thread-width:' + channelThreadWidth() + 'px"><div class="tabbar message-tabbar">' + mobileSidebarTab() + '<div class="tabbar-scroll" role="tablist"><button class="term-tab active" role="tab" aria-selected="true">#shared</button></div></div><div class="inbox-panel channel-panel">' +
    '<div class="thread-head channel-head"><div class="channel-head-main"><h2>#shared</h2></div><div class="channel-head-actions">' + channelExportControl() + '<button class="btn secondary small" data-action="refresh-channel">Refresh</button></div></div>' +
    '<div id="messageThreadBody" class="thread-body channel-thread">' + loading + empty + rootMessages.map(renderChannelMessageRow).join('') + renderChannelNewMarkerPill() + '</div>' +
    error +
    composer +
  '</div>' + activeThreadSidebar + '</div>';
  restoreChannelComposeState(composeState);
  restoreChannelThreadComposeState(sidebarComposeState);
  populateChannelRootDraft();
  populateChannelThreadDraft();
  installChannelNewMarkerScrollClear();
  setPendingMessageScroll('');
  const scrollMode = opts.scrollMode || 'preserve';
  const wasNearBottomFlag = opts.wasNearBottom ?? true;
  if (opts.prependScroll) {
    const snap = opts.prependScroll;
    requestAnimationFrame(() => {
      const nextRoot = $('messageThreadBody');
      if (nextRoot) nextRoot.scrollTop = Math.max(0, nextRoot.scrollHeight - snap.scrollHeight + snap.scrollTop);
    });
  } else {
    applyMessageScroll(scrollMode, wasNearBottomFlag);
    if (scrollMode !== 'bottom' && !wasNearBottomFlag && previousRootScrollTop) {
      requestAnimationFrame(() => {
        const nextRoot = $('messageThreadBody');
        if (nextRoot) nextRoot.scrollTop = previousRootScrollTop;
      });
    }
  }
  const currentSidebarRootId = normalizeChannelMessageId(activeChannelThreadRootId);
  if (currentSidebarRootId) {
    requestAnimationFrame(() => {
      const nextSidebar = channelSidebarBody();
      if (!nextSidebar) return;
      if (currentSidebarRootId === previousSidebarRootId && previousSidebarWasNearBottom) {
        nextSidebar.scrollTop = nextSidebar.scrollHeight;
        return;
      }
      const stored = channelThreadScrollByRoot.get(currentSidebarRootId);
      if (stored) nextSidebar.scrollTop = stored;
    });
  }
}

function channelExportControl() {
  const menu = channelExportMenuOpen
    ? '<div class="launch-menu channel-export-options"><button data-action="export-channel" data-format="markdown">Markdown (.md)</button><button data-action="export-channel" data-format="text">Plain Text (.txt)</button><button data-action="export-channel" data-format="json">JSON (.json)</button></div>'
    : '';
  return '<div class="launch-split channel-export-menu"><button class="btn secondary small" data-action="toggle-channel-export">Export</button><button class="launch-arrow" data-action="toggle-channel-export" aria-label="Choose export format" aria-expanded="' + (channelExportMenuOpen ? 'true' : 'false') + '">\u25BC</button>' + menu + '</div>';
}

function channelComposeState() {
  const input = $('messageCompose');
  if (!input) return null;
  return {
    active: document.activeElement === input,
    value: input.value || '',
    selectionStart: input.selectionStart ?? input.value.length,
    selectionEnd: input.selectionEnd ?? input.value.length,
  };
}
function restoreChannelComposeState(composeState) {
  if (!composeState) return;
  const input = $('messageCompose');
  if (!input) return;
  input.value = composeState.value;
  if (!composeState.active) return;
  input.focus();
  try { input.setSelectionRange(composeState.selectionStart, composeState.selectionEnd); } catch {}
}
function channelThreadComposeState() {
  const input = $('channelThreadCompose');
  if (!input) return null;
  return {
    active: document.activeElement === input,
    value: input.value || '',
    selectionStart: input.selectionStart ?? input.value.length,
    selectionEnd: input.selectionEnd ?? input.value.length,
    rootId: activeChannelThreadComposerRootId(),
  };
}
function restoreChannelThreadComposeState(composeState) {
  if (!composeState) return;
  if (composeState.rootId !== activeChannelThreadRootId) return;
  const input = $('channelThreadCompose');
  if (!input) return;
  input.value = composeState.value;
  if (!composeState.active) return;
  input.focus();
  try { input.setSelectionRange(composeState.selectionStart, composeState.selectionEnd); } catch {}
}

function normalizeChannelMessageId(value) {
  const id = Math.floor(Number(value || 0));
  return Number.isFinite(id) && id > 0 ? id : null;
}
function channelMessageById(id) {
  const messageId = normalizeChannelMessageId(id);
  return messageId ? channelMessages.find(message => Number(message.id) === messageId) || null : null;
}
function channelMessageRootId(message) {
  return normalizeChannelMessageId(message?.root_message_id) || normalizeChannelMessageId(message?.id);
}
function channelMessageIsRoot(message) {
  const id = normalizeChannelMessageId(message?.id);
  const parentId = normalizeChannelMessageId(message?.parent_message_id);
  const rootId = normalizeChannelMessageId(message?.root_message_id);
  return Boolean(id) && !parentId && (!rootId || rootId === id);
}
function channelRootMessages() {
  return channelMessages.filter(channelMessageIsRoot);
}
function channelMessageReplies(rootId) {
  const id = normalizeChannelMessageId(rootId);
  if (!id) return [];
  return channelMessages.filter(message => channelMessageRootId(message) === id && Number(message.id) !== id);
}

function renderChannelMessageRow(message) {
  const sender = message.from_role_name || 'human-web';
  const messageId = normalizeChannelMessageId(message.id);
  const rootId = channelMessageRootId(message);
  const replies = channelMessageReplies(rootId);
  const replyCount = replies.length ? '<button class="channel-thread-count" data-action="open-channel-thread" data-root-id="' + esc(rootId || messageId) + '">' + replies.length + ' ' + (replies.length === 1 ? 'reply' : 'replies') + '</button>' : '';
  const active = activeChannelThreadRootId && rootId === activeChannelThreadRootId ? ' active-thread' : '';
  return '<div class="channel-message-row' + active + '" data-message-id="' + esc(messageId || '') + '">' +
    '<div class="channel-message-avatar">' + channelAvatar(sender) + '</div>' +
    '<div class="channel-message-main">' +
      '<div class="channel-message-meta"><span class="channel-message-sender">' + esc(sender) + '</span><span class="channel-message-time">' + esc(formatMessageTime(message.sent_at)) + '</span><span class="channel-message-id">#' + esc(message.id) + '</span></div>' +
      '<div class="channel-message-body markdown-body">' + renderSafeMarkdown(message.body) + '</div>' +
      '<div class="channel-message-actions"><button data-action="channel-reply" data-message-id="' + esc(messageId || '') + '">Reply</button>' + replyCount + '</div>' +
    '</div></div>';
}

function renderChannelThreadSidebar() {
  const rootId = normalizeChannelMessageId(activeChannelThreadRootId);
  if (!rootId) return '';
  const root = channelMessageById(rootId);
  if (!root) { activeChannelThreadRootId = null; return ''; }
  const items = channelMessages.filter(message => channelMessageRootId(message) === rootId).sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
  const composer = renderMessageComposer({ id: 'channelThreadCompose', counterId: 'channelThreadComposeCounter', placeholder: 'Reply in thread #' + root.id + '. Enter sends. Shift+Enter adds a line.', action: 'send-channel-thread-message', label: 'Reply', parentId: root.id, extraClass: 'channel-thread-sidebar-compose', iconOnly: true });
  return '<aside class="channel-thread-sidebar" aria-label="Channel thread">' +
    '<div class="channel-thread-sidebar-resize" data-action="resize-channel-thread" role="separator" aria-orientation="vertical" title="Drag to resize thread sidebar"></div>' +
    '<div class="channel-thread-sidebar-head"><div><h3>Thread #' + esc(root.id) + '</h3><p>' + esc(root.from_role_name || 'human-web') + ' · ' + esc(formatMessageTime(root.sent_at)) + '</p></div><button class="btn secondary small" data-action="close-channel-thread">Close</button></div>' +
    '<div class="channel-thread-sidebar-body">' + items.map(renderChannelThreadSidebarMessage).join('') + '</div>' +
    composer +
  '</aside>';
}

function renderChannelThreadSidebarMessage(message) {
  const sender = message.from_role_name || 'human-web';
  return '<div class="channel-sidebar-message"><div class="channel-message-avatar">' + channelAvatar(sender) + '</div><div class="channel-sidebar-message-main"><div class="channel-message-meta"><span class="channel-message-sender">' + esc(sender) + '</span><span class="channel-message-time">' + esc(formatMessageTime(message.sent_at)) + '</span><span class="channel-message-id">#' + esc(message.id) + '</span></div><div class="channel-message-body markdown-body">' + renderSafeMarkdown(message.body) + '</div></div></div>';
}

function channelAvatar(sender) {
  return messagePeerAvatar(sender, 32);
}

function channelExportTimestamp(message) {
  const date = new Date(message.sent_at || '');
  return Number.isNaN(date.getTime()) ? String(message.sent_at || '') : date.toISOString();
}
function channelExportFilename(format) {
  const ext = format === 'json' ? 'json' : format === 'text' ? 'txt' : 'md';
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, match => match === 'T' ? '-' : match);
  return 'whatsagent-channel-shared-' + stamp + '.' + ext;
}
function channelTranscript(format) {
  const items = channelMessages || [];
  if (format === 'json') return JSON.stringify(items.map(message => ({ id: message.id, channel: message.channel_name || message.channel_id || 'shared', from: message.from_role_name || 'human-web', sent_at: message.sent_at, body: message.body || '' })), null, 2) + '\n';
  if (format === 'text') return items.map(message => '[' + channelExportTimestamp(message) + '] ' + (message.from_role_name || 'human-web') + '\n' + String(message.body || '')).join('\n\n') + '\n';
  return '# WhatsAgent #shared transcript\n\n' + items.map(message => '## ' + (message.from_role_name || 'human-web') + ' - ' + channelExportTimestamp(message) + '\n\n' + String(message.body || '')).join('\n\n') + '\n';
}
function downloadChannelTranscript(format) {
  const content = channelTranscript(format);
  const type = format === 'json' ? 'application/json' : format === 'text' ? 'text/plain' : 'text/markdown';
  const blob = new Blob([content], { type: type + '; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = channelExportFilename(format);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
async function exportChannelTranscript(format) {
  if (!channelMessagesLoaded && !channelMessagesLoading) await callLoadMessages({ rerender: false, silent: true });
  downloadChannelTranscript(format);
}
async function sendWebChannelMessage() {
  const input = $('messageCompose');
  const body = String(input?.value || '').trim();
  if (!body) return;
  const draftKey = channelRootDraftKey();
  // Capture near-bottom synchronously: the root timeline body still exists at
  // this point. After await/innerHTML it's gone.
  const nearBottom = channelRootNearBottom();
  const gen = getState().workspaceGeneration;
  const res = await workspaceFetch('/channel/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
  if (gen !== getState().workspaceGeneration) return;
  const payload = await res.json().catch(() => ({}));
  if (res.ok && payload.ok !== false) {
    if (input) input.value = '';
    channelMessageError = '';
    composerDrafts.delete(draftKey);
  } else {
    channelMessageError = payload.error || 'Channel post failed';
  }
  await callLoadMessages({ rerender: false });
  callRenderMessages({ scrollMode: nearBottom ? 'bottom' : 'preserve', wasNearBottom: nearBottom });
}
async function sendWebChannelThreadMessage(parentMessageId) {
  parentMessageId = parentMessageId ?? activeChannelThreadRootId;
  const input = $('channelThreadCompose');
  const body = String(input?.value || '').trim();
  const parentId = normalizeChannelMessageId(parentMessageId);
  if (!body || !parentId) return;
  const rootIdForDraft = normalizeChannelMessageId(activeChannelThreadRootId) || parentId;
  const draftKey = channelThreadDraftKey(rootIdForDraft);
  const gen = getState().workspaceGeneration;
  const res = await workspaceFetch('/channel/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, parentMessageId: parentId }) });
  if (gen !== getState().workspaceGeneration) return;
  const payload = await res.json().catch(() => ({}));
  if (res.ok && payload.ok !== false) {
    if (input) input.value = '';
    activeChannelThreadRootId = channelMessageRootId(payload.message) || parentId;
    channelMessageError = '';
    if (draftKey) composerDrafts.delete(draftKey);
  } else {
    channelMessageError = payload.error || 'Channel reply failed';
  }
  await callLoadMessages({ rerender: false });
  callRenderMessages({ scrollMode: 'preserve', wasNearBottom: channelRootNearBottom() });
}

// ---------- Composer (was installUnifiedMessageComposerUi) ----------

function upgradeDirectMessageComposer() {
  const compose = document.querySelector('.messages-page:not(.channel-mode) .thread-panel > .compose:not(.message-composer)');
  if (!compose) return;
  const input = compose.querySelector('#messageCompose');
  const sendButton = compose.querySelector('[data-action="send-message"]');
  if (!input || !sendButton) return;
  const active = document.activeElement === input;
  const value = input.value || '';
  const selectionStart = input.selectionStart ?? value.length;
  const selectionEnd = input.selectionEnd ?? value.length;
  const broadcastButton = compose.querySelector('[data-action="send-broadcast"]');
  const leftControls = broadcastButton ? '<button class="btn secondary" data-action="send-broadcast">Broadcast</button>' : '';
  const placeholder = String(input.getAttribute('placeholder') || '').replace('Ctrl/Cmd+Enter sends.', 'Enter sends. Shift+Enter adds a line.');
  compose.outerHTML = renderMessageComposer({ id: 'messageCompose', counterId: 'messageComposeCounter', placeholder, action: 'send-message', label: 'Send', value, disabled: input.disabled || sendButton.disabled, leftControls });
  const nextInput = $('messageCompose');
  if (!nextInput) return;
  nextInput.value = value;
  if (active) {
    nextInput.focus();
    try { nextInput.setSelectionRange(selectionStart, selectionEnd); } catch {}
  }
}

// ---------- Message length counters (was installMessageLengthCounterUi) ----------

function installCounters() {
  ensureMessageLengthCounter($('messageCompose'), 'messageComposeCounter');
  ensureMessageLengthCounter($('channelThreadCompose'), 'channelThreadComposeCounter');
  ensureMessageLengthCounter($('broadcastBody'), 'broadcastBodyCounter');
  updateMessageLengthCounters();
}

// ---------- Install + decorator chain ----------

let _delegationInstalled = false;

export function installMessages(c) {
  _ctx = c;
  if (_delegationInstalled) return;
  _delegationInstalled = true;

  // EP-004 WA-015: channel export popover joins the unified dismiss
  // registry. Existing per-action close lines stay (idempotent).
  if (typeof c.bindDropdownDismiss === 'function') {
    c.bindDropdownDismiss({
      rootSelector: '.channel-export-menu',
      isOpen: () => channelExportMenuOpen,
      dismiss: () => {
        channelExportMenuOpen = false;
        callRenderMessages({ scrollMode: 'preserve', wasNearBottom: channelRootNearBottom() });
      },
    });
  }

  // Capture base impls before wrapping
  const baseRender = c.getRender();
  const baseRenderMessages = c.getRenderMessages();
  const baseRenderSettings = c.getRenderSettings();
  const baseLoadMessages = c.getLoadMessages();
  const baseSendWebMessage = c.getSendWebMessage();

  // Broadcast wraps
  c.setRender(function renderWithBroadcastUi() {
    baseRender();
    updateHeaderBroadcastButton();
  });
  c.setRenderMessages(function renderMessagesWithBroadcast(opts = {}) {
    baseRenderMessages(opts);
    installBroadcastButton();
    updateHeaderBroadcastButton();
  });
  c.setRenderSettings(function renderSettingsWithBroadcastUi() {
    baseRenderSettings();
    updateHeaderBroadcastButton();
  });

  // Channel wraps (replace loadMessages/renderMessages/sendWebMessage when in channel mode)
  const renderMessagesAfterBroadcast = c.getRenderMessages();
  c.setLoadMessages(async function loadMessagesWithChannel(opts = {}) {
    if (!isChannelMode()) return await baseLoadMessages(opts);
    return await loadChannelMessages(opts);
  });
  c.setRenderMessages(function renderMessagesWithChannel(opts = {}) {
    if (!isChannelMode()) return renderMessagesAfterBroadcast(opts);
    renderChannelMessages(opts);
  });
  c.setSendWebMessage(async function sendWebMessageWithChannelAndDraft() {
    if (isChannelMode()) return sendWebChannelMessage();
    const input = $('messageCompose');
    const value = String(input?.value || '');
    const draftKey = directDraftKey();
    if (value) composerDrafts.set(draftKey, value);
    sendingDirectMessage = true;
    try {
      await baseSendWebMessage();
      if (!getMessageError()) composerDrafts.delete(draftKey);
    } finally {
      sendingDirectMessage = false;
    }
    populateDirectDraft();
  });

  // Composer wraps
  const renderMessagesAfterChannel = c.getRenderMessages();
  c.setRenderMessages(function renderMessagesWithUnifiedComposer(opts = {}) {
    renderMessagesAfterChannel(opts);
    upgradeDirectMessageComposer();
    if (!isChannelMode()) populateDirectDraft();
    applyMessageComposerSize();
    applyChannelThreadWidth();
    updateMessageLengthCounters();
  });

  // Message-length-counter wraps
  const renderAfterBroadcast = c.getRender();
  c.setRender(function renderWithMessageLengthCounters() {
    renderAfterBroadcast();
    installCounters();
  });
  const renderMessagesAfterComposer = c.getRenderMessages();
  c.setRenderMessages(function renderMessagesWithMessageLengthCounters(opts = {}) {
    renderMessagesAfterComposer(opts);
    installCounters();
  });

  // Reset hook for channel state + composer drafts (per-workspace context)
  c.registerResetHook(() => { resetChannel(); resetComposerDrafts(); });

  // ---------- Delegation listeners ----------

  setModalCloseHandler($('broadcastModal'), closeBroadcastDialog);
  $('topBroadcastBtn')?.addEventListener('click', e => { e.preventDefault(); openBroadcastDialog(); });
  $('closeBroadcastBtn')?.addEventListener('click', e => { e.preventDefault(); closeBroadcastDialog(); });
  $('sendBroadcastBtn')?.addEventListener('click', e => { e.preventDefault(); void sendHeaderBroadcast(); });
  $('broadcastModal')?.addEventListener('click', e => { if (e.target === $('broadcastModal')) closeBroadcastDialog(); });

  document.addEventListener('click', e => {
    const target = e.target?.closest?.('[data-action="send-broadcast"]');
    if (!target) return;
    e.preventDefault();
    void sendWebBroadcast();
  });

  document.addEventListener('click', e => {
    const target = e.target?.closest?.('[data-action="send-channel-message"], [data-action="send-channel-thread-message"], [data-action="refresh-channel"], [data-action="toggle-channel-export"], [data-action="export-channel"], [data-action="channel-reply"], [data-action="open-channel-thread"], [data-action="close-channel-thread"], [data-action="channel-jump-to-marker"]');
    if (!target) {
      if (channelExportMenuOpen && getPage() === 'messages' && isChannelMode()) {
        channelExportMenuOpen = false;
        callRenderMessages({ scrollMode: 'preserve', wasNearBottom: channelRootNearBottom() });
      }
      return;
    }
    e.preventDefault();
    if (target.dataset.action === 'toggle-channel-export') { channelExportMenuOpen = !channelExportMenuOpen; callRenderMessages({ scrollMode: 'preserve', wasNearBottom: channelRootNearBottom() }); }
    if (target.dataset.action === 'export-channel') { channelExportMenuOpen = false; void exportChannelTranscript(target.dataset.format || 'markdown'); callRenderMessages({ scrollMode: 'preserve', wasNearBottom: channelRootNearBottom() }); }
    if (target.dataset.action === 'send-channel-message') void sendWebChannelMessage();
    if (target.dataset.action === 'send-channel-thread-message') void sendWebChannelThreadMessage(target.dataset.parentId || activeChannelThreadRootId);
    if (target.dataset.action === 'channel-reply') {
      const message = channelMessageById(target.dataset.messageId);
      if (message) {
        activeChannelThreadRootId = channelMessageRootId(message);
        channelExportMenuOpen = false;
        callRenderMessages({ scrollMode: 'preserve', wasNearBottom: channelRootNearBottom() });
        setTimeout(() => $('channelThreadCompose')?.focus(), 0);
      }
    }
    if (target.dataset.action === 'open-channel-thread') { activeChannelThreadRootId = normalizeChannelMessageId(target.dataset.rootId); channelExportMenuOpen = false; callRenderMessages({ scrollMode: 'preserve', wasNearBottom: channelRootNearBottom() }); }
    if (target.dataset.action === 'close-channel-thread') { activeChannelThreadRootId = null; callRenderMessages({ scrollMode: 'preserve', wasNearBottom: channelRootNearBottom() }); }
    if (target.dataset.action === 'channel-jump-to-marker') jumpToChannelNewMarker(target.dataset.markerId);
    if (target.dataset.action === 'refresh-channel') { channelExportMenuOpen = false; void callLoadMessages({ rerender: true }); }
  });

  // Composer Enter-send keydown
  document.addEventListener('keydown', e => {
    const target = e.target;
    if (!target?.matches?.('#messageCompose, #channelThreadCompose')) return;
    if (e.key !== 'Enter') return;
    if (e.shiftKey) { e.stopPropagation(); return; }
    if (e.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    if (target.disabled) return;
    if (target.id === 'channelThreadCompose') {
      document.querySelector('[data-action="send-channel-thread-message"]')?.click();
      return;
    }
    void c.callSendWebMessage();
  }, true);

  // Resize handlers
  let activeResize = null;
  document.addEventListener('pointerdown', e => {
    const target = e.target?.closest?.('[data-action="resize-message-composer"], [data-action="resize-channel-thread"]');
    if (!target) return;
    e.preventDefault();
    if (target.dataset.action === 'resize-message-composer') {
      const composer = target.closest('.message-composer');
      const current = composer ? parseFloat(getComputedStyle(composer).getPropertyValue('--message-composer-height')) : NaN;
      activeResize = { type: 'composer', startY: e.clientY, startHeight: Number.isFinite(current) ? current : messageComposerHeight() };
    } else {
      const sidebar = target.closest('.channel-thread-sidebar');
      activeResize = { type: 'thread', startX: e.clientX, startWidth: sidebar?.getBoundingClientRect().width || channelThreadWidth() };
    }
    document.documentElement.classList.add('message-ui-resizing');
  });
  document.addEventListener('pointermove', e => {
    if (!activeResize) return;
    e.preventDefault();
    if (activeResize.type === 'composer') {
      const height = messageComposerHeight(activeResize.startHeight - (e.clientY - activeResize.startY));
      saveUiNumber(getMessageComposerHeightKey(), height);
      applyMessageComposerSize(height);
      return;
    }
    const width = channelThreadWidth(activeResize.startWidth - (e.clientX - activeResize.startX));
    saveUiNumber(getChannelThreadWidthKey(), width);
    applyChannelThreadWidth(width);
  });
  function stopResize() {
    activeResize = null;
    document.documentElement.classList.remove('message-ui-resizing');
  }
  document.addEventListener('pointerup', stopResize);
  document.addEventListener('pointercancel', stopResize);
  window.addEventListener('resize', () => { applyMessageComposerSize(); applyChannelThreadWidth(); });

  // Composer draft capture (WA-038): persist per-thread composer text in-memory.
  document.addEventListener('input', e => {
    const target = e.target;
    if (!target?.matches?.('#messageCompose, #channelThreadCompose')) return;
    rememberComposerDraft(target);
  });

  // Message-length-counter listeners
  document.addEventListener('input', e => {
    if (e.target?.matches?.('[data-message-length-input]')) updateMessageLengthCounters();
  });
  document.addEventListener('click', e => {
    if (e.target?.closest?.('#topBroadcastBtn')) setTimeout(installCounters, 0);
  });

  // Initial setup matching IIFE bottoms
  updateHeaderBroadcastButton();
  installBroadcastButton();
}
