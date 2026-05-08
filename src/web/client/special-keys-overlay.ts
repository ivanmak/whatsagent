import {
  KEY_DOWN,
  KEY_END,
  KEY_ESC,
  KEY_HOME,
  KEY_LEFT,
  KEY_PG_DN,
  KEY_PG_UP,
  KEY_RIGHT,
  KEY_SHIFT_TAB,
  KEY_TAB,
  KEY_UP,
} from "./keystrokes.ts";
import type { TerminalController } from "./terminal-controller.ts";

const MOBILE_QUERY = "(max-width: 760px), (pointer: coarse)";

let nextOverlayId = 0;

export type SpecialKeysOverlayState = "collapsed" | "expanded";
export type SpecialKeysOverlayController = Pick<TerminalController, "sendKeystroke" | "focus" | "armCtrl" | "disarmCtrl" | "isCtrlArmed"> & {
  scheduleFit?: () => void;
};

interface SpecialKeyButton {
  label: string;
  ariaLabel: string;
  sequence?: string;
  collapse?: boolean;
  ctrl?: boolean;
}

const COLLAPSE_KEY: SpecialKeyButton = { label: ">", ariaLabel: "Hide special keys", collapse: true };

const SPECIAL_KEY_ROWS: SpecialKeyButton[][] = [
  [
    { label: "esc", ariaLabel: "Escape", sequence: KEY_ESC },
    { label: "home", ariaLabel: "Home", sequence: KEY_HOME },
    { label: "end", ariaLabel: "End", sequence: KEY_END },
    { label: "pg up", ariaLabel: "Page Up", sequence: KEY_PG_UP },
    { label: "↑", ariaLabel: "Arrow Up", sequence: KEY_UP },
    { label: "pg dn", ariaLabel: "Page Down", sequence: KEY_PG_DN },
  ],
  [
    { label: "Ctrl", ariaLabel: "Sticky Control modifier", ctrl: true },
    { label: "tab", ariaLabel: "Tab", sequence: KEY_TAB },
    { label: "shift+tab", ariaLabel: "Shift Tab", sequence: KEY_SHIFT_TAB },
    { label: "←", ariaLabel: "Arrow Left", sequence: KEY_LEFT },
    { label: "↓", ariaLabel: "Arrow Down", sequence: KEY_DOWN },
    { label: "→", ariaLabel: "Arrow Right", sequence: KEY_RIGHT },
  ],
];

export class SpecialKeysOverlay {
  private container: HTMLElement | null = null;
  private controller: SpecialKeysOverlayController | null = null;
  private icon: HTMLButtonElement | null = null;
  private surface: HTMLElement | null = null;
  private ctrlButton: HTMLButtonElement | null = null;
  private panelId = "";
  private overlayState: SpecialKeysOverlayState = "collapsed";
  private outsideListenerActive = false;
  private readonly onOutsidePointerDown = (event: PointerEvent) => this.handleOutsidePointerDown(event);
  private readonly onResize = () => this.handleResize();

  get state(): SpecialKeysOverlayState {
    return this.overlayState;
  }

  mount(container: HTMLElement, controller: SpecialKeysOverlayController | null | undefined): void {
    this.unmount();
    if (!container || !controller) return;
    this.container = container;
    this.controller = controller;
    this.panelId = `special-keys-${++nextOverlayId}`;
    this.overlayState = "collapsed";
    this.icon = this.createIcon();
    this.container.appendChild(this.icon);
    window.addEventListener?.("resize", this.onResize);
  }

  unmount(): void {
    this.unregisterOutsideListener();
    window.removeEventListener?.("resize", this.onResize);
    this.controller?.disarmCtrl();
    this.surface?.remove();
    this.icon?.remove();
    this.container = null;
    this.controller = null;
    this.icon = null;
    this.surface = null;
    this.ctrlButton = null;
    this.panelId = "";
    this.overlayState = "collapsed";
  }

  private createIcon(): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "special-keys-icon";
    button.textContent = "⌨";
    button.setAttribute("aria-label", "Show special keys");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", this.panelId);
    button.setAttribute("tabindex", "0");
    this.preventPointerFocus(button);
    button.addEventListener("click", () => this.expand());
    return button;
  }

  private expand(): void {
    if (!this.container || !this.controller || !this.icon) return;
    this.overlayState = "expanded";
    this.icon.hidden = true;
    this.icon.setAttribute("aria-expanded", "true");
    this.renderSurface();
    this.configureOutsideListener();
    this.requestRefit();
  }

  private collapse(refocus: boolean = true): void {
    this.unregisterOutsideListener();
    this.controller?.disarmCtrl();
    if (this.ctrlButton) this.setCtrlButtonArmed(this.ctrlButton, false);
    this.surface?.remove();
    this.surface = null;
    this.ctrlButton = null;
    this.overlayState = "collapsed";
    if (this.icon) {
      this.icon.hidden = false;
      this.icon.setAttribute("aria-expanded", "false");
    }
    if (refocus) this.controller?.focus();
    this.requestRefit();
  }

  private renderSurface(): void {
    if (!this.container) return;
    this.surface?.remove();
    const surface = document.createElement("div");
    surface.id = this.panelId;
    surface.className = this.isMobileLayout() ? "special-keys-bar" : "special-keys-panel";
    surface.setAttribute("role", "toolbar");
    surface.setAttribute("aria-label", "Terminal special keys");

    const collapseCol = document.createElement("div");
    collapseCol.className = "special-keys-collapse-col";
    collapseCol.appendChild(this.createKeyButton(COLLAPSE_KEY));
    surface.appendChild(collapseCol);

    const grid = document.createElement("div");
    grid.className = "special-keys-grid";
    for (const row of SPECIAL_KEY_ROWS) {
      for (const key of row) grid.appendChild(this.createKeyButton(key));
    }
    surface.appendChild(grid);

    this.surface = surface;
    this.container.appendChild(surface);
  }

  private createKeyButton(key: SpecialKeyButton): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = key.collapse ? "special-keys-key special-keys-collapse" : (key.ctrl ? "special-keys-key special-keys-ctrl" : "special-keys-key");
    button.textContent = key.label;
    button.setAttribute("aria-label", key.ariaLabel);
    button.setAttribute("tabindex", "0");
    if (key.ctrl) {
      this.ctrlButton = button;
      this.setCtrlButtonArmed(button, Boolean(this.controller?.isCtrlArmed()));
    }
    this.preventPointerFocus(button);
    button.addEventListener("click", () => {
      if (key.collapse) {
        this.collapse(true);
        return;
      }
      if (key.ctrl) {
        this.toggleCtrl(button);
        return;
      }
      if (typeof key.sequence !== "string") return;
      this.controller?.sendKeystroke(key.sequence);
      this.controller?.focus();
    });
    return button;
  }

  private toggleCtrl(button: HTMLButtonElement): void {
    if (this.controller?.isCtrlArmed()) {
      this.controller.disarmCtrl();
      this.setCtrlButtonArmed(button, false);
    } else {
      this.controller?.armCtrl(() => this.clearCtrlArmedClass());
      this.setCtrlButtonArmed(button, true);
    }
    this.controller?.focus();
  }

  private clearCtrlArmedClass(): void {
    if (this.ctrlButton) this.setCtrlButtonArmed(this.ctrlButton, false);
  }

  private setCtrlButtonArmed(button: HTMLButtonElement, armed: boolean): void {
    const classes = new Set(String(button.className || "").split(/\s+/).filter(Boolean));
    if (armed) classes.add("is-armed");
    else classes.delete("is-armed");
    button.className = Array.from(classes).join(" ");
    button.setAttribute("aria-pressed", armed ? "true" : "false");
  }

  private preventPointerFocus(button: HTMLElement): void {
    button.addEventListener("pointerdown", (event) => event.preventDefault());
  }

  private handleOutsidePointerDown(event: PointerEvent): void {
    if (this.overlayState !== "expanded" || this.isMobileLayout()) return;
    const path: unknown[] = typeof event.composedPath === "function" ? event.composedPath() : [];
    if (this.surface && path.includes(this.surface)) return;
    if (this.icon && path.includes(this.icon)) return;
    this.collapse(false);
  }

  private handleResize(): void {
    if (this.overlayState !== "expanded") return;
    this.renderSurface();
    this.configureOutsideListener();
    this.requestRefit();
  }

  private configureOutsideListener(): void {
    this.unregisterOutsideListener();
    if (this.isMobileLayout()) return;
    document.addEventListener("pointerdown", this.onOutsidePointerDown, true);
    this.outsideListenerActive = true;
  }

  private unregisterOutsideListener(): void {
    if (!this.outsideListenerActive) return;
    document.removeEventListener("pointerdown", this.onOutsidePointerDown, true);
    this.outsideListenerActive = false;
  }

  private isMobileLayout(): boolean {
    if (typeof window === "undefined") return false;
    const match = window.matchMedia?.(MOBILE_QUERY);
    if (match) return match.matches;
    return Number(window.innerWidth || 0) <= 760;
  }

  private requestRefit(): void {
    if (typeof this.controller?.scheduleFit === "function") {
      this.controller.scheduleFit();
      return;
    }
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new Event("resize"));
    }
  }
}
