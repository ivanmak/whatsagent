import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Database } from "bun:sqlite";

import type { HostType } from "./runner/protocol.ts";
import { activeWorkspacePaths } from "./paths.ts";
import {
  generateWorkspaceId,
  insertWorkspace,
  type WorkspaceRow,
  updateWorkspaceStatus,
} from "./daemon-db.ts";
import { migrate, openFleetDb, runStartupRepair, setKanbanSettings } from "./db.ts";

export interface WhatsAgentConfig {
  fleet: {
    name: string;
    root: string;
  };
  ui: {
    host: string;
    port: number;
    // Optional list of additional hostnames or exact origins the daemon accepts
    // for Host / Origin checks. Bare hostnames authorize only Host; browser
    // Origin / Referer checks require exact scheme://host[:port] entries.
    allowHosts?: string[];
  };
  policy: {
    mode: "star" | "peer-to-peer" | "channel";
  };
  commands: {
    claudeCode: { command: string; args: string[] };
    openCode: { command: string; args: string[] };
    codex: { command: string; args: string[] };
    pi: { command: string; args: string[] };
  };
}

export function sanitizeRoleName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return sanitized || "role";
}

export interface DefaultDaemonConfigInput {
  daemonHome: string;
  port?: number;
  host?: string;
  allowHosts?: string[];
  fleetName?: string;
}

// In-memory daemon config used by every daemon-state consumer (web shell,
// runner launcher, snapshot endpoint). Pure factory — no I/O. Higher-level
// `resolveDaemonConfig()` overlays `~/.whatsagent/daemon.toml` + env on top.
export function defaultDaemonConfig(input: DefaultDaemonConfigInput): WhatsAgentConfig {
  return {
    fleet: { name: input.fleetName ?? "WhatsAgent", root: input.daemonHome },
    ui: {
      host: input.host ?? "127.0.0.1",
      port: input.port ?? 4017,
      allowHosts: input.allowHosts ?? [],
    },
    policy: { mode: "star" },
    commands: {
      claudeCode: { command: "claude", args: [] },
      openCode: { command: "opencode", args: [] },
      codex: { command: "codex", args: [] },
      pi: { command: "pi", args: [] },
    },
  };
}

/** Daemon-global overrides parsed from `~/.whatsagent/daemon.toml`. All
 * fields optional; unknown sections/keys are ignored. */
export interface DaemonTomlOverrides {
  fleetName?: string;
  host?: string;
  port?: number;
  allowHosts?: string[];
}

const DAEMON_TOML_FILE = "daemon.toml";

/**
 * Parse `[fleet] name = "..."` and `[ui] host = "..." port = N
 * allow_hosts = ["a","b"]` out of a daemon-config TOML. Tolerant: ignores
 * unknown sections/keys, malformed lines, mixed quoting. Returns empty
 * object when nothing matched. Numbers parse via `Number()`; arrays parse
 * as JSON; strings strip surrounding double quotes.
 */
export function parseDaemonToml(text: string): DaemonTomlOverrides {
  const out: DaemonTomlOverrides = {};
  let section = "";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) { section = sec[1]!.trim(); continue; }
    const kv = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.+?)\s*(?:#.*)?$/);
    if (!kv) continue;
    const key = kv[1]!;
    const raw = kv[2]!.trim();
    if (section === "fleet" && key === "name") {
      const v = parseTomlString(raw);
      if (v !== null) out.fleetName = v;
    } else if (section === "ui" && key === "host") {
      const v = parseTomlString(raw);
      if (v !== null) out.host = v;
    } else if (section === "ui" && key === "port") {
      const n = Number(raw);
      if (Number.isFinite(n) && Number.isInteger(n)) out.port = n;
    } else if (section === "ui" && key === "allow_hosts") {
      const arr = parseTomlStringArray(raw);
      if (arr) out.allowHosts = arr;
    }
  }
  return out;
}

function parseTomlString(raw: string): string | null {
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    try { return JSON.parse(raw) as string; } catch { return null; }
  }
  return null;
}

function parseTomlStringArray(raw: string): string[] | null {
  if (!raw.startsWith("[") || !raw.endsWith("]")) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    if (parsed.some((v) => typeof v !== "string")) return null;
    return parsed as string[];
  } catch {
    return null;
  }
}

/**
 * Load daemon overrides from `<daemonHome>/daemon.toml`. Returns empty
 * overrides when the file is absent. Throws on read errors other than
 * ENOENT (corrupt files surface to the operator instead of silently
 * booting on defaults).
 */
export async function loadDaemonToml(daemonHome: string): Promise<DaemonTomlOverrides> {
  const path = join(daemonHome, DAEMON_TOML_FILE);
  if (!existsSync(path)) return {};
  const text = await readFile(path, "utf8");
  return parseDaemonToml(text);
}

export interface ResolveDaemonConfigInput {
  daemonHome: string;
  /** Explicit port override (e.g. `--port 0` for tests). Highest precedence. */
  port?: number;
  /** Inject env for unit tests; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Override the on-disk loader (e.g. tests pre-stub overrides). */
  overrides?: DaemonTomlOverrides;
}

/**
 * Resolve the effective daemon-global `WhatsAgentConfig`. Precedence
 * (lowest → highest):
 *   1. `defaultDaemonConfig` defaults
 *   2. `<daemonHome>/daemon.toml`
 *   3. env (`WHATSAGENT_PORT`, `WHATSAGENT_HOST_ALLOW`)
 *   4. explicit `opts.port`
 *
 * Env per-key REPLACES (does not append) the matching field. `WHATSAGENT_HOST_CHECK`
 * is read independently in `resolveHostCheckMode` and is intentionally not part
 * of `WhatsAgentConfig` since it gates the request-time policy, not config.
 */
export async function resolveDaemonConfig(input: ResolveDaemonConfigInput): Promise<WhatsAgentConfig> {
  const env = input.env ?? process.env;
  const overrides = input.overrides ?? await loadDaemonToml(input.daemonHome);

  const envPort = parseEnvInt(env.WHATSAGENT_PORT);
  const envHostAllow = parseEnvCsv(env.WHATSAGENT_HOST_ALLOW);

  const port = input.port ?? envPort ?? overrides.port;
  const host = overrides.host;
  const allowHosts = envHostAllow ?? overrides.allowHosts;
  const fleetName = overrides.fleetName;

  return defaultDaemonConfig({
    daemonHome: input.daemonHome,
    port,
    host,
    allowHosts,
    fleetName,
  });
}

function parseEnvInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value.trim());
  return Number.isFinite(n) && Number.isInteger(n) ? n : undefined;
}

function parseEnvCsv(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
  return parts;
}

export interface CreateWorkspaceInput {
  name: string;
  kanbanPrefix?: string;
  /**
   * EP-022 / WA-094: required RBAC enforcement mode for the new
   * workspace. Required at the API layer (the HTTP endpoint rejects
   * with 400 when omitted), but optional in the DAO so internal
   * lifecycle helpers (e.g. test harness) can default to `enforce`
   * without threading the value through every call site.
   */
  rbacMode?: import("./daemon-db.ts").RbacMode;
}

/**
 * Create a workspace post-decoupling: inserts the daemon-DB row, lays down
 * the slot dir, opens + migrates the per-workspace DB, optionally writes
 * the kanban prefix setting. Roles + repos are now first-class entities
 * managed via `workspace-decoupling-dao.ts`; this helper does NOT seed any.
 */
export async function createWorkspace(
  daemonDb: Database,
  daemonHome: string,
  input: CreateWorkspaceInput,
): Promise<WorkspaceRow> {
  const name = input.name.trim();
  if (!name) throw new Error("workspace name cannot be empty");

  const id = generateWorkspaceId();
  insertWorkspace(daemonDb, { id, name, rbacMode: input.rbacMode });
  const slot = activeWorkspacePaths(daemonHome, id);
  try {
    await mkdir(slot.slot, { recursive: true, mode: 0o700 });
    await mkdir(slot.runDir, { recursive: true, mode: 0o700 });
    await mkdir(slot.logsDir, { recursive: true, mode: 0o700 });
    const db = openFleetDb(slot.dbPath);
    try {
      migrate(db);
      runStartupRepair(db);
      if (input.kanbanPrefix !== undefined) {
        // EP-DEC-FIX (WA-089): the Edit path goes through `setKanbanSettings`
        // which runs `normalizeKanbanTaskIdPrefix`. Use the same writer here
        // so Add and Edit reject identical inputs and the stored value is
        // always upper-cased + validated. Raw `setSetting` left non-conforming
        // prefixes on disk that only failed on the next round-trip through
        // the Edit endpoint.
        setKanbanSettings(db, { taskIdPrefix: input.kanbanPrefix });
      }
    } finally {
      db.close();
    }
  } catch (e) {
    return updateWorkspaceStatus(daemonDb, id, "error", { error: e instanceof Error ? e.message : String(e) });
  }
  return updateWorkspaceStatus(daemonDb, id, "active");
}
