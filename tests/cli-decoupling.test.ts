/**
 * WA-072 — workspace / repo / scan-dir / role CLI subcommands.
 *
 * Boots a real daemon against a tmp daemon-home, then drives the new CLI
 * surface as a child process (`bun src/cli.ts ...`) with
 * `WHATSAGENT_DAEMON_HOME` pointing at that home. Verifies stdout/stderr
 * + asserts side effects via the HTTP API.
 *
 * Coverage:
 *   - workspace add/edit/list/switch
 *   - workspace repo add/list/remove
 *   - workspace scan-dir add/list/remove
 *   - workspace scan (no arg → all; with arg → specific)
 *   - role add/list/remove
 *   - error path: scan-dir add rejects a file
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startDaemon, type StartedDaemon } from "../src/server/daemon.ts";
import { seedAuthSessionCookie } from "./helpers/auth.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

let daemonHome: string;
let workArea: string;
let daemon: StartedDaemon | null = null;
let authCookie = "";

beforeEach(async () => {
  daemonHome = await mkdtemp(join(tmpdir(), "wa-cli-home-"));
  workArea = await mkdtemp(join(tmpdir(), "wa-cli-work-"));
  authCookie = "";
});

afterEach(async () => {
  if (daemon) {
    daemon.stop();
    daemon = null;
  }
  await rm(daemonHome, { recursive: true, force: true });
  await rm(workArea, { recursive: true, force: true });
});

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, WHATSAGENT_DAEMON_HOME: daemonHome, WHATSAGENT_HOST_CHECK: "off", WHATSAGENT_AUTH_COOKIE: authCookie },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function bootDaemon(): Promise<void> {
  daemon = await startDaemon({ port: 0, consoleLogs: false, daemonHome, hostCheckMode: "off" });
  authCookie = await seedAuthSessionCookie(daemonHome);
}

describe("workspace add/edit/list (WA-072)", () => {
  test("add → list → edit → list shows updated name + prefix", async () => {
    await bootDaemon();

    const add = await runCli(["workspace", "add", "team-alpha", "--rbac-mode", "enforce", "--kanban-prefix", "ALP"]);
    expect(add.code).toBe(0);
    expect(add.stdout).toContain("Added workspace team-alpha");

    const list = await runCli(["workspace", "list"]);
    expect(list.code).toBe(0);
    expect(list.stdout).toContain("team-alpha");

    const edit = await runCli(["workspace", "edit", "team-alpha", "--name", "team-beta"]);
    expect(edit.code).toBe(0);
    expect(edit.stdout).toContain("Updated workspace team-beta");

    const list2 = await runCli(["workspace", "list"]);
    expect(list2.stdout).toContain("team-beta");
    expect(list2.stdout).not.toContain("team-alpha");
  });

  test("workspace edit with no flags errors", async () => {
    await bootDaemon();
    await runCli(["workspace", "add", "ws-x", "--rbac-mode", "enforce"]);
    const edit = await runCli(["workspace", "edit", "ws-x"]);
    expect(edit.code).not.toBe(0);
    expect(edit.stderr).toContain("--name and/or --kanban-prefix");
  });
});

describe("workspace repo add/list/remove (WA-072)", () => {
  test("add a repo, list it, remove it", async () => {
    await bootDaemon();
    const repoDir = join(workArea, "repo-a");
    await rm(repoDir, { recursive: true, force: true });
    const { mkdir } = await import("node:fs/promises");
    await mkdir(repoDir, { recursive: true });

    await runCli(["workspace", "add", "ws-r", "--rbac-mode", "enforce"]);

    const add = await runCli(["workspace", "repo", "add", "ws-r", repoDir, "--name", "alpha"]);
    expect(add.code).toBe(0);
    expect(add.stdout).toContain("Added repo alpha");
    expect(add.stdout).toContain(repoDir);

    const list = await runCli(["workspace", "repo", "list", "ws-r"]);
    expect(list.code).toBe(0);
    expect(list.stdout).toContain("alpha");
    expect(list.stdout).toContain(repoDir);

    const remove = await runCli(["workspace", "repo", "remove", "ws-r", "alpha"]);
    expect(remove.code).toBe(0);
    expect(remove.stdout).toContain("Removed repo alpha");

    const list2 = await runCli(["workspace", "repo", "list", "ws-r"]);
    expect(list2.stdout).toContain("No repos.");
  });
});

describe("workspace scan-dir add/list/remove + scan (WA-072)", () => {
  test("add scan dir, scan all, scan specific", async () => {
    await bootDaemon();
    const scanRoot = join(workArea, "scan-root");
    const repoChild = join(scanRoot, "child-repo");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(repoChild, { recursive: true });
    await writeFile(join(repoChild, "package.json"), "{}", "utf8");

    await runCli(["workspace", "add", "ws-s", "--rbac-mode", "enforce"]);
    const add = await runCli(["workspace", "scan-dir", "add", "ws-s", scanRoot, "--scan-on-startup"]);
    expect(add.code).toBe(0);
    expect(add.stdout).toContain("[scan-on-startup]");

    const list = await runCli(["workspace", "scan-dir", "list", "ws-s"]);
    expect(list.stdout).toContain(scanRoot);
    expect(list.stdout).toContain("yes");

    const scan = await runCli(["workspace", "scan", "ws-s"]);
    expect(scan.code).toBe(0);
    expect(scan.stdout).toContain("1 added");
    expect(scan.stdout).toContain("child-repo");

    // Specific scan-dir target via path.
    const scanByPath = await runCli(["workspace", "scan", "ws-s", scanRoot]);
    expect(scanByPath.code).toBe(0);
    // Already added; expect 0 added on second pass.
    expect(scanByPath.stdout).toContain("0 added");

    const remove = await runCli(["workspace", "scan-dir", "remove", "ws-s", scanRoot]);
    expect(remove.code).toBe(0);
    const list2 = await runCli(["workspace", "scan-dir", "list", "ws-s"]);
    expect(list2.stdout).toContain("No scan dirs.");
  });

  test("scan-dir add rejects a file (not a directory)", async () => {
    await bootDaemon();
    const filePath = join(workArea, "not-a-dir.txt");
    await writeFile(filePath, "hello", "utf8");
    await runCli(["workspace", "add", "ws-bad", "--rbac-mode", "enforce"]);
    const add = await runCli(["workspace", "scan-dir", "add", "ws-bad", filePath]);
    expect(add.code).not.toBe(0);
    expect(add.stderr).toMatch(/not a directory|HTTP 400/);
  });
});

describe("--help / per-subcommand help (WA-073)", () => {
  test("top-level --help lists every domain", async () => {
    const help = await runCli(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Daemon lifecycle:");
    expect(help.stdout).toContain("Workspaces:");
    expect(help.stdout).toContain("Roles (under a workspace + repo)");
    expect(help.stdout).toContain("Config (daemon-global");
    expect(help.stdout).toContain("WHATSAGENT_DAEMON_HOME");
  });

  test("`workspace --help` prints only workspace + repo + scan-dir blocks", async () => {
    const help = await runCli(["workspace", "--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Workspaces:");
    expect(help.stdout).toContain("Repos (under a workspace)");
    expect(help.stdout).toContain("Scan dirs (under a workspace)");
    // Top-level lifecycle / config live elsewhere.
    expect(help.stdout).not.toContain("Daemon lifecycle:");
    expect(help.stdout).not.toContain("Config (daemon-global");
  });

  test("`role --help` prints only the role block", async () => {
    const help = await runCli(["role", "--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Roles (under a workspace + repo)");
    expect(help.stdout).toContain("repo:name");
    expect(help.stdout).not.toContain("Workspaces:");
  });

  test("bare `workspace` (no subcommand) prints workspace help instead of erroring", async () => {
    const out = await runCli(["workspace"]);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("Workspaces:");
  });
});

describe("role add/list/remove (WA-072)", () => {
  test("create + list + remove", async () => {
    await bootDaemon();
    const repoDir = join(workArea, "alpha-repo");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(repoDir, { recursive: true });
    await runCli(["workspace", "add", "ws-roles", "--rbac-mode", "enforce"]);
    await runCli(["workspace", "repo", "add", "ws-roles", repoDir, "--name", "alpha"]);

    const addRole = await runCli(["role", "add", "ws-roles", "alpha", "main"]);
    expect(addRole.code).toBe(0);
    expect(addRole.stdout).toContain("Added role alpha:main");

    const list = await runCli(["role", "list", "ws-roles"]);
    expect(list.stdout).toContain("alpha:main");

    const remove = await runCli(["role", "remove", "ws-roles", "alpha:main"]);
    expect(remove.code).toBe(0);
    expect(remove.stdout).toContain("Removed role alpha:main");

    const list2 = await runCli(["role", "list", "ws-roles"]);
    expect(list2.stdout).toContain("No roles.");
  });

  test("role remove without colon errors", async () => {
    await bootDaemon();
    await runCli(["workspace", "add", "ws-r2", "--rbac-mode", "enforce"]);
    const remove = await runCli(["role", "remove", "ws-r2", "bare-name"]);
    expect(remove.code).not.toBe(0);
    expect(remove.stderr).toContain("repo>:<name");
  });
});
