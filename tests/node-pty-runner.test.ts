import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface RunnerHarness {
  dir: string;
  runnerPath: string;
  metadataPath: string;
  logPath: string;
  eventsPath: string;
  controlSecret: string;
  proc?: Bun.Subprocess;
}

interface RunnerControl {
  control_url: string;
  control_secret: string;
}

let harnesses: RunnerHarness[] = [];

beforeEach(() => {
  harnesses = [];
});

afterEach(async () => {
  for (const harness of harnesses) {
    harness.proc?.kill();
    await harness.proc?.exited.catch(() => undefined);
    await rm(harness.dir, { recursive: true, force: true });
  }
});

async function createHarness(): Promise<RunnerHarness> {
  const dir = await mkdtemp(join(tmpdir(), "wa-node-pty-runner-"));
  const runnerPath = join(dir, "node-pty-runner.mjs");
  const nodePtyDir = join(dir, "node_modules", "node-pty");
  await mkdir(nodePtyDir, { recursive: true });
  await copyFile(join(import.meta.dir, "..", "src", "runner", "node-pty-runner.mjs"), runnerPath);
  await writeFile(join(nodePtyDir, "package.json"), JSON.stringify({ type: "module", exports: "./index.js" }), "utf8");
  await writeFile(join(nodePtyDir, "index.js"), FAKE_NODE_PTY_MODULE, "utf8");
  const harness: RunnerHarness = {
    dir,
    runnerPath,
    metadataPath: join(dir, "runner.json"),
    logPath: join(dir, "runner.log"),
    eventsPath: join(dir, "events.jsonl"),
    controlSecret: `secret-${crypto.randomUUID()}`,
  };
  harnesses.push(harness);
  return harness;
}

const FAKE_NODE_PTY_MODULE = `
import { appendFileSync } from "node:fs";

const eventsPath = process.env.WA_FAKE_NODE_PTY_EVENTS;
let exitHandler;

function record(type, payload = {}) {
  if (!eventsPath) return;
  appendFileSync(eventsPath, JSON.stringify({ type, ...payload }) + "\\n", "utf8");
}

export function spawn(command, args = [], options = {}) {
  record("spawn", { command, args, cols: options.cols, rows: options.rows, cwd: options.cwd });
  const child = {
    pid: 4242,
    resize(cols, rows) { record("resize", { cols, rows }); },
    write(data) { record("write", { data }); },
    kill(signal) {
      record("kill", { signal });
      if (exitHandler) exitHandler({ exitCode: 0, signal: signal || "SIGTERM" });
    },
    onData() {},
    onExit(callback) {
      exitHandler = callback;
      const delay = Number(process.env.WA_FAKE_NODE_PTY_EXIT_AFTER_MS || 0);
      if (Number.isFinite(delay) && delay > 0) {
        setTimeout(() => {
          record("autoExit", {});
          callback({ exitCode: 7, signal: "" });
        }, delay).unref?.();
      }
    },
  };
  return child;
}
`;

function runnerOptions(harness: RunnerHarness, overrides: Record<string, unknown> = {}) {
  return {
    fleetId: "fleet-test",
    workspaceId: "workspace-test",
    role: "worker",
    displayId: "WhatsAgent:worker",
    sessionId: `session-${crypto.randomUUID()}`,
    hostType: "codex",
    command: "fake-command",
    args: [],
    cwd: harness.dir,
    runDir: harness.dir,
    metadataPath: harness.metadataPath,
    logPath: harness.logPath,
    socketPath: join(harness.dir, "runner.sock"),
    controlSecret: harness.controlSecret,
    cols: 100,
    rows: 30,
    startedAt: new Date().toISOString(),
    tuiRedraw: { workaround: "on" },
    ...overrides,
  };
}

async function startRunner(harness: RunnerHarness, opts: Record<string, unknown> = {}, env: Record<string, string> = {}, nodeArgs: string[] = []): Promise<RunnerControl> {
  const proc = Bun.spawn(["node", ...nodeArgs, harness.runnerPath, JSON.stringify(runnerOptions(harness, opts))], {
    cwd: harness.dir,
    env: { ...process.env, ...env, WA_FAKE_NODE_PTY_EVENTS: harness.eventsPath },
    stdout: "pipe",
    stderr: "pipe",
  });
  harness.proc = proc;
  return await waitForControl(harness, proc);
}

async function waitForControl(harness: RunnerHarness, proc: Bun.Subprocess): Promise<RunnerControl> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (existsSync(harness.metadataPath)) {
      try {
        const metadata = JSON.parse(await readFile(harness.metadataPath, "utf8")) as RunnerControl;
        if (metadata.control_url && metadata.control_secret) return metadata;
      } catch {
        // Metadata may be observed while the runner is still writing it.
      }
    }
    if (proc.exitCode !== null) break;
    await sleep(20);
  }
  const stderrStream = proc.stderr;
  const stderr = stderrStream && typeof stderrStream !== "number" ? await new Response(stderrStream).text().catch(() => "") : "";
  throw new Error(`runner control endpoint did not start; exit=${proc.exitCode}; stderr=${stderr}`);
}

function controlHeaders(control: RunnerControl, headers: Record<string, string> = {}): Record<string, string> {
  return { ...headers, Authorization: `Bearer ${control.control_secret}` };
}

async function postJson(control: RunnerControl, path: string, body: unknown = {}): Promise<Response> {
  return await fetch(new URL(path, control.control_url), {
    method: "POST",
    headers: controlHeaders(control, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
}

async function readEvents(harness: RunnerHarness): Promise<Array<Record<string, unknown>>> {
  if (!existsSync(harness.eventsPath)) return [];
  const text = await readFile(harness.eventsPath, "utf8");
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function waitForResizeEvents(harness: RunnerHarness, count: number): Promise<Array<Record<string, unknown>>> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const events = (await readEvents(harness)).filter((event) => event.type === "resize");
    if (events.length >= count) return events;
    await sleep(20);
  }
  return (await readEvents(harness)).filter((event) => event.type === "resize");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function win32PreludeArg(): string {
  const source = "Object.defineProperty(process, 'platform', { value: 'win32' });";
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

describe("node-pty runner redraw pulse", () => {
  test("/redraw-pulse calls resize down then restores after 150 ms", async () => {
    const harness = await createHarness();
    const control = await startRunner(harness);

    const res = await postJson(control, "/redraw-pulse", { reason: "restore" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, cols: 100, rows: 30, pulses: 1, reason: "restore" });

    let resizes = await waitForResizeEvents(harness, 1);
    expect(resizes[0]).toMatchObject({ cols: 100, rows: 29 });

    resizes = await waitForResizeEvents(harness, 2);
    expect(resizes.slice(0, 2)).toEqual([
      expect.objectContaining({ type: "resize", cols: 100, rows: 29 }),
      expect.objectContaining({ type: "resize", cols: 100, rows: 30 }),
    ]);

    const health = await fetch(new URL("/health", control.control_url), { headers: controlHeaders(control) });
    expect(await health.json()).toMatchObject({ tuiRedraw: { workaround: "on", pulse_count: 1 } });
  });

  test("/redraw-pulse drops overlapping requests while a pulse is in flight", async () => {
    const harness = await createHarness();
    const control = await startRunner(harness);

    const first = await postJson(control, "/redraw-pulse", { reason: "burst" });
    expect(first.status).toBe(200);
    const second = await postJson(control, "/redraw-pulse", { reason: "burst" });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ ok: true, skipped: "in-flight" });

    const resizes = await waitForResizeEvents(harness, 2);
    await sleep(40);
    expect((await readEvents(harness)).filter((event) => event.type === "resize")).toHaveLength(2);
    expect(resizes).toHaveLength(2);
  });

  test("real /resize during a pulse makes trailing edge restore to current lastDims", async () => {
    const harness = await createHarness();
    const control = await startRunner(harness);

    await postJson(control, "/redraw-pulse", { reason: "restore" });
    await waitForResizeEvents(harness, 1);
    const resize = await postJson(control, "/resize", { cols: 120, rows: 40 });
    expect(resize.status).toBe(200);
    expect(await resize.json()).toMatchObject({ ok: true, cols: 120, rows: 40 });

    const resizes = await waitForResizeEvents(harness, 3);
    expect(resizes.slice(0, 3)).toEqual([
      expect.objectContaining({ type: "resize", cols: 100, rows: 29 }),
      expect.objectContaining({ type: "resize", cols: 120, rows: 40 }),
      expect.objectContaining({ type: "resize", cols: 120, rows: 40 }),
    ]);
  });

  test("win32 skips redraw pulses without resizing", async () => {
    const harness = await createHarness();
    const control = await startRunner(harness, {}, {}, ["--import", win32PreludeArg()]);

    const res = await postJson(control, "/redraw-pulse", { reason: "burst" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, skipped: "win32" });
    expect((await readEvents(harness)).filter((event) => event.type === "resize")).toEqual([]);
  });

  test("child exit makes /redraw-pulse return 409", async () => {
    const harness = await createHarness();
    const control = await startRunner(harness, {}, { WA_FAKE_NODE_PTY_EXIT_AFTER_MS: "20" });
    await sleep(80);

    const res = await postJson(control, "/redraw-pulse", { reason: "burst" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "PTY child has exited", exit_code: 7 });
  });

  test("rows below 2 skip redraw pulses without resizing", async () => {
    const harness = await createHarness();
    const control = await startRunner(harness, { rows: 1 });

    const res = await postJson(control, "/redraw-pulse", { reason: "burst" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, skipped: "rows-too-small" });
    expect((await readEvents(harness)).filter((event) => event.type === "resize")).toEqual([]);
  });

  test("/resize updates cached lastDims before child.resize and future pulses use it", async () => {
    const harness = await createHarness();
    const control = await startRunner(harness);

    const resize = await postJson(control, "/resize", { cols: 88, rows: 12 });
    expect(resize.status).toBe(200);
    await postJson(control, "/redraw-pulse", { reason: "burst" });

    const resizes = await waitForResizeEvents(harness, 3);
    expect(resizes.slice(0, 3)).toEqual([
      expect.objectContaining({ type: "resize", cols: 88, rows: 12 }),
      expect.objectContaining({ type: "resize", cols: 88, rows: 11 }),
      expect.objectContaining({ type: "resize", cols: 88, rows: 12 }),
    ]);
  });
});
