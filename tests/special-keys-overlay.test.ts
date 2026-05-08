import { expect, test } from "bun:test";

import { KEY_ESC, KEY_PG_UP, KEY_UP } from "../src/web/client/keystrokes.ts";
import { SpecialKeysOverlay, type SpecialKeysOverlayController } from "../src/web/client/special-keys-overlay.ts";

class FakeDomEvent {
  defaultPrevented = false;
  target: unknown = null;

  constructor(public readonly type: string, private readonly path: unknown[] = []) {}

  preventDefault(): void {
    this.defaultPrevented = true;
  }

  composedPath(): unknown[] {
    return this.path;
  }
}

type Listener = (event: FakeDomEvent) => void;

class FakeElement {
  id = "";
  type = "";
  className = "";
  textContent: string | null = "";
  hidden = false;
  parentNode: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  private readonly attrs = new Map<string, string>();
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(readonly tagName: string = "DIV") {}

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parentNode) return;
    const siblings = this.parentNode.children;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentNode = null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  addEventListener(type: string, cb: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(cb);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, cb: Listener): void {
    this.listeners.get(type)?.delete(cb);
  }

  dispatchEvent(event: FakeDomEvent): boolean {
    event.target = this;
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    return !event.defaultPrevented;
  }
}

class FakeDocument {
  readonly body = new FakeElement("BODY");
  private readonly listeners = new Map<string, Set<Listener>>();

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName.toUpperCase());
  }

  addEventListener(type: string, cb: Listener, _options?: unknown): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(cb);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, cb: Listener, _options?: unknown): void {
    this.listeners.get(type)?.delete(cb);
  }

  dispatchEvent(event: FakeDomEvent): boolean {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    return !event.defaultPrevented;
  }
}

class FakeWindow {
  innerWidth: number;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(private mobile: boolean) {
    this.innerWidth = mobile ? 400 : 1200;
  }

  setMobile(mobile: boolean): void {
    this.mobile = mobile;
    this.innerWidth = mobile ? 400 : 1200;
  }

  matchMedia(media: string): { matches: boolean; media: string } {
    return { matches: this.mobile, media };
  }

  addEventListener(type: string, cb: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(cb);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, cb: Listener): void {
    this.listeners.get(type)?.delete(cb);
  }

  dispatchEvent(event: FakeDomEvent): boolean {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    return !event.defaultPrevented;
  }
}

function installFakeDom(opts: { mobile?: boolean } = {}): { container: FakeElement; document: FakeDocument; window: FakeWindow; cleanup: () => void } {
  const g = globalThis as any;
  const previous = {
    document: g.document,
    window: g.window,
    HTMLElement: g.HTMLElement,
    HTMLButtonElement: g.HTMLButtonElement,
    Event: g.Event,
  };
  const fakeDocument = new FakeDocument();
  const fakeWindow = new FakeWindow(opts.mobile === true);
  g.document = fakeDocument;
  g.window = fakeWindow;
  g.HTMLElement = FakeElement;
  g.HTMLButtonElement = FakeElement;
  g.Event = class {
    constructor(public readonly type: string) {}
  };
  const container = new FakeElement("DIV");
  fakeDocument.body.appendChild(container);
  return {
    container,
    document: fakeDocument,
    window: fakeWindow,
    cleanup: () => {
      g.document = previous.document;
      g.window = previous.window;
      g.HTMLElement = previous.HTMLElement;
      g.HTMLButtonElement = previous.HTMLButtonElement;
      g.Event = previous.Event;
    },
  };
}

function createController(): SpecialKeysOverlayController & { sent: string[]; focusCalls: number; fitCalls: number; armCalls: number; disarmCalls: number; consumeCtrl: () => void } {
  const controller = {
    sent: [] as string[],
    focusCalls: 0,
    fitCalls: 0,
    armCalls: 0,
    disarmCalls: 0,
    ctrlArmed: false,
    consumeCallback: null as (() => void) | null,
    sendKeystroke(sequence: string): boolean {
      this.sent.push(sequence);
      return true;
    },
    focus(): void {
      this.focusCalls += 1;
    },
    scheduleFit(): void {
      this.fitCalls += 1;
    },
    armCtrl(onConsumed: () => void): void {
      this.armCalls += 1;
      this.ctrlArmed = true;
      this.consumeCallback = onConsumed;
    },
    disarmCtrl(): void {
      this.disarmCalls += 1;
      this.ctrlArmed = false;
      this.consumeCallback = null;
    },
    isCtrlArmed(): boolean {
      return this.ctrlArmed;
    },
    consumeCtrl(): void {
      const cb = this.consumeCallback;
      this.ctrlArmed = false;
      this.consumeCallback = null;
      cb?.();
    },
  };
  return controller;
}

function descendants(root: FakeElement): FakeElement[] {
  return [root, ...root.children.flatMap((child) => descendants(child))];
}

function hasClass(node: FakeElement, className: string): boolean {
  return node.className.split(/\s+/).includes(className);
}

function byClass(root: FakeElement, className: string): FakeElement[] {
  return descendants(root).filter((node) => hasClass(node, className));
}

function byAria(root: FakeElement, label: string): FakeElement {
  const node = descendants(root).find((item) => item.getAttribute("aria-label") === label);
  if (!node) throw new Error(`Missing aria-label ${label}`);
  return node;
}

function click(node: FakeElement): void {
  node.dispatchEvent(new FakeDomEvent("click", [node]));
}

function pointerDown(node: FakeElement): FakeDomEvent {
  const event = new FakeDomEvent("pointerdown", [node]);
  node.dispatchEvent(event);
  return event;
}

test("EP-035 WA-192: mount starts collapsed with only the trigger icon", () => {
  const env = installFakeDom();
  try {
    const overlay = new SpecialKeysOverlay();
    overlay.mount(env.container as unknown as HTMLElement, createController());

    expect(overlay.state).toBe("collapsed");
    const icon = byClass(env.container, "special-keys-icon")[0]!;
    expect(icon.hidden).toBe(false);
    expect(icon.getAttribute("aria-expanded")).toBe("false");
    expect(icon.getAttribute("aria-controls")).toStartWith("special-keys-");
    expect(byClass(env.container, "special-keys-panel")).toHaveLength(0);
    expect(byClass(env.container, "special-keys-bar")).toHaveLength(0);
  } finally {
    env.cleanup();
  }
});

test("EP-035 WA-192: mount without controller adds no overlay DOM", () => {
  const env = installFakeDom();
  try {
    const overlay = new SpecialKeysOverlay();
    overlay.mount(env.container as unknown as HTMLElement, null);

    expect(env.container.children).toHaveLength(0);
    expect(overlay.state).toBe("collapsed");
  } finally {
    env.cleanup();
  }
});

test("EP-035 WA-198: overlay renders collapse column plus 6x2 key grid", () => {
  const env = installFakeDom();
  try {
    const overlay = new SpecialKeysOverlay();
    overlay.mount(env.container as unknown as HTMLElement, createController());
    click(byClass(env.container, "special-keys-icon")[0]!);

    const collapseCol = byClass(env.container, "special-keys-collapse-col");
    expect(collapseCol).toHaveLength(1);
    expect(collapseCol[0]!.children).toHaveLength(1);
    expect(collapseCol[0]!.children[0]!.getAttribute("aria-label")).toBe("Hide special keys");
    expect(collapseCol[0]!.children[0]!.textContent).toBe(">");

    const grid = byClass(env.container, "special-keys-grid");
    expect(grid).toHaveLength(1);
    expect(grid[0]!.children.map((child) => child.textContent)).toEqual([
      "esc",
      "home",
      "end",
      "pg up",
      "↑",
      "pg dn",
      "Ctrl",
      "tab",
      "shift+tab",
      "←",
      "↓",
      "→",
    ]);
    expect(byClass(env.container, "special-keys-spacer")).toHaveLength(0);
    expect(byClass(env.container, "special-keys-row")).toHaveLength(0);
  } finally {
    env.cleanup();
  }
});

test("EP-035 WA-197: Ctrl button arms sticky modifier and reflects pressed state", () => {
  const env = installFakeDom();
  try {
    const controller = createController();
    const overlay = new SpecialKeysOverlay();
    overlay.mount(env.container as unknown as HTMLElement, controller);
    click(byClass(env.container, "special-keys-icon")[0]!);

    const ctrl = byAria(env.container, "Sticky Control modifier");
    click(ctrl);

    expect(controller.armCalls).toBe(1);
    expect(controller.isCtrlArmed()).toBe(true);
    expect(hasClass(ctrl, "is-armed")).toBe(true);
    expect(ctrl.getAttribute("aria-pressed")).toBe("true");
    expect(controller.focusCalls).toBe(1);
    expect(overlay.state).toBe("expanded");
  } finally {
    env.cleanup();
  }
});

test("EP-035 WA-197: Ctrl button disarms when clicked while armed", () => {
  const env = installFakeDom();
  try {
    const controller = createController();
    const overlay = new SpecialKeysOverlay();
    overlay.mount(env.container as unknown as HTMLElement, controller);
    click(byClass(env.container, "special-keys-icon")[0]!);
    const ctrl = byAria(env.container, "Sticky Control modifier");

    click(ctrl);
    click(ctrl);

    expect(controller.armCalls).toBe(1);
    expect(controller.disarmCalls).toBe(1);
    expect(controller.isCtrlArmed()).toBe(false);
    expect(hasClass(ctrl, "is-armed")).toBe(false);
    expect(ctrl.getAttribute("aria-pressed")).toBe("false");
    expect(controller.focusCalls).toBe(2);
  } finally {
    env.cleanup();
  }
});

test("EP-035 WA-197: consumed Ctrl callback clears armed visual state", () => {
  const env = installFakeDom();
  try {
    const controller = createController();
    const overlay = new SpecialKeysOverlay();
    overlay.mount(env.container as unknown as HTMLElement, controller);
    click(byClass(env.container, "special-keys-icon")[0]!);
    const ctrl = byAria(env.container, "Sticky Control modifier");

    click(ctrl);
    controller.consumeCtrl();

    expect(controller.isCtrlArmed()).toBe(false);
    expect(hasClass(ctrl, "is-armed")).toBe(false);
    expect(ctrl.getAttribute("aria-pressed")).toBe("false");
  } finally {
    env.cleanup();
  }
});

test("EP-035 WA-192: Escape sends ESC without collapsing and refocuses", () => {
  const env = installFakeDom();
  try {
    const controller = createController();
    const overlay = new SpecialKeysOverlay();
    overlay.mount(env.container as unknown as HTMLElement, controller);
    click(byClass(env.container, "special-keys-icon")[0]!);

    click(byAria(env.container, "Escape"));

    expect(controller.sent).toEqual([KEY_ESC]);
    expect(controller.focusCalls).toBe(1);
    expect(byClass(env.container, "special-keys-panel")).toHaveLength(1);
  } finally {
    env.cleanup();
  }
});

test("EP-035 WA-197: overlay escape keys do not consume sticky Ctrl", () => {
  const env = installFakeDom();
  try {
    const controller = createController();
    const overlay = new SpecialKeysOverlay();
    overlay.mount(env.container as unknown as HTMLElement, controller);
    click(byClass(env.container, "special-keys-icon")[0]!);
    const ctrl = byAria(env.container, "Sticky Control modifier");

    click(ctrl);
    click(byAria(env.container, "Escape"));
    click(byAria(env.container, "Arrow Up"));
    click(byAria(env.container, "Page Up"));

    expect(controller.sent).toEqual([KEY_ESC, KEY_UP, KEY_PG_UP]);
    expect(controller.isCtrlArmed()).toBe(true);
    expect(hasClass(ctrl, "is-armed")).toBe(true);
    expect(ctrl.getAttribute("aria-pressed")).toBe("true");
  } finally {
    env.cleanup();
  }
});

test("EP-035 WA-197: unmount disarms sticky Ctrl", () => {
  const env = installFakeDom();
  try {
    const controller = createController();
    const overlay = new SpecialKeysOverlay();
    overlay.mount(env.container as unknown as HTMLElement, controller);
    click(byClass(env.container, "special-keys-icon")[0]!);
    click(byAria(env.container, "Sticky Control modifier"));

    overlay.unmount();

    expect(controller.disarmCalls).toBe(1);
    expect(controller.isCtrlArmed()).toBe(false);
  } finally {
    env.cleanup();
  }
});

test("EP-035 WA-192: collapse button removes the panel and shows the icon", () => {
  const env = installFakeDom();
  try {
    const controller = createController();
    const overlay = new SpecialKeysOverlay();
    overlay.mount(env.container as unknown as HTMLElement, controller);
    const icon = byClass(env.container, "special-keys-icon")[0]!;
    click(icon);

    click(byAria(env.container, "Hide special keys"));

    expect(overlay.state).toBe("collapsed");
    expect(byClass(env.container, "special-keys-panel")).toHaveLength(0);
    expect(icon.hidden).toBe(false);
    expect(icon.getAttribute("aria-expanded")).toBe("false");
    expect(controller.focusCalls).toBe(1);
  } finally {
    env.cleanup();
  }
});

test("EP-035 WA-197: collapse button disarms sticky Ctrl", () => {
  const env = installFakeDom();
  try {
    const controller = createController();
    const overlay = new SpecialKeysOverlay();
    overlay.mount(env.container as unknown as HTMLElement, controller);
    click(byClass(env.container, "special-keys-icon")[0]!);
    const ctrl = byAria(env.container, "Sticky Control modifier");

    click(ctrl);
    expect(controller.armCalls).toBe(1);
    expect(controller.isCtrlArmed()).toBe(true);
    click(byAria(env.container, "Hide special keys"));

    expect(controller.disarmCalls).toBe(1);
    expect(controller.isCtrlArmed()).toBe(false);
    expect(hasClass(ctrl, "is-armed")).toBe(false);
    expect(ctrl.getAttribute("aria-pressed")).toBe("false");
    expect(overlay.state).toBe("collapsed");
    expect(byClass(env.container, "special-keys-panel")).toHaveLength(0);
  } finally {
    env.cleanup();
  }
});

test("EP-035 WA-192: desktop tap-outside collapses the expanded panel", () => {
  const env = installFakeDom({ mobile: false });
  try {
    const overlay = new SpecialKeysOverlay();
    overlay.mount(env.container as unknown as HTMLElement, createController());
    click(byClass(env.container, "special-keys-icon")[0]!);
    expect(byClass(env.container, "special-keys-panel")).toHaveLength(1);

    const outside = new FakeElement("DIV");
    env.document.dispatchEvent(new FakeDomEvent("pointerdown", [outside]));

    expect(overlay.state).toBe("collapsed");
    expect(byClass(env.container, "special-keys-panel")).toHaveLength(0);
  } finally {
    env.cleanup();
  }
});

test("EP-035 WA-197: desktop tap-outside disarms sticky Ctrl", () => {
  const env = installFakeDom({ mobile: false });
  try {
    const controller = createController();
    const overlay = new SpecialKeysOverlay();
    overlay.mount(env.container as unknown as HTMLElement, controller);
    click(byClass(env.container, "special-keys-icon")[0]!);
    const ctrl = byAria(env.container, "Sticky Control modifier");

    click(ctrl);
    expect(controller.armCalls).toBe(1);
    expect(controller.isCtrlArmed()).toBe(true);
    const outside = new FakeElement("DIV");
    env.document.dispatchEvent(new FakeDomEvent("pointerdown", [outside]));

    expect(controller.disarmCalls).toBe(1);
    expect(controller.isCtrlArmed()).toBe(false);
    expect(hasClass(ctrl, "is-armed")).toBe(false);
    expect(ctrl.getAttribute("aria-pressed")).toBe("false");
    expect(overlay.state).toBe("collapsed");
    expect(byClass(env.container, "special-keys-panel")).toHaveLength(0);
  } finally {
    env.cleanup();
  }
});

test("EP-035 WA-192: mobile tap-outside is ignored and renders a bar", () => {
  const env = installFakeDom({ mobile: true });
  try {
    const overlay = new SpecialKeysOverlay();
    overlay.mount(env.container as unknown as HTMLElement, createController());
    const icon = byClass(env.container, "special-keys-icon")[0]!;
    click(icon);
    expect(byClass(env.container, "special-keys-bar")).toHaveLength(1);
    expect(byClass(env.container, "special-keys-panel")).toHaveLength(0);

    const outside = new FakeElement("DIV");
    env.document.dispatchEvent(new FakeDomEvent("pointerdown", [outside]));

    expect(overlay.state).toBe("expanded");
    expect(byClass(env.container, "special-keys-bar")).toHaveLength(1);
    expect(icon.hidden).toBe(true);
  } finally {
    env.cleanup();
  }
});

test("EP-035 WA-192: overlay pointerdown prevents focus theft", () => {
  const env = installFakeDom();
  try {
    const overlay = new SpecialKeysOverlay();
    overlay.mount(env.container as unknown as HTMLElement, createController());
    click(byClass(env.container, "special-keys-icon")[0]!);

    const event = pointerDown(byAria(env.container, "Escape"));

    expect(event.defaultPrevented).toBe(true);
    expect(byAria(env.container, "Escape").getAttribute("tabindex")).toBe("0");
  } finally {
    env.cleanup();
  }
});

test("EP-035 WA-192: expand and collapse trigger terminal refit", () => {
  const env = installFakeDom();
  try {
    const controller = createController();
    const overlay = new SpecialKeysOverlay();
    overlay.mount(env.container as unknown as HTMLElement, controller);

    click(byClass(env.container, "special-keys-icon")[0]!);
    expect(controller.fitCalls).toBe(1);

    click(byAria(env.container, "Hide special keys"));
    expect(controller.fitCalls).toBe(2);
  } finally {
    env.cleanup();
  }
});

test("EP-035 WA-192: resize re-evaluates panel versus mobile bar layout", () => {
  const env = installFakeDom({ mobile: false });
  try {
    const controller = createController();
    const overlay = new SpecialKeysOverlay();
    overlay.mount(env.container as unknown as HTMLElement, controller);
    click(byClass(env.container, "special-keys-icon")[0]!);
    expect(byClass(env.container, "special-keys-panel")).toHaveLength(1);

    env.window.setMobile(true);
    env.window.dispatchEvent(new FakeDomEvent("resize"));

    expect(overlay.state).toBe("expanded");
    expect(byClass(env.container, "special-keys-panel")).toHaveLength(0);
    expect(byClass(env.container, "special-keys-bar")).toHaveLength(1);
    expect(controller.fitCalls).toBe(2);
  } finally {
    env.cleanup();
  }
});
