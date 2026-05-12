// @ts-nocheck
import { parseRoute, workspacePath } from "./router.ts";
import {
  applyKanbanRoute,
  installKanban,
  kanbanPathSegments,
  onKanbanPageSwitch,
  renderKanban,
  resetKanban,
} from "./kanban.ts";
import {
  installSettings,
  renderSettingsTabContent,
  settingsTabsHtml,
  validSettingsTab as validSettingsTabFromSettings,
} from "./settings.ts";
import {
  agentsLaunchControl,
  agentsRenderLaunchDialog,
  installAgents,
  renderAgentConfigPage,
  renderAgentCreatePage,
  renderAgentsOverview,
  renderAgentsSettingsTabContent,
} from "./agents.ts";
import {
  codexAgentTabDot,
  codexNudgeToast,
  codexPollStatus,
  codexRunnerSnapshotFor,
  installCodex,
} from "./codex.ts";
import { installMessages } from "./messages.ts";
import { installNotifications } from "./notifications.ts";
import { identiconFor } from "./identicon.ts";
import { renderSafeMarkdownHtml } from "./markdown.ts";
import { SpecialKeysOverlay } from "./special-keys-overlay.ts";
import { TerminalController } from "./terminal-controller.ts";
import { installTruncateTitleFallback, truncatedAttrs } from "./truncate-tooltip.ts";
import { pluralize, stripAnsi } from "./util.ts";

const QUICK_PROMPT_ENABLED_RUNTIMES = new Set(['claude-code', 'opencode', 'codex', 'pi']);

const initialState = __WHATSAGENT_INITIAL_STATE__;
    const NL = String.fromCharCode(10);
    // EP-029 T4: EXITED_TERMINAL_REPLAY_PREFIX deleted — server-side
    // mirror.serialize() preserves alt-screen state across exit; the
    // restore frame writes the snapshot atomically so no client-side
    // alt-screen-exit prefix is needed.
    let state = initialState;
    state.workspaceGeneration = state.workspaceGeneration || 0;
    let workspaceAbortController = new AbortController();
    const resetHooks = [];

    function shouldPollWorkspace() {
      return Boolean(state.currentWorkspace?.id) && page !== 'workspaces-overview';
    }

    function abortInFlight() {
      try { workspaceAbortController.abort(); } catch {}
      workspaceAbortController = new AbortController();
      state.workspaceGeneration = (state.workspaceGeneration || 0) + 1;
    }

    let authRedirecting = false;
    function requestUrl(input) {
      if (typeof input === 'string') return input;
      if (input instanceof URL) return input.href;
      return input?.url || '';
    }
    function requestMethod(input, init) {
      return String(init?.method || input?.method || 'GET').toUpperCase();
    }
    function isStateChangingMethod(method) {
      return method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH';
    }
    function isDaemonApiRequest(input) {
      const raw = requestUrl(input);
      if (!raw) return false;
      try {
        const url = new URL(raw, window.location.href);
        return url.origin === window.location.origin && url.pathname.startsWith('/api/v1/');
      } catch { return false; }
    }
    function fetchInitWithCsrf(input, init) {
      const nextInit = init || {};
      if (!state?.csrfToken || !isStateChangingMethod(requestMethod(input, nextInit)) || !isDaemonApiRequest(input)) return nextInit;
      const baseHeaders = nextInit.headers || (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined);
      const headers = new Headers(baseHeaders || undefined);
      if (!headers.has('X-WhatsAgent-CSRF')) headers.set('X-WhatsAgent-CSRF', state.csrfToken);
      return { ...nextInit, headers };
    }
    function redirectToLogin() {
      if (authRedirecting || window.location.pathname === '/login') return;
      authRedirecting = true;
      window.location.href = '/login';
    }
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async function whatsAgentFetch(input, init) {
      const nextInit = fetchInitWithCsrf(input, init);
      const res = await nativeFetch(input, nextInit);
      if (res.status === 401 && isDaemonApiRequest(input)) redirectToLogin();
      return res;
    };

    function workspaceFetch(suffix, init = {}) {
      return fetch(wsApiUrl(suffix), { ...init, signal: workspaceAbortController.signal });
    }

    function workspaceFetchFor(id, suffix, init = {}) {
      return fetch(wsApiUrlFor(id, suffix), { ...init, signal: workspaceAbortController.signal });
    }

    function registerResetHook(fn) {
      if (typeof fn === 'function') resetHooks.push(fn);
    }

    function clearObject(value) {
      Object.keys(value || {}).forEach(key => { delete value[key]; });
    }
    function wsApiUrl(suffix) { const id = state.currentWorkspace?.id; if (!id) throw new Error('no_workspace'); return '/api/v1/workspaces/' + encodeURIComponent(id) + suffix; }
    function wsApiUrlFor(id, suffix) { return '/api/v1/workspaces/' + encodeURIComponent(id) + suffix; }
    function daemonApiUrl(suffix) { return '/api/v1' + suffix; }
    async function logoutWebSession() {
      try { await fetch(daemonApiUrl('/auth/logout'), { method: 'POST' }); } finally { redirectToLogin(); }
    }
    let page = 'agents';
    let activeTerminal = 'overview';
    let agentsSubView = 'overview';
    let agentsConfigRole = '';
    let selectedThread = state.roles[0]?.name || '';
    let selectedPeer = '';
    let pendingMessageScroll = '';
    let selectedLaunchRole = state.roles[0]?.name || '';
    let selectedLaunchHost = 'default';
    let selectedSettingsTab = 'preferences';
    let openLaunchMenuRole = '';
    let messages = [];
    let messagesLoaded = false;
    let messagesLoading = false;
    let messagesSnapshot = '';
    let optimisticMessageIds = new Set();
    let messageError = '';
    let mobileMessagesView = 'list';
    let messagePollTimer = null;
    let statusPollTimer = null;
    let statusPollFailures = 0;
    let messagePollFailures = 0;
    let lastStatusLoadOk = true;
    let lastMessageLoadOk = true;
    let runnerSnapshot = '';
    let repoRoleSnapshot = '';
    let mobileSidebarOpen = false;
    // EP-004 WA-015: single registry for outside-click + Escape dismiss
    // across every dropdown surface in the app. Each spec is
    // { rootSelector: string, isOpen: () => boolean, dismiss: () => void }.
    // Modules register from inside their install fns via the ctx wire.
    const dropdownDismissers = [];
    function bindDropdownDismiss(spec) {
      if (!spec || typeof spec.isOpen !== 'function' || typeof spec.dismiss !== 'function') return;
      dropdownDismissers.push(spec);
    }
    document.addEventListener('click', e => {
      const target = e.target instanceof Element ? e.target : null;
      for (const spec of dropdownDismissers) {
        try {
          if (!spec.isOpen()) continue;
          if (target && spec.rootSelector && target.closest(spec.rootSelector)) continue;
          spec.dismiss();
        } catch {}
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      for (const spec of dropdownDismissers) {
        try { if (spec.isOpen()) spec.dismiss(); } catch {}
      }
    });
    // EP-029 T4: terminal lifecycle owned by TerminalController.
    // Legacy state vars retained as null-stubs because main.ts still has
    // a few residual readers (debug overlay, detachXterm, workspace-
    // switch reset). Controller drives behavior; these reads see
    // null/false/empty and short-circuit. Decommissioned by a follow-up
    // sweep once readers are converted to controller.getStats().
    let terminalPollTimer = null;
    let terminalWs = null;
    let terminalWsRole = null;
    let activeXterm = null;
    let activeFitAddon = null;
    let activeWebglAddon = null;
    let activeXtermRole = null;
    let activeXtermRenderer = 'none';
    let activeXtermWebglContextLosses = 0;
    let activeXtermDetached = false;
    let activeResizeObserver = null;
    let activeTerminalTouchCleanup = null;
    let activeTerminalWheelCleanup = null;
    let activeTerminalDebugCleanups = [];
    let activeTerminalRenderEmitted = false;
    let openCodeTerminalRecoveryDone = {};
    const terminalResizeRects = new WeakMap();
    const terminalPollLogged = {};
    let openQuickPromptsForNudge = () => false;
    let lastTerminalSizeSent = '';
    const terminalCursors = {};
    const terminalSessions = {};
    let terminalController = null;
    let specialKeysOverlay = null;
    function currentTuiRedrawSettings() {
      return state.daemonSettings?.tuiRedraw || { workaround: 'on' };
    }
    function syncTuiRedrawController() {
      try { terminalController?.setPulseEnabled(currentTuiRedrawSettings().workaround === 'on'); } catch {}
    }
    function patchClientState(partial) {
      state = { ...state, ...partial };
      if (partial && Object.prototype.hasOwnProperty.call(partial, 'daemonSettings')) syncTuiRedrawController();
    }
    const terminalDebugParams = new URLSearchParams(location.search);
    const terminalDebug = {
      enabled: terminalDebugParams.get('debug') === 'xterm' || terminalDebugParams.get('xtermDebug') === '1',
      disableWebgl: ['0', 'false', 'off', 'dom'].includes(String(terminalDebugParams.get('xtermWebgl') || terminalDebugParams.get('xtermRenderer') || '').toLowerCase()),
      disableGpuLayer: ['0', 'false', 'off'].includes(String(terminalDebugParams.get('xtermGpuLayer') || '').toLowerCase()),
    };
    const terminalDebugStats = { wsMessages: 0, wsOutputFrames: 0, wsEventsReceived: 0, httpPolls: 0, httpEventsReceived: 0, resizePulses: 0, resizeSends: 0, fitCalls: 0, lastWsCursor: 0, lastPollCursor: 0 };
    const terminalStatusNotified = {};
    const notifiedRunnerExitKeys = {};
    const attentionRoles = {};
    let navMessageUnreadCount = 0;
    let dmNewMarker = { threadKey: '', markerId: 0, count: 0 };
    let notificationLog = { version: 1, events: [], lastReadAt: 0 };
    let notificationPrefs = null;
    let notificationPopoverOpen = false;
    const notificationToastQueue = [];
    const TAB_ID = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : ('tab-' + Math.random().toString(36).slice(2));
    let lastSoundPlayAt = 0;
    const previousRunnerStateForNotifs = {};
    const HUMAN_PEER = 'human-web';
    const MESSAGE_POLL_MS = 2000;
    const STATUS_POLL_MS = 3000;
    const PREF_STORAGE_KEY = 'whatsagent.ui.preferences';
    const DEFAULT_PREFS = {
      uiPrefsVersion: 2,
      theme: 'auto',
      accentColor: 'indigo',
      messageAutoScroll: 'smart',
      terminalDensity: 'compact',
      terminalFontSize: 12,
      terminalLineHeight: 1,
      terminalMouseMode: 'tui',
      notifyMessages: true,
      notifyRunnerExits: true,
      sidebarCollapsed: false,
      // EP-023 / WA-104. When ON, terminalDebugLog() events plus a 5s
      // periodic snapshot get batched and POSTed to /api/v1/client-debug,
      // then appended by the daemon to ~/.whatsagent/logs/xterm-debug.log.
      // Off by default. Browser-local toggle (debug aid).
      xtermDebugCapture: false,
    };
    let prefs = loadPreferences();
    if (terminalDebug.disableGpuLayer) document.documentElement.dataset.xtermGpuLayer = 'off';
    window.__whatsagentXtermDebug = {
      config: terminalDebug,
      screenshot: 'Open terminal with ?debug=xterm, capture visible terminal + overlay, then paste window.__whatsagentXtermDebug.snapshot() JSON.',
      stats: terminalDebugStats,
      snapshot: () => terminalDebugSnapshot(),
      refresh: () => updateTerminalDebugOverlay(),
      // EP-023 / WA-104. Tests inspect these to verify the live capture
      // wiring; Diagnostics panel reads `captureStatus()` to render the
      // status row.
      captureStatus: () => debugCaptureStatus(),
      flushNow: () => flushDebugCapture(),
    };

    const $ = (id) => document.getElementById(id);
    const esc = (value) => String(value ?? '').replace(/[&<>\"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
    const shortPath = (value) => String(value || '').replace(state.root, '~');
    // EP-DEC-RUN WA-006: match runners by display_id (`repo:role`),
    // bare-role.name fallback for legacy callers passing the bare name.
    const runnerStatusFor = (addr) => state.runners.find(r => r.display_id === addr || r.role === addr);
    const runnerFor = (role) => {
      const runner = runnerStatusFor(role);
      return runner?.reachable ? runner : undefined;
    };
    const roleDisplayId = (roleOrName) => {
      const role = typeof roleOrName === 'string' ? state.roles.find(r => r.name === roleOrName || r.display_id === roleOrName || r.displayId === roleOrName) : roleOrName;
      return role?.display_id || role?.displayId || role?.name || String(roleOrName || '');
    };
    const roleByAddress = (address) => state.roles.find(r => r.name === address || roleDisplayId(r) === address);
    const roleByName = roleByAddress;
    const hostLabel = (host) => host === 'opencode' ? 'OpenCode' : host === 'codex' ? 'Codex' : host === 'pi' ? 'Pi' : 'Claude Code';
    const hostClass = (host) => (host === 'opencode' ? 'openc' : host === 'codex' ? 'codex' : host === 'pi' ? 'pi' : 'claude');
    const activeTerminalRole = () => (page === 'agents' && agentsSubView === 'terminal' && activeTerminal !== 'overview') ? activeTerminal : null;
    const liveRunners = () => state.runners.filter(r => r.reachable);
    const validSettingsTab = validSettingsTabFromSettings;

    function clearAttention(role) {
      if (role) delete attentionRoles[role];
    }

    function markAttentionForMessages(newMessages) {
      let changed = false;
      for (const message of newMessages || []) {
        const role = message.from_role_name;
        if (!role || !runnerFor(role)) continue;
        if (page === 'agents' && agentsSubView === 'terminal' && activeTerminal === role) continue;
        if (!attentionRoles[role]) changed = true;
        attentionRoles[role] = true;
      }
      return changed;
    }

    function updateNavMessageIndicator() {
      const indicator = $('navMessageIndicator');
      if (!indicator) return;
      const count = navMessageUnreadCount;
      indicator.hidden = count <= 0;
      indicator.textContent = count > 99 ? '99+' : String(count || '');
      indicator.setAttribute('aria-label', count === 1 ? '1 new message' : count + ' new messages');
    }

    function clearNavMessageIndicator() {
      navMessageUnreadCount = 0;
      updateNavMessageIndicator();
    }

    function noteNavMessages(count) {
      if (!count || page === 'messages') return;
      navMessageUnreadCount = Math.min(999, navMessageUnreadCount + count);
      updateNavMessageIndicator();
    }

    function unreadDirectMessages(newMessages) {
      return (newMessages || []).filter(message => message.state === 'pending' && message.from_role_name && message.from_role_name !== HUMAN_PEER).length;
    }

    function currentDmThreadKey(inboxRoleName, peerId) {
      return (inboxRoleName || '') + '|' + (peerId || '');
    }

    function markDmNewMarker(newMessages, wasNearBottom) {
      if (page !== 'messages' || wasNearBottom || !selectedPeer) return;
      const selected = roleByAddress(selectedThread) || state.roles[0];
      const selectedDisplayId = roleDisplayId(selected);
      const incoming = (newMessages || []).filter(message => message.state === 'pending' && message.from_role_name && message.from_role_name !== HUMAN_PEER && messageInPeerThread(message, selectedDisplayId, selectedPeer));
      if (incoming.length === 0) return;
      const threadKey = currentDmThreadKey(selectedDisplayId, selectedPeer);
      if (dmNewMarker.threadKey !== threadKey || !dmNewMarker.markerId) dmNewMarker = { threadKey, markerId: Number(incoming[0].id) || 0, count: 0 };
      dmNewMarker.count += incoming.length;
    }

    function clearDmNewMarker() {
      dmNewMarker = { threadKey: '', markerId: 0, count: 0 };
      document.querySelector('[data-action="messages-jump-to-marker"]')?.remove();
    }

    function renderDmNewMarkerPill(threadKey) {
      if (dmNewMarker.threadKey !== threadKey || !dmNewMarker.markerId || dmNewMarker.count <= 0) return '';
      const label = dmNewMarker.count + ' new ' + (dmNewMarker.count === 1 ? 'message' : 'messages') + ' ↓';
      return '<button class="messages-new-marker-pill" data-action="messages-jump-to-marker" data-marker-id="' + esc(dmNewMarker.markerId) + '">' + esc(label) + '</button>';
    }

    function installDmNewMarkerScrollClear(threadKey) {
      const body = $('messageThreadBody');
      if (!body) return;
      body.addEventListener('scroll', () => {
        if (dmNewMarker.threadKey === threadKey && isMessageThreadNearBottom()) clearDmNewMarker();
      }, { passive: true });
    }

    function jumpToDmNewMarker(markerId) {
      const marker = document.querySelector('.bubble[data-message-id="' + String(markerId || '').replace(/"/g, '\\"') + '"]');
      clearDmNewMarker();
      if (marker) marker.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function agentTabDot(roleName, runner) {
      const cls = !runner ? 'offline' : attentionRoles[roleName] ? 'attention' : 'online';
      const label = cls === 'attention' ? 'online, attention needed' : cls === 'online' ? 'online' : 'offline';
      return '<span class="agent-tab-dot ' + cls + '" title="' + esc(label) + '"></span>';
    }

    function oneOf(value, allowed, fallback) {
      return allowed.includes(value) ? value : fallback;
    }

    function numberInRange(value, min, max, fallback) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
    }

    function normalizePreferences(input) {
      const source = input && typeof input === 'object' ? input : {};
      return {
        theme: oneOf(source.theme, ['auto', 'light', 'dark'], DEFAULT_PREFS.theme),
        accentColor: oneOf(source.accentColor, ['indigo', 'violet', 'blue', 'teal', 'rose', 'amber'], DEFAULT_PREFS.accentColor),
        messageAutoScroll: oneOf(source.messageAutoScroll, ['always', 'smart', 'off'], DEFAULT_PREFS.messageAutoScroll),
        terminalDensity: oneOf(source.terminalDensity, ['compact', 'default', 'comfortable'], DEFAULT_PREFS.terminalDensity),
        uiPrefsVersion: 2,
        terminalFontSize: source.uiPrefsVersion ? numberInRange(source.terminalFontSize, 10, 18, DEFAULT_PREFS.terminalFontSize) : (Number(source.terminalFontSize) === 12.5 ? DEFAULT_PREFS.terminalFontSize : numberInRange(source.terminalFontSize, 10, 18, DEFAULT_PREFS.terminalFontSize)),
        terminalLineHeight: source.uiPrefsVersion ? numberInRange(source.terminalLineHeight, 1, 1.25, DEFAULT_PREFS.terminalLineHeight) : (Number(source.terminalLineHeight) === 1.05 ? DEFAULT_PREFS.terminalLineHeight : numberInRange(source.terminalLineHeight, 1, 1.25, DEFAULT_PREFS.terminalLineHeight)),
        terminalMouseMode: oneOf(source.terminalMouseMode, ['tui', 'select'], DEFAULT_PREFS.terminalMouseMode),
        notifyMessages: source.notifyMessages === false ? false : true,
        notifyRunnerExits: source.notifyRunnerExits === false ? false : true,
        sidebarCollapsed: source.sidebarCollapsed === true,
        xtermDebugCapture: source.xtermDebugCapture === true,
      };
    }

    function loadPreferences() {
      try {
        const raw = localStorage.getItem(PREF_STORAGE_KEY);
        return normalizePreferences(raw ? JSON.parse(raw) : DEFAULT_PREFS);
      } catch {
        return normalizePreferences(DEFAULT_PREFS);
      }
    }

    function savePreferences() {
      try { localStorage.setItem(PREF_STORAGE_KEY, JSON.stringify(prefs)); } catch {}
    }

    function terminalDensitySettings() {
      return {
        compact: { fallbackLineHeight: 1.25, xtermPadding: '0', fallbackPadding: '8px 10px' },
        default: { fallbackLineHeight: 1.45, xtermPadding: '4px 6px', fallbackPadding: '12px 14px' },
        comfortable: { fallbackLineHeight: 1.65, xtermPadding: '8px 10px', fallbackPadding: '16px 18px' },
      }[prefs.terminalDensity] || { fallbackLineHeight: 1.25, xtermPadding: '0', fallbackPadding: '8px 10px' };
    }

    function terminalFontSize() {
      return numberInRange(prefs.terminalFontSize, 10, 18, DEFAULT_PREFS.terminalFontSize);
    }

    function terminalLineHeight() {
      return numberInRange(prefs.terminalLineHeight, 1, 1.3, DEFAULT_PREFS.terminalLineHeight);
    }

    // Estimate initial xterm grid cols/rows from the container's pixel size
    // and font metrics. Constructing Terminal with these instead of the
    // default 100x30 keeps the grid close to the fitted dimensions before
    // WS replay starts writing ring-buffer content. If the constructor
    // grid is too narrow, replayed lines wrap at the wrong column and the
    // later fit() upscale leaves those wraps in scrollback as duplicated /
    // ghost rows ("Re" artefacts) that survive until the user resizes the
    // browser. canvas.measureText is good enough — fit() refines later.
    // EP-029 T4: estimateInitialTerminalDims removed — TerminalController
    // ships open() at default 80×24 then applies the server's restore
    // frame dims atomically, so no pre-mount canvas measurement is
    // needed. WA-127 patch surface deleted alongside.

    function uiIsDark() {
      return prefs.theme === 'dark' || (prefs.theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    }

    function accentPalette() {
      const dark = uiIsDark();
      const palettes = {
        indigo: dark ? ['#818cf8', '#c7d2fe', '#1e1b4b', '#818cf8'] : ['#818cf8', '#4f46e5', '#eef2ff', '#818cf8'],
        violet: dark ? ['#a78bfa', '#ddd6fe', '#2e2147', '#a78bfa'] : ['#a78bfa', '#7c3aed', '#f5f3ff', '#a78bfa'],
        blue: dark ? ['#60a5fa', '#dbeafe', '#172554', '#60a5fa'] : ['#60a5fa', '#2563eb', '#eff6ff', '#60a5fa'],
        teal: dark ? ['#2dd4bf', '#ccfbf1', '#0d4d4a', '#2dd4bf'] : ['#2dd4bf', '#0f766e', '#f0fdfa', '#2dd4bf'],
        rose: dark ? ['#fb7185', '#ffe4e6', '#3b0a18', '#fb7185'] : ['#fb7185', '#e11d48', '#fff1f2', '#fb7185'],
        amber: dark ? ['#fbbf24', '#fef3c7', '#3b2a05', '#fbbf24'] : ['#fbbf24', '#d97706', '#fffbeb', '#fbbf24'],
      };
      return palettes[prefs.accentColor] || palettes.indigo;
    }

    function applyPreferences() {
      const root = document.documentElement;
      const density = terminalDensitySettings();
      root.dataset.theme = prefs.theme;
      root.dataset.sidebar = prefs.sidebarCollapsed ? 'collapsed' : 'expanded';
      const accent = accentPalette();
      root.style.setProperty('--accent', accent[0]);
      root.style.setProperty('--accent-dark', accent[1]);
      root.style.setProperty('--accent-light', accent[2]);
      root.style.setProperty('--accent-hex', accent[3]);
      root.style.setProperty('--terminal-font-size', terminalFontSize() + 'px');
      root.style.setProperty('--terminal-line-height', String(terminalLineHeight()));
      root.style.setProperty('--terminal-fallback-line-height', String(density.fallbackLineHeight));
      root.style.setProperty('--terminal-xterm-padding', density.xtermPadding);
      root.style.setProperty('--terminal-fallback-padding', density.fallbackPadding);
    }

    function setPreference(key, value) {
      if (key === 'terminalFontSize' || key === 'terminalLineHeight') value = Number(value);
      if (key === 'notifyMessages' || key === 'notifyRunnerExits' || key === 'sidebarCollapsed' || key === 'xtermDebugCapture') value = value === true || value === 'true';
      const wasCaptureOn = prefs && prefs.xtermDebugCapture === true;
      const next = { ...prefs, [key]: value };
      prefs = normalizePreferences(next);
      savePreferences();
      applyPreferences();
      if (key === 'xtermDebugCapture' && wasCaptureOn !== prefs.xtermDebugCapture) {
        applyDebugCaptureToggle(prefs.xtermDebugCapture);
      }
      if (page === 'settings') renderSettings();
    }

    function toggleSidebar() {
      setPreference('sidebarCollapsed', !prefs.sidebarCollapsed);
    }

    function setMobileSidebarOpen(open) {
      mobileSidebarOpen = Boolean(open);
      document.documentElement.dataset.mobileSidebar = mobileSidebarOpen ? 'open' : 'closed';
      document.querySelectorAll('[data-action="toggle-mobile-sidebar"]').forEach(btn => btn.setAttribute('aria-expanded', mobileSidebarOpen ? 'true' : 'false'));
    }

    function toggleMobileSidebar() {
      if (!window.matchMedia('(max-width: 760px)').matches) {
        toggleSidebar();
        return;
      }
      setMobileSidebarOpen(!mobileSidebarOpen);
    }

    function closeMobileSidebar() {
      if (mobileSidebarOpen) setMobileSidebarOpen(false);
    }

    function mobileSidebarTab() {
      return '<button type="button" class="term-tab mobile-sidebar-tab" data-action="toggle-mobile-sidebar" aria-label="Open navigation" aria-expanded="' + (mobileSidebarOpen ? 'true' : 'false') + '" aria-controls="appSidebar">' + '<span class="brand-logo"><img src="' + whatsAgentIconPath(whatsAgentIconAccent(), 32) + '" srcset="' + whatsAgentIconPath(whatsAgentIconAccent(), 32) + ' 1x, ' + whatsAgentIconPath(whatsAgentIconAccent(), 64) + ' 2x" width="24" height="24" alt="" aria-hidden="true" /></span></button>';
    }

    let mobileKeyboardFocusSeq = 0;
    let mobileKeyboardLastUserScrollAt = 0;
    function mobileKeyboardViewportMatches() {
      const width = Number(window.visualViewport?.width || window.innerWidth || document.documentElement.clientWidth || 0);
      return width <= 760 || Boolean(window.matchMedia?.('(max-width: 760px)').matches);
    }
    function mobileKeyboardFocusTarget(target) {
      if (!(target instanceof HTMLElement)) return null;
      if (!target.matches('input, textarea')) return null;
      if (target.matches('input[type="hidden"], input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"], input[type="range"], input[type="color"], input[readonly], textarea[readonly]')) return null;
      return target;
    }
    function noteMobileKeyboardUserScroll() {
      mobileKeyboardLastUserScrollAt = Date.now();
    }
    window.addEventListener('touchmove', noteMobileKeyboardUserScroll, { passive: true, capture: true });
    window.addEventListener('wheel', noteMobileKeyboardUserScroll, { passive: true, capture: true });
    function scheduleMobileKeyboardFocusScroll(target) {
      const seq = ++mobileKeyboardFocusSeq;
      const focusAt = Date.now();
      let done = false;
      let fallbackTimer = null;
      const cleanup = () => {
        if (fallbackTimer) clearTimeout(fallbackTimer);
        fallbackTimer = null;
        window.visualViewport?.removeEventListener?.('resize', onViewportResize);
      };
      const run = () => {
        if (done) return;
        done = true;
        cleanup();
        requestAnimationFrame(() => {
          if (seq !== mobileKeyboardFocusSeq) return;
          if (document.activeElement !== target) return;
          if (mobileKeyboardLastUserScrollAt > focusAt) return;
          target.scrollIntoView({ block: 'end', behavior: 'smooth' });
        });
      };
      const onViewportResize = () => setTimeout(run, 50);
      if (window.visualViewport?.addEventListener) window.visualViewport.addEventListener('resize', onViewportResize, { once: true });
      fallbackTimer = setTimeout(run, 300);
    }
    document.addEventListener('focusin', e => {
      const target = mobileKeyboardFocusTarget(e.target);
      if (!target || !mobileKeyboardViewportMatches()) return;
      scheduleMobileKeyboardFocusScroll(target);
    }, true);

    applyPreferences();

    window.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change', () => {
      if (prefs.theme === 'auto') applyPreferences();
    });

    function pageMeta() {
      return {
        overview: ['Overview', 'Fleet health and queue snapshot'],
        agents: ['Agents', 'Running sessions and terminals'],
        messages: ['Messages', 'Inbox and delivery history'],
        settings: ['Settings', 'Config, diagnostics, maintenance'],
      }[page] || ['Overview', 'Fleet health and queue snapshot'];
    }

    function peerIcon(host, size) {
      const cls = hostClass(host);
      return '<span class="peer-icon ' + cls + '" style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.max(10, Math.round(size * .46)) + 'px">' + (cls === 'openc' ? 'OC' : cls === 'codex' ? 'CX' : cls === 'pi' ? 'PI' : 'CC') + '</span>';
    }

    function badge(text, variant, dot) {
      return '<span class="badge ' + (variant || '') + '">' + (dot ? '<span class="live-dot" style="color:currentColor;width:6px;height:6px"></span>' : '') + esc(text) + '</span>';
    }

    function peerIdForMessage(message, inboxRoleName) {
      if (message.from_role_name === inboxRoleName) return message.to_role_name;
      if (message.to_role_name === inboxRoleName) return message.from_role_name || HUMAN_PEER;
      return null;
    }

    function peersForInbox(inboxRoleName) {
      const peers = new Map();
      for (const message of messages) {
        const id = peerIdForMessage(message, inboxRoleName);
        if (!id || id === inboxRoleName) continue;
        const current = peers.get(id) || { id, count: 0, last: message };
        current.count += 1;
        current.last = message;
        peers.set(id, current);
      }
      return Array.from(peers.values()).sort((a, b) => (b.last?.id || 0) - (a.last?.id || 0));
    }

    function messagesForPeerThread(inboxRoleName, peerId) {
      if (!inboxRoleName || !peerId) return [];
      return messages.filter(message => messageInPeerThread(message, inboxRoleName, peerId));
    }

    function messageInPeerThread(message, inboxRoleName, peerId) {
      if (!inboxRoleName || !peerId) return false;
      if (peerId === HUMAN_PEER) return humanWebThreadMessage(message, inboxRoleName);
      return (
        (message.from_role_name === inboxRoleName && message.to_role_name === peerId) ||
        (message.from_role_name === peerId && message.to_role_name === inboxRoleName)
      );
    }

    function humanWebThreadMessage(message, inboxRoleName) {
      return (message.to_role_name === inboxRoleName && (!message.from_role_name || message.from_role_name === HUMAN_PEER)) ||
        (message.from_role_name === inboxRoleName && message.to_role_name === HUMAN_PEER);
    }

    function peerName(peerId) {
      return peerId === HUMAN_PEER ? 'human-web' : peerId;
    }

    function peerHost(peerId) {
      return peerId === HUMAN_PEER ? 'claude-code' : (roleByName(peerId)?.host_default || runnerFor(peerId)?.host_type || 'claude-code');
    }

    function formatMessageTime(value) {
      const date = new Date(value || '');
      if (Number.isNaN(date.getTime())) return String(value || '');
      return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function renderExitCard(role, runner) {
      const roleName = role?.name || runner?.display_id || runner?.role || 'this agent';
      const status = runner?.exit_code != null ? 'Exit code ' + runner.exit_code : (runner?.exit_signal ? 'Signal ' + runner.exit_signal : 'Exited');
      const timestamp = runner?.exited_at ? formatMessageTime(runner.exited_at) : 'Exit time unavailable';
      const outputTail = stripAnsi(runner?.output_tail || '').trimEnd();
      const output = outputTail ? '<details class="terminal-exit-output"><summary>Show last output ▾</summary><pre>' + esc(outputTail) + '</pre></details>' : '';
      return '<div class="terminal-exit-card" role="status"><div class="terminal-exit-eyebrow">Session ended</div><h2>' + esc(roleName) + '</h2><div class="terminal-exit-meta"><span>' + esc(status) + '</span><span>' + esc(timestamp) + '</span></div><p class="terminal-exit-cta">Launch ' + esc(roleName) + ' again</p>' + output + '</div>';
    }

    function messageSnapshotFor(nextMessages) {
      return JSON.stringify(nextMessages.map(message => [message.id, message.from_role_name || '', message.to_role_name || '', message.state || '', message.sent_at || '', message.body || '', message.error || '']));
    }

    function directMessageId(message) {
      const id = Number(message?.id || 0);
      return Number.isFinite(id) && id > 0 ? id : 0;
    }

    function sortDirectMessages(items) {
      return items.slice().sort((a, b) => directMessageId(a) - directMessageId(b));
    }

    function clearDirectMessageCache() {
      messages = [];
      messagesLoaded = false;
      messagesSnapshot = '';
      optimisticMessageIds.clear();
    }

    function upsertLocalMessage(message, opts = {}) {
      const id = directMessageId(message);
      if (!id) return false;
      const index = messages.findIndex(item => directMessageId(item) === id);
      if (index >= 0) messages = messages.map((item, i) => i === index ? message : item);
      else messages = sortDirectMessages([...messages, message]);
      if (opts.optimistic) optimisticMessageIds.add(id);
      messagesSnapshot = messageSnapshotFor(messages);
      messagesLoaded = true;
      return true;
    }

    function mergeOptimisticMessages(nextMessages) {
      const nextIds = new Set(nextMessages.map(directMessageId).filter(Boolean));
      nextIds.forEach(id => optimisticMessageIds.delete(id));
      if (optimisticMessageIds.size === 0) return nextMessages;
      const preserved = messages.filter(message => {
        const id = directMessageId(message);
        return id && optimisticMessageIds.has(id) && !nextIds.has(id);
      });
      return preserved.length ? sortDirectMessages([...nextMessages, ...preserved]) : nextMessages;
    }

    function maxMessageId(items) {
      return items.reduce((max, message) => Math.max(max, directMessageId(message)), 0);
    }

    function isMessageThreadNearBottom() {
      const el = $('messageThreadBody');
      if (!el) return true;
      return el.scrollHeight - el.scrollTop - el.clientHeight < 96;
    }

    function scrollMessageThreadToBottom() {
      const el = $('messageThreadBody');
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    }

    function applyMessageScroll(mode, wasNearBottom) {
      if (prefs.messageAutoScroll === 'off') return;
      const shouldScroll = mode === 'bottom' || prefs.messageAutoScroll === 'always' || (prefs.messageAutoScroll === 'smart' && wasNearBottom);
      if (!shouldScroll) return;
      requestAnimationFrame(() => {
        scrollMessageThreadToBottom();
        requestAnimationFrame(scrollMessageThreadToBottom);
      });
    }

    function truncateText(value, limit) {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      return text.length > limit ? text.slice(0, limit - 3) + '…' : text;
    }

    function notificationsSupported() {
      return typeof Notification === 'function';
    }

    function updateNotificationButton() {
      const btn = $('notificationBtn');
      if (!btn) return;
      if (!notificationsSupported()) {
        btn.disabled = true;
        btn.dataset.notificationState = 'off';
        btn.setAttribute('aria-label', 'Notifications unavailable');
        btn.setAttribute('data-tip', 'Notifications unavailable');
        return;
      }
      const permission = Notification.permission;
      btn.disabled = permission === 'denied';
      btn.dataset.notificationState = permission === 'denied' ? 'off' : 'on';
      const label = permission === 'denied' ? 'Notifications blocked' : 'Notifications';
      btn.setAttribute('aria-label', label);
      btn.setAttribute('data-tip', label);
    }

    async function enableNotifications() {
      if (!notificationsSupported()) return;
      if (Notification.permission === 'default') {
        const requested = Notification.requestPermission();
        if (requested && typeof requested.catch === 'function') await requested.catch(() => undefined);
      }
      updateNotificationButton();
    }

    function notifyBrowser(title, opts = {}) {
      if (!notificationsSupported() || Notification.permission !== 'granted') return;
      try {
        const notification = new Notification(title, opts);
        notification.onclick = () => window.focus();
        setTimeout(() => notification.close(), 8000);
      } catch {}
    }

    function notifyNewMessages(newMessages) {
      if (!prefs.notifyMessages) return;
      const pending = newMessages.filter(message => message.state === 'pending' && message.from_role_name && message.from_role_name !== HUMAN_PEER);
      if (pending.length === 0) return;
      if (pending.length === 1) {
        const message = pending[0];
        notifyBrowser('WhatsAgent message: ' + message.from_role_name + ' -> ' + message.to_role_name, {
          body: truncateText(message.body, 180),
          tag: 'whatsagent-message-' + message.id,
        });
        return;
      }
      notifyBrowser(pending.length + ' new WhatsAgent messages', {
        body: pending.slice(0, 5).map(message => message.from_role_name + ' -> ' + message.to_role_name).join('\\n'),
        tag: 'whatsagent-messages',
      });
    }

    async function loadMessages(opts = {}) {
      if (!shouldPollWorkspace()) return false;
      if (messagesLoading) return false;
      const gen = state.workspaceGeneration;
      const wasNearBottom = isMessageThreadNearBottom();
      const initialLoad = !messagesLoaded;
      messagesLoading = true;
      let changed = false;
      let attentionChanged = false;
      let stale = false;
      if (!opts.silent) messageError = '';
      try {
        const hadLoaded = messagesLoaded;
        const previousMaxId = maxMessageId(messages);
        const res = await workspaceFetch('/messages?limit=500');
        const body = await res.json().catch(() => ({}));
        if (gen !== state.workspaceGeneration) { stale = true; return false; }
        if (!res.ok || body.ok === false) throw new Error(body.error || 'Failed to load messages');
        const nextMessages = mergeOptimisticMessages(Array.isArray(body.messages) ? body.messages : []);
        const nextSnapshot = messageSnapshotFor(nextMessages);
        changed = !messagesLoaded || nextSnapshot !== messagesSnapshot;
        messages = nextMessages;
        messagesSnapshot = nextSnapshot;
        messagesLoaded = true;
        lastMessageLoadOk = true;
        if (hadLoaded && changed) {
          const newMessages = nextMessages.filter(message => (Number(message.id) || 0) > previousMaxId);
          attentionChanged = markAttentionForMessages(newMessages);
          noteNavMessages(unreadDirectMessages(newMessages));
          markDmNewMarker(newMessages, wasNearBottom);
          if (!opts.suppressNotifications) notifyNewMessages(newMessages);
        }
      } catch (e) {
        stale = gen !== state.workspaceGeneration;
        if (!stale) {
          changed = !opts.silent;
          lastMessageLoadOk = false;
          if (!opts.silent) messageError = String(e?.message || e);
        }
      } finally {
        messagesLoading = false;
        if (!stale) {
          if (attentionChanged && page === 'agents') render();
          if (opts.rerender !== false && page === 'messages' && (!opts.onlyIfChanged || changed)) renderMessages({ scrollMode: opts.scrollMode || (initialLoad ? 'bottom' : 'auto'), wasNearBottom });
        }
      }
      return changed;
    }

    function scheduleMessagePoll(delay) {
      if (messagePollTimer) clearTimeout(messagePollTimer);
      // Backoff doubles delay per consecutive failure (2s -> 4s -> 8s -> 16s -> 30s cap).
      // Hidden tab uses an explicit long delay; visibilitychange handler wakes it up.
      const fallback = document.hidden ? 60000 : Math.min(MESSAGE_POLL_MS * Math.max(1, 1 << messagePollFailures), 30000);
      const ms = typeof delay === 'number' ? delay : fallback;
      messagePollTimer = setTimeout(() => {
        messagePollTimer = null;
        void pollMessages();
      }, ms);
    }

    async function pollMessages() {
      if (!shouldPollWorkspace()) { scheduleMessagePoll(); return; }
      if (document.hidden) { scheduleMessagePoll(); return; }
      await loadMessages({ rerender: true, silent: true, onlyIfChanged: true });
      messagePollFailures = lastMessageLoadOk ? 0 : Math.min(messagePollFailures + 1, 4);
      scheduleMessagePoll();
    }

    // EP-DEC-RUN WA-006 (advisor msg #28): runner identity in client-side
    // bookkeeping uses display_id (`repo:role`) so two same-bare-name
    // runners do not collide on snapshot, exit-key, or browser-tag state.
    function runnerAddrId(runner) { return runner.display_id || runner.role; }

    function runnerSnapshotFor(runners) {
      return JSON.stringify((runners || []).map(runner => [
        runnerAddrId(runner),
        runner.session_id,
        Boolean(runner.reachable),
        runner.status || '',
        runner.runner_pid || 0,
        runner.child_pid || 0,
        runner.exit_code ?? '',
        runner.exit_signal || '',
        runner.exited_at || '',
      ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1]))));
    }

    // EP-002 WA-007: detect repo/role list changes between polls so
    // background updates (e.g. scan-on-startup populating repos after the
    // server-injected initial state was empty) trigger a rerender. Without
    // this, the agents-overview empty state stays until the user clicks
    // a sidebar nav button, which forces an unconditional render().
    function repoRoleSnapshotFor(stateLike) {
      const repos = (stateLike?.repos || []).map(repo => [String(repo.id || ''), String(repo.name || ''), String(repo.absolutePath || repo.path || '')]).sort((a, b) => a[0].localeCompare(b[0]));
      const roles = (stateLike?.roles || []).map(role => [String(role.id || ''), String(role.name || ''), String(role.repo_id || role.repoId || ''), String(role.path || ''), String(role.host_default || ''), String(role.display_id || ''), String(role.summary || ''), (role.roles || []).join(',')]).sort((a, b) => a[0].localeCompare(b[0]));
      const main = stateLike?.mainRole?.id || stateLike?.mainRole?.name || '';
      return JSON.stringify({ repos, roles, main });
    }

    function runnerExitKey(runner) {
      return [runnerAddrId(runner), runner.session_id].join(':');
    }

    function seedRunnerExitNotifications(runners) {
      for (const runner of runners || []) {
        if (!runner.reachable && (runner.status === 'exited' || runner.exit_code != null || runner.exit_signal)) notifiedRunnerExitKeys[runnerExitKey(runner)] = true;
      }
    }

    function notifyRunnerExits(nextRunners, previousRunners) {
      if (!prefs.notifyRunnerExits) return;
      const previousBySession = new Map((previousRunners || []).map(runner => [runnerAddrId(runner) + ':' + runner.session_id, runner]));
      for (const runner of nextRunners || []) {
        const addr = runnerAddrId(runner);
        const previous = previousBySession.get(addr + ':' + runner.session_id);
        if (runner.reachable || !(previous?.reachable || runner.status === 'exited')) continue;
        const key = runnerExitKey(runner);
        if (notifiedRunnerExitKeys[key]) continue;
        notifiedRunnerExitKeys[key] = true;
        const detail = runner.exit_code != null ? 'exit code ' + runner.exit_code : (runner.exit_signal ? 'signal ' + runner.exit_signal : 'offline');
        notifyBrowser('WhatsAgent agent exited: ' + addr, {
          body: detail,
          tag: 'whatsagent-runner-' + addr,
        });
      }
    }

    function updateLiveCounts() {
      if ($('liveRoleCount')) $('liveRoleCount').textContent = liveRunners().length;
      if ($('navAgentCount')) $('navAgentCount').textContent = liveRunners().length;
    }

    function hiddenNotificationPollingEnabled() {
      return document.hidden && notificationPrefs && (notificationPrefs.browserEnabled || notificationPrefs.enabled);
    }

    function scheduleStatusPoll(delay) {
      if (statusPollTimer) clearTimeout(statusPollTimer);
      // Backoff doubles delay per consecutive failure (3s -> 6s -> 12s -> 24s -> 60s cap).
      // Hidden tab uses an explicit long delay; visibilitychange handler wakes it up.
      const fallback = document.hidden
        ? (hiddenNotificationPollingEnabled() ? 5000 : 60000)
        : Math.min(STATUS_POLL_MS * Math.max(1, 1 << statusPollFailures), 60000);
      const ms = typeof delay === 'number' ? delay : fallback;
      statusPollTimer = setTimeout(() => {
        statusPollTimer = null;
        void pollStatus();
      }, ms);
    }

    async function pollStatus() {
      if (!shouldPollWorkspace()) { scheduleStatusPoll(); return; }
      if (document.hidden && !hiddenNotificationPollingEnabled()) { scheduleStatusPoll(); return; }
      const gen = state.workspaceGeneration;
      try {
        const previousRunners = state.runners || [];
        const next = await workspaceFetch('/status').then(r => r.json());
        if (gen !== state.workspaceGeneration) return;
        const nextState = { ...state, ...next };
        const nextSnapshot = runnerSnapshotFor(nextState.runners || []);
        const nextRepoRole = repoRoleSnapshotFor(nextState);
        const runnerChanged = nextSnapshot !== runnerSnapshot;
        const repoRoleChanged = nextRepoRole !== repoRoleSnapshot;
        notifyRunnerExits(nextState.runners || [], previousRunners);
        state = nextState;
        syncTuiRedrawController();
        if (runnerChanged || repoRoleChanged) {
          runnerSnapshot = nextSnapshot;
          repoRoleSnapshot = nextRepoRole;
          if (runnerChanged) updateLiveCounts();
          const activeRole = activeTerminalRole();
          // EP-DEC-RUN WA-006: activeTerminal stores displayId; match
          // the runner via display_id with a bare-name compat fallback.
          const activeNext = activeRole ? (state.runners || []).find(runner => runner.display_id === activeRole || runner.role === activeRole) : null;
          const activePrev = activeRole ? previousRunners.find(runner => runner.display_id === activeRole || runner.role === activeRole) : null;
          // EP-002 WA-009: also rerender when the active role's runner
          // transitions from unreachable → reachable. After launch() the
          // /launch endpoint typically returns before the runner registers
          // with the daemon, so the immediately-following render() saw
          // !reachable and mounted the offline placeholder. The next poll
          // sees the runner reachable but used to skip render here, so the
          // TUI never mounted until the user F5'd.
          const activeBecameReachable = Boolean(activeRole) && Boolean(activeNext?.reachable) && !activePrev?.reachable;
          // EP-002 WA-007: also rerender on repo/role-list changes so the
          // initial empty agents-overview ("No repositories yet") recovers
          // once scan-on-startup populates state, without needing a click.
          if (repoRoleChanged || activeBecameReachable || page !== 'agents' || agentsSubView !== 'terminal' || (activeRole && !activeNext?.reachable)) render();
        }
        lastStatusLoadOk = true;
      } catch { lastStatusLoadOk = false; }
      statusPollFailures = lastStatusLoadOk ? 0 : Math.min(statusPollFailures + 1, 4);
      scheduleStatusPoll();
    }

    async function refresh() {
      if (!shouldPollWorkspace()) return;
      const gen = state.workspaceGeneration;
      const next = await workspaceFetch('/status').then(r => r.json());
      if (gen !== state.workspaceGeneration) return;
      notifyRunnerExits(next.runners || [], state.runners || []);
      state = { ...state, ...next };
      syncTuiRedrawController();
      runnerSnapshot = runnerSnapshotFor(state.runners || []);
      repoRoleSnapshot = repoRoleSnapshotFor(state);
      if (!selectedThread && state.roles[0]) selectedThread = state.roles[0].name;
      if (!selectedLaunchRole && state.roles[0]) selectedLaunchRole = state.roles[0].name;
      if (page === 'messages') await loadMessages({ rerender: false });
      render();
    }

    async function setMain(role) {
      if (!role) return;
      const res = await fetch(wsApiUrl('/main-role'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) });
      if (!res.ok) showToast(await res.text(), { variant: 'error' });
      await refresh();
    }

    async function launch(role, hostOverride) {
      const targetRole = role || selectedLaunchRole || $('launchRole')?.value;
      if (!targetRole) return;
      const host = hostOverride || (role ? 'default' : selectedLaunchHost);
      // EP-DEC-RUN WA-005 (advisor msg #20): UUID-keyed route; we have
      // the role row in state. Bare-name path would target the wrong
      // repo's row once WA-006 permits duplicate role names.
      const target = roleByAddress(targetRole);
      if (!target?.id) { showToast('Unknown agent: ' + targetRole, { variant: 'error' }); return; }
      const res = await fetch(wsApiUrl('/roles-by-id/') + encodeURIComponent(target.id) + '/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host })
      }).then(async r => ({ ok: r.ok, body: await r.json() }));
      // EP-DEC-RUN WA-006: terminal state keys on displayId.
      const targetDisplayId = target ? roleDisplayId(target) : targetRole;
      terminalStatusNotified[targetDisplayId] = '';
      clearAttention(targetDisplayId);
      openLaunchMenuRole = '';
      activeTerminal = targetDisplayId;
      agentsSubView = 'terminal';
      agentsConfigRole = '';
      page = 'agents';
      $('launchModal').classList.add('hidden');
      // EP-002 WA-009: update the URL so F5 lands back on the freshly
      // launched role's TUI tab instead of dropping the user back on the
      // agents-overview slug.
      updateUrl();
      await refresh();
      if (!res.ok) appendTerminal(targetRole, NL + (res.body.message || JSON.stringify(res.body, null, 2)) + NL, 'status');
      scheduleTerminalPoll();
    }

    async function stopRole(role) {
      if (!role) return;
      // EP-DEC-RUN WA-005: UUID-keyed route; bare name would collide.
      const target = roleByAddress(role);
      if (!target?.id) return;
      await fetch(wsApiUrl('/roles-by-id/') + encodeURIComponent(target.id) + '/stop', { method: 'POST' });
      await refresh();
    }

    async function sendWebMessage() {
      const selected = roleByAddress(selectedThread) || state.roles[0];
      const input = $('messageCompose');
      const body = String(input?.value || '').trim();
      if (!selected || !body) return;
      const res = await fetch(wsApiUrl('/messages'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toRole: roleDisplayId(selected), body })
      });
      const payload = await res.json().catch(() => ({}));
      if (res.ok && payload.ok !== false) {
        if (input) input.value = '';
        messageError = '';
        selectedPeer = HUMAN_PEER;
        if (payload.message) upsertLocalMessage(payload.message, { optimistic: true });
      } else {
        messageError = payload.error || 'Message send failed';
      }
      await loadMessages({ rerender: false });
      renderMessages({ scrollMode: 'bottom', wasNearBottom: true });
    }

    async function switchWorkspace(id, opts = {}) {
      if (!id || id === state.currentWorkspace?.id) return;
      abortInFlight();
      const gen = state.workspaceGeneration;
      const target = (state.workspaces || []).find(item => item.id === id) || { id, name: id };
      state.pendingWorkspaceId = id;
      state.nextWorkspace = { id: target.id, name: target.name };
      clearDirectMessageCache();
      messagesLoading = false;
      messageError = '';
      selectedThread = '';
      selectedPeer = '';
      pendingMessageScroll = 'bottom';
      activeTerminal = 'overview';
      agentsSubView = 'overview';
      agentsConfigRole = '';
      clearObject(terminalCursors);
      clearObject(terminalSessions);
      clearObject(terminalStatusNotified);
      clearObject(notifiedRunnerExitKeys);
      clearObject(attentionRoles);
      clearNavMessageIndicator();
      clearDmNewMarker();
      // EP-029 WA-138: legacy close-WS call removed (helper deleted in
      // T4-d). disposeXterm() above already closes the controller's WS
      // via controller.dispose() → closeWs(), so the legacy call was
      // both a ReferenceError and redundant.
      disposeXterm('workspace-switch');
      if (statusPollTimer) clearTimeout(statusPollTimer);
      if (messagePollTimer) clearTimeout(messagePollTimer);
      if (terminalPollTimer) clearTimeout(terminalPollTimer);
      statusPollTimer = null;
      messagePollTimer = null;
      terminalPollTimer = null;
      for (const hook of resetHooks) {
        try { hook(id); } catch {}
      }
      try {
        if (opts.updateDaemonCurrent) {
          await fetch(daemonApiUrl('/workspaces/current'), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
          });
          if (gen !== state.workspaceGeneration) return;
        }
        const res = await workspaceFetchFor(id, '/status');
        const next = await res.json().catch(() => ({}));
        if (gen !== state.workspaceGeneration) return;
        if (!res.ok || next.ok === false) throw new Error(next.error || 'Workspace switch failed');
        state = { ...state, ...next, currentWorkspace: next.currentWorkspace || state.nextWorkspace, pendingWorkspaceId: null, nextWorkspace: null };
        selectedThread = state.roles[0]?.name || '';
        selectedLaunchRole = state.roles[0]?.name || '';
        runnerSnapshot = runnerSnapshotFor(state.runners || []);
        repoRoleSnapshot = repoRoleSnapshotFor(state);
        applyRouteFromLocation();
        updateUrl(true);
      } catch (e) {
        if (gen !== state.workspaceGeneration) return;
        state.pendingWorkspaceId = null;
        state.nextWorkspace = null;
        showToast(String(e?.message || e), { variant: 'error' });
      }
      render();
      scheduleMessagePoll(500);
      scheduleStatusPoll(1000);
    }

    function safeDecode(value) {
      try { return decodeURIComponent(value); } catch { return value; }
    }

    function routeParts() {
      return parseRoute(location.pathname);
    }

    function applyRouteFromLocation() {
      const parts = routeParts();
      const pageParts = parts.page;
      if (pageParts[0] === 'kanban') { applyKanbanRoute(parts); return; }
      if (parts.workspaceId === null && pageParts[0] === 'workspaces') {
        page = 'workspaces-overview';
        return;
      }
      if (pageParts[0] === 'agents') {
        page = 'agents';
        if (pageParts[1] === 'new') {
          agentsSubView = 'create';
          agentsConfigRole = '';
          return;
        }
        // EP-037 / WA-212: config/create routes are a separate agents
        // sub-view, not activeTerminal. Parse `/settings` before terminal
        // displayId fallback so config pages do not disturb terminal state.
        if (pageParts[1] && pageParts[2] === 'settings') {
          const found = roleByAddress(pageParts[1]);
          agentsSubView = 'config';
          agentsConfigRole = found ? roleDisplayId(found) : pageParts[1];
          return;
        }
        // EP-DEC-RUN WA-006: normalize URL slug to displayId so two
        // bare-name peers across repos route distinctly.
        if (pageParts[1]) {
          const found = roleByAddress(pageParts[1]);
          activeTerminal = found ? roleDisplayId(found) : 'overview';
          agentsSubView = found ? 'terminal' : 'overview';
        } else {
          activeTerminal = 'overview';
          agentsSubView = 'overview';
        }
        agentsConfigRole = '';
        return;
      }
      if (pageParts[0] === 'messages') {
        page = 'messages';
        if (pageParts[1] && roleByName(pageParts[1])) selectedThread = pageParts[1];
        selectedPeer = pageParts[2] || '';
        pendingMessageScroll = 'bottom';
        return;
      }
      if (pageParts[0] === 'settings') {
        page = 'settings';
        selectedSettingsTab = validSettingsTab(pageParts[1]);
        return;
      }
      page = state.currentWorkspace?.id ? 'agents' : 'workspaces-overview';
    }

    function pathForState() {
      if (page === 'kanban') return kanbanPathSegments();
      let tail = '/';
      if (page === 'workspaces-overview') tail = '/workspaces';
      else if (page === 'agents') {
        if (agentsSubView === 'create') tail = '/agents/new';
        else if (agentsSubView === 'config') tail = '/agents/' + encodeURIComponent(agentsConfigRole) + '/settings';
        else if (agentsSubView === 'terminal' && activeTerminal !== 'overview') tail = '/agents/' + encodeURIComponent(activeTerminal);
        else tail = '/agents';
      }
      else if (page === 'messages') {
        const inbox = selectedThread ? '/' + encodeURIComponent(selectedThread) : '';
        const peer = selectedPeer ? '/' + encodeURIComponent(selectedPeer) : '';
        tail = '/messages' + inbox + peer;
      } else if (page === 'settings') {
        tail = '/settings/' + encodeURIComponent(validSettingsTab(selectedSettingsTab));
      }
      return workspacePath(page === 'workspaces-overview' ? null : (state.currentWorkspace?.id ?? null), tail);
    }

    function updateUrl(replace = false) {
      if (!history?.pushState) return;
      const path = pathForState();
      if (path === location.pathname) return;
      history[replace ? 'replaceState' : 'pushState']({}, '', path);
    }

    function showPage(next, opts = {}) {
      if (next === 'kanban') { onKanbanPageSwitch(next, opts); return; }
      page = next || 'overview';
      if (page === 'agents') { agentsSubView = 'overview'; agentsConfigRole = ''; activeTerminal = 'overview'; }
      if (page === 'messages') pendingMessageScroll = 'bottom';
      render();
      if (!opts.skipRoute) updateUrl();
    }

    function isEditableShortcutTarget(target) {
      const tag = String(target?.tagName || '').toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(target?.isContentEditable);
    }

    function selectRoleTerminal(index) {
      const role = state.roles[index];
      if (!role) return false;
      page = 'agents';
      // EP-DEC-RUN WA-006: state keys (activeTerminal/attentionRoles/
      // terminalCursors/Sessions/StatusNotified) are displayId so two
      // roles with the same bare name across repos do not collide.
      activeTerminal = roleDisplayId(role);
      agentsSubView = 'terminal';
      agentsConfigRole = '';
      clearAttention(roleDisplayId(role));
      render();
      updateUrl();
      return true;
    }

    function selectAdjacent(delta) {
      if (page === 'agents') {
        const tabs = ['overview', ...state.roles.map(role => roleDisplayId(role))];
        const currentKey = agentsSubView === 'terminal' ? activeTerminal : 'overview';
        const current = Math.max(0, tabs.indexOf(currentKey));
        const next = tabs[(current + delta + tabs.length) % tabs.length] || 'overview';
        agentsSubView = next === 'overview' ? 'overview' : 'terminal';
        activeTerminal = next;
        agentsConfigRole = '';
        clearAttention(activeTerminal);
        render();
        updateUrl();
        return;
      }
      const pages = ['overview', 'agents', 'messages', 'settings'];
      const current = Math.max(0, pages.indexOf(page));
      showPage(pages[(current + delta + pages.length) % pages.length] || 'overview');
    }

    function disposeXterm(reason = 'unknown') {
      // EP-029 T4: terminal teardown lives in TerminalController.dispose.
      // Legacy state vars are reset to null defensively so any residual
      // reader (debug overlay, detachXterm) sees a consistent zeroed
      // state. WA-127 patch flags + WA-114 OpenCode recovery state +
      // browser-side cursor protocol are all gone.
      if (terminalController) {
        try { terminalController.dispose(reason); } catch {}
      }
      activeXterm = null;
      activeFitAddon = null;
      activeWebglAddon = null;
      activeXtermRole = null;
      activeXtermRenderer = 'none';
      activeXtermWebglContextLosses = 0;
      activeXtermDetached = false;
      activeResizeObserver = null;
      activeTerminalTouchCleanup = null;
      activeTerminalWheelCleanup = null;
      activeTerminalDebugCleanups = [];
      activeTerminalRenderEmitted = false;
      openCodeTerminalRecoveryDone = {};
      lastTerminalSizeSent = '';
      terminalWs = null;
      terminalWsRole = null;
    }

    function terminalParkingLot() {
      let el = document.getElementById('terminalParkingLot');
      if (!el) {
        el = document.createElement('div');
        el.id = 'terminalParkingLot';
        el.hidden = true;
        document.body.appendChild(el);
      }
      return el;
    }

    function detachXterm() {
      if (!activeXterm) return;
      if (activeResizeObserver) activeResizeObserver.disconnect();
      activeResizeObserver = null;
      const termEl = activeXterm.element;
      if (termEl && termEl.parentNode !== terminalParkingLot()) terminalParkingLot().appendChild(termEl);
      activeXtermDetached = true;
      lastTerminalSizeSent = '';
      updateTerminalDebugOverlay();
    }

    function observeActiveTerminalElement(el) {
      if (typeof ResizeObserver !== 'function' || !el) return;
      if (activeResizeObserver) activeResizeObserver.disconnect();
      activeResizeObserver = new ResizeObserver((entries) => {
        let changed = false;
        for (const entry of entries || []) {
          const rect = entry?.contentRect;
          if (!entry?.target || !rect) continue;
          const prev = terminalResizeRects.get(entry.target);
          if (prev && Math.abs(rect.width - prev.width) < 2 && Math.abs(rect.height - prev.height) < 2) continue;
          terminalResizeRects.set(entry.target, { width: rect.width, height: rect.height });
          changed = true;
        }
        if (changed) scheduleTerminalFit();
      });
      activeResizeObserver.observe(el);
    }

    function renderOverview() {
      detachXterm();
      const live = liveRunners().length;
      const total = state.roles.length;
      const claude = state.roles.filter(r => (runnerFor(r.name)?.host_type || r.host_default) !== 'opencode').length;
      const opencode = state.roles.length - claude;
      const main = state.mainRole?.name || 'unset';
      const content = $('content');
      const previousOverviewScroll = document.querySelector('.overview-page')?.scrollTop || 0;
      content.innerHTML = '<div class="overview-page"><div class="grid-stats">' +
        statCard('Daemon Status', 'Healthy', 'port ' + state.config.ui.port, 'var(--green)', true) +
        statCard('Running', live, 'active sessions', null, false) +
        statCard('Fleet Roles', total, 'registered agents', null, false) +
        statCard('Main Role', esc(main), main === 'unset' ? 'messaging blocked' : 'star hub', main === 'unset' ? 'var(--amber)' : null, false) +
      '</div>' +
      '<div class="two-col">' +
        '<section class="card card-pad"><div class="section-head"><div><h2>Agents by Type</h2></div></div>' + typeRow('claude-code', 'Claude Code', claude, total) + typeRow('opencode', 'OpenCode', opencode, total) + '</section>' +
        '<section class="card card-pad"><div class="section-head"><div><h2>Fleet Paths</h2></div></div>' + kv('Root', state.root, true) + kv('Database', '.whatsagent/whatsagent.sqlite', true) + kv('Daemon log', state.logPath || '.whatsagent/logs/daemon.log', true) + kv('Policy', state.policy.mode, true) + '</section>' +
      '</div>' +
      '<section class="card card-pad"><div class="section-head"><div><h2>Message Queue</h2><p>SQLite-backed messaging lands after terminal runner work</p></div></div><div class="queue-grid">' +
        queueItem('Pending', '0', 'Waiting to be polled', 'var(--amber)') + queueItem('Leased', '0', 'Polled, awaiting ack', '#60a5fa') + queueItem('Acked', '0', 'Successfully delivered', 'var(--green)') + queueItem('Rejected', '0', 'Strict-star blocked', 'var(--red)') +
      '</div></section></div>';
      if (previousOverviewScroll) requestAnimationFrame(() => {
        const next = document.querySelector('.overview-page');
        if (next) next.scrollTop = previousOverviewScroll;
      });
    }

    function statCard(label, value, sub, accent, dot) {
      return '<section class="card stat"><div class="stat-label">' + (dot ? '<span class="live-dot" style="color:var(--green)"></span>' : '') + esc(label) + '</div><div class="stat-value" style="' + (accent ? 'color:' + accent : '') + '">' + value + '</div><div class="stat-sub">' + esc(sub) + '</div></section>';
    }

    function typeRow(host, label, count, total) {
      const pct = total === 0 ? 0 : Math.round((count / total) * 100);
      const color = host === 'opencode' ? 'oklch(55% 0.14 160)' : 'oklch(60% 0.18 285)';
      return '<div class="type-row">' + peerIcon(host, 22) + '<div class="type-label">' + label + '</div><div class="type-count">' + count + '</div><div class="bar"><span style="width:' + pct + '%;background:' + color + '"></span></div></div>';
    }

    function queueItem(label, value, desc, color) {
      return '<div class="queue-item"><div class="stat-label" style="justify-content:center;margin-bottom:0"><span class="live-dot" style="color:' + color + ';width:7px;height:7px"></span>' + esc(label) + '</div><div class="queue-value" style="color:' + color + '">' + value + '</div><div class="queue-desc">' + esc(desc) + '</div></div>';
    }

    function kv(label, value, mono) {
      return '<div class="kv-row"><div class="kv-label">' + esc(label) + '</div><div class="kv-value ' + (mono ? 'mono' : '') + '">' + esc(value) + '</div></div>';
    }

    function settingRow(title, sub, control) {
      return '<div class="setting-row"><div class="setting-title">' + esc(title) + '</div><div class="setting-sub">' + esc(sub) + '</div>' + control + '</div>';
    }

    function prefControl(key, options, opts = {}) {
      const current = Object.prototype.hasOwnProperty.call(opts, 'currentValue') ? opts.currentValue : prefs[key];
      const action = opts.action || 'set-pref';
      const disabled = opts.disabled ? ' disabled' : '';
      const className = opts.className ? ' ' + esc(opts.className) : '';
      return '<div class="segmented' + className + '">' + options.map(option => {
        const value = option[0];
        const label = option[1];
        const active = String(current) === String(value) ? 'active' : '';
        return '<button class="seg-option ' + active + '" data-action="' + esc(action) + '" data-pref="' + esc(key) + '" data-value="' + esc(value) + '"' + disabled + '>' + esc(label) + '</button>';
      }).join('') + '</div>';
    }

    function lineHeightOptionButtons() {
      const options = [[1, 'Minimum'], [1.04, 'Relaxed'], [1.08, 'Roomy']];
      return options.map(option => {
        const value = option[0];
        const name = option[1];
        const numeric = Number(value).toFixed(2);
        const active = String(prefs.terminalLineHeight) === String(value) ? 'active' : '';
        return '<button class="seg-option line-height-option ' + active + '" data-action="set-pref" data-pref="terminalLineHeight" data-value="' + esc(value) + '" aria-label="' + esc(name) + ' line height ' + numeric + '">' +
          '<span class="line-height-option-text"><span class="line-height-option-name">' + esc(name) + '</span><span class="line-height-option-value">' + numeric + '</span></span>' +
          '<span class="line-height-option-preview" style="line-height:' + numeric + ';font-family:var(--font-mono);font-size:var(--terminal-font-size)">Wgqyj<br>Mgqj<br>Wgqyj</span>' +
        '</button>';
      }).join('');
    }
    function lineHeightControl() {
      return '<div class="segmented line-height-segmented">' + lineHeightOptionButtons() + '</div>';
    }

    function fontSizeSelect() {
      const sizes = [12, 12.5, 13.5, 15];
      return settingsDropdown('Terminal font size', terminalFontSize(), sizes.map(size => [size, size + 'px']), { inputAttrs: 'data-pref="terminalFontSize"', className: 'settings-font-size-dropdown' });
    }

    function notificationStatusLabel() {
      if (!notificationsSupported()) return 'unavailable';
      return Notification.permission;
    }

    function runnerPushLabel(runner) {
      if (!runner) return 'offline';
      return runner.native_push || (runner.reachable ? 'terminal nudge' : 'offline');
    }

    function runnerDiagnostics() {
      if (state.roles.length === 0) return '<div class="thread-empty" style="min-height:120px">No roles discovered.</div>';
      return '<div class="runner-list">' + state.roles.map(role => {
        // EP-DEC-RUN WA-006 (advisor msg #28): runnerStatusFor lookup
        // by displayId so duplicate-bare-name roles each show their own
        // runner.
        const runner = runnerStatusFor(roleDisplayId(role));
        const host = runner?.host_type || role.host_default;
        const status = runner?.reachable ? 'live' : (runner?.status || 'offline');
        const pid = runner?.runner_pid ? 'runner process ' + runner.runner_pid : 'no runner process';
        const childPid = runner?.child_pid ? ' child process ' + runner.child_pid : '';
        const redraw = runner?.tui_redraw ? ' · redraw ' + runner.tui_redraw.workaround + (runner.tui_redraw.pulse_count ? ' · pulses ' + runner.tui_redraw.pulse_count : '') : '';
        return '<div class="runner-diag"><div class="runner-diag-main">' + peerIcon(host, 24) + '<strong class="mono">' + esc(role.name) + '</strong>' + badge(status, runner?.reachable ? 'live' : 'pending', Boolean(runner?.reachable)) + '</div><div>' + badge(runnerPushLabel(runner), runner?.native_push ? 'claude' : '', false) + '</div><div class="runner-diag-meta">' + esc(hostLabel(host) + ' · ' + pid + childPid + ' · session ' + (runner?.session_id || 'none') + redraw) + '</div></div>';
      }).join('') + '</div>';
    }

    function settingsTabs() {
      return settingsTabsHtml();
    }

    function settingsPanel(cfg) {
      const fromSettings = renderSettingsTabContent(selectedSettingsTab);
      if (fromSettings != null) return fromSettings;
      const fromAgents = renderAgentsSettingsTabContent(selectedSettingsTab, cfg);
      if (fromAgents != null) return fromAgents;
      if (selectedSettingsTab === 'notifications') {
        return '<section class="card card-pad settings-wide"><div class="section-head"><div><h2>Notifications</h2><p>Browser permission plus local notification filters</p></div><button class="btn secondary small" data-action="enable-notifications">Enable</button></div>' +
          kv('Permission', notificationStatusLabel(), true) +
          settingRow('New messages', 'Notify for new agent-originated pending messages.', prefControl('notifyMessages', [[true, 'On'], [false, 'Off']])) +
          settingRow('Runner exits', 'Notify when a live agent session exits.', prefControl('notifyRunnerExits', [[true, 'On'], [false, 'Off']])) +
        '</section>';
      }
      if (selectedSettingsTab === 'fleet') {
        return '<section class="card card-pad settings-wide"><div class="section-head"><div><h2>Fleet</h2><p>Runtime state, paths, and TOML-backed launch defaults</p></div></div>' + kv('Fleet', cfg.fleet.name, false) + kv('Root', state.root, true) + kv('UI', cfg.ui.host + ':' + cfg.ui.port, true) + kv('Policy', cfg.policy.mode, true) + kv('Main role', state.mainRole?.name || 'not set', true) + kv('Daemon log', state.logPath || '.whatsagent/logs/daemon.log', true) + kv('Claude Code', cfg.commands.claudeCode.command + ' ' + cfg.commands.claudeCode.args.join(' '), true) + kv('OpenCode', cfg.commands.openCode.command + ' ' + cfg.commands.openCode.args.join(' '), true) + kv('Runner logs', '.whatsagent/logs/runner-<role>.log', true) + '</section>';
      }
      if (selectedSettingsTab === 'runners') {
        return '<section class="card card-pad settings-wide"><div class="section-head"><div><h2>Runner Diagnostics</h2><p>Native push capability and current runner metadata</p></div></div>' + runnerDiagnostics() + '</section>';
      }
      return '<section class="card card-pad settings-wide"><div class="section-head"><div><h2>Preferences</h2><p>Browser-local controls stored in localStorage</p></div></div>' +
        settingRow('Theme', 'Auto follows your OS color scheme.', prefControl('theme', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']])) +
        settingRow('Accent colour', 'Controls the app highlight colour on this browser.', prefControl('accentColor', [['indigo', 'Indigo'], ['violet', 'Violet'], ['blue', 'Blue'], ['teal', 'Teal'], ['rose', 'Rose'], ['amber', 'Amber']])) +
        settingRow('Messages auto-scroll', 'Smart only follows new messages when you are already near the bottom.', prefControl('messageAutoScroll', [['always', 'Always'], ['smart', 'Smart'], ['off', 'Off']])) +
        settingRow('Terminal density', 'Controls terminal padding without changing line spacing.', prefControl('terminalDensity', [['compact', 'Compact'], ['default', 'Default'], ['comfortable', 'Comfortable']])) +
        settingRow('Terminal line height', 'xterm cannot render below 1; Minimum is tuned for real TUIs.', lineHeightControl()) +
        settingRow('Terminal font size', 'Default uses a native terminal font stack.', settingsDropdown('Terminal font size', prefs.terminalFontSize, [10, 11, 12, 13, 14, 16, 18].map(size => [size, size + ' px']), { inputAttrs: 'data-pref="terminalFontSize"', className: 'settings-font-size-dropdown' })) +
        settingRow('Terminal mouse mode', 'Select Text keeps browser selection easier where xterm allows it.', prefControl('terminalMouseMode', [['tui', 'TUI mouse'], ['select', 'Select text']])) +
      '</section>';
    }

    function renderAgents() {
      if (agentsSubView === 'config') { renderAgentConfigPage(agentsConfigRole); return; }
      if (agentsSubView === 'create') { renderAgentCreatePage(); return; }
      if (agentsSubView === 'terminal' && activeTerminal !== 'overview') clearAttention(activeTerminal);
      const content = $('content');
      content.innerHTML = '<div class="agent-page">' + agentTabs() + '<div class="tab-content" id="agentTabContent"></div></div>';
      if (agentsSubView === 'overview' || activeTerminal === 'overview') renderAgentOverview(); else renderTerminal(activeTerminal);
    }

    // EP-002 WA-008: tab text contract = line 1 repo display name, line 2
    // role display name. Falls back to single-line role name when the repo
    // cannot be resolved (advisor msg #34: keep existing path/role
    // rendering for that case).
    function repoForRoleLookup(role) {
      const repos = state.repos || [];
      const repoId = role?.repo_id || role?.repoId || '';
      const repoName = role?.repo_name || role?.repoName || '';
      if (repoId) {
        const found = repos.find(repo => String(repo.id || '') === String(repoId));
        if (found) return found;
      }
      if (repoName) {
        const found = repos.find(repo => String(repo.name || '') === String(repoName));
        if (found) return found;
      }
      return null;
    }

    function agentTabLabelHtml(role) {
      const repo = repoForRoleLookup(role);
      const repoName = repo?.name || role?.repo_name || role?.repoName || '';
      if (!repoName) return '<span class="term-tab-label-name" ' + truncatedAttrs(role.name) + '>' + esc(role.name) + '</span>';
      return '<span class="term-tab-label"><span class="term-tab-label-repo" ' + truncatedAttrs(repoName) + '>' + esc(repoName) + '</span><span class="term-tab-label-name" ' + truncatedAttrs(role.name) + '>' + esc(role.name) + '</span></span>';
    }

    function agentTabs() {
      const tabs = state.roles.map(role => {
        const addr = roleDisplayId(role);
        const runner = runnerFor(addr);
        const active = agentsSubView === 'terminal' && activeTerminal === addr;
        return '<button class="term-tab ' + (active ? 'active terminal-active' : '') + '" data-action="terminal" data-role="' + esc(addr) + '" ' + truncatedAttrs(addr) + '>' + agentTabDot(addr, runner) + peerIcon(runner?.host_type || role.host_default, 16) + agentTabLabelHtml(role) + '</button>';
      }).join('');
      return '<div class="tabbar">' + mobileSidebarTab() + '<button class="term-tab agent-overview-tab ' + (agentsSubView === 'overview' ? 'active' : '') + '" data-action="terminal" data-role="overview">Overview <span class="badge">' + state.roles.length + '</span></button><div class="tabbar-scroll">' + tabs + '</div></div>';
    }

    function renderAgentOverview() {
      detachXterm();
      renderAgentsOverview();
    }

    function renderAgentOverviewIfVisible() {
      if (page === 'agents' && agentsSubView === 'overview') renderAgentOverview();
    }

    function closeLaunchMenu() {
      if (!openLaunchMenuRole) return;
      openLaunchMenuRole = '';
      renderAgentOverviewIfVisible();
    }
    // EP-004 WA-015: launch menu opts into the unified dismiss registry.
    // The legacy per-dispatcher close lines stay (idempotent — closeLaunchMenu
    // returns early when already closed) so existing behaviour on action
    // clicks doesn't regress while we collapse the cross-cutting concern.
    bindDropdownDismiss({
      rootSelector: '.launch-split, .launch-menu',
      isOpen: () => Boolean(openLaunchMenuRole),
      dismiss: () => closeLaunchMenu(),
    });
    bindDropdownDismiss({
      rootSelector: '.sidebar',
      isOpen: () => mobileSidebarOpen,
      dismiss: () => closeMobileSidebar(),
    });

    function ensureSpecialKeysOverlay() {
      if (specialKeysOverlay) return specialKeysOverlay;
      specialKeysOverlay = new SpecialKeysOverlay();
      return specialKeysOverlay;
    }

    function unmountSpecialKeysOverlay() {
      try { specialKeysOverlay?.unmount(); } catch {}
    }

    function syncSpecialKeysOverlay(role, runner, controller) {
      if (!runner || !controller || activeTerminal !== role) { unmountSpecialKeysOverlay(); return; }
      const terminalShell = $('agentTabContent')?.querySelector?.('.terminal');
      if (!terminalShell) { unmountSpecialKeysOverlay(); return; }
      ensureSpecialKeysOverlay().mount(terminalShell, controller);
    }

    function renderTerminal(roleName) {
      if (activeXterm && activeXtermRole === roleName) detachXterm();
      const role = roleByName(roleName);
      const runner = runnerFor(roleName);
      const latestRunner = runnerStatusFor(roleName);
      const host = runner?.host_type || latestRunner?.host_type || role?.host_default || 'claude-code';
      const title = role ? role.name + ' - ' + shortPath(role.path) : 'No role selected';
      const exited = latestRunner?.status === 'exited';
      const body = runner ? ['Connecting to ' + (role?.name || runner.role || 'this agent') + '…'].join(NL) : ['No active session for ' + (role?.name || 'this agent') + '.', '', 'Click Launch to start.'].join(NL);
      const useXterm = typeof Terminal === 'function';
      const debugOverlay = terminalDebug.enabled ? '<div class="terminal-debug-overlay" id="terminalDebugOverlay">xterm debug initializing</div>' : '';
      const exitCard = !runner && exited ? renderExitCard(role, latestRunner) : '';
      $('agentTabContent').innerHTML = '<div class="terminal" data-terminal-state="' + (runner ? 'live' : (exited ? 'exited' : 'offline')) + '" data-terminal-title="' + esc(title) + '"><div class="terminal-body" id="terminalBody" data-role="' + esc(roleName) + '">' + (exitCard || (useXterm ? '' : esc(body))) + '</div>' + debugOverlay + '<div class="terminal-input"><span>›</span><input id="terminalInput" placeholder="' + (runner ? 'Type a message to this agent…' : 'Launch agent to enable input') + '" ' + (runner ? '' : 'disabled') + ' /><kbd>↵</kbd></div></div>';
      const mountedController = !exitCard ? mountTerminal(roleName, body, Boolean(runner)) : null;
      syncSpecialKeysOverlay(roleName, runner, mountedController);
      codexNudgeToast(roleName);
      const pendingNudge = runner?.host_type === 'codex' ? runner.pending_nudge : null;
      if (pendingNudge) openQuickPromptsForNudge(roleName, pendingNudge.submitted_at || pendingNudge.queued_at || JSON.stringify(pendingNudge));
    }

    function renderMessages(opts = {}) {
      detachXterm();
      const wasNearBottom = opts.wasNearBottom ?? isMessageThreadNearBottom();
      const scrollMode = opts.scrollMode || pendingMessageScroll || 'auto';
      pendingMessageScroll = '';
      const previousCompose = $('messageCompose');
      const composeDraft = document.activeElement === previousCompose ? previousCompose.value : '';
      // EP-DEC-RUN WA-006 (advisor msg #24): match by displayId, not bare
      // role.name. selectedThread can be either form (URL hash); normalise.
      const selected = roleByAddress(selectedThread) || state.roles[0];
      const selectedDisplayId = roleDisplayId(selected);
      if (!messagesLoaded && !messagesLoading) void loadMessages();
      const peers = selected ? peersForInbox(selectedDisplayId) : [];
      if (!selectedPeer) selectedPeer = peers[0]?.id || '';
      else if (peers.length > 0 && !peers.some(peer => peer.id === selectedPeer)) selectedPeer = peers[0]?.id || '';
      if (peers.length === 0 && mobileMessagesView === 'list') mobileMessagesView = 'thread';
      const selectedPeerInfo = peers.find(peer => peer.id === selectedPeer);
      const selectedMessages = selected ? messagesForPeerThread(selectedDisplayId, selectedPeer) : [];
      const dmThreadKey = currentDmThreadKey(selectedDisplayId, selectedPeer);
      const active = selected ? Boolean(runnerFor(selectedDisplayId)) : false;
      const chips = state.roles.map(role => {
        const addr = roleDisplayId(role);
        return '<button class="term-tab ' + (selectedDisplayId === addr ? 'active' : '') + '" data-action="select-thread" data-role="' + esc(addr) + '" ' + truncatedAttrs(addr) + '>' + messagePeerAvatar(role.name, 18) + esc(addr) + '</button>';
      }).join('');
      const conversations = peers.length === 0
        ? '<div class="thread-empty" style="min-height:160px;padding:20px">No peers yet.</div>'
        : peers.map(peer => {
          const preview = compactMessagePreview(peer.last);
          const name = peerName(peer.id);
          return '<button class="conversation ' + (selectedPeer === peer.id ? 'active' : '') + '" data-action="select-peer" data-peer="' + esc(peer.id) + '">' + messagePeerAvatar(peer.id, 36) + '<div class="conversation-main"><div class="conversation-title"><span class="conversation-name" ' + truncatedAttrs(name) + '>' + esc(name) + '</span>' + (peer.id !== HUMAN_PEER && runnerFor(peer.id) ? badge('live', 'live', true) : '') + '</div><div class="conversation-preview">' + esc(preview) + '</div></div><span class="badge">' + peer.count + '</span></button>';
        }).join('');
      const threadBody = messagesLoading && !messagesLoaded
        ? '<div class="thread-empty">Loading messages…</div>'
        : !selectedPeer
          ? '<div class="thread-empty"><div>Select a peer, or send a message below.</div></div>'
          : selectedMessages.length === 0
            ? '<div class="thread-empty"><div>No messages yet.</div></div>'
          : selectedMessages.map(message => renderMessageBubble(message, selectedDisplayId)).join('');
      const composeDisabled = !selected || !active;
      const threadTitleText = selectedPeer ? (selected?.name || 'No role') + ' ↔ ' + peerName(selectedPeer) : (selected?.name || 'No role') + ' inbox';
      const threadTitle = '<span class="thread-title" ' + truncatedAttrs(threadTitleText) + '>' + esc(threadTitleText) + '</span>';
      const threadSub = selectedPeerInfo ? selectedPeerInfo.count + ' ' + pluralize(selectedPeerInfo.count, 'message') : 'No peer selected';
      $('content').innerHTML = '<div class="messages-page mobile-messages-' + esc(mobileMessagesView) + '"><div class="tabbar message-tabbar">' + mobileSidebarTab() + '<div class="tabbar-scroll">' + chips + '</div></div><section class="card inbox-panel"><div class="conversation-list">' + conversations + '</div><div class="thread-panel"><div class="thread-head"><button class="btn secondary small messages-mobile-back" data-action="messages-mobile-back" aria-label="Back to conversations">←</button>' + messagePeerAvatar(selectedPeer || selected?.name || '', 32) + '<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:700;min-width:0">' + threadTitle + '</div><div class="mono" style="font-size:11px;color:var(--muted);margin-top:1px">' + esc(threadSub) + '</div></div>' + badge(active ? 'inbox live' : 'offline sends rejected', active ? 'live' : 'pending', active) + '</div><div class="thread-body" id="messageThreadBody">' + threadBody + renderDmNewMarkerPill(dmThreadKey) + '</div><div class="compose"><textarea id="messageCompose" placeholder="' + (composeDisabled ? 'Launch this inbox role before sending a web message' : 'Message ' + esc(selected.name) + ' as the human web user. Enter sends. Shift+Enter adds a line.') + '" ' + (composeDisabled ? 'disabled' : '') + '></textarea><button class="btn" data-action="send-message" ' + (composeDisabled ? 'disabled' : '') + '>Send</button></div>' + (messageError ? '<div class="send-error" role="alert" aria-live="assertive">' + esc(messageError) + '</div>' : '') + '</div></section></div>';
      installDmNewMarkerScrollClear(dmThreadKey);
      if (composeDraft && !composeDisabled) {
        const nextCompose = $('messageCompose');
        if (nextCompose) {
          nextCompose.value = composeDraft;
          nextCompose.focus();
        }
      }
      applyMessageScroll(scrollMode, wasNearBottom);
    }

    function compactMessagePreview(message) {
      const sender = message.from_role_name || HUMAN_PEER;
      const text = String(message.body || '').replace(/\s+/g, ' ').trim();
      return sender + ': ' + (text.length > 90 ? text.slice(0, 87) + '…' : text);
    }

    function renderMessageBubble(message, selectedRoleDisplayId) {
      const mine = message.to_role_name !== HUMAN_PEER && (!message.from_role_name || message.from_role_name === HUMAN_PEER || message.from_role_name === selectedRoleDisplayId);
      const rejected = message.state === 'rejected';
      const sender = message.from_role_name || 'human-web';
      const delivery = message.delivery_kind === 'broadcast' ? 'broadcast · ' : '';
      const meta = delivery + sender + ' → ' + message.to_role_name + ' · ' + message.state + ' · ' + formatMessageTime(message.sent_at);
      return '<div class="bubble ' + (mine ? 'mine ' : '') + (rejected ? 'rejected' : '') + '" data-message-id="' + esc(message.id || '') + '"><div class="bubble-meta">' + esc(meta) + '</div><div class="bubble-body markdown-body">' + renderSafeMarkdown(message.body) + '</div>' + (message.error ? '<div class="bubble-meta" style="margin-top:8px">' + esc(message.error) + '</div>' : '') + '</div>';
    }

    const settingsScrollByTab = new Map();
    let lastRenderedSettingsTab = '';
    // The settings subnav is a horizontally-scrolling tab bar on narrow
    // viewports. Preserve its scrollLeft across re-renders so switching tabs
    // doesn't jerk the bar back to position 0 (the same way the panel
    // scrollTop is preserved via settingsScrollByTab above).
    let savedSubnavScrollLeft = 0;
    function renderSettings() {
      detachXterm();
      const cfg = state.config;
      const previousPanel = document.querySelector('.settings-panel');
      if (previousPanel && lastRenderedSettingsTab) settingsScrollByTab.set(lastRenderedSettingsTab, previousPanel.scrollTop);
      const previousSubnav = document.querySelector('.settings-subnav .tabbar-scroll');
      if (previousSubnav) savedSubnavScrollLeft = previousSubnav.scrollLeft || 0;
      selectedSettingsTab = validSettingsTab(selectedSettingsTab);
      $('content').innerHTML = '<div class="settings-page settings-with-subnav">' + settingsTabs() + '<div class="settings-panel"><div class="settings-grid">' + settingsPanel(cfg) + '</div></div></div>';
      lastRenderedSettingsTab = selectedSettingsTab;
      const restoreSettingsTop = settingsScrollByTab.get(selectedSettingsTab) || 0;
      const restoreSettingsTab = selectedSettingsTab;
      if (restoreSettingsTop) requestAnimationFrame(() => {
        if (lastRenderedSettingsTab !== restoreSettingsTab) return;
        const next = document.querySelector('.settings-panel');
        if (next) next.scrollTop = restoreSettingsTop;
      });
      if (savedSubnavScrollLeft) requestAnimationFrame(() => {
        if (lastRenderedSettingsTab !== restoreSettingsTab) return;
        const subnav = document.querySelector('.settings-subnav .tabbar-scroll');
        if (subnav) subnav.scrollLeft = savedSubnavScrollLeft;
      });
    }

    function openLaunch(role) {
      openLaunchMenuRole = '';
      selectedLaunchRole = role || selectedLaunchRole || state.roles[0]?.name || '';
      selectedLaunchHost = 'default';
      $('launchModal').classList.remove('hidden');
      renderLaunchDialog();
    }

    function renderLaunchDialog() {
      $('modalRoot').textContent = shortPath(state.root);
      // EP-DEC-RUN WA-006: selectedLaunchRole stores displayId.
      const selected = roleByAddress(selectedLaunchRole) || state.roles[0];
      if (selected && roleDisplayId(selected) !== selectedLaunchRole) selectedLaunchRole = roleDisplayId(selected);
      const hosts = [
        ['default', 'Role default', selected ? hostLabel(selected.host_default) + ' from config' : 'Uses whatsagent.toml'],
        ['claude-code', 'Claude Code', 'Anthropic CLI agent'],
        ['opencode', 'OpenCode', 'OpenCode TUI agent'],
      ];
      $('launchHostCards').innerHTML = hosts.map(([id, label, sub]) => '<button class="choice ' + (selectedLaunchHost === id ? 'active' : '') + '" data-action="select-host" data-host="' + id + '"><div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' + peerIcon(id === 'default' ? (selected?.host_default || 'claude-code') : id, 20) + '<span style="font-size:13px;font-weight:700">' + label + '</span></div><div style="font-size:11px;color:var(--muted)">' + esc(sub) + '</div></button>').join('');
      $('launchRoleList').innerHTML = state.roles.map(role => {
        const addr = roleDisplayId(role);
        return '<button class="role-pick ' + (selectedLaunchRole === addr ? 'active' : '') + '" data-action="select-launch-role" data-role="' + esc(addr) + '"><span style="font-size:14px">' + (role.git_root ? '⎇' : '□') + '</span><div style="flex:1"><div class="mono" style="font-size:13px;font-weight:600">' + esc(role.name) + '</div><div style="font-size:11px;color:var(--muted);margin-top:1px">' + esc(role.path) + '</div></div>' + (runnerFor(addr) ? badge('attach', 'live', true) : '') + '</button>';
      }).join('');
    }

    function normalizeForTerminal(text) {
      return String(text).replace(/\r?\n/g, '\r\n');
    }

    function terminalHostFor(roleName) {
      return runnerFor(roleName)?.host_type || runnerStatusFor(roleName)?.host_type || roleByName(roleName)?.host_default || 'claude-code';
    }

    function terminalDebugSnapshot() {
      const el = $('terminalBody');
      const rect = el?.getBoundingClientRect?.();
      const buffer = activeXterm?.buffer?.active;
      const bufferTop = buffer ? Number(buffer.viewportY || 0) : null;
      const bufferBottom = buffer && activeXterm ? Number(buffer.viewportY || 0) + Math.max(0, Number(activeXterm.rows || 0) - 1) : null;
      const baseY = buffer ? Number(buffer.baseY || 0) : null;
      return {
        role: activeXtermRole,
        host: activeXtermRole ? terminalHostFor(activeXtermRole) : '',
        renderer: activeXtermRenderer,
        webglEnabled: activeXtermRenderer === 'webgl',
        webglDisabledByQuery: terminalDebug.disableWebgl,
        gpuLayerDisabledByQuery: terminalDebug.disableGpuLayer,
        webglContextLosses: activeXtermWebglContextLosses,
        dpr: window.devicePixelRatio || 1,
        rect: rect ? { width: Math.round(rect.width), height: Math.round(rect.height), left: Math.round(rect.left), top: Math.round(rect.top) } : null,
        fit: activeXterm ? { cols: activeXterm.cols, rows: activeXterm.rows } : null,
        bufferTop,
        bufferBottom,
        baseY,
        buffer: buffer ? { top: bufferTop, bottom: bufferBottom, viewportY: buffer.viewportY, baseY, cursorX: buffer.cursorX, cursorY: buffer.cursorY, length: buffer.length } : null,
        ws: { role: terminalWsRole, readyState: terminalWs?.readyState, cursor: activeXtermRole ? terminalCursors[activeXtermRole] || 0 : 0, sessionId: activeXtermRole ? terminalSessions[activeXtermRole] || '' : '' },
        counts: { ...terminalDebugStats },
      };
    }

    // EP-023 / WA-104 — Live xTerm Debug Capture core.
    //
    // When `prefs.xtermDebugCapture` is true, every `terminalDebugLog()`
    // call plus a 5 s periodic `terminalDebugSnapshot()` push into a
    // bounded ring buffer. A debounced shipper drains up to
    // DEBUG_CAPTURE_BATCH_MAX events at a time and POSTs them to
    // /api/v1/client-debug (server-side endpoint added in WA-103). On
    // 4xx/5xx the shipper backs off exponentially (1 s → 5 s → 30 s)
    // and re-enqueues the drained events at the front so they ship on
    // recovery. A `beforeunload` / `pagehide` hook attempts a final
    // flush via keepalive fetch so cookie auth plus CSRF headers still
    // travel on events buffered up to tab close.
    //
    // Capture is metadata + lifecycle only by design. The server-side
    // sanitizer recursively redacts secret-shaped keys as a safety net.
    const DEBUG_CAPTURE_BUFFER_MAX = 500;
    const DEBUG_CAPTURE_BATCH_MAX = 50;
    const DEBUG_CAPTURE_DEBOUNCE_MS = 1000;
    const DEBUG_CAPTURE_SNAPSHOT_INTERVAL_MS = 5000;
    const DEBUG_CAPTURE_BACKOFF_MS = [1000, 5000, 30000];
    const DEBUG_CAPTURE_ENDPOINT = '/api/v1/client-debug';
    const debugCapture = {
      buffer: [],
      droppedSinceLastFlush: 0,
      droppedTotal: 0,
      shippedTotal: 0,
      lastFlushAt: 0,
      lastError: '',
      backoffStep: 0,
      flushTimer: null,
      snapshotTimer: null,
      shipping: false,
    };

    function debugCaptureEnabled() {
      return prefs && prefs.xtermDebugCapture === true;
    }

    function enqueueDebugCapture(category, payload) {
      if (!debugCaptureEnabled()) return;
      if (debugCapture.buffer.length >= DEBUG_CAPTURE_BUFFER_MAX) {
        debugCapture.buffer.shift();
        debugCapture.droppedSinceLastFlush += 1;
        debugCapture.droppedTotal += 1;
      }
      debugCapture.buffer.push({ category: String(category), payload, ts: Date.now() });
      scheduleDebugCaptureFlush();
    }

    function scheduleDebugCaptureFlush() {
      if (!debugCaptureEnabled()) return;
      if (debugCapture.shipping) return;
      if (debugCapture.buffer.length >= DEBUG_CAPTURE_BATCH_MAX) {
        flushDebugCapture();
        return;
      }
      if (debugCapture.flushTimer) return;
      debugCapture.flushTimer = setTimeout(() => {
        debugCapture.flushTimer = null;
        flushDebugCapture();
      }, DEBUG_CAPTURE_DEBOUNCE_MS);
    }

    function buildDebugCapturePayload(events) {
      const meta = { dropped: debugCapture.droppedSinceLastFlush };
      return { events, meta };
    }

    async function flushDebugCapture(opts = {}) {
      if (debugCapture.shipping) return;
      if (debugCapture.buffer.length === 0) return;
      debugCapture.shipping = true;
      const drained = debugCapture.buffer.splice(0, DEBUG_CAPTURE_BATCH_MAX);
      const droppedSnapshot = debugCapture.droppedSinceLastFlush;
      debugCapture.droppedSinceLastFlush = 0;
      try {
        const res = await fetch(DEBUG_CAPTURE_ENDPOINT, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildDebugCapturePayload(drained)),
        });
        if (!res.ok) {
          throw new Error('http ' + res.status);
        }
        debugCapture.shippedTotal += drained.length;
        debugCapture.lastFlushAt = Date.now();
        debugCapture.lastError = '';
        debugCapture.backoffStep = 0;
      } catch (err) {
        debugCapture.lastError = err && err.message ? String(err.message) : String(err);
        // Re-enqueue at the front so order is preserved on retry. If the
        // buffer overflowed since drain, oldest replays may be lost.
        debugCapture.buffer.unshift(...drained);
        // Restore the prior dropped counter so it reports on next flush.
        debugCapture.droppedSinceLastFlush += droppedSnapshot;
        const step = Math.min(debugCapture.backoffStep, DEBUG_CAPTURE_BACKOFF_MS.length - 1);
        const delay = DEBUG_CAPTURE_BACKOFF_MS[step];
        debugCapture.backoffStep = Math.min(debugCapture.backoffStep + 1, DEBUG_CAPTURE_BACKOFF_MS.length - 1);
        debugCapture.flushTimer = setTimeout(() => {
          debugCapture.flushTimer = null;
          flushDebugCapture();
        }, delay);
      } finally {
        debugCapture.shipping = false;
      }
      // EP-023 msg #446 fix — refresh Diagnostics panel immediately
      // after each flush attempt so shipped / lastFlush / lastError
      // counters update without waiting for the 1 Hz heartbeat.
      if (page === 'settings' && selectedSettingsTab === 'diagnostics') updateDiagnosticsStatusDom();
      // If more remains after success, schedule another batch promptly.
      if (debugCapture.buffer.length > 0 && debugCapture.backoffStep === 0 && !opts.final) {
        scheduleDebugCaptureFlush();
      }
    }

    function flushDebugCaptureKeepalive() {
      if (debugCapture.buffer.length === 0) return;
      try {
        const drained = debugCapture.buffer.splice(0, DEBUG_CAPTURE_BATCH_MAX);
        const body = JSON.stringify(buildDebugCapturePayload(drained));
        void fetch(DEBUG_CAPTURE_ENDPOINT, {
          method: 'POST',
          keepalive: true,
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body,
        }).then(res => {
          if (!res.ok) debugCapture.buffer.unshift(...drained);
          else {
            debugCapture.shippedTotal += drained.length;
            debugCapture.lastFlushAt = Date.now();
          }
        }).catch(() => { debugCapture.buffer.unshift(...drained); });
      } catch {}
    }

    function startDebugCaptureSnapshotTimer() {
      if (debugCapture.snapshotTimer) return;
      debugCapture.snapshotTimer = setInterval(() => {
        if (!debugCaptureEnabled()) return;
        try { enqueueDebugCapture('periodic-snapshot', terminalDebugSnapshot()); } catch {}
      }, DEBUG_CAPTURE_SNAPSHOT_INTERVAL_MS);
    }

    function stopDebugCaptureSnapshotTimer() {
      if (debugCapture.snapshotTimer) {
        clearInterval(debugCapture.snapshotTimer);
        debugCapture.snapshotTimer = null;
      }
    }

    function debugCaptureStatus() {
      return {
        enabled: debugCaptureEnabled(),
        bufferFill: debugCapture.buffer.length,
        bufferMax: DEBUG_CAPTURE_BUFFER_MAX,
        shippedTotal: debugCapture.shippedTotal,
        droppedTotal: debugCapture.droppedTotal,
        lastFlushAt: debugCapture.lastFlushAt,
        lastError: debugCapture.lastError,
        backoffStep: debugCapture.backoffStep,
      };
    }

    // EP-023 / WA-106 + msg #446 fix — Diagnostics panel live status
    // updates without re-rendering the surrounding settings tree (which
    // would steal focus and recompute the rest of the panel needlessly).
    // Targets stable element ids set by diagnosticsPanel(); each call
    // is a handful of textContent writes.
    function updateDiagnosticsStatusDom() {
      const grid = document.getElementById('diagnosticsStatusGrid');
      if (!grid) return;
      const status = debugCaptureStatus();
      const stateEl = document.getElementById('diagnosticsStatusState');
      if (stateEl) stateEl.textContent = status.enabled ? 'Capturing' : 'Off';
      const bufferEl = document.getElementById('diagnosticsStatusBuffer');
      if (bufferEl) bufferEl.textContent = status.bufferFill + ' / ' + status.bufferMax;
      const shippedEl = document.getElementById('diagnosticsStatusShipped');
      if (shippedEl) shippedEl.textContent = String(status.shippedTotal);
      const droppedEl = document.getElementById('diagnosticsStatusDropped');
      if (droppedEl) droppedEl.textContent = String(status.droppedTotal);
      const lastFlushEl = document.getElementById('diagnosticsStatusLastFlush');
      if (lastFlushEl) lastFlushEl.textContent = status.lastFlushAt > 0 ? new Date(status.lastFlushAt).toLocaleTimeString() : 'never';
      const errRow = document.getElementById('diagnosticsStatusErrorRow');
      const errEl = document.getElementById('diagnosticsStatusError');
      if (errRow) errRow.style.display = status.lastError ? '' : 'none';
      if (errEl) errEl.textContent = status.lastError || '';
      const boRow = document.getElementById('diagnosticsStatusBackoffRow');
      const boEl = document.getElementById('diagnosticsStatusBackoff');
      if (boRow) boRow.style.display = status.backoffStep > 0 ? '' : 'none';
      if (boEl) boEl.textContent = String(status.backoffStep);
      // Snapshot button enable/disable mirrors capture state so the
      // panel does not advertise a flush action that has nothing to
      // ship.
      document.querySelectorAll('[data-action="diagnostics-flush-now"]').forEach((btn) => {
        if (status.enabled) btn.removeAttribute('disabled');
        else btn.setAttribute('disabled', 'disabled');
      });
    }
    // 1 Hz heartbeat. Cheap when not on the diagnostics tab — the
    // grid query short-circuits in that case. Not gated by capture
    // toggle so the panel still reflects "off" + final counters when
    // the user toggles capture off and stays on the tab.
    setInterval(() => {
      if (page === 'settings' && selectedSettingsTab === 'diagnostics') updateDiagnosticsStatusDom();
    }, 1000);

    function applyDebugCaptureToggle(enabled) {
      if (enabled) {
        startDebugCaptureSnapshotTimer();
        scheduleDebugCaptureFlush();
      } else {
        stopDebugCaptureSnapshotTimer();
        // One final best-effort flush so events captured up to the
        // toggle-off transition still ship.
        if (debugCapture.buffer.length > 0) flushDebugCapture({ final: true });
      }
    }

    if (typeof window !== 'undefined') {
      const beaconHandler = () => { if (debugCaptureEnabled()) flushDebugCaptureKeepalive(); };
      window.addEventListener('beforeunload', beaconHandler);
      window.addEventListener('pagehide', beaconHandler);
      // EP-023 / WA-105 — visibility transitions matter for diagnosing
      // dispose-during-hidden regressions and the keyboard-dead path.
      document.addEventListener?.('visibilitychange', () => {
        terminalDebugLog('visibility-change', { role: activeXtermRole, visibilityState: document.visibilityState });
      });
    }
    // Bootstrap: if the saved pref already has capture ON, start
    // timers now so the user does not have to toggle off-and-on after a
    // page reload.
    if (debugCaptureEnabled()) applyDebugCaptureToggle(true);

    function terminalDebugLog(event, data = {}) {
      if (debugCaptureEnabled()) {
        // Capture path is independent of the URL-flag overlay so
        // ?debug=xterm and the Settings toggle can be used in isolation
        // or together.
        try { enqueueDebugCapture(event, data); } catch {}
      }
      if (!terminalDebug.enabled) return;
      try { console.debug('[whatsagent:xterm]', event, { ...terminalDebugSnapshot(), ...data }); } catch {}
      updateTerminalDebugOverlay();
    }

    function updateTerminalDebugOverlay() {
      if (!terminalDebug.enabled) return;
      const overlay = $('terminalDebugOverlay');
      if (!overlay) return;
      const snap = terminalDebugSnapshot();
      overlay.innerHTML = [
        'renderer=' + esc(snap.renderer) + ' webgl=' + (snap.webglEnabled ? 'on' : 'off') + ' ctxLoss=' + snap.webglContextLosses,
        'dpr=' + snap.dpr + ' rect=' + (snap.rect ? snap.rect.width + 'x' + snap.rect.height : 'n/a') + ' fit=' + (snap.fit ? snap.fit.cols + 'x' + snap.fit.rows : 'n/a'),
        'buf top=' + (snap.bufferTop ?? 'n/a') + ' bottom=' + (snap.bufferBottom ?? 'n/a') + ' baseY=' + (snap.baseY ?? 'n/a') + ' len=' + (snap.buffer?.length ?? 'n/a'),
        'ws cursor=' + snap.ws.cursor + ' state=' + (snap.ws.readyState ?? 'n/a') + ' events=' + snap.counts.wsEventsReceived + '/' + snap.counts.httpEventsReceived,
        'resize sends=' + snap.counts.resizeSends + ' pulses=' + snap.counts.resizePulses + ' fits=' + snap.counts.fitCalls,
        'toggles: xtermWebgl=0 xtermGpuLayer=0',
      ].join('<br>');
    }

    function ensureTerminalController() {
      if (terminalController) return terminalController;
      terminalController = new TerminalController({
        getRunner: (role) => runnerFor(role),
        getRoleId: (role) => roleByAddress(role)?.id || null,
        buildWsUrl: (roleId) => {
          const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
          const url = new URL(protocol + '//' + location.host + wsApiUrl('/roles-by-id/') + encodeURIComponent(roleId) + '/terminal/ws');
          if (state?.csrfToken) url.searchParams.set('csrf', state.csrfToken);
          return url.href;
        },
        debugLog: (event, payload) => terminalDebugLog(event, payload || {}),
        onAttention: (role, attention) => {
          if (window.__handleRunnerAttentionNotification) {
            try { window.__handleRunnerAttentionNotification(role, attention); } catch {}
          }
        },
        onRunnerStatus: (role, body) => handleRunnerStatus(role, body),
        onSessionChange: (role, prev, next) => terminalDebugLog('session-change', { role, prevSessionId: prev || '', nextSessionId: next }),
        fallbackSendInput: (role, data) => { void sendTerminalInput(data, true); },
        fontSize: () => terminalFontSize(),
        lineHeight: () => terminalLineHeight(),
        accentHex: () => getComputedStyle(document.documentElement).getPropertyValue('--accent-hex').trim() || '#a78bfa',
        mouseSelectMode: () => prefs.terminalMouseMode === 'select',
        disableWebgl: () => Boolean(terminalDebug.disableWebgl),
      });
      syncTuiRedrawController();
      return terminalController;
    }

    function mountTerminal(role, initialText, active) {
      const el = $('terminalBody');
      if (!el) return;
      const runner = runnerFor(role);
      // Plain-DOM exited fallback: when there's no live runner, show the
      // captured tail in textContent (no xterm). Mirror's exited-replay
      // path still feeds the controller for a live runner that just
      // exited mid-session, but stale-server cases without a runner row
      // never reach the controller's WS layer.
      if (!runner) {
        if (el.dataset.role === role) {
          if (el.dataset.live !== '1') { el.textContent = ''; el.dataset.live = '1'; }
          el.textContent = initialText;
        }
        return;
      }
      if (typeof Terminal !== 'function') {
        // xterm UMD missing — plain DOM fallback.
        if (el.dataset.role === role) el.textContent = initialText;
        return;
      }
      const shell = el.closest('.terminal');
      shell?.classList.add('xterm-enabled');
      const controller = ensureTerminalController();
      controller.mount(role, el, { active, reason: 'mountTerminal' });
      return controller;
    }

    // EP-029 T4: installTerminalTouchScroll + installTerminalDebugObservers
    // moved into TerminalController. fitActiveTerminal +
    // scheduleTerminalFit + sendCurrentTerminalSize replaced by
    // controller's internal ResizeObserver/FitAddon. WA-127 patch
    // surface (visibility-hide window, initial-fit gate, pending
    // resize/ws-connect slots, fit drains) deleted — server-side
    // restore frame is canonical and lands at the correct grid by
    // construction. scheduleTerminalFit() callers now no-op via the
    // shim below until call sites are pruned (panel-switch +
    // window-resize listeners) — controller's ResizeObserver picks up
    // the same container size changes natively.
    function scheduleTerminalFit(_forceResize = false) {
      // Controller owns ResizeObserver + FitAddon on its container.
      // Legacy shim retained for caller compat until grep'd out.
    }

    function appendTerminal(role, text, _type) {
      // EP-029 T4: xterm path moved into TerminalController (controller
      // writes restore.snapshot atomically + live deltas). Plain-DOM
      // fallback path retained for runner-status status lines + xterm-
      // missing fallback.
      const el = $('terminalBody');
      if (!el || el.dataset.role !== role) return;
      if (el.dataset.live !== '1') { el.textContent = ''; el.dataset.live = '1'; }
      el.textContent += text;
      el.scrollTop = el.scrollHeight;
    }

    function handleTerminalInputRejected(role, body) {
      handleRunnerStatus(role, {
        status: body?.status || 'offline',
        exitCode: body?.exitCode,
        exitSignal: body?.exitSignal,
        sessionId: body?.sessionId,
      });
    }

    // EP-029 T4: HTTP /input fallback. The TerminalController owns the
    // WS path; this is invoked from the controller's fallbackSendInput
    // callback when the WS is not yet open (initial mount window) or
    // closed mid-runtime. Server's /input route accepts plain JSON.
    async function sendTerminalInput(value, raw = false) {
      const role = activeTerminalRole();
      if (!role || !value) return;
      if (!runnerFor(role)) {
        handleTerminalInputRejected(role, { status: 'offline' });
        return;
      }
      const gen = state.workspaceGeneration;
      const target = roleByAddress(role);
      if (!target?.id) return;
      const res = await workspaceFetch('/roles-by-id/' + encodeURIComponent(target.id) + '/input', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: raw ? value : value + NL }) }).catch(() => null);
      if (gen !== state.workspaceGeneration) return;
      if (!res?.ok) {
        const body = res ? await res.json().catch(() => ({})) : {};
        handleTerminalInputRejected(role, body);
      }
    }

    // EP-029 T4: pollTerminal + scheduleTerminalPoll deleted —
    // mirror-as-source canonical state means the controller's WS
    // restore frame + live deltas cover what the cursor-based HTTP
    // poll fallback used to. WA-138 deleted the orphan close-WS
    // call site too; controller owns its own WebSocket lifecycle.

    function handleRunnerStatus(role, body) {
      const status = body.status || 'offline';
      const detail = body.exitCode != null ? ' exit code ' + body.exitCode : (body.exitSignal ? ' signal ' + body.exitSignal : '');
      const key = status + detail;
      if (terminalStatusNotified[role] === key) return;
      terminalStatusNotified[role] = key;
      // Server-side mirror snapshot already includes the runner-injected
      // [process exited …] status line in scrollback (node-pty-runner.mjs
      // append('status', …) flows through to the mirror's serialize), so
      // no client-side append is needed under T4 mirror-as-source.
      setTimeout(() => { if (page === 'agents' && agentsSubView === 'terminal' && activeTerminal === role) refresh(); }, 400);
    }

    function scheduleTerminalPoll() {
      // EP-029 T4 stub: controller owns WS lifecycle + restore + live
      // deltas. Legacy HTTP polling fallback is gone. Kept as a no-op
      // shim so call sites (render(), panel-switch logic) continue to
      // compile until grep'd out in T4 follow-up.
    }

    function render() {
      $('daemonPort').textContent = state.config.ui.port;
      $('liveRoleCount').textContent = liveRunners().length;
      $('navAgentCount').textContent = liveRunners().length;
      updateNotificationButton();
      setMobileSidebarOpen(mobileSidebarOpen);
      if (page === 'messages') navMessageUnreadCount = 0;
      updateNavMessageIndicator();
      document.querySelectorAll('.nav [data-page]').forEach(btn => { const navActive = btn.dataset.page === page; btn.classList.toggle('active', navActive); if (navActive) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current'); });
      if (page !== 'agents' || agentsSubView !== 'terminal' || activeTerminal === 'overview') unmountSpecialKeysOverlay();
      if (page === 'overview') renderOverview();
      if (page === 'agents') renderAgents();
      if (page === 'messages') renderMessages();
      if (page === 'settings') renderSettings();
      if (page === 'kanban') renderKanban();
      bindTruncateTips();
      scheduleTerminalPoll();
    }

    document.querySelectorAll('.nav [data-page]').forEach(btn => btn.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      closeMobileSidebar();
      showPage(btn.dataset.page);
    }));
    $('notificationBtn').addEventListener('click', enableNotifications);
    $('topLaunchBtn').addEventListener('click', () => openLaunch());
    $('closeLaunchBtn').addEventListener('click', () => $('launchModal').classList.add('hidden'));
    $('launchSubmitBtn').addEventListener('click', () => launch());
    $('launchModal').addEventListener('click', e => { if (e.target === $('launchModal')) $('launchModal').classList.add('hidden'); });
    document.addEventListener('click', e => {
      const target = e.target?.closest?.('[data-action]');
      if (!target) { closeLaunchMenu(); return; }
      const action = target.dataset.action;
      const keepLaunchMenu = action === 'toggle-launch-menu' || Boolean(target.closest?.('.launch-split'));
      if (action === 'set-main') setMain(target.dataset.role);
      if (action === 'launch') launch(target.dataset.role, target.dataset.host);
      if (action === 'launch-host') launch(target.dataset.role, target.dataset.host);
      if (action === 'toggle-launch-menu') { openLaunchMenuRole = openLaunchMenuRole === target.dataset.role ? '' : (target.dataset.role || ''); renderAgentOverviewIfVisible(); }
      if (action === 'stop-role') stopRole(target.dataset.role);
      if (action === 'open-launch') openLaunch(target.dataset.role);
      if (action === 'toggle-sidebar') toggleSidebar();
      if (action === 'toggle-mobile-sidebar') toggleMobileSidebar();
      if (action === 'close-mobile-sidebar') closeMobileSidebar();
      if (action === 'auth-logout') logoutWebSession();
      if (action === 'terminal') { activeTerminal = target.dataset.role || 'overview'; agentsSubView = activeTerminal === 'overview' ? 'overview' : 'terminal'; agentsConfigRole = ''; clearAttention(activeTerminal); render(); updateUrl(); }
      if (action === 'select-thread') { selectedThread = target.dataset.role || selectedThread; selectedPeer = ''; mobileMessagesView = 'list'; messageError = ''; pendingMessageScroll = 'bottom'; render(); updateUrl(); }
      if (action === 'select-peer') { selectedPeer = target.dataset.peer || selectedPeer; mobileMessagesView = 'thread'; messageError = ''; pendingMessageScroll = 'bottom'; render(); updateUrl(); }
      if (action === 'messages-mobile-back') { mobileMessagesView = 'list'; render(); updateUrl(); }
      if (action === 'messages-jump-to-marker') jumpToDmNewMarker(target.dataset.markerId);
      if (action === 'select-host') { selectedLaunchHost = target.dataset.host || 'default'; renderLaunchDialog(); }
      if (action === 'select-launch-role') { selectedLaunchRole = target.dataset.role || selectedLaunchRole; renderLaunchDialog(); }
      if (action === 'send-message') sendWebMessage();
      if (action === 'set-pref') setPreference(target.dataset.pref, target.dataset.value);
      // EP-023 / WA-106 — Diagnostics panel actions.
      if (action === 'diagnostics-copy-log-path') {
        try { navigator.clipboard?.writeText?.('~/.whatsagent/logs/xterm-debug.log'); } catch {}
      }
      if (action === 'diagnostics-flush-now') {
        flushDebugCapture();
      }
      if (action === 'select-settings-tab') { selectedSettingsTab = validSettingsTab(target.dataset.settingsTab); renderSettings(); updateUrl(); }
      if (action === 'enable-notifications') enableNotifications().then(() => { if (page === 'settings') renderSettings(); });
      if (!keepLaunchMenu && openLaunchMenuRole) closeLaunchMenu();
    });
    document.addEventListener('change', e => {
      const target = e.target?.closest?.('[data-action]');
      if (!target) return;
      if (target.dataset.action === 'set-pref-select') setPreference(target.dataset.pref, target.value);
    });
    document.addEventListener('keydown', e => {
      const target = e.target;
      if (e.key === 'Escape' && openLaunchMenuRole) {
        e.preventDefault();
        closeLaunchMenu();
        return;
      }
      if (target?.id === 'terminalInput' && e.key === 'Enter') {
        e.preventDefault();
        const value = target.value;
        target.value = '';
        sendTerminalInput(value);
      }
      if (target?.id === 'messageCompose' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        sendWebMessage();
      }
    });
    window.addEventListener('resize', () => scheduleTerminalFit(true));
    window.addEventListener('popstate', () => {
      const parts = routeParts();
      if (parts.workspaceId && parts.workspaceId !== state.currentWorkspace?.id) {
        void switchWorkspace(parts.workspaceId, { updateDaemonCurrent: false });
        return;
      }
      applyRouteFromLocation();
      render();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { statusPollFailures = 0; messagePollFailures = 0; scheduleStatusPoll(0); scheduleMessagePoll(0); } });
    runnerSnapshot = runnerSnapshotFor(state.runners || []);
    repoRoleSnapshot = repoRoleSnapshotFor(state);
    seedRunnerExitNotifications(state.runners || []);
    let clientCtx;
    {
      clientCtx = {
        getState: () => state,
        setState: (next) => { state = next; syncTuiRedrawController(); },
        patchState: (partial) => patchClientState(partial),
        getPage: () => page,
        setPage: (next) => { page = next; },
        getSelectedSettingsTab: () => selectedSettingsTab,
        getActiveTerminal: () => agentsSubView === 'terminal' ? activeTerminal : 'overview',
        getOpenLaunchMenuRole: () => openLaunchMenuRole,
        setOpenLaunchMenuRole: (next) => { openLaunchMenuRole = next; },
        getSelectedLaunchRole: () => selectedLaunchRole,
        setSelectedLaunchRole: (next) => { selectedLaunchRole = next; },
        getSelectedLaunchHost: () => selectedLaunchHost,
        setSelectedLaunchHost: (next) => { selectedLaunchHost = next; },
        routeParts,
        updateUrl,
        workspacePath,
        workspaceFetch,
        shouldPollWorkspace,
        daemonApiUrl,
        clearMessageCache: () => clearDirectMessageCache(),
        render: () => render(),
        renderSettings: () => renderSettings(),
        renderAgentOverview: () => renderAgentOverview(),
        getAttentionRoles: () => attentionRoles,
        getRunnerSnapshot: () => runnerSnapshot,
        setRunnerSnapshot: (next) => { runnerSnapshot = next; },
        getRepoRoleSnapshot: () => repoRoleSnapshot,
        setRepoRoleSnapshot: (next) => { repoRoleSnapshot = next; },
        repoRoleSnapshotFor: (stateLike) => repoRoleSnapshotFor(stateLike),
        bindDropdownDismiss: (spec) => bindDropdownDismiss(spec),
        mobileSidebarTab: () => mobileSidebarTab(),
        getRender: () => render,
        setRender: (fn) => { render = fn; },
        getRenderMessages: () => renderMessages,
        setRenderMessages: (fn) => { renderMessages = fn; },
        getRenderSettings: () => renderSettings,
        setRenderSettings: (fn) => { renderSettings = fn; },
        getLoadMessages: () => loadMessages,
        setLoadMessages: (fn) => { loadMessages = fn; },
        getSendWebMessage: () => sendWebMessage,
        setSendWebMessage: (fn) => { sendWebMessage = fn; },
        callSendWebMessage: () => sendWebMessage(),
        renderMessagesViaCurrent: (opts) => renderMessages(opts),
        loadMessagesViaCurrent: (opts) => loadMessages(opts),
        getPendingMessageScroll: () => pendingMessageScroll,
        setPendingMessageScroll: (next) => { pendingMessageScroll = next; },
        getMessageError: () => messageError,
        setMessageError: (next) => { messageError = next; },
        getSelectedPeer: () => selectedPeer,
        setSelectedPeer: (next) => { selectedPeer = next; },
        clearMessages: () => clearDirectMessageCache(),
        noteNavMessages: (count) => noteNavMessages(count),
        getMessageComposerHeightKey: () => MESSAGE_COMPOSER_HEIGHT_KEY,
        getChannelThreadWidthKey: () => CHANNEL_THREAD_WIDTH_KEY,
        getHumanPeer: () => HUMAN_PEER,
        ensureMessageLengthCounter,
        renderMessageComposer,
        renderSafeMarkdown,
        applyMessageComposerSize,
        applyChannelThreadWidth,
        channelThreadWidth,
        messageComposerHeight,
        saveUiNumber,
        applyMessageScroll,
        messagePeerAvatar,
        liveRunners,
        registerResetHook: (fn) => registerResetHook(fn),
        getSelectedThread: () => selectedThread,
        setActiveTerminal: (next) => { activeTerminal = next; agentsSubView = next === 'overview' ? 'overview' : 'terminal'; agentsConfigRole = ''; },
        getAgentsSubView: () => agentsSubView,
        setAgentsSubView: (next, role = '') => { agentsSubView = next || 'overview'; agentsConfigRole = role || ''; if (agentsSubView !== 'terminal') activeTerminal = 'overview'; },
        showPage: (next) => showPage(next),
        getTabId: () => TAB_ID,
        appendTerminal,
        refresh: () => refresh(),
        scheduleTerminalPoll,
        getSettingsPanel: () => settingsPanel,
        setSettingsPanel: (fn) => { settingsPanel = fn; },
        getNotifyNewMessages: () => notifyNewMessages,
        setNotifyNewMessages: (fn) => { notifyNewMessages = fn; },
        getNotifyRunnerExits: () => notifyRunnerExits,
        setNotifyRunnerExits: (fn) => { notifyRunnerExits = fn; },
        getUpdateNotificationButton: () => updateNotificationButton,
        setUpdateNotificationButton: (fn) => { updateNotificationButton = fn; },
        updateNotificationButtonViaCurrent: () => updateNotificationButton(),
        getEnableNotifications: () => enableNotifications,
        setEnableNotifications: (fn) => { enableNotifications = fn; },
        getLaunch: () => launch,
        setLaunch: (fn) => { launch = fn; },
        getMessages: () => messages,
        getNotificationLog: () => notificationLog,
        setNotificationLog: (value) => { notificationLog = value; },
        getNotificationPrefs: () => notificationPrefs,
        setNotificationPrefs: (value) => { notificationPrefs = value; },
        getNotificationPopoverOpen: () => notificationPopoverOpen,
        setNotificationPopoverOpen: (value) => { notificationPopoverOpen = value; },
        getNotificationToastQueue: () => notificationToastQueue,
        getLastSoundPlayAt: () => lastSoundPlayAt,
        setLastSoundPlayAt: (value) => { lastSoundPlayAt = value; },
        getPreviousRunnerStateForNotifs: () => previousRunnerStateForNotifs,
        setTerminalStatusNotified: (role, value) => { terminalStatusNotified[role] = value; },
        scheduleStatusPoll: (delay) => scheduleStatusPoll(delay),
        notifyRunnerExits: (next, prev) => notifyRunnerExits(next, prev),
        updateLiveCounts: () => updateLiveCounts(),
        activeTerminalRole: () => activeTerminalRole(),
        $,
        disposeXterm,
        esc,
        shortPath,
        roleByName,
        roleDisplayId,
        runnerFor,
        runnerDiagnostics,
        kv,
        settingRow,
        badge,
        peerIcon,
        roleAvatarGrid,
        roleAvatarWithPresence,
        hostLabel,
        formatMessageTime,
        settingsDropdown,
        truncatedAttrs,
        settingsBottomActionBar,
        settingsWorkspaceSubtitle,
        updateMessageLengthCounters,
        openConfirm: (opts) => openConfirm(opts),
        showToast: (message, opts) => showToast(message, opts),
        setModalCloseHandler,
        closeLaunchMenu: () => closeLaunchMenu(),
        // EP-023 / WA-106 — surface for the Diagnostics panel.
        getPrefs: () => prefs,
        prefControl: (...args) => prefControl(...args),
        captureStatus: () => debugCaptureStatus(),
        flushDebugCaptureNow: () => flushDebugCapture(),
      };
      installKanban(clientCtx);
      installSettings(clientCtx);
      registerResetHook(() => resetKanban());
    }
    applyRouteFromLocation();
    scheduleMessagePoll(500);
    scheduleStatusPoll(1000);

    // EP-003 WA-011: collapse onto the shared identiconFor() primitive used
    // by the Agents Overview. Keeps this function name as an adapter so the
    // many existing callsites and the clientCtx export keep working without
    // a rename pass; the inner DOM is now an SVG identicon, not a CSS grid.
    function identiconSeedForRole(roleOrName) {
      const role = typeof roleOrName === 'string' ? roleByName(roleOrName) : roleOrName;
      if (role) {
        const display = role.display_id || role.displayId || '';
        if (display) return display;
        const repo = role.repo_name || role.repoName || '';
        const name = role.name || '';
        if (repo && name) return repo + ':' + name;
        return name || repo || 'role';
      }
      return String(roleOrName || 'role');
    }

    function roleAvatarGrid(roleOrName, size = 48) {
      const seed = identiconSeedForRole(roleOrName);
      return '<span class="role-avatar role-avatar-identicon" aria-hidden="true" style="width:' + size + 'px;height:' + size + 'px">' + identiconFor(seed, size) + '</span>';
    }

    function humanAvatar(size = 32) {
      return '<span class="human-avatar" aria-hidden="true" style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.max(9, Math.round(size * 0.32)) + 'px">HW</span>';
    }

    function roleAvatarWithPresence(roleOrName, size = 32) {
      const role = typeof roleOrName === 'string' ? roleByName(roleOrName) : roleOrName;
      // EP-003 WA-011 fix-up (advisor msg #40): runner lookup must key on
      // displayId so cross-repo same-bare-name agents (`repoA:main` +
      // `repoB:main`) don't collide on the presence dot. roleName is kept
      // as the visual fallback text when no role row resolves.
      const addr = role ? roleDisplayId(role) : String(roleOrName || 'role');
      const roleName = role?.name || String(roleOrName || 'role');
      const online = Boolean(runnerFor(addr));
      const label = online ? 'online' : 'offline';
      const dotSize = Math.max(6, Math.round(size * 0.28));
      return '<span class="agent-avatar-presence" style="width:' + size + 'px;height:' + size + 'px;--avatar-presence-size:' + dotSize + 'px" title="' + esc(addr + ' ' + label) + '">' + roleAvatarGrid(role || roleName, size) + '<span class="avatar-presence-dot ' + label + '" aria-hidden="true"></span></span>';
    }

    function messagePeerAvatar(peerId, size = 32) {
      const id = peerId || HUMAN_PEER;
      return id === HUMAN_PEER || id === 'human-web' ? humanAvatar(size) : roleAvatarWithPresence(id, size);
    }

    function messageReceiptState(message) {
      if (message.acked_at) return 'read';
      if (message.delivered_at || message.state === 'delivered') return 'delivered';
      return message.state || 'pending';
    }

    function messageMaxBodyChars() {
      return Math.max(1, Math.min(32000, Number(state.messageSettings?.maxBodyChars || 32000)));
    }

    function updateMessageLengthCounters() {
      for (const input of document.querySelectorAll('[data-message-length-input]')) {
        const targetId = input.getAttribute('data-message-length-input');
        const counter = targetId ? document.getElementById(targetId) : null;
        if (!counter) continue;
        const text = String(input.value || '');
        const max = messageMaxBodyChars();
        const over = text.length > max;
        counter.textContent = text.length + '/' + max;
        counter.classList.toggle('over-limit', over);
      }
    }

    function ensureMessageLengthCounter(input, id) {
      if (!input) return;
      input.setAttribute('data-message-length-input', id);
      if (!document.getElementById(id)) input.insertAdjacentHTML('afterend', '<div id="' + esc(id) + '" class="message-length-counter"></div>');
      updateMessageLengthCounters();
    }

    const MESSAGE_COMPOSER_HEIGHT_KEY = 'whatsagent.messageComposer.height';
    const CHANNEL_THREAD_WIDTH_KEY = 'whatsagent.channelThread.width';

    function loadUiNumber(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : Number(raw);
      } catch {
        return fallback;
      }
    }

    function saveUiNumber(key, value) {
      try { localStorage.setItem(key, String(Math.round(value))); } catch {}
    }

    function messageComposerMaxHeight() {
      return Math.min(320, Math.max(140, Math.floor((window.innerHeight || 800) * 0.42)));
    }

    function messageComposerHeight(value) {
      return numberInRange(value ?? loadUiNumber(MESSAGE_COMPOSER_HEIGHT_KEY, 118), 76, messageComposerMaxHeight(), 118);
    }

    function channelThreadMaxWidth() {
      return Math.min(620, Math.max(320, Math.floor((window.innerWidth || 1200) * 0.48)));
    }

    function channelThreadWidth(value) {
      return numberInRange(value ?? loadUiNumber(CHANNEL_THREAD_WIDTH_KEY, 380), 300, channelThreadMaxWidth(), 380);
    }

    function applyMessageComposerSize(value) {
      const height = messageComposerHeight(value);
      for (const el of document.querySelectorAll('.message-composer')) {
        el.style.setProperty('--message-composer-height', height + 'px');
      }
      return height;
    }

    function applyChannelThreadWidth(value) {
      const width = channelThreadWidth(value);
      document.querySelector('.messages-page.channel-mode')?.style.setProperty('--channel-thread-width', width + 'px');
      return width;
    }

    function sendIconSvg() {
      return '<svg class="message-composer-send-svg" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M2.5 10.9 16.8 3.4c.55-.29 1.17.24.96.82l-4.58 12.84c-.2.56-.98.59-1.22.05l-2.1-4.69-4.72-1.24c-.6-.16-.73-.98-.19-1.28Zm4.53-.73 3.36.88c.2.05.36.19.45.38l1.46 3.26 2.9-8.13-8.17 3.61Z" fill="currentColor"/></svg>';
    }

    function settingsDropdown(name, value, options, opts = {}) {
      const items = Array.isArray(options) ? options : [];
      const current = String(value ?? (items[0]?.[0] ?? ''));
      const selected = items.find(item => String(item[0]) === current) || items[0] || ['', opts.placeholder || 'Select'];
      const inputAttrs = opts.inputAttrs || '';
      const className = opts.className ? ' ' + opts.className : '';
      const menu = '<div class="launch-menu settings-dropdown-menu" role="menu">' + items.map(item => {
        const itemValue = String(item[0]);
        const label = String(item[1]);
        return '<button type="button" role="menuitem" class="' + (itemValue === current ? 'active' : '') + '" data-action="settings-dropdown-choice" data-value="' + esc(itemValue) + '">' + esc(label) + '</button>';
      }).join('') + '</div>';
      return '<div class="launch-split settings-dropdown' + className + '" data-settings-dropdown="' + esc(name) + '"><input type="hidden" value="' + esc(current) + '" ' + inputAttrs + ' /><button type="button" class="btn secondary small settings-dropdown-trigger" data-action="toggle-settings-dropdown" aria-expanded="false"><span class="settings-dropdown-label" ' + truncatedAttrs(selected[1]) + '>' + esc(selected[1]) + '</span></button><button type="button" class="launch-arrow" data-action="toggle-settings-dropdown" aria-label="Choose ' + esc(name) + '" aria-expanded="false">\u25BC</button>' + menu + '</div>';
    }

    function settingsBottomActionBar(section, status, opts = {}) {
      const saving = Boolean(opts.saving);
      const disabled = saving ? ' disabled' : '';
      const dangerDisabled = saving || opts.dangerDisabled ? ' disabled' : '';
      const statusText = saving ? 'Saving…' : (status || 'Unsaved changes.');
      const danger = opts.dangerAction ? '<button type="button" class="btn secondary danger" data-action="' + esc(opts.dangerAction) + '"' + dangerDisabled + '>' + esc(opts.dangerLabel || 'Reset') + '</button>' : '';
      return '<div class="settings-save-bar" data-settings-save-bar="' + esc(section) + '"><div class="settings-save-status" role="status" aria-live="polite">' + esc(statusText) + '</div><div class="settings-save-actions">' + danger + '<button type="button" class="btn secondary" data-action="' + esc(opts.cancelAction || 'cancel-settings') + '"' + disabled + '>Cancel</button><button type="button" class="btn" data-action="' + esc(opts.saveAction || 'save-settings') + '"' + disabled + '>Save</button></div></div>';
    }

    function closeSettingsDropdowns(except) {
      document.querySelectorAll('.settings-dropdown.open').forEach(dropdown => {
        if (dropdown === except) return;
        dropdown.classList.remove('open');
        dropdown.querySelectorAll('[aria-expanded]').forEach(button => button.setAttribute('aria-expanded', 'false'));
      });
    }

    document.addEventListener('click', e => {
      const toggle = e.target?.closest?.('[data-action="toggle-settings-dropdown"]');
      if (toggle) {
        const dropdown = toggle.closest('.settings-dropdown');
        if (!dropdown) return;
        e.preventDefault();
        const open = !dropdown.classList.contains('open');
        closeSettingsDropdowns(dropdown);
        dropdown.classList.toggle('open', open);
        dropdown.querySelectorAll('[aria-expanded]').forEach(button => button.setAttribute('aria-expanded', open ? 'true' : 'false'));
        return;
      }

      const choice = e.target?.closest?.('[data-action="settings-dropdown-choice"]');
      if (choice) {
        const dropdown = choice.closest('.settings-dropdown');
        const input = dropdown?.querySelector?.('input[type="hidden"]');
        if (!dropdown || !input) return;
        e.preventDefault();
        input.value = choice.dataset.value || '';
        const label = dropdown.querySelector('.settings-dropdown-label');
        if (label) label.textContent = choice.textContent || '';
        dropdown.querySelectorAll('.settings-dropdown-menu button').forEach(button => button.classList.toggle('active', button === choice));
        closeSettingsDropdowns();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        if (input.dataset.pref) setPreference(input.dataset.pref, input.value);
        return;
      }

      if (!e.target?.closest?.('.settings-dropdown')) closeSettingsDropdowns();
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeSettingsDropdowns();
    });

    let menuTypeAheadBuf = '';
    let menuTypeAheadTimer = null;
    function focusableMenuItems(menuEl) {
      return Array.from(menuEl.querySelectorAll(':scope > button:not([disabled])'));
    }
    function findActiveMenu(target) {
      if (!target?.closest) return null;
      const settingsMenu = target.closest('.settings-dropdown.open .settings-dropdown-menu, .settings-dropdown.open .launch-menu');
      if (settingsMenu) return settingsMenu;
      const sortMenu = target.closest('.agent-sort-options');
      if (sortMenu) return sortMenu;
      const launchMenu = target.closest('.launch-menu');
      if (launchMenu) return launchMenu;
      return null;
    }
    function isMenuTrigger(el) {
      return Boolean(el?.matches?.('[aria-expanded][data-action="toggle-launch-menu"], [aria-expanded][data-action="toggle-settings-dropdown"], [aria-expanded][data-action="toggle-agent-sort-menu"]'));
    }
    function closeAllMenus() {
      try { closeSettingsDropdowns(); } catch {}
      try { if (typeof closeLaunchMenu === 'function') closeLaunchMenu(); } catch {}
      try {
        if (typeof sortMenuOpen !== 'undefined' && sortMenuOpen) {
          sortMenuOpen = false;
          if (page === 'agents' && agentsSubView === 'overview') renderAgentOverview();
        }
      } catch {}
    }
    document.addEventListener('keydown', e => {
      const target = document.activeElement;
      if (isMenuTrigger(target)) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (target.getAttribute('aria-expanded') !== 'true') target.click();
          const wantLast = e.key === 'ArrowUp';
          requestAnimationFrame(() => {
            const container = (document.activeElement?.closest?.('.launch-split, .agent-sort-menu') || target.closest('.launch-split, .agent-sort-menu'));
            const menu = container?.querySelector?.('.launch-menu, .settings-dropdown-menu, .agent-sort-options');
            if (!menu) return;
            const items = focusableMenuItems(menu);
            if (items.length === 0) return;
            (wantLast ? items[items.length - 1] : items[0])?.focus();
          });
          return;
        }
      }
      const menu = findActiveMenu(target);
      if (!menu) return;
      const items = focusableMenuItems(menu);
      if (items.length === 0) return;
      const idx = items.indexOf(target);
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAllMenus();
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        if (idx >= 0) { e.preventDefault(); items[idx].click(); }
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1 + items.length) % items.length]?.focus(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); items[(idx - 1 + items.length) % items.length]?.focus(); return; }
      if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); return; }
      if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); return; }
      if (e.key.length === 1 && /[\w ]/.test(e.key)) {
        if (menuTypeAheadTimer) clearTimeout(menuTypeAheadTimer);
        menuTypeAheadBuf = (menuTypeAheadBuf + e.key).toLowerCase();
        menuTypeAheadTimer = setTimeout(() => { menuTypeAheadBuf = ''; }, 600);
        const match = items.find(item => (item.textContent || '').trim().toLowerCase().startsWith(menuTypeAheadBuf));
        if (match) { e.preventDefault(); match.focus(); }
      }
    });

    let appTooltipShowTimer = null;
    function appTooltipEl() { return document.getElementById('appTooltip'); }
    function appTooltipShouldShow(target) {
      if (document.documentElement.dataset.sidebar !== 'collapsed') return false;
      return target.closest('.sidebar') !== null;
    }
    function showAppTooltip(target, text) {
      const el = appTooltipEl();
      if (!el || !text) return;
      el.textContent = text;
      el.hidden = false;
      el.style.left = '0px';
      el.style.top = '0px';
      const rect = target.getBoundingClientRect();
      const tipRect = el.getBoundingClientRect();
      let left = rect.right + 8;
      if (left + tipRect.width > window.innerWidth - 8) left = Math.max(8, rect.left - tipRect.width - 8);
      let top = rect.top + rect.height / 2 - tipRect.height / 2;
      top = Math.max(8, Math.min(window.innerHeight - tipRect.height - 8, top));
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      el.classList.add('app-tooltip-visible');
    }
    function hideAppTooltip() {
      const el = appTooltipEl();
      if (!el) return;
      el.classList.remove('app-tooltip-visible');
      el.hidden = true;
    }
    function attachAppTooltip(target) {
      if (!appTooltipShouldShow(target)) return;
      const text = target.dataset.tip || target.getAttribute('aria-label') || '';
      if (!text) return;
      if (appTooltipShowTimer) clearTimeout(appTooltipShowTimer);
      appTooltipShowTimer = setTimeout(() => showAppTooltip(target, text), 150);
    }
    function clearAppTooltipTimers() {
      if (appTooltipShowTimer) { clearTimeout(appTooltipShowTimer); appTooltipShowTimer = null; }
    }
    document.addEventListener('pointerover', e => {
      const target = e.target?.closest?.('[data-tip]');
      if (!target) return;
      attachAppTooltip(target);
    });
    document.addEventListener('pointerout', e => {
      const target = e.target?.closest?.('[data-tip]');
      if (!target) return;
      clearAppTooltipTimers();
      hideAppTooltip();
    });
    document.addEventListener('focusin', e => {
      const target = e.target?.closest?.('[data-tip]');
      if (!target) return;
      attachAppTooltip(target);
    });
    document.addEventListener('focusout', e => {
      const target = e.target?.closest?.('[data-tip]');
      if (!target) return;
      clearAppTooltipTimers();
      hideAppTooltip();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { clearAppTooltipTimers(); hideAppTooltip(); } });
    document.addEventListener('click', () => { clearAppTooltipTimers(); hideAppTooltip(); });

    // Truncate-aware tooltip: shows the full text on hover/focus only when the
    // element is actually clipped. Mark bound elements to avoid double tips.
    installTruncateTitleFallback();
    function truncateTipText(target) { return target.dataset.truncateTip || target.textContent || ''; }
    function isTruncateTipClipped(target) {
      return target.scrollWidth > target.clientWidth + 1 || target.scrollHeight > target.clientHeight + 1;
    }
    function attachTruncateTip(target) {
      if (!(target instanceof HTMLElement)) return;
      if (!isTruncateTipClipped(target)) return;
      const text = truncateTipText(target);
      if (!text) return;
      if (appTooltipShowTimer) clearTimeout(appTooltipShowTimer);
      appTooltipShowTimer = setTimeout(() => showAppTooltip(target, text), 150);
    }
    function bindTruncateTip(target) {
      if (!(target instanceof HTMLElement)) return;
      if (target.dataset.truncateTipBound) return;
      target.dataset.truncateTipBound = '1';
      target.addEventListener('pointerenter', () => attachTruncateTip(target));
      target.addEventListener('pointerleave', () => { clearAppTooltipTimers(); hideAppTooltip(); });
      target.addEventListener('focus', () => attachTruncateTip(target));
      target.addEventListener('blur', () => { clearAppTooltipTimers(); hideAppTooltip(); });
    }
    function bindTruncateTips(root = document) {
      if (!root) return;
      if (root instanceof HTMLElement && root.matches('[data-truncate-tip]:not([data-truncate-tip-bound])')) bindTruncateTip(root);
      root.querySelectorAll?.('[data-truncate-tip]:not([data-truncate-tip-bound])').forEach(bindTruncateTip);
    }
    function hintTipText(target) { return target.dataset.hint || ''; }
    function attachHintTip(target) {
      if (!(target instanceof HTMLElement)) return;
      const text = hintTipText(target);
      if (!text) return;
      if (appTooltipShowTimer) clearTimeout(appTooltipShowTimer);
      appTooltipShowTimer = setTimeout(() => showAppTooltip(target, text), 150);
    }
    function bindHintTip(target) {
      if (!(target instanceof HTMLElement)) return;
      if (target.dataset.hintTipBound) return;
      target.dataset.hintTipBound = '1';
      target.addEventListener('pointerenter', () => attachHintTip(target));
      target.addEventListener('pointerleave', () => { clearAppTooltipTimers(); hideAppTooltip(); });
      target.addEventListener('focus', () => attachHintTip(target));
      target.addEventListener('blur', () => { clearAppTooltipTimers(); hideAppTooltip(); });
    }
    function bindHintTips(root = document) {
      if (!root) return;
      if (root instanceof HTMLElement && root.matches('[data-hint]:not([data-hint-tip-bound])')) bindHintTip(root);
      root.querySelectorAll?.('[data-hint]:not([data-hint-tip-bound])').forEach(bindHintTip);
    }
    function installTruncateTooltipController() {
      document.documentElement.dataset.truncateTipController = 'ready';
      bindTruncateTips();
      bindHintTips();
      if (typeof MutationObserver === 'function') {
        const observer = new MutationObserver(records => {
          records.forEach(record => record.addedNodes.forEach(node => {
            if (node instanceof HTMLElement) {
              bindTruncateTips(node);
              bindHintTips(node);
            }
          }));
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }
    }
    installTruncateTooltipController();

    const modalCloseHandlers = new WeakMap();
    const modalA11yBound = new WeakMap();
    function setModalCloseHandler(modal, fn) { if (modal) modalCloseHandlers.set(modal, fn); }
    function focusableInsideModal(modal) {
      return Array.from(modal.querySelectorAll('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter(item => !item.hidden && (item.offsetWidth + item.offsetHeight) > 0);
    }
    function activeModalElement() {
      const all = document.querySelectorAll('.modal-backdrop:not(.hidden)');
      return all[all.length - 1] || null;
    }
    function bindModalA11y(modal) {
      if (modalA11yBound.has(modal)) return;
      const lastFocus = document.activeElement;
      const onKeydown = (e) => {
        if (modal.classList.contains('hidden')) return;
        if (activeModalElement() !== modal) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          const close = modalCloseHandlers.get(modal) || (() => modal.classList.add('hidden'));
          close();
          return;
        }
        if (e.key === 'Tab') {
          const items = focusableInsideModal(modal);
          if (items.length === 0) { e.preventDefault(); return; }
          const first = items[0];
          const last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      };
      document.addEventListener('keydown', onKeydown);
      setTimeout(() => {
        const items = focusableInsideModal(modal);
        const initial = modal.querySelector('[data-modal-initial-focus]')
          || items.find(el => el.matches('textarea, input:not([type="button"]):not([type="submit"])'))
          || items[0];
        try { initial?.focus(); } catch {}
      }, 0);
      modalA11yBound.set(modal, { onKeydown, lastFocus });
    }
    function unbindModalA11y(modal) {
      const state = modalA11yBound.get(modal);
      if (!state) return;
      document.removeEventListener('keydown', state.onKeydown);
      modalA11yBound.delete(modal);
      if (state.lastFocus && typeof state.lastFocus.focus === 'function') {
        try { state.lastFocus.focus(); } catch {}
      }
    }
    function watchModalA11y(modal) {
      if (!modal) return;
      const observer = new MutationObserver(records => {
        for (const r of records) {
          if (r.type === 'attributes' && r.attributeName === 'class') {
            if (modal.classList.contains('hidden')) unbindModalA11y(modal);
            else bindModalA11y(modal);
          }
        }
      });
      observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
      if (!modal.classList.contains('hidden')) bindModalA11y(modal);
    }
    document.querySelectorAll('.modal-backdrop').forEach(watchModalA11y);
    new MutationObserver(records => {
      for (const r of records) {
        r.addedNodes.forEach(node => {
          if (node?.classList?.contains?.('modal-backdrop')) watchModalA11y(node);
        });
      }
    }).observe(document.body, { childList: true });

    function openConfirm(opts = {}) {
      const modal = $('confirmModal');
      const title = $('confirmModalTitle');
      const body = $('confirmModalBody');
      const confirmBtn = $('confirmModalConfirmBtn');
      const cancelBtn = $('confirmModalCancelBtn');
      if (!modal || !title || !body || !confirmBtn || !cancelBtn) return Promise.resolve(false);
      title.textContent = opts.title || 'Confirm';
      body.textContent = opts.body || '';
      confirmBtn.textContent = opts.confirmLabel || 'Confirm';
      cancelBtn.textContent = opts.cancelLabel || 'Cancel';
      confirmBtn.classList.toggle('danger', Boolean(opts.danger));
      modal.classList.remove('hidden');
      return new Promise(resolve => {
        function cleanup() {
          modal.classList.add('hidden');
          confirmBtn.removeEventListener('click', onConfirm);
          cancelBtn.removeEventListener('click', onCancel);
          modal.removeEventListener('click', onBackdrop);
          document.removeEventListener('keydown', onKey);
        }
        function onConfirm(e) { e.preventDefault(); cleanup(); resolve(true); }
        function onCancel(e) { e?.preventDefault(); cleanup(); resolve(false); }
        function onBackdrop(e) { if (e.target === modal) onCancel(e); }
        function onKey(e) { if (e.key === 'Escape') onCancel(e); }
        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        modal.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey);
        cancelBtn.focus();
      });
    }

    let appToastCounter = 0;
    function showToast(message, opts = {}) {
      const stack = $('notificationToastStack') || document.getElementById('notificationToastStack');
      if (!stack) return;
      const variant = opts.variant === 'error' ? 'error' : 'info';
      const duration = Math.max(1000, Number(opts.duration || 5000));
      const id = 'app-toast-' + Date.now().toString(36) + '-' + (++appToastCounter);
      const title = opts.title || (variant === 'error' ? 'Error' : 'WhatsAgent');
      const remove = () => {
        stack.querySelectorAll('[data-app-toast-id]').forEach(node => {
          if (node.dataset.appToastId === id) node.remove();
        });
      };
      stack.insertAdjacentHTML('beforeend', '<div class="notification-toast app-toast app-toast-' + esc(variant) + '" role="status" data-app-toast-id="' + esc(id) + '"><div class="notification-toast-title">' + esc(title) + '</div><div class="notification-toast-body">' + esc(message) + '</div><div class="notification-toast-actions"><button type="button" class="btn secondary small notification-toast-action" data-action="dismiss-app-toast" data-app-toast-id="' + esc(id) + '" aria-label="Dismiss">×</button></div></div>');
      setTimeout(remove, duration);
    }

    document.addEventListener('click', e => {
      const target = e.target?.closest?.('[data-action="dismiss-app-toast"][data-app-toast-id]');
      if (!target) return;
      e.preventDefault();
      document.querySelectorAll('[data-app-toast-id]').forEach(node => {
        if (node.dataset.appToastId === target.dataset.appToastId) node.remove();
      });
    });

    const WHATSAGENT_ICON_ACCENTS = new Set(['indigo', 'violet', 'blue', 'teal', 'rose', 'amber']);

    function whatsAgentIconAccent(value = prefs.accentColor) {
      return WHATSAGENT_ICON_ACCENTS.has(value) ? value : 'indigo';
    }

    function whatsAgentIconPath(accent, size) {
      return '/assets/icons/whatsagent-' + whatsAgentIconAccent(accent) + '-' + size + '.png';
    }

    function updateAccentIconAssets() {
      const accent = whatsAgentIconAccent();
      const brandIcon = $('brandIcon');
      if (brandIcon) {
        brandIcon.src = whatsAgentIconPath(accent, 32);
        brandIcon.srcset = whatsAgentIconPath(accent, 32) + ' 1x, ' + whatsAgentIconPath(accent, 64) + ' 2x';
      }
      const favicon = $('favicon');
      if (favicon) favicon.href = whatsAgentIconPath(accent, 16);
    }

    const originalApplyPreferencesForIcons = applyPreferences;
    applyPreferences = function applyPreferencesWithAccentIcons() {
      originalApplyPreferencesForIcons();
      updateAccentIconAssets();
    };
    updateAccentIconAssets();

    function renderSafeMarkdown(value) {
      return renderSafeMarkdownHtml(value, esc);
    }

    function renderMessageComposer(opts = {}) {
      const id = opts.id || 'messageCompose';
      const action = opts.action || 'send-message';
      const counterId = opts.counterId || id + 'Counter';
      const disabled = opts.disabled ? ' disabled' : '';
      const extraClass = opts.extraClass ? ' ' + opts.extraClass : '';
      const parentId = opts.parentId ? ' data-parent-id="' + esc(opts.parentId) + '"' : '';
      const leftControls = opts.leftControls || '';
      const buttonLabel = esc(opts.label || 'Send');
      const buttonClass = opts.iconOnly ? 'btn message-composer-send-icon' : 'btn';
      const buttonContent = opts.iconOnly ? sendIconSvg() : buttonLabel;
      return '<div class="compose message-composer' + extraClass + '" style="--message-composer-height:' + messageComposerHeight() + 'px">' +
        '<div class="message-composer-resize" data-action="resize-message-composer" role="separator" aria-orientation="horizontal" title="Drag to resize message editor"></div>' +
        '<div class="message-composer-box"><textarea id="' + esc(id) + '" data-message-length-input="' + esc(counterId) + '" placeholder="' + esc(opts.placeholder || '') + '"' + disabled + '>' + esc(opts.value || '') + '</textarea>' +
        '<div class="message-composer-controls"><div class="message-composer-tools">' + leftControls + '</div><div class="message-composer-actions"><div id="' + esc(counterId) + '" class="message-length-counter"></div><button class="' + buttonClass + '" data-action="' + esc(action) + '" aria-label="' + buttonLabel + '" title="' + buttonLabel + '"' + parentId + disabled + '>' + buttonContent + '</button></div></div></div></div>';
    }

    renderMessageBubble = function renderMessageBubbleWithAvatar(message, selectedRoleName) {
      const mine = message.to_role_name !== HUMAN_PEER && (!message.from_role_name || message.from_role_name === HUMAN_PEER || message.from_role_name === selectedRoleName);
      const rejected = message.state === 'rejected';
      const sender = message.from_role_name || HUMAN_PEER;
      const delivery = message.delivery_kind === 'broadcast' ? 'broadcast \u00B7 ' : '';
      const meta = delivery + sender + ' \u2192 ' + message.to_role_name + ' \u00B7 ' + messageReceiptState(message) + ' \u00B7 ' + formatMessageTime(message.sent_at);
      return '<div class="message-bubble-row ' + (mine ? 'mine ' : '') + (rejected ? 'rejected' : '') + '"><div class="message-avatar">' + messagePeerAvatar(sender, 30) + '</div><div class="bubble ' + (mine ? 'mine ' : '') + (rejected ? 'rejected' : '') + '"><div class="bubble-meta">' + esc(meta) + '</div><div class="bubble-body markdown-body">' + renderSafeMarkdown(message.body) + '</div>' + (message.error ? '<div class="bubble-meta" style="margin-top:8px">' + esc(message.error) + '</div>' : '') + '</div></div>';
    };

    function settingsWorkspaceSubtitle(scope) {
      const label = scope === 'daemon' ? 'Global' : 'Applies to current workspace';
      return '<span class="settings-scope-badge" data-settings-scope="' + esc(scope || 'workspace') + '">' + esc(label) + '</span>';
    }



    installAgents(clientCtx);
    renderAgentOverview = function () { renderAgentsOverview(); };
    launchControl = function (role, runner) { return agentsLaunchControl(role, runner); };
    renderLaunchDialog = function () { agentsRenderLaunchDialog(); };
    installCodex(clientCtx);
    runnerSnapshotFor = codexRunnerSnapshotFor;
    agentTabDot = codexAgentTabDot;
    pollStatus = codexPollStatus;
    installMessages(clientCtx);
    installNotifications(clientCtx);




    (function installCopyVisibleTerminal() {
      let terminalCopyStatus = '';
      let tuiBarOpenMenu = '';
      let quickPrompts = null;
      let quickPromptsLoading = false;
      let quickPromptsStatus = '';
      const tuiPromptsAutoOpenedForNudge = {};
      const originalRenderTerminal = renderTerminal;
      // EP-029 T4: WA-114 OpenCode pulse + recovery infrastructure +
      // related stabilization helpers deleted — server-side mirror-as-
      // source restore frame + controller's ResizeObserver subsume the
      // heuristic stabilizers.

      renderTerminal = function renderTerminalWithCopyVisible(roleName) {
        originalRenderTerminal(roleName);
        installTerminalToolbar(roleName);
      };

      function tuiBarHostLaunchable(host) {
        if (!host) return false;
        const detection = state.runtimeDetection ? state.runtimeDetection[host] : null;
        const cfgKey = host === 'opencode' ? 'openCode' : (host === 'codex' ? 'codex' : (host === 'claude-code' ? 'claudeCode' : (host === 'pi' ? 'pi' : null)));
        const cfg = cfgKey ? ((state.runtime && state.runtime.commands) || {})[cfgKey] : null;
        if (!detection) return cfg ? cfg.enabled !== false : true;
        return detection.detected && (!cfg || cfg.enabled !== false);
      }

      function tuiBarLaunchControl(roleName) {
        const runner = runnerFor(roleName);
        if (runner) {
          return '<button class="btn danger small" data-action="confirm-stop-role" data-role="' + esc(roleName) + '">Stop</button>';
        }
        const menuOpen = tuiBarOpenMenu === 'launch:' + roleName;
        const role = roleByName(roleName);
        const defaultRuntime = role?.host_default || (state.runtime && state.runtime.globalDefaultHost) || '';
        const defaultLaunchable = defaultRuntime ? tuiBarHostLaunchable(defaultRuntime) : false;
        const allItems = [
          ['default', 'Default runtime'],
          ['claude-code', 'Claude Code'],
          ['opencode', 'OpenCode'],
          ['codex', 'Codex'],
          ['pi', 'Pi'],
        ];
        const items = allItems.filter(([host]) => host === 'default' ? defaultLaunchable : tuiBarHostLaunchable(host));
        const startDisabled = !defaultLaunchable && items.length === 0;
        const menuBody = items.length === 0
          ? '<div class="launch-menu-empty">No runtimes detected. Configure in Settings &rarr; Runtime.</div>'
          : items.map(([host, label]) => {
              return '<button role="menuitem" data-action="tui-bar-launch" data-role="' + esc(roleName) + '" data-host="' + esc(host) + '">' + esc(label) + '</button>';
            }).join('');
        const menu = menuOpen ? ('<div class="launch-menu" role="menu">' + menuBody + '</div>') : '';
        const startAction = defaultLaunchable ? 'tui-bar-launch' : 'tui-bar-toggle-launch';
        return '<div class="launch-split"><button class="btn small" data-action="' + startAction + '" data-role="' + esc(roleName) + '" data-host="default" ' + (startDisabled ? 'disabled' : '') + '>Start</button><button class="launch-arrow" data-action="tui-bar-toggle-launch" data-role="' + esc(roleName) + '" aria-haspopup="menu" aria-expanded="' + (menuOpen ? 'true' : 'false') + '" aria-label="Choose runtime">&#9660;</button>' + menu + '</div>';
      }

      function tuiBarDisplayControl() {
        const open = tuiBarOpenMenu === 'display';
        const fontSizeRow = ['10', '12', '14', '16', '18'].map(size => {
          return '<button class="seg-option ' + (Number(prefs.terminalFontSize) === Number(size) ? 'active' : '') + '" data-action="set-pref" data-pref="terminalFontSize" data-value="' + size + '">' + size + 'px</button>';
        }).join('');
        const lineHeightRow = lineHeightOptionButtons();
        const densityRow = [['compact', 'Compact'], ['default', 'Default'], ['comfortable', 'Comfortable']].map(([v, l]) => {
          return '<button class="seg-option ' + (prefs.terminalDensity === v ? 'active' : '') + '" data-action="set-pref" data-pref="terminalDensity" data-value="' + v + '">' + esc(l) + '</button>';
        }).join('');
        const autoScrollRow = [['always', 'Always'], ['smart', 'Smart'], ['off', 'Off']].map(([v, l]) => {
          return '<button class="seg-option ' + (prefs.messageAutoScroll === v ? 'active' : '') + '" data-action="set-pref" data-pref="messageAutoScroll" data-value="' + v + '">' + esc(l) + '</button>';
        }).join('');
        const popover = open ? ('<div class="launch-menu tui-display-popover" role="menu">' +
          '<div class="tui-display-row"><div class="tui-display-row-label">Messages auto-scroll</div><div class="segmented">' + autoScrollRow + '</div></div>' +
          '<div class="tui-display-row"><div class="tui-display-row-label">Terminal density</div><div class="segmented">' + densityRow + '</div></div>' +
          '<div class="tui-display-row"><div class="tui-display-row-label">Terminal line height</div><div class="segmented">' + lineHeightRow + '</div></div>' +
          '<div class="tui-display-row"><div class="tui-display-row-label">Terminal font size</div><div class="segmented">' + fontSizeRow + '</div></div>' +
          '</div>') : '';
        return '<div class="launch-split"><button type="button" class="btn secondary small settings-dropdown-trigger" data-action="tui-bar-toggle-display" aria-haspopup="menu" aria-expanded="' + (open ? 'true' : 'false') + '"><span class="settings-dropdown-label">Display</span></button><button type="button" class="launch-arrow" data-action="tui-bar-toggle-display" aria-haspopup="menu" aria-expanded="' + (open ? 'true' : 'false') + '" aria-label="Display options">\u25BC</button>' + popover + '</div>';
      }

      function tuiBarPromptsControl(roleName) {
        const open = tuiBarOpenMenu === 'prompts';
        if (open && !quickPrompts && !quickPromptsLoading) void loadQuickPrompts();
        const popover = open ? '<div class="launch-menu tui-prompts-popover" role="menu">' + quickPromptsMenu(roleName) + '</div>' : '';
        return '<div class="launch-split"><button type="button" class="btn secondary small settings-dropdown-trigger" data-action="tui-bar-toggle-prompts" aria-haspopup="menu" aria-expanded="' + (open ? 'true' : 'false') + '"><span class="settings-dropdown-label">Prompts</span></button><button type="button" class="launch-arrow" data-action="tui-bar-toggle-prompts" aria-haspopup="menu" aria-expanded="' + (open ? 'true' : 'false') + '" aria-label="Quick prompts">\u25BC</button>' + popover + '</div>';
      }

      function quickPromptsMenu(roleName) {
        if (quickPromptsLoading && !quickPrompts) return '<div class="launch-menu-empty">Loading prompts…</div>';
        const items = quickPromptItems(roleName);
        if (items.length === 0) return '<div class="launch-menu-empty">No quick prompts available.</div>';
        return '<div class="tui-prompts-head">Quick Prompts</div>' + items.map(item => {
          return '<div class="tui-prompt-row" data-prompt-kind="' + esc(item.kind) + '"><div class="tui-prompt-row-head"><strong class="tui-prompt-title">' + esc(item.title) + '</strong><button type="button" class="btn small tui-prompt-insert" data-action="insert-quick-prompt" data-prompt-kind="' + esc(item.kind) + '" data-prompt-id="' + esc(item.id) + '">Insert</button></div><textarea readonly rows="4">' + esc(item.body) + '</textarea></div>';
        }).join('') + (quickPromptsStatus ? '<div class="agent-text-status">' + esc(quickPromptsStatus) + '</div>' : '');
      }

      function quickPromptItems(roleName) {
        const runner = runnerStatusFor(roleName);
        const agentText = quickPrompts?.agentText || state.agentText || {};
        const items = [];
        if (QUICK_PROMPT_ENABLED_RUNTIMES.has(runner?.host_type) && agentText.pushedInboxInstructions) {
          items.push({ kind: 'builtin', id: 'pushedInboxInstructions', title: 'Inbox nudge', body: agentText.pushedInboxInstructions });
        }
        for (const prompt of quickPrompts?.customPrompts || []) {
          items.push({ kind: 'custom', id: prompt.id, title: prompt.title, body: prompt.body || '' });
        }
        return items;
      }

      async function loadQuickPrompts() {
        quickPromptsLoading = true;
        quickPromptsStatus = '';
        try {
          const [agentTextRes, customRes] = await Promise.all([
            fetch(daemonApiUrl('/settings/agent-text')),
            fetch(daemonApiUrl('/settings/custom-prompts')),
          ]);
          const [agentTextBody, customBody] = await Promise.all([agentTextRes.json(), customRes.json()]);
          if (!agentTextRes.ok || agentTextBody.ok === false) throw new Error(agentTextBody.error || 'agent text load failed');
          if (!customRes.ok || customBody.ok === false) throw new Error(customBody.error || 'custom prompts load failed');
          quickPrompts = { agentText: agentTextBody.agentText || {}, customPrompts: customBody.prompts || [] };
        } catch (e) {
          quickPromptsStatus = 'Failed to load prompts: ' + String(e?.message || e);
          quickPrompts = { agentText: state.agentText || {}, customPrompts: [] };
        } finally {
          quickPromptsLoading = false;
          refreshTerminalToolbar();
        }
      }

      function quickPromptBody(kind, id) {
        if (kind === 'builtin' && id === 'pushedInboxInstructions') return String((quickPrompts?.agentText || state.agentText || {}).pushedInboxInstructions || '');
        return String((quickPrompts?.customPrompts || []).find(prompt => prompt.id === id)?.body || '');
      }

      openQuickPromptsForNudge = function openQuickPromptsForNudge(roleName, nudgeKey) {
        if (!roleName || !nudgeKey || page !== 'agents' || activeTerminalRole() !== roleName) return false;
        if (tuiPromptsAutoOpenedForNudge[roleName] === nudgeKey) return false;
        tuiPromptsAutoOpenedForNudge[roleName] = nudgeKey;
        tuiBarOpenMenu = 'prompts';
        if (!quickPrompts && !quickPromptsLoading) void loadQuickPrompts();
        refreshTerminalToolbar();
        return true;
      };

      function installTerminalToolbar(roleName) {
        const terminal = $('agentTabContent')?.querySelector?.('.terminal');
        if (!terminal || terminal.querySelector('.terminal-toolbar')) return;
        const html = '<div class="terminal-toolbar" data-role="' + esc(roleName) + '">' +
          tuiBarLaunchControl(roleName) +
          tuiBarPromptsControl(roleName) +
          tuiBarDisplayControl() +
          '<span class="terminal-toolbar-spacer"></span>' +
          '<button class="btn secondary small" data-action="copy-visible-terminal">Copy visible</button>' +
          '<span id="terminalCopyStatus" class="terminal-copy-status">' + esc(terminalCopyStatus) + '</span>' +
          '</div>';
        terminal.insertAdjacentHTML('afterbegin', html);
      }

      function refreshTerminalToolbar() {
        const terminal = $('agentTabContent')?.querySelector?.('.terminal');
        if (!terminal) return;
        const role = activeTerminalRole();
        if (!role) return;
        const existing = terminal.querySelector('.terminal-toolbar');
        if (!existing) return;
        const html = '<div class="terminal-toolbar" data-role="' + esc(role) + '">' +
          tuiBarLaunchControl(role) +
          tuiBarPromptsControl(role) +
          tuiBarDisplayControl() +
          '<span class="terminal-toolbar-spacer"></span>' +
          '<button class="btn secondary small" data-action="copy-visible-terminal">Copy visible</button>' +
          '<span id="terminalCopyStatus" class="terminal-copy-status">' + esc(terminalCopyStatus) + '</span>' +
          '</div>';
        existing.outerHTML = html;
      }

      // EP-004 WA-015: tuiBarOpenMenu joins the unified dismiss registry.
      bindDropdownDismiss({
        rootSelector: '.terminal-toolbar',
        isOpen: () => Boolean(tuiBarOpenMenu),
        dismiss: () => { tuiBarOpenMenu = ''; refreshTerminalToolbar(); },
      });

      document.addEventListener('click', e => {
        const target = e.target?.closest?.('[data-action]');
        if (!target) {
          if (tuiBarOpenMenu && !e.target?.closest?.('.terminal-toolbar')) {
            tuiBarOpenMenu = '';
            refreshTerminalToolbar();
          }
          return;
        }
        const action = target.dataset.action;
        const role = target.dataset.role || activeTerminalRole();
        if (action === 'tui-bar-toggle-launch') {
          e.preventDefault();
          const key = 'launch:' + (role || '');
          tuiBarOpenMenu = tuiBarOpenMenu === key ? '' : key;
          refreshTerminalToolbar();
          return;
        }
        if (action === 'tui-bar-toggle-display') {
          e.preventDefault();
          tuiBarOpenMenu = tuiBarOpenMenu === 'display' ? '' : 'display';
          refreshTerminalToolbar();
          return;
        }
        if (action === 'tui-bar-toggle-prompts') {
          e.preventDefault();
          tuiBarOpenMenu = tuiBarOpenMenu === 'prompts' ? '' : 'prompts';
          refreshTerminalToolbar();
          return;
        }
        if (action === 'insert-quick-prompt') {
          e.preventDefault();
          const body = quickPromptBody(target.dataset.promptKind, target.dataset.promptId);
          tuiBarOpenMenu = '';
          refreshTerminalToolbar();
          if (body) void sendTerminalInput(body, true);
          setTimeout(() => activeXterm?.focus(), 0);
          return;
        }
        if (action === 'tui-bar-launch') {
          e.preventDefault();
          tuiBarOpenMenu = '';
          if (typeof launch === 'function') void launch(role, target.dataset.host || 'default');
          return;
        }
        if (action === 'confirm-stop-role') {
          e.preventDefault();
          openConfirmStopDialog(role);
          return;
        }
        if (action === 'set-pref' && target.closest('.tui-display-popover')) {
          // setPreference fires from another listener; refresh toolbar to sync active states
          setTimeout(refreshTerminalToolbar, 0);
        }
      }, true);

      let confirmStopRole = '';
      function openConfirmStopDialog(role) {
        if (!role) return;
        confirmStopRole = role;
        const sub = $('confirmStopModalSub');
        if (sub) sub.textContent = 'This will end the live session for ' + role + '.';
        $('confirmStopModal')?.classList.remove('hidden');
      }
      function closeConfirmStopDialog() {
        confirmStopRole = '';
        $('confirmStopModal')?.classList.add('hidden');
      }
      setModalCloseHandler($('confirmStopModal'), closeConfirmStopDialog);
      $('confirmStopCancelBtn')?.addEventListener('click', e => { e.preventDefault(); closeConfirmStopDialog(); });
      $('confirmStopActionBtn')?.addEventListener('click', e => {
        e.preventDefault();
        const role = confirmStopRole;
        closeConfirmStopDialog();
        if (role && typeof stopRole === 'function') void stopRole(role);
      });
      $('confirmStopModal')?.addEventListener('click', e => { if (e.target === $('confirmStopModal')) closeConfirmStopDialog(); });

      // Apply confirm-stop to Agents Overview Stop button too (D1).
      document.addEventListener('click', e => {
        const target = e.target?.closest?.('[data-action="stop-role"]');
        if (!target) return;
        if (target.closest('.terminal-toolbar')) return;
        e.preventDefault();
        e.stopPropagation();
        openConfirmStopDialog(target.dataset.role || '');
      }, true);

      // EP-029 T4: terminal-mount stabilization helpers deleted —
      // TerminalController owns mount lifecycle + ResizeObserver +
      // FitAddon + restore-frame-driven SIGWINCH coalescing. WA-114
      // OpenCode pulse infrastructure subsumed by mirror-as-source.

      function visibleTerminalText() {
        const xtermText = visibleXtermText();
        if (xtermText) return xtermText;
        return visibleFallbackTerminalText();
      }

      function visibleXtermText() {
        return terminalController?.visibleText?.() || '';
      }

      function visibleFallbackTerminalText() {
        const el = $('terminalBody');
        if (!el) return '';
        const text = el.textContent || '';
        const lines = text.split(/\r?\n/);
        const style = getComputedStyle(el);
        const lineHeight = Number.parseFloat(style.lineHeight) || 16;
        const start = Math.max(0, Math.floor(el.scrollTop / lineHeight));
        const count = Math.max(1, Math.ceil(el.clientHeight / lineHeight));
        return lines.slice(start, start + count).join('\n').replace(/[\s\n]+$/g, '');
      }

      async function copyText(text) {
        if (!text) return false;
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
          }
        } catch {}
        try {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.setAttribute('readonly', '');
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          const ok = document.execCommand('copy');
          textarea.remove();
          return ok;
        } catch {
          return false;
        }
      }

      async function copyVisibleTerminal() {
        const text = visibleTerminalText();
        const ok = await copyText(text);
        terminalCopyStatus = ok ? 'Copied visible terminal.' : 'Nothing copied.';
        const status = $('terminalCopyStatus');
        if (status) status.textContent = terminalCopyStatus;
        setTimeout(() => {
          if (terminalCopyStatus) {
            terminalCopyStatus = '';
            const next = $('terminalCopyStatus');
            if (next) next.textContent = '';
          }
        }, 2500);
      }

      document.addEventListener('click', e => {
        const target = e.target?.closest?.('[data-action="copy-visible-terminal"]');
        if (!target) return;
        e.preventDefault();
        void copyVisibleTerminal();
      });

      // EP-029 WA-138: legacy visibility/focus terminal-recovery
      // listeners removed (helper deleted in T4-d). TerminalController
      // owns its own ResizeObserver + parking-root lifecycle; the
      // legacy hooks were both ReferenceError sites and obsolete.
    })();

    (function installLiveTerminalPreferenceRefresh() {
      const originalSetPreference = setPreference;
      const terminalOptionKeys = new Set(['terminalFontSize', 'terminalLineHeight', 'terminalDensity']);

      setPreference = function setPreferenceWithTerminalRefresh(key, value) {
        const role = page === 'agents' ? activeTerminalRole() : null;
        originalSetPreference(key, value);
        if (!terminalOptionKeys.has(key) || !role) return;
        try { terminalController?.applyDisplayPreferences(); } catch {}
        scheduleTerminalFit(true);
      };
    })();



    (function installWorkspaceSwitcherUi() {
      let workspaceMenuOpen = false;
      let workspaceAddSaving = false;
      let workspaceSwitcherError = '';
      let workspacesOverviewLoading = false;
      let workspacesOverviewError = '';
      let workspacesOverviewList = [];
      let workspacesOverviewRetentionDays = 30;
      let workspaceOverviewTab = 'workspaces';
      let workspaceOverviewMenuId = '';
      let workspaceLifecycleStatus = '';
      let workspaceLifecycleSaving = false;
      let workspaceEditing = null;
      let workspaceEditSaving = false;
      let workspaceEditStatus = '';
      // EP-022 / WA-099: per-modal RBAC-mode selection state. `null`
      // means nothing picked yet — submit silently rejects until the
      // operator chooses a mode (advisor-confirmed UX: no asterisk,
      // no helper text below the picker).
      let workspaceAddRbacMode = null;
      let workspaceEditRbacMode = null;

      function activeWorkspacesForSwitcher() {
        return (state.workspaces || []).filter(workspace => workspace.status !== 'trashed' && workspace.status !== 'purging');
      }

      function currentWorkspaceForSwitcher() {
        return state.nextWorkspace || state.currentWorkspace || activeWorkspacesForSwitcher()[0] || null;
      }

      function workspaceInitialsClient(name) {
        const cleaned = String(name || '').trim();
        if (!cleaned) return 'WS';
        const parts = cleaned.split(/[^a-z0-9]+/i).filter(Boolean);
        const initials = (parts.length >= 2 ? (parts[0] || '').charAt(0) + (parts[1] || '').charAt(0) : cleaned.slice(0, 2)).toUpperCase();
        return initials || 'WS';
      }

      function workspaceMenuRows(workspaces, current) {
        if (!workspaces.length) return '<div class="workspace-menu-empty">No workspaces registered</div>';
        return workspaces.map(workspace => {
          const active = current?.id === workspace.id;
          const repoCount = Number(workspace.repo_count || 0);
          const roleCount = Number(workspace.role_count || 0);
          const runnerCount = Number(workspace.runner_count || 0);
          // EP-022 / WA-099: keep counts row, append RBAC mode line
          // beneath so operators see enforcement posture at a glance.
          const rbacMode = workspace.rbac_mode || 'enforce';
          const counts = repoCount + ' repo' + (repoCount === 1 ? '' : 's') + ' / ' + roleCount + ' role' + (roleCount === 1 ? '' : 's') + ' / ' + runnerCount + ' live';
          const rbacLine = '<small class="workspace-menu-rbac">RBAC Mode: ' + esc(rbacMode) + '</small>';
          return '<button type="button" class="workspace-menu-row ' + (active ? 'active' : '') + '" data-action="switch-workspace" data-workspace-id="' + esc(workspace.id) + '" role="menuitem">' +
            '<span class="workspace-avatar">' + esc(workspaceInitialsClient(workspace.name)) + '</span>' +
            '<span class="workspace-menu-copy"><strong ' + truncatedAttrs(workspace.name) + '>' + esc(workspace.name) + '</strong><small ' + truncatedAttrs(counts) + '>' + counts + '</small>' + rbacLine + '</span>' +
          '</button>';
        }).join('');
      }

      function renderWorkspaceSwitcher() {
        const root = $('workspaceSwitcher');
        if (!root) return;
        const workspaces = activeWorkspacesForSwitcher();
        const current = currentWorkspaceForSwitcher();
        const currentName = current?.name || 'No workspace';
        // EP-022 / WA-099: trigger pill subtitle now surfaces the
        // current workspace's RBAC mode (was: repo count). Mode is
        // operator-relevant; counts already appear in the popover.
        const currentRbacMode = current?.rbac_mode || 'enforce';
        const triggerSubtitle = current
          ? 'RBAC Mode: ' + esc(currentRbacMode)
          : 'Not registered';
        const trigger = '<button type="button" class="workspace-switcher-trigger" data-action="toggle-workspace-menu" aria-haspopup="menu" aria-expanded="' + (workspaceMenuOpen ? 'true' : 'false') + '" data-tip="Switch workspace">' +
          '<span class="workspace-avatar">' + esc(workspaceInitialsClient(currentName)) + '</span>' +
          '<span class="workspace-switcher-copy"><span class="workspace-name" ' + truncatedAttrs(currentName) + '>' + esc(currentName) + '</span><span class="workspace-type-tag" ' + truncatedAttrs(triggerSubtitle) + '>' + triggerSubtitle + '</span></span>' +
          '<span class="workspace-caret" aria-hidden="true">v</span>' +
        '</button>';
        const menu = '<div class="workspace-menu ' + (workspaceMenuOpen ? '' : 'hidden') + '" id="workspaceMenu" role="menu" aria-label="Workspaces">' +
          (workspaceSwitcherError ? '<div class="workspace-menu-empty">' + esc(workspaceSwitcherError) + '</div>' : workspaceMenuRows(workspaces, current)) +
          '<div class="workspace-menu-footer"><button type="button" class="workspace-menu-add" data-action="open-workspace-add">Add Workspace</button></div>' +
        '</div>';
        root.innerHTML = trigger + menu;
        bindTruncateTips(root);
      }

      async function refreshWorkspacesForSwitcher() {
        try {
          const res = await fetch(daemonApiUrl('/workspaces'));
          const body = await res.json().catch(() => ({}));
          if (!res.ok || body.ok === false) throw new Error(body.error || 'Failed to load workspaces');
          state.workspaces = Array.isArray(body.workspaces) ? body.workspaces : [];
          state.workspacesAvailable = state.workspaces.filter(workspace => workspace.status !== 'trashed' && workspace.status !== 'purging').length;
          state.trashRetentionDays = body.trashRetentionDays;
          workspaceSwitcherError = '';
        } catch (e) {
          workspaceSwitcherError = String(e?.message || e);
        }
        renderWorkspaceSwitcher();
      }

      async function refreshWorkspacesOverview() {
        if (workspacesOverviewLoading) return;
        workspacesOverviewLoading = true;
        try {
          const res = await fetch(daemonApiUrl('/workspaces?include_trash=1'));
          const body = await res.json().catch(() => ({}));
          if (!res.ok || body.ok === false) throw new Error(body.error || 'Failed to load workspaces');
          workspacesOverviewList = Array.isArray(body.workspaces) ? body.workspaces : [];
          workspacesOverviewRetentionDays = Number.isFinite(body.trashRetentionDays) ? Number(body.trashRetentionDays) : 30;
          state.workspaces = workspacesOverviewList.filter(workspace => workspace.status !== 'trashed' && workspace.status !== 'purging');
          state.workspacesAvailable = state.workspaces.length;
          state.trashRetentionDays = workspacesOverviewRetentionDays;
          workspacesOverviewError = '';
        } catch (e) {
          workspacesOverviewError = String(e?.message || e);
        } finally {
          workspacesOverviewLoading = false;
        }
        if (page === 'workspaces-overview') renderWorkspacesOverview({ fresh: true });
        renderWorkspaceSwitcher();
      }

      function activeWorkspacesOverviewList() {
        return workspacesOverviewList.filter(workspace => workspace.status !== 'trashed' && workspace.status !== 'purging');
      }

      function trashedWorkspacesOverviewList() {
        return workspacesOverviewList.filter(workspace => workspace.status === 'trashed');
      }

      function formatTrashTimeOverview(value) {
        if (!value) return 'unknown';
        try {
          const d = new Date(value);
          if (Number.isNaN(d.getTime())) return 'unknown';
          return d.toLocaleString();
        } catch { return 'unknown'; }
      }

      function workspacePurgeLabelOverview(workspace) {
        const days = workspacesOverviewRetentionDays;
        if (!days) return 'manual purge only';
        const trashedAt = new Date(workspace.trashed_at || '').getTime();
        if (!Number.isFinite(trashedAt)) return 'auto-purge date unknown';
        const purgeAt = trashedAt + days * 24 * 60 * 60 * 1000;
        const remaining = Math.max(0, Math.ceil((purgeAt - Date.now()) / (24 * 60 * 60 * 1000)));
        return 'auto-purges in ' + remaining + ' day' + (remaining === 1 ? '' : 's');
      }

      function workspaceCardActive(workspace) {
        const repoCount = Number(workspace.repo_count || 0);
        const roleCount = Number(workspace.role_count || 0);
        const runnerCount = Number(workspace.runner_count || 0);
        const current = state.currentWorkspace?.id === workspace.id;
        const menuOpen = workspaceOverviewMenuId === workspace.id;
        const currentChip = current ? '<span class="workspace-card-current">current</span>' : '';
        const menuPanel = menuOpen ? workspaceCardMenu(workspace) : '';
        return '<article class="workspace-card" data-workspace-id="' + esc(workspace.id) + '">'
          + '<div class="workspace-card-head"><div><h2 class="workspace-card-title">' + esc(workspace.name) + currentChip + '</h2></div>'
          +   '<div class="workspace-card-actions">'
          +     '<button type="button" class="workspace-card-icon-btn" data-action="toggle-workspace-card-menu" data-workspace-id="' + esc(workspace.id) + '" aria-haspopup="menu" aria-expanded="' + (menuOpen ? 'true' : 'false') + '" aria-label="Workspace actions">' + esc('\u22EF') + '</button>'
          +     '<button type="button" class="workspace-card-icon-btn" data-action="switch-workspace" data-workspace-id="' + esc(workspace.id) + '" aria-label="Open workspace">' + esc('\u2192') + '</button>'
          +   '</div>'
          + '</div>'
          + '<div class="workspace-card-tags"><span>' + repoCount + ' repo' + (repoCount === 1 ? '' : 's') + '</span><span>' + roleCount + ' agent' + (roleCount === 1 ? '' : 's') + '</span><span>' + runnerCount + ' online</span></div>'
          + menuPanel
          + '</article>';
      }

      function workspaceCardMenu(workspace) {
        return '<div class="workspace-card-menu" role="menu">'
          + '<button type="button" data-action="open-workspace-edit" data-workspace-id="' + esc(workspace.id) + '">Edit</button>'
          + '<button type="button" class="danger" data-action="delete-workspace" data-workspace-id="' + esc(workspace.id) + '">Delete</button>'
          + '</div>';
      }

      function workspaceCardTrashed(workspace) {
        return '<article class="workspace-card trashed" data-workspace-id="' + esc(workspace.id) + '">'
          + '<div class="workspace-card-head"><div><h2 class="workspace-card-title">' + esc(workspace.name) + '</h2><div class="workspace-trash-meta">Deleted ' + esc(formatTrashTimeOverview(workspace.trashed_at)) + ' / ' + esc(workspacePurgeLabelOverview(workspace)) + '</div></div>'
          +   '<div class="workspace-card-actions">'
          +     '<button type="button" class="btn secondary small" data-action="restore-workspace" data-workspace-id="' + esc(workspace.id) + '">Restore</button>'
          +     '<button type="button" class="btn danger small" data-action="purge-workspace" data-workspace-id="' + esc(workspace.id) + '">Purge</button>'
          +   '</div>'
          + '</div>'
          + '</article>';
      }

      function workspacesOverviewRetentionFooter() {
        const value = String(workspacesOverviewRetentionDays ?? 30);
        const options = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['0', 'Manual only']];
        const select = settingsDropdown('Trash retention days', value, options, { inputAttrs: 'data-action="set-trash-retention" aria-label="Trash retention days"', className: 'trash-retention-dropdown' });
        return '<div class="workspaces-overview-footer"><span>Auto-purge deleted workspaces after</span>' + select + '</div>';
      }

      function renderWorkspacesOverview(opts = {}) {
        detachXterm();
        const content = $('content');
        if (!content) return;
        const active = activeWorkspacesOverviewList();
        const trashed = trashedWorkspacesOverviewList();
        const tab = workspaceOverviewTab === 'deleted' ? 'deleted' : 'workspaces';
        const addBtn = tab === 'workspaces' ? '<button type="button" class="term-tab tab-new" data-action="open-workspace-add">+ Add Workspace</button>' : '';
        const tabBar = '<div class="tabbar">' + mobileSidebarTab() + '<div class="tabbar-scroll" role="tablist">'
          + '<button type="button" role="tab" aria-selected="' + (tab === 'workspaces' ? 'true' : 'false') + '" class="term-tab ' + (tab === 'workspaces' ? 'active' : '') + '" data-action="select-workspaces-tab" data-tab="workspaces">Workspaces <span class="badge">' + active.length + '</span></button>'
          + '<button type="button" role="tab" aria-selected="' + (tab === 'deleted' ? 'true' : 'false') + '" class="term-tab ' + (tab === 'deleted' ? 'active' : '') + '" data-action="select-workspaces-tab" data-tab="deleted">Deleted <span class="badge">' + trashed.length + '</span></button>'
          + '</div>' + addBtn + '</div>';
        const errorBanner = workspacesOverviewError ? '<div class="workspace-overview-error">' + esc(workspacesOverviewError) + '</div>' : '';
        const statusBanner = workspaceLifecycleStatus ? '<div class="workspace-add-status' + (workspaceLifecycleStatus.startsWith('Failed') ? ' error' : '') + '">' + esc(workspaceLifecycleStatus) + '</div>' : '';
        const body = tab === 'workspaces'
          ? (active.length ? active.map(workspaceCardActive).join('') : '<div class="thread-empty">No active workspaces.</div>')
          : ((trashed.length ? trashed.map(workspaceCardTrashed).join('') : '<div class="thread-empty">No deleted workspaces.</div>') + workspacesOverviewRetentionFooter());
        const previousWorkspacesScroll = document.querySelector('.workspaces-overview-page .agent-overview')?.scrollTop || 0;
        content.innerHTML = '<div class="workspaces-overview-page">' + tabBar + '<div class="tab-content"><div class="agent-overview">' + errorBanner + statusBanner + body + '</div></div></div>';
        if (previousWorkspacesScroll) requestAnimationFrame(() => {
          const next = document.querySelector('.workspaces-overview-page .agent-overview');
          if (next) next.scrollTop = previousWorkspacesScroll;
        });
        if (!opts.fresh) void refreshWorkspacesOverview();
      }

      function setWorkspaceAddStatus(message, error = false) {
        const el = $('workspaceAddStatus');
        if (!el) return;
        el.textContent = message || '';
        el.classList.toggle('error', error);
      }

      function openWorkspaceAddModal() {
        const modal = $('workspaceAddModal');
        if (!modal) return;
        $('workspaceAddName').value = '';
        $('workspaceAddKanbanPrefix').value = 'WA';
        // EP-022 / WA-099: reset RBAC mode to null on open. Submit
        // silently rejects until operator picks one.
        workspaceAddRbacMode = null;
        renderWorkspaceAddRbacMode();
        setWorkspaceAddStatus('');
        modal.classList.remove('hidden');
        setTimeout(() => $('workspaceAddName')?.focus(), 0);
      }

      function renderWorkspaceAddRbacMode() {
        const picker = $('workspaceAddRbacMode');
        if (!picker) return;
        for (const btn of picker.querySelectorAll('.rbac-mode-option')) {
          const selected = btn.dataset.rbacMode === workspaceAddRbacMode;
          btn.classList.toggle('selected', selected);
          btn.setAttribute('aria-checked', selected ? 'true' : 'false');
        }
      }

      function selectWorkspaceAddRbacMode(mode) {
        if (mode !== 'enforce' && mode !== 'soft' && mode !== 'off') return;
        workspaceAddRbacMode = mode;
        renderWorkspaceAddRbacMode();
      }

      function closeWorkspaceAddModal() {
        if (workspaceAddSaving) return;
        $('workspaceAddModal')?.classList.add('hidden');
        setWorkspaceAddStatus('');
      }

      async function submitWorkspaceAdd() {
        if (workspaceAddSaving) return;
        const name = String($('workspaceAddName')?.value || '').trim();
        const kanbanPrefix = String($('workspaceAddKanbanPrefix')?.value || '').trim();
        if (!name) {
          setWorkspaceAddStatus('Name is required.', true);
          return;
        }
        // EP-022 / WA-099: submit silently rejects when RBAC mode is
        // unset (no asterisk on the field, no inline error — the
        // visual state of the picker already tells the operator
        // which option is missing). API would 400 anyway since T3
        // tightened POST /workspaces to require rbacMode.
        if (workspaceAddRbacMode !== 'enforce' && workspaceAddRbacMode !== 'soft' && workspaceAddRbacMode !== 'off') {
          return;
        }
        workspaceAddSaving = true;
        $('workspaceAddSubmitBtn').disabled = true;
        setWorkspaceAddStatus('Adding…');
        try {
          const res = await fetch(daemonApiUrl('/workspaces'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, kanbanPrefix: kanbanPrefix || undefined, rbacMode: workspaceAddRbacMode }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok || body.ok === false) throw new Error(body.error || 'Failed to add workspace');
          await refreshWorkspacesForSwitcher();
          $('workspaceAddModal')?.classList.add('hidden');
          if (body.workspace?.id) await switchWorkspace(body.workspace.id, { updateDaemonCurrent: true });
        } catch (e) {
          setWorkspaceAddStatus(String(e?.message || e), true);
        } finally {
          workspaceAddSaving = false;
          $('workspaceAddSubmitBtn').disabled = false;
        }
      }

      function setWorkspaceOverviewTab(tab) {
        const next = tab === 'deleted' ? 'deleted' : 'workspaces';
        if (workspaceOverviewTab === next) return;
        workspaceOverviewTab = next;
        workspaceOverviewMenuId = '';
        if (page === 'workspaces-overview') renderWorkspacesOverview({ fresh: true });
      }

      async function workspaceOverviewLifecycle(id, action) {
        if (!id || workspaceLifecycleSaving) return;
        if (action === 'trash' || action === 'purge') {
          const verb = action === 'trash' ? 'Delete' : 'Purge';
          const sub = action === 'trash'
            ? 'The workspace will move to Deleted. You can restore it before auto-purge.'
            : 'This permanently removes the workspace and its history. This cannot be undone.';
          const ok = await openConfirm({ title: verb + ' this workspace?', body: sub, confirmLabel: verb, danger: true });
          if (!ok) return;
        }
        workspaceLifecycleSaving = true;
        workspaceLifecycleStatus = '';
        try {
          const res = await fetch(daemonApiUrl('/workspaces/' + encodeURIComponent(id) + '/' + action), { method: 'POST' });
          const body = await res.json().catch(() => ({}));
          if (!res.ok || body.ok === false) throw new Error(body.error || action + ' failed');
          if (action === 'trash' && state.currentWorkspace?.id === id) state.currentWorkspace = null;
          workspaceLifecycleStatus = action === 'trash' ? 'Workspace deleted.' : action === 'purge' ? 'Workspace purged.' : 'Workspace restored.';
        } catch (e) {
          workspaceLifecycleStatus = 'Failed to ' + action + ' workspace: ' + String(e?.message || e);
        } finally {
          workspaceLifecycleSaving = false;
          await refreshWorkspacesOverview();
        }
      }

      async function updateTrashRetentionFromOverview(days) {
        const numeric = Number.parseInt(String(days ?? ''), 10);
        if (!Number.isFinite(numeric) || numeric < 0) return;
        try {
          const res = await fetch(daemonApiUrl('/settings/trash-retention-days'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: numeric }) });
          const body = await res.json().catch(() => ({}));
          if (!res.ok || body.ok === false) throw new Error(body.error || 'failed');
          workspacesOverviewRetentionDays = Number.isFinite(body.trashRetentionDays) ? Number(body.trashRetentionDays) : numeric;
          state.trashRetentionDays = workspacesOverviewRetentionDays;
          workspaceLifecycleStatus = 'Trash retention updated.';
        } catch (e) {
          workspaceLifecycleStatus = 'Failed to update retention: ' + String(e?.message || e);
        }
        if (page === 'workspaces-overview') renderWorkspacesOverview({ fresh: true });
      }

      async function openWorkspaceEdit(id) {
        const ws = workspacesOverviewList.find(w => w.id === id);
        if (!ws) return;
        workspaceEditStatus = '';
        try {
          const res = await fetch(daemonApiUrl('/workspaces/' + encodeURIComponent(id) + '/settings'));
          const body = await res.json().catch(() => ({}));
          if (!res.ok || body.ok === false) throw new Error(body.error || 'load failed');
          workspaceEditing = {
            id: ws.id,
            name: ws.name,
            kanbanPrefix: String(body.kanban?.taskIdPrefix || 'WA'),
            // EP-022 / WA-099: pre-fill RBAC mode from the row so the
            // Edit modal reflects the current stored mode. Falls back
            // to 'enforce' (schema default) if the field is absent on
            // a stale workspace summary.
            rbacMode: ws.rbac_mode || 'enforce',
          };
        } catch (e) {
          workspaceLifecycleStatus = 'Failed to load workspace settings: ' + String(e?.message || e);
          if (page === 'workspaces-overview') renderWorkspacesOverview({ fresh: true });
          return;
        }
        const modal = $('workspaceEditModal');
        if (!modal) return;
        $('workspaceEditName').value = workspaceEditing.name;
        $('workspaceEditKanbanPrefix').value = workspaceEditing.kanbanPrefix;
        workspaceEditRbacMode = workspaceEditing.rbacMode;
        renderWorkspaceEditRbacMode();
        $('workspaceEditStatus').textContent = '';
        modal.classList.remove('hidden');
        setTimeout(() => $('workspaceEditName')?.focus(), 0);
      }

      function renderWorkspaceEditRbacMode() {
        const picker = $('workspaceEditRbacMode');
        if (!picker) return;
        for (const btn of picker.querySelectorAll('.rbac-mode-option')) {
          const selected = btn.dataset.rbacMode === workspaceEditRbacMode;
          btn.classList.toggle('selected', selected);
          btn.setAttribute('aria-checked', selected ? 'true' : 'false');
        }
      }

      function selectWorkspaceEditRbacMode(mode) {
        if (mode !== 'enforce' && mode !== 'soft' && mode !== 'off') return;
        workspaceEditRbacMode = mode;
        renderWorkspaceEditRbacMode();
      }

      function closeWorkspaceEdit() {
        if (workspaceEditSaving) return;
        $('workspaceEditModal')?.classList.add('hidden');
        workspaceEditing = null;
        workspaceEditRbacMode = null;
      }

      async function submitWorkspaceEdit() {
        if (!workspaceEditing || workspaceEditSaving) return;
        const id = workspaceEditing.id;
        const nextName = String($('workspaceEditName')?.value || '').trim();
        const nextPrefix = String($('workspaceEditKanbanPrefix')?.value || '').trim();
        if (!nextName) {
          $('workspaceEditStatus').textContent = 'Name is required.';
          return;
        }
        if (!nextPrefix) {
          $('workspaceEditStatus').textContent = 'Kanban prefix is required.';
          return;
        }
        // EP-022 / WA-099: silently reject when the operator clears
        // the RBAC selection (shouldn't happen via UI but defends
        // against state corruption). Mode field is added to the PATCH
        // body unconditionally so the daemon's atomicity logic
        // (validate-then-apply) sees the full edit.
        if (workspaceEditRbacMode !== 'enforce' && workspaceEditRbacMode !== 'soft' && workspaceEditRbacMode !== 'off') {
          return;
        }
        workspaceEditSaving = true;
        $('workspaceEditSubmitBtn').disabled = true;
        $('workspaceEditStatus').textContent = 'Saving…';
        try {
          const res = await fetch(daemonApiUrl('/workspaces/' + encodeURIComponent(id)), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nextName, kanbanPrefix: nextPrefix, rbacMode: workspaceEditRbacMode }) });
          const body = await res.json().catch(() => ({}));
          if (!res.ok || body.ok === false) throw new Error(body.error || 'workspace save failed');
          if (state.currentWorkspace?.id === id) state.currentWorkspace = { ...state.currentWorkspace, name: body.workspace?.name || nextName, rbac_mode: body.workspace?.rbac_mode || workspaceEditRbacMode };
          workspaceLifecycleStatus = 'Workspace updated.';
          $('workspaceEditModal')?.classList.add('hidden');
          workspaceEditing = null;
          workspaceEditRbacMode = null;
          await refreshWorkspacesOverview();
        } catch (e) {
          $('workspaceEditStatus').textContent = 'Failed to save: ' + String(e?.message || e);
        } finally {
          workspaceEditSaving = false;
          $('workspaceEditSubmitBtn').disabled = false;
        }
      }

      const originalRender = render;
      render = function renderWithWorkspaceSwitcher() {
        originalRender();
        if (page === 'workspaces-overview') renderWorkspacesOverview();
        renderWorkspaceSwitcher();
      };

      document.addEventListener('click', async e => {
        const target = e.target?.closest?.('[data-action]');
        if (!target) {
          if (workspaceMenuOpen) { workspaceMenuOpen = false; renderWorkspaceSwitcher(); }
          return;
        }
        if (target.dataset.action === 'toggle-workspace-menu') {
          e.preventDefault();
          workspaceMenuOpen = !workspaceMenuOpen;
          renderWorkspaceSwitcher();
          if (workspaceMenuOpen) void refreshWorkspacesForSwitcher();
          return;
        }
        if (target.dataset.action === 'switch-workspace') {
          e.preventDefault();
          if (!target.dataset.workspaceId) return;
          const fromOverview = page === 'workspaces-overview';
          workspaceMenuOpen = false;
          renderWorkspaceSwitcher();
          await switchWorkspace(target.dataset.workspaceId, { updateDaemonCurrent: true });
          if (fromOverview) showPage('agents');
          renderWorkspaceSwitcher();
          return;
        }
        if (target.dataset.action === 'open-workspace-add') {
          e.preventDefault();
          workspaceMenuOpen = false;
          renderWorkspaceSwitcher();
          openWorkspaceAddModal();
          return;
        }
        if (target.dataset.action === 'close-workspace-add') {
          e.preventDefault();
          closeWorkspaceAddModal();
          return;
        }
        if (target.dataset.action === 'submit-workspace-add') {
          e.preventDefault();
          await submitWorkspaceAdd();
          return;
        }
        if (target.dataset.action === 'select-add-rbac-mode') {
          e.preventDefault();
          selectWorkspaceAddRbacMode(target.dataset.rbacMode);
          return;
        }
        if (target.dataset.action === 'select-edit-rbac-mode') {
          e.preventDefault();
          selectWorkspaceEditRbacMode(target.dataset.rbacMode);
          return;
        }
        if (target.dataset.action === 'select-workspaces-tab') {
          e.preventDefault();
          setWorkspaceOverviewTab(target.dataset.tab);
          return;
        }
        if (target.dataset.action === 'toggle-workspace-card-menu') {
          e.preventDefault();
          e.stopPropagation();
          const id = target.dataset.workspaceId || '';
          workspaceOverviewMenuId = workspaceOverviewMenuId === id ? '' : id;
          if (page === 'workspaces-overview') renderWorkspacesOverview({ fresh: true });
          return;
        }
        if (target.dataset.action === 'open-workspace-edit') {
          e.preventDefault();
          const id = target.dataset.workspaceId || '';
          workspaceOverviewMenuId = '';
          await openWorkspaceEdit(id);
          if (page === 'workspaces-overview') renderWorkspacesOverview({ fresh: true });
          return;
        }
        if (target.dataset.action === 'close-workspace-edit') {
          e.preventDefault();
          closeWorkspaceEdit();
          return;
        }
        if (target.dataset.action === 'submit-workspace-edit') {
          e.preventDefault();
          await submitWorkspaceEdit();
          return;
        }
        if (target.dataset.action === 'delete-workspace') {
          e.preventDefault();
          workspaceOverviewMenuId = '';
          await workspaceOverviewLifecycle(target.dataset.workspaceId || '', 'trash');
          return;
        }
        if (target.dataset.action === 'restore-workspace') {
          e.preventDefault();
          await workspaceOverviewLifecycle(target.dataset.workspaceId || '', 'restore');
          return;
        }
        if (target.dataset.action === 'purge-workspace') {
          e.preventDefault();
          await workspaceOverviewLifecycle(target.dataset.workspaceId || '', 'purge');
          return;
        }
        if (workspaceOverviewMenuId && !target.closest?.('.workspace-card')) {
          workspaceOverviewMenuId = '';
          if (page === 'workspaces-overview') renderWorkspacesOverview({ fresh: true });
        }
        if (workspaceMenuOpen && !target.closest?.('#workspaceSwitcher')) {
          workspaceMenuOpen = false;
          renderWorkspaceSwitcher();
        }
      });

      document.addEventListener('change', e => {
        const target = e.target?.closest?.('[data-action]');
        if (!target) return;
        if (target.dataset.action === 'set-trash-retention') {
          void updateTrashRetentionFromOverview(target.value);
          return;
        }
      });

      document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          if (workspaceMenuOpen) { workspaceMenuOpen = false; renderWorkspaceSwitcher(); }
          if (!$('workspaceAddModal')?.classList.contains('hidden')) closeWorkspaceAddModal();
          if (!$('workspaceEditModal')?.classList.contains('hidden')) closeWorkspaceEdit();
          if (workspaceOverviewMenuId) {
            workspaceOverviewMenuId = '';
            if (page === 'workspaces-overview') renderWorkspacesOverview({ fresh: true });
          }
        }
        if (e.key === 'Enter' && e.target?.closest?.('#workspaceAddModal') && !e.target?.matches?.('textarea')) {
          e.preventDefault();
          void submitWorkspaceAdd();
        }
        if (e.key === 'Enter' && e.target?.closest?.('#workspaceEditGeneralSection') && !e.target?.matches?.('textarea')) {
          e.preventDefault();
          void submitWorkspaceEdit();
        }
      });

      $('workspaceAddModal')?.addEventListener('click', e => {
        if (e.target === $('workspaceAddModal')) closeWorkspaceAddModal();
      });

      $('workspaceEditModal')?.addEventListener('click', e => {
        if (e.target === $('workspaceEditModal')) closeWorkspaceEdit();
      });

      renderWorkspaceSwitcher();
    })();

    (function renderInitialUiAfterExtensions() {
      render();
      // EP-002 WA-007: kick a one-shot refresh so direct URL hits don't
      // sit on a possibly stale/empty server-injected state until the
      // first poll fires (1s) or the user clicks the sidebar. refresh()
      // is a no-op when no workspace is bound.
      void refresh();
    })();
