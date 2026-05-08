#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { daemonHomePaths } from "./paths.ts";
import {
  getCurrentWorkspaceId,
  getTrashRetentionDays,
  listWorkspaces as listWorkspacesDb,
  openDaemonDb,
  setTrashRetentionDays,
  type WorkspaceRow,
} from "./daemon-db.ts";
import { runRunnerProcess } from "./runner/process.ts";
import { normalizeHostType } from "./runner/protocol.ts";
import { discoverWorkspaceRunners, killRunner, readDaemonPid, waitForExit } from "./server/cli-stop.ts";
import { startDaemon } from "./server/daemon.ts";

const cliAuthCookie = process.env.WHATSAGENT_AUTH_COOKIE;
const cliCsrfToken = process.env.WHATSAGENT_CSRF_TOKEN ?? csrfTokenFromCookie(cliAuthCookie ?? "");
if (cliAuthCookie) {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input, init = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has("Cookie")) headers.set("Cookie", cliAuthCookie);
    const method = String(init.method || (typeof input === "object" && "method" in input ? input.method : "GET") || "GET").toUpperCase();
    if (cliCsrfToken && (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") && !headers.has("X-WhatsAgent-CSRF")) {
      headers.set("X-WhatsAgent-CSRF", cliCsrfToken);
    }
    return nativeFetch(input, { ...init, headers });
  }) as typeof fetch;
}

function csrfTokenFromCookie(cookie: string): string | null {
  for (const part of cookie.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === "wa_sid") {
      try { return decodeURIComponent(rawValue.join("=")); } catch { return null; }
    }
  }
  return null;
}

const HELP_HEADER = `WhatsAgent — local fleet controller for AI coding agents.

Daemon home defaults to ~/.whatsagent/ (override via WHATSAGENT_DAEMON_HOME).
Static daemon config lives at <daemonHome>/daemon.toml (optional). Per-key env
overrides: WHATSAGENT_PORT, WHATSAGENT_HOST_ALLOW, WHATSAGENT_HOST_CHECK.`;

const HELP_DAEMON = `Daemon lifecycle:
  whatsagent start [--port <port>] [--foreground] [--rbac-mode <enforce|soft|off>]
  whatsagent stop [--daemon-only | --all]
  whatsagent stop-all`;

const HELP_INSPECT = `Inspect:
  whatsagent status [--workspace <name|id>]
  whatsagent roles  [--workspace <name|id>]
  whatsagent set-main <role> [--workspace <name|id>]`;

const HELP_WORKSPACE = `Workspaces:
  whatsagent workspace list [--include-trash]
  whatsagent workspace add <name> --rbac-mode <enforce|soft|off> [--kanban-prefix <prefix>]
  whatsagent workspace edit <name|id> [--name <name>] [--kanban-prefix <prefix>]
  whatsagent workspace remove <name|id>
  whatsagent workspace restore <name|id>
  whatsagent workspace purge <name|id>
  whatsagent workspace switch <name|id>

Repos (under a workspace):
  whatsagent workspace repo add <ws> <abs-path> [--name <name>]
  whatsagent workspace repo list <ws>
  whatsagent workspace repo remove <ws> <repo-id-or-name>

Scan dirs (under a workspace):
  whatsagent workspace scan-dir add <ws> <abs-path> [--scan-on-startup]
  whatsagent workspace scan-dir list <ws>
  whatsagent workspace scan-dir remove <ws> <id-or-path>
  whatsagent workspace scan <ws> [<scan-dir-id-or-path>]`;

const HELP_ROLE = `Roles (under a workspace + repo):
  whatsagent role add <ws> <repo> <name> [--host claude-code|opencode|codex]
  whatsagent role list <ws>
  whatsagent role remove <ws> <repo:name>

Note: <repo:name> is required for role remove because role names are unique
per repo, not per workspace.`;

const HELP_CONFIG = `Config (daemon-global, persisted in daemon DB):
  whatsagent config get <key>
  whatsagent config set <key> <value>

Keys:
  trash.retention-days   integer; 0 = manual-only purge`;

const HELP_NOTES = `Notes:
  start defaults to a detached background daemon. --foreground keeps it
  attached (useful for systemd Type=simple, debugging). PID file is written
  to <daemonHome>/daemon.pid; URL to <daemonHome>/daemon.url.`;

function usage(): string {
  return [HELP_HEADER, "", HELP_DAEMON, "", HELP_INSPECT, "", HELP_WORKSPACE, "", HELP_ROLE, "", HELP_CONFIG, "", HELP_NOTES, ""].join("\n");
}

function isHelpFlag(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function argsWithoutOption(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name) {
      i++;
      continue;
    }
    out.push(args[i]!);
  }
  return out;
}

function positional(args: string[]): string[] {
  return args.filter((arg) => !arg.startsWith("--"));
}

function commandPositionals(args: string[]): string[] {
  return positional(argsWithoutOption(args, "--workspace"));
}

function getOption(args: string[], name: string): string | null {
  // Accept both `--name value` (space form) and `--name=value` (equals
  // form). Equals form was a regression spotted in advisor msg #409 —
  // docs / prose throughout the CLI use the equals form, so the parser
  // must agree.
  const eqPrefix = `${name}=`;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === name) return args[i + 1] ?? null;
    if (a.startsWith(eqPrefix)) return a.slice(eqPrefix.length);
  }
  return null;
}

function requireOption(args: string[], name: string): string {
  const value = getOption(args, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function defaultDaemonHome(): string {
  return daemonHomePaths(process.env.WHATSAGENT_DAEMON_HOME).home;
}

async function readDaemonUrl(daemonHome: string): Promise<string | null> {
  const urlPath = `${daemonHome}/daemon.url`;
  try {
    const text = (await readFile(urlPath, "utf8")).trim();
    return text || null;
  } catch {
    return null;
  }
}

async function selectedWorkspaceId(daemonUrl: string, args: string[]): Promise<string> {
  const target = getOption(args, "--workspace");
  if (target) return await resolveWorkspaceId(daemonUrl, target);
  const current = await fetch(`${daemonUrl}/api/v1/workspaces/current`).then((r) => r.json()) as { current?: { id: string } | null };
  if (!current.current?.id) throw new Error("No current workspace is selected. Pass --workspace <name|id>.");
  return current.current.id;
}

interface CliWorkspaceStatus {
  fleet: { name: string };
  ui: { host: string; port: number };
  policy: { mode: string };
  runtime: { globalDefaultHost: string | null };
  mainRole: { id: string; name: string } | null;
  roles: Array<{ id: string; name: string; path: string; host_default: string | null; git_root?: string | null }>;
  currentWorkspace: { id: string; name: string };
}

async function workspaceStatus(daemonUrl: string, workspaceId: string): Promise<CliWorkspaceStatus> {
  const res = await fetch(`${daemonUrl}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/status`);
  const body = await res.json().catch(() => ({})) as { error?: string } & CliWorkspaceStatus;
  if (!res.ok) throw new Error(body.error ?? `status failed (HTTP ${res.status})`);
  return body;
}

async function cmdRoles(args: string[]): Promise<void> {
  const url = await requireDaemonUrl();
  const workspaceId = await selectedWorkspaceId(url, args);
  const status = await workspaceStatus(url, workspaceId);
  if (status.roles.length === 0) {
    console.log("No roles found. Refresh discovery after adding child directories.");
    return;
  }
  for (const role of status.roles) {
    const marker = status.mainRole?.id === role.id ? "*" : " ";
    console.log(`${marker} ${role.name}\t${role.path}\t${role.host_default}${role.git_root ? `\tgit=${role.git_root}` : ""}`);
  }
}

async function cmdSetMain(args: string[]): Promise<void> {
  const roleName = commandPositionals(args)[0];
  if (!roleName) throw new Error("set-main requires a role name");
  const url = await requireDaemonUrl();
  const workspaceId = await selectedWorkspaceId(url, args);
  const res = await fetch(`${url}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/main-role`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: roleName }),
  });
  const body = await res.json().catch(() => ({})) as { ok?: boolean; role?: { name: string }; error?: string };
  if (!res.ok || body.ok === false || !body.role) throw new Error(body.error ?? `set-main failed (HTTP ${res.status})`);
  console.log(`Main role set to ${body.role.name}`);
}

async function cmdStatus(args: string[]): Promise<void> {
  const url = await requireDaemonUrl();
  const workspaceId = await selectedWorkspaceId(url, args);
  const status = await workspaceStatus(url, workspaceId);
  const current = await fetch(`${url}/api/v1/workspaces/current`).then((r) => r.json()).catch(() => ({})) as { current?: { id: string } | null };
  console.log(`fleet: ${status.fleet.name}`);
  console.log(`workspace: ${status.currentWorkspace.name}${current.current?.id === workspaceId ? " (current)" : ""}`);
  console.log(`ui:    http://${status.ui.host}:${status.ui.port}`);
  console.log(`policy: ${status.policy.mode}`);
  console.log(`default runtime: ${status.runtime.globalDefaultHost ?? "not set"}`);
  console.log(`roles: ${status.roles.length}`);
  console.log(`main:  ${status.mainRole?.name ?? "not set"}`);
  console.log(`daemon home: ${defaultDaemonHome()}`);
}

async function cmdStart(args: string[]): Promise<void> {
  const portValue = getOption(args, "--port");
  const port = portValue ? Number(portValue) : undefined;
  if (portValue && !Number.isInteger(port)) throw new Error(`Invalid --port value: ${portValue}`);
  const foreground = hasFlag(args, "--foreground") || process.env.WHATSAGENT_FOREGROUND === "1";
  // EP-022 / WA-094: per-launch ceiling cap for RBAC enforcement. Caps
  // workspace effective mode at the supplied strictness level (most-
  // permissive — `--rbac-mode=off` forces every workspace to off
  // regardless of stored mode; `--rbac-mode=enforce` does not tighten
  // a stored `soft` or `off`). Stored workspace modes are flipped via
  // the Roles tab UI / `PATCH /api/v1/workspaces/:id/rbac-mode`, not
  // this flag.
  const rbacModeValue = getOption(args, "--rbac-mode");
  let rbacModeCeiling: import("./daemon-db.ts").RbacMode | null = null;
  if (rbacModeValue !== null) {
    const { isRbacMode, RBAC_MODES } = await import("./daemon-db.ts");
    if (!isRbacMode(rbacModeValue)) {
      throw new Error(`Invalid --rbac-mode value: ${rbacModeValue} (expected one of: ${RBAC_MODES.join(", ")})`);
    }
    rbacModeCeiling = rbacModeValue;
  }

  if (foreground) {
    const daemon = await startDaemon({ port, consoleLogs: true, rbacModeCeiling });
    console.log(`WhatsAgent started: ${daemon.url}`);
    console.log(`logs: ${daemon.state.logger.path}`);
    console.log("Press Ctrl-C to stop daemon and web UI.");
    const shutdown = () => { void daemon.stop().finally(() => process.exit(0)); };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    await new Promise(() => undefined);
    return;
  }

  // Detached background mode. Refuse if a daemon already runs against
  // this daemon home (PID file present + alive). Otherwise spawn a child
  // that re-enters cmdStart with --foreground, redirect stdio to the
  // daemon log, and exit 0 from the parent.
  const daemonHome = defaultDaemonHome();
  await mkdir(daemonHome, { recursive: true, mode: 0o700 });
  await mkdir(`${daemonHome}/logs`, { recursive: true, mode: 0o700 });
  const existingPid = await readDaemonPid(`${daemonHome}/daemon.pid`);
  if (existingPid) {
    try { process.kill(existingPid, 0); } catch { /* stale */ }
    if (existingPid && (await pidAlive(existingPid))) {
      const url = await readDaemonUrl(daemonHome);
      console.log(`WhatsAgent daemon already running (pid ${existingPid})${url ? ` at ${url}` : ""}.`);
      console.log("Use `whatsagent stop` to stop it.");
      return;
    }
  }
  const logPath = `${daemonHome}/logs/daemon.log`;
  const logFd = openSync(logPath, "a", 0o600);
  const cliPath = fileURLToPath(import.meta.url);
  const childArgs = ["--foreground"];
  if (portValue) childArgs.push("--port", portValue);
  if (rbacModeCeiling) childArgs.push("--rbac-mode", rbacModeCeiling);
  const child = spawn(process.execPath, [cliPath, "start", ...childArgs], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, WHATSAGENT_FOREGROUND: "1" },
  });
  if (!child.pid) throw new Error("daemon child failed to spawn");
  child.unref();
  console.log(`WhatsAgent daemon starting (pid ${child.pid}).`);
  console.log(`logs: ${logPath}`);
  // Brief wait for the child to write daemon.url so the user sees the
  // address immediately. Bail loudly if the child exits before writing
  // it — most often a port collision, which the parent should surface
  // instead of silently appearing to succeed.
  let url: string | null = null;
  for (let i = 0; i < 30; i++) {
    url = await readDaemonUrl(daemonHome);
    if (url) break;
    if (!await pidAlive(child.pid)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (url) {
    console.log(`url:  ${url}`);
    return;
  }
  // No url after deadline OR child exited — read log tail to surface
  // the actual error to the user.
  const tail = await tailLogLines(logPath, 8);
  if (tail.length > 0) {
    console.error(`Daemon failed to start. Last log lines:`);
    for (const line of tail) console.error(`  ${line}`);
  } else {
    console.error(`Daemon failed to start; nothing in ${logPath}.`);
  }
  console.error(`If port ${portValue ?? "(default 4017)"} is in use, free it first or pass --port <other>.`);
  // Best-effort kill the child if it's lingering.
  if (await pidAlive(child.pid)) {
    try { process.kill(child.pid, "SIGTERM"); } catch { /* race */ }
  }
  await rmIfExists(`${daemonHome}/daemon.pid`);
  process.exitCode = 1;
}

async function tailLogLines(path: string, n: number): Promise<string[]> {
  try {
    const text = await readFile(path, "utf8");
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    return lines.slice(-n);
  } catch {
    return [];
  }
}

async function pidAlive(pid: number): Promise<boolean> {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function cmdStop(args: string[]): Promise<void> {
  const daemonHome = defaultDaemonHome();
  const pid = await readDaemonPid(`${daemonHome}/daemon.pid`);
  if (!pid) {
    console.log("No daemon PID file. Use `whatsagent stop-all` to clean up runners only.");
    return;
  }
  if (!await pidAlive(pid)) {
    console.log(`PID file references dead pid ${pid}; clearing it.`);
    await rmIfExists(`${daemonHome}/daemon.pid`);
    return;
  }

  const slots = workspaceSlotsForFleet(daemonHome);
  const runners = await discoverWorkspaceRunners(slots);

  const daemonOnly = hasFlag(args, "--daemon-only");
  const all = hasFlag(args, "--all");
  let action: "daemon-only" | "all" | "cancel";
  if (daemonOnly && all) throw new Error("--daemon-only and --all are mutually exclusive");
  if (daemonOnly) action = "daemon-only";
  else if (all) action = "all";
  else action = await promptStopAction(pid, runners);

  if (action === "cancel") { console.log("Cancelled."); return; }

  if (action === "all") {
    for (const r of runners) {
      if (!r.runnerAlive) continue;
      // EP-DEC-RUN WA-003 (advisor msg #3): print displayId when present
      // so two same-bare-name agents in different repos are distinguishable.
      // Falls back to bare role for legacy pre-cutover metadata files.
      console.log(`Stopping ${r.workspaceName ?? r.workspaceId}/${r.displayId || r.role} (pid ${r.runnerPid})...`);
      const result = await killRunner(r.runnerPid, { timeoutMs: 5000 });
      if (result.alive) console.log(`  failed to stop pid ${r.runnerPid} after SIGKILL`);
    }
  }

  console.log(`Stopping daemon (pid ${pid})...`);
  try { process.kill(pid, "SIGTERM"); } catch { /* already exited */ }
  const exited = await waitForExit(pid, 5000);
  if (!exited) {
    console.log(`Daemon (pid ${pid}) didn't exit within 5s; sending SIGKILL.`);
    try { process.kill(pid, "SIGKILL"); } catch { /* race */ }
  }
  await rmIfExists(`${daemonHome}/daemon.pid`);
  await rmIfExists(`${daemonHome}/daemon.url`);
  console.log("Stopped.");
}

async function cmdStopAll(): Promise<void> {
  const daemonHome = defaultDaemonHome();
  const slots = workspaceSlotsForFleet(daemonHome);
  const runners = await discoverWorkspaceRunners(slots);
  if (runners.length === 0) console.log("No runner metadata files found.");
  for (const r of runners) {
    if (r.runnerAlive) {
      // EP-DEC-RUN WA-003 (advisor msg #3): print displayId when present
      // so two same-bare-name agents in different repos are distinguishable.
      // Falls back to bare role for legacy pre-cutover metadata files.
      console.log(`Stopping ${r.workspaceName ?? r.workspaceId}/${r.displayId || r.role} (pid ${r.runnerPid})...`);
      await killRunner(r.runnerPid, { timeoutMs: 5000 });
    }
    await rmIfExists(r.metadataPath);
  }
  const pid = await readDaemonPid(`${daemonHome}/daemon.pid`);
  if (pid && await pidAlive(pid)) {
    console.log(`Stopping daemon (pid ${pid})...`);
    try { process.kill(pid, "SIGTERM"); } catch { /* race */ }
    const exited = await waitForExit(pid, 5000);
    if (!exited) try { process.kill(pid, "SIGKILL"); } catch { /* race */ }
  }
  await rmIfExists(`${daemonHome}/daemon.pid`);
  await rmIfExists(`${daemonHome}/daemon.url`);
  console.log("All stopped.");
}

async function rmIfExists(path: string): Promise<void> {
  await import("node:fs/promises").then((m) => m.rm(path, { force: true }).catch(() => undefined));
}

function workspaceSlotsForFleet(daemonHome: string): Array<{ workspaceId: string; workspaceName: string | null; runDir: string }> {
  const homePaths = daemonHomePaths(daemonHome);
  let rows: WorkspaceRow[] = [];
  try {
    const db = openDaemonDb(homePaths.daemonDbPath);
    try { rows = listWorkspacesDb(db); } finally { db.close(); }
  } catch {
    return [];
  }
  return rows.map((row) => ({
    workspaceId: row.id,
    workspaceName: row.name,
    runDir: `${homePaths.workspacesDir}/${row.id}/run`,
  }));
}

async function promptStopAction(daemonPid: number, runners: Array<{ workspaceName: string | null; workspaceId: string; role: string; displayId: string; runnerPid: number; runnerAlive: boolean }>): Promise<"daemon-only" | "all" | "cancel"> {
  console.log(`Daemon pid: ${daemonPid}`);
  if (runners.length === 0) {
    console.log("No managed runners.");
  } else {
    console.log("Managed runners:");
    // EP-DEC-RUN WA-003: print displayId column so multi-repo same-name
    // agents are distinguishable.
    console.log("  Workspace        Display id           PID       Alive");
    for (const r of runners) {
      const ws = (r.workspaceName ?? r.workspaceId).slice(0, 16).padEnd(16);
      const id = (r.displayId || r.role).slice(0, 20).padEnd(20);
      const pid = String(r.runnerPid).padEnd(8);
      const alive = r.runnerAlive ? "yes" : "no";
      console.log(`  ${ws} ${id}  ${pid}  ${alive}`);
    }
  }
  process.stdout.write("Stop daemon only [d], stop daemon + all sessions [a], cancel [c]? ");
  const line = (await readStdinLine()).trim().toLowerCase();
  if (line === "a" || line === "all") return "all";
  if (line === "d" || line === "daemon" || line === "daemon-only") return "daemon-only";
  return "cancel";
}

async function readStdinLine(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => {
      chunks.push(chunk as Buffer);
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.includes("\n")) {
        process.stdin.pause();
        resolve(text.split("\n")[0]!);
      }
    });
    process.stdin.resume();
  });
}

// ---- workspace commands -------------------------------------------------

async function cmdWorkspace(args: string[]): Promise<void> {
  if (isHelpFlag(args) || args.length === 0) { console.log(HELP_WORKSPACE); return; }
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === "list") return await cmdWorkspaceList(rest);
  if (sub === "add") return await cmdWorkspaceAdd(rest);
  if (sub === "edit") return await cmdWorkspaceEdit(rest);
  if (sub === "remove") return await cmdWorkspaceRemove(rest);
  if (sub === "restore") return await cmdWorkspaceRestore(rest);
  if (sub === "purge") return await cmdWorkspacePurge(rest);
  if (sub === "switch") return await cmdWorkspaceSwitch(rest);
  if (sub === "repo") return await cmdWorkspaceRepo(rest);
  if (sub === "scan-dir") return await cmdWorkspaceScanDir(rest);
  if (sub === "scan") return await cmdWorkspaceScan(rest);
  throw new Error(`Unknown workspace subcommand: ${sub}\n\n${HELP_WORKSPACE}`);
}

async function cmdWorkspaceSwitch(args: string[]): Promise<void> {
  const target = positional(args)[0];
  if (!target) throw new Error("workspace switch requires a name or id");
  const url = await requireDaemonUrl();
  const id = await resolveWorkspaceId(url, target);
  const res = await fetch(`${url}/api/v1/workspaces/current`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const body = await res.json() as { ok: boolean; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `switch failed (HTTP ${res.status})`);
  console.log(`Switched current workspace to ${target} (${id}).`);
}

async function requireDaemonUrl(): Promise<string> {
  const url = await readDaemonUrl(defaultDaemonHome());
  if (!url) throw new Error("Daemon is not running. Start it with `whatsagent start` first.");
  return url;
}

async function cmdWorkspaceList(args: string[]): Promise<void> {
  const includeTrash = hasFlag(args, "--include-trash");
  const url = await requireDaemonUrl();
  const res = await fetch(`${url}/api/v1/workspaces${includeTrash ? "?include_trash=1" : ""}`);
  const body = await res.json() as { workspaces: WorkspaceRow[]; currentWorkspaceId: string | null };
  if (body.workspaces.length === 0) {
    console.log("No workspaces.");
    return;
  }
  console.log("  ID                                Name                   Status");
  for (const ws of body.workspaces) {
    const marker = ws.id === body.currentWorkspaceId ? "*" : " ";
    console.log(`${marker} ${ws.id.padEnd(32)}  ${ws.name.slice(0, 22).padEnd(22)} ${ws.status}`);
  }
}

async function cmdWorkspaceAdd(args: string[]): Promise<void> {
  // Workspace decoupling: `workspace add <name>` (formerly `<path>`).
  // Repo and scan-dir CRUD subcommands land in WA-072 (EP-DEC-3).
  const name = positional(args)[0];
  if (!name) throw new Error("workspace add requires a name");
  const kanbanPrefix = getOption(args, "--kanban-prefix") ?? undefined;
  // EP-022 / WA-094: workspace creation requires an explicit RBAC mode.
  // The CLI mirrors the API requirement: no implicit default at the
  // operator surface either. Use `--rbac-mode=enforce` to match the
  // schema default; `soft` and `off` opt into legacy / open behavior.
  const rbacModeRaw = getOption(args, "--rbac-mode");
  if (rbacModeRaw === null) {
    throw new Error("workspace add requires --rbac-mode=<enforce|soft|off>");
  }
  const { isRbacMode, RBAC_MODES } = await import("./daemon-db.ts");
  if (!isRbacMode(rbacModeRaw)) {
    throw new Error(`Invalid --rbac-mode value: ${rbacModeRaw} (expected one of: ${RBAC_MODES.join(", ")})`);
  }
  const rbacMode = rbacModeRaw;
  const url = await requireDaemonUrl();
  const res = await fetch(`${url}/api/v1/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, kanbanPrefix, rbacMode }),
  });
  const body = await res.json() as { ok: boolean; workspace?: WorkspaceRow; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `add failed (HTTP ${res.status})`);
  console.log(`Added workspace ${body.workspace!.name} (${body.workspace!.id}) [rbac=${rbacMode}].`);
}

async function resolveWorkspaceId(daemonUrl: string, nameOrId: string, opts: { includeTrash?: boolean } = {}): Promise<string> {
  const res = await fetch(`${daemonUrl}/api/v1/workspaces${opts.includeTrash ? "?include_trash=1" : ""}`);
  const body = await res.json() as { workspaces: WorkspaceRow[] };
  // Workspace IDs are dash-less 32-char hex; users frequently paste a
  // dashed UUID or a truncated prefix (the `workspace list` table caps
  // each id at 30 chars). Match liberally: name equality, exact id
  // match, dash-stripped match, or prefix match.
  const needle = nameOrId.replace(/-/g, "").toLowerCase();
  const exact = body.workspaces.filter((w) => w.id === needle || w.name === nameOrId);
  if (exact.length === 1) return exact[0]!.id;
  if (exact.length > 1) throw new Error(`${JSON.stringify(nameOrId)} matches multiple workspaces; pass the full id`);
  const prefix = needle.length >= 6 ? body.workspaces.filter((w) => w.id.startsWith(needle)) : [];
  if (prefix.length === 1) return prefix[0]!.id;
  if (prefix.length > 1) throw new Error(`prefix ${JSON.stringify(nameOrId)} matches ${prefix.length} workspaces; pass more characters`);
  const match = body.workspaces.find((w) => w.id === nameOrId || w.name === nameOrId);
  if (!match) throw new Error(`No workspace named or id'd ${JSON.stringify(nameOrId)}`);
  return match.id;
}

async function cmdWorkspaceRemove(args: string[]): Promise<void> {
  const target = positional(args)[0];
  if (!target) throw new Error("workspace remove requires a name or id");
  const url = await requireDaemonUrl();
  const id = await resolveWorkspaceId(url, target);
  const res = await fetch(`${url}/api/v1/workspaces/${id}/trash`, { method: "POST" });
  const body = await res.json() as { ok: boolean; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `trash failed (HTTP ${res.status})`);
  console.log(`Trashed workspace ${target}.`);
}

async function cmdWorkspaceRestore(args: string[]): Promise<void> {
  const target = positional(args)[0];
  if (!target) throw new Error("workspace restore requires a name or id");
  const url = await requireDaemonUrl();
  const id = await resolveWorkspaceId(url, target, { includeTrash: true });
  const res = await fetch(`${url}/api/v1/workspaces/${id}/restore`, { method: "POST" });
  const body = await res.json() as { ok: boolean; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `restore failed (HTTP ${res.status})`);
  console.log(`Restored workspace ${target}.`);
}

async function cmdWorkspacePurge(args: string[]): Promise<void> {
  const target = positional(args)[0];
  if (!target) throw new Error("workspace purge requires a name or id");
  const url = await requireDaemonUrl();
  const id = await resolveWorkspaceId(url, target, { includeTrash: true });
  const res = await fetch(`${url}/api/v1/workspaces/${id}/purge`, { method: "POST" });
  const body = await res.json() as { ok: boolean; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `purge failed (HTTP ${res.status})`);
  console.log(`Purged workspace ${target}.`);
}

// ---- workspace edit / repo / scan-dir / scan / role -------------------

interface ApiRepo {
  id: string;
  name: string;
  absolutePath: string;
  gitRoot: string | null;
  sourceScanId: string | null;
  missingAt: string | null;
  roleCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ApiScanDir {
  id: string;
  absolutePath: string;
  scanOnStartup: boolean;
  lastScanAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ApiRole {
  id: string;
  name: string;
  repoId: string;
  repoName: string;
  displayId: string;
  hostDefault: string | null;
  defaultHostType: string | null;
  createdAt: string;
  updatedAt: string;
}

async function cmdWorkspaceEdit(args: string[]): Promise<void> {
  const target = positional(args)[0];
  if (!target) throw new Error("workspace edit requires a name or id");
  const url = await requireDaemonUrl();
  const id = await resolveWorkspaceId(url, target);
  const name = getOption(args, "--name") ?? undefined;
  const kanbanPrefix = getOption(args, "--kanban-prefix") ?? undefined;
  if (name === undefined && kanbanPrefix === undefined) {
    throw new Error("workspace edit requires --name and/or --kanban-prefix");
  }
  const res = await fetch(`${url}/api/v1/workspaces/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, kanbanPrefix }),
  });
  const body = await res.json() as { ok: boolean; workspace?: WorkspaceRow; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `edit failed (HTTP ${res.status})`);
  console.log(`Updated workspace ${body.workspace!.name} (${body.workspace!.id}).`);
}

async function listRepos(url: string, wsId: string): Promise<ApiRepo[]> {
  const res = await fetch(`${url}/api/v1/workspaces/${wsId}/repos`);
  const body = await res.json() as { ok: boolean; repos: ApiRepo[]; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `list repos failed (HTTP ${res.status})`);
  return body.repos;
}

async function resolveRepoId(url: string, wsId: string, idOrName: string): Promise<{ id: string; repo: ApiRepo }> {
  const repos = await listRepos(url, wsId);
  const exact = repos.find((r) => r.id === idOrName || r.name === idOrName);
  if (exact) return { id: exact.id, repo: exact };
  throw new Error(`No repo named or id'd ${JSON.stringify(idOrName)}`);
}

async function cmdWorkspaceRepo(args: string[]): Promise<void> {
  if (isHelpFlag(args) || args.length === 0) { console.log(HELP_WORKSPACE); return; }
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === "add") return await cmdWorkspaceRepoAdd(rest);
  if (sub === "list") return await cmdWorkspaceRepoList(rest);
  if (sub === "remove") return await cmdWorkspaceRepoRemove(rest);
  throw new Error(`Unknown workspace repo subcommand: ${sub}\n\n${HELP_WORKSPACE}`);
}

async function cmdWorkspaceRepoAdd(args: string[]): Promise<void> {
  const [wsTarget, absolutePath] = positional(args);
  if (!wsTarget) throw new Error("workspace repo add requires <workspace>");
  if (!absolutePath) throw new Error("workspace repo add requires <abs-path>");
  const url = await requireDaemonUrl();
  const wsId = await resolveWorkspaceId(url, wsTarget);
  const name = getOption(args, "--name") ?? undefined;
  const res = await fetch(`${url}/api/v1/workspaces/${wsId}/repos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ absolutePath, name }),
  });
  const body = await res.json() as { ok: boolean; repo?: ApiRepo; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `add repo failed (HTTP ${res.status})`);
  console.log(`Added repo ${body.repo!.name} (${body.repo!.id}) at ${body.repo!.absolutePath}.`);
}

async function cmdWorkspaceRepoList(args: string[]): Promise<void> {
  const wsTarget = positional(args)[0];
  if (!wsTarget) throw new Error("workspace repo list requires <workspace>");
  const url = await requireDaemonUrl();
  const wsId = await resolveWorkspaceId(url, wsTarget);
  const repos = await listRepos(url, wsId);
  if (repos.length === 0) { console.log("No repos."); return; }
  console.log("  ID                                    Name                Roles  Path");
  for (const repo of repos) {
    const missing = repo.missingAt ? " [missing]" : "";
    console.log(`  ${repo.id.padEnd(36)}  ${repo.name.slice(0, 18).padEnd(18)}  ${String(repo.roleCount).padEnd(5)}  ${repo.absolutePath}${missing}`);
  }
}

async function cmdWorkspaceRepoRemove(args: string[]): Promise<void> {
  const [wsTarget, repoTarget] = positional(args);
  if (!wsTarget) throw new Error("workspace repo remove requires <workspace>");
  if (!repoTarget) throw new Error("workspace repo remove requires <repo-id-or-name>");
  const url = await requireDaemonUrl();
  const wsId = await resolveWorkspaceId(url, wsTarget);
  const { id: repoId, repo } = await resolveRepoId(url, wsId, repoTarget);
  const res = await fetch(`${url}/api/v1/workspaces/${wsId}/repos/${repoId}`, { method: "DELETE" });
  const body = await res.json() as { ok: boolean; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `remove repo failed (HTTP ${res.status})`);
  console.log(`Removed repo ${repo.name} (${repoId}).`);
}

async function listScanDirs(url: string, wsId: string): Promise<ApiScanDir[]> {
  const res = await fetch(`${url}/api/v1/workspaces/${wsId}/scan-dirs`);
  const body = await res.json() as { ok: boolean; scanDirs: ApiScanDir[]; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `list scan-dirs failed (HTTP ${res.status})`);
  return body.scanDirs;
}

async function resolveScanDirId(url: string, wsId: string, idOrPath: string): Promise<ApiScanDir> {
  const scans = await listScanDirs(url, wsId);
  const match = scans.find((s) => s.id === idOrPath || s.absolutePath === idOrPath);
  if (!match) throw new Error(`No scan dir matching ${JSON.stringify(idOrPath)}`);
  return match;
}

async function cmdWorkspaceScanDir(args: string[]): Promise<void> {
  if (isHelpFlag(args) || args.length === 0) { console.log(HELP_WORKSPACE); return; }
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === "add") return await cmdWorkspaceScanDirAdd(rest);
  if (sub === "list") return await cmdWorkspaceScanDirList(rest);
  if (sub === "remove") return await cmdWorkspaceScanDirRemove(rest);
  throw new Error(`Unknown workspace scan-dir subcommand: ${sub}\n\n${HELP_WORKSPACE}`);
}

async function cmdWorkspaceScanDirAdd(args: string[]): Promise<void> {
  const [wsTarget, absolutePath] = positional(args);
  if (!wsTarget) throw new Error("workspace scan-dir add requires <workspace>");
  if (!absolutePath) throw new Error("workspace scan-dir add requires <abs-path>");
  const scanOnStartup = hasFlag(args, "--scan-on-startup");
  const url = await requireDaemonUrl();
  const wsId = await resolveWorkspaceId(url, wsTarget);
  const res = await fetch(`${url}/api/v1/workspaces/${wsId}/scan-dirs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ absolutePath, scanOnStartup }),
  });
  const body = await res.json() as { ok: boolean; scanDir?: ApiScanDir; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `add scan-dir failed (HTTP ${res.status})`);
  const startup = body.scanDir!.scanOnStartup ? " [scan-on-startup]" : "";
  console.log(`Added scan dir ${body.scanDir!.absolutePath} (${body.scanDir!.id})${startup}.`);
}

async function cmdWorkspaceScanDirList(args: string[]): Promise<void> {
  const wsTarget = positional(args)[0];
  if (!wsTarget) throw new Error("workspace scan-dir list requires <workspace>");
  const url = await requireDaemonUrl();
  const wsId = await resolveWorkspaceId(url, wsTarget);
  const scans = await listScanDirs(url, wsId);
  if (scans.length === 0) { console.log("No scan dirs."); return; }
  console.log("  ID                                    Startup  Last scan             Path");
  for (const scan of scans) {
    const startup = scan.scanOnStartup ? "yes" : "no";
    const last = scan.lastScanAt ?? "never";
    console.log(`  ${scan.id.padEnd(36)}  ${startup.padEnd(7)}  ${last.padEnd(20)}  ${scan.absolutePath}`);
  }
}

async function cmdWorkspaceScanDirRemove(args: string[]): Promise<void> {
  const [wsTarget, scanTarget] = positional(args);
  if (!wsTarget) throw new Error("workspace scan-dir remove requires <workspace>");
  if (!scanTarget) throw new Error("workspace scan-dir remove requires <id-or-path>");
  const url = await requireDaemonUrl();
  const wsId = await resolveWorkspaceId(url, wsTarget);
  const scan = await resolveScanDirId(url, wsId, scanTarget);
  const res = await fetch(`${url}/api/v1/workspaces/${wsId}/scan-dirs/${scan.id}`, { method: "DELETE" });
  const body = await res.json() as { ok: boolean; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `remove scan-dir failed (HTTP ${res.status})`);
  console.log(`Removed scan dir ${scan.absolutePath} (${scan.id}).`);
}

async function runScan(url: string, wsId: string, scan: ApiScanDir): Promise<void> {
  const res = await fetch(`${url}/api/v1/workspaces/${wsId}/scan-dirs/${scan.id}/scan`, { method: "POST" });
  const body = await res.json() as { ok: boolean; added?: ApiRepo[]; skipped?: string[]; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `scan failed (HTTP ${res.status})`);
  console.log(`Scanned ${scan.absolutePath}: ${body.added?.length ?? 0} added, ${body.skipped?.length ?? 0} skipped.`);
  for (const repo of body.added ?? []) console.log(`  + ${repo.name}  ${repo.absolutePath}`);
  for (const skipped of body.skipped ?? []) console.log(`  ~ skipped ${skipped}`);
}

async function cmdWorkspaceScan(args: string[]): Promise<void> {
  const [wsTarget, scanTarget] = positional(args);
  if (!wsTarget) throw new Error("workspace scan requires <workspace>");
  const url = await requireDaemonUrl();
  const wsId = await resolveWorkspaceId(url, wsTarget);
  if (scanTarget) {
    const scan = await resolveScanDirId(url, wsId, scanTarget);
    await runScan(url, wsId, scan);
    return;
  }
  // No scan-dir specified: run every scan dir on the workspace.
  const scans = await listScanDirs(url, wsId);
  if (scans.length === 0) { console.log("No scan dirs to run."); return; }
  for (const scan of scans) await runScan(url, wsId, scan);
}

// ---- role subcommands -------------------------------------------------

async function listWorkspaceRoles(url: string, wsId: string): Promise<ApiRole[]> {
  const res = await fetch(`${url}/api/v1/workspaces/${wsId}/roles-by-id`);
  const body = await res.json() as { ok: boolean; roles: ApiRole[]; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `list roles failed (HTTP ${res.status})`);
  return body.roles;
}

async function cmdRole(args: string[]): Promise<void> {
  if (isHelpFlag(args) || args.length === 0) { console.log(HELP_ROLE); return; }
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === "add") return await cmdRoleAdd(rest);
  if (sub === "list") return await cmdRoleList(rest);
  if (sub === "remove") return await cmdRoleRemove(rest);
  throw new Error(`Unknown role subcommand: ${sub}\n\n${HELP_ROLE}`);
}

async function cmdRoleAdd(args: string[]): Promise<void> {
  const [wsTarget, repoTarget, name] = positional(args);
  if (!wsTarget) throw new Error("role add requires <workspace>");
  if (!repoTarget) throw new Error("role add requires <repo>");
  if (!name) throw new Error("role add requires <name>");
  const host = getOption(args, "--host") ?? undefined;
  const url = await requireDaemonUrl();
  const wsId = await resolveWorkspaceId(url, wsTarget);
  const { id: repoId } = await resolveRepoId(url, wsId, repoTarget);
  const res = await fetch(`${url}/api/v1/workspaces/${wsId}/roles-by-id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoId, name, host }),
  });
  const body = await res.json() as { ok: boolean; role?: ApiRole; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `add role failed (HTTP ${res.status})`);
  console.log(`Added role ${body.role!.displayId} (${body.role!.id}).`);
}

async function cmdRoleList(args: string[]): Promise<void> {
  const wsTarget = positional(args)[0];
  if (!wsTarget) throw new Error("role list requires <workspace>");
  const url = await requireDaemonUrl();
  const wsId = await resolveWorkspaceId(url, wsTarget);
  const roles = await listWorkspaceRoles(url, wsId);
  if (roles.length === 0) { console.log("No roles."); return; }
  console.log("  ID                                    Display id                 Host default");
  for (const role of roles) {
    console.log(`  ${role.id.padEnd(36)}  ${role.displayId.padEnd(24)}  ${role.hostDefault ?? "(none)"}`);
  }
}

async function cmdRoleRemove(args: string[]): Promise<void> {
  const [wsTarget, displayId] = positional(args);
  if (!wsTarget) throw new Error("role remove requires <workspace>");
  if (!displayId) throw new Error("role remove requires <repo:name>");
  if (!displayId.includes(":")) throw new Error(`role remove expects "<repo>:<name>", got ${JSON.stringify(displayId)}`);
  const url = await requireDaemonUrl();
  const wsId = await resolveWorkspaceId(url, wsTarget);
  const roles = await listWorkspaceRoles(url, wsId);
  const role = roles.find((r) => r.displayId === displayId);
  if (!role) throw new Error(`No role with display id ${JSON.stringify(displayId)}`);
  const res = await fetch(`${url}/api/v1/workspaces/${wsId}/roles-by-id/${role.id}`, { method: "DELETE" });
  const body = await res.json() as { ok: boolean; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `remove role failed (HTTP ${res.status})`);
  console.log(`Removed role ${role.displayId} (${role.id}).`);
}

// ---- config get/set ----------------------------------------------------

async function cmdConfig(args: string[]): Promise<void> {
  if (isHelpFlag(args) || args.length === 0) { console.log(HELP_CONFIG); return; }
  const sub = args[0];
  const rest = args.slice(1);
  const home = defaultDaemonHome();
  const homePaths = daemonHomePaths(home);
  const db = openDaemonDb(homePaths.daemonDbPath);
  try {
    if (sub === "get") {
      const key = positional(rest)[0];
      if (!key) throw new Error("config get requires a key");
      if (key === "trash.retention-days") {
        console.log(String(getTrashRetentionDays(db)));
        return;
      }
      throw new Error(`Unknown config key: ${key}`);
    }
    if (sub === "set") {
      const [key, valueRaw] = positional(rest);
      if (!key || valueRaw === undefined) throw new Error("config set requires a key and value");
      if (key === "trash.retention-days") {
        const value = Number.parseInt(valueRaw, 10);
        if (!Number.isFinite(value) || value < 0) throw new Error("trash.retention-days must be a non-negative integer");
        setTrashRetentionDays(db, value);
        console.log(`Set trash.retention-days to ${value}.`);
        return;
      }
      throw new Error(`Unknown config key: ${key}`);
    }
    throw new Error(`Unknown config subcommand: ${sub ?? "(none)"}`);
  } finally {
    db.close();
  }
}

async function cmdRunner(args: string[]): Promise<void> {
  const host = requireOption(args, "--host");
  const workspaceId = getOption(args, "--workspace-id") ?? undefined;
  const role = requireOption(args, "--role");
  // EP-DEC-RUN WA-003: launcher passes `--display-id` for FS-path keying.
  // Falls back to bare role if absent (legacy `_runner` invocations or
  // hand-typed CLI for debugging).
  const displayId = getOption(args, "--display-id") ?? role;
  await runRunnerProcess({
    fleetId: requireOption(args, "--fleet-id"),
    workspaceId,
    role,
    displayId,
    sessionId: requireOption(args, "--session"),
    controlSecret: requireOption(args, "--control-secret"),
    hostType: normalizeHostType(host, host),
    cwd: requireOption(args, "--cwd"),
    runDir: requireOption(args, "--run-dir"),
    logPath: requireOption(args, "--log"),
  });
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    switch (cmd) {
      case "init":
        // EP-DEC-3 (WA-070) removed `whatsagent init`. The daemon now boots
        // empty against `~/.whatsagent`; create workspaces/repos/roles via
        // the UI or the upcoming subcommands (WA-072).
        throw new Error(
          "`whatsagent init` was removed in EP-DEC-3. Run `whatsagent start` to launch the daemon, then create a workspace via the UI.",
        );
      case "roles":
        await cmdRoles(args);
        break;
      case "set-main":
        await cmdSetMain(args);
        break;
      case "status":
        await cmdStatus(args);
        break;
      case "start":
        await cmdStart(args);
        break;
      case "stop":
        await cmdStop(args);
        break;
      case "stop-all":
        await cmdStopAll();
        break;
      case "workspace":
        await cmdWorkspace(args);
        break;
      case "role":
        await cmdRole(args);
        break;
      case "config":
        await cmdConfig(args);
        break;
      case "_runner":
        await cmdRunner(args);
        break;
      // Read GET workspace shortcut for completeness; future tests can call it.
      case "_workspace-list-current":
        await (async () => {
          const home = defaultDaemonHome();
          const db = openDaemonDb(daemonHomePaths(home).daemonDbPath);
          try {
            console.log(getCurrentWorkspaceId(db) ?? "");
          } finally {
            db.close();
          }
        })();
        break;
      case undefined:
      case "help":
      case "--help":
      case "-h":
        console.log(usage());
        break;
      default:
        throw new Error(`Unknown command: ${cmd}\n\n${usage()}`);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
