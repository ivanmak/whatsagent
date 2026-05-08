import { expect, test } from "bun:test";

import { TerminalController } from "../src/web/client/terminal-controller.ts";

class FakeElement {
  id = "";
  tagName: string;
  className = "";
  style: Record<string, string> = {};
  parentNode: FakeElement | null = null;
  children: FakeElement[] = [];
  clientWidth = 800;
  clientHeight = 600;
  private listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(tagName = "DIV") {
    this.tagName = tagName.toUpperCase();
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  setAttribute(_name: string, _value: string): void {}
  querySelector(_selector: string): FakeElement | null { return null; }
  addEventListener(type: string, cb: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(cb);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, cb: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(cb);
  }
}

class FakeTerminal {
  cols = 80;
  rows = 24;
  element = new FakeElement("DIV");
  unicode = { activeVersion: "" };
  options: Record<string, unknown>;
  writes: string[] = [];
  private writeCallbacks: Array<() => void> = [];
  private dataCallbacks = new Set<(data: string) => void>();

  constructor(options: Record<string, unknown>) {
    this.options = options;
    fakeTerminal = this;
  }

  open(el: FakeElement): void { el.appendChild(this.element); }
  refreshes: Array<{ start: number; end: number }> = [];
  write(data: string | Uint8Array, cb?: () => void): void {
    this.writes.push(typeof data === "string" ? data : new TextDecoder().decode(data));
    if (cb) this.writeCallbacks.push(cb);
  }
  releaseNextWrite(): void { this.writeCallbacks.shift()?.(); }
  refresh(start: number, end: number): void { this.refreshes.push({ start, end }); }
  reset(): void {}
  resize(cols: number, rows: number): void { this.cols = cols; this.rows = rows; }
  loadAddon(_addon: unknown): void {}
  onData(cb: (data: string) => void): { dispose(): void } {
    this.dataCallbacks.add(cb);
    return { dispose: () => { this.dataCallbacks.delete(cb); } };
  }
  emitData(data: string): void {
    for (const cb of this.dataCallbacks) cb(data);
  }
  onResize(_cb: (size: { cols: number; rows: number }) => void): { dispose(): void } { return { dispose() {} }; }
  focus(): void {}
  dispose(): void {}
}

class FakeFitAddon {
  fit(): void {}
  dispose(): void {}
}

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = FakeWebSocket.OPEN;
  sent: string[] = [];
  private listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(_url: string) {
    fakeWebSocket = this;
  }

  addEventListener(type: string, cb: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(cb);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, cb: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(cb);
  }
  send(data: string): void { this.sent.push(String(data)); }
  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("close", {});
  }
  emitMessage(body: unknown): void {
    this.dispatch("message", { data: JSON.stringify(body) });
  }
  private dispatch(type: string, event: unknown): void {
    for (const cb of this.listeners.get(type) ?? []) cb(event);
  }
}

let fakeTerminal: FakeTerminal | null = null;
let fakeWebSocket: FakeWebSocket | null = null;

function installFakeBrowser(): () => void {
  fakeTerminal = null;
  fakeWebSocket = null;
  const g = globalThis as any;
  const previous = {
    window: g.window,
    document: g.document,
    HTMLElement: g.HTMLElement,
    HTMLDivElement: g.HTMLDivElement,
    ResizeObserver: g.ResizeObserver,
    WebSocket: g.WebSocket,
    requestAnimationFrame: g.requestAnimationFrame,
  };
  const byId = new Map<string, FakeElement>();
  const body = new FakeElement("BODY");
  const originalAppend = body.appendChild.bind(body);
  body.appendChild = (child: FakeElement) => {
    const appended = originalAppend(child);
    if (child.id) byId.set(child.id, child);
    return appended;
  };

  g.HTMLElement = FakeElement;
  g.HTMLDivElement = FakeElement;
  g.ResizeObserver = undefined;
  g.requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 1; };
  g.WebSocket = FakeWebSocket;
  g.document = {
    body,
    activeElement: null,
    fonts: undefined,
    getElementById: (id: string) => byId.get(id) ?? null,
    createElement: (tag: string) => new FakeElement(tag),
  };
  g.window = {
    Terminal: FakeTerminal,
    FitAddon: { FitAddon: FakeFitAddon },
  };

  return () => {
    g.window = previous.window;
    g.document = previous.document;
    g.HTMLElement = previous.HTMLElement;
    g.HTMLDivElement = previous.HTMLDivElement;
    g.ResizeObserver = previous.ResizeObserver;
    g.WebSocket = previous.WebSocket;
    g.requestAnimationFrame = previous.requestAnimationFrame;
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sentFrames(): Array<Record<string, unknown>> {
  return (fakeWebSocket?.sent ?? []).map((item) => JSON.parse(item));
}

function sentPulses(): Array<Record<string, unknown>> {
  return sentFrames().filter((item) => item.type === "pulse");
}

function clearSentFrames(): void {
  if (fakeWebSocket) fakeWebSocket.sent = [];
}

function createTestController(fallbackSendInput: (role: string, data: string) => void = () => undefined): TerminalController {
  return new TerminalController({
    getRunner: () => ({ mode: "pty", status: "running" }),
    getRoleId: () => "role-id",
    buildWsUrl: () => "ws://example.test/terminal/ws",
    debugLog: () => undefined,
    onAttention: () => undefined,
    onRunnerStatus: () => undefined,
    onSessionChange: () => undefined,
    fallbackSendInput,
    fontSize: () => 14,
    lineHeight: () => 1.1,
    accentHex: () => "#a78bfa",
    mouseSelectMode: () => false,
    disableWebgl: () => true,
  });
}

test("EP-035 WA-191: sendKeystroke sends raw input over the terminal WS", () => {
  const cleanup = installFakeBrowser();
  let controller: TerminalController | null = null;
  try {
    controller = createTestController();
    const container = new FakeElement("DIV") as unknown as HTMLElement;
    controller.mount("WhatsAgent:worker", container, { active: true, reason: "test" });

    expect(controller.sendKeystroke("\x1b")).toBe(true);
    expect(fakeWebSocket!.sent.map((item) => JSON.parse(item))).toEqual([{ type: "input", data: "\x1b" }]);
    expect(fakeWebSocket!.sent[0]).not.toContain("\\n");

    controller.dispose("test");
    controller = null;
  } finally {
    controller?.dispose("test");
    cleanup();
  }
});

test("EP-035 WA-191: sendKeystroke returns false without WS fallback when the socket is closed", () => {
  const cleanup = installFakeBrowser();
  let controller: TerminalController | null = null;
  const fallbackCalls: Array<{ role: string; data: string }> = [];
  try {
    controller = createTestController((role, data) => fallbackCalls.push({ role, data }));
    const container = new FakeElement("DIV") as unknown as HTMLElement;
    controller.mount("WhatsAgent:worker", container, { active: true, reason: "test" });
    fakeWebSocket!.readyState = FakeWebSocket.CLOSED;

    expect(controller.sendKeystroke("\x1b")).toBe(false);
    expect(fakeWebSocket!.sent).toEqual([]);
    expect(fallbackCalls).toEqual([]);

    controller.dispose("test");
    controller = null;
  } finally {
    controller?.dispose("test");
    cleanup();
  }
});

test("EP-035 WA-191: sendKeystroke returns false when no role is mounted", () => {
  const cleanup = installFakeBrowser();
  let controller: TerminalController | null = null;
  const fallbackCalls: Array<{ role: string; data: string }> = [];
  try {
    controller = createTestController((role, data) => fallbackCalls.push({ role, data }));

    expect(controller.sendKeystroke("\x1b")).toBe(false);
    expect(fakeWebSocket).toBeNull();
    expect(fallbackCalls).toEqual([]);

    controller.dispose("test");
    controller = null;
  } finally {
    controller?.dispose("test");
    cleanup();
  }
});

test("EP-035 WA-197: armCtrl state can be armed, disarmed, and replaced", () => {
  const cleanup = installFakeBrowser();
  let controller: TerminalController | null = null;
  try {
    let consumed = 0;
    controller = createTestController();
    expect(controller.isCtrlArmed()).toBe(false);

    controller.armCtrl(() => { consumed += 1; });
    expect(controller.isCtrlArmed()).toBe(true);

    controller.disarmCtrl();
    expect(controller.isCtrlArmed()).toBe(false);
    expect(consumed).toBe(0);

    let first = 0;
    let second = 0;
    const container = new FakeElement("DIV") as unknown as HTMLElement;
    controller.mount("WhatsAgent:worker", container, { active: true, reason: "test" });
    controller.armCtrl(() => { first += 1; });
    controller.armCtrl(() => { second += 1; });
    fakeTerminal!.emitData("c");

    expect(first).toBe(0);
    expect(second).toBe(1);
    expect(controller.isCtrlArmed()).toBe(false);

    controller.dispose("test");
    controller = null;
  } finally {
    controller?.dispose("test");
    cleanup();
  }
});

test("EP-035 WA-197: armed Ctrl rewrites single ASCII letters from onData", () => {
  const cleanup = installFakeBrowser();
  let controller: TerminalController | null = null;
  try {
    controller = createTestController();
    const container = new FakeElement("DIV") as unknown as HTMLElement;
    controller.mount("WhatsAgent:worker", container, { active: true, reason: "test" });

    const cases: Array<[string, string]> = [["c", "\x03"], ["d", "\x04"], ["z", "\x1a"], ["a", "\x01"], ["Z", "\x1a"]];
    for (const [input, expected] of cases) {
      clearSentFrames();
      let consumed = 0;
      controller.armCtrl(() => { consumed += 1; });
      fakeTerminal!.emitData(input);

      expect(sentFrames()).toEqual([{ type: "input", data: expected }]);
      expect(consumed).toBe(1);
      expect(controller.isCtrlArmed()).toBe(false);
    }

    controller.dispose("test");
    controller = null;
  } finally {
    controller?.dispose("test");
    cleanup();
  }
});

test("EP-035 WA-197: Ctrl consume fires once and later letters pass through", () => {
  const cleanup = installFakeBrowser();
  let controller: TerminalController | null = null;
  try {
    let consumed = 0;
    controller = createTestController();
    const container = new FakeElement("DIV") as unknown as HTMLElement;
    controller.mount("WhatsAgent:worker", container, { active: true, reason: "test" });

    controller.armCtrl(() => { consumed += 1; });
    fakeTerminal!.emitData("c");
    fakeTerminal!.emitData("d");

    expect(sentFrames()).toEqual([{ type: "input", data: "\x03" }, { type: "input", data: "d" }]);
    expect(consumed).toBe(1);
    expect(controller.isCtrlArmed()).toBe(false);

    controller.dispose("test");
    controller = null;
  } finally {
    controller?.dispose("test");
    cleanup();
  }
});

test("EP-035 WA-197: multi-char data and bracketed paste bypass Ctrl rewrite", () => {
  const cleanup = installFakeBrowser();
  let controller: TerminalController | null = null;
  try {
    let consumed = 0;
    controller = createTestController();
    const container = new FakeElement("DIV") as unknown as HTMLElement;
    controller.mount("WhatsAgent:worker", container, { active: true, reason: "test" });
    controller.armCtrl(() => { consumed += 1; });

    fakeTerminal!.emitData("\x1b[A");
    fakeTerminal!.emitData("hello");
    fakeTerminal!.emitData("\x1b[200~abc\x1b[201~");

    expect(sentFrames()).toEqual([
      { type: "input", data: "\x1b[A" },
      { type: "input", data: "hello" },
      { type: "input", data: "\x1b[200~abc\x1b[201~" },
    ]);
    expect(consumed).toBe(0);
    expect(controller.isCtrlArmed()).toBe(true);

    controller.dispose("test");
    controller = null;
  } finally {
    controller?.dispose("test");
    cleanup();
  }
});

test("EP-035 WA-197: non-letter single chars bypass Ctrl rewrite", () => {
  const cleanup = installFakeBrowser();
  let controller: TerminalController | null = null;
  try {
    let consumed = 0;
    controller = createTestController();
    const container = new FakeElement("DIV") as unknown as HTMLElement;
    controller.mount("WhatsAgent:worker", container, { active: true, reason: "test" });
    controller.armCtrl(() => { consumed += 1; });

    fakeTerminal!.emitData("5");
    fakeTerminal!.emitData("!");
    fakeTerminal!.emitData(" ");

    expect(sentFrames()).toEqual([{ type: "input", data: "5" }, { type: "input", data: "!" }, { type: "input", data: " " }]);
    expect(consumed).toBe(0);
    expect(controller.isCtrlArmed()).toBe(true);

    controller.dispose("test");
    controller = null;
  } finally {
    controller?.dispose("test");
    cleanup();
  }
});

test("EP-035 WA-197: sendKeystroke bypasses Ctrl rewrite while armed", () => {
  const cleanup = installFakeBrowser();
  let controller: TerminalController | null = null;
  try {
    let consumed = 0;
    controller = createTestController();
    const container = new FakeElement("DIV") as unknown as HTMLElement;
    controller.mount("WhatsAgent:worker", container, { active: true, reason: "test" });
    controller.armCtrl(() => { consumed += 1; });

    expect(controller.sendKeystroke("\x1b[A")).toBe(true);
    expect(controller.sendKeystroke("\x1b")).toBe(true);

    expect(sentFrames()).toEqual([{ type: "input", data: "\x1b[A" }, { type: "input", data: "\x1b" }]);
    expect(consumed).toBe(0);
    expect(controller.isCtrlArmed()).toBe(true);

    controller.dispose("test");
    controller = null;
  } finally {
    controller?.dispose("test");
    cleanup();
  }
});

test("EP-035 WA-197: dispose clears Ctrl arm without invoking callback", () => {
  const cleanup = installFakeBrowser();
  let controller: TerminalController | null = null;
  try {
    let consumed = 0;
    controller = createTestController();
    const container = new FakeElement("DIV") as unknown as HTMLElement;
    controller.mount("WhatsAgent:worker", container, { active: true, reason: "test" });
    controller.armCtrl(() => { consumed += 1; });

    controller.dispose("test");

    expect(controller.isCtrlArmed()).toBe(false);
    expect(consumed).toBe(0);
    controller = null;
  } finally {
    controller?.dispose("test");
    cleanup();
  }
});

test("EP-035 WA-197: Ctrl rewrite does not log typed or rewritten bytes", () => {
  const cleanup = installFakeBrowser();
  let controller: TerminalController | null = null;
  try {
    const debugEvents: Array<{ event: string; payload?: Record<string, unknown> }> = [];
    controller = new TerminalController({
      getRunner: () => ({ mode: "pty", status: "running" }),
      getRoleId: () => "role-id",
      buildWsUrl: () => "ws://example.test/terminal/ws",
      debugLog: (event, payload) => debugEvents.push({ event, payload }),
      onAttention: () => undefined,
      onRunnerStatus: () => undefined,
      onSessionChange: () => undefined,
      fallbackSendInput: () => undefined,
      fontSize: () => 14,
      lineHeight: () => 1.1,
      accentHex: () => "#a78bfa",
      mouseSelectMode: () => false,
      disableWebgl: () => true,
    });
    const container = new FakeElement("DIV") as unknown as HTMLElement;
    controller.mount("WhatsAgent:worker", container, { active: true, reason: "test" });
    debugEvents.length = 0;

    controller.armCtrl(() => undefined);
    fakeTerminal!.emitData("q");

    const debugPayload = JSON.stringify(debugEvents);
    expect(debugPayload).not.toContain("q");
    expect(debugPayload).not.toContain("\\u0011");
    expect(debugPayload).not.toContain("\x11");

    controller.dispose("test");
    controller = null;
  } finally {
    controller?.dispose("test");
    cleanup();
  }
});

test("WA-149: TerminalController buffers live output until restore write completes", async () => {
  const cleanup = installFakeBrowser();
  let controller: TerminalController | null = null;
  try {
    const debugEvents: string[] = [];
    controller = new TerminalController({
      getRunner: () => ({ mode: "pty", status: "running" }),
      getRoleId: () => "role-id",
      buildWsUrl: () => "ws://example.test/terminal/ws",
      debugLog: (event) => debugEvents.push(event),
      onAttention: () => undefined,
      onRunnerStatus: () => undefined,
      onSessionChange: () => undefined,
      fallbackSendInput: () => undefined,
      fontSize: () => 14,
      lineHeight: () => 1.1,
      accentHex: () => "#a78bfa",
      mouseSelectMode: () => false,
      disableWebgl: () => true,
    });

    const container = new FakeElement("DIV") as unknown as HTMLElement;
    controller.mount("WhatsAgent:worker", container, { active: true, reason: "test" });
    expect(fakeTerminal).not.toBeNull();
    expect(fakeWebSocket).not.toBeNull();

    fakeWebSocket!.emitMessage({ type: "restore", snapshot: "SNAP", cols: 80, rows: 24, sessionId: "session-1" });
    await Promise.resolve();
    fakeWebSocket!.emitMessage({ type: "output", events: [{ data: "LIVE" }] });
    await Promise.resolve();

    expect(fakeTerminal!.writes).toEqual(["SNAP"]);
    expect(fakeWebSocket!.sent.some((item) => JSON.parse(item).type === "restore_complete")).toBe(false);

    fakeTerminal!.releaseNextWrite();

    expect(debugEvents).toContain("restore-applied");
    expect(fakeTerminal!.writes).toEqual(["SNAP", "LIVE"]);
    expect(fakeWebSocket!.sent.map((item) => JSON.parse(item))).toContainEqual({ type: "restore_complete", sessionId: "session-1" });
    controller.dispose("test");
    controller = null;
  } finally {
    controller?.dispose("test");
    cleanup();
  }
});

test("WA-163: TerminalController.applyDisplayPreferences updates xterm options and refreshes", () => {
  const cleanup = installFakeBrowser();
  let controller: TerminalController | null = null;
  let fontSize = 14;
  let lineHeight = 1.1;
  try {
    controller = new TerminalController({
      getRunner: () => ({ mode: "pty", status: "running" }),
      getRoleId: () => "role-id",
      buildWsUrl: () => "ws://example.test/terminal/ws",
      debugLog: () => undefined,
      onAttention: () => undefined,
      onRunnerStatus: () => undefined,
      onSessionChange: () => undefined,
      fallbackSendInput: () => undefined,
      fontSize: () => fontSize,
      lineHeight: () => lineHeight,
      accentHex: () => "#a78bfa",
      mouseSelectMode: () => false,
      disableWebgl: () => true,
    });

    const container = new FakeElement("DIV") as unknown as HTMLElement;
    controller.mount("WhatsAgent:worker", container, { active: true, reason: "test" });
    expect(fakeTerminal).not.toBeNull();
    expect(fakeTerminal!.options.fontSize).toBe(14);
    expect(fakeTerminal!.options.lineHeight).toBe(1.1);

    const refreshesBefore = fakeTerminal!.refreshes.length;
    fontSize = 18;
    lineHeight = 1.2;
    controller.applyDisplayPreferences();

    expect(fakeTerminal!.options.fontSize).toBe(18);
    expect(fakeTerminal!.options.lineHeight).toBe(1.2);
    expect(fakeTerminal!.refreshes.length).toBeGreaterThan(refreshesBefore);
    expect(fakeTerminal!.refreshes[fakeTerminal!.refreshes.length - 1]).toEqual({ start: 0, end: fakeTerminal!.rows - 1 });

    controller.dispose("test");
    controller = null;
  } finally {
    controller?.dispose("test");
    cleanup();
  }
});

test("WA-179: TerminalController emits one pulse for a 50KB output burst", () => {
  const cleanup = installFakeBrowser();
  let controller: TerminalController | null = null;
  try {
    const debugEvents: string[] = [];
    controller = new TerminalController({
      getRunner: () => ({ mode: "pty", status: "running" }),
      getRoleId: () => "role-id",
      buildWsUrl: () => "ws://example.test/terminal/ws",
      debugLog: (event) => debugEvents.push(event),
      onAttention: () => undefined,
      onRunnerStatus: () => undefined,
      onSessionChange: () => undefined,
      fallbackSendInput: () => undefined,
      fontSize: () => 14,
      lineHeight: () => 1.1,
      accentHex: () => "#a78bfa",
      mouseSelectMode: () => false,
      disableWebgl: () => true,
    });

    const container = new FakeElement("DIV") as unknown as HTMLElement;
    controller.mount("WhatsAgent:worker", container, { active: true, reason: "test" });
    fakeWebSocket!.emitMessage({ type: "output", events: [{ data: "x".repeat(50_001) }] });

    expect(sentPulses()).toEqual([{ type: "pulse", reason: "burst" }]);
    expect(debugEvents).toContain("tui-pulse");
    controller.dispose("test");
    controller = null;
  } finally {
    controller?.dispose("test");
    cleanup();
  }
});

test("WA-179: TerminalController rolling output window pulses across bucket boundaries", () => {
  const cleanup = installFakeBrowser();
  const originalNow = Date.now;
  let now = 100_000;
  Date.now = () => now;
  let controller: TerminalController | null = null;
  try {
    controller = new TerminalController({
      getRunner: () => ({ mode: "pty", status: "running" }),
      getRoleId: () => "role-id",
      buildWsUrl: () => "ws://example.test/terminal/ws",
      debugLog: () => undefined,
      onAttention: () => undefined,
      onRunnerStatus: () => undefined,
      onSessionChange: () => undefined,
      fallbackSendInput: () => undefined,
      fontSize: () => 14,
      lineHeight: () => 1.1,
      accentHex: () => "#a78bfa",
      mouseSelectMode: () => false,
      disableWebgl: () => true,
    });

    const container = new FakeElement("DIV") as unknown as HTMLElement;
    controller.mount("WhatsAgent:worker", container, { active: true, reason: "test" });
    fakeWebSocket!.emitMessage({ type: "output", events: [{ data: "x".repeat(30_000) }] });
    now += 4_500;
    fakeWebSocket!.emitMessage({ type: "output", events: [{ data: "y".repeat(30_000) }] });

    expect(sentPulses()).toEqual([{ type: "pulse", reason: "burst" }]);
    controller.dispose("test");
    controller = null;
  } finally {
    Date.now = originalNow;
    controller?.dispose("test");
    cleanup();
  }
});

test("WA-179: TerminalController rolling output window evicts old burst bytes", () => {
  const cleanup = installFakeBrowser();
  const originalNow = Date.now;
  let now = 300_000;
  Date.now = () => now;
  let controller: TerminalController | null = null;
  try {
    controller = new TerminalController({
      getRunner: () => ({ mode: "pty", status: "running" }),
      getRoleId: () => "role-id",
      buildWsUrl: () => "ws://example.test/terminal/ws",
      debugLog: () => undefined,
      onAttention: () => undefined,
      onRunnerStatus: () => undefined,
      onSessionChange: () => undefined,
      fallbackSendInput: () => undefined,
      fontSize: () => 14,
      lineHeight: () => 1.1,
      accentHex: () => "#a78bfa",
      mouseSelectMode: () => false,
      disableWebgl: () => true,
    });

    const container = new FakeElement("DIV") as unknown as HTMLElement;
    controller.mount("WhatsAgent:worker", container, { active: true, reason: "test" });
    fakeWebSocket!.emitMessage({ type: "output", events: [{ data: "x".repeat(30_000) }] });
    now += 6_000;
    fakeWebSocket!.emitMessage({ type: "output", events: [{ data: "y".repeat(30_000) }] });

    expect(sentPulses()).toEqual([]);
    controller.dispose("test");
    controller = null;
  } finally {
    Date.now = originalNow;
    controller?.dispose("test");
    cleanup();
  }
});

test("WA-179: TerminalController output-pulse cooldown prevents a second burst pulse", () => {
  const cleanup = installFakeBrowser();
  const originalNow = Date.now;
  let now = 100_000;
  Date.now = () => now;
  let controller: TerminalController | null = null;
  try {
    controller = new TerminalController({
      getRunner: () => ({ mode: "pty", status: "running" }),
      getRoleId: () => "role-id",
      buildWsUrl: () => "ws://example.test/terminal/ws",
      debugLog: () => undefined,
      onAttention: () => undefined,
      onRunnerStatus: () => undefined,
      onSessionChange: () => undefined,
      fallbackSendInput: () => undefined,
      fontSize: () => 14,
      lineHeight: () => 1.1,
      accentHex: () => "#a78bfa",
      mouseSelectMode: () => false,
      disableWebgl: () => true,
    });

    const container = new FakeElement("DIV") as unknown as HTMLElement;
    controller.mount("WhatsAgent:worker", container, { active: true, reason: "test" });
    fakeWebSocket!.emitMessage({ type: "output", events: [{ data: "x".repeat(50_001) }] });
    now += 9_999;
    fakeWebSocket!.emitMessage({ type: "output", events: [{ data: "y".repeat(50_001) }] });

    expect(sentPulses()).toEqual([{ type: "pulse", reason: "burst" }]);
    controller.dispose("test");
    controller = null;
  } finally {
    Date.now = originalNow;
    controller?.dispose("test");
    cleanup();
  }
});

test("WA-179: TerminalController restore pulse is delayed and resets burst cooldown", async () => {
  const cleanup = installFakeBrowser();
  const originalNow = Date.now;
  let now = 200_000;
  Date.now = () => now;
  let controller: TerminalController | null = null;
  try {
    controller = new TerminalController({
      getRunner: () => ({ mode: "pty", status: "running" }),
      getRoleId: () => "role-id",
      buildWsUrl: () => "ws://example.test/terminal/ws",
      debugLog: () => undefined,
      onAttention: () => undefined,
      onRunnerStatus: () => undefined,
      onSessionChange: () => undefined,
      fallbackSendInput: () => undefined,
      fontSize: () => 14,
      lineHeight: () => 1.1,
      accentHex: () => "#a78bfa",
      mouseSelectMode: () => false,
      disableWebgl: () => true,
    });

    const container = new FakeElement("DIV") as unknown as HTMLElement;
    controller.mount("WhatsAgent:worker", container, { active: true, reason: "test" });
    fakeWebSocket!.emitMessage({ type: "restore", snapshot: "", cols: 80, rows: 24, sessionId: "session-1" });
    await Promise.resolve();
    expect(sentPulses()).toHaveLength(0);

    await delay(120);
    expect(sentPulses()).toEqual([{ type: "pulse", reason: "restore" }]);

    now += 1;
    fakeWebSocket!.emitMessage({ type: "output", events: [{ data: "x".repeat(50_001) }] });
    expect(sentPulses()).toEqual([{ type: "pulse", reason: "restore" }]);

    now += 10_001;
    fakeWebSocket!.emitMessage({ type: "output", events: [{ data: "y".repeat(50_001) }] });
    expect(sentPulses()).toEqual([{ type: "pulse", reason: "restore" }, { type: "pulse", reason: "burst" }]);
    controller.dispose("test");
    controller = null;
  } finally {
    Date.now = originalNow;
    controller?.dispose("test");
    cleanup();
  }
});

test("WA-179: TerminalController sends a restore pulse on same-role active reattach", async () => {
  const cleanup = installFakeBrowser();
  let controller: TerminalController | null = null;
  try {
    controller = new TerminalController({
      getRunner: () => ({ mode: "pty", status: "running" }),
      getRoleId: () => "role-id",
      buildWsUrl: () => "ws://example.test/terminal/ws",
      debugLog: () => undefined,
      onAttention: () => undefined,
      onRunnerStatus: () => undefined,
      onSessionChange: () => undefined,
      fallbackSendInput: () => undefined,
      fontSize: () => 14,
      lineHeight: () => 1.1,
      accentHex: () => "#a78bfa",
      mouseSelectMode: () => false,
      disableWebgl: () => true,
    });

    const firstContainer = new FakeElement("DIV") as unknown as HTMLElement;
    const secondContainer = new FakeElement("DIV") as unknown as HTMLElement;
    controller.mount("WhatsAgent:worker", firstContainer, { active: true, reason: "test" });
    fakeWebSocket!.sent = [];
    controller.unmount("test");
    controller.mount("WhatsAgent:worker", secondContainer, { active: true, reason: "test" });
    await delay(120);

    expect(sentPulses()).toEqual([{ type: "pulse", reason: "restore" }]);
    controller.dispose("test");
    controller = null;
  } finally {
    controller?.dispose("test");
    cleanup();
  }
});

test("WA-179: TerminalController suppresses burst and restore pulses when workaround is off", async () => {
  const cleanup = installFakeBrowser();
  let controller: TerminalController | null = null;
  try {
    controller = new TerminalController({
      getRunner: () => ({ mode: "pty", status: "running" }),
      getRoleId: () => "role-id",
      buildWsUrl: () => "ws://example.test/terminal/ws",
      debugLog: () => undefined,
      onAttention: () => undefined,
      onRunnerStatus: () => undefined,
      onSessionChange: () => undefined,
      fallbackSendInput: () => undefined,
      fontSize: () => 14,
      lineHeight: () => 1.1,
      accentHex: () => "#a78bfa",
      mouseSelectMode: () => false,
      disableWebgl: () => true,
    });

    const container = new FakeElement("DIV") as unknown as HTMLElement;
    controller.setPulseEnabled(false);
    controller.mount("WhatsAgent:worker", container, { active: true, reason: "test" });
    fakeWebSocket!.emitMessage({ type: "output", events: [{ data: "x".repeat(50_001) }] });
    fakeWebSocket!.emitMessage({ type: "restore", snapshot: "", cols: 80, rows: 24, sessionId: "session-1" });
    await delay(120);

    expect(sentPulses()).toEqual([]);
    controller.dispose("test");
    controller = null;
  } finally {
    controller?.dispose("test");
    cleanup();
  }
});
