import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { delimiter, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { WhatsAgentConfig } from "../config.ts";
import type { TuiRedrawSettings } from "../daemon-db.ts";
import { getPolicyMode, insertLaunchToken, markRoleJoinedChannel, openFleetDb, recordRunnerLaunch, stopRunnerSession, type AgentRow } from "../db.ts";
import { createLaunchToken, hashLaunchToken } from "../integrations/launch-token.ts";
import type { Logger } from "../logger.ts";
import { isProcessAlive, type RunnerStatus } from "./registry.ts";
import { normalizeHostType, runnerLogPath, runnerMetadataPath, runnerSocketPath, safeRoleFileName, type HostType, type NativePushType, type RunnerMetadata } from "./protocol.ts";

/** Path subset the runner needs. Both FleetPaths (legacy single-fleet) and
 * WorkspacePaths (Phase 2 daemon-home) satisfy this shape. */
export interface RunnerPaths {
  dbPath: string;
  runDir: string;
  logsDir: string;
}

export interface LaunchRunnerInput {
  root: string;
  paths: RunnerPaths;
  config: WhatsAgentConfig;
  logger: Logger;
  role: AgentRow;
  daemonUrl: string;
  host?: string;
  /** Phase 2 workspace id. When provided, written to runner metadata + launch env. */
  workspaceId?: string;
  /** Daemon-global colleague protocol text injected into launch instructions. */
  colleagueProtocol: string;
  /** Daemon-global TUI redraw workaround settings passed to PTY runner. */
  tuiRedraw?: TuiRedrawSettings;
}

interface ResolvedCommand {
  command: string;
  args: string[];
  mode: "fake" | "pty";
  reason?: string;
}

function roleCwd(root: string, role: AgentRow): string {
  // Post-decoupling: `role.path` comes from the EP-DEC-1 compat shim, which
  // projects `repo.absolute_path` onto the legacy `AgentRow.path` field — so
  // it is already absolute and may live anywhere on disk. `resolve(root, ...)`
  // still works as a no-op for absolute inputs; the legacy "escapes fleet
  // root" check is meaningless with first-class repos and is removed.
  return resolve(root, role.path);
}

function commandExists(command: string): boolean {
  if (command.includes(sep)) return existsSync(command);
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    if (entry && existsSync(resolve(entry, command))) return true;
  }
  return false;
}

function commandForHost(config: WhatsAgentConfig, hostType: HostType): { command: string; args: string[] } {
  if (hostType === "opencode") return config.commands.openCode;
  if (hostType === "codex") return config.commands.codex;
  if (hostType === "pi") return config.commands.pi;
  return config.commands.claudeCode;
}

function resolveRunnerCommand(input: LaunchRunnerInput, hostType: HostType): ResolvedCommand {
  const configured = commandForHost(input.config, hostType);
  if (commandExists(configured.command)) return { ...configured, mode: "pty" };
  return { ...configured, mode: "fake", reason: `${configured.command} was not found on PATH` };
}

function sanitizeClaudeArgs(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "server:whatsagent") continue;
    if (arg === "--dangerously-load-development-channels") {
      while (args[i + 1]?.match(/^(server|plugin):/)) i++;
      continue;
    }
    result.push(arg);
  }
  return result;
}

function appendClaudeChannelArgs(args: string[]): string[] {
  return [...args, "--dangerously-load-development-channels", "server:whatsagent"];
}

function openCodeInstructionText(colleagueProtocol: string): string {
  return `${colleagueProtocol.trimEnd()}

DELIVERY ON THIS SIDE (OpenCode):

OpenCode receives WhatsAgent tools from a generated plugin in OPENCODE_CONFIG_DIR.
Treat WhatsAgent as a colleague inbox. Live messages may arrive as pushed
WHATSAGENT INBOX prompts through the OpenCode plugin while you are already in a
turn. Treat those immediately using the same triage rules. If only a toast is
shown, call check_messages before continuing.

On launch, call whoami, list_peers, check_messages, and set_summary before
starting substantive work. On every later user turn, call check_messages before
answering or changing files. Reply only when substantive; do not auto-acknowledge.
`;
}

export async function launchRunner(input: LaunchRunnerInput): Promise<RunnerStatus> {
  const hostType = normalizeHostType(input.host, input.role.host_default);
  const sessionId = randomUUID();
  // WA-153: bearer for the runner's loopback HTTP control endpoint. V1
  // blocks browser/drive-by requests to 127.0.0.1; it is not a same-UID
  // security boundary because same-UID processes can read the 0600 runner
  // metadata file that stores this secret for daemon restart/adoption.
  const controlSecret = randomBytes(32).toString("base64url");
  const cwd = roleCwd(input.root, input.role);
  // EP-DEC-RUN WA-003: paths key on display_id (`repo:role`, `:` → `__`).
  // AgentRow.display_id is populated by the workspace-decoupling DAO; bare
  // role.name is the legacy compat fallback for shim-constructed AgentRow
  // (still used by repo-delete cascade etc.) but post-EP-DEC-1 every
  // launch path supplies a real display_id.
  const displayId = input.role.display_id ?? input.role.name;
  const metadataPath = runnerMetadataPath(input.paths.runDir, displayId);
  const socketPath = runnerSocketPath(input.paths.runDir, displayId);
  const logPath = runnerLogPath(input.paths.logsDir, displayId);
  const cliPath = fileURLToPath(new URL("../cli.ts", import.meta.url));
  const nodePtyRunnerPath = fileURLToPath(new URL("./node-pty-runner.mjs", import.meta.url));
  const claudeMcpPath = fileURLToPath(new URL("../integrations/claude-mcp.ts", import.meta.url));
  const codexMcpPath = fileURLToPath(new URL("../integrations/codex-mcp.ts", import.meta.url));
  const openCodePluginPath = fileURLToPath(new URL("../integrations/opencode-plugin.ts", import.meta.url));
  const piExtensionPath = fileURLToPath(new URL("../integrations/pi-extension.ts", import.meta.url));
  const resolvedCommand = resolveRunnerCommand(input, hostType);
  if (resolvedCommand.mode === "pty" && hostType === "claude-code") {
    resolvedCommand.args = sanitizeClaudeArgs(resolvedCommand.args);
  }
  const launchToken = createLaunchToken();
  const launchTokenId = randomUUID();
  // WA-154: this is now a one-shot bootstrap credential, not the long-lived
  // agent API credential. Keep the exposure window short; successful
  // validation consumes it and returns a 15-minute session credential.
  const tokenExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const launchEnv: Record<string, string> = {
    WHATSAGENT_ENABLED: "1",
    WHATSAGENT_FLEET_ROOT: input.root,
    WHATSAGENT_WORKSPACE_PATH: input.root,
    WHATSAGENT_ROLE: input.role.name,
    // EP-DEC-RUN WA-003 (advisor msg #12): expose display_id alongside
    // bare role so the MCP integration / agent identity can address peers
    // by `repo:role` even when WHATSAGENT_ROLE stays bare for back-compat.
    WHATSAGENT_ROLE_DISPLAY_ID: displayId,
    WHATSAGENT_SESSION_ID: sessionId,
    WHATSAGENT_HOST_TYPE: hostType,
    WHATSAGENT_DAEMON_URL: input.daemonUrl,
    WHATSAGENT_LAUNCH_TOKEN: launchToken,
    WHATSAGENT_RUNNER_LOG: logPath,
  };
  if (input.workspaceId) launchEnv.WHATSAGENT_WORKSPACE_ID = input.workspaceId;

  await mkdir(input.paths.runDir, { recursive: true, mode: 0o700 });
  await mkdir(input.paths.logsDir, { recursive: true, mode: 0o700 });
  await rm(metadataPath, { force: true }).catch(() => undefined);
  let nativePush: NativePushType | undefined;

  if (resolvedCommand.mode === "pty" && hostType === "claude-code" && !resolvedCommand.args.includes("--mcp-config")) {
    const mcpConfigPath = join(input.paths.runDir, `${safeRoleFileName(displayId)}.claude-mcp.json`);
    await writeFile(mcpConfigPath, JSON.stringify({
      mcpServers: {
        whatsagent: {
          command: process.execPath,
          args: [claudeMcpPath],
        },
      },
    }, null, 2), { encoding: "utf8", mode: 0o600 });
    resolvedCommand.args = [...resolvedCommand.args, "--mcp-config", mcpConfigPath];
    nativePush = "claude-channel";
  }

  if (resolvedCommand.mode === "pty" && hostType === "claude-code") {
    resolvedCommand.args = appendClaudeChannelArgs(resolvedCommand.args);
  }

  if (resolvedCommand.mode === "pty" && hostType === "opencode") {
    const openCodeConfigDir = join(input.paths.runDir, `${safeRoleFileName(displayId)}.opencode`);
    const openCodePluginDir = join(openCodeConfigDir, "plugins");
    const openCodeInstructionsPath = join(openCodeConfigDir, "whatsagent-instructions.md");
    await rm(openCodePluginDir, { recursive: true, force: true }).catch(() => undefined);
    await rm(join(openCodeConfigDir, "AGENTS.md"), { force: true }).catch(() => undefined);
    await mkdir(openCodePluginDir, { recursive: true, mode: 0o700 });
    await writeFile(openCodeInstructionsPath, openCodeInstructionText(input.colleagueProtocol), { encoding: "utf8", mode: 0o600 });
    await writeFile(join(openCodeConfigDir, "opencode.json"), JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      instructions: [openCodeInstructionsPath],
    }, null, 2), { encoding: "utf8", mode: 0o600 });
    await writeFile(join(openCodePluginDir, "whatsagent.ts"), [
      `import { WhatsAgentOpenCodePlugin } from ${JSON.stringify(pathToFileURL(openCodePluginPath).href)};`,
      "export { WhatsAgentOpenCodePlugin };",
      "export default WhatsAgentOpenCodePlugin;",
      "",
    ].join("\n"), { encoding: "utf8", mode: 0o600 });
    Object.assign(launchEnv, { OPENCODE_CONFIG_DIR: openCodeConfigDir });
    nativePush = "opencode-plugin";
  }

  if (resolvedCommand.mode === "pty" && hostType === "pi") {
    // EP-031 WA-PI-2: Pi loads a per-launch generated bridge via `pi -e <path>`.
    // The bridge default export receives Pi's `ExtensionAPI` as the only
    // argument and forwards it into `createWhatsAgentPiExtension({ pi })`,
    // matching Pi's documented extension shape
    // (https://pi.dev/docs/latest/extensions: `export default function (pi)`).
    // Pattern mirrors OpenCode plugin generation above. Embeds only static
    // config; launch tokens / role / daemon URL flow via the existing env
    // vars.
    const piBridgePath = join(input.paths.runDir, `${safeRoleFileName(displayId)}.pi-extension.ts`);
    await writeFile(piBridgePath, [
      `import { createWhatsAgentPiExtension } from ${JSON.stringify(pathToFileURL(piExtensionPath).href)};`,
      "export default async function whatsagentPiExtension(pi) {",
      "  await createWhatsAgentPiExtension({ pi });",
      "}",
      "",
    ].join("\n"), { encoding: "utf8", mode: 0o600 });
    resolvedCommand.args = [...resolvedCommand.args, "-e", piBridgePath];
    nativePush = "pi-extension";
  }

  if (resolvedCommand.mode === "pty" && hostType === "codex") {
    resolvedCommand.args = [
      ...resolvedCommand.args,
      "-c", `mcp_servers.whatsagent.command=${JSON.stringify(process.execPath)}`,
      "-c", `mcp_servers.whatsagent.args=${JSON.stringify([codexMcpPath])}`,
      "-c", `mcp_servers.whatsagent.env_vars=${JSON.stringify(["WHATSAGENT_ENABLED", "WHATSAGENT_FLEET_ROOT", "WHATSAGENT_WORKSPACE_PATH", "WHATSAGENT_WORKSPACE_ID", "WHATSAGENT_ROLE", "WHATSAGENT_ROLE_DISPLAY_ID", "WHATSAGENT_SESSION_ID", "WHATSAGENT_HOST_TYPE", "WHATSAGENT_DAEMON_URL", "WHATSAGENT_LAUNCH_TOKEN"])}`,
    ];
  }

  const runnerArgs = resolvedCommand.mode === "pty"
    ? [nodePtyRunnerPath, JSON.stringify({
      fleetId: input.config.fleet.name,
      workspaceId: input.workspaceId,
      role: input.role.name,
      displayId,
      sessionId,
      controlSecret,
      hostType,
      cwd,
      runDir: input.paths.runDir,
      logPath,
      metadataPath,
      socketPath,
      command: resolvedCommand.command,
      args: resolvedCommand.args,
      nativePush,
      tuiRedraw: input.tuiRedraw,
      startedAt: new Date().toISOString(),
      env: launchEnv,
    })]
    : [
      cliPath,
      "_runner",
      "--fleet-id", input.config.fleet.name,
      ...(input.workspaceId ? ["--workspace-id", input.workspaceId] : []),
      "--role", input.role.name,
      "--display-id", displayId,
      "--session", sessionId,
      "--control-secret", controlSecret,
      "--host", hostType,
      "--cwd", cwd,
      "--run-dir", input.paths.runDir,
      "--log", logPath,
    ];
  const child = spawn(resolvedCommand.mode === "pty" ? "node" : process.execPath, runnerArgs, {
    cwd,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ...launchEnv,
    },
  });

  if (!child.pid) throw new Error("Runner process did not report a pid");
  child.unref();

  const startedAt = new Date().toISOString();
  const metadata: RunnerMetadata = {
    fleet_id: input.config.fleet.name,
    ...(input.workspaceId ? { workspace_id: input.workspaceId } : {}),
    role: input.role.name,
    display_id: displayId,
    session_id: sessionId,
    host_type: hostType,
    control_secret: controlSecret,
    runner_pid: child.pid,
    cwd,
    socket_path: socketPath,
    mode: resolvedCommand.mode,
    ...(nativePush ? { native_push: nativePush } : {}),
    started_at: startedAt,
  };

  // Record runner+token in the DB before writing the metadata file. If the DB
  // insert fails, kill the spawned child so it doesn't outlive its tracking
  // record (the runner would otherwise overwrite metadataPath itself on start).
  const db = openFleetDb(input.paths.dbPath);
  try {
    try {
      recordRunnerLaunch(db, {
        roleId: input.role.id,
        sessionId,
        hostType,
        runnerPid: child.pid,
        cwd,
        socketPath,
        metadataPath,
        startedAt,
      });
      if (getPolicyMode(db) === "channel") markRoleJoinedChannel(db, input.role.id);
      insertLaunchToken(db, {
        id: launchTokenId,
        roleId: input.role.id,
        sessionId,
        tokenHash: hashLaunchToken(launchToken),
        expiresAt: tokenExpiresAt,
      });
    } catch (e) {
      try { process.kill(child.pid, "SIGTERM"); } catch { /* child may have exited already */ }
      throw e;
    }
  } finally {
    db.close();
  }

  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), { encoding: "utf8", mode: 0o600 });

  input.logger.info("runner.launched", {
    role: input.role.name,
    sessionId,
    hostType,
    mode: resolvedCommand.mode,
    runnerPid: child.pid,
    fallbackReason: resolvedCommand.reason,
    launchTokenId,
    tokenExpiresAt,
  });

  return { ...metadata, metadata_path: metadataPath, reachable: isProcessAlive(child.pid) };
}

export async function stopRunner(input: { paths: RunnerPaths; role: AgentRow; runner: RunnerStatus; logger: Logger; source?: string; path?: string }): Promise<void> {
  if (input.runner.runner_pid > 0 && input.runner.runner_pid !== process.pid) {
    try {
      process.kill(input.runner.runner_pid, "SIGTERM");
    } catch {
      // Stale metadata is cleaned up below.
    }
  }
  await rm(input.runner.metadata_path, { force: true }).catch(() => undefined);
  const db = openFleetDb(input.paths.dbPath);
  try {
    stopRunnerSession(db, input.role.id, input.runner.session_id);
  } finally {
    db.close();
  }
  input.logger.info("runner.stop_requested", { role: input.role.name, sessionId: input.runner.session_id, runnerPid: input.runner.runner_pid, source: input.source ?? "unknown", path: input.path });
}
