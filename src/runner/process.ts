import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";

import { createLogger } from "../logger.ts";
import { runnerMetadataPath, runnerSocketPath, type HostType, type RunnerMetadata, type RunnerOutputEvent } from "./protocol.ts";

export interface RunnerProcessOptions {
  fleetId: string;
  workspaceId?: string;
  role: string;
  /** EP-DEC-RUN WA-003: `repo:role` form. Required for FS-path keying. */
  displayId: string;
  sessionId: string;
  /** WA-153 bearer required by the loopback control HTTP server. */
  controlSecret: string;
  hostType: HostType;
  cwd: string;
  runDir: string;
  logPath: string;
}

const RUNNER_CONTROL_MAX_BODY_BYTES = 64 * 1024;

class RunnerRequestEntityTooLarge extends Error {
  constructor(readonly size: number, readonly limit: number) {
    super(`request body is ${size} bytes; limit is ${limit}`);
    this.name = "RunnerRequestEntityTooLarge";
  }
}

function enforceRunnerBodySize(req: Request, maxBytes = RUNNER_CONTROL_MAX_BODY_BYTES): void {
  const length = req.headers.get("content-length");
  if (length === null) return;
  const size = Number(length);
  if (Number.isFinite(size) && size > maxBytes) throw new RunnerRequestEntityTooLarge(size, maxBytes);
}

async function readBoundedRunnerText(req: Request, maxBytes = RUNNER_CONTROL_MAX_BODY_BYTES): Promise<string> {
  enforceRunnerBodySize(req, maxBytes);
  if (!req.body) return "";
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > maxBytes) {
        try { await reader.cancel(); } catch { /* best effort */ }
        throw new RunnerRequestEntityTooLarge(size, maxBytes);
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    try { reader.releaseLock(); } catch { /* best effort */ }
  }
  return text + decoder.decode();
}

function isRunnerControlAuthorized(req: Request, controlSecret: string): boolean {
  return Boolean(controlSecret) && req.headers.get("authorization") === `Bearer ${controlSecret}`;
}

function runnerUnauthorized(): Response {
  return runnerJson({ ok: false, error: "unauthorized" }, {
    status: 401,
    headers: { "WWW-Authenticate": "Bearer" },
  });
}

async function readRunnerJsonOrEmpty<T>(req: Request): Promise<T> {
  try {
    const text = await readBoundedRunnerText(req);
    return (text ? JSON.parse(text) : {}) as T;
  } catch (e) {
    if (e instanceof RunnerRequestEntityTooLarge) throw e;
    return {} as T;
  }
}

export async function runRunnerProcess(opts: RunnerProcessOptions): Promise<void> {
  await mkdir(opts.runDir, { recursive: true, mode: 0o700 });
  const logger = createLogger(opts.logPath);
  const metadataPath = runnerMetadataPath(opts.runDir, opts.displayId);
  const output: RunnerOutputEvent[] = [];
  let seq = 0;
  let lastActivityAt = Date.now();
  let lastInputAt = Date.now();
  let pendingNudge: { messageId?: number; fromRole?: string; source?: string; count: number; queuedAt: string } | undefined;
  let nudgeTimer: ReturnType<typeof setTimeout> | undefined;
  const nudgeIdleMs = 1000;
  const nudgeThrottleMs = 5000;
  const inputActivityLogIntervalMs = 10_000;
  let lastNudgeAt = 0;
  let inputActivityCount = 0;
  let inputActivityBytes = 0;
  let inputActivityTimer: ReturnType<typeof setTimeout> | undefined;
  const append = (type: RunnerOutputEvent["type"], data: string) => {
    lastActivityAt = Date.now();
    output.push({ seq: ++seq, type, data, at: new Date().toISOString() });
    if (output.length > 500) output.shift();
    if (pendingNudge) scheduleNudgeFlush();
  };
  const writeRunnerLog = async (event: string, fields: Record<string, unknown>) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), level: "info", event, ...fields }) + "\n";
    await appendFile(opts.logPath, line, "utf8").catch(() => undefined);
  };
  const flushInputActivity = async () => {
    if (inputActivityTimer) clearTimeout(inputActivityTimer);
    inputActivityTimer = undefined;
    if (inputActivityCount === 0) return;
    const count = inputActivityCount;
    const bytes = inputActivityBytes;
    inputActivityCount = 0;
    inputActivityBytes = 0;
    await writeRunnerLog("runner.input_activity", { role: opts.role, sessionId: opts.sessionId, count, bytes });
  };
  const recordInputActivity = (bytes: number) => {
    inputActivityCount += 1;
    inputActivityBytes += bytes;
    if (inputActivityTimer) return;
    inputActivityTimer = setTimeout(() => void flushInputActivity(), inputActivityLogIntervalMs);
    inputActivityTimer.unref?.();
  };
  const cleanNudgeSource = (value: unknown) => String(value || "WhatsAgent").replace(/[^a-zA-Z0-9_.:@-]/g, "").slice(0, 80) || "WhatsAgent";
  const nudgePrompt = (body: { fromRole?: string; source?: string }) => {
    const from = cleanNudgeSource(body.fromRole || body.source);
    const count = Number("count" in body ? body.count : 1);
    const subject = count > 1 ? `${count} WhatsAgent messages are waiting` : `A WhatsAgent message is waiting from ${from}`;
    // TUIs submit on carriage return; LF can leave text sitting in the input box.
    return opts.hostType === "codex"
      ? `Use the WhatsAgent check_messages MCP tool now. ${subject}. Handle it before continuing.\r`
      : `Use the WhatsAgent check_messages tool now. ${subject}. Handle it before continuing.\r`;
  };
  function queueNudge(body: { messageId?: number; fromRole?: string; source?: string }) {
    pendingNudge = {
      messageId: body.messageId,
      fromRole: body.fromRole,
      source: body.source,
      count: (pendingNudge?.count || 0) + 1,
      queuedAt: pendingNudge?.queuedAt || new Date().toISOString(),
    };
    if (opts.hostType === "codex") return;
    scheduleNudgeFlush();
  }
  function scheduleNudgeFlush() {
    if (nudgeTimer) clearTimeout(nudgeTimer);
    if (!pendingNudge) return;
    const idleAt = opts.hostType === "codex" ? lastInputAt : lastActivityAt;
    const idleIn = Math.max(0, nudgeIdleMs - (Date.now() - idleAt));
    const throttleIn = Math.max(0, nudgeThrottleMs - (Date.now() - lastNudgeAt));
    nudgeTimer = setTimeout(() => flushNudge(), Math.max(idleIn, throttleIn));
  }
  function flushNudge() {
    nudgeTimer = undefined;
    if (!pendingNudge) return;
    const idleAt = opts.hostType === "codex" ? lastInputAt : lastActivityAt;
    if (Date.now() - idleAt < nudgeIdleMs || Date.now() - lastNudgeAt < nudgeThrottleMs) {
      scheduleNudgeFlush();
      return;
    }
    const body = pendingNudge;
    pendingNudge = undefined;
    const data = nudgePrompt(body);
    append("input", `$ ${data}`);
    append("output", "fake-runner: inbox nudge received\n");
    lastNudgeAt = Date.now();
    logger.info("runner.nudge", { role: opts.role, sessionId: opts.sessionId, messageId: body.messageId, fromRole: body.fromRole || body.source || "unknown", count: body.count, bytes: data.length });
  };

  append("status", `WhatsAgent runner started for ${opts.role}\n`);
  append("status", `host=${opts.hostType} cwd=${opts.cwd}\n`);
  append("output", "PTY is not connected yet. Input is echoed by the fake runner IPC loop.\n");

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      if (!isRunnerControlAuthorized(req, opts.controlSecret)) return runnerUnauthorized();
      const url = new URL(req.url);
      try {
        if (url.pathname === "/health") return runnerJson({ ok: true, role: opts.role, sessionId: opts.sessionId, seq });
        if (url.pathname === "/output") {
          const cursor = Number(url.searchParams.get("cursor") ?? "0");
          const events = output.filter((event) => event.seq > cursor);
          return runnerJson({ cursor: seq, events });
        }
        if (req.method === "POST" && url.pathname === "/input") {
          const body = await readRunnerJsonOrEmpty<{ data?: string }>(req);
          const data = body.data ?? "";
          lastInputAt = Date.now();
          append("input", data.endsWith("\n") ? `$ ${data}` : `$ ${data}\n`);
          append("output", `fake-runner: received ${JSON.stringify(data)}\n`);
          recordInputActivity(data.length);
          return runnerJson({ ok: true, cursor: seq });
        }
        if (req.method === "POST" && url.pathname === "/nudge") {
          const body = await readRunnerJsonOrEmpty<{ messageId?: number; fromRole?: string; source?: string }>(req);
          queueNudge(body);
          logger.info("runner.nudge_queued", { role: opts.role, sessionId: opts.sessionId, messageId: body.messageId, fromRole: body.fromRole || body.source || "unknown", count: pendingNudge?.count || 1 });
          return runnerJson({ ok: true, queued: true, nudged: false, pending: pendingNudge?.count || 1, cursor: seq });
        }
        if (req.method === "POST" && url.pathname === "/nudge-clear") {
          pendingNudge = undefined;
          if (nudgeTimer) clearTimeout(nudgeTimer);
          nudgeTimer = undefined;
          logger.info("runner.nudge_clear", { role: opts.role, sessionId: opts.sessionId });
          return runnerJson({ ok: true, cursor: seq });
        }
        if (req.method === "POST" && url.pathname === "/resize") {
          const body = await readRunnerJsonOrEmpty<{ cols?: number; rows?: number }>(req);
          const cols = Number(body.cols || 100);
          const rows = Number(body.rows || 30);
          logger.info("runner.resize", { role: opts.role, sessionId: opts.sessionId, cols, rows });
          return runnerJson({ ok: true, cols, rows });
        }
        return runnerJson({ error: "not found" }, { status: 404 });
      } catch (e) {
        if (e instanceof RunnerRequestEntityTooLarge) {
          return runnerJson({ ok: false, error: e.message, size: e.size, limit: e.limit }, { status: 413 });
        }
        return runnerJson({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
      }
    },
  });

  const metadata: RunnerMetadata = {
    fleet_id: opts.fleetId,
    ...(opts.workspaceId ? { workspace_id: opts.workspaceId } : {}),
    role: opts.role,
    display_id: opts.displayId,
    session_id: opts.sessionId,
    host_type: opts.hostType,
    mode: "fake",
    control_secret: opts.controlSecret,
    runner_pid: process.pid,
    cwd: opts.cwd,
    socket_path: runnerSocketPath(opts.runDir, opts.displayId),
    control_url: `http://${server.hostname}:${server.port}`,
    started_at: new Date().toISOString(),
  };

  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), { encoding: "utf8", mode: 0o600 });
  logger.info("runner.start", { role: opts.role, sessionId: opts.sessionId, hostType: opts.hostType, cwd: opts.cwd, pid: process.pid });

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    await flushInputActivity();
    logger.info("runner.stop", { role: opts.role, sessionId: opts.sessionId, signal });
    await rm(metadataPath, { force: true }).catch(() => undefined);
    server.stop(true);
    process.exit(0);
  };

  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGHUP", () => void stop("SIGHUP"));

  // This placeholder runner owns the long-lived session process before the PTY layer lands.
  await new Promise(() => undefined);
}

function runnerJson(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}
