import { beforeAll, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { WhatsAgentConfig } from "../src/config.ts";
import type { AgentRow } from "../src/db.ts";
import { buildClientBundle } from "../src/web/client/build.ts";
import { renderSafeMarkdownHtml } from "../src/web/client/markdown.ts";
import { installTruncateTitleFallback, truncatedAttrs } from "../src/web/client/truncate-tooltip.ts";
import { pluralize, stripAnsi } from "../src/web/client/util.ts";
import { escapeForScriptContext, renderWebShellClientScript } from "../src/web/client-script.ts";
import { renderWebShell as renderWebShellBase, type WebShellData } from "../src/web/shell.ts";

let builtClientBundle = "";
let clientSource = "";
let kanbanSource = "";
let settingsSource = "";
let agentsSource = "";
let codexSource = "";
let messagesSource = "";
let markdownSource = "";
let notificationsSource = "";
let specialKeysOverlaySource = "";
let dbSource = "";
let daemonSource = "";
let daemonDbSource = "";
let shellOverridesSource = "";

beforeAll(async () => {
  builtClientBundle = await buildClientBundle();
  clientSource = await readFile(new URL("../src/web/client/main.ts", import.meta.url), "utf8");
  kanbanSource = await readFile(new URL("../src/web/client/kanban.ts", import.meta.url), "utf8");
  settingsSource = await readFile(new URL("../src/web/client/settings.ts", import.meta.url), "utf8");
  agentsSource = await readFile(new URL("../src/web/client/agents.ts", import.meta.url), "utf8");
  codexSource = await readFile(new URL("../src/web/client/codex.ts", import.meta.url), "utf8");
  messagesSource = await readFile(new URL("../src/web/client/messages.ts", import.meta.url), "utf8");
  markdownSource = await readFile(new URL("../src/web/client/markdown.ts", import.meta.url), "utf8");
  notificationsSource = await readFile(new URL("../src/web/client/notifications.ts", import.meta.url), "utf8");
  specialKeysOverlaySource = await readFile(new URL("../src/web/client/special-keys-overlay.ts", import.meta.url), "utf8");
  dbSource = await readFile(new URL("../src/db.ts", import.meta.url), "utf8");
  daemonSource = await readFile(new URL("../src/server/daemon.ts", import.meta.url), "utf8");
  daemonDbSource = await readFile(new URL("../src/daemon-db.ts", import.meta.url), "utf8");
  shellOverridesSource = await readFile(new URL("../src/web/shell-overrides.ts", import.meta.url), "utf8");
});

function renderWebShell(data: Omit<WebShellData, "clientBundle"> & { clientBundle?: string }): string {
  return renderWebShellBase({ ...data, clientBundle: data.clientBundle ?? "" });
}

function renderNotificationShell(): { html: string; script: string } {
  const config: WhatsAgentConfig = {
    fleet: { name: "t", root: "/tmp/t" },
    ui: { host: "127.0.0.1", port: 4017 },
    policy: { mode: "star" },
    commands: {
      claudeCode: { command: "c", args: [] },
      openCode: { command: "o", args: [] },
      codex: { command: "x", args: [] },
      pi: { command: "p", args: [] },
    },
  };
  const html = renderWebShell({ root: "/tmp/t", config, roles: [], mainRole: null, runners: [] });
  const script = clientSource;
  return { html, script };
}

function expectAbsent(source: string, needles: string[]): void {
  for (const needle of needles) {
    expect(source.includes(needle)).toBe(false);
  }
}

function testEsc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

test("buildClientBundle returns the de-escaped browser bundle", async () => {
  const bundle = await buildClientBundle();

  expect(bundle.length).toBeGreaterThan(0);
  expect(bundle).toContain("renderKanban");
  expect(bundle).toContain("__WHATSAGENT_INITIAL_STATE__");
});

test("renderSafeMarkdownHtml renders structure and escapes unsafe HTML", () => {
  const html = renderSafeMarkdownHtml(
    "**bold** and `code` and [link](https://example.com)\n- list item\n- another\n<script>alert(1)</script>",
    testEsc,
  );

  expect(html).toContain("<strong>bold</strong>");
  expect(html).toContain("<code>code</code>");
  expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>');
  expect(html).toContain("<ul><li>list item</li><li>another</li></ul>");
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
});

test("web client main source contains de-escaped chunks and folded patches", async () => {
  const source = clientSource;

  for (const symbol of ["renderMessages"]) {
    expect(source).toContain(symbol);
  }
  for (const patchedOnly of ["uiPrefsVersion: 2", "accentPalette", "parseRoute"]) {
    expect(source).toContain(patchedOnly);
  }
  expect(source).toContain('import { parseRoute, workspacePath } from "./router.ts";');
  expect(source).not.toContain("function parseRoute(pathname)");

  // KANBAN-LIFT: kanban render helpers live in kanban.ts; main.ts only imports
  // and dispatches.
  expect(source).toContain('from "./kanban.ts"');
  expect(source).toContain("renderKanban");
  for (const symbol of ["renderKanban", "renderKanbanEpicSection", "renderKanbanEpicDrawer"]) {
    expect(kanbanSource).toContain(symbol);
  }
  expect(kanbanSource).toContain("export function renderKanban");
  expect(kanbanSource).toContain("export function resetKanban");
  expect(kanbanSource).toContain("export function applyKanbanRoute");
});

test("renderWebShellClientScript substitutes initial state into a supplied bundle", () => {
  const rendered = renderWebShellClientScript(
    "before __WHATSAGENT_INITIAL_STATE__ after",
    JSON.stringify({ test: true }),
  );

  expect(rendered).toContain('{"test":true}');
  expect(rendered).not.toContain("__WHATSAGENT_INITIAL_STATE__");
});

test("escapeForScriptContext preserves parseable JSON while escaping script-breaking chars", () => {
  const json = JSON.stringify({
    workspace: "</script><script>throw new Error(\"xss\")</script>",
    image: "<img src=x onerror=alert(1)>&",
    separators: "line\u2028next\u2029end",
  });
  const escaped = escapeForScriptContext(json);

  expect(escaped).not.toContain("<");
  expect(escaped).not.toContain(">");
  expect(escaped).not.toContain("&");
  expect(escaped).not.toContain("\u2028");
  expect(escaped).not.toContain("\u2029");
  expect(escaped).toContain("\\u003c/script\\u003e\\u003cscript\\u003ethrow new Error");
  expect(escaped).toContain("\\u003cimg src=x onerror=alert(1)\\u003e\\u0026");
  expect(escaped).toContain("line\\u2028next\\u2029end");
  expect(JSON.parse(escaped)).toEqual(JSON.parse(json));
});

test("renderWebShellClientScript escapes malicious initial state for inline script", () => {
  const rendered = renderWebShellClientScript(
    "const initialState = __WHATSAGENT_INITIAL_STATE__;",
    JSON.stringify({ name: "</script><script>throw new Error(\"xss\")</script>" }),
  );

  expect(rendered).toContain("\\u003c/script\\u003e\\u003cscript\\u003e");
  expect(rendered).not.toContain("</script><script>");
});

test("WA-157 login page validates return parameter before navigation", () => {
  expect(daemonSource).toContain("function safeReturnPath(value)");
  expect(daemonSource).toContain("if(!raw.startsWith('/')||raw.startsWith('//'))return '/'");
  expect(daemonSource).toContain("raw.charCodeAt(i)");
  expect(daemonSource).toContain("if(c===92||c<32||c===127||c===8232||c===8233)return '/'");
  expect(daemonSource).toContain("new URL(raw,location.origin)");
  expect(daemonSource).toContain("if(url.origin!==location.origin)return '/'");
  expect(daemonSource).toContain("location.href=safeReturnPath(returnTo)");
  expect(daemonSource).not.toContain("location.href=new URLSearchParams(location.search).get('return')||'/'");
});

test("renderWebShell escapes malicious workspace names in initial state", () => {
  const config: WhatsAgentConfig = {
    fleet: { name: "whatsagent-test", root: "/tmp/whatsagent-test" },
    ui: { host: "127.0.0.1", port: 4017 },
    policy: { mode: "star" },
    commands: {
      claudeCode: { command: "claude", args: [] },
      openCode: { command: "opencode", args: [] },
      codex: { command: "codex", args: [] },
      pi: { command: "pi", args: [] },
    },
  };
  const html = renderWebShell({
    root: config.fleet.root,
    config,
    roles: [],
    mainRole: null,
    runners: [],
    clientBundle: "const initialState = __WHATSAGENT_INITIAL_STATE__;",
    currentWorkspace: { id: "ws-1", name: "</script><script>throw new Error(\"xss\")</script>" },
    workspaces: [{ id: "ws-1", name: "<img src=x onerror=alert(1)>", status: "active" }],
  });

  expect(html).toContain("\\u003c/script\\u003e\\u003cscript\\u003e");
  expect(html).toContain("\\u003cimg src=x onerror=alert(1)\\u003e");
  expect(html).not.toContain("</script><script>");
  expect(html).not.toContain("<img src=x onerror=alert(1)>");
});

test("legacy web client string fragments are removed", async () => {
  for (const relativePath of [
    "../src/web/client/script-chunk-0.ts",
    "../src/web/client/script-chunk-1.ts",
    "../src/web/client/script-chunk-2.ts",
    "../src/web/client/script-chunk-3.ts",
    "../src/web/client/script-chunk-4.ts",
    "../src/web/client/script-chunk-5.ts",
    "../src/web/client/script-chunk-6.ts",
    "../src/web/client-extension.ts",
    "../src/web/notifications-extension.ts",
    "../scripts/de-escape-client-chunks.ts",
  ]) {
    expect(await Bun.file(new URL(relativePath, import.meta.url)).exists()).toBe(false);
  }
});

test("EP-DEC-RUN WA-005: web client routes per-role actions through /roles-by-id/", () => {
  // launch / stop / input / resize / output / terminal-WS / default-runtime
  // all flipped onto UUID-keyed routes (advisor msg #20). Bare-name routes
  // would target the wrong row once WA-006 permits duplicate role names.
  expect(clientSource).toContain("/roles-by-id/");
  expect(agentsSource).toContain("/roles-by-id/");
  // No bare-name action URLs in the main client source. Allowed: the GET
  // listing/state route remains `/roles` (no trailing /<action>) — checked
  // by literal string match excluding the listing.
  for (const action of ["/launch", "/stop", "/input", "/resize", "/output", "/terminal/ws", "/default-runtime"]) {
    const legacyPattern = `'/roles/' + encodeURIComponent`;
    // crude but precise: every legacy-form construction concatenates this
    // exact prefix before encoding the role name. main.ts had 6 instances
    // before WA-005; agents.ts had 1 (default-runtime).
    expect(clientSource.includes(legacyPattern + "(role)" + " + '" + action)).toBe(false);
    expect(clientSource.includes(legacyPattern + "(targetRole)" + " + '" + action)).toBe(false);
    expect(agentsSource.includes(legacyPattern + "(roleName)" + " + '" + action)).toBe(false);
  }
  // notifications.ts uses the UUID-keyed route. WA-006 dropped the
  // legacy /roles/:name/launch fallback (the legacy route now 410s);
  // when state lacks the role row, the wrapper defers to baseLaunch.
  expect(notificationsSource).toContain("'/roles-by-id/' + encodeURIComponent(target.id) + '/launch'");
  expect(notificationsSource).not.toContain("'/roles/' + encodeURIComponent(targetRole) + '/launch'");
});

test("workspace decoupling legacy settings code is removed", () => {
  // Post-EP-DEC tombstones: these symbols belonged to the removed single-root
  // workspace model and are kept as grouped sentinels until the next storage UI rewrite.
  for (const source of [dbSource, daemonSource, agentsSource, shellOverridesSource]) {
    expectAbsent(source, [
      "multiAgentPerRepo",
      "MultiAgentPerRepo",
      "settings/multi-agent",
      "is_manual",
      "scanRoleDirs",
      "detectWorkspaceType",
      "workspace.type",
      "LegacyBridgeOptions",
      "EXCLUDED_ROLE_DIRS",
      "createWorkspaceOnDisk",
    ]);
  }
  expectAbsent(dbSource, ["RoleInput", "upsertRoles", "deleteRoleByName", "markMissingRolesByPath"]);
  expect(clientSource).toContain("state.nextWorkspace = { id: target.id, name: target.name };");
  expectAbsent(clientSource, ["{ id, name: id, path: '', type: 'single-repo' }", "state.nextWorkspace = { id: target.id, name: target.name, path:"]);
  expectAbsent(daemonDbSource, ["WorkspaceType"]);
});

test("renderWebShell emits parseable dashboard JavaScript", () => {
  const roles: AgentRow[] = [
    { id: "1", name: "architect", path: "architect", git_root: null, host_default: "claude-code", missing_at: null, last_discovered_at: "", created_at: "", updated_at: "" },
    { id: "2", name: "serviceA", path: "serviceA", git_root: null, host_default: "opencode", missing_at: null, last_discovered_at: "", created_at: "", updated_at: "" },
  ];
  const config: WhatsAgentConfig = {
    fleet: { name: "whatsagent-test", root: "/tmp/whatsagent-test" },
    ui: { host: "127.0.0.1", port: 4017 },
    policy: { mode: "star" },
    commands: {
      claudeCode: { command: "claude", args: [] },
      openCode: { command: "opencode", args: [] },
      codex: { command: "codex", args: [] },
      pi: { command: "pi", args: [] },
    },
  };

  const html = renderWebShell({ root: config.fleet.root, config, roles, mainRole: null, runners: [], clientBundle: builtClientBundle });
  const renderedScript = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  const script = clientSource;
  // EP-029 T4: many xterm-options + WS-handling + debug-tap pins moved
  // from main.ts into the new TerminalController. Read it once here so
  // the tombstones below can pin against the right file.
  const controllerSource = readFileSync(
    join(import.meta.dir, "..", "src", "web", "client", "terminal-controller.ts"),
    "utf8",
  );

  expect(renderedScript).toBeTruthy();
  if (!renderedScript) throw new Error("dashboard script was not rendered");
  expect(() => new Function(renderedScript)).not.toThrow();
  expect(script).not.toContain("Next phase: attach this tab");
  expect(renderedScript).toContain('"policy":{"mode":"star"}');
  expect(renderedScript).toContain('"chatHistory":{"retentionDays":30}');
  expect(renderedScript).toContain('"daemonSettings":{"tuiRedraw":{"workaround":"on"}}');
  expect(settingsSource).toContain("prefControl('tuiRedrawWorkaround', [['on', 'On'], ['off', 'Off']]");
  expect(settingsSource).toContain("action: 'set-tui-redraw-workaround'");
  expect(settingsSource).toContain("JSON.stringify({ workaround: next })");
  expect(settingsSource).toContain("patchState({ daemonSettings: { ...current, tuiRedraw: body.tuiRedraw");
  expect(settingsSource).toContain("const workaround = settings.workaround === 'off' ? 'off' : 'on';");
  expect(settingsSource).toContain("Forces a brief PTY resize");
  expect(settingsSource).not.toContain("settingsDropdown('TUI redraw workaround'");
  expect(settingsSource).not.toContain("data-tui-redraw-interval-seconds");
  expect(settingsSource).not.toContain("intervalSeconds: 60");
  expect(script).not.toContain("interval_seconds");
  expect(script).not.toContain("server-active");
  expect(script).not.toContain("server-idle");
  expect(settingsSource).not.toContain("Client refresh");
  expect(settingsSource).not.toContain("Server SIGWINCH");
  expect(settingsSource).not.toContain("save-tui-redraw-settings");
  expect(script).toContain('function syncTuiRedrawController()');
  expect(script).toContain("terminalController?.setPulseEnabled(currentTuiRedrawSettings().workaround === 'on')");
  expect(script).toContain("if (partial && Object.prototype.hasOwnProperty.call(partial, 'daemonSettings')) syncTuiRedrawController()");
  expect(script).toContain("patchState: (partial) => patchClientState(partial)");
  expect(script).toContain("const activeTerminalRole = () => (page === 'agents' && agentsSubView === 'terminal'");
  // WA-065: non-terminal renders detach xterm instead of destroying it, so
  // same-role remount preserves browser-side scrollback beyond the daemon ring.
  expect(script).toContain("function detachXterm()");
  expect(script).toContain("terminalParkingLot().appendChild(termEl)");
  expect(script).toContain("if (activeXterm && activeXtermRole === roleName) detachXterm();");
  // EP-029 T4: legacy reattach guard `if (activeXterm && activeXtermRole === role
  // && el && typeof Terminal === 'function')` was lifted into TerminalController's
  // same-role re-attach branch (controller owns the parking-root pattern). Pin
  // the new delegation shape: mountTerminal calls ensureTerminalController().mount
  // and the controller is constructed with the workspace-prefixed WS URL builder.
  expect(script).toContain('import { TerminalController } from "./terminal-controller.ts";');
  expect(script).toContain("function ensureTerminalController()");
  expect(script).toContain("const controller = ensureTerminalController();");
  expect(script).toContain("controller.mount(role, el, { active, reason: 'mountTerminal' });");
  // EP-029 T4 tombstones (researcher comment 151): the inline xterm wiring
  // — `el.appendChild(activeXterm.element)`, `observeActiveTerminalElement(el)`
  // call inside mountTerminal — moved into TerminalController. Tested at
  // tests/restore-protocol-equivalent paths in tests/daemon.test.ts.
  // EP-029 T4 tombstones: fit/detach guards (`if (!activeXterm || !activeFitAddon
  // || activeXtermDetached) return;`, `if (activeXtermDetached) return;
  // requestAnimationFrame(...)`, `if (!activeXterm || !activeXtermRole ||
  // activeXtermDetached) return;`, the second-rAF tail that pinned
  // fitActiveTerminal calls + WA-127 drain) lifted into
  // TerminalController.observeContainer + scheduleFit. The WA-127 patch
  // surface (initial-fit gate, pending resize/ws-connect drains, visibility-
  // hide window) is gone — restore frame is the canonical pre-state and
  // lands at the correct grid by construction.
  expect(script).toMatch(/function renderOverview\(\) \{\n\s+detachXterm\(\);/);
  expect(script).toMatch(/function renderAgentOverview\(\) \{\n\s+detachXterm\(\);/);
  expect(script).toMatch(/function renderMessages\(opts = \{\}\) \{\n\s+detachXterm\(\);/);
  // EP-029 T4 tombstone: `if (active) terminalCursors[role] = 0;` — the
  // browser-side cursor protocol is gone (mirror-as-source server-side
  // restore frame is canonical pre-state). terminalCursors map deleted.
  // EP-029 T4 tombstone: `activeXterm.onData(data => sendTerminalInput(data,
  // true))` lifted into TerminalController.constructTerminal which wires
  // unconditionally regardless of `active` (preserves WA-108 invariant).
  // The "if (active) activeXterm.onData" anti-pattern stays gone.
  expect(script).not.toContain("if (active) activeXterm.onData");
  // Kanban auto-refresh: scrollTop snapshot+restore so the user isn't bounced
  // to the top of the board / detail / per-cell scrollers every 5 s.
  expect(kanbanSource).toContain("function captureKanbanScroll()");
  expect(kanbanSource).toContain("function restoreKanbanScroll(snapshot)");
  // WA-052: epics-view scroller in the snapshot.
  expect(kanbanSource).toContain("'.kanban-page-epics .kanban-epics-view'");
  expect(kanbanSource).toContain("snapshot.epics = epicsView.scrollTop");
  // WA-183: task and epic detail drawers preserve their own scrollTop across re-render.
  expect(kanbanSource).toContain("const detail = document.querySelector('.kanban-detail');");
  expect(kanbanSource).toContain("if (detail) snapshot.detail = detail.scrollTop;");
  expect(kanbanSource).toContain("if (detail && snapshot.detail) detail.scrollTop = snapshot.detail;");
  expect(kanbanSource).toContain("const epicDrawer = document.querySelector('.kanban-epic-drawer');");
  expect(kanbanSource).toContain("if (epicDrawer) snapshot.epicDrawer = epicDrawer.scrollTop;");
  expect(kanbanSource).toContain("if (epicDrawer && snapshot.epicDrawer) epicDrawer.scrollTop = snapshot.epicDrawer;");
  // WA-047: entering /kanban from non-kanban forces a fresh load.
  expect(kanbanSource).toContain("const wasKanban = getPage() === 'kanban'");
  expect(kanbanSource).toContain("if (!wasKanban) {\n    kanbanLoaded = false;\n    kanbanEpicsLoaded = false;\n  }");
  // WA-047: applyKanbanRoute (deep-link / back-forward) also invalidates.
  expect(kanbanSource.match(/const wasKanban = getPage\(\) === 'kanban'/g)?.length).toBeGreaterThanOrEqual(2);
  expect(kanbanSource.match(/if \(!wasKanban\) \{\n {4}kanbanLoaded = false;\n {4}kanbanEpicsLoaded = false;\n {2}\}/g)?.length).toBeGreaterThanOrEqual(2);
  // WA-049: epics sorted by numeric display_id ASC.
  expect(kanbanSource).toContain("function epicDisplayIdNumeric(id)");
  expect(kanbanSource).toContain("function compareEpicByDisplayId(a, b)");
  expect(kanbanSource).toContain(").sort(compareEpicByDisplayId)");
  // EP-003 WA-013: epic-task card + DAG node both consume the shared
  // renderKanbanCardCore() helper; the per-callsite class is composed at
  // runtime so the literal "kanban-card kanban-epic-issue-card" substring
  // is gone — assert the helper + extraClass wiring instead.
  expect(kanbanSource).toContain("function renderKanbanCardCore");
  expect(kanbanSource).toContain("extraClass: 'kanban-epic-issue-card'");
  // WA-013 also drops the "Assigned to" label everywhere; the meta now
  // carries a `repoLine` (repoName:roleName) above the title instead.
  expect(kanbanSource).not.toContain("class=\"kanban-card-assignee\"");
  expect(kanbanSource).not.toContain("Assigned to ");
  // The DAG node lost its initials/identicon chip — it now mirrors the
  // board card markup.
  expect(kanbanSource).not.toMatch(/function renderKanbanEpicDagSvg[\s\S]{0,800}kanban-epic-issue-avatar/);
  expect(html).toContain(".kanban-epic-issue-card");
  expect(html).toContain(".kanban-card-assignee");
  // WA-050: kanban-detail-head pinned during sidebar scroll.
  expect(html).toContain(".kanban-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px; border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 5; background: var(--surface); }");
  // EP-007 WA-037: epic detail header matches task detail sticky-on-scroll behavior.
  expect(html).toContain(".kanban-epic-drawer-head { display: flex; align-items: flex-start; gap: 10px; margin: -16px -18px 0; padding: 16px 18px 8px; border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 5; background: var(--surface); }");
  // EP-029 T4 tombstones: `const terminalSessions = {}`, `function
  // reconcileSession`, `if (!active) activeXterm.write(normalizeForTerminal
  // (initialText))`, `async function pollTerminal` — all lifted into
  // TerminalController. Mirror-as-source restore frame replaces the
  // session-rollover cursor reset, the inline initial-text write, and
  // the HTTP /output cursor polling fallback. handleTerminalInputRejected
  // shrunk to a thin handleRunnerStatus delegate.
  expect(script).toContain("function handleTerminalInputRejected(role, body)");
  expect(script).not.toContain("input failed: ' + await res.text()");
  expect(script).toContain("const MESSAGE_POLL_MS = 2000");
  expect(script).toContain("const STATUS_POLL_MS = 3000");
  expect(script).not.toContain("const __wsBase =");
  expect(script).toContain("function wsApiUrl(suffix) {");
  expect(script).toContain("state.currentWorkspace?.id");
  expect(script).toContain('import { parseRoute, workspacePath } from "./router.ts";');
  expect(script).not.toContain("function parseRoute(pathname)");
  expect(script).not.toContain("export function parseRoute");
  expect(script).toContain("function routeParts() {\n      return parseRoute(location.pathname);\n    }");
  expect(script).toContain("const pageParts = parts.page");
  // After KANBAN-LIFT the workspacePath(...) tail call lives in kanban.ts's
  // kanbanPathSegments(); main.ts's pathForState only delegates and returns
  // its own ternary form. Assert the kanban form against kanban.ts.
  expect(kanbanSource).toContain("return workspacePath(getState().currentWorkspace?.id ?? null, tail);");
  expect(kanbanSource).toContain("const kanbanParts = parts.page;");
  expect(script).not.toContain("if (parts[0] === 'agents')");
  expect(script).not.toContain("if (routeParts()[0] === 'kanban')");
  expect(script).toContain("let workspaceAbortController = new AbortController();");
  expect(script).toContain("const resetHooks = [];");
  expect(script).toContain("function registerResetHook(fn) {");
  expect(script).toContain("function abortInFlight() {");
  expect(script).toContain("function workspaceFetch(suffix, init = {}) {");
  expect(script).toContain("function workspaceFetchFor(id, suffix, init = {}) {");
  expect(script).toContain("function shouldPollWorkspace() {");
  expect(script).toContain("async function switchWorkspace(id, opts = {}) {");
  expect(script).toContain("await workspaceFetchFor(id, '/status')");
  expect(script).toContain("await fetch(daemonApiUrl('/workspaces/current')");
  expect(script).toContain("if (!shouldPollWorkspace()) { scheduleStatusPoll(); return; }");
  expect(script).toContain("if (!shouldPollWorkspace()) return false;");
  expect(script).toContain("const gen = state.workspaceGeneration;");
  expect(script).toContain("if (gen !== state.workspaceGeneration) return;");
  expect(script).toContain("const next = await workspaceFetch('/status').then(r => r.json());");
  expect(script).toContain("const res = await workspaceFetch('/messages?limit=500');");
  expect(script).not.toContain("const next = await fetch(wsApiUrl('/status')).then(r => r.json());");
  expect(script).not.toContain("const res = await fetch(wsApiUrl('/messages?limit=500'))");
  // Channel + kanban reset are exported from feature modules and called from main.ts.
  expect(messagesSource).toContain("channelMessages = [];");
  expect(messagesSource).toContain("export function resetChannel()");
  expect(script).toContain("registerResetHook(() => resetKanban())");
  expect(kanbanSource).toContain("export function resetKanban()");
  expect(kanbanSource).toContain("kanbanTasks = [];");
  expect(messagesSource).toContain("const body = await workspaceFetch('/channel/messages?limit=500').then(r => r.json());");
  expect(messagesSource).toContain("const res = await workspaceFetch('/channel/messages', { method: 'POST'");
  expect(kanbanSource).toContain("const res = await workspaceFetch('/kanban/tasks?' + params.toString());");
  expect(kanbanSource).toContain("const res = await workspaceFetch('/kanban/tasks/' + encodeURIComponent(taskId));");
  expect(script).not.toContain("fetch(wsApiUrl('/channel/messages?limit=500'))");
  expect(script).not.toContain("fetch(wsApiUrl('/kanban/tasks?') + params.toString())");
  // Notification helpers moved to notifications.ts (WC-NOTIFICATIONS).
  expect(notificationsSource).toContain("function activeWsIdForKeys() {");
  expect(notificationsSource).toContain("function notificationLogKey(id = activeWsIdForKeys()) {");
  expect(notificationsSource).toContain("function notificationLeaderKey(id = activeWsIdForKeys()) {");
  expect(notificationsSource).toContain("c.registerResetHook((targetId) => {");
  // scheduleMessagePoll computes its own backoff-aware delay when no
  // explicit delay is passed (audit polling visibility/backoff).
  expect(script).toContain("function scheduleMessagePoll(delay)");
  expect(script).toContain("if (document.hidden) { scheduleMessagePoll(); return; }");
  expect(script).toContain("function hiddenNotificationPollingEnabled()");
  expect(script).toContain("if (document.hidden && !hiddenNotificationPollingEnabled()) { scheduleStatusPoll(); return; }");
  expect(script).toContain("document.addEventListener('visibilitychange'");
  expect(script).toContain("await loadMessages({ rerender: true, silent: true, onlyIfChanged: true })");
  expect(script).toContain("scheduleMessagePoll(500)");
  expect(script).toContain("function renderInitialUiAfterExtensions");
  expect(script).not.toContain("applyRouteFromLocation();\n    render();\n    scheduleMessagePoll(500)");
  expect(script).toContain("function enableNotifications()");
  expect(script).toContain("new Notification(title, opts)");
  expect(script).toContain("function notifyNewMessages(newMessages)");
  expect(script).toContain("function notifyRunnerExits(nextRunners, previousRunners)");
  expect(notificationsSource).toContain("whatsagent.notification.preferences");
  expect(notificationsSource).toContain("test-notification");
  expect(notificationsSource).toContain("approvalWaiting");
  expect(script).not.toContain("terminal_bell");
  expect(script).not.toContain("terminalBell");
  expect(script).not.toContain("Terminal bell");
  expect(notificationsSource).toContain("launchV2");
  expect(script).toContain("scheduleStatusPoll(1000)");
  expect(html).toContain("id=\"notificationBtn\"");
  expect(html).toContain("id=\"topLaunchBtn\"");
  // Post-EP-011/012 tombstones: mobile navigation and drawer shells no longer
  // use the retired topbar, fixed 360px drawer, or page-title status controls.
  expectAbsent(html, [
    "id=\"refreshBtn\"",
    "<header class=\"topbar\">",
    "class=\"app-topbar\"",
    "width: min(360px, calc(100vw - 24px))",
    ".shell { width: calc(100% - 64px)",
    "id=\"pageTitle\"",
    "id=\"pageSub\"",
    "<span class=\"status-pill\"",
  ]);
  // EP-011 WA-046: mobile shell hides the sidebar until the first tabbar item
  // opens the drawer.
  expect(html).toContain("data-action=\"toggle-mobile-sidebar\"");
  expect(html).toContain("class=\"mobile-sidebar-backdrop\" data-action=\"close-mobile-sidebar\"");
  expect(html).toContain("<aside class=\"sidebar\" id=\"appSidebar\">");
  expect(html).toContain("@media (max-width: 760px) {\n      .app { flex-direction: row; min-height: 100dvh; }");
  expect(html).toContain(".mobile-sidebar-tab { display: inline-flex;");
  expect(html).toContain(".sidebar { position: fixed; inset: 0 auto 0 0; z-index: 910; width: 100vw; max-width: 100vw; transform: translateX(-102%); overflow-y: auto;");
  expect(html).toContain("transition: transform .18s ease; box-shadow: none;");
  expect(html).toContain(":root[data-mobile-sidebar=\"open\"] .sidebar { transform: translateX(0); }");
  expect(html).toContain(":root[data-mobile-sidebar=\"open\"] .brand { justify-content: flex-start;");
  expect(html).toContain(":root[data-mobile-sidebar=\"open\"] .brand-text");
  expect(html).toContain(":root[data-sidebar=\"collapsed\"] .workspace-menu { left: calc(100% + 8px); right: auto; top: 0; width: 230px; }");
  expect(html).toContain(":root[data-mobile-sidebar=\"open\"] .workspace-switcher { display: block; margin: 8px 10px; }");
  expect(html).toContain(":root[data-mobile-sidebar=\"open\"] .workspace-switcher-trigger { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto;");
  expect(html).toContain(":root[data-mobile-sidebar=\"open\"] .workspace-menu { left: 0; right: 0; top: calc(100% + 6px); width: auto; }");
  expect(html).toContain(":root[data-mobile-sidebar=\"open\"][data-sidebar=\"collapsed\"] .nav a { justify-content: flex-start;");
  expect(html).toContain(":root[data-mobile-sidebar=\"open\"][data-sidebar=\"collapsed\"] .sidebar-action { justify-content: flex-start;");
  expect(html).toContain(".shell { width: 100%; min-width: 0; min-height: 0; flex: 1 1 auto; }");
  expectAbsent(html, ["class=\"brand-sub\"", ".brand-sub {", "agent dashboard"]);
  expect(html).toContain(".brand-title { font-size: 13px; font-weight: 800; letter-spacing: -0.01em; font-family: 'Epilogue', 'Plus Jakarta Sans', sans-serif;");
  expect(html).toContain("background-image: linear-gradient(135deg, var(--text-strong) 0%, var(--accent) 60%, var(--accent-dark) 100%); background-clip: text; -webkit-background-clip: text; color: transparent; -webkit-text-fill-color: transparent; }");
  expect(html).toContain("[data-theme=\"dark\"] .brand-title { background-image: linear-gradient(135deg, #f0f6ff 30%, var(--accent) 100%); }");
  expect(html).toContain("@media (prefers-color-scheme: dark) { :root[data-theme=\"auto\"] .brand-title { background-image: linear-gradient(135deg, #f0f6ff 30%, var(--accent) 100%); } }");
  expect(script).toContain("let mobileSidebarOpen = false;");
  expect(script).toContain("function setMobileSidebarOpen(open)");
  expect(script).toContain("function mobileSidebarTab()");
  expect(script).toContain("class=\"term-tab mobile-sidebar-tab\" data-action=\"toggle-mobile-sidebar\"");
  expect(script).toContain("if (!window.matchMedia('(max-width: 760px)').matches)");
  expect(script).toContain("rootSelector: '.sidebar'");
  expect(script).toContain("action === 'toggle-mobile-sidebar'");
  expect(script).toContain("action === 'close-mobile-sidebar'");
  expect(script).toContain("document.querySelectorAll('.nav [data-page]')");
  expect(script).toContain("if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;");
  expect(script).toContain("event.preventDefault();");
  expectAbsent(script, ["$('pageTitle').textContent", "$('pageSub').textContent", "$('refreshBtn').addEventListener"]);
  expect(html).toContain("class=\"sidebar-actions\"");
  expect(html).toContain("class=\"sidebar-action primary\"");
  expect(html).toContain("class=\"sidebar-action-label\"");
  expect(html).toContain("notification-icon-muted");
  expect(html).toContain("#notificationBtn[data-notification-state=\"off\"] .notification-icon-muted { display: block; }");
  expect(html).toContain(":root[data-sidebar=\"collapsed\"] .sidebar-action-label { display: none; }");
  expect(html).toContain("data-theme=\"auto\"");
  expect(script).toContain("replace(/\\s+/g, ' ')");
  // EP-007 WA-023 tombstones: old aggregate counters were replaced by the
  // Slack-style per-arrival marker and nav unread pill.
  expectAbsent(script, ["navMessageCount", "pendingMessageCount"]);
  // EP-007 WA-027: sidebar nav entries are href-backed anchors, not buttons.
  expect(html).toContain("<a href=\"/workspaces\" data-page=\"workspaces-overview\"");
  expect(html).toContain("data-page=\"agents\" class=\"active\"");
  expectAbsent(html, ["<button data-page=\"agents\""]);
  expect(html).toContain(".nav a { position: relative;");
  expect(shellOverridesSource).toContain(":root[data-sidebar=\"collapsed\"] .nav a");
  // EP-007 WA-023: Messages nav gets a Slack-style unread pill for DM + Channel arrivals.
  expect(html).toContain("id=\"navMessageIndicator\" hidden");
  expect(html).toContain(".nav-message-indicator");
  expect(script).toContain("let navMessageUnreadCount = 0;");
  expect(script).toContain("function noteNavMessages(count)");
  expect(script).toContain("noteNavMessages(unreadDirectMessages(newMessages));");
  expect(script).toContain("if (page === 'messages') navMessageUnreadCount = 0;");
  expect(script).toContain("let dmNewMarker = { threadKey: '', markerId: 0, count: 0 };");
  expect(script).toContain("function markDmNewMarker(newMessages, wasNearBottom)");
  expect(script).toContain("data-action=\"messages-jump-to-marker\"");
  expect(script).toContain("marker.scrollIntoView({ behavior: 'smooth', block: 'start' })");
  expect(script).toContain("data-message-id=\"' + esc(message.id || '') + '\"");
  expect(messagesSource).toContain("function incomingChannelMessageCount(items)");
  expect(messagesSource).toContain("let channelNewMarker = { markerId: 0, count: 0 };");
  expect(messagesSource).toContain("function markChannelNewMarker(items, wasNearBottom)");
  expect(messagesSource).toContain("data-action=\"channel-jump-to-marker\"");
  expect(messagesSource).toContain("const newMessages = next.filter(message => (Number(message.id) || 0) > previousMaxId);");
  expect(messagesSource).toContain("markChannelNewMarker(newMessages, wasNearBottomBeforeLoad);");
  expect(html).toContain(".messages-new-marker-pill");
  expect(script).toContain("body: JSON.stringify({ toRole: roleDisplayId(selected), body })");
  expect(script).toContain("data-action=\"send-message\"");
  // Broadcast + Channel + Composer content moved to messages.ts (WC-MESSAGES-CHANNEL).
  expect(messagesSource).toContain("data-action=\"send-broadcast\"");
  expect(html).toContain("id=\"topBroadcastBtn\"");
  expect(html).toContain("id=\"broadcastModal\"");
  expect(html).toContain("id=\"broadcastBody\"");
  expect(html).toContain("id=\"sendBroadcastBtn\"");
  expect(messagesSource).toContain("workspaceFetch('/messages/broadcast'");
  expect(messagesSource).toContain("function broadcastPolicyMode()");
  expect(messagesSource).toContain("mode === 'star' || mode === 'peer-to-peer'");
  expect(messagesSource).toContain("function openBroadcastDialog()");
  expect(messagesSource).toContain("function sendHeaderBroadcast()");
  // EP-007 WA-024: broadcast remains visible for allowed policies but disables with tooltip when nobody is online.
  expect(messagesSource).toContain("function broadcastAvailability()");
  expect(messagesSource).toContain("enabled: policyEnabled && onlineCount > 0");
  expect(messagesSource).toContain("Launch at least one agent to broadcast.");
  expect(messagesSource).toContain("button.disabled = !availability.enabled");
  expect(messagesSource).toContain("existing.disabled = !availability.enabled");
  expect(messagesSource).toContain("if (!broadcastAvailability().enabled) return;");
  expect(messagesSource).toContain("renderSettingsWithBroadcastUi");
  expect(messagesSource).toContain("topBroadcastBtn')?.addEventListener('click'");
  expect(html).toContain(".broadcast-modal textarea");
  expect(script).toContain("message.delivery_kind === 'broadcast'");
  expect(messagesSource).toContain("function renderChannelMessages");
  expect(messagesSource).toContain("workspaceFetch('/channel/messages?limit=500')");
  expect(messagesSource).toContain("data-action=\"send-channel-message\"");
  expect(messagesSource).toContain("data-action=\"toggle-channel-export\"");
  expect(messagesSource).toContain("data-action=\"export-channel\"");
  expect(messagesSource).toContain("data-format=\"markdown\"");
  expect(messagesSource).toContain("data-format=\"text\"");
  expect(messagesSource).toContain("data-format=\"json\"");
  // WA-039: renderSafeMarkdown lives in main.ts; messages.ts proxies via ctx.
  expect(script).toContain("function renderSafeMarkdown(value)");
  expect(script).toContain("renderSafeMarkdownHtml(value, esc)");
  expect(markdownSource).toContain("export function renderMarkdownInline(value, esc)");
  expect(messagesSource).toContain("function renderSafeMarkdown(value) { return ctx().renderSafeMarkdown(value); }");
  expect(kanbanSource).toContain("function renderSafeMarkdown(value) { return ctx().renderSafeMarkdown(value); }");
  // WA-039: direct-message bubble renders markdown via bubble-body wrapper, sans-serif body.
  expect(script).toContain("<div class=\"bubble-body markdown-body\">' + renderSafeMarkdown(message.body) + '</div>");
  expect(html).toContain(".bubble-body");
  expect(html).toContain(".bubble-body p { margin: 0 0 8px; }");
  expect(html).toContain(".bubble-body code");
  expect(html).toContain(".bubble-body pre");
  expect(html).toContain("font-family: var(--font-ui); font-size: 13px; line-height: 1.5;");
  expect(html).not.toContain("font-family: var(--font-mono); font-size: 13px; line-height: 1.45; white-space: pre-wrap;");
  // WA-040: light-mode legibility for rejected bubble + send-error.
  expect(html).toContain(".bubble.rejected .bubble-meta { color: var(--red-text); }");
  expect(html).not.toContain(".bubble.rejected .bubble-meta { color: var(--red-text); opacity: .8; }");
  expect(html).toContain(".bubble.mine.rejected { color: var(--red-text); }");
  expect(html).toContain(".send-error { padding: 10px 14px; margin: 0 16px 12px; color: var(--red-text); font-size: 12px; background: var(--red-soft-bg); border: 1px solid var(--red-soft-border); border-radius: 8px; }");
  expect(html).toContain(".bubble.rejected .bubble-body code, .bubble.mine.rejected .bubble-body code");
  expect(html).toContain(".bubble.rejected .bubble-body pre, .bubble.mine.rejected .bubble-body pre");
  // WA-040 dark/auto specificity bump so rejected own-message meta does not stay accent.
  expect(html).toContain(":root[data-theme=\"dark\"] .messages-page .bubble.mine.rejected .bubble-meta");
  expect(html).toContain(":root[data-theme=\"auto\"] .messages-page .bubble.mine.rejected .bubble-meta");
  expect(markdownSource).toContain("rel=\"noopener noreferrer\"");
  expect(messagesSource).toContain("function downloadChannelTranscript(format)");
  expect(messagesSource).toContain("async function exportChannelTranscript(format)");
  expect(messagesSource).toContain("await callLoadMessages({ rerender: false, silent: true })");
  expect(messagesSource).toContain("whatsagent-channel-shared-");
  expect(messagesSource).toContain("channel-head-actions");
  expect(messagesSource).toContain("channel-message-row");
  expect(messagesSource).toContain("activeChannelThreadRootId");
  expect(messagesSource).toContain("function channelRootMessages()");
  expect(messagesSource).toContain("rootMessages.map(renderChannelMessageRow)");
  expect(messagesSource).toContain("data-action=\"channel-reply\"");
  expect(messagesSource).toContain("data-action=\"open-channel-thread\"");
  expect(messagesSource).toContain("data-action=\"send-channel-thread-message\"");
  expect(messagesSource).toContain("channel-thread-sidebar");
  expect(messagesSource).toContain("parentMessageId");
  expect(messagesSource).toContain("function sendWebChannelThreadMessage");
  expect(messagesSource).toContain("body: JSON.stringify({ body })");
  expect(messagesSource).toContain("body: JSON.stringify({ body, parentMessageId: parentId })");
  expect(messagesSource).toContain("setTimeout(() => $('channelThreadCompose')?.focus(), 0)");
  // Post-channel-thread rewrite tombstones: keep replies/thread UI on the
  // sidebar row model, not the old drawer/pill/bubble markup.
  expectAbsent(script, ["channelReplyTargetId", "channel-reply-pill", "channel-thread-sidebar empty", "channel-thread-drawer", "channel-bubble"]);
  expect(html).toContain(".channel-head-actions");
  expect(html).toContain(".channel-message-row");
  expect(html).toContain(".channel-thread-sidebar");
  expect(html).toContain(".messages-page.channel-mode.thread-open { grid-template-columns: minmax(0, 1fr) var(--channel-thread-width");
  expectAbsent(html, [".channel-thread-drawer", ".channel-reply-pill", ".channel-parent-snippet"]);
  expect(html).toContain(".agent-tab-dot.offline { background: #9ca3af; }");
  expect(html).toContain(".avatar-presence-dot.offline { background: #9ca3af; }");
  expect(html).toContain(".agent-avatar-presence");
  expect(messagesSource).toContain("let shouldRender = Boolean(opts.rerender)");
  expect(messagesSource).toContain("function restoreChannelComposeState");
  expect(messagesSource).toContain("input.setSelectionRange(composeState.selectionStart, composeState.selectionEnd)");
  expect(script).toContain("whatsagent.messageComposer.height");
  expect(script).toContain("whatsagent.channelThread.width");
  expect(script).toContain("function renderMessageComposer(opts = {})");
  expect(messagesSource).toContain("data-action=\"resize-message-composer\"");
  expect(messagesSource).toContain("data-action=\"resize-channel-thread\"");
  expect(messagesSource).toContain("Enter sends. Shift+Enter adds a line.");
  expect(messagesSource).toContain("target?.matches?.('#messageCompose, #channelThreadCompose')");
  expect(messagesSource).toContain("channelThreadComposeCounter");
  // WA-038: per-thread composer drafts (in-memory Map; no localStorage).
  expect(messagesSource).toContain("const composerDrafts = new Map()");
  expect(messagesSource).toContain("function directDraftKey()");
  expect(messagesSource).toContain("function channelRootDraftKey()");
  expect(messagesSource).toContain("function channelThreadDraftKey(rootId)");
  expect(messagesSource).toContain("function rememberComposerDraft(input)");
  expect(messagesSource).toContain("function populateDirectDraft()");
  expect(messagesSource).toContain("function populateChannelRootDraft()");
  expect(messagesSource).toContain("function populateChannelThreadDraft()");
  expect(messagesSource).toContain("'direct:' + thread + ':' + peer");
  expect(messagesSource).toContain("'channel:thread:' + id");
  expect(messagesSource).toContain("composerDrafts.delete(draftKey)");
  expect(messagesSource).toContain("composerDrafts.set(draftKey, value)");
  // WA-038/043 tombstones: draft and scroll state stays in memory maps so
  // workspace switches clear it and thread scroll is preserved per root.
  expectAbsent(messagesSource, ["localStorage.setItem('whatsagent.composer.draft"]);
  // WA-038: drafts cleared via reset hook (workspace switch).
  expect(messagesSource).toContain("resetComposerDrafts()");
  // WA-042: own channel send only snaps to bottom when user was near bottom.
  expect(messagesSource).toContain("function channelRootNearBottom()");
  expectAbsent(messagesSource, ["function channelThreadNearBottom"]);
  expect(messagesSource).toContain("const nearBottom = channelRootNearBottom();");
  expect(messagesSource).toContain("scrollMode: nearBottom ? 'bottom' : 'preserve', wasNearBottom: nearBottom");
  expect(messagesSource).toContain("const previousRootScrollTop = previousRootBody ? previousRootBody.scrollTop : 0;");
  expect(messagesSource).toContain("if (scrollMode !== 'bottom' && !wasNearBottomFlag && previousRootScrollTop)");
  // WA-043: thread sidebar scroll preserved per-root with snap-to-bottom when
  // the user was already near bottom in the same thread.
  expect(messagesSource).toContain("const channelThreadScrollByRoot = new Map()");
  expect(messagesSource).toContain("function channelSidebarBody()");
  expect(messagesSource).toContain("function channelSidebarNearBottom(el)");
  expect(messagesSource).toContain("channelThreadScrollByRoot.set(previousSidebarRootId, previousSidebarScrollTop)");
  expect(messagesSource).toContain("channelThreadScrollByRoot.get(currentSidebarRootId)");
  expect(messagesSource).toContain("channelThreadScrollByRoot.clear()");
  // WA-044: scroll preservation sweep — overview, agents overview, workspaces overview.
  expect(script).toContain("const previousOverviewScroll = document.querySelector('.overview-page')?.scrollTop || 0");
  expect(script).toContain("if (previousOverviewScroll) requestAnimationFrame(() =>");
  expect(agentsSource).toContain("const previousAgentScroll = document.querySelector('.agent-list-overview')?.scrollTop || 0");
  expect(agentsSource).toContain("if (previousAgentScroll) requestAnimationFrame(() =>");
  expect(script).toContain("const previousWorkspacesScroll = document.querySelector('.workspaces-overview-page .agent-overview')?.scrollTop || 0");
  // WA-038 fix: thread draft key derived from DOM send-button data-parent-id,
  // not the activeChannelThreadRootId global, so the OLD textarea is captured
  // with its OLD root id even after the click handler advanced the global.
  expect(messagesSource).toContain("function activeChannelThreadComposerRootId()");
  expect(messagesSource).toContain("[data-action=\"send-channel-thread-message\"]");
  expect(messagesSource).toContain("rootId: activeChannelThreadComposerRootId()");
  expectAbsent(messagesSource, ["rootId: activeChannelThreadRootId,"]);
  expect(script).toContain("function sendIconSvg()");
  expect(messagesSource).toContain("iconOnly: true");
  expect(html).toContain(".message-composer-box");
  expect(html).toContain(".message-composer-send-icon");
  expect(html).toContain(".channel-thread-sidebar-resize");
  expect(html).toContain(".channel-thread-sidebar .message-composer-resize { left: 10px; }");
  // Channel-mode subhead copy was dropped along with adding a `#shared`
  // tab in the empty tabbar (was leaving a 46px gap above the channel
  // head). The placeholder tab is the new structural pin.
  expect(messagesSource).toContain("term-tab active\" role=\"tab\" aria-selected=\"true\">#shared");
  expect(messagesSource).not.toContain("Direct-message history is hidden");
  expect(html).toContain(".messages-page.channel-mode");
  expect(script).toContain("function peersForInbox(inboxRoleName)");
  expect(script).toContain("function messagesForPeerThread(inboxRoleName, peerId)");
  expect(script).toContain("function humanWebThreadMessage(message, inboxRoleName)");
  expect(script).toContain("message.to_role_name === inboxRoleName && (!message.from_role_name || message.from_role_name === HUMAN_PEER)");
  expect(script).toContain("message.from_role_name === inboxRoleName && message.to_role_name === HUMAN_PEER");
  expect(script).toContain("message.to_role_name !== HUMAN_PEER && (!message.from_role_name || message.from_role_name === HUMAN_PEER || message.from_role_name === selectedRoleName)");
  expect(script).toContain("data-action=\"select-peer\"");
  // EP-005 WA-017/019: mobile messages become list/detail, with direct
  // thread back action and scrollable mobile timelines.
  expect(script).toContain("let mobileMessagesView = 'list';");
  expect(script).toContain("mobile-messages-' + esc(mobileMessagesView)");
  expect(script).toContain("data-action=\"messages-mobile-back\"");
  expect(script).toContain("mobileMessagesView = 'thread'");
  expect(script).toContain("action === 'messages-mobile-back'");
  expect(html).toContain(".messages-page.mobile-messages-list .thread-panel { display: none; }");
  expect(html).toContain(".messages-page.mobile-messages-thread .conversation-list { display: none; }");
  expect(html).toContain(".messages-page.mobile-messages-list .conversation-list { flex: 1 1 auto; width: 100%; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }");
  expect(html).toContain(".messages-page .thread-body, .messages-page .channel-thread, .channel-thread-sidebar-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }");
  expect(html).toContain(".messages-page.channel-mode.thread-open .channel-panel { display: none; }");
  expect(script).toContain("function renderMessageBubble(message, selectedRoleDisplayId)");
  expect(script).toContain("function roleAvatarGrid(roleOrName, size = 48)");
  expect(script).toContain("function roleAvatarWithPresence(roleOrName, size = 32)");
  expect(script).toContain("function messagePeerAvatar(peerId, size = 32)");
  expect(script).toContain("messagePeerAvatar(role.name, 18)");
  expect(script).toContain("messagePeerAvatar(peer.id, 36)");
  expect(script).toContain("messagePeerAvatar(selectedPeer || selected?.name || '', 32)");
  expect(script).toContain("message-bubble-row");
  expect(script).toContain("function messageReceiptState(message)");
  expect(messagesSource).toContain("return messagePeerAvatar(sender, 32)");
  expect(script).not.toContain("peerIcon(peerHost(peer.id), 36)");
  expect(script).toContain("function renderExitCard(role, runner)");
  expect(script).toContain("stripAnsi(runner?.output_tail || '').trimEnd()");
  expect(script).toContain("Launch ' + esc(roleName) + ' again");
  expect(script).toContain("const mountedController = !exitCard ? mountTerminal(roleName, body, Boolean(runner)) : null;");
  expect(script).not.toContain("Last terminal output:");
  expect(script).not.toContain("No terminal output tail was captured.");
  // EP-029 T4 tombstone: WA-109 EXITED_TERMINAL_REPLAY_PREFIX deleted —
  // server-side mirror snapshot already preserves alt-screen state via
  // SerializeAddon; the restore frame writes the snapshot atomically so
  // no client-side `\x1b[?1049l` prefix is needed.
  expect(script).toContain("const PREF_STORAGE_KEY = 'whatsagent.ui.preferences'");
  expect(script).toContain("function applyPreferences()");
  expect(script).toContain("data-action=\"set-pref\"");
  expect(script).toContain("uiPrefsVersion: 2");
  expect(script).toContain("terminalFontSize: 12");
  expect(script).toContain("terminalLineHeight: 1");
  expect(script).toContain("Number(source.terminalLineHeight) === 1.05");
  expect(script).toContain("numberInRange(source.terminalLineHeight, 1, 1.25");
  // EP-029 T4: xterm Terminal options moved into TerminalController.
  // constructTerminal — pin against controllerSource.
  expect(controllerSource).toContain("customGlyphs: true");
  expect(controllerSource).toContain("letterSpacing: 0");
  expect(controllerSource).toContain("overviewRuler: { width: 1 }");
  expect(controllerSource).toContain("fontFamily: FALLBACK_FONT_FAMILY");
  expect(script).toContain("compact: { fallbackLineHeight: 1.25, xtermPadding: '0'");
  // WA-045: line-height pref uses dedicated lineHeightControl helper with numeric value + preview swatch.
  expect(script).toContain("function lineHeightOptionButtons()");
  expect(script).toContain("function lineHeightControl()");
  expect(script).toContain("[[1, 'Minimum'], [1.04, 'Relaxed'], [1.08, 'Roomy']]");
  expect(script).toContain("class=\"line-height-option-preview\"");
  expect(script).toContain("Number(value).toFixed(2)");
  // WA-053: 3-row preview with ascender+descender text so 1.00 vs 1.04 vs 1.08 is visible.
  expect(script).toContain("Wgqyj<br>Mgqj<br>Wgqyj");
  expect(script).not.toContain(">Aa<br>Aa<");
  // WA-054: priority colour code on task cards (P0 red, P1 amber/orange, P2 yellow, P3 green).
  expect(html).toContain("--yellow: #eab308;");
  expect(html).toContain(".kanban-card.priority-p2 { border-left-color: var(--yellow); }");
  expect(html).toContain(".kanban-card.priority-p3 { border-left-color: var(--green); }");
  expect(html).toContain(".kanban-epic-issue.priority-p2 { border-left-color: var(--yellow); }");
  expect(html).toContain(".kanban-epic-issue.priority-p3 { border-left-color: var(--green); }");
  expect(html).toContain(".kanban-epic-dag-node.priority-p2 .kanban-epic-dag-card { border-left: 3px solid var(--yellow); }");
  // WA-056: epic + task status pills tracking --kanban-status-accent.
  expect(html).toContain(".kanban-pill.kanban-status-backlog");
  expect(html).toContain(".kanban-pill.kanban-status-completed { background:");
  expect(html).toContain("color: var(--kanban-status-accent);");
  // EP-027 / WA-121: effort pills render T-shirt bucket classes and use M fallback.
  expect(kanbanSource).toContain("import { KANBAN_EFFORTS } from \"../../kanban-effort.ts\";");
  expect(kanbanSource).toContain("function effortPillClass(value)");
  expect(kanbanSource).toContain("function renderEffortPill(value, fallback = '')");
  expect(kanbanSource).toContain("renderEffortPill(task.effort, 'M')");
  expect(kanbanSource).toContain("renderEffortPill(epic.effort, 'M')");
  expect(kanbanSource).toContain("renderEffortPill(task.effort)");
  expect(kanbanSource).not.toContain("task.effort || 'Medium'");
  expect(kanbanSource).not.toContain("epic.effort || 'Medium'");
  for (const bucket of ["xs", "s", "m", "l", "xl"]) {
    expect(html).toContain(`.kanban-pill.effort-${bucket}`);
  }
  // WA-055: cross-epic popup hover bridge + topmost z-index + above-flip variant.
  expect(html).toContain("z-index: 100");
  expect(html).toContain(".kanban-epic-dag-external-popup::before");
  expect(html).toContain(".kanban-epic-dag-external[data-popup-side=\"above\"] + .kanban-epic-dag-external-popup");
  expect(kanbanSource).toContain("const popupAbove = totalH > 0 && pos.y > totalH * 0.6");
  expect(kanbanSource).toContain("data-popup-side=\"above\"");
  // WA-055: split inward (left) and outward (right) markers.
  expect(kanbanSource).toContain("kanban-epic-dag-external inward");
  expect(kanbanSource).toContain("aria-label=\"Cross-epic dependencies (inward)\">←");
  expect(kanbanSource).toContain("aria-label=\"Cross-epic dependants (outward)\">→");
  expect(html).toContain(".kanban-epic-dag-external.inward { right: auto; left: -10px; }");
  // WA-048: explicit grid placement so tabbar spans full width with drawer open.
  expect(html).toContain(".kanban-page.detail-open .kanban-tabbar { grid-column: 1 / -1; grid-row: 1; }");
  expect(html).toContain(".kanban-page.detail-open .kanban-main { grid-column: 1; grid-row: 2;");
  expect(html).toContain(".kanban-page.detail-open .kanban-detail { grid-column: 2; grid-row: 2; }");
  expect(html).toContain(".line-height-option-preview");
  expect(html).toContain(".tui-display-popover .line-height-option");
  expect(script).toContain("setPreferenceWithTerminalRefresh");
  // WA-163: live-apply terminal display preferences. The orphan
  // `activeXterm.options.fontSize = ...` block in
  // installLiveTerminalPreferenceRefresh was a no-op post EP-029 T4-d
  // (`activeXterm` always null). Replaced with
  // `terminalController?.applyDisplayPreferences()`. Pin both: the
  // wrapper no longer references `activeXterm`, and the controller
  // exposes `applyDisplayPreferences`.
  const liveRefreshSlice = script.slice(script.indexOf("installLiveTerminalPreferenceRefresh"), script.indexOf("installLiveTerminalPreferenceRefresh") + 1500);
  expect(liveRefreshSlice).not.toContain("activeXterm");
  expect(liveRefreshSlice).toContain("terminalController?.applyDisplayPreferences()");
  expect(controllerSource).toContain("applyDisplayPreferences(): void");
  expect(script).not.toContain("applies on the next terminal mount");
  // EP-029 T4 tombstone: live `activeXterm.options.lineHeight =
  // terminalLineHeight()` mutation no longer fires (controller owns
  // xterm). WA-163 plumbs a pref-change hook through
  // `applyDisplayPreferences()`; the legacy orphan still stays gone.
  // Pin retained as a tombstone string so search for it surfaces
  // this comment.
  expect(html).toContain("--terminal-line-height: 1");
  expect(html).toContain("--terminal-xterm-padding: 0");
  expect(html).toContain("--terminal-font-family: ui-monospace");
  expect(html).toContain(".terminal-body .xterm { font-family: var(--terminal-font-family); line-height: 1; }");
  // EP-029 T4: EP-005 WA-020 mobile touch-scroll handler moved into
  // TerminalController.installTouchScroll. Pin against controllerSource.
  expect(controllerSource).toContain("function installTouchScroll(");
  expect(controllerSource).toContain("term.scrollLines!(-lines)");
  expect(html).toContain(".terminal-body, .terminal-body .xterm-screen, .terminal-body .xterm-viewport { touch-action: pan-y; overscroll-behavior: contain; }");
  expect(html).not.toContain(".terminal-body .xterm-rows > div");
  // WA-119: OpenCode enables xterm mouse tracking; do not install a local
  // wheel workaround that swallows events xterm should forward to the PTY.
  // EP-029 T4: activeTerminalWheelCleanup state var deleted alongside
  // controller extraction; the no-custom-wheel-handler invariant stays.
  expect(script).not.toContain("installOpenCodeWheelScroll");
  expect(script).not.toContain("target.addEventListener('wheel', onWheel");
  expect(controllerSource).not.toContain("installOpenCodeWheelScroll");
  // WA-071: browser link affordances add no value in TUIs and can steal
  // pointer events from OpenCode's xterm screen layer. Keep both the
  // optional web-links addon and xterm's built-in hyperlink activation
  // path disabled. EP-029 T4: linkHandler: null moved into controller.
  expect(html).not.toContain("xterm-addon-web-links");
  expect(script).not.toContain("WebLinksAddon");
  expect(controllerSource).toContain("linkHandler: null,");
  expect(html).toContain(".terminal .xterm-link-layer { pointer-events: none; }");
  // WA-066: xterm distortion repro tooling is query-gated and default-off.
  expect(script).toContain("terminalDebugParams.get('debug') === 'xterm'");
  expect(script).toContain("xtermWebgl");
  expect(script).toContain("xtermGpuLayer");
  expect(script).toContain("window.__whatsagentXtermDebug");
  expect(script).toContain("function terminalDebugSnapshot()");
  expect(script).toContain("function updateTerminalDebugOverlay()");
  // EP-029 T4 tombstones: terminalDebugSnapshot's buffer-top/bottom/baseY
  // computation reads activeXterm.buffer.active directly. Under T4 the
  // controller owns xterm; debug overlay reads `controller.getStats()`.
  // T4 follow-up plumbs buffer telemetry through getStats; for now the
  // overlay shows null for buffer fields (still informative for the
  // non-buffer fields like renderer + cursor).
  // EP-029 T4 tombstone: terminalDebugStats.wsEventsReceived increment
  // was inside connectTerminalWs (deleted). Counter declaration
  // (`wsEventsReceived: 0`) still in the terminalDebugStats literal so
  // the overlay can read zero. Controller emits its own ws-* debug
  // events directly via terminalDebugLog.
  expect(script).toContain("wsEventsReceived: 0");
  expect(controllerSource).toContain("WebglAddon?.WebglAddon");
  expect(html).toContain(':root[data-xterm-gpu-layer="off"] .terminal-body .xterm { will-change: auto; transform: none; }');
  expect(html).toContain(".terminal-debug-overlay");
  // EP-029 T4: mountTerminal body shrunk to a controller delegate; the
  // terminalHostFor-before-mountTerminal ordering invariant still holds.
  expect(script.indexOf("function terminalHostFor(roleName)")).toBeLessThan(script.indexOf("function mountTerminal(role, initialText, active)"));
  expect(script).toContain("accentColor: 'indigo'");
  expect(script).toContain("['indigo', 'violet', 'blue', 'teal', 'rose', 'amber']");
  expect(script).toContain("function accentPalette()");
  expect(script).toContain("['teal', 'Teal']");
  expect(script).not.toContain("['green', 'Green']");
  expect(script).toContain("prefControl('accentColor'");
  expect(script).toContain("function whatsAgentIconAccent");
  expect(script).toContain("function updateAccentIconAssets()");
  expect(script).toContain("brandIcon.src = whatsAgentIconPath(accent, 32)");
  expect(script).toContain("favicon.href = whatsAgentIconPath(accent, 16)");
  expect(script).toContain("};\n    updateAccentIconAssets();\n\n    function renderSafeMarkdown");
  expect(html).toContain('id="favicon" rel="icon" type="image/png" sizes="16x16" href="/assets/icons/whatsagent-indigo-16.png"');
  expect(html).toContain('id="brandIcon" src="/assets/icons/whatsagent-indigo-32.png"');
  expect(html).toContain('/assets/icons/whatsagent-indigo-64.png 2x');
  expect(html).not.toContain("whatsagent-green");
  expect(html).toContain(".btn:not(.danger):not(:disabled):focus-visible");
  expect(html).toContain(".btn.secondary:not(.danger):not(:disabled):hover");
  expect(html).toContain(".sidebar-action:not(.primary):not(:disabled):hover");
  expect(html).toContain(".launch-menu button:not(:disabled):not(.active):hover");
  expect(html).toContain(".settings-dropdown-trigger:not(:disabled):hover");
  expect(html).toContain(".runtime-default-choice:not(.active):not(:disabled):hover");
  expect(html).toContain("color-mix(in srgb, var(--accent) 18%, transparent)");
  expect(script).toContain("id=\"messageThreadBody\"");
  expect(script).toContain("function applyMessageScroll(mode, wasNearBottom)");
  expect(script).toContain("renderMessages({ scrollMode: 'bottom', wasNearBottom: true })");
  expect(script).toContain("Runner Diagnostics");
  expect(script).toContain("runner?.native_push");
  expect(script).toContain("const attentionRoles = {}");
  expect(script).toContain("function markAttentionForMessages(newMessages)");
  expect(script).toContain("function agentTabDot(roleName, runner)");
  expect(script).toContain("agent-tab-dot");
  expect(script).not.toContain("tab-state");
  expect(script).toContain("function settingsPanel(cfg)");
  expect(settingsSource).toContain("data-action=\"select-settings-tab\"");
  expect(script).toContain("function launch(role, hostOverride)");
  expect(agentsSource).toContain("data-action=\"toggle-launch-menu\"");
  expect(agentsSource).toContain("data-action=\"launch-host\"");
  // Codex + Pi appear in agents.ts launchable host list and renderLaunchDialog allHosts.
  expect(agentsSource).toContain("['claude-code', 'opencode', 'codex', 'pi']");
  expect(agentsSource).toContain("['codex', 'Codex'");
  // EP-031 WA-PI-5: Pi pill, launch-dialog choice, default-runtime dropdown + choice all wired.
  expect(agentsSource).toContain("['pi', 'Pi']");
  expect(agentsSource).toContain("'pi', 'Pi', 'Pi TUI agent with generated WhatsAgent extension'");
  expect(agentsSource).toContain("runtimeCommandFields('pi', 'Pi', commands.pi)");
  expect(agentsSource).toContain("runtimeDefaultChoice('pi', 'Pi'");
  expect(agentsSource).toContain("change-default-runtime");
  expect(script).toContain("data-action=\"stop-role\"");
  expectAbsent(script, ["data-action=\"stop\""]);
  // Agents Overview + Runtime/Diagnostics settings moved to agents.ts (WC-AGENTS-RUNTIME).
  expect(agentsSource).toContain("toggle-agent-sort-menu");
  expect(agentsSource).toContain("agent-sort-choice");
  expect(agentsSource).toContain("agent-sort-trigger");
  expect(agentsSource).toContain("launch-menu agent-sort-options");
  // WC-AGENTS-RUNTIME tombstones: sort/runtime/default-runtime UI moved out of
  // main.ts, leaving main with only dispatch and shared shell hooks.
  expectAbsent(script, ["Alphabetical", "agent-sort-field", 'data-action="open-launch">+ New']);
  expect(script).toContain("role-avatar");
  expect(agentsSource).toContain("defaultRuntimeModal");
  expect(agentsSource).toContain("select-default-runtime");
  expectAbsent(script, ["Default runtime for "]);
  expect(agentsSource).toContain("data-global-default-runtime");
  expect(script).toContain("function settingsDropdown");
  expect(script).toContain("data-action=\"toggle-settings-dropdown\"");
  expect(script).toContain("data-action=\"settings-dropdown-choice\"");
  expect(script).toContain("settingsDropdown('Terminal font size'");
  expectAbsent(settingsSource, ["Launch defaults and commands", "Fleet paths and runner metadata"]);
  expect(agentsSource).toContain("saveAction: 'save-runtime-settings'");
  expect(agentsSource).toContain("cancelAction: 'cancel-runtime-settings'");
  expectAbsent(script, ["Save Runtime Settings"]);
  expect(agentsSource).toContain("Fleet Info");
  // Messaging tab content moved to settings.ts (SETTINGS-AGENT-TEXT lift).
  expect(settingsSource).toContain("data-messaging-policy-mode");
  expect(settingsSource).toContain("messagingPolicyDraftMode");
  expect(settingsSource).toContain("messagingPeerRuleDraftMode");
  expect(settingsSource).toContain("saveAction: 'save-messaging-settings'");
  expect(settingsSource).toContain("cancelAction: 'cancel-messaging-settings'");
  expectAbsent(script, ["Save Policy</button>"]);
  expect(settingsSource).toContain("workspaceFetch('/settings/policy'");
  expect(settingsSource).toContain("policy-card");
  expect(settingsSource).toContain("Star Topology");
  expect(settingsSource).toContain("['star', 'Star Topology'");
  expect(settingsSource).toContain("['channel', 'Channel'");
  // Messaging policy tombstones: strict/loose star labels are normalized away.
  expectAbsent(script, ["Loose Star", "data-policy-mode-value=\"strict-star\""]);
  expect(settingsSource).toContain("peer-policy-panel");
  expect(settingsSource).toContain("select-messaging-peer-rule-mode");
  expect(settingsSource).toContain("Failed to add peer rule");
  expect(settingsSource).toContain("workspaceFetch('/settings/peer-policy/rules'");
  // launch-command-preview was removed in audit PR2 along with commandOverride.
  // Audit PR2 tombstones: command override preview must not return to launch UI.
  expectAbsent(script, ["launch-command-preview", "$('launchCommand')"]);
  expect(agentsSource).toContain("runtime-command-preview");
  expect(agentsSource).toContain("copy-command-preview");
  expect(agentsSource).toContain("/api/v1/settings/runtime");
  expect(script).toContain("function closeLaunchMenu()");
  expectAbsent(script, ["data-action=\"launch-host-select\""]);
  expect(script).toContain("launch(target.dataset.role, target.dataset.host)");
  expectAbsent(html, ["data-action=\"toggle-sidebar\""]);
  expect(script).toContain("action === 'toggle-sidebar'");
  expect(script).toContain("root.dataset.sidebar = prefs.sidebarCollapsed ? 'collapsed' : 'expanded';");
  expect(script).toContain("message-tabbar");
  expect(script).toContain("<div class=\"tabbar\">' + mobileSidebarTab() + '<button class=\"term-tab agent-overview-tab");
  expect(script).toContain("<div class=\"tabbar message-tabbar\">' + mobileSidebarTab() + '<div class=\"tabbar-scroll\">' + chips + '</div></div>");
  // Channel-mode tabbar gained a `#shared` placeholder tab; the empty
  // tabbar above this point is no longer the literal pinned shape.
  expect(messagesSource).toContain("<div class=\"tabbar message-tabbar\">' + mobileSidebarTab() + '<div class=\"tabbar-scroll\" role=\"tablist\"><button class=\"term-tab active\" role=\"tab\" aria-selected=\"true\">#shared</button></div></div><div class=\"inbox-panel channel-panel\">");
  expect(html).toContain(".messages-page.channel-mode.thread-open .channel-thread-sidebar { position: absolute; inset: 44px 0 0 0;");
  expect(kanbanSource).toContain("<div class=\"tabbar kanban-tabbar\">' + mobileSidebarTab() + '<div class=\"tabbar-scroll\" role=\"tablist\">");
  expect(settingsSource).toContain("<div class=\"tabbar settings-subnav\" aria-label=\"Settings sections\">' + mobileSidebarTab() + '<div class=\"tabbar-scroll\" role=\"tablist\">");
  expect(script).toContain("const tabBar = '<div class=\"tabbar\">' + mobileSidebarTab() + '<div class=\"tabbar-scroll\" role=\"tablist\">'");
  expectAbsent(script, ["peers · auto-scroll"]);
  expect(script).toContain("if (peers.length === 0 && mobileMessagesView === 'list') mobileMessagesView = 'thread';");
  expect(settingsSource).toContain("tabbar settings-subnav");
  expect(settingsSource).toContain("term-tab settings-subnav-item");
  expect(settingsSource).toContain("<span>' + esc(labels[id] || id) + '</span></button>");
  expectAbsent(settingsSource, ["<small>' + esc(item[1]) + '</small>"]);
  expect(settingsSource).toContain("role=\"tab\"");
  expect(script).toContain("settings-with-subnav");
  expect(html).toContain(".settings-with-subnav { display: flex; flex-direction: column; height: 100%; min-height: 0; gap: 0; }");
  expect(html).toContain(".settings-subnav.tabbar");
  expect(html).toContain(".settings-subnav .tabbar-scroll");
  expect(html).toContain(":root[data-theme=\"dark\"] .messages-page .bubble");
  expect(script).toContain("settings-panel");
  // WA-041: Settings panel scroll preserved across tab switch + save via per-tab map.
  expect(script).toContain("const settingsScrollByTab = new Map()");
  expect(script).toContain("let lastRenderedSettingsTab = ''");
  expect(script).toContain("settingsScrollByTab.set(lastRenderedSettingsTab, previousPanel.scrollTop)");
  expect(script).toContain("settingsScrollByTab.get(selectedSettingsTab) || 0");
  expect(script).toContain("if (restoreSettingsTop) requestAnimationFrame(() =>");
  expect(settingsSource).toContain("messageSettings");
  expect(settingsSource).toContain("const settingsTabOrder = ['preferences', 'notifications', 'messaging', 'runtime', 'prompts', 'roles', 'user', 'diagnostics', 'about']");
  expect(settingsSource).toContain("messaging: 'Messaging'");
  expect(settingsSource).toContain("runtime: 'Runtime'");
  expect(settingsSource).toContain("prompts: 'Prompts'");
  expect(settingsSource).toContain("diagnostics: 'Diagnostics'");
  expect(settingsSource).toContain("about: 'About'");
  expect(settingsSource).toContain("function aboutPanel()");
  expect(settingsSource).toContain("about-hero");
  expect(settingsSource).toContain("Messaging and task tracking for coding agents.");
  expect(renderedScript).toContain('"appVersion":"0.2.0"');
  expect(renderedScript).toContain('"appBuild":"');
  expect(settingsSource).toContain("const settingsTabAliases = { fleet: 'runtime', runners: 'diagnostics', 'chat-history': 'messaging', 'agent-text': 'prompts', workspaces: 'preferences' }");
  expect(settingsSource).not.toContain("kanban: 'preferences'");
  expect(settingsSource).toContain("data-message-max-body-chars");
  // After SETTINGS-AGENT-TEXT lift main.ts only imports + dispatches; the
  // settings module owns the tab order, aliases, subnav, messaging tab, and
  // prompts tab.
  expect(script).toContain('from "./settings.ts"');
  expect(settingsSource).toContain("export function validSettingsTab");
  expect(settingsSource).toContain("export function installSettings");
  expect(settingsSource).toContain("export function settingsTabsHtml");
  expect(settingsSource).toContain("export function renderSettingsTabContent");
  // RBAC Phase 2b — Settings → Roles tab. Pin tab plumbing, panel chrome,
  // grant editor catalog, custom CRUD modal, and key data-action hooks so
  // mid-PR refactors can't silently drop the surface.
  expect(settingsSource).toContain("roles: 'Roles'");
  expect(settingsSource).toContain("function rolesPanel()");
  expect(settingsSource).toContain("workspaceFetch('/rbac/roles')");
  expect(settingsSource).toContain("data-action=\"rbac-toggle-role-row\"");
  expect(settingsSource).toContain("data-action=\"rbac-save-role\"");
  expect(settingsSource).toContain("data-action=\"rbac-toggle-grant\"");
  expect(settingsSource).toContain("data-action=\"rbac-toggle-kanban-grant\"");
  expect(settingsSource).toContain("data-action=\"rbac-open-add-role-modal\"");
  expect(settingsSource).toContain("data-action=\"rbac-submit-add-role\"");
  expect(settingsSource).toContain("data-action=\"rbac-delete-role\"");
  // Builtin grant catalog covers all 5 boolean categories + the spec values.
  expect(settingsSource).toContain("RBAC_BOOLEAN_GRANT_CATEGORIES");
  expect(settingsSource).toContain("'tool_family'");
  expect(settingsSource).toContain("'kanban-admin'");
  expect(settingsSource).toContain("'verdict_no_go'");
  expect(settingsSource).toContain("'broadcast_message'");
  expect(settingsSource).toContain("'audit_admin'");
  expect(settingsSource).toContain("'is_operator_surrogate'");
  // Kanban-action vocabulary + scope qualifiers (own_assignment used by the
  // engineer seed default; the chip group must offer the spec scope set).
  expect(settingsSource).toContain("RBAC_KANBAN_ACTION_GRANTS");
  expect(settingsSource).toContain("'update_task_status'");
  expect(settingsSource).toContain("'comment_task'");
  expect(settingsSource).toContain("'own_assignment'");
  expect(settingsSource).toContain("'created_by_self'");
  // Delete confirmation must use openConfirm (per `feedback_custom_ui`),
  // not native confirm().
  expect(settingsSource).toContain("openConfirm({");
  expect(settingsSource).not.toContain("confirm('Delete role?'");
  // Style hooks land in shell-overrides for the role list + grant editor.
  expect(shellOverridesSource).toContain(".role-list");
  expect(shellOverridesSource).toContain(".role-row");
  expect(shellOverridesSource).toContain(".grant-chip");
  expect(shellOverridesSource).toContain(".grant-action-row");
  expect(shellOverridesSource).toContain(".rbac-add-role-modal");
  // RBAC Phase 2c — Permissions Overview matrix sub-tab + mobile fixes.
  expect(settingsSource).toContain("data-action=\"rbac-select-view-subtab\"");
  expect(settingsSource).toContain("function rolesMatrixHtml(");
  expect(settingsSource).toContain("Permissions Overview");
  expect(settingsSource).toContain("rbacViewSubtab");
  expect(shellOverridesSource).toContain(".roles-inner-tabbar");
  expect(shellOverridesSource).toContain(".permissions-matrix");
  expect(shellOverridesSource).toContain(".matrix-cell-on");
  expect(shellOverridesSource).toContain(".matrix-cell-off");
  expect(shellOverridesSource).toContain(".matrix-cell-scoped");
  // EP-022 / WA-100: Roles header gains "Tools visibility" label,
  // [Applies to current workspace] badge, RBAC mode selector row,
  // and (under Off mode) an audit-page banner.
  expect(settingsSource).toContain("'Tools visibility'");
  expect(settingsSource).not.toContain("'Tool groups'");
  // Advisor msg #431: catch unquoted prose too — hint copy on adjacent
  // chip categories used to reference the legacy "Tool groups tab".
  expect(settingsSource).not.toContain("Tool groups tab");
  expect(settingsSource).not.toContain("tool groups tab");
  expect(settingsSource).not.toMatch(/\btool group\b/i);
  expect(settingsSource).toContain("tools visible</span>");
  expect(settingsSource).toContain("Applies to current workspace");
  expect(settingsSource).toContain("data-action=\"rbac-select-workspace-mode\"");
  expect(settingsSource).toContain("rbac-mode-row");
  expect(settingsSource).toContain("/rbac-mode");
  expect(settingsSource).toContain("Disable RBAC for this workspace");
  expect(settingsSource).toContain("rbac-audit-off-banner");
  expect(settingsSource).toContain("RBAC is off for this workspace");
  expect(shellOverridesSource).toContain(".rbac-mode-row");
  expect(shellOverridesSource).toContain(".rbac-audit-off-banner");
  expect(shellOverridesSource).toContain(".roles-scope-badge");
  // Mobile sidebar full-screen — selector specificity bump from Phase 2c.
  expect(shellOverridesSource).toContain(":root[data-sidebar=\"collapsed\"] .sidebar,");
  expect(shellOverridesSource).toContain(":root[data-sidebar=\"expanded\"] .sidebar { position: fixed");
  // Mobile settings tabs no longer reserve 160px each.
  expect(shellOverridesSource).toContain(".settings-subnav-item.term-tab { min-width: 0;");
  // Settings tabbar scroll position preserved across re-render.
  expect(script).toContain(".settings-subnav .tabbar-scroll");
  expect(script).toContain("savedSubnavScrollLeft");
  expect(html).toContain("data-page=\"kanban\"");
  expect(kanbanSource).toContain("workspaceFetch('/kanban/tasks?");
  expect(script).toContain("data-action=\"open-workspace-edit\"");
  expect(kanbanSource).toContain("data-action=\"open-kanban-task\"");
  expect(kanbanSource).toContain("KANBAN_SEARCH_DEBOUNCE_MS = 250");
  expect(kanbanSource).toContain("KANBAN_AUTO_REFRESH_MS = 5000");
  expect(kanbanSource).toContain("['Backlog', 'Queued', 'In Progress', 'Blocked', 'Review', 'Completed']");
  expect(kanbanSource).toContain("class=\"kanban-board-head\"");
  expect(kanbanSource).toContain("class=\"kanban-board\"");
  expect(kanbanSource).toContain("class=\"kanban-cell-scroll\"");
  // Kanban board/drawer tombstones: old cell heads, modal epic backdrop, and
  // legacy card/detail markup are gone after EP-003/EP-007 refactors.
  expectAbsent(kanbanSource, ["class=\"kanban-cell-head\""]);
  expect(kanbanSource).toContain("renderKanbanDetail");
  expect(kanbanSource).toContain("function renderKanbanSidebar(opts)");
  expect(kanbanSource).toContain("renderKanbanSidebar({ className: 'kanban-detail'");
  expect(kanbanSource).toContain("renderKanbanSidebar({ className: 'kanban-epic-drawer'");
  expect(kanbanSource).toContain("className: 'kanban-detail'");
  expect(kanbanSource).toContain("data-action=\"select-kanban-tab\"");
  expect(kanbanSource).toContain("data-tab=\"epics\"");
  expect(kanbanSource).toContain("data-tab=\"archive\"");
  expect(kanbanSource).toContain(">Kanban</button>");
  expect(kanbanSource).toContain(">Epic</button>");
  expect(kanbanSource).toContain(">Archive</button>");
  expect(kanbanSource).not.toContain("Kanban Board</button>");
  expect(kanbanSource).not.toContain("Epics</button>");
  expect(kanbanSource).toContain("/kanban/archive");
  expect(kanbanSource).toContain("kanban-page-archive");
  expect(kanbanSource).toContain("kanbanTab === 'archive'");
  expect(kanbanSource).toContain("params.set('includeArchived', 'true')");
  expect(kanbanSource).toContain("function kanbanVisibleTasks()");
  expect(kanbanSource).toContain("kanbanTasks.filter(task => task.archived_at)");
  expect(kanbanSource).toContain("kanbanTab === 'archive' ? kanbanArchiveBoard() : kanbanBoard()");
  expect(kanbanSource).toContain("function kanbanArchiveBoard()");
  expect(kanbanSource).toContain("function renderKanbanArchiveLane(lane)");
  expect(kanbanSource).toContain("function renderKanbanArchiveItem(task)");
  expect(kanbanSource).toContain("compareArchivedTasks");
  expect(kanbanSource).toContain("Archived at");
  expect(kanbanSource).toContain("Archived by");
  expect(kanbanSource).toContain("<div class=\"archive-table\">' + (count ? lane.tasks.map(renderKanbanArchiveItem).join('') : '<div class=\"archive-empty-line\">(no archived tasks)</div>')");
  expect(kanbanSource).toContain("class=\"archive-item '");
  expect(kanbanSource).toContain("task.archived_by_role_name");
  expect(html).toContain(".archive-board");
  expect(html).toContain(".archive-row");
  expect(html).toContain(".archive-table-head, .archive-item");
  expect(html).toContain(".archive-empty-line");
  expectAbsent(kanbanSource, ["Show archived", "data-kanban-archived", "kanban-archived-toggle", "kanbanShowArchived"]);
  expect(kanbanSource).toContain("kanbanTab");
  expect(kanbanSource).toContain("kanbanEpicsView");
  expect(html).toContain(".kanban-tabbar");
  expect(kanbanSource).toContain("data-action=\"toggle-kanban-epic-section\"");
  expect(kanbanSource).toContain("data-action=\"open-kanban-epic-details\"");
  expect(kanbanSource).toContain("data-action=\"toggle-kanban-epic-visualise\"");
  expect(kanbanSource).toContain("data-action=\"select-kanban-epic-status\"");
  expect(kanbanSource).toContain("renderKanbanEpicSection");
  expect(kanbanSource).toContain("renderKanbanUnclassifiedSection");
  expect(kanbanSource).toContain("renderKanbanEpicIssueRow");
  expect(kanbanSource).toContain("loadKanbanEpics");
  // EP-003 WA-013 dropped the "Assigned to:" label; the unified card markup
  // now carries a `repoLine` (repoName:roleName) above the title instead.
  expect(kanbanSource).toContain("function taskRepoRoleLabel");
  expect(html).toContain(".kanban-epic-section");
  expect(html).toContain(".kanban-epic-issue-avatar");
  expect(html).toContain(".kanban-epic-close-pill");
  expect(kanbanSource).toContain("renderKanbanEpicDrawer");
  expect(kanbanSource).toContain("loadKanbanEpicDrawer");
  expect(kanbanSource).toContain("closeKanbanEpicDetails");
  // WA-064: task/epic details and comments render safe markdown, not raw escaped text blocks.
  expect(kanbanSource).toContain("<div class=\"kanban-detail-text markdown-body\">' + renderSafeMarkdown(task.details || 'No task details yet.') + '</div>");
  expect(kanbanSource).toContain("<div class=\"kanban-detail-text markdown-body\">' + renderSafeMarkdown(epic.details || 'No epic details yet.') + '</div>");
  expect(kanbanSource).toContain("<div class=\"kanban-comment-body markdown-body\">' + renderSafeMarkdown(comment.body || '') + '</div>");
  expect(kanbanSource).not.toContain("<p>' + esc(comment.body || '') + '</p>");
  expect(html).toContain(".kanban-detail-text p, .kanban-comment-body p");
  expect(html).toContain(".kanban-detail-text code, .kanban-comment-body code");
  expect(html).toContain(".kanban-detail-text pre, .kanban-comment-body pre");
  expect(html).toContain(".kanban-comment > div:not(.kanban-comment-body) { display: flex");
  expectAbsent(html, [".kanban-comment div { display: flex"]);
  expect(kanbanSource).toContain("data-action=\"close-kanban-epic-drawer\"");
  expect(html).toContain(".kanban-epic-drawer");
  // EP-003 WA-014 dropped the modal overlay+backdrop; the drawer is now an in-grid sidebar (parity with task detail).
  expectAbsent(html, [".kanban-epic-drawer-backdrop"]);
  expect(html).toContain(".kanban-epic-drawer-close-banner");
  // Tab focus-trap removed in WA-014 (no longer modal).
  expectAbsent(kanbanSource, ["e.key !== 'Tab'"]);
  expect(kanbanSource).toContain("layoutKanbanEpicDag");
  expect(kanbanSource).toContain("detectKanbanEpicCycle");
  expect(kanbanSource).toContain("renderKanbanEpicDagSvg");
  expect(kanbanSource).toContain("computeExternalDeps");
  expect(html).toContain(".kanban-epic-dag");
  expect(html).toContain(".kanban-epic-dag-edge");
  expect(html).toContain(".kanban-epic-dag-external");
  expect(html).toContain(".kanban-epic-cycle-warning");
  expect(kanbanSource).toContain("data-action=\"approve-kanban-epic-close\"");
  expect(kanbanSource).toContain("data-action=\"cancel-kanban-epic-close-web\"");
  expect(kanbanSource).toContain("approveKanbanEpicClose");
  expect(kanbanSource).toContain("cancelKanbanEpicCloseFromWeb");
  expect(kanbanSource).toContain("renderKanbanEpicCloseApprovalBanner");
  expect(html).toContain(".kanban-epic-drawer-approve");
  expect(html).toContain(".kanban-epic-drawer-close-banner-actions");
  expectAbsent(script, ["<div class=\"kanban-cell-empty\">-</div>", "kanban-card-detail"]);
  expect(html).toContain(".kanban-page");
  expect(html).toContain(".kanban-board");
  expect(html).toContain(".kanban-page.detail-open");
  expect(html).toContain("grid-template-columns: repeat(var(--kanban-status-count), minmax(var(--kanban-status-min), 1fr))");
  expect(html).toContain(".kanban-status-queued");
  expect(html).toContain("border-bottom: 1px solid var(--border)");
  expect(html).toContain(".kanban-cell-scroll");
  expect(script).toContain("settingsBottomActionBar");
  expect(script).toContain("data-settings-save-bar");
  // Messaging + chat-history fetch + dataset attrs moved to settings.ts.
  expect(settingsSource).toContain("workspaceFetch('/settings/message'");
  expect(script).toContain("function updateMessageLengthCounters()");
  expect(script).toContain("message-length-counter");
  expect(settingsSource).toContain("data-chat-history-retention");
  expect(settingsSource).toContain("data-chat-history-custom");
  // Settings lift tombstones: messaging/chat-history/runtime form controls live
  // in settings.ts and use dropdown/button abstractions instead of old selects.
  expectAbsent(script, [
    "<select data-messaging-peer-role-a>",
    "<select class=\"setting-select\" data-chat-history-retention",
    "<select class=\"setting-select\" data-global-default-runtime",
    "Save Retention</button>",
  ]);
  expect(settingsSource).toContain("data-action=\"clear-chat-history\"");
  expect(settingsSource).toContain("workspaceFetch('/settings/chat-history'");
  expect(settingsSource).toContain("workspaceFetch('/settings/chat-history/clear'");
  expect(html).toContain(".chat-history-retention");
  expect(html).toContain(".chat-history-clear");
  expect(html).toContain(".message-length-counter");
  expect(html).toContain(".settings-save-bar");
  expect(html).toContain(".settings-save-actions");
  expect(html).toContain(".settings-dropdown .launch-menu");
  expect(html).toContain(".settings-dropdown.open .launch-menu");
  // EP-010 WA-041: Prompts panel uses per-prompt expanders and custom prompt CRUD.
  expect(settingsSource).toContain("data-agent-text-field=\"");
  expect(settingsSource).toContain("daemonApiUrl('/settings/agent-text')");
  expect(settingsSource).toContain("daemonApiUrl('/settings/custom-prompts')");
  expect(settingsSource).toContain("<h2>Prompts</h2>");
  expect(settingsSource).toContain("class=\"prompt-expander\"");
  expect(settingsSource).toContain("prompt-expander-chevron");
  expect(settingsSource).toContain("data-action=\"create-custom-prompt\"");
  expect(settingsSource).toContain("data-action=\"save-agent-text-field\"");
  expect(settingsSource).toContain("data-action=\"save-custom-prompt\"");
  expect(settingsSource).toContain("data-action=\"delete-custom-prompt\"");
  expect(settingsSource).not.toContain("edit-custom-prompt-title");
  expect(settingsSource).not.toContain("Edit Title");
  expect(settingsSource).toContain("Delete custom prompt?");
  expect(settingsSource).toContain("openConfirm({ title: 'Delete custom prompt?'");
  expectAbsent(settingsSource, ["cancelAction: 'cancel-agent-text-settings'", "dangerAction: 'reset-agent-text'", "dangerLabel: 'Reset All'", "settingsBottomActionBar('prompts'"]);
  expect(settingsSource).toContain("data-action=\"reset-agent-text-field\"");
  expect(settingsSource).toContain("data-agent-text-reset-field=\"");
  expect(settingsSource).toContain("async function resetAgentTextField(field)");
  expect(settingsSource).toContain("Discarded unsaved prompt edits.");
  expectAbsent(script, ["wsApiUrl('/settings/agent-text/reset')", ">Save Prompts</button>"]);
  expect(settingsSource).toContain("editing this option can change or break message-handling behavior");
  expect(html).toContain(".btn.danger:not(:disabled):hover");
  expect(html).toContain(".prompt-expander-head");
  expect(html).toContain("border-radius: 14px");
  expect(html).toContain("overflow: hidden");
  // EP-029 T4: rescaleOverlappingGlyphs lives in TerminalController.
  expect(controllerSource).toContain("rescaleOverlappingGlyphs: true");
  expect(script).toContain("copy-visible-terminal");
  expect(script).toContain("function visibleXtermText");
  expect(controllerSource).toContain("buffer.viewportY");
  expect(html).toContain("terminal-actions");
  expect(html).toContain(".terminal-body { flex: 1 1 auto; height: auto;");
  // WebGL renderer addon: replaces default DOM renderer with GPU-accelerated
  // canvas. OpenCode TUI repaints alt-screen at ~60Hz on wheel scroll; DOM
  // renderer can't keep up and shows partial frames as flicker. WebGL renders
  // atomically per frame. Falls back to DOM when WebGL2 unavailable.
  // EP-029 T4: WebglAddon / Unicode11 lifecycle moved into controller.
  expect(html).toContain('<script src="/assets/xterm-addon-webgl.js"></script>');
  expect(html).toContain('<script src="/assets/xterm-addon-unicode11.js"></script>');
  expect(controllerSource).toContain("WebglAddon");
  expect(controllerSource).toContain("onContextLoss");
  expect(html).toContain("will-change: transform");
  expect(html).toContain("transform: translateZ(0)");

  // EP-029 T4 BIG TOMBSTONE BLOCK — the WA-114 OpenCode resize-pulse +
  // recovery infrastructure (`pulseOpenCodeTerminalResize`,
  // `OPENCODE_TERMINAL_STABILIZE_DELAYS`, `scheduleOpenCodeTerminalRecovery`,
  // `recoverMountedOpenCodeTerminal`, `terminalResizeRects`) and the
  // WA-127 patch series (`estimateInitialTerminalDims`,
  // `activeXtermVisibilityHidden`, `activeXtermInitialFitDone`,
  // `pendingTerminalResize`, `pendingTerminalWsConnect`, the second-rAF
  // drain in `scheduleTerminalFit`) are all gone — server-side
  // mirror-as-source restore frame replaces the heuristic stabilizers.
  // The "no scheduleTerminalFit() inside ws output frame" invariant is
  // moot since the controller doesn't call scheduleTerminalFit at all
  // — it relies on its ResizeObserver + the canonical restore frame.
  // The `linkHandler: null,` + `WebGLContext loss → DOM fallback` invariants
  // are pinned against controllerSource above.
  expect(script).not.toContain("function pulseOpenCodeTerminalResize");
  expect(script).not.toContain("OPENCODE_TERMINAL_STABILIZE_DELAYS");
  expect(script).not.toContain("function scheduleOpenCodeTerminalRecovery");
  expect(script).not.toContain("function recoverMountedOpenCodeTerminal");
  expect(script).not.toContain("function estimateInitialTerminalDims");
  expect(script).not.toContain("activeXtermVisibilityHidden");
  expect(script).not.toContain("activeXtermInitialFitDone");
  expect(script).not.toContain("pendingTerminalResize");
  expect(script).not.toContain("pendingTerminalWsConnect");
  expect(script).not.toContain("ctx.measureText('M').width");

  // EP-029 WA-138: T4-d cleanup left two orphan call sites that reference
  // helpers deleted with the controller migration. Both throw ReferenceError
  // at runtime: `closeTerminalWs()` inside switchWorkspace breaks every
  // workspace dropdown switch (alert pop-up swallowed by error handler);
  // `recoverMountedOpenCodeTerminal` registered as visibilitychange + focus
  // listeners breaks every tab-away/tab-back cycle silently. Pin orphan
  // absence so future cleanup passes don't reintroduce them.
  expect(script).not.toContain("closeTerminalWs()");
  expect(script).not.toContain("recoverMountedOpenCodeTerminal");

  // EP-029 WA-137: trail-debounced resize-ws sends. xterm fires onResize
  // multiple times during initial layout convergence — `term.open()` at the
  // 80×24 constructor dims, then `fitAddon.fit()` at the container dims, then
  // sub-pixel jitter as fonts.ready resolves. Each onResize previously sent
  // a `resize-ws` frame; the runtime received SIGWINCH at intermediate cols
  // and left wrap points in scrollback as "Re ghost" artefacts (see
  // xterm-debug.log 2026-05-06T10:28:25.552Z burst: 188 → 191 → 192 → 193 ×43
  // within ~1s). Fix: requestResize coalesces calls onto a trailing-edge
  // setTimeout; only the final dim after the quiet window hits the WS.
  expect(controllerSource).toContain("WS_RESIZE_DEBOUNCE_MS");
  expect(controllerSource).toContain("private pendingWsResize");
  expect(controllerSource).toContain("private resizeWsTimer");
  expect(controllerSource).toContain("private flushResizeWs");
  // requestResize must enqueue + reset timer rather than send directly. The
  // WS-send block moved into flushResizeWs; pin its absence in requestResize.
  const requestResizeBody = controllerSource.match(/requestResize\([^)]*\): void \{[\s\S]*?\n  \}/)?.[0] ?? "";
  expect(requestResizeBody).toContain("this.pendingWsResize = { cols, rows }");
  expect(requestResizeBody).toContain("setTimeout");
  expect(requestResizeBody).not.toContain("this.ws.send");
  // Dispose must clear the pending timer + buffer so a remount doesn't
  // fire a stale resize-ws against the new role.
  expect(controllerSource).toContain("if (this.resizeWsTimer)");
  expect(controllerSource).toContain("this.pendingWsResize = null");

  // Codex toast + nudge-blocked dot moved to codex.ts (WC-CODEX-UI-GLUE).
  expect(codexSource).toContain("Codex inbox waiting");
  expect(codexSource).toContain("nudge-blocked");
  expect(script).toContain("replace(/\\r?\\n/g, '\\r\\n')");
  // Terminal/global chrome tombstones: native tabbed TUI shell removed shortcut
  // help, terminal chrome, and stale CRLF double-escape handling.
  expectAbsent(script, ["replace(/\\r?\\n/g, '\\\\r\\\\n')", "function handleGlobalShortcut(e)"]);
  expect(script).toContain("function applyRouteFromLocation()");
  expect(script).toContain("history[replace ? 'replaceState' : 'pushState']");
  expectAbsent(script, ["Ctrl+1..9", "Keyboard Shortcuts", "terminal-chrome", "traffic"]);
  expect(html).toContain("brand-toggle");
  expect(html).toContain("M6.7 1.6h2.6l.35 1.55");
  expectAbsent(html, ["sidebar-controls"]);
});

test("WA-200 web direct sends echo into the local inbox store", () => {
  expect(clientSource).toContain("let optimisticMessageIds = new Set();");
  expect(clientSource).toContain("function upsertLocalMessage(message, opts = {})");
  expect(clientSource).toContain("function mergeOptimisticMessages(nextMessages)");
  expect(clientSource).toContain("if (payload.message) upsertLocalMessage(payload.message, { optimistic: true });");
  expect(clientSource).toContain("const selected = roleByAddress(selectedThread) || state.roles[0];");
  expect(clientSource).toContain("message.from_role_name !== HUMAN_PEER");
  expect(clientSource).not.toContain("const selected = roleByName(selectedThread) || state.roles[0];");
});

test("WA-202 channel thread composer handle avoids sidebar resize overlap", () => {
  expect(shellOverridesSource).toContain(".channel-thread-sidebar .message-composer-resize { left: 10px; }");
  expect(shellOverridesSource).toContain(".channel-thread-sidebar-resize { position: absolute; left: -5px; top: 0; bottom: 0; z-index: 4; width: 10px;");
});

test("WA-201 stale runner pulse endpoint surfaces on agent cards", () => {
  expect(agentsSource).toContain("function staleRunnerBanner(runner)");
  expect(agentsSource).toContain("runner?.stale_pulse_endpoint");
  expect(agentsSource).toContain("Stale runner \\u2014 restart for TUI redraw fix");
  expect(shellOverridesSource).toContain(".agent-stale-runner-banner");
});

test("WA-203 Add Agent button uses secondary style", () => {
  expect(agentsSource).toContain('"btn secondary small" data-action="open-add-agent"');
});

test("renderWebShell includes notifications-v2 IIFE with inlined helpers", () => {
  const config: WhatsAgentConfig = {
    fleet: { name: "t", root: "/tmp/t" },
    ui: { host: "127.0.0.1", port: 4017 },
    policy: { mode: "star" },
    commands: { claudeCode: { command: "c", args: [] }, openCode: { command: "o", args: [] }, codex: { command: "x", args: [] }, pi: { command: "p", args: [] } },
  };
  const html = renderWebShell({ root: config.fleet.root, config, roles: [], mainRole: null, runners: [] });
  const script = clientSource;
  const bundledHtml = renderWebShell({ root: config.fleet.root, config, roles: [], mainRole: null, runners: [], clientBundle: builtClientBundle });
  const bundledScript = bundledHtml.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? "";

  // Notifications module replaces installNotificationsV2 IIFE.
  expect(script).toContain('from "./notifications.ts"');
  expect(notificationsSource).toContain("window.__notificationsV2 = true");
  for (const name of [
    "ledgerInsert",
    "parseLogSafe",
    "migratePrefsV2ToV3",
    "isLeaderTab",
    "shouldFire",
    "truncate",
    "buildEventForMessage",
    "buildEventForRunnerExit",
    "buildEventForApprovalWaiting",
    "buildEventForCodexNudgeBlocked",
    "buildEventForCodexInboxPending",
    "buildEventForLaunchFailure",
  ]) {
    expect(notificationsSource).toContain("function " + name);
  }
  for (const constLine of [
    "const MAX_ENTRIES = 200;",
    "const LEADER_TTL_MS = 30000;",
    "const LEADER_HEARTBEAT_MS = 10000;",
    "const DEFAULT_PREFS_V3 =",
  ]) {
    expect(notificationsSource).toContain(constLine);
  }
  expect(() => new Function(bundledScript)).not.toThrow();
});

test("notification bell updater preserves icon and badge markup", () => {
  const { html, script } = renderNotificationShell();

  expect(html).toContain('class="notification-icon notification-icon-on"');
  expect(html).toContain('class="notification-icon notification-icon-muted"');
  expect(html).toContain('id="notificationBadge"');

  expect(script).toContain("function updateNotificationButton()");
  expect(script).toContain("btn.dataset.notificationState");
  expect(script).not.toContain("btn.textContent = permission === 'granted' ? 'Notifications On'");
  expect(script).not.toContain("btn.textContent = 'Notifications unavailable'");
});

test("notification popover routes settings and uses app clear modal", () => {
  const { script } = renderNotificationShell();

  expect(notificationsSource).toContain("setSelectedSettingsTab('notifications')");
  expect(notificationsSource).toContain("showPage('settings'");
  expect(notificationsSource).toContain("function openNotificationClearModal");
  expect(notificationsSource).toContain('data-action="request-clear-notifications"');
  expect(notificationsSource).toContain('data-action="confirm-clear-notifications"');
  expect(script).not.toContain("confirm('Clear all ");
});

test("notification settings use labeled pill toggles and custom sound dropdowns", () => {
  const { script } = renderNotificationShell();

  expect(notificationsSource).toContain("notification-event-list");
  expect(notificationsSource).toContain("notification-event-row");
  expect(notificationsSource).toContain("notification-event-controls");
  expect(notificationsSource).toContain("notification-event-header");
  expect(script).toContain("Browser");
  expect(script).toContain("Toast");
  expect(script).toContain("Sound");
  expect(notificationsSource).toContain("Use default");
  expect(script).not.toContain("notification-channel-label");
  expect(notificationsSource).toContain("notificationSoundDropdown('Default sound'");
  expect(notificationsSource).toContain("data-notification-default-sound");
  expect(notificationsSource).toContain("data-notification-event-sound");
  expect(script).not.toContain("notification-event-grid");
  expect(script).not.toContain("<select class=\"settings-dropdown-trigger\" data-action=\"set-event-sound\"");
  expect(script).not.toContain("<select class=\"settings-dropdown-trigger\" data-action=\"set-default-sound\"");
});

test("notification settings status rows and dropdown stacking use polish classes", () => {
  const { html, script } = renderNotificationShell();

  expect(notificationsSource).toContain("notification-status-value");
  expect(notificationsSource).toContain("settingRow('Browser permission'");
  expect(notificationsSource).toContain("settingRow('Secure context'");
  expect(html).toContain(".notification-status-value");
  expect(html).toContain(".notification-event-row { display: grid; grid-template-columns: minmax(210px, .42fr) minmax(260px, .58fr); gap: 4px 20px;");
  expect(html).toContain(".notification-event-controls { display: grid; grid-template-columns: 88px 88px minmax(150px, 170px); column-gap: 12px;");
  expect(html).toContain(".notification-event-row:has(.notification-sound-dropdown.open)");
  expect(html).toContain(".notification-event-controls:has(.notification-sound-dropdown.open)");
});

test("terminal attention frames can trigger approval-waiting notification", () => {
  renderNotificationShell();
  // EP-029 T4: WS attention frame parsing moved into TerminalController
  // (src/web/client/terminal-controller.ts handleWsMessage). Pin via
  // controllerSource — main.ts only forwards via the onAttention
  // callback shape `window.__handleRunnerAttentionNotification(role,
  // attention)` constructed in ensureTerminalController.
  const controllerSource = readFileSync(
    join(import.meta.dir, "..", "src", "web", "client", "terminal-controller.ts"),
    "utf8",
  );
  expect(notificationsSource).toContain("__handleRunnerAttentionNotification");
  expect(controllerSource).toContain("body.attention");
  expect(controllerSource).toContain("this.options.onAttention(role, frame.attention)");
  expect(notificationsSource).toContain("handleTerminalAttentionNotification");
  expect(notificationsSource).toContain("buildEventForApprovalWaiting({ role, attention })");
});

test("renderWebShell emits new bell row + popover container markup", () => {
  const config: WhatsAgentConfig = {
    fleet: { name: "t", root: "/tmp/t" },
    ui: { host: "127.0.0.1", port: 4017 },
    policy: { mode: "star" },
    commands: { claudeCode: { command: "c", args: [] }, openCode: { command: "o", args: [] }, codex: { command: "x", args: [] }, pi: { command: "p", args: [] } },
  };
  const html = renderWebShell({ root: config.fleet.root, config, roles: [], mainRole: null, runners: [] });
  expect(html).toContain('id="notificationBtn"');
  expect(html).toContain('class="notification-icon-wrap"');
  expect(html).toContain('id="notificationBadge"');
  expect(html).toContain('id="notificationPopover"');
  expect(html).toContain('id="notificationToastStack"');
  expect(html).toContain('aria-haspopup="dialog"');
});

test("notifications-v2 IIFE installs notify() and emitters", () => {
  const config: WhatsAgentConfig = { fleet: { name: "t", root: "/tmp/t" }, ui: { host: "127.0.0.1", port: 4017 }, policy: { mode: "star" }, commands: { claudeCode: { command: "c", args: [] }, openCode: { command: "o", args: [] }, codex: { command: "x", args: [] }, pi: { command: "p", args: [] } } };
  const html = renderWebShell({ root: "/tmp/t", config, roles: [], mainRole: null, runners: [] });
  const script = clientSource;
  expect(notificationsSource).toContain("function notify(event, options)");
  expect(notificationsSource).toContain("function refreshBadge()");
  expect(notificationsSource).toContain("function notifyNewMessagesV2");
  expect(notificationsSource).toContain("function notifyRunnerExitsV2");
  expect(notificationsSource).toContain("addEventListener('storage', function notificationsStorageHandler");
  expect(notificationsSource).toContain("window.__notifyV2 = notify");
});

test("notifications-v2 state vars declared in chunk-0", () => {
  const config: WhatsAgentConfig = { fleet: { name: "t", root: "/tmp/t" }, ui: { host: "127.0.0.1", port: 4017 }, policy: { mode: "star" }, commands: { claudeCode: { command: "c", args: [] }, openCode: { command: "o", args: [] }, codex: { command: "x", args: [] }, pi: { command: "p", args: [] } } };
  const html = renderWebShell({ root: "/tmp/t", config, roles: [], mainRole: null, runners: [] });
  const script = clientSource;
  expect(script).toContain("let notificationLog = { version: 1");
  expect(script).toContain("const TAB_ID =");
  expect(script).toContain("const previousRunnerStateForNotifs = {};");
});

test("notifications-v2 popover handlers and renderers", () => {
  const config: WhatsAgentConfig = { fleet: { name: "t", root: "/tmp/t" }, ui: { host: "127.0.0.1", port: 4017 }, policy: { mode: "star" }, commands: { claudeCode: { command: "c", args: [] }, openCode: { command: "o", args: [] }, codex: { command: "x", args: [] }, pi: { command: "p", args: [] } } };
  const html = renderWebShell({ root: "/tmp/t", config, roles: [], mainRole: null, runners: [] });
  const script = clientSource;
  expect(notificationsSource).toContain("function openNotificationPopover()");
  expect(notificationsSource).toContain("function closeNotificationPopover()");
  expect(notificationsSource).toContain("function renderNotificationPopover()");
  expect(notificationsSource).toContain("action === 'toggle-notifications-popover'");
  expect(notificationsSource).toContain('data-action="mark-all-read"');
  expect(notificationsSource).toContain('data-action="request-clear-notifications"');
  expect(notificationsSource).toContain('data-action="open-notification-entry"');
});

test("notifications-v2 toast queue + render", () => {
  const config: WhatsAgentConfig = { fleet: { name: "t", root: "/tmp/t" }, ui: { host: "127.0.0.1", port: 4017 }, policy: { mode: "star" }, commands: { claudeCode: { command: "c", args: [] }, openCode: { command: "o", args: [] }, codex: { command: "x", args: [] }, pi: { command: "p", args: [] } } };
  const html = renderWebShell({ root: "/tmp/t", config, roles: [], mainRole: null, runners: [] });
  const script = clientSource;
  expect(notificationsSource).toContain("function enqueueToast(event)");
  expect(notificationsSource).toContain("function renderToasts()");
  expect(notificationsSource).toContain("function pruneToasts()");
  expect(notificationsSource).toContain("TOAST_MAX_VISIBLE = 3");
  expect(notificationsSource).toContain("TOAST_AUTO_DISMISS_MS = 6000");
  expect(notificationsSource).toContain('data-action="open-toast"');
  expect(notificationsSource).toContain('data-action="dismiss-toast"');
});

test("notifications-v2 sound player + leader claim + browser popup", () => {
  const config: WhatsAgentConfig = { fleet: { name: "t", root: "/tmp/t" }, ui: { host: "127.0.0.1", port: 4017 }, policy: { mode: "star" }, commands: { claudeCode: { command: "c", args: [] }, openCode: { command: "o", args: [] }, codex: { command: "x", args: [] }, pi: { command: "p", args: [] } } };
  const html = renderWebShell({ root: "/tmp/t", config, roles: [], mainRole: null, runners: [] });
  const script = clientSource;
  expect(notificationsSource).toContain("function playSound(name)");
  expect(notificationsSource).toContain("function claimLeadership()");
  expect(notificationsSource).toContain("function ourTabIsLeader()");
  expect(notificationsSource).toContain("function fireBrowserPopup(event)");
  expect(notificationsSource).toContain("function flushBrowserMessageBatch()");
  expect(notificationsSource).toContain("queueMicrotask(flushBrowserMessageBatch)");
});

test("notifications-v2 settings panel + legacy IIFE removed", () => {
  const config: WhatsAgentConfig = { fleet: { name: "t", root: "/tmp/t" }, ui: { host: "127.0.0.1", port: 4017 }, policy: { mode: "star" }, commands: { claudeCode: { command: "c", args: [] }, openCode: { command: "o", args: [] }, codex: { command: "x", args: [] }, pi: { command: "p", args: [] } } };
  const html = renderWebShell({ root: "/tmp/t", config, roles: [], mainRole: null, runners: [] });
  const script = clientSource;
  expect(notificationsSource).toContain("function renderNotificationSettingsPanel()");
  expect(notificationsSource).toContain("'toggle-channel-master'");
  expect(notificationsSource).toContain("'toggle-event-channel'");
  expect(notificationsSource).toContain("data-notification-event-sound");
  expect(script).not.toContain("installNotificationControls");
  expect(script).toContain("function notifyBrowser(title, opts");  // chunk-1 base still present
});

test("runtime detection UI: cards, chip, enabled toggle, redetect-all, and launch filter", () => {
  const config: WhatsAgentConfig = { fleet: { name: "t", root: "/tmp/t" }, ui: { host: "127.0.0.1", port: 4017 }, policy: { mode: "star" }, commands: { claudeCode: { command: "c", args: [] }, openCode: { command: "o", args: [] }, codex: { command: "x", args: [] }, pi: { command: "p", args: [] } } };
  const runtimeDetection = {
    "claude-code": { detected: true, resolvedPath: "/usr/local/bin/claude", version: "2.1.123", rawVersionOutput: "2.1.123 (Claude Code)", error: null, lastCheckedAt: "2026-04-29T00:00:00.000Z" },
    "opencode":    { detected: false, resolvedPath: null, version: null, rawVersionOutput: null, error: "not_found" as const, lastCheckedAt: "2026-04-29T00:00:00.000Z" },
    "codex":       { detected: true, resolvedPath: "/usr/local/bin/codex", version: "0.125.0", rawVersionOutput: "codex-cli 0.125.0", error: null, lastCheckedAt: "2026-04-29T00:00:00.000Z" },
    "pi":          { detected: false, resolvedPath: null, version: null, rawVersionOutput: null, error: "not_found" as const, lastCheckedAt: "2026-04-29T00:00:00.000Z" },
  };
  const html = renderWebShell({ root: "/tmp/t", config, roles: [], mainRole: null, runners: [], runtimeDetection, clientBundle: "__WHATSAGENT_INITIAL_STATE__" });
  const renderedScript = html.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? "";
  const script = clientSource;

  // Initial state JSON includes runtimeDetection.
  expect(renderedScript).toContain('"runtimeDetection":');
  expect(renderedScript).toContain('"resolvedPath":"/usr/local/bin/claude"');
  expect(renderedScript).toContain('"version":"2.1.123"');

  // Per-runtime card layout pieces (now in agents.ts after WC-AGENTS-RUNTIME).
  expect(agentsSource).toContain("class=\"runtime-enabled-row\"");
  expect(agentsSource).toContain("data-runtime-enabled=");
  expect(agentsSource).toContain("renderDetectionChip");
  expect(agentsSource).toContain("runtime-detect-chip");
  expect(agentsSource).toContain("detect-ok");
  expect(agentsSource).toContain("detect-missing");
  expect(agentsSource).toContain("detect-error");
  expect(agentsSource).toContain("detect-pending");
  // Auto-probe on Command field input (debounced), wired via input listener.
  expect(agentsSource).toContain("function scheduleRuntimeCommandProbe(key, command)");
  expect(agentsSource).toContain("async function runRuntimeCommandProbe(host, key, command)");
  expect(agentsSource).toContain("'?command=' + encodeURIComponent(trimmed)");
  expect(agentsSource).toContain("scheduleRuntimeCommandProbe(target.dataset.runtimeCommand, target.value)");
  // Agent TUI tab Start dropdown filters undetected/disabled hosts.
  expect(script).toContain("function tuiBarHostLaunchable(host)");
  expect(script).toContain("allItems.filter(([host]) => host === 'default' ? defaultLaunchable : tuiBarHostLaunchable(host))");
  // EP-031: Pi appears in TUI bar Start dropdown alongside the other runtimes.
  expect(script).toContain("['pi', 'Pi']");
  expect(script).toContain("host === 'pi' ? 'pi'");

  // Command preview is now a readonly input (per layout spec).
  expect(agentsSource).toContain("runtime-command-preview-input");
  expect(agentsSource).toContain("readonly data-command-preview");

  // Re-detect All button + handler.
  expect(agentsSource).toContain("data-action=\"redetect-all-runtimes\"");
  expect(agentsSource).toContain("async function redetectAllRuntimes()");
  expect(agentsSource).toContain("/api/v1/settings/runtime/detect");

  // saveRuntimeSettings persists the enabled flag.
  expect(agentsSource).toMatch(/enabled:\s*enabledFromCheckbox/);

  // Launch dialog + launchControl filter undetected/disabled hosts.
  expect(agentsSource).toContain("function isHostLaunchable(host)");
  expect(agentsSource).toContain("allHosts.filter(([id]) => id === 'default' || isHostLaunchable(id))");
  expect(agentsSource).toContain("Default unavailable");

  // CSS hooks for chip + card header rendered into the page.
  expect(html).toContain(".runtime-detect-chip.detect-ok");
  expect(html).toContain(".runtime-detect-chip.detect-missing");
  expect(html).toContain(".runtime-detect-chip.detect-error");
  expect(html).toContain(".runtime-enabled-row");
  expect(html).toContain(".runtime-redetect-row");
});

test("renderWebShell carries currentWorkspace + workspacesAvailable into initial state", () => {
  const config: WhatsAgentConfig = { fleet: { name: "t", root: "/tmp/t" }, ui: { host: "127.0.0.1", port: 4017 }, policy: { mode: "star" }, commands: { claudeCode: { command: "c", args: [] }, openCode: { command: "o", args: [] }, codex: { command: "x", args: [] }, pi: { command: "p", args: [] } } };

  // With current workspace registered.
  const html1 = renderWebShell({
    root: "/tmp/t",
    config,
    roles: [],
    mainRole: null,
    runners: [],
    currentWorkspace: { id: "abc123", name: "demo" },
    workspacesAvailable: 1,
    workspaces: [{ id: "abc123", name: "demo", status: "active", role_count: 2, runner_count: 1, trashed_at: null }],
    clientBundle: "__WHATSAGENT_INITIAL_STATE__",
  } as any);
  const renderedScript1 = html1.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? "";
  const script = clientSource;
  expect(renderedScript1).toContain('"currentWorkspace":{"id":"abc123","name":"demo"}');
  expect(renderedScript1).toContain('"workspacesAvailable":1');
  expect(renderedScript1).toContain('"workspaces":[{"id":"abc123","name":"demo","status":"active","role_count":2,"runner_count":1,"trashed_at":null}]');

  // Empty registry: currentWorkspace is null, workspacesAvailable defaults to 0.
  const html2 = renderWebShell({ root: "", config, roles: [], mainRole: null, runners: [], clientBundle: "__WHATSAGENT_INITIAL_STATE__" });
  const renderedScript2 = html2.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? "";
  expect(renderedScript2).toContain('"currentWorkspace":null');
  expect(renderedScript2).toContain('"workspacesAvailable":0');

  // Diagnostics panel surfaces workspace + workspace path rows.
  expect(agentsSource).toContain("kv('Workspace'");
  expect(agentsSource).toContain("kv('Workspace path'");
  expect(agentsSource).toContain("kv('Workspaces (active)'");
});

test("renderWebShell includes workspace switcher and add-workspace modal wiring", () => {
  const config: WhatsAgentConfig = { fleet: { name: "t", root: "/tmp/t" }, ui: { host: "127.0.0.1", port: 4017 }, policy: { mode: "star" }, commands: { claudeCode: { command: "c", args: [] }, openCode: { command: "o", args: [] }, codex: { command: "x", args: [] }, pi: { command: "p", args: [] } } };
  const html = renderWebShell({
    root: "/tmp/t",
    config,
    roles: [],
    mainRole: null,
    runners: [],
    currentWorkspace: { id: "abc123", name: "demo" },
    workspacesAvailable: 2,
    workspaces: [
      { id: "abc123", name: "demo", status: "active", repo_count: 2, role_count: 2, runner_count: 1, trashed_at: null },
      { id: "def456", name: "docs", status: "active", repo_count: 1, role_count: 1, runner_count: 0, trashed_at: null },
    ],
  } as any);
  const script = clientSource;

  expect(html).toContain('class="workspace-switcher"');
  expect(html).toContain('id="workspaceSwitcher"');
  expect(html).toContain('data-action="toggle-workspace-menu"');
  expect(html).toContain('data-action="switch-workspace"');
  expect(html).toContain('data-workspace-id="def456"');
  expect(html).toContain('1 repo / 1 role / 0 live');
  expect(html).toContain('data-action="open-workspace-add"');
  expect(html).toContain('id="workspaceAddModal"');
  expect(html).toContain('id="workspaceAddName"');
  expect(html).toContain('id="workspaceAddKanbanPrefix"');
  expect(html).not.toContain('id="workspaceAddPath"');
  expect(html).not.toContain('id="workspaceAddType"');
  expect(html).toContain('id="workspaceAddSubmitBtn"');
  expect(html).toContain(".workspace-switcher");
  expect(html).toContain(".workspace-menu-row");

  expect(script).toContain("function installWorkspaceSwitcherUi()");
  expect(script).toContain("daemonApiUrl('/workspaces')");
  expect(script).toContain("const repoCount = Number(workspace.repo_count || 0)");
  expect(script).toContain("repoCount + ' repo'");
  expect(script).not.toContain("workspaceTypeLabelClient");
  expect(script).toContain("target.dataset.action === 'switch-workspace'");
  expect(script).toContain("await switchWorkspace(target.dataset.workspaceId, { updateDaemonCurrent: true })");
  expect(script).toContain("method: 'POST'");
  expect(script).toContain("workspaceAddKanbanPrefix");
  // EP-022 / WA-099: POST /workspaces body now includes rbacMode
  // (T3 tightened the create endpoint to require it; T8 wires the
  // 3-button picker into the modal so operator makes a conscious
  // choice).
  expect(script).toContain("rbacMode: workspaceAddRbacMode");
  expect(script).toContain("workspaceAddRbacMode = null");
  expect(html).toContain('id="workspaceAddRbacMode"');
  expect(html).toContain('data-action="select-add-rbac-mode"');
  expect(html).toContain('id="workspaceEditRbacMode"');
  expect(html).toContain('data-action="select-edit-rbac-mode"');
  expect(script).not.toContain("workspaceAddPath");
  expect(script).not.toContain("workspaceAddType");
});

test("renderWebShell includes multi-repo agent overview grouping hooks", () => {
  const config: WhatsAgentConfig = { fleet: { name: "t", root: "/tmp/t" }, ui: { host: "127.0.0.1", port: 4017 }, policy: { mode: "star" }, commands: { claudeCode: { command: "c", args: [] }, openCode: { command: "o", args: [] }, codex: { command: "x", args: [] }, pi: { command: "p", args: [] } } };
  const html = renderWebShell({
    root: "/tmp/t",
    config,
    roles: [
      { id: "1", name: "architect", path: ".", git_root: null, host_default: "claude-code", missing_at: null, last_discovered_at: "", created_at: "", updated_at: "" },
      { id: "2", name: "api", path: "services/api", git_root: "/tmp/t/services/api", host_default: "codex", missing_at: null, last_discovered_at: "", created_at: "", updated_at: "" },
    ],
    mainRole: null,
    runners: [],
    currentWorkspace: { id: "abc123", name: "demo" },
    workspacesAvailable: 1,
  });
  const script = clientSource;

  expect(agentsSource).toContain("function rolesForRepo(repo)");
  expect(agentsSource).toContain("const repos = state.repos || []");
  expect(agentsSource).not.toContain("const rows = state.currentWorkspace?.type === 'multi-repo'");
  expect(agentsSource).not.toContain("function repoNameForRole(role)");
  expect(agentsSource).not.toContain("role.path.split('/')[0]");
  expect(agentsSource).toContain("function repoGroupedAgentRows()");
  expect(agentsSource).toContain("agents-archive-board");
  expect(agentsSource).toContain("agents-repo-row repo-group-head");
  expect(agentsSource).toContain("data-action=\"open-add-agent\"");
  // Star-mode-no-main warning banner (rendered when policy=star + no mainRole + at least one agent).
  expect(agentsSource).toContain("function starModeMissingMainBanner()");
  expect(agentsSource).toContain("agent-overview-warning");
  expect(agentsSource).toContain("No main agent set.");
  expect(html).toContain(".agent-overview-warning");
  expect(agentsSource).toContain("data-repo-id=\"");
  expect(agentsSource).toContain("no agents yet");
  expect(agentsSource).toContain("archive-table-head agents-archive-head");
  expect(html).toContain(".agents-archive-board");
  expect(html).toContain(".agents-repo-row");
  expect(html).toContain(".agents-agent-row.agent-card");
});

test("renderWebShell includes Add Agent repo dropdown hooks", () => {
  const config: WhatsAgentConfig = { fleet: { name: "t", root: "/tmp/t" }, ui: { host: "127.0.0.1", port: 4017 }, policy: { mode: "star" }, commands: { claudeCode: { command: "c", args: [] }, openCode: { command: "o", args: [] }, codex: { command: "x", args: [] }, pi: { command: "p", args: [] } } };
  const html = renderWebShell({
    root: "/tmp/t",
    config,
    roles: [],
    mainRole: null,
    runners: [],
    currentWorkspace: { id: "abc123", name: "demo" },
    workspacesAvailable: 1,
  });

  expect(html).toContain('id="addAgentRepoRow"');
  expect(html).toContain('id="addAgentRepoContainer"');
  expect(html).toContain("Target repository");
  expect(agentsSource).toContain("let addAgentRepoId = ''");
  expect(agentsSource).toContain("function openAddAgentModal(repoId = '')");
  expect(agentsSource).toContain("addAgentRepoId = repoId || (state.repos || [])[0]?.id || ''");
  expect(agentsSource).toContain("const repoOptions = (state.repos || []).map(repo => [repo.id, repo.name + ' - ' + repo.absolutePath])");
  expect(agentsSource).toContain("data-add-agent-repo");
  expect(agentsSource).toContain("document.querySelector('[data-add-agent-repo-page]')?.value || document.querySelector('[data-add-agent-repo]')?.value");
  expect(agentsSource).toContain("repoId is required");
  expect(agentsSource).toContain("JSON.stringify({ repoId, name, host: runtime === 'default' ? null : runtime, persona: personaValuesFromInputs('add') })");
  expect(agentsSource).toContain("workspaceFetch('/roles-by-id'");
  expect(agentsSource).not.toContain("workspaceFetch('/roles',");
  expect(agentsSource).not.toContain("const paths = Array.from(new Set((state.roles || []).map(r => r.path)");
});

test("EP-037 WA-212: agent config pages use separate sub-view routes", () => {
  expect(clientSource).toContain("let agentsSubView = 'overview';");
  expect(clientSource).toContain("pageParts[1] === 'new'");
  expect(clientSource).toContain("pageParts[2] === 'settings'");
  expect(clientSource).toContain("renderAgentConfigPage(agentsConfigRole)");
  expect(clientSource).toContain("renderAgentCreatePage()");
  expect(clientSource).toContain("setAgentsSubView: (next, role = '')");
  expect(agentsSource).toContain("export function renderAgentCreatePage()");
  expect(agentsSource).toContain("export function renderAgentConfigPage(roleAddress)");
  expect(agentsSource).toContain("function personaSectionHtml(scope, persona)");
  expect(agentsSource).toContain("Start from template");
  expect(agentsSource).toContain("data-action=\"agent-config-cancel\"");
  expect(agentsSource).toContain("data-action=\"submit-agent-edit-page\"");
  expect(agentsSource).toContain("data-action=\"submit-add-agent-page\"");
  expect(agentsSource).toContain("Delete agent</button>");
  expect(agentsSource).toContain("agentPageMode === 'config'");
  expect(shellOverridesSource).toContain(".agent-config-page { max-width: 980px;");
});

test("Edit Agent flow targets /roles-by-id PATCH (EP-DEC-FIX B1)", () => {
  // EP-015 / WA-087: Edit Agent dialog must hit the new /roles-by-id PATCH
  // endpoint, not the legacy /roles/:name route which returns 410.
  expect(agentsSource).toContain("agentEditingRole = { id: role.id,");
  expect(agentsSource).toContain("workspaceFetch('/roles-by-id/' + encodeURIComponent(agentEditingRole.id)");
  expect(agentsSource).toContain("const body = { name, host: runtime === 'default' ? null : runtime };");
  expect(agentsSource).not.toMatch(/workspaceFetch\('\/roles\/' \+ encodeURIComponent\(agentEditingRole\.originalName\)/);
  expect(agentsSource).not.toContain("defaultHost: runtime === 'default'");
});

test("EP-DEC-RUN WA-006: workspace-wide name guard removed; bare-name address fallback gone", () => {
  // The pre-WA-006 workspace-wide name guard rejected any second role
  // with a bare name already used in the workspace; now display_id
  // routing makes the collision impossible and the guard is gone.
  expect(daemonSource).not.toContain("see WA-091");
  expect(daemonSource).not.toContain("listAgentsByWorkspace(ws.db).some((r) => r.name === canonicalName)");
  // resolveRoleAddress no longer falls back to bare-name lookup.
  expect(daemonSource).not.toMatch(/Bare-name fallback is intentional compat/);
  expect(daemonSource).toContain("EP-DEC-RUN WA-006: address resolution requires `repo:role`");
});

test("Delete Agent flow targets /roles-by-id DELETE (EP-DEC-FIX B2)", () => {
  // EP-015 / WA-088: Delete Agent overflow action must DELETE the new
  // /roles-by-id/:id endpoint (cascade-stops the attached runner) and not
  // fall back to the legacy /roles/:name route which returns 410.
  expect(agentsSource).toContain("workspaceFetch('/roles-by-id/' + encodeURIComponent(role.id)");
  expect(agentsSource).not.toMatch(/workspaceFetch\('\/roles\/' \+ encodeURIComponent\(roleName\), \{ method: 'DELETE' \}\)/);
  // 409 stop-failure surfaces both the error AND the runner reason.
  expect(agentsSource).toContain("respBody.reason");
});

test("renderWebShell includes role display id hooks for cards and messages", () => {
  const script = clientSource;

  expect(script).toContain("const roleDisplayId = (roleOrName) =>");
  expect(script).toContain("role?.display_id || role?.displayId || role?.name");
  expect(script).toContain("const roleByAddress = (address) => state.roles.find(r => r.name === address || roleDisplayId(r) === address)");
  expect(script).toContain("body: JSON.stringify({ toRole: roleDisplayId(selected), body })");
  expect(script).toContain("const selectedDisplayId = roleDisplayId(selected)");
  expect(script).toContain("const peers = selected ? peersForInbox(selectedDisplayId) : []");
  expect(script).toContain("const selectedMessages = selected ? messagesForPeerThread(selectedDisplayId, selectedPeer) : []");
  expect(script).toContain("selectedMessages.map(message => renderMessageBubble(message, selectedDisplayId))");
  expect(script).toContain("function renderMessageBubble(message, selectedRoleDisplayId)");
  expect(script).toContain("message.from_role_name === selectedRoleDisplayId");
  // EP-DEC-RUN WA-006 (advisor msg #24): per-role data-role attributes
  // identify by displayId. main.ts + agents.ts both bind `addr` locally
  // (`const addr = roleDisplayId(role)`) before emitting `esc(addr)`
  // into the data-role attribute, ensuring same-bare-name across repos
  // render distinctly.
  expect(script).toContain("const addr = roleDisplayId(role);");
  expect(script).toContain("esc(addr)");
  expect(agentsSource).toContain("function roleDisplayId(role) { return ctx().roleDisplayId(role); }");
  expect(agentsSource).toContain("agentCardBadges(online, missing, false)");
  expect(agentsSource).toContain("role.repo_name || role.repoName || ''");
  expect(agentsSource).toContain("const addr = roleDisplayId(role);");
});

test("renderWebShell includes Workspaces overview management UI hooks", () => {
  const config: WhatsAgentConfig = { fleet: { name: "t", root: "/tmp/t" }, ui: { host: "127.0.0.1", port: 4017 }, policy: { mode: "star" }, commands: { claudeCode: { command: "c", args: [] }, openCode: { command: "o", args: [] }, codex: { command: "x", args: [] }, pi: { command: "p", args: [] } } };
  const html = renderWebShell({
    root: "/tmp/t",
    config,
    roles: [],
    mainRole: null,
    runners: [],
    currentWorkspace: { id: "abc123", name: "demo" },
    workspacesAvailable: 1,
  });
  const script = clientSource;

  expect(script).toContain("daemonApiUrl('/workspaces?include_trash=1')");
  expect(script).toContain("data-action=\"select-workspaces-tab\"");
  expect(script).toContain("data-action=\"open-workspace-edit\"");
  expect(script).toContain("data-action=\"delete-workspace\"");
  expect(script).toContain("data-action=\"restore-workspace\"");
  expect(script).toContain("data-action=\"purge-workspace\"");
  expect(script).toContain("data-action=\"set-trash-retention\"");
  expect(script).toContain("daemonApiUrl('/settings/trash-retention-days')");
  expect(html).toContain("id=\"workspaceEditModal\"");
  expect(html).toContain("id=\"workspaceEditGeneralSection\"");
  // Repos + scan-dirs management lifted to the Agents page (post-WA-094).
  expect(html).not.toContain("id=\"workspaceEditReposSection\"");
  expect(html).not.toContain("id=\"workspaceEditScanDirsSection\"");
  expect(html).not.toContain("id=\"workspaceRepoAddPath\"");
  expect(html).not.toContain("id=\"workspaceScanDirAddPath\"");
  expect(html).toContain("id=\"repoEditModal\"");
  expect(html).toContain("id=\"repoEditPath\"");
  expect(html).toContain("id=\"scanDirsManageModal\"");
  expect(html).toContain("id=\"scanDirsManageList\"");
  expect(html).toContain("data-action=\"submit-repo-edit\"");
  expect(html).toContain("data-action=\"add-scan-dir\"");
  expect(html).not.toContain("id=\"workspaceEditPath\"");
  expect(html).not.toContain("id=\"workspaceEditType\"");
  expect(html).not.toContain("id=\"workspaceEditMultiAgentToggle\"");
  expect(html).toContain("id=\"confirmModal\"");
  expect(html).toContain(".workspace-card");
  expect(html).toContain(".workspaces-overview-page");
  expect(script).not.toContain("loadWorkspaceEditCollections(id)");
  expect(script).not.toContain("data-action=\"add-workspace-repo\"");
  expect(script).not.toContain("data-action=\"toggle-workspace-scan-startup\"");
  expect(agentsSource).toContain("data-action=\"open-add-repo\"");
  expect(agentsSource).toContain("data-action=\"open-edit-repo\"");
  expect(agentsSource).toContain("data-action=\"delete-repo\"");
  expect(agentsSource).toContain("data-action=\"open-manage-scan-dirs\"");
  expect(agentsSource).toContain("data-action=\"refresh-all-scan-dirs\"");
  expect(agentsSource).toContain("data-action=\"toggle-scan-dir-startup\"");
  expect(script).toContain("Kanban prefix is required.");
  expect(script).toContain("e.target?.closest?.('#workspaceEditGeneralSection')");
  expect(script).not.toContain("e.target?.closest?.('#workspaceEditModal')");
  expect(script).not.toContain("'/settings/multi-agent'");
  expect(script).not.toContain("workspace-card-path");
  expect(script).not.toContain("currentPath");
});

test("renderWebShell frames workspace settings without legacy edit toggles", () => {
  const config: WhatsAgentConfig = { fleet: { name: "t", root: "/tmp/t" }, ui: { host: "127.0.0.1", port: 4017 }, policy: { mode: "star" }, commands: { claudeCode: { command: "c", args: [] }, openCode: { command: "o", args: [] }, codex: { command: "x", args: [] }, pi: { command: "p", args: [] } } };
  const html = renderWebShell({
    root: "/tmp/t",
    config,
    roles: [],
    mainRole: null,
    runners: [],
    currentWorkspace: { id: "abc123", name: "demo" },
    workspacesAvailable: 1,
  });
  const script = clientSource;

  expect(script).toContain("function settingsWorkspaceSubtitle");
  expect(script).toContain("settings-scope-badge");
  expect(script).toContain("data-settings-scope");
  // Workspace-messaging panel text moved to settings.ts.
  expect(settingsSource).toContain("Workspace messaging");
  expect(script).toContain("this workspace");
  expect(script).toContain("'Global'");
  expect(script).toContain("Applies to current workspace");
  expect(script).not.toContain("multiAgentPerRepo");
  expect(script).not.toContain("'/settings/multi-agent'");
  expect(script).not.toContain("'set-workspace-edit-multi-agent'");
  expect(html).not.toContain("data-action=\"set-workspace-edit-multi-agent\"");
  expect(html).not.toContain(".multi-agent-setting");
  expect(html).toContain(".settings-scope-badge");
});

test("EP-015 WA-052: settings panels use scope badges instead of subtitle text", () => {
  expect(clientSource).toContain("settings-scope-badge");
  expect(clientSource).toContain("data-settings-scope");
  expect(clientSource).not.toContain("settings-current-workspace");
  expect(clientSource).not.toContain("Daemon-wide");
  expect(clientSource).toContain("Applies to current workspace");
  expect(clientSource).toContain("'Global'");
  expect(shellOverridesSource).toContain(".settings-with-subnav .section-head h2 { display: inline-flex;");
  expect(settingsSource).toContain("<h2>Workspace messaging</h2>' + settingsWorkspaceSubtitle('workspace')");
  expect(agentsSource).toContain("<h2>Runtime</h2>' + settingsWorkspaceSubtitle('daemon')");
  expect(settingsSource).toContain("<h2>Prompts</h2>' + settingsWorkspaceSubtitle('daemon')");
});

test("EP-002 WA-007: repo/role snapshot tracked alongside runner snapshot so direct /agents URL recovers from empty server-injected state", () => {
  // Repo + role list changes between polls trigger a render so the
  // "No repositories yet" empty state recovers without a sidebar click.
  expect(clientSource).toContain("function repoRoleSnapshotFor");
  expect(clientSource).toContain("let repoRoleSnapshot");
  expect(clientSource).toContain("repoRoleSnapshotFor(state)");
  // The base pollStatus carries the gate but is replaced by codexPollStatus
  // at install time (`installCodex` overwrites pollStatus). Both must carry
  // the new logic so the live poll path actually rerenders on repo/role
  // changes — advisor msg #36 caught this dead-path bug.
  expect(codexSource).toContain("function repoRoleSnapshotFor");
  expect(codexSource).toContain("getRepoRoleSnapshot");
  expect(codexSource).toContain("setRepoRoleSnapshot");
  expect(codexSource).toContain("const nextRepoRole = repoRoleSnapshotFor(nextState)");
  expect(codexSource).toContain("repoRoleChanged");
  // ctx must surface the snapshot accessors so codex.ts can read/write them.
  expect(clientSource).toContain("getRepoRoleSnapshot:");
  expect(clientSource).toContain("setRepoRoleSnapshot:");
  expect(clientSource).toContain("repoRoleSnapshotFor:");
  // Boot path also kicks one refresh() so visiting a URL directly does
  // not sit on stale/empty server state until the first 1s poll.
  expect(clientSource).toMatch(/renderInitialUiAfterExtensions[\s\S]*void refresh\(\);/);
});

test("EP-004 WA-015: unified outside-click + Escape dismiss registry covers every dropdown surface", () => {
  // Single helper at the main.ts top level: a registry list driven by a
  // doc-level click + keydown handler. Replaces the per-callsite gaps in
  // the empty-target paths of agents.ts + main.ts tui-bar dispatchers.
  expect(clientSource).toContain("const dropdownDismissers = [];");
  expect(clientSource).toContain("function bindDropdownDismiss");
  expect(clientSource).toMatch(/document\.addEventListener\('click'[\s\S]{0,300}for \(const spec of dropdownDismissers\)/);
  expect(clientSource).toMatch(/document\.addEventListener\('keydown'[\s\S]{0,200}e\.key !== 'Escape'/);
  // ctx surface so peer modules can register.
  expect(clientSource).toContain("bindDropdownDismiss: (spec) => bindDropdownDismiss(spec)");
  // Main.ts surfaces register: launch menu + tui-bar.
  expect(clientSource).toContain("rootSelector: '.launch-split, .launch-menu'");
  expect(clientSource).toContain("rootSelector: '.terminal-toolbar'");
  // agents.ts surfaces: sort menu + header overflow + repo overflow + agent card overflow.
  expect(agentsSource).toContain("rootSelector: '.agent-sort-menu'");
  expect(agentsSource).toContain("rootSelector: '.agents-overview-header'");
  expect(agentsSource).toContain("rootSelector: '.repo-group'");
  expect(agentsSource).toContain("rootSelector: '.agent-card'");
  // messages.ts: channel export popover.
  expect(messagesSource).toContain("rootSelector: '.channel-export-menu'");
});

test("EP-010 WA-042: TUI Quick Prompts toolbar inserts without newline", () => {
  expect(clientSource).toContain("let quickPrompts = null;");
  expect(clientSource).toContain("function tuiBarPromptsControl(roleName)");
  expect(clientSource).toContain("data-action=\"tui-bar-toggle-prompts\"");
  expect(clientSource).toContain("data-action=\"insert-quick-prompt\"");
  expect(clientSource).toContain("class=\"tui-prompt-title\"");
  expect(clientSource).toContain("class=\"btn small tui-prompt-insert\"");
  expect(clientSource).toContain("fetch(daemonApiUrl('/settings/custom-prompts'))");
  expect(clientSource).toContain("fetch(daemonApiUrl('/settings/agent-text'))");
  expect(clientSource).toContain("const QUICK_PROMPT_ENABLED_RUNTIMES = new Set(['claude-code', 'opencode', 'codex', 'pi']);");
  expect(clientSource).toContain("QUICK_PROMPT_ENABLED_RUNTIMES.has(runner?.host_type)");
  expect(clientSource).toContain("body) void sendTerminalInput(body, true);");
  expect(clientSource).toMatch(/tuiBarLaunchControl\(role\)[\s\S]{0,120}tuiBarPromptsControl\(role\)[\s\S]{0,120}tuiBarDisplayControl\(\)/);
  expect(shellOverridesSource).toContain(".tui-prompts-popover");
  expect(shellOverridesSource).toContain(".tui-prompt-title");
  expect(shellOverridesSource).toContain(".tui-prompt-insert.btn.small");
  expect(shellOverridesSource).toContain(".tui-prompt-row textarea");
});

test("EP-015 WA-053: Quick Prompts popover title and Insert sizing are polished", () => {
  expect(clientSource).toContain("class=\"tui-prompt-title\"");
  expect(clientSource).toContain("class=\"btn small tui-prompt-insert\"");
  expect(shellOverridesSource).toContain("font-family: var(--font-ui); font-size: 13px; font-weight: 850;");
  expect(shellOverridesSource).toContain("min-width: 58px; height: var(--control-h); padding: 0 var(--control-px);");
  expect(shellOverridesSource).toContain(".tui-prompt-insert.btn.small { flex: 0 0 auto; width: auto;");
});

test("EP-015 WA-054: Prompts expanders use rounded cosmetic polish", () => {
  expect(settingsSource).toContain("prompt-expander-chevron");
  expect(shellOverridesSource).toContain(".prompt-expander { overflow: hidden; border: 1px solid var(--border); border-radius: 14px;");
  expect(shellOverridesSource).toContain(".prompt-expander-chevron.btn.small { min-width: var(--control-h); height: var(--control-h);");
  expect(shellOverridesSource).toContain(".prompt-expander-body .setting-input { width: 100%; min-height: var(--control-h); padding: 0 var(--control-px); border: 1px solid var(--border); border-radius: 8px; background: var(--field);");
  expect(shellOverridesSource).toContain(".prompt-expander-body textarea { width: 100%; min-height: 90px; resize: vertical; border: 1px solid var(--border); border-radius: 10px;");
});

test("EP-015 WA-055: custom prompt editor drops Edit Title and confirms delete", () => {
  expect(settingsSource).not.toContain("edit-custom-prompt-title");
  expect(settingsSource).not.toContain("Edit Title");
  expect(settingsSource).toContain("function openConfirm(opts) { return ctx().openConfirm(opts); }");
  expect(settingsSource).toContain("Delete custom prompt?");
  expect(settingsSource).toContain("confirmLabel: 'Delete', danger: true");
});

test("EP-010 WA-043: Codex pending nudge opens Quick Prompts once", () => {
  expect(clientSource).toContain("let openQuickPromptsForNudge = () => false;");
  expect(clientSource).toContain("const tuiPromptsAutoOpenedForNudge = {};");
  expect(clientSource).toContain("openQuickPromptsForNudge = function openQuickPromptsForNudge(roleName, nudgeKey)");
  expect(clientSource).toContain("tuiBarOpenMenu = 'prompts';");
  expect(clientSource).toContain("pendingNudge.submitted_at || pendingNudge.queued_at");
  expect(codexSource).toContain("Use Prompts to insert the inbox nudge");
});

test("EP-008 WA-034: Settings User tab wires auth account controls", () => {
  expect(settingsSource).toContain("'user'");
  expect(settingsSource).toContain("function userPanel()");
  expect(settingsSource).toContain("/auth/change-password");
  expect(settingsSource).toContain("/auth/sessions/sign-out-others");
  expect(settingsSource).toContain("/auth/regenerate-recovery");
  expect(settingsSource).not.toContain("data-action=\"auth-logout\"");
});

test("EP-015 WA-056: Settings User layout drops logout and promotes recovery", () => {
  expect(settingsSource).toContain("class=\"user-account-name mono\"");
  expect(settingsSource).toContain("class=\"auth-recovery-actions\"");
  expect(settingsSource).toContain("data-auth-recovery-result");
  expect(settingsSource).not.toContain("Log out this session");
  expect(shellOverridesSource).toContain(".auth-recovery-actions { display: flex;");
});

test("EP-015 WA-057: Settings User password change uses modal dialog", () => {
  expect(settingsSource).toContain("function authPasswordModal()");
  expect(settingsSource).toContain("data-action=\"open-auth-password-modal\"");
  expect(settingsSource).toContain("data-action=\"close-auth-password-modal\"");
  expect(settingsSource).toContain("data-auth-confirm-password");
  expect(settingsSource).toContain("new passwords do not match");
  expect(settingsSource).not.toContain("placeholder=\"Current password\"");
  expect(shellOverridesSource).toContain(".auth-password-modal { width: min(440px, 100%); }");
});

test("EP-015 WA-058: Settings User sessions show agent and last seen", () => {
  expect(settingsSource).toContain("function authSessionLabel(session)");
  expect(settingsSource).toContain("session.user_agent || 'Unknown browser'");
  expect(settingsSource).toContain("function authSessionLastSeen(session)");
  expect(settingsSource).toContain("class=\"auth-session-agent\"");
  expect(settingsSource).toContain("class=\"auth-session-last-seen\"");
  expect(settingsSource).not.toContain("<span class=\"mono\">' + esc(s.id)");
  expect(shellOverridesSource).toContain(".auth-session-agent { color: var(--text-strong);");
});

test("EP-015 WA-059: Settings About uses identity card", () => {
  expect(settingsSource).toContain("class=\"card settings-wide about-card\"");
  expect(settingsSource).toContain("class=\"about-wordmark\">WhatsAgent</div>");
  expect(settingsSource).toContain("Messaging and task tracking for coding agents.");
  expect(settingsSource).toContain("Your agents collaborate, not just compute.");
  expect(settingsSource).toContain("v' + esc(version) + '-beta");
  expect(settingsSource).toContain("' + esc(build) + '");
  expect(settingsSource).toContain("Ivan Mak");
  expect(settingsSource).toContain("function aboutAppIconImg(): string");
  expect(settingsSource).toContain("/assets/icons/whatsagent-' + accent + '-256.png");
  expect(settingsSource).toContain("/assets/icons/whatsagent-' + accent + '-512.png 2x");
  expect(settingsSource).toContain("class=\"about-app-icon\" src=");
  expect(settingsSource).toContain("https://github.com/ivanmak/whatsagent");
  expect(settingsSource).toContain("MIT License");
  expect(settingsSource).not.toContain("Version policy");
  expect(settingsSource).not.toContain("function aboutAppIconSvg");
  expect(settingsSource).not.toContain("ABOUT_ICON_NODES");
  expect(settingsSource).not.toContain("/assets/icons/whatsagent-indigo-128.png");
  expect(shellOverridesSource).toContain(".about-hero { position: relative;");
  expect(shellOverridesSource).toContain(".about-network { position: absolute;");
  expect(shellOverridesSource).toContain(".about-wordmark");
  expect(shellOverridesSource).toContain("@media (max-width: 720px)");
});

test("EP-008 WA-035: sidebar logout and global 401 redirect are wired", () => {
  const { html, script } = renderNotificationShell();
  expect(html).toContain("data-action=\"auth-logout\"");
  expect(html).toContain("aria-label=\"Log out\"");
  expect(script).toContain("function redirectToLogin()");
  expect(script).toContain("if (res.status === 401 && isDaemonApiRequest(input)) redirectToLogin();");
  expect(script).toContain("if (action === 'auth-logout') logoutWebSession();");
});

test("EP-003 fix-up (advisor msg #40): roleAvatarWithPresence keys runner lookup on display_id, openKanbanTask closes the epic drawer, DAG NODE_H bumped to 132", () => {
  // 1) Presence dot must not collide on bare role.name across repos.
  expect(clientSource).toContain("Boolean(runnerFor(addr))");
  expect(clientSource).not.toMatch(/function roleAvatarWithPresence[\s\S]{0,400}runnerFor\(roleName\)/);
  // 2) Opening a task from the epics tab must dismiss the epic drawer so the two sidebars don't both grab grid column 2 row 2.
  expect(kanbanSource).toMatch(/function openKanbanTask[\s\S]{0,800}kanbanEpicDrawerId = '';/);
  // 3) DAG NODE_H sized for the unified card (repo:role + 2-line title +
  //    meta + bottom-right id). Was 92 → 110 → 132 as title-clamp 2nd line
  //    kept colliding with the meta row on long titles.
  expect(kanbanSource).toContain("NODE_H = 132");
  expect(kanbanSource).not.toContain("NODE_H = 110");
  expect(kanbanSource).not.toContain("NODE_H = 92");
});

test("EP-003 WA-014: epic detail = in-grid sidebar (no overlay, no backdrop), parity with task detail", () => {
  // Backdrop element gone from every render path of renderKanbanEpicDrawer.
  expect(kanbanSource).not.toContain("kanban-epic-drawer-backdrop");
  // aria-modal="true" + role="dialog" replaced with role="complementary".
  expect(kanbanSource).not.toMatch(/kanban-epic-drawer"[^"]*role="dialog"[^"]*aria-modal="true"/);
  expect(kanbanSource).toContain("className: 'kanban-epic-drawer'");
  expect(kanbanSource).toContain("ariaLabel: 'Epic details'");
  // CSS converted from `position: fixed` overlay to in-grid sidebar.
  expect(shellOverridesSource).not.toMatch(/\.kanban-epic-drawer \{[^}]*position: fixed/);
  expect(shellOverridesSource).toContain(".kanban-page-epics.kanban-epic-drawer-open");
  // Mobile fallback parity with .kanban-detail (`@media (max-width: 960px)`).
  expect(shellOverridesSource).toContain("@media (max-width: 960px) { .kanban-page-epics.kanban-epic-drawer-open");
  // Escape close path retained; focus trap removed (advisor msg #34).
  expect(kanbanSource).toContain("closeKanbanEpicDetails();");
  expect(kanbanSource).not.toContain("focusables[focusables.length - 1]");
});

test("EP-003 WA-013: epic dep card unified with kanban board card via shared renderKanbanCardCore", () => {
  // Single helper renders board card + epic full-width row + DAG node body.
  expect(kanbanSource).toContain("function renderKanbanCardCore");
  expect(kanbanSource).toContain("function taskRepoRoleLabel");
  // DAG node markup now uses the helper with repoLine + kanban-card-dag class.
  expect(kanbanSource).toMatch(/renderKanbanCardCore\(task, \{[\s\S]{0,200}extraClass: 'kanban-card-dag kanban-epic-dag-card'/);
  expect(kanbanSource).toContain("repoLine: taskRepoRoleLabel(task)");
  // Title uses the shared truncation tooltip hook; native title= is avoided to prevent double tips.
  expect(kanbanSource).toMatch(/<span class="kanban-card-title" ' \+ truncatedAttrs\(title\)/);
  expect(kanbanSource).not.toMatch(/<span class="kanban-card-title" title=/);
  // "Assigned to" label gone everywhere.
  expect(kanbanSource).not.toContain("Assigned to ");
  // Bottom-right kanban-id positioning lives in shell-overrides.
  expect(shellOverridesSource).toContain(".kanban-card-dag .kanban-id");
  expect(shellOverridesSource).toContain("position: absolute");
  expect(shellOverridesSource).toContain(".kanban-card-repo-line");
});

test("EP-037 WA-218: kanban assignee surfaces persona description", () => {
  expect(kanbanSource).toContain("function rolePersonaDescription(role)");
  expect(kanbanSource).toContain("kanban-lane-agent-desc");
  expect(kanbanSource).toContain("kanban-detail-persona");
  expect(shellOverridesSource).toContain(".kanban-lane-agent .kanban-lane-agent-desc");
  expect(shellOverridesSource).toContain(".kanban-detail-grid .kanban-detail-persona");
});

test("EP-003 WA-012: kanban + epic board column header renamed Repo & Agent; lane head shows repoName + roleName + identicon", () => {
  // Both board surfaces (kanbanBoard + renderKanbanBoardForTasks) use the new label.
  expect(kanbanSource).not.toContain('"kanban-board-agent-head">Agent</div>');
  expect(kanbanSource).toContain('"kanban-board-agent-head">Repo &amp; Agent</div>');
  // Lane head wraps repoName + roleName via laneAgentHtml; new helpers in source.
  expect(kanbanSource).toContain("function laneRepoName");
  expect(kanbanSource).toContain("function laneAgentHtml");
  expect(kanbanSource).toContain("kanban-lane-agent-repo");
  expect(kanbanSource).toContain("kanban-lane-agent-name");
  expect(kanbanSource).toContain("kanban-lane-agent-count");
  // EP-007 WA-028: lane grouping normalizes known roles to displayId so
  // bare role.name and assigned repo:role rows do not render duplicate lanes.
  expect(kanbanSource).toContain("function roleDisplayName(role)");
  expect(kanbanSource).toContain("function kanbanLaneName(assignedRoleName)");
  expect(kanbanSource).toContain("const roleNames = (getState().roles || []).map(role => roleDisplayName(role));");
  expect(kanbanSource).toContain("tasks.filter(task => kanbanLaneName(task.assigned_role_name) === name)");
  expect(kanbanSource).toContain("data-lane-name=\"' + esc(lane.name) + '\"");
  // CSS lays out the two-line label and clamps width.
  expect(shellOverridesSource).toContain(".kanban-lane-agent .kanban-lane-agent-repo");
  expect(shellOverridesSource).toContain(".kanban-lane-agent .kanban-lane-agent-name");
});

test("EP-003 WA-011: avatars use shared identiconFor() across messaging, kanban lanes, epic drawer + dep node", () => {
  // main.ts roleAvatarGrid is now an identiconFor() adapter (was the
  // legacy 5x5 CSS-grid renderer). roleAvatarWithPresence + messagePeerAvatar
  // funnel through it, so messaging picks up the swap automatically.
  expect(clientSource).toContain('import { identiconFor } from "./identicon.ts"');
  expect(clientSource).toContain("function identiconSeedForRole");
  expect(clientSource).toMatch(/function roleAvatarGrid[\s\S]*identiconFor\(seed/);
  // kanban.ts replaces both the DAG-node initials chip and the epic-drawer
  // head initials chip with a shared kanbanIssueIdenticon() helper.
  expect(kanbanSource).toContain('import { identiconFor } from "./identicon.ts"');
  expect(kanbanSource).toContain("function kanbanIssueIdenticon");
  // EP-003 WA-013 drops the DAG-node identicon (DAG card now mirrors the
  // avatar-less board card). Keep coverage on the epic drawer head + the
  // unassigned-lane fallback in renderKanbanLane.
  expect(kanbanSource).toContain("kanbanIssueIdenticon(epic.assigned_role_name");
  expect(kanbanSource).toContain("kanbanIssueIdenticon(lane.name");
  // Initials chip text is gone from both surfaces.
  expect(kanbanSource).not.toContain("split(/\\s+/).map((part) => part.charAt(0).toUpperCase()).slice(0, 2).join('') || '?'");
  expect(kanbanSource).not.toContain("split(/\\s+/).map(part => part.charAt(0).toUpperCase()).slice(0, 2).join('') || '?'");
  // CSS wrapper now sizes + clips an inner svg; legacy 5x5 grid rule removed.
  expect(shellOverridesSource).toContain(".role-avatar > svg");
  expect(shellOverridesSource).not.toContain("grid-template-columns: repeat(5, 1fr); grid-template-rows: repeat(5, 1fr)");
});

test("EP-002 WA-010: TUI Display popover lays groups side-by-side and scrolls when viewport is short", () => {
  // Popover used to stack option groups one-per-row; now uses a 2-col
  // grid with a clamped max-height so a small viewport doesn't push the
  // popover off the screen.
  expect(shellOverridesSource).toContain("grid-template-columns: repeat(2, minmax(180px, 1fr))");
  expect(shellOverridesSource).toContain("max-height: min(70vh, 480px)");
  expect(shellOverridesSource).toMatch(/\.tui-display-popover[^}]*overflow-y: auto/);
  // Narrow viewports collapse back to single column.
  expect(shellOverridesSource).toContain("@media (max-width: 600px) { .tui-display-popover");
});

test("EP-002 WA-009: pollStatus rerenders when active role's runner transitions to reachable, and launch updates URL", () => {
  // After launch(), the daemon usually flips the runner to reachable on
  // the next /status poll. Without this guard the previous render mounted
  // the offline placeholder and pollStatus skipped the transition render,
  // so the TUI never showed until F5.
  // codex.ts hosts the LIVE poller (installCodex replaces base pollStatus).
  // Per advisor msg #36, this gate must live there too.
  expect(codexSource).toContain("activeBecameReachable");
  expect(codexSource).toContain("previousActive?.reachable");
  // launch() now calls updateUrl() before the await refresh() so the
  // browser URL reflects the freshly-launched role's TUI tab; F5 lands
  // back on the role rather than dropping to overview.
  expect(clientSource).toMatch(/activeTerminal = targetDisplayId;[\s\S]*updateUrl\(\);[\s\S]*await refresh\(\);/);
});

test("EP-002 WA-008: TUI tabs render two-line repoName/roleName label with single-line fallback when repo unknown", () => {
  // Tab text contract: line 1 repo display name, line 2 role display name;
  // fall back to single-line role name only when the repo can't be
  // resolved (advisor msg #34).
  expect(clientSource).toContain("function agentTabLabelHtml");
  expect(clientSource).toContain("term-tab-label-repo");
  expect(clientSource).toContain("term-tab-label-name");
  expect(clientSource).toContain("function repoForRoleLookup");
  // CSS hooks for the two-line layout live in shell-overrides.
  expect(shellOverridesSource).toContain(".term-tab .term-tab-label");
  expect(shellOverridesSource).toContain(".term-tab .term-tab-label-repo");
  expect(shellOverridesSource).toContain(".term-tab .term-tab-label-name");
});

test("EP-005 WA-021: Agents Overview tab is pinned while agent tabs scroll", () => {
  expect(clientSource).toContain("term-tab agent-overview-tab");
  expect(clientSource).toContain("<div class=\"tabbar-scroll\">' + tabs + '</div>");
  expect(shellOverridesSource).toContain(".agent-page .tabbar { display: flex; flex: 0 0 auto; min-width: 0; overflow: hidden; }");
  expect(shellOverridesSource).toContain(".agent-page .agent-overview-tab { flex: 0 0 auto; border-right: 1px solid var(--border); }");
  expect(shellOverridesSource).toContain(".agent-page .tabbar-scroll { flex: 1 1 auto; min-width: 0; overflow-x: auto; overflow-y: hidden; display: flex; scrollbar-width: thin; }");
  expect(shellOverridesSource).toContain(".agent-page .tabbar-scroll .term-tab { flex: 0 0 auto; }");
});

test("RBAC Phase 3 slice 6: Audit subtab renders + wires audit endpoint", async () => {
  // Inner-tabbar gains a 3rd subtab for Audit.
  expect(settingsSource).toContain("data-rbac-subtab=\"audit\"");
  // Plain-English filter labels (raw kind names appear only in detail expander).
  // WA-091: copy refresh — 'Missing grant' became 'Missing grant (legacy)'
  // for soft rows; hard-deny rows label as 'Denied'.
  expect(settingsSource).toContain("'Missing grant (legacy)'");
  expect(settingsSource).toContain("'Denied'");
  expect(settingsSource).toContain("'Grant check passed'");
  // Filter pills + tooltip wiring.
  expect(settingsSource).toContain("data-action=\"rbac-audit-set-kind\"");
  expect(settingsSource).toContain("data-action=\"rbac-audit-set-window\"");
  expect(settingsSource).toContain("data-action=\"rbac-audit-clear-filters\"");
  expect(settingsSource).toContain("data-action=\"rbac-audit-toggle-row\"");
  expect(settingsSource).toContain("data-action=\"rbac-audit-prev\"");
  expect(settingsSource).toContain("data-action=\"rbac-audit-next\"");
  // Endpoint path.
  expect(settingsSource).toContain("'/audit?'");
  // Pill class hooks for the four-colour palette.
  expect(settingsSource).toContain("grant-pill expected");
  expect(settingsSource).toContain("grant-pill has-exact");
  expect(settingsSource).toContain("grant-pill has-close");
  expect(settingsSource).toContain("grant-pill has-none");
  // CSS palette: blue/yellow/green/red soft variants for grant pills.
  expect(shellOverridesSource).toContain(".audit-table .grant-pill.expected");
  expect(shellOverridesSource).toContain(".audit-table .grant-pill.has-exact");
  expect(shellOverridesSource).toContain(".audit-table .grant-pill.has-close");
  expect(shellOverridesSource).toContain(".audit-table .grant-pill.has-none");
  // Daemon endpoint exists.
  expect(daemonSource).toContain("listAuditEndpoint");
  expect(daemonSource).toContain("rest === \"audit\"");
});

test("RBAC Phase 3 slice 5b: Add Agent modal exposes Roles multi-select with name-driven defaults", async () => {
  const shellHtml = await readFile(new URL("../src/web/shell.ts", import.meta.url), "utf8");
  expect(shellHtml).toContain('id="addAgentRolesPicker"');
  // Same chip CSS hooks as the edit modal.
  expect(shellHtml.includes('class="agent-edit-roles"') && shellHtml.includes('id="addAgentRolesPicker"')).toBe(true);
  // Client wires distinct toggle action so the edit-modal handler does not
  // collide with the add-modal handler when both share the markup pattern.
  expect(agentsSource).toContain("data-action=\"toggle-add-agent-role\"");
  expect(agentsSource).toContain("function toggleAddAgentRole");
  expect(agentsSource).toContain("loadAddAgentRoles");
  expect(agentsSource).toContain("applyAddAgentNameDefault");
  expect(agentsSource).toContain("NAME_DEFAULTS_FOR_NEW_AGENT");
  // Defaults map mirrors the v15 migration seed for parity.
  expect(agentsSource).toContain("'main'");
  expect(agentsSource).toContain("'human-web'");
  // Submit path PUTs the role assignment after the POST creates the agent.
  expect(agentsSource).toContain("'/agents/' + encodeURIComponent(newAgentId) + '/roles'");
});

test("RBAC Phase 3 slice 5: Agent edit modal exposes a Roles multi-select", async () => {
  // Modal markup gains the roles picker container + help text in shell.ts.
  const shellHtml = await readFile(new URL("../src/web/shell.ts", import.meta.url), "utf8");
  expect(shellHtml).toContain('id="agentEditRolesPicker"');
  expect(shellHtml).toContain('class="agent-edit-roles"');
  expect(shellHtml).toContain('class="agent-edit-roles-help"');

  // Client wires the toggle action + the load + save paths.
  expect(agentsSource).toContain("data-action=\"toggle-agent-edit-role\"");
  expect(agentsSource).toContain("function toggleAgentEditRole");
  expect(agentsSource).toContain("loadAgentEditRoles");
  expect(agentsSource).toContain("'/rbac/roles'");
  expect(agentsSource).toContain("'/agents/' + encodeURIComponent(agentEditingRole.id) + '/roles'");
  // Submit path PUTs the assignment set with `role_ids` body.
  expect(agentsSource).toContain("role_ids: Array.from(agentEditAssignedRoleIds)");

  // CSS hooks for the chip picker.
  expect(shellOverridesSource).toContain(".agent-edit-roles .agent-role-chip");
  expect(shellOverridesSource).toContain(".agent-edit-roles .agent-role-chip.selected");
  expect(shellOverridesSource).toContain(".agent-edit-roles-help");
});

test("WA-089 (RBAC Phase 4 slice 4-8): operator promoted to top-level checkbox in Add + Edit Agent modals", async () => {
  const shellHtml = await readFile(new URL("../src/web/shell.ts", import.meta.url), "utf8");
  // Add modal: checkbox markup with helper text.
  expect(shellHtml).toContain('id="addAgentOperatorCheckbox"');
  expect(shellHtml).toContain('Acts on behalf of human');
  expect(shellHtml).toContain('Marks this agent as a human surrogate.');
  // Edit modal: same fields under unique id.
  expect(shellHtml).toContain('id="agentEditOperatorCheckbox"');
  // Helper class hooks for CSS.
  expect(shellHtml).toContain('class="agent-operator-checkbox-label"');
  expect(shellHtml).toContain('class="agent-operator-checkbox-help"');

  // Client wires checkbox change events to operator-only role-assignment toggle.
  expect(agentsSource).toContain("function toggleAddAgentOperatorCheckbox");
  expect(agentsSource).toContain("function toggleAgentEditOperatorCheckbox");
  // Both modals filter the operator chip out of the role picker so the
  // checkbox is the single source of truth.
  expect(agentsSource).toContain("r.name === 'operator' && r.is_builtin");
  // Sync helpers ensure the checkbox state mirrors the assigned-set after
  // role data loads (or after typing into the Name field for the Add modal).
  expect(agentsSource).toContain("syncAddAgentOperatorCheckbox");
  expect(agentsSource).toContain("syncAgentEditOperatorCheckbox");

  // CSS hooks.
  expect(shellOverridesSource).toContain(".agent-operator-checkbox-label");
  expect(shellOverridesSource).toContain(".agent-operator-checkbox-help");
});

test("WA-090 (RBAC Phase 4 slice 4-9): audit subtab gates Export CSV button on audit_admin permission", async () => {
  const settingsSource = await readFile(new URL("../src/web/client/settings.ts", import.meta.url), "utf8");
  // State carries the permissions object surfaced by /audit response.
  expect(settingsSource).toContain("rbacAuditPermissions");
  expect(settingsSource).toContain("body.permissions");
  expect(settingsSource).toContain("audit_admin: false");

  // Toolbar renders only when audit_admin is true.
  expect(settingsSource).toContain("rolesAuditAdminToolbarHtml");
  expect(settingsSource).toContain("rbacAuditPermissions.audit_admin");
  expect(settingsSource).toContain('data-action="rbac-audit-export-csv"');
  // Hint text references the grant name so operators understand the gate.
  expect(settingsSource).toContain("Requires audit_admin grant");

  // Click handler fires the download path which hits /audit/export.
  expect(settingsSource).toContain("function exportRbacAuditCsv");
  expect(settingsSource).toContain("'/audit/export?'");
  // CSV download uses Blob + anchor click with .csv filename suffix.
  expect(settingsSource).toContain("'audit-export-' + new Date().toISOString().replace");
  expect(settingsSource).toContain("URL.createObjectURL");
  expect(settingsSource).toContain("URL.revokeObjectURL");

  // CSS hooks for the toolbar.
  expect(shellOverridesSource).toContain(".audit-admin-toolbar");
  expect(shellOverridesSource).toContain(".audit-admin-toolbar-hint");
});

test("EP-023 / WA-104 — xtermDebugCapture pref + ring buffer + shipper wiring", () => {
  // Pref lands in DEFAULT_PREFS and normalizePreferences with explicit
  // false coercion so we never accidentally enable capture on a stale
  // localStorage payload.
  expect(clientSource).toContain("xtermDebugCapture: false");
  expect(clientSource).toContain("xtermDebugCapture: source.xtermDebugCapture === true");

  // Capture core constants pinned so tuning lives in one place.
  expect(clientSource).toContain("DEBUG_CAPTURE_BUFFER_MAX = 500");
  expect(clientSource).toContain("DEBUG_CAPTURE_BATCH_MAX = 50");
  expect(clientSource).toContain("DEBUG_CAPTURE_DEBOUNCE_MS = 1000");
  expect(clientSource).toContain("DEBUG_CAPTURE_SNAPSHOT_INTERVAL_MS = 5000");
  expect(clientSource).toContain("DEBUG_CAPTURE_BACKOFF_MS = [1000, 5000, 30000]");
  expect(clientSource).toContain("DEBUG_CAPTURE_ENDPOINT = '/api/v1/client-debug'");

  // Drop-oldest-on-overflow with counter so dropped events surface.
  expect(clientSource).toContain("debugCapture.buffer.shift()");
  expect(clientSource).toContain("debugCapture.droppedSinceLastFlush += 1");
  expect(clientSource).toContain("debugCapture.droppedTotal += 1");

  // terminalDebugLog enqueues into the capture buffer when toggle ON
  // independently of the URL-flag overlay.
  expect(clientSource).toMatch(/function terminalDebugLog[\s\S]*?if \(debugCaptureEnabled\(\)\)[\s\S]*?enqueueDebugCapture\(event, data\)/);

  // Shipper uses fetch with credentials:'include' (cookie auth) and JSON
  // body shape that the server accepts.
  expect(clientSource).toContain("credentials: 'include'");
  expect(clientSource).toContain("'Content-Type': 'application/json'");
  expect(clientSource).toContain("buildDebugCapturePayload(drained)");

  // Failure path re-enqueues drained events at the front so order is
  // preserved on retry; back-off advances and caps at the last step.
  expect(clientSource).toContain("debugCapture.buffer.unshift(...drained)");
  expect(clientSource).toContain("debugCapture.backoffStep = Math.min(debugCapture.backoffStep + 1, DEBUG_CAPTURE_BACKOFF_MS.length - 1)");

  // 5 s periodic snapshot when toggle is ON.
  expect(clientSource).toContain("startDebugCaptureSnapshotTimer");
  expect(clientSource).toContain("enqueueDebugCapture('periodic-snapshot', terminalDebugSnapshot())");

  // beforeunload + pagehide hooks use keepalive fetch for the final flush so
  // CSRF headers still attach through the global fetch wrapper.
  expect(clientSource).toContain("window.addEventListener('beforeunload', beaconHandler)");
  expect(clientSource).toContain("window.addEventListener('pagehide', beaconHandler)");
  expect(clientSource).toContain("function flushDebugCaptureKeepalive()");
  expect(clientSource).toContain("keepalive: true");
  expect(clientSource).toContain("body,");
  expect(clientSource).not.toContain("sendBeacon");

  // setPreference wiring: toggle transitions start/stop timers + final
  // flush on toggle-off so events captured up to the transition still
  // ship.
  expect(clientSource).toContain("'xtermDebugCapture'");
  expect(clientSource).toContain("applyDebugCaptureToggle(prefs.xtermDebugCapture)");
  expect(clientSource).toMatch(/function applyDebugCaptureToggle[\s\S]*?stopDebugCaptureSnapshotTimer\(\)[\s\S]*?flushDebugCapture\(\{ final: true \}\)/);

  // Bootstrap on page load if the saved pref is already ON.
  expect(clientSource).toContain("if (debugCaptureEnabled()) applyDebugCaptureToggle(true)");

  // Window-debug helpers expose status + manual flush for the
  // Diagnostics panel and tests.
  expect(clientSource).toContain("captureStatus: () => debugCaptureStatus()");
  expect(clientSource).toContain("flushNow: () => flushDebugCapture()");
});

test("EP-023 / WA-105 — terminal lifecycle event taps + payload allowlists", () => {
  // Each new event category emitted by terminalDebugLog must appear in
  // source so the captured log is greppable for the conditions that
  // diagnose the open observations (WA-071 mouse, keyboard-dead-until-
  // refresh, stopped-session garble, distortion).
  // EP-029 T4: most taps moved into TerminalController. Read the
  // controller source too and combine for the substring check.
  const controllerSource = readFileSync(
    join(import.meta.dir, "..", "src", "web", "client", "terminal-controller.ts"),
    "utf8",
  );
  const combinedTerminalSource = clientSource + "\n" + controllerSource;
  // Substring-only — tolerant of single vs double quotes (main.ts uses
  // single quotes; controller uses double quotes since it's strict TS).
  for (const category of [
    "mount-selectors",
    "helper-focus",
    "helper-blur",
    "mousedown-observed",
    "first-keydown",
    "ws-open",
    "ws-close",
    "ws-error",
    "ws-ready",
    "ws-runner-status",
    "session-change",
    "dispose",
  ]) {
    expect(combinedTerminalSource).toContain(category);
  }
  // EP-029 T4 tombstones: 'first-render', 'ws-error-event', 'runner-exited',
  // 'visibility-change', 'poll-start', 'poll-stop' — pre-T4 taps for the
  // legacy pump + polling fallback. Mirror-as-source eliminates the
  // polling fallback and the per-render bookkeeping; the controller's
  // restore-applied event covers the post-mount stable-state signal that
  // first-render used to mark.
  expect(combinedTerminalSource).toContain("restore-applied");

  // WA-149: restore-write race hardening. Browser sends an explicit
  // restore_complete ack after xterm applies the snapshot; server buffers
  // subscriber output frames until that ack, and the client keeps a local
  // pre-restore buffer as a defensive fallback for out-of-order streams.
  expect(controllerSource).toContain('JSON.stringify({ type: "restore_complete"');
  expect(controllerSource).toContain("preRestoreOutputFrames.push(frame)");
  expect(daemonSource).toContain("restoreBufferedOutputFrames");
  expect(daemonSource).toContain("terminalCompleteRestoreHandshake");

  // EP-029 T4: mousedown observer + first-keydown one-shot lifted into
  // TerminalController.installDebugTaps. Pin against controller source.
  expect(controllerSource).toContain("addEventListener(\"mousedown\", onMouseDown, { capture: true })");
  expect(controllerSource).toContain("first-keydown");
  expect(controllerSource).toMatch(/firstKeydownLogged = true/);
  // EP-029 T4 privacy gate (advisor WA-134 blocker): first-keydown payload is
  // metadata-only. xterm-debug.log persists when capture is ON, so any
  // `key` or `code` field would leak user input / passwords / launch tokens
  // into a session-scoped log file. Diagnostics panel + WA-105 spec promise
  // booleans/tag/class only. Lock against regression by failing if the
  // controller's first-keydown call site references event.key / event.code
  // or includes a `key` / `code` field name.
  const firstKeydownIdx = controllerSource.indexOf('"first-keydown"');
  expect(firstKeydownIdx).toBeGreaterThan(-1);
  const firstKeydownWindow = controllerSource.slice(firstKeydownIdx, firstKeydownIdx + 400);
  expect(firstKeydownWindow).not.toContain("event.key");
  expect(firstKeydownWindow).not.toContain("event.code");
  expect(firstKeydownWindow).not.toMatch(/(?<![a-zA-Z])key:/);
  expect(firstKeydownWindow).not.toMatch(/(?<![a-zA-Z])code:/);
  expect(firstKeydownWindow).toContain("helperFocused");
  expect(firstKeydownWindow).toContain("targetTag");
  expect(firstKeydownWindow).toContain("targetClass");

  // EP-029 T4: ws-ready / ws-runner-status / runner-exited frame parsing
  // moved into TerminalController.handleWsMessage. Payload allow-listing
  // is structural now — controller constructs typed payloads instead of
  // pin-able inline object literals. Pin the structural invariants:
  // session-change is fired with prev/next sessionIds; runner_status is
  // forwarded via onRunnerStatus(role, body) callback to main.ts's
  // handleRunnerStatus.
  expect(controllerSource).toContain("ws-ready");
  expect(controllerSource).toContain("ws-runner-status");
  expect(controllerSource).toContain("session-change");
  expect(controllerSource).toContain("this.options.onRunnerStatus(role, {");

  // disposeXterm: in T4-c the body is a thin delegate to controller.dispose;
  // legacy state cleanup retained defensively.
  expect(clientSource).toContain("function disposeXterm(reason");
  expect(clientSource).toContain("terminalController.dispose(reason)");
  // EP-029 T4 tombstone: legacy `disposeXterm('remount')` /
  // `'session-change'` call sites are gone — TerminalController owns
  // the equivalent transitions internally (parking-root reattach for
  // same-role; constructTerminal/dispose for role changes;
  // session-change emitted from handleWsMessage). The
  // `disposeXterm('workspace-switch')` call from the workspace reset
  // path is kept since that's a top-level main.ts concern.
  expect(clientSource).toContain("disposeXterm('workspace-switch')");

  // EP-029 T4 tombstone: installTerminalDebugObservers +
  // activeTerminalDebugCleanups drain pattern moved into
  // TerminalController.installDebugTaps + cleanupDebugTaps. Pin the
  // controller-side equivalent.
  expect(controllerSource).toContain("installDebugTaps");
  expect(controllerSource).toContain("cleanupDebugTaps");
  expect(controllerSource).toContain("this.debugCleanups.push");
});

test("EP-023 / WA-106 — Settings → Diagnostics panel + dispatch wiring", () => {
  // Diagnostics tab is wired into renderSettingsTabContent. EP-030 / WA-139
  // expanded the dispatch from a single-line return to a block that also
  // lazy-fetches push-state stats; the panel call still resolves through
  // diagnosticsPanel().
  expect(settingsSource).toContain("if (tab === 'diagnostics') {");
  expect(settingsSource).toContain("return diagnosticsPanel();");
  expect(settingsSource).toContain("function diagnosticsPanel()");
  expect(settingsSource).toContain("loadPushStateStats");
  // EP-030 review fix #2: failed fetch must not pin pushStateLoadedAt at 0,
  // and the in-flight guard prevents the finally→render→fetch loop. Keep
  // both shapes pinned so a future refactor can't silently regress.
  expect(settingsSource).toContain("pushStateLoading = true");
  expect(settingsSource).toContain("pushStateLoadedAt = Date.now();");
  expect(settingsSource).toContain("if (pushStateLoading) return;");

  // Toggle uses the shared prefControl segmented control bound to the
  // xtermDebugCapture pref so the WA-104 transition handler fires.
  expect(settingsSource).toContain("prefControl('xtermDebugCapture', [[true, 'On'], [false, 'Off']])");

  // Status surface reads live counters every render tick.
  expect(settingsSource).toContain("captureStatus()");
  expect(settingsSource).toContain("status.bufferFill");
  expect(settingsSource).toContain("status.bufferMax");
  expect(settingsSource).toContain("status.shippedTotal");
  expect(settingsSource).toContain("status.droppedTotal");
  expect(settingsSource).toContain("status.lastFlushAt");
  expect(settingsSource).toContain("status.lastError");
  expect(settingsSource).toContain("status.backoffStep");

  // Log path display + actions.
  expect(settingsSource).toContain("DIAGNOSTICS_LOG_PATH = '~/.whatsagent/logs/xterm-debug.log'");
  expect(settingsSource).toContain('data-action="diagnostics-copy-log-path"');
  expect(settingsSource).toContain('data-action="diagnostics-flush-now"');

  // Privacy copy reminds operators capture is metadata only.
  expect(settingsSource).toContain("Capture is metadata only");
  expect(settingsSource).toContain("No terminal bytes captured");

  // Dispatch handlers in main.ts route the new actions.
  expect(clientSource).toContain("if (action === 'diagnostics-copy-log-path')");
  expect(clientSource).toContain("if (action === 'diagnostics-flush-now')");
  expect(clientSource).toContain("navigator.clipboard?.writeText?.('~/.whatsagent/logs/xterm-debug.log')");

  // ctx exports the helpers settings.ts needs.
  expect(clientSource).toContain("getPrefs: () => prefs");
  expect(clientSource).toContain("prefControl: (...args) => prefControl(...args)");
  expect(clientSource).toContain("captureStatus: () => debugCaptureStatus()");
  expect(clientSource).toContain("flushDebugCaptureNow: () => flushDebugCapture()");

  // CSS hooks in shell-overrides.ts.
  expect(shellOverridesSource).toContain(".diagnostics-settings");
  expect(shellOverridesSource).toContain(".diagnostics-status-grid");
  expect(shellOverridesSource).toContain(".diagnostics-log-path");

  // Live-status DOM ids used by updateDiagnosticsStatusDom — stable
  // ids so the heartbeat / post-flush updater can find each value
  // span without re-rendering the surrounding settings tree (which
  // would steal focus). Advisor msg #446 fix.
  expect(settingsSource).toContain('id="diagnosticsStatusGrid"');
  expect(settingsSource).toContain('id="diagnosticsStatusState"');
  expect(settingsSource).toContain('id="diagnosticsStatusBuffer"');
  expect(settingsSource).toContain('id="diagnosticsStatusShipped"');
  expect(settingsSource).toContain('id="diagnosticsStatusDropped"');
  expect(settingsSource).toContain('id="diagnosticsStatusLastFlush"');
  expect(settingsSource).toContain('id="diagnosticsStatusErrorRow"');
  expect(settingsSource).toContain('id="diagnosticsStatusError"');
  expect(settingsSource).toContain('id="diagnosticsStatusBackoffRow"');
  expect(settingsSource).toContain('id="diagnosticsStatusBackoff"');

  // Updater + 1 Hz heartbeat in main.ts. Heartbeat is conditional so
  // it does nothing while the user is on a different tab.
  expect(clientSource).toContain("function updateDiagnosticsStatusDom()");
  expect(clientSource).toMatch(/setInterval\(\(\) => \{\s*if \(page === 'settings' && selectedSettingsTab === 'diagnostics'\) updateDiagnosticsStatusDom\(\);\s*\}, 1000\)/);

  // Post-flush refresh fires immediately so shipping counters update
  // ahead of the heartbeat tick.
  expect(clientSource).toMatch(/finally \{[\s\S]*?debugCapture\.shipping = false;[\s\S]*?\}\s*\/\/[\s\S]*?msg #446[\s\S]*?updateDiagnosticsStatusDom\(\)/);
});

test("WA-170 (UI-MODAL-FS): modal input font size unified via control tokens", async () => {
  const shellStylesSource = await readFile(new URL("../src/web/shell-styles.ts", import.meta.url), "utf8");
  expect(shellStylesSource).toContain("--font-size-input: 12.5px;");
  expect(shellStylesSource).toContain(".modal input { width: 100%; min-height: var(--control-h); padding: 0 var(--control-px); border-radius: 8px; border: 1px solid var(--border); background: var(--field); color: var(--text); font-family: var(--font-mono); font-size: var(--control-fs)");
  expect(shellStylesSource).not.toMatch(/\.modal input \{[^}]*font-size: 13px/);
});

test("WA-171 (UI-CONTROL-TOKEN): control height tokens unify small controls", async () => {
  const shellStylesSource = await readFile(new URL("../src/web/shell-styles.ts", import.meta.url), "utf8");
  expect(shellStylesSource).toContain("--control-h: 32px;");
  expect(shellStylesSource).toContain("--control-h-sm: 26px;");
  expect(shellStylesSource).toContain("--control-px: 10px;");
  expect(shellStylesSource).toContain("--control-fs: 12.5px;");
  expect(shellStylesSource).toContain(".btn.small { min-height: var(--control-h); padding: 0 var(--control-px); border-radius: 7px; font-size: var(--control-fs); }");
  expect(shellStylesSource).not.toContain(".btn.small { padding: 5px 11px;");
  expect(shellStylesSource).toContain(".setting-select { min-width: 130px; min-height: var(--control-h); padding: 0 var(--control-px);");

  expect(shellOverridesSource).toContain(".settings-dropdown .settings-dropdown-trigger { min-width: 0; min-height: var(--control-h);");
  expect(shellOverridesSource).toContain(".chat-history-custom { width: 140px; min-height: var(--control-h);");
  expect(shellOverridesSource).not.toContain(".chat-history-custom { width: 140px; border: 1px solid var(--border); border-radius: 9px; background: var(--field); color: var(--text); padding: 8px 10px;");
  expect(shellOverridesSource).toContain(".kanban-toolbar input, .kanban-toolbar select, .kanban-prefix-control input { min-height: var(--control-h);");
  expect(shellOverridesSource).toContain(".rbac-roles-settings .role-field input, .rbac-roles-settings .role-field textarea { width: 100%; min-height: var(--control-h); padding: 0 var(--control-px);");
  expect(shellOverridesSource).toContain(".workspace-name-input { width: min(280px, 100%); min-height: var(--control-h);");
  expect(shellOverridesSource).toContain(".notification-pill-toggle { display: inline-flex; align-items: center; gap: 8px; min-height: var(--control-h);");
  expect(shellOverridesSource).toContain(".runtime-enabled-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: var(--control-h);");
  expect(shellOverridesSource).toContain(".tui-prompt-insert.btn.small { flex: 0 0 auto; width: auto; min-width: 58px; height: var(--control-h);");
  expect(shellOverridesSource).toContain(".prompt-expander-chevron.btn.small { min-width: var(--control-h); height: var(--control-h);");
  expect(shellOverridesSource).toContain(".kanban-pill { min-height: var(--control-h-sm); padding: 0 6px;");
  expect(shellOverridesSource).toContain(".rbac-roles-settings .role-builtin, .rbac-roles-settings .role-custom-chip { display: inline-flex; align-items: center; width: max-content; min-height: var(--control-h-sm);");
});

test("WA-169 (UI-PILL): selection inputs canonicalized to pill radius", async () => {
  const agentsSource = await readFile(new URL("../src/web/client/agents.ts", import.meta.url), "utf8");
  expect(shellOverridesSource).toMatch(/\.rbac-mode-option \{[^}]*border-radius: 999px/);
  expect(shellOverridesSource).not.toMatch(/\.rbac-mode-option \{[^}]*border-radius: 8px/);
  expect(shellOverridesSource).toContain(".settings-with-subnav .seg-option, .settings-with-subnav .runtime-default-choice, .settings-with-subnav .role-pick { border-radius: 999px; }");
  expect(shellOverridesSource).not.toMatch(/\.settings-with-subnav \.seg-option,[^{}]*\{ border-radius: 9px/);
  expect(shellOverridesSource).toContain(".runtime-default-choice.pill { border-radius: 999px; }");
  expect(agentsSource).toContain('class="choice runtime-default-choice pill ');
});

test("WA-165 (UI-INBOX-NUDGE): inbox nudge Quick Prompt is enabled for all runtimes", () => {
  expect(clientSource).toContain("const QUICK_PROMPT_ENABLED_RUNTIMES = new Set(['claude-code', 'opencode', 'codex', 'pi']);");
  expect(clientSource).toContain("QUICK_PROMPT_ENABLED_RUNTIMES.has(runner?.host_type) && agentText.pushedInboxInstructions");
  expect(clientSource).not.toContain("runner?.host_type === 'codex' && agentText.pushedInboxInstructions");
  expect(settingsSource).toContain("Reminder sent to agent when there are unread inbox items");
  expect(settingsSource).not.toContain("Codex-only Quick Prompts entry");
});

test("WA-166 (UI-TRUNCATION): shared truncate tooltip hook covers clipped labels", () => {
  expect(truncatedAttrs('A "B" & <C>')).toBe('data-truncate-tip="A &quot;B&quot; &amp; &lt;C&gt;"');

  let scheduled: () => void = () => { throw new Error("fallback was not scheduled"); };
  const attrs: Record<string, string> = {};
  const node = {
    dataset: { truncateTip: "Full clipped value" },
    getAttribute: (name: string) => attrs[name] ?? null,
    setAttribute: (name: string, value: string) => { attrs[name] = value; },
  };
  const doc = {
    documentElement: { dataset: {} as Record<string, string> },
    querySelectorAll: (selector: string) => {
      expect(selector).toBe('[data-truncate-tip]');
      return [node];
    },
  };
  installTruncateTitleFallback({
    document: doc as unknown as Document,
    setTimeoutFn: (handler, delay) => { expect(delay).toBe(200); scheduled = handler; return 1; },
  });
  scheduled();
  expect(attrs.title).toBe("Full clipped value");

  attrs.title = "";
  doc.documentElement.dataset.truncateTipController = "ready";
  installTruncateTitleFallback({
    document: doc as unknown as Document,
    setTimeoutFn: (handler) => { scheduled = handler; return 1; },
  });
  scheduled();
  expect(attrs.title).toBe("");

  expect(clientSource).toContain("installTruncateTitleFallback();");
  expect(clientSource).toContain("function bindTruncateTips(root = document)");
  expect(clientSource).toContain("[data-truncate-tip]:not([data-truncate-tip-bound])");
  expect(clientSource).toContain("target.dataset.truncateTipBound = '1';");
  expect(clientSource).toContain("target.addEventListener('focus', () => attachTruncateTip(target));");

  expect(clientSource).toContain('class="conversation-name" \' + truncatedAttrs(name)');
  expect(clientSource).toContain('class="thread-title" \' + truncatedAttrs(threadTitleText)');
  expect(clientSource).toContain('class="term-tab-label-name" \' + truncatedAttrs(role.name)');
  expect(clientSource).toContain('class="settings-dropdown-label" \' + truncatedAttrs(selected[1])');
  expect(clientSource).toContain('class="workspace-name" \' + truncatedAttrs(currentName)');
  expect(clientSource).toContain('class="workspace-type-tag" \' + truncatedAttrs(triggerSubtitle)');
  expect(kanbanSource).toContain('class="kanban-epic-title" \' + truncatedAttrs(epic.title || \'\')');
  expect(kanbanSource).toContain('class="kanban-card-title" \' + truncatedAttrs(title)');
  expect(kanbanSource).toContain('class="archive-title"><strong \' + truncatedAttrs(task.title || \'\')');
  expect(settingsSource).toContain('class="auth-session-agent" \' + truncatedAttrs(authSessionLabel(s))');
  expect(settingsSource).toContain('class="peer-rule-row"><span \' + truncatedAttrs(rule.role_a_name)');
  expect(agentsSource).toContain('class="archive-title agents-agent-name"');
  expect(agentsSource).toContain('class="agents-agent-description archive-muted"');

  expect(kanbanSource).not.toMatch(/class="kanban-card-title" title=/);
  expect(shellOverridesSource).toContain(".kanban-epic-drawer-head h2 { margin: 0; font-size: 18px; font-weight: 700; }");
  expect(shellOverridesSource).toContain(".workspace-settings-path, .workspace-settings-meta { min-width: 0; white-space: normal; word-break: break-all;");
  expect(shellOverridesSource).toContain(".workspace-current-path { display: block; min-width: 0; overflow-wrap: anywhere; white-space: normal;");
});

test("EP-036 WA-209/WA-210: app tooltip wraps and kanban meta pills expose hints", () => {
  expect(shellOverridesSource).toContain("max-width: min(360px, calc(100vw - 16px));");
  expect(shellOverridesSource).toContain("white-space: normal; overflow-wrap: anywhere;");
  expect(clientSource).toContain("function bindHintTips(root = document)");
  expect(clientSource).toContain("[data-hint]:not([data-hint-tip-bound])");
  expect(clientSource).toContain("target.dataset.hintTipBound = '1';");
  expect(clientSource).toContain("target.addEventListener('focus', () => attachHintTip(target));");
  expect(kanbanSource).toContain("function renderPriorityPill(value, fallback = 'P?', extraClass = '')");
  expect(kanbanSource).toContain("'Priority: ' + priority");
  expect(kanbanSource).toContain("'Effort estimate: ' + effort");
  expect(kanbanSource).toContain("'GitHub issue #' + value");
  expect(kanbanSource).toContain("renderPriorityPill(task.priority) + renderEffortPill(task.effort, 'M') + github");
});

test("WA-167 (UI-NATIVE-REPLACE): native selects and alert calls are migrated", async () => {
  const clientDir = new URL("../src/web/client/", import.meta.url);
  const sources = await Promise.all((await readdir(clientDir)).filter(file => file.endsWith(".ts")).map(async file => ({ file, source: await readFile(new URL(file, clientDir), "utf8") })));
  for (const { file, source } of sources) {
    const matches = source.match(/alert\(/g) || [];
    expect({ file, matches }).toEqual({ file, matches: [] });
  }
  expect(kanbanSource).not.toContain("<select data-kanban-assignee>");
  expect(kanbanSource).not.toContain("<select data-kanban-priority>");
  expect(kanbanSource).toContain("settingsDropdown('Kanban assignee'");
  expect(kanbanSource).toContain("settingsDropdown('Kanban priority'");
  expect(clientSource).not.toContain("<select class=\"setting-select\" data-action=\"set-pref-select\"");
  expect(clientSource).not.toContain("<select class=\"setting-select\" data-action=\"set-trash-retention\"");
  expect(clientSource).toContain("function showToast(message, opts = {})");
  expect(clientSource).toContain("data-action=\"dismiss-app-toast\"");
  expect(settingsSource).toContain("class=\"chat-history-confirm-input\"");
  expect(settingsSource).not.toContain("class=\"setting-select\" data-chat-history-clear-confirm");
  expect(shellOverridesSource).toContain(".chat-history-confirm-input");
});

test("EP-037 WA-217 persona editor wires templates, warnings, clear, and save", () => {
  expect(agentsSource).toContain("const PERSONA_FIELDS = [");
  expect(agentsSource).toContain("['description', 'Description', 'one line', 'input', 280, 1]");
  expect(agentsSource).toContain("const PERSONA_SOFT_TOTAL = 24000");
  expect(agentsSource).toContain("function personaSectionHtml(scope, persona)");
  expect(agentsSource).toContain("settingsDropdown('persona-template-' + scope");
  expect(agentsSource).toContain("data-persona-template-scope");
  expect(agentsSource).toContain("function applyPersonaTemplate(scope, templateId)");
  expect(agentsSource).toContain("if (String(el.value || '').trim()) { skipped++; continue; }");
  expect(agentsSource).toContain("showToast('Filled ' + filled + ' field(s) from");
  expect(agentsSource).toContain("function updatePersonaWarnings(scope)");
  expect(agentsSource).toContain("data-persona-budget-banner");
  expect(agentsSource).toContain("function clearPersona(scope)");
  expect(agentsSource).toContain("confirmLabel: 'Clear persona'");
  expect(agentsSource).toContain("persona: personaValuesFromInputs('add')");
  // EP-037 (advisor blocker 1): the edit page must load the full persona row
  // via GET /roles-by-id/:id before rendering its editor, and must not PATCH
  // persona until those inputs exist — otherwise a partial form wipes the
  // non-description fields that /status never carries.
  expect(agentsSource).toContain("async function loadAgentConfigPersona(agentId)");
  expect(agentsSource).toContain("agentConfigPersonaState === 'ready'");
  expect(agentsSource).toContain("if ($(personaInputId('edit', 'description'))) body.persona = personaValuesFromInputs('edit')");
  expect(agentsSource).toContain("Array.isArray(respBody.warnings) && respBody.warnings.length");
  expect(shellOverridesSource).toContain(".agent-persona-tools");
  expect(shellOverridesSource).toContain(".agent-persona-field-warning");
  expect(shellOverridesSource).toContain(".agent-persona-budget");
});

test("EP-037 WA-213 agent overview uses merged archive-style table", () => {
  expect(agentsSource).toContain("const assignedRoles = Array.isArray(role.roles) ? role.roles.map(item => typeof item === 'string' ? item : item?.name).filter(Boolean) : []");
  expect(agentsSource).toContain("const roleChips = assignedRoles.length ? assignedRoles.map(name => badge(name, '', false)).join('') : '<span class=\"agent-card-roles-empty\">&mdash;</span>'");
  expect(agentsSource).toContain("const description = String(role.persona?.description || '').trim()");
  expect(agentsSource).toContain("const currentSummary = String(role.summary || '').trim()");
  expect(agentsSource).toContain("archive-table-head agents-archive-head");
  expect(agentsSource).toContain("agents-agent-description archive-muted");
  expect(agentsSource).toContain("agent-card-rbac-chips agents-agent-roles");
  expect(agentsSource).toContain("offline — no summary");
  expect(agentsSource).toContain("Re-launch with…");
  expect(agentsSource).not.toContain("workspace-card-path mono");
  expect(clientSource).not.toContain("function roleCard(role)");
  expect(daemonSource).toContain("roles: agentOverviewRoles(db, listAgents(db))");
  expect(daemonSource).toContain("roles: getAgentRoles(db, agent.id).map((role) => role.name)");
  expect(daemonSource).toContain("summary: sessionByRoleId.get(agent.id)?.summary ?? \"\"");
  expect(shellOverridesSource).toContain(".agents-archive-board");
  expect(shellOverridesSource).toContain(".agents-archive-head, .agents-agent-row");
  expect(shellOverridesSource).toContain(".agents-agent-description, .agents-agent-summary");
});

test("EP-035 WA-193: special keys overlay mounts only for live terminal panels", () => {
  expect(clientSource).toContain('import { SpecialKeysOverlay } from "./special-keys-overlay.ts";');
  expect(clientSource).toContain("let specialKeysOverlay = null;");
  expect(clientSource).toContain("function ensureSpecialKeysOverlay()");
  expect(clientSource).toContain("function syncSpecialKeysOverlay(role, runner, controller)");
  expect(clientSource).toContain("if (!runner || !controller || activeTerminal !== role) { unmountSpecialKeysOverlay(); return; }");
  expect(clientSource).toContain("const terminalShell = $('agentTabContent')?.querySelector?.('.terminal');");
  expect(clientSource).toContain("ensureSpecialKeysOverlay().mount(terminalShell, controller);");
  expect(clientSource).toContain("if (page !== 'agents' || agentsSubView !== 'terminal' || activeTerminal === 'overview') unmountSpecialKeysOverlay();");
  expect(clientSource).toContain("const mountedController = !exitCard ? mountTerminal(roleName, body, Boolean(runner)) : null;");
  expect(clientSource).toContain("syncSpecialKeysOverlay(roleName, runner, mountedController);");
});

test("EP-035 WA-194: special keys overlay styling reserves mobile layout", () => {
  expect(shellOverridesSource).toContain(".special-keys-icon { position: absolute; bottom: 16px; right: 16px; width: 44px; height: 44px; border-radius: 50%; background: color-mix(in srgb, var(--accent) 25%, transparent); color: var(--accent); z-index: 90; display: inline-flex; align-items: center; justify-content: center;");
  expect(shellOverridesSource).toContain("font-size: 24px;");
  expect(shellOverridesSource).toContain(".special-keys-panel { position: absolute; bottom: 16px; right: 16px; padding: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 18px 40px rgb(15 23 42 / .12); z-index: 90; display: flex; flex-direction: row; align-items: center; gap: 8px; }");
  expect(shellOverridesSource).toContain(".special-keys-bar { position: relative; z-index: 90; flex: 0 0 auto; width: 100%; padding: 8px 12px env(safe-area-inset-bottom) 12px; background: var(--surface); border-top: 1px solid var(--border); display: none; }");
  expect(shellOverridesSource).toContain(".special-keys-collapse-col { display: flex; align-items: center; justify-content: center; }");
  expect(shellOverridesSource).toContain(".special-keys-grid { display: grid; grid-template-columns: repeat(6, 1fr); grid-auto-rows: auto; gap: 6px; }");
  expect(shellOverridesSource).toContain(".special-keys-grid > .special-keys-key { width: 100%; min-width: 0; }");
  expect(shellOverridesSource).toContain(".special-keys-key { min-width: var(--control-h); height: var(--control-h); padding: 0 var(--control-px); border: 1px solid var(--border); border-radius: 8px; background: var(--surface-soft); color: var(--text); font: inherit; font-size: var(--control-fs);");
  expect(shellOverridesSource).toContain(".special-keys-key.is-armed { border-color: var(--accent-red, #d33); color: var(--accent-red, #d33); background: color-mix(in srgb, var(--accent-red, #d33) 12%, var(--surface-soft)); }");
  expect(shellOverridesSource).toContain(".special-keys-key:hover, .special-keys-key:focus-visible { border-color: var(--accent); background: var(--accent-light); color: var(--accent-dark); outline: 0; }");
  expect(shellOverridesSource).toContain("@media (max-width: 760px), (pointer: coarse) { .special-keys-key { min-width: 44px; height: 44px; } .special-keys-icon { width: 44px; height: 44px; } .special-keys-panel { display: none; } .special-keys-bar { display: flex; flex-direction: row; align-items: center; gap: 8px; } .special-keys-bar .special-keys-grid { grid-template-columns: repeat(6, minmax(44px, 1fr)); width: 100%; } }");
  expect(shellOverridesSource).toContain("@media (max-width: 380px) { .special-keys-bar .special-keys-grid { grid-template-columns: repeat(3, 1fr); } }");
  expect(shellOverridesSource).toContain("env(safe-area-inset-bottom)");
  expect(shellOverridesSource).not.toContain(".special-keys-row");
  expect(shellOverridesSource).not.toContain(".special-keys-spacer");
  expect(shellOverridesSource).not.toContain(".special-keys-bar { position: fixed;");
  expect(specialKeysOverlaySource).toContain("const COLLAPSE_KEY: SpecialKeyButton = { label: \">\", ariaLabel: \"Hide special keys\", collapse: true };");
  expect(specialKeysOverlaySource).toContain('grid.className = "special-keys-grid";');
  expect(specialKeysOverlaySource).toContain('{ label: "Ctrl", ariaLabel: "Sticky Control modifier", ctrl: true },\n    { label: "tab", ariaLabel: "Tab", sequence: KEY_TAB },');
  expect(specialKeysOverlaySource).not.toContain("special-keys-spacer");
  expect(specialKeysOverlaySource).toContain('button.setAttribute("aria-pressed", armed ? "true" : "false");');
  expect(specialKeysOverlaySource).not.toContain("Ctrl+C");
  expect(specialKeysOverlaySource).not.toContain("KEY_CTRL_C");
});

test("WA-187 (UI-USER-SESSIONS-FILL): user sessions fill the settings row", () => {
  expect(settingsSource).toContain("class=\"setting-row auth-sessions-row\"");
  expect(settingsSource).toContain("class=\"auth-sessions-panel\"><div class=\"peer-rule-list auth-session-list\"");
  expect(shellOverridesSource).toContain(".auth-sessions-row > .auth-sessions-panel { width: 100%; display: flex; flex-direction: column; align-items: stretch; gap: 10px; }");
  expect(shellOverridesSource).toContain(".auth-session-list { width: 100%; }");
  expect(shellOverridesSource).toContain(".peer-rule-row.auth-session-row { width: 100%; grid-template-columns: minmax(0, 1fr) auto; align-items: center; }");
});

test("WA-186 (UI-ROLES-COLGAP): roles list gives description the fluid column", () => {
  expect(shellOverridesSource).toContain(".rbac-roles-settings .role-row-header { display: grid; grid-template-columns: 36px auto minmax(0, 1fr) auto auto;");
  expect(shellOverridesSource).not.toContain("grid-template-columns: 36px minmax(140px, 1.4fr) minmax(0, 2.4fr) auto auto");
  expect(shellOverridesSource).toContain(".rbac-roles-settings .role-name-cell { display: inline-flex; flex-direction: column; gap: 3px; min-width: 0; max-width: min(240px, 28vw); }");
  expect(settingsSource).toContain("'<span class=\"role-desc\" ' + truncatedAttrs(description) + '>'");
});

test("WA-185 (UI-PROMPT-TITLE-INPUT): custom prompt title input uses control tokens", () => {
  expect(shellOverridesSource).toContain(".prompt-expander-body .setting-input { width: 100%; min-height: var(--control-h); padding: 0 var(--control-px); border: 1px solid var(--border); border-radius: 8px; background: var(--field); color: var(--text); font-family: var(--font-mono); font-size: var(--control-fs); outline: 0; }");
  expect(shellOverridesSource).not.toContain(".prompt-expander-body .setting-input { width: 100%; min-height: var(--control-h); padding: 0 var(--control-px); border-radius: 10px; background: var(--surface-soft);");
});

test("WA-188 (UI-DIAG-REDRAW-LAYOUT): redraw controls live in right column without duplicate status", () => {
  expect(settingsSource).toContain("const savingStatus = tuiRedrawSaving ? '<span class=\"settings-inline-status\" data-tui-redraw-status role=\"status\" aria-live=\"polite\">Saving…</span>' : '';");
  expect(settingsSource).toContain("savingStatus +");
  expect(settingsSource).toContain("Forces a brief PTY resize when long output bursts cause render staleness in Claude Code or Codex TUIs. Recommended on.");
  expect(settingsSource).not.toContain("tuiRedrawStatus || 'Recommended on.'");
  expect(settingsSource).not.toContain("Off by default. Use only as a temporary workaround");
  expect(settingsSource).not.toContain("'<div class=\"settings-inline-status\" data-tui-redraw-status");
  expect(shellOverridesSource).toContain(".diagnostics-settings .tui-redraw-settings > .tui-redraw-controls { grid-column: 2; grid-row: 1 / span 2; align-self: center; justify-self: start; }");
  expect(shellOverridesSource).toContain("@media (max-width: 760px) { .diagnostics-settings .tui-redraw-settings > .tui-redraw-controls { grid-column: 1; grid-row: auto; } }");
});

test("WA-189 (UI-MOBILE-KB-SCROLL): mobile focus scroll waits for keyboard viewport", () => {
  expect(clientSource).toContain("let mobileKeyboardFocusSeq = 0;");
  expect(clientSource).toContain("function mobileKeyboardViewportMatches()");
  expect(clientSource).toContain("document.addEventListener('focusin', e => {");
  expect(clientSource).toContain("mobileKeyboardFocusTarget(e.target)");
  expect(clientSource).toContain("window.visualViewport.addEventListener('resize', onViewportResize, { once: true });");
  expect(clientSource).toContain("fallbackTimer = setTimeout(run, 300);");
  expect(clientSource).toContain("mobileKeyboardLastUserScrollAt > focusAt");
  expect(clientSource).toContain("target.scrollIntoView({ block: 'end', behavior: 'smooth' });");
  expect(clientSource).toContain("window.addEventListener('touchmove', noteMobileKeyboardUserScroll, { passive: true, capture: true });");
});

test("WA-184 (UI-COPY-VISIBLE-BUG): copy visible reads xterm buffer through controller", () => {
  const controllerSource = readFileSync(join(import.meta.dir, "..", "src", "web", "client", "terminal-controller.ts"), "utf8");
  const visibleXtermStart = clientSource.indexOf("function visibleXtermText()");
  const visibleXtermEnd = clientSource.indexOf("function visibleFallbackTerminalText()", visibleXtermStart);
  const visibleXtermSlice = clientSource.slice(visibleXtermStart, visibleXtermEnd);
  expect(clientSource).toContain("return terminalController?.visibleText?.() || '';");
  expect(visibleXtermSlice).not.toContain("activeXterm");
  expect(visibleXtermSlice).not.toContain("querySelector('.xterm')");
  expect(visibleXtermSlice).not.toContain("textContent");
  expect(controllerSource).toContain("visibleText(): string");
  expect(controllerSource).toContain("const buffer = term?.buffer?.active;");
  expect(controllerSource).toContain("buffer.getLine(start + i)");
  expect(controllerSource).toContain("translateToString(true)");
});

test("WA-172 (UI-EXIT-CARD): exit card strips ANSI and omits empty tail fallback", () => {
  expect(stripAnsi("\u001b[31mred\u001b[0m plain")).toBe("red plain");
  expect(stripAnsi("a\u001b]0;title\u0007b")).toBe("ab");
  expect(stripAnsi("a\u001bPpayload\u001b\\b")).toBe("ab");
  expect(stripAnsi("a\u001bc")).toBe("a");

  expect(clientSource).toContain("function renderExitCard(role, runner)");
  expect(clientSource).toContain("const outputTail = stripAnsi(runner?.output_tail || '').trimEnd();");
  expect(clientSource).toContain("class=\"terminal-exit-cta\">Launch ' + esc(roleName) + ' again</p>");
  expect(clientSource).toContain("const output = outputTail ? '<details class=\"terminal-exit-output\"><summary>Show last output ▾</summary><pre>' + esc(outputTail) + '</pre></details>' : '';");
  expect(clientSource).not.toContain("No terminal output tail was captured.");
  expect(clientSource).not.toContain("Click Launch to start a new session.");
  expect(shellOverridesSource).toContain(".terminal-exit-card");
  expect(shellOverridesSource).toContain(".terminal-exit-output pre");
});

test("WA-164 (UI-COPY): copy refresh removes jargon and normalizes loading text", async () => {
  const shellHtml = await readFile(new URL("../src/web/shell.ts", import.meta.url), "utf8");
  expect(pluralize(1, "message")).toBe("message");
  expect(pluralize(2, "message")).toBe("messages");
  expect(pluralize(2, "child", "children")).toBe("children");

  expect(shellHtml).toContain("Acts on behalf of human");
  expect(shellHtml).not.toContain("Is human-delegate?");
  expect(shellHtml).not.toContain("active writer");

  expect(clientSource).not.toContain("active writer");
  expect(clientSource).not.toContain("no active writer");
  expect(clientSource).not.toContain("Loading persisted messages...");
  expect(clientSource).not.toContain("persisted message(s) in this peer thread");
  expect(clientSource).toContain("Loading messages…");
  expect(clientSource).toContain("pluralize(selectedPeerInfo.count, 'message')");

  expect(messagesSource).not.toContain("online agent(s)");
  expect(messagesSource).toContain("Sending to ' + onlineCount + ' ' + pluralize(onlineCount, 'agent') + '.'");
  expect(messagesSource).toContain("Broadcast is disabled in the current messaging policy.");

  expect(settingsSource).not.toContain("EP-030 push-state machine");
  expect(settingsSource).not.toContain("silent-loss surface");
  expect(settingsSource).not.toContain("channel message(s)");
  expect(settingsSource).toContain("' DM/broadcast · '");
  expect(settingsSource).toContain("Text inserted above each inbox header before message metadata.");

  for (const oldLoading of ["Loading epics...", "Loading Kanban tasks...", "Loading archived tasks...", "Loading task detail...", "Loading epic detail..."]) {
    expect(kanbanSource).not.toContain(oldLoading);
  }
  expect(kanbanSource).toContain("Loading tasks…");
  expect(kanbanSource).toContain("No tasks.");
  expect(kanbanSource).toContain("Child tasks");
});
