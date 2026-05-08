// EP-029 T4: browser-side terminal controller. Owns the xterm Terminal +
// FitAddon + WebglAddon + Unicode11Addon, the WebSocket connection to
// /api/v1/.../terminal/ws, the restore-frame handshake (reset → resize →
// write → flag), the live output stream, the parking-root pattern (xterm
// element survives panel switches without dispose+recreate), and the
// EP-023 debug taps. Replaces the inline mountTerminal/disposeXterm/
// scheduleTerminalFit/fitActiveTerminal/sendCurrentTerminalSize/
// resizeTerminal/connectTerminalWs/appendTerminal/installTerminalTouchScroll/
// installTerminalDebugObservers/observeActiveTerminalElement helpers
// previously embedded in `src/web/client/main.ts`. T4-c wires main.ts
// onto this controller; T4-d strips the remaining dead state + WA-127
// patches.

const PARKING_ROOT_ID = "wa-terminal-parking-root";
const RESIZE_DEBOUNCE_MS = 50;
// EP-029 WA-137 — trail-debounce window for `resize-ws` WebSocket sends.
// xterm fires onResize multiple times during initial layout convergence
// (constructor 80×24 → fitAddon.fit() at container → fonts.ready re-fit
// → ResizeObserver micro-jitter). Each onResize previously sent a
// `{type:"resize"}` frame; the runtime received SIGWINCH at every
// intermediate width and left misaligned wrap points in scrollback as
// "Re ghost" artefacts. 80ms covers the typical fit-converge burst
// without making user-driven browser-resize feel laggy.
const WS_RESIZE_DEBOUNCE_MS = 80;
const PULSE_BURST_WINDOW_MS = 5000;
const PULSE_BURST_BUCKET_COUNT = Math.ceil(PULSE_BURST_WINDOW_MS / 1000);
const PULSE_BURST_BYTES = 50_000;
const PULSE_COOLDOWN_MS = 10_000;
const PULSE_RESTORE_DELAY_MS = 100;

type PulseReason = "restore" | "burst";

// xterm + addons are loaded via UMD script tags (see src/web/shell.ts);
// declare just the surface the controller touches so the bundler stays
// strict without pulling in @xterm/* into the client bundle.
declare global {
  interface Window {
    Terminal?: new (opts: TerminalOptions) => XtermTerminal;
    FitAddon?: { FitAddon: new () => XtermFitAddon };
    WebglAddon?: { WebglAddon: new () => XtermWebglAddon };
    Unicode11Addon?: { Unicode11Addon: new () => XtermUnicodeAddon };
  }
}

interface TerminalOptions {
  cols: number;
  rows: number;
  cursorBlink?: boolean;
  allowProposedApi?: boolean;
  linkHandler?: unknown;
  customGlyphs?: boolean;
  letterSpacing?: number;
  overviewRuler?: { width: number };
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  rescaleOverlappingGlyphs?: boolean;
  altClickMovesCursor?: boolean;
  macOptionClickForcesSelection?: boolean;
  scrollback?: number;
  theme?: { background?: string; foreground?: string; cursor?: string; selectionBackground?: string };
}

interface XtermBufferLine {
  translateToString(trimRight?: boolean): string;
}

interface XtermBuffer {
  readonly viewportY?: number;
  getLine(index: number): XtermBufferLine | undefined;
}

interface XtermTerminal {
  readonly cols: number;
  readonly rows: number;
  readonly element?: HTMLElement;
  readonly options: TerminalOptions & { theme?: TerminalOptions["theme"] };
  readonly buffer?: { active?: XtermBuffer };
  unicode: { activeVersion: string };
  open(el: HTMLElement): void;
  write(data: string | Uint8Array, cb?: () => void): void;
  reset(): void;
  resize(cols: number, rows: number): void;
  refresh?(start: number, end: number): void;
  loadAddon(addon: unknown): void;
  onData(cb: (data: string) => void): { dispose(): void };
  onResize(cb: (size: { cols: number; rows: number }) => void): { dispose(): void };
  focus(): void;
  dispose(): void;
}

interface XtermFitAddon {
  fit(): void;
  dispose?(): void;
}

interface XtermWebglAddon {
  onContextLoss?(cb: () => void): void;
  dispose?(): void;
}

interface XtermUnicodeAddon {
  dispose?(): void;
}

export interface TerminalControllerOptions {
  /** Resolve the runner record for a given role address. Today main.ts
   * exposes `runnerFor(role)`; the controller uses it to know whether to
   * wire input/restore vs render the plain-DOM exited fallback. */
  getRunner: (role: string) => { mode?: string; status?: string } | null;
  /** Resolve `{id}` for a role address (for the UUID-keyed terminal WS
   * URL). */
  getRoleId: (role: string) => string | null;
  /** Build the workspace-prefixed WS URL given a roleId — main.ts owns
   * the workspace prefix + protocol selection (https → wss). */
  buildWsUrl: (roleId: string) => string;
  /** EP-023 debug-event sink. Forwarded as-is to main.ts's
   * `terminalDebugLog`. */
  debugLog: (event: string, payload?: Record<string, unknown>) => void;
  /** Notify main.ts of an attention frame (runner-side
   * approval-waiting markers). */
  onAttention: (role: string, attention: unknown) => void;
  /** Notify main.ts of a runner_status frame. */
  onRunnerStatus: (role: string, body: { status?: string; exitCode?: number; exitSignal?: string; sessionId?: string }) => void;
  /** Notify main.ts of a session-change (server reports a different
   * sessionId than the controller had). */
  onSessionChange?: (role: string, prevSessionId: string | null, nextSessionId: string) => void;
  /** Sink for input that arrives before the WS is open. main.ts owns
   * the HTTP fallback (POST /input) so the controller stays free of
   * fetch wiring. */
  fallbackSendInput?: (role: string, data: string) => void;
  /** Read the current terminal font-size pref. */
  fontSize: () => number;
  /** Read the current terminal line-height pref. */
  lineHeight: () => number;
  /** Read the resolved `--accent-hex` color for cursor styling. */
  accentHex: () => string;
  /** True when prefs.terminalMouseMode is `select`. */
  mouseSelectMode: () => boolean;
  /** True when the EP-023 "Disable WebGL renderer" toggle is on. */
  disableWebgl: () => boolean;
}

export interface TerminalMountOptions {
  /** Whether the panel is currently visible. Inactive mounts skip
   * focus + WS-connect (still set up parking root and pre-fit so a
   * later activation is cheap). */
  active: boolean;
  /** Source describing the mount call site (debug / log only). */
  reason?: string;
}

export interface TerminalRendererStats {
  role: string | null;
  renderer: string;
  cols: number | null;
  rows: number | null;
  restoreCompleted: boolean;
  webglContextLosses: number;
}

const FALLBACK_FONT_FAMILY = "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, DejaVu Sans Mono, monospace";

export class TerminalController {
  private readonly options: TerminalControllerOptions;
  private readonly parkingRoot: HTMLDivElement;
  private terminal: XtermTerminal | null = null;
  private fitAddon: XtermFitAddon | null = null;
  private webglAddon: XtermWebglAddon | null = null;
  private unicode11Addon: XtermUnicodeAddon | null = null;
  private hostElement: HTMLDivElement | null = null;
  private currentRole: string | null = null;
  private currentSessionId: string | null = null;
  private rendererFlavor: string = "none";
  private webglContextLosses: number = 0;
  private restoreCompleted: boolean = false;
  private preRestoreOutputFrames: Array<{ events: Array<{ data?: string; type?: string }>; attention?: unknown }> = [];
  private writeQueue: Promise<void> = Promise.resolve();
  private ws: WebSocket | null = null;
  private wsRole: string | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSizeSentKey: string = "";
  private touchCleanup: (() => void) | null = null;
  private debugCleanups: Array<() => void> = [];
  private onDataDispose: { dispose(): void } | null = null;
  private onResizeDispose: { dispose(): void } | null = null;
  private mountReady: boolean = false;
  private currentContainer: HTMLElement | null = null;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // EP-029 WA-137 — trail-debounced resize-ws state. Buffer the latest
  // dim from requestResize; flushResizeWs() drains via setTimeout.
  private resizeWsTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingWsResize: { cols: number; rows: number } | null = null;
  private restorePulseTimer: ReturnType<typeof setTimeout> | null = null;
  private outputBuckets: Array<{ epoch: number; bytes: number }> = Array.from({ length: PULSE_BURST_BUCKET_COUNT }, () => ({ epoch: 0, bytes: 0 }));
  private lastPulseAt: number | null = null;
  private pulseSettingOn: boolean = true;
  private ctrlArmed: boolean = false;
  private ctrlConsumeCallback: (() => void) | null = null;

  constructor(options: TerminalControllerOptions) {
    this.options = options;
    this.parkingRoot = ensureParkingRoot();
  }

  mount(role: string, container: HTMLElement, opts: TerminalMountOptions): void {
    const sameRole = this.currentRole === role && this.terminal !== null;
    if (sameRole) {
      // Re-attach existing xterm element to the new container without
      // reconstruct. Same-role panel switches go through this branch.
      if (this.terminal!.element && this.terminal!.element.parentNode !== container) {
        container.appendChild(this.terminal!.element);
      }
      this.currentContainer = container;
      this.observeContainer(container);
      this.scheduleFit();
      if (opts.active) {
        setTimeout(() => { this.scheduleFit(); this.terminal?.focus(); }, 0);
      }
      this.options.debugLog("reattach", { role, active: opts.active, reason: opts.reason });
      if (opts.active) {
        this.ensureWs(role);
        this.scheduleRestorePulse(role);
      }
      return;
    }
    // Different role: fully remount the xterm. Disposes any previous
    // terminal cleanly first.
    this.dispose("remount");
    this.constructTerminal(role, container, opts);
    if (opts.active) this.ensureWs(role);
  }

  unmount(reason: string): void {
    if (!this.terminal) return;
    this.cleanupContainerObservers();
    if (this.terminal.element && this.terminal.element.parentNode) {
      // Park the live xterm element so the next same-role mount is
      // O(1). Disposes are reserved for actual role/dispose calls.
      this.parkingRoot.appendChild(this.terminal.element);
    }
    this.currentContainer = null;
    this.options.debugLog("unmount", { reason, role: this.currentRole });
  }

  dispose(reason: string): void {
    const prevRole = this.currentRole;
    const prevRenderer = this.rendererFlavor;
    const prevContextLosses = this.webglContextLosses;
    this.cleanupContainerObservers();
    this.cleanupDebugTaps();
    this.touchCleanup?.();
    this.touchCleanup = null;
    this.onDataDispose?.dispose();
    this.onDataDispose = null;
    this.onResizeDispose?.dispose();
    this.onResizeDispose = null;
    this.disarmCtrl();
    // EP-029 WA-137 — drop any buffered resize-ws so a pending fire
    // doesn't escape into the next role's WS after dispose+remount.
    if (this.resizeWsTimer) { clearTimeout(this.resizeWsTimer); this.resizeWsTimer = null; }
    this.pendingWsResize = null;
    this.clearRestorePulseTimer();
    this.closeWs();
    if (this.terminal) {
      try { this.terminal.dispose(); } catch { /* already disposed */ }
    }
    this.terminal = null;
    this.fitAddon = null;
    this.webglAddon = null;
    this.unicode11Addon = null;
    this.hostElement = null;
    this.currentRole = null;
    this.currentSessionId = null;
    this.rendererFlavor = "none";
    this.restoreCompleted = false;
    this.preRestoreOutputFrames = [];
    this.writeQueue = Promise.resolve();
    this.lastSizeSentKey = "";
    this.resetOutputBuckets();
    this.lastPulseAt = null;
    this.mountReady = false;
    this.currentContainer = null;
    if (prevRole) {
      this.options.debugLog("dispose", { reason, role: prevRole, prevRenderer, prevContextLosses });
    }
  }

  sendInput(data: string, raw: boolean = false, allowFallback: boolean = true): boolean {
    const role = this.currentRole;
    if (!role) return false;
    const payload = raw ? data : data + "\n";
    if (this.ws && this.wsRole === role && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "input", data: payload }));
      return true;
    }
    if (allowFallback) this.options.fallbackSendInput?.(role, payload);
    return false;
  }

  sendKeystroke(sequence: string): boolean {
    return this.sendInput(sequence, true, false);
  }

  requestResize(cols: number, rows: number): void {
    const role = this.currentRole;
    if (!role) return;
    // EP-029 WA-137 — buffer + debounce. xterm onResize fires from
    // term.open() (at the 80×24 constructor dims) before fitAddon.fit()
    // reaches the container dims; multiple fit() passes during
    // fonts.ready convergence and ResizeObserver bursts produce
    // 188→191→192→193-style sequences. Sending each as `resize-ws`
    // SIGWINCHes the runtime at intermediate widths and ghosts the
    // scrollback. Trailing-edge flush sends only the final dim.
    this.pendingWsResize = { cols, rows };
    if (this.resizeWsTimer) clearTimeout(this.resizeWsTimer);
    this.resizeWsTimer = setTimeout(() => this.flushResizeWs(), WS_RESIZE_DEBOUNCE_MS);
  }

  private flushResizeWs(): void {
    this.resizeWsTimer = null;
    const pending = this.pendingWsResize;
    this.pendingWsResize = null;
    if (!pending) return;
    const role = this.currentRole;
    if (!role) return;
    const { cols, rows } = pending;
    const key = role + ":" + cols + "x" + rows;
    if (key === this.lastSizeSentKey) return;
    this.lastSizeSentKey = key;
    if (this.ws && this.wsRole === role && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "resize", cols, rows }));
      this.options.debugLog("resize-ws", { role, cols, rows });
      return;
    }
    // Fallback: HTTP POST /resize. main.ts had this before; controller
    // emits a debug event that main.ts can pin if it wants to drive the
    // HTTP fallback itself. T4-c may forward via fallbackSendInput-style
    // callback if needed; for now, log only — server's mirror.resize
    // will catch up on the next WS open.
    this.options.debugLog("resize-buffered", { role, cols, rows });
  }

  getStats(): TerminalRendererStats {
    return {
      role: this.currentRole,
      renderer: this.rendererFlavor,
      cols: this.terminal?.cols ?? null,
      rows: this.terminal?.rows ?? null,
      restoreCompleted: this.restoreCompleted,
      webglContextLosses: this.webglContextLosses,
    };
  }

  focus(): void {
    this.terminal?.focus();
  }

  armCtrl(onConsumed: () => void): void {
    this.ctrlArmed = true;
    this.ctrlConsumeCallback = onConsumed;
  }

  disarmCtrl(): void {
    this.ctrlArmed = false;
    this.ctrlConsumeCallback = null;
  }

  isCtrlArmed(): boolean {
    return this.ctrlArmed;
  }

  visibleText(): string {
    const term = this.terminal;
    const buffer = term?.buffer?.active;
    if (!term || !buffer || typeof buffer.getLine !== "function") return "";
    const start = Number(buffer.viewportY || 0);
    const rows = Number(term.rows || 0);
    const lines: string[] = [];
    for (let i = 0; i < rows; i++) {
      const line = buffer.getLine(start + i);
      if (line && typeof line.translateToString === "function") lines.push(line.translateToString(true));
    }
    return lines.join("\n").replace(/[\s\n]+$/g, "");
  }

  setPulseEnabled(on: boolean): void {
    this.pulseSettingOn = Boolean(on);
    if (!this.pulseSettingOn) {
      this.clearRestorePulseTimer();
      this.resetOutputBuckets();
    }
  }

  applyDisplayPreferences(): void {
    const term = this.terminal;
    if (!term || !this.mountReady) return;
    try {
      term.options.fontSize = this.options.fontSize();
      term.options.lineHeight = this.options.lineHeight();
      const rows = Math.max(1, Number(term.rows || 0));
      term.refresh?.(0, rows - 1);
      this.scheduleFit();
      if (this.terminal) this.requestResize(this.terminal.cols, this.terminal.rows);
    } catch (error) {
      this.options.debugLog("apply-display-prefs-error", { role: this.currentRole, error: String((error as { message?: string })?.message || error) });
    }
  }

  private clearRestorePulseTimer(): void {
    if (this.restorePulseTimer) clearTimeout(this.restorePulseTimer);
    this.restorePulseTimer = null;
  }

  private maybeRewriteForCtrl(data: string): string {
    if (!this.ctrlArmed || data.length !== 1) return data;
    const code = data.charCodeAt(0);
    const isLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    if (!isLetter) return data;
    this.ctrlArmed = false;
    const cb = this.ctrlConsumeCallback;
    this.ctrlConsumeCallback = null;
    cb?.();
    return String.fromCharCode(code & 0x1f);
  }

  private scheduleRestorePulse(role: string): void {
    this.clearRestorePulseTimer();
    if (!this.pulseSettingOn) return;
    this.restorePulseTimer = setTimeout(() => {
      this.restorePulseTimer = null;
      if (this.currentRole !== role) return;
      this.sendPulseFrame("restore");
    }, PULSE_RESTORE_DELAY_MS);
  }

  private sendPulseFrame(reason: PulseReason): boolean {
    const role = this.currentRole;
    if (!role || !this.pulseSettingOn || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify({ type: "pulse", reason }));
      this.lastPulseAt = Date.now();
      this.options.debugLog("tui-pulse", { role, reason });
      return true;
    } catch (error) {
      this.options.debugLog("tui-pulse-error", { role, reason, error: String((error as { message?: string })?.message || error) });
      return false;
    }
  }

  private outputEventBytes(data: string): number {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(data).byteLength;
    return data.length;
  }

  private resetOutputBuckets(): void {
    for (const bucket of this.outputBuckets) {
      bucket.epoch = 0;
      bucket.bytes = 0;
    }
  }

  private addOutputBytes(bytes: number, now: number): number {
    const epoch = Math.floor(now / 1000);
    const slot = ((epoch % this.outputBuckets.length) + this.outputBuckets.length) % this.outputBuckets.length;
    const bucket = this.outputBuckets[slot]!;
    if (bucket.epoch !== epoch) {
      bucket.epoch = epoch;
      bucket.bytes = 0;
    }
    bucket.bytes += bytes;
    let total = 0;
    for (const item of this.outputBuckets) {
      if (epoch - item.epoch < PULSE_BURST_BUCKET_COUNT) total += item.bytes;
    }
    return total;
  }

  private recordOutputForPulse(frame: { events: Array<{ data?: string; type?: string }> }): void {
    if (!this.pulseSettingOn) return;
    let bytes = 0;
    for (const event of frame.events) {
      if (event && typeof event.data === "string") bytes += this.outputEventBytes(event.data);
    }
    if (bytes <= 0) return;
    const now = Date.now();
    const windowBytes = this.addOutputBytes(bytes, now);
    if (windowBytes > PULSE_BURST_BYTES && (this.lastPulseAt === null || now - this.lastPulseAt > PULSE_COOLDOWN_MS)) {
      if (this.sendPulseFrame("burst")) this.resetOutputBuckets();
    }
  }

  private constructTerminal(role: string, container: HTMLElement, opts: TerminalMountOptions): void {
    if (typeof window === "undefined" || typeof window.Terminal !== "function") {
      // xterm UMD not loaded — main.ts plain-DOM fallback path stays
      // active. Emit a debug event so the missing-asset condition is
      // visible in xterm-debug.log.
      this.options.debugLog("xterm-missing", { role });
      return;
    }
    const accentHex = (this.options.accentHex() || "#a78bfa").trim();
    const cursorColor = accentHex.startsWith("#") ? accentHex : "#a78bfa";
    const term = new window.Terminal({
      cols: 80,
      rows: 24,
      cursorBlink: true,
      allowProposedApi: true,
      linkHandler: null,
      customGlyphs: true,
      letterSpacing: 0,
      overviewRuler: { width: 1 },
      fontFamily: FALLBACK_FONT_FAMILY,
      fontSize: this.options.fontSize(),
      lineHeight: this.options.lineHeight(),
      rescaleOverlappingGlyphs: true,
      altClickMovesCursor: !this.options.mouseSelectMode(),
      macOptionClickForcesSelection: this.options.mouseSelectMode(),
      scrollback: 10_000,
      theme: { background: "#0d1117", foreground: "#d4d4d4", cursor: cursorColor, selectionBackground: "#334155" },
    });
    this.terminal = term;
    this.currentRole = role;
    this.currentSessionId = null;
    this.rendererFlavor = "dom";

    const FitAddonCtor = window.FitAddon?.FitAddon;
    if (typeof FitAddonCtor === "function") {
      this.fitAddon = new FitAddonCtor();
      term.loadAddon(this.fitAddon);
    }

    const Unicode11Ctor = window.Unicode11Addon?.Unicode11Addon;
    if (typeof Unicode11Ctor === "function") {
      this.unicode11Addon = new Unicode11Ctor();
      term.loadAddon(this.unicode11Addon);
      try { term.unicode.activeVersion = "11"; } catch { /* older xterm without unicode API */ }
    }

    // onResize → forward to server. Pre-restore resizes are coalesced
    // by lastSizeSentKey; the post-fit resize is the canonical SIGWINCH.
    this.onResizeDispose = term.onResize((size) => this.requestResize(size.cols, size.rows));

    term.open(container);
    this.currentContainer = container;
    this.hostElement = (container instanceof HTMLDivElement ? container : null);

    // EP-023 / WA-105 — debug-mount selectors snapshot.
    const ae = document.activeElement;
    this.options.debugLog("mount-selectors", {
      role,
      xtermScreen: !!container.querySelector?.(".xterm-screen"),
      xtermViewport: !!container.querySelector?.(".xterm-viewport"),
      xtermHelperTextarea: !!container.querySelector?.(".xterm-helper-textarea"),
      activeElementTag: ae?.tagName || "",
      activeElementClass: typeof (ae as { className?: unknown })?.className === "string" ? (ae as { className: string }).className.slice(0, 64) : "",
    });

    this.installDebugTaps(container, role);
    this.touchCleanup = installTouchScroll(container, term, () => this.options.fontSize(), () => this.options.lineHeight());

    const WebglAddonCtor = this.options.disableWebgl() ? null : window.WebglAddon?.WebglAddon;
    if (typeof WebglAddonCtor === "function") {
      try {
        const addon = new WebglAddonCtor();
        addon.onContextLoss?.(() => {
          this.webglContextLosses += 1;
          this.rendererFlavor = "dom-after-webgl-context-loss";
          this.options.debugLog("webgl-context-loss");
          try { addon.dispose?.(); } catch { /* already disposed */ }
        });
        term.loadAddon(addon);
        this.webglAddon = addon;
        this.rendererFlavor = "webgl";
      } catch (e) {
        this.rendererFlavor = "dom-webgl-failed";
        this.options.debugLog("webgl-load-failed", { error: String((e as { message?: string })?.message || e) });
      }
    } else if (this.options.disableWebgl()) {
      this.rendererFlavor = "dom-webgl-disabled";
    }

    // onData wiring — unconditional regardless of `active`. WA-108: any
    // mount path may construct xterm before the WS is ready, so input
    // routing through fallbackSendInput must always be live.
    this.onDataDispose = term.onData((data) => this.sendInput(this.maybeRewriteForCtrl(data), true));

    this.observeContainer(container);
    document.fonts?.ready?.then(() => this.scheduleFit()).catch(() => undefined);
    this.scheduleFit();
    setTimeout(() => { this.scheduleFit(); if (opts.active) term.focus(); }, 0);
    this.mountReady = true;
    this.options.debugLog("mount", { role, active: opts.active, reason: opts.reason });
  }

  private installDebugTaps(container: HTMLElement, role: string): void {
    const helper = container.querySelector?.(".xterm-helper-textarea");
    if (helper instanceof HTMLElement) {
      const onFocus = () => this.options.debugLog("helper-focus", { role });
      const onBlur = () => this.options.debugLog("helper-blur", { role });
      helper.addEventListener("focus", onFocus);
      helper.addEventListener("blur", onBlur);
      this.debugCleanups.push(() => {
        helper.removeEventListener("focus", onFocus);
        helper.removeEventListener("blur", onBlur);
      });
    }
    const onMouseDown = () => this.options.debugLog("mousedown-observed", { role });
    container.addEventListener("mousedown", onMouseDown, { capture: true });
    this.debugCleanups.push(() => container.removeEventListener("mousedown", onMouseDown, { capture: true } as EventListenerOptions));
    let firstKeydownLogged = false;
    const onKeyDown = (event: KeyboardEvent) => {
      if (firstKeydownLogged) return;
      firstKeydownLogged = true;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const helperFocused = target?.classList?.contains("xterm-helper-textarea") === true;
      this.options.debugLog("first-keydown", {
        role,
        helperFocused,
        targetTag: target?.tagName?.toLowerCase() ?? "",
        targetClass: target?.className ?? "",
      });
    };
    container.addEventListener("keydown", onKeyDown, { capture: true });
    this.debugCleanups.push(() => container.removeEventListener("keydown", onKeyDown, { capture: true } as EventListenerOptions));
  }

  private cleanupDebugTaps(): void {
    for (const cleanup of this.debugCleanups) {
      try { cleanup(); } catch { /* already removed */ }
    }
    this.debugCleanups = [];
  }

  private observeContainer(container: HTMLElement): void {
    this.cleanupContainerObservers();
    if (typeof ResizeObserver !== "function") return;
    let lastWidth = container.clientWidth;
    let lastHeight = container.clientHeight;
    this.resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      // Filter sub-2px jitter (WA-114 lesson — ResizeObserver feedback
      // loops can spam the terminal with fractional resize events).
      if (Math.abs(w - lastWidth) < 2 && Math.abs(h - lastHeight) < 2) return;
      lastWidth = w;
      lastHeight = h;
      if (this.resizeTimer !== null) clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this.resizeTimer = null;
        this.scheduleFit();
      }, RESIZE_DEBOUNCE_MS);
    });
    this.resizeObserver.observe(container);
  }

  private cleanupContainerObservers(): void {
    if (this.resizeObserver) {
      try { this.resizeObserver.disconnect(); } catch { /* already disconnected */ }
      this.resizeObserver = null;
    }
    if (this.resizeTimer !== null) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
  }

  private scheduleFit(): void {
    if (!this.fitAddon || !this.terminal) return;
    requestAnimationFrame(() => {
      if (!this.fitAddon || !this.terminal) return;
      try { this.fitAddon.fit(); } catch { /* ignore */ }
    });
  }

  private ensureWs(role: string): void {
    if (this.ws && this.wsRole === role && this.ws.readyState !== WebSocket.CLOSED) return;
    const roleId = this.options.getRoleId(role);
    if (!roleId) return;
    if (this.ws) { try { this.ws.close(); } catch { /* already closed */ } }
    this.wsRole = role;
    // Reset restore state so the next WS open processes a fresh restore
    // frame and buffers pre-restore live output frames until xterm has
    // applied the snapshot and the client sends `restore_complete`.
    this.restoreCompleted = false;
    this.preRestoreOutputFrames = [];
    const url = this.options.buildWsUrl(roleId);
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.addEventListener("open", () => this.options.debugLog("ws-open", { role }));
    ws.addEventListener("message", (event) => this.handleWsMessage(role, event.data));
    ws.addEventListener("close", () => {
      if (this.ws === ws) {
        this.ws = null;
        this.wsRole = null;
      }
      this.options.debugLog("ws-close", { role });
      // EP-029 T6 fix: schedule auto-reconnect while still mounted to
      // the same role. Without this, a runner Stop+Launch leaves the
      // browser stuck on a closed WS — the new runner's mirror never
      // pushes a restore frame to this socket. 1s backoff matches the
      // pre-T2 server-side reconnect cadence.
      if (this.currentRole === role && !this.disposed()) {
        this.scheduleWsReconnect(role, 1_000);
      }
    });
    ws.addEventListener("error", () => {
      this.options.debugLog("ws-error", { role });
    });
  }

  private scheduleWsReconnect(role: string, delayMs: number): void {
    if (this.wsReconnectTimer) clearTimeout(this.wsReconnectTimer);
    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      if (this.currentRole !== role) return;
      this.ensureWs(role);
    }, delayMs);
  }

  private disposed(): boolean {
    return this.terminal === null;
  }

  private closeWs(): void {
    if (this.wsReconnectTimer) { clearTimeout(this.wsReconnectTimer); this.wsReconnectTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch { /* already closed */ } }
    this.ws = null;
    this.wsRole = null;
  }

  private handleWsMessage(role: string, data: unknown): void {
    let body: { type?: string; snapshot?: string; cols?: number; rows?: number; sessionId?: string; events?: Array<{ data?: string; type?: string }>; attention?: unknown; status?: string; exitCode?: number; exitSignal?: string; error?: string };
    try {
      body = JSON.parse(String(data));
    } catch {
      return;
    }
    if (body.type === "restore" && typeof body.snapshot === "string") {
      this.applyRestore(role, body.snapshot, body.cols, body.rows, body.sessionId);
      return;
    }
    if (body.type === "ready") {
      this.options.debugLog("ws-ready", { role, sessionId: typeof body.sessionId === "string" ? body.sessionId : "" });
      if (typeof body.sessionId === "string") {
        if (this.currentSessionId && this.currentSessionId !== body.sessionId) {
          const prev = this.currentSessionId;
          this.options.onSessionChange?.(role, prev, body.sessionId);
        }
        this.currentSessionId = body.sessionId;
      }
      return;
    }
    if (body.type === "output") {
      const frame = { events: Array.isArray(body.events) ? body.events : [], attention: body.attention };
      this.recordOutputForPulse(frame);
      if (!this.restoreCompleted) {
        // WA-149: live output can race with xterm's async restore write.
        // Buffer instead of dropping; server-side restore_complete acking
        // should prevent this for new clients, but this keeps older or
        // out-of-order streams lossless too.
        this.preRestoreOutputFrames.push(frame);
        return;
      }
      this.applyOutputFrame(role, frame);
      return;
    }
    if (body.type === "runner_status") {
      const status = typeof body.status === "string" ? body.status : undefined;
      this.options.onRunnerStatus(role, {
        status,
        exitCode: typeof body.exitCode === "number" ? body.exitCode : undefined,
        exitSignal: typeof body.exitSignal === "string" ? body.exitSignal : undefined,
        sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
      });
      this.options.debugLog("ws-runner-status", { role, status: status ?? "" });
      // EP-029 T6 fix: Stop+Launch runner cycle replaces the runner's
      // sessionId. Force a WS reconnect on exited/offline so the next
      // mirror restore frame routes through to this browser. Without
      // this, the old WS stays open subscribed to the dead sessionId
      // and the browser sits on stale state until page refresh.
      if (status === "exited" || status === "offline") {
        if (this.ws) { try { this.ws.close(); } catch { /* already closed */ } }
        // Drop currentSessionId so applyRestore on the next connect
        // doesn't fire onSessionChange against a stale prev value.
        this.currentSessionId = null;
        this.scheduleWsReconnect(role, 1_500);
      }
      return;
    }
    if (body.type === "error") {
      this.options.debugLog("ws-error-frame", { role, error: typeof body.error === "string" ? body.error : "" });
      return;
    }
  }

  private applyOutputFrame(role: string, frame: { events: Array<{ data?: string; type?: string }>; attention?: unknown }): void {
    if (frame.attention) this.options.onAttention(role, frame.attention);
    for (const event of frame.events) {
      if (event && typeof event.data === "string") {
        this.terminal?.write(event.data);
      }
    }
  }

  private drainPreRestoreOutput(role: string): void {
    const frames = this.preRestoreOutputFrames;
    this.preRestoreOutputFrames = [];
    for (const frame of frames) this.applyOutputFrame(role, frame);
  }

  private sendRestoreComplete(sessionId: string | undefined): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ type: "restore_complete", sessionId: sessionId ?? this.currentSessionId ?? "" }));
    } catch {
      // WS close/error path owns reconnect; restore completion should not
      // throw out of xterm's write callback.
    }
  }

  private finishRestore(role: string, sessionId: string | undefined, snapshotLen: number): void {
    this.restoreCompleted = true;
    this.options.debugLog("restore-applied", { role, cols: this.terminal?.cols ?? null, rows: this.terminal?.rows ?? null, snapshotLen });
    this.drainPreRestoreOutput(role);
    this.sendRestoreComplete(sessionId);
    this.scheduleRestorePulse(role);
  }

  private applyRestore(role: string, snapshot: string, cols: number | undefined, rows: number | undefined, sessionId: string | undefined): void {
    if (!this.terminal) return;
    if (sessionId && this.currentSessionId && sessionId !== this.currentSessionId) {
      const prev = this.currentSessionId;
      this.options.onSessionChange?.(role, prev, sessionId);
    }
    if (typeof sessionId === "string") this.currentSessionId = sessionId;
    this.restoreCompleted = false;
    this.clearRestorePulseTimer();
    this.preRestoreOutputFrames = [];
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(() => new Promise<void>((resolve) => {
        if (!this.terminal) { resolve(); return; }
        try {
          this.terminal.reset();
          if (cols && rows && (this.terminal.cols !== cols || this.terminal.rows !== rows)) {
            this.terminal.resize(cols, rows);
          }
        } catch (e) {
          this.options.debugLog("restore-pre-write-error", { role, error: String((e as { message?: string })?.message || e) });
        }
        if (!snapshot) {
          this.finishRestore(role, sessionId, 0);
          resolve();
          return;
        }
        try {
          this.terminal.write(snapshot, () => {
            this.finishRestore(role, sessionId, snapshot.length);
            // EP-029 T6 fix: snapshot may have been serialized at the
            // server-side mirror's last cols/rows which can lag the
            // actual browser container. Force a fit + resize-roundtrip
            // so the runtime sees the real terminal dims and redraws to
            // fill — without this, a freshly mounted TUI sat at default
            // 80×24 (or last-server-known dims) until the user resized
            // the browser window.
            requestAnimationFrame(() => {
              this.scheduleFit();
              // After fit, xterm fires onResize → requestResize, which
              // sends `{type:"resize", cols, rows}` to the server's
              // mirror.resize and runner /resize.
              if (this.fitAddon) {
                try {
                  this.fitAddon.fit();
                  if (this.terminal) this.requestResize(this.terminal.cols, this.terminal.rows);
                } catch { /* ignore */ }
              }
            });
            resolve();
          });
        } catch (e) {
          this.options.debugLog("restore-write-error", { role, error: String((e as { message?: string })?.message || e) });
          this.finishRestore(role, sessionId, snapshot.length);
          resolve();
        }
      }));
  }
}

function ensureParkingRoot(): HTMLDivElement {
  const existing = document.getElementById(PARKING_ROOT_ID);
  if (existing instanceof HTMLDivElement) return existing;
  const root = document.createElement("div");
  root.id = PARKING_ROOT_ID;
  root.setAttribute("aria-hidden", "true");
  Object.assign(root.style, {
    position: "fixed",
    left: "-10000px",
    top: "-10000px",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(root);
  return root;
}

function installTouchScroll(container: HTMLElement, term: XtermTerminal & { scrollLines?: (n: number) => void }, fontSize: () => number, lineHeight: () => number): (() => void) | null {
  const target = container.querySelector?.(".xterm-screen") || container.querySelector?.(".xterm-viewport") || container;
  if (!target || typeof term.scrollLines !== "function") return null;
  let lastY = 0;
  let acc = 0;
  let dragging = false;
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType && event.pointerType !== "touch") return;
    dragging = true;
    lastY = event.clientY;
    acc = 0;
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    const dy = event.clientY - lastY;
    lastY = event.clientY;
    acc += dy;
    const lh = Math.max(8, Math.round(fontSize() * lineHeight()));
    const lines = Math.trunc(acc / lh);
    if (!lines) return;
    acc -= lines * lh;
    event.preventDefault();
    term.scrollLines!(-lines);
  };
  const stop = () => { dragging = false; acc = 0; };
  target.addEventListener("pointerdown", onPointerDown as EventListener, { passive: true } as AddEventListenerOptions);
  target.addEventListener("pointermove", onPointerMove as EventListener, { passive: false } as AddEventListenerOptions);
  target.addEventListener("pointerup", stop, { passive: true } as AddEventListenerOptions);
  target.addEventListener("pointercancel", stop, { passive: true } as AddEventListenerOptions);
  return () => {
    target.removeEventListener("pointerdown", onPointerDown as EventListener);
    target.removeEventListener("pointermove", onPointerMove as EventListener);
    target.removeEventListener("pointerup", stop);
    target.removeEventListener("pointercancel", stop);
  };
}
