#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdir, rm, writeFile, appendFile } from "node:fs/promises";
import { spawn as spawnPty } from "node-pty";

const opts = JSON.parse(process.argv[2] || "{}");
const output = [];
let seq = 0;
let server;
let child;
let stopping = false;
let controlUrl;
let childExit;
let lastNudgeAt = 0;
let lastActivityAt = Date.now();
let lastInputAt = Date.now();
let pendingNudge;
let nudgeTimer;
let draftLength = 0;
let nudgeBlockedByDraft = false;
let approvalWaiting;
const NUDGE_IDLE_MS = 1000;
const NUDGE_THROTTLE_MS = 5000;
const INPUT_ACTIVITY_LOG_INTERVAL_MS = 10_000;
const isCodex = opts.hostType === "codex";
let inputActivityCount = 0;
let inputActivityBytes = 0;
let inputActivityTimer;
let redrawSettings = normalizeRedrawSettings(opts.tuiRedraw);
let lastDims = { cols: opts.cols || 100, rows: opts.rows || 30 };
let pulseInFlight = false;
let redrawPulseCount = 0;
let redrawLastPulseAt;

// Ring-buffer cap. Default raised from 1000 to 4000 (audit P2): bursty TUI
// redraws (top, watch, full-screen apps) can produce thousands of small
// onData chunks per second; the old 1000-event cap meant chunks could be
// dropped between WS reconnects. ~100 bytes/event x 4000 = ~400 KB/runner,
// negligible. Override via WHATSAGENT_RUNNER_BUFFER for memory-constrained
// hosts.
const RUNNER_BUFFER_CAP = (() => {
  const override = Number(process.env.WHATSAGENT_RUNNER_BUFFER);
  return Number.isInteger(override) && override >= 100 ? override : 4000;
})();
const RUNNER_CONTROL_MAX_BODY_BYTES = 64 * 1024;

class RequestEntityTooLarge extends Error {
  constructor(size, limit) {
    super(`request body is ${size} bytes; limit is ${limit}`);
    this.name = "RequestEntityTooLarge";
    this.size = size;
    this.limit = limit;
  }
}

function append(type, data) {
  lastActivityAt = Date.now();
  output.push({ seq: ++seq, type, data, at: new Date().toISOString() });
  if (output.length > RUNNER_BUFFER_CAP) output.shift();
  if (type === "output") updateAttentionFromOutput(data);
  if (childExit) void writeMetadata();
  if (pendingNudge && !pendingNudge.submittedAt) scheduleNudgeFlush();
}

function updateAttentionFromOutput(data) {
  const text = String(data || "");
  let changed = false;
  const normalized = text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const waitsForApproval = normalized && (
    normalized.includes("waiting for approval") ||
    normalized.includes("permission approval") ||
    normalized.includes("permission required") ||
    normalized.includes("requires approval") ||
    normalized.includes("approve this") ||
    normalized.includes("do you want to proceed") ||
    normalized.includes("allow this command") ||
    normalized.includes("allow command") ||
    normalized.includes("press enter to approve")
  );
  if (waitsForApproval && !approvalWaiting) {
    approvalWaiting = { at: new Date().toISOString(), kind: "terminal-output" };
    changed = true;
  }
  if (changed && !childExit) void writeMetadata();
}

// EP-029 T2: bumped 16k → 256k so the exited-runner replay path (consumed via
// browser-side appendTerminal for stopped sessions) preserves more scrollback.
// Cheap (one runner per process; ~256KB max tail), independent of T7 disk
// persistence.
function outputTail() {
  return output.map((event) => event.data).join("").slice(-262_144);
}

async function log(event, payload = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level: "info", event, ...payload }) + "\n";
  await appendFile(opts.logPath, line, "utf8").catch(() => undefined);
}

const REDACTED_ARG = "[redacted]";
const SENSITIVE_KEY_PATTERN = /(^|[_-])(TOKEN|KEY|SECRET)($|[_-])/i;
const SENSITIVE_PATH_PATTERN = /(^|[~\/\\])\.(config|ssh|aws|kube)([\/\\]|$)/i;
const LONG_BASE64_PATTERN = /[A-Za-z0-9+_-]{40,}={0,2}/g;

function argKey(value) {
  return String(value || "").replace(/^-+/, "").split(/[=:]/, 1)[0] || "";
}

function isSensitiveArgKey(value) {
  const key = argKey(value);
  return key.toUpperCase().startsWith("WHATSAGENT_") || SENSITIVE_KEY_PATTERN.test(key);
}

function redactSensitiveArgValue(value) {
  const text = String(value || "");
  if (SENSITIVE_PATH_PATTERN.test(text)) return REDACTED_ARG;
  return text.replace(LONG_BASE64_PATTERN, REDACTED_ARG);
}

function redactSensitiveArgs(args = []) {
  const redacted = [];
  let redactNext = false;
  for (const arg of args) {
    const text = String(arg ?? "");
    if (redactNext) {
      redacted.push(REDACTED_ARG);
      redactNext = false;
      continue;
    }
    if (isSensitiveArgKey(text)) {
      if (/[=:]/.test(text)) {
        const separator = text.includes("=") ? "=" : ":";
        redacted.push(`${text.slice(0, text.indexOf(separator) + 1)}${REDACTED_ARG}`);
      } else {
        redacted.push(text);
        redactNext = true;
      }
      continue;
    }
    redacted.push(redactSensitiveArgValue(text));
  }
  return redacted;
}

function recordInputActivity(bytes) {
  inputActivityCount += 1;
  inputActivityBytes += bytes;
  if (inputActivityTimer) return;
  inputActivityTimer = setTimeout(() => void flushInputActivity(), INPUT_ACTIVITY_LOG_INTERVAL_MS);
  inputActivityTimer.unref?.();
}

async function flushInputActivity() {
  if (inputActivityTimer) clearTimeout(inputActivityTimer);
  inputActivityTimer = undefined;
  if (inputActivityCount === 0) return;
  const count = inputActivityCount;
  const bytes = inputActivityBytes;
  inputActivityCount = 0;
  inputActivityBytes = 0;
  await log("runner.input_activity", { role: opts.role, sessionId: opts.sessionId, count, bytes });
}

function normalizeRedrawWorkaround(value) {
  if (value === "off" || value === "none") return "off";
  if (value === "on" || value === "client" || value === "server" || value === "both") return "on";
  return "on";
}

function normalizeRedrawSettings(input = {}) {
  const value = input && typeof input === "object" ? input : {};
  return { workaround: normalizeRedrawWorkaround(value.workaround) };
}

function validateRedrawSettings(input = {}) {
  if (!input || typeof input !== "object") throw new Error("redraw settings body is required");
  if (!["off", "on", "none", "client", "server", "both"].includes(input.workaround)) throw new Error("workaround must be off or on");
  return { workaround: normalizeRedrawWorkaround(input.workaround) };
}

function redrawMetadata() {
  return {
    workaround: redrawSettings.workaround,
    pulse_count: redrawPulseCount,
    ...(redrawLastPulseAt ? { last_pulse_at: redrawLastPulseAt } : {}),
  };
}

function setRedrawSettings(next) {
  redrawSettings = next;
  return redrawMetadata();
}

function normalizePulseReason(value) {
  return value === "restore" || value === "burst" ? value : "burst";
}

function startRedrawPulse(reason) {
  const { cols, rows } = lastDims;
  pulseInFlight = true;
  try {
    child.resize(cols, rows - 1);
  } catch (error) {
    pulseInFlight = false;
    void log("runner.tui_redraw_failed", { role: opts.role, sessionId: opts.sessionId, reason, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  redrawPulseCount += 1;
  redrawLastPulseAt = new Date().toISOString();
  void log("runner.tui_redraw_pulse", { role: opts.role, sessionId: opts.sessionId, count: redrawPulseCount, reason, cols, rows });
  void writeMetadata();
  const timer = setTimeout(() => {
    pulseInFlight = false;
    if (childExit || stopping || !child) { void writeMetadata(); return; }
    const current = lastDims;
    try {
      child.resize(current.cols, current.rows);
    } catch (error) {
      void log("runner.tui_redraw_failed", { role: opts.role, sessionId: opts.sessionId, reason, error: error instanceof Error ? error.message : String(error) });
    }
    void writeMetadata();
  }, 150);
  timer.unref?.();
}

function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text), ...headers });
  res.end(text);
}

function isRunnerControlAuthorized(req) {
  return Boolean(opts.controlSecret) && req.headers.authorization === `Bearer ${opts.controlSecret}`;
}

function sendUnauthorized(res) {
  return sendJson(res, 401, { ok: false, error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
}

function sendRunnerError(res, error) {
  if (error instanceof RequestEntityTooLarge) {
    return sendJson(res, 413, { ok: false, error: error.message, size: error.size, limit: error.limit });
  }
  return sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
}

function enforceBodySize(req, maxBytes = RUNNER_CONTROL_MAX_BODY_BYTES) {
  const length = req.headers["content-length"];
  if (length == null) return;
  const size = Number(Array.isArray(length) ? length[0] : length);
  if (Number.isFinite(size) && size > maxBytes) throw new RequestEntityTooLarge(size, maxBytes);
}

function readBody(req, maxBytes = RUNNER_CONTROL_MAX_BODY_BYTES) {
  enforceBodySize(req, maxBytes);
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      size += Buffer.byteLength(chunk);
      if (size > maxBytes) {
        settled = true;
        req.resume();
        reject(new RequestEntityTooLarge(size, maxBytes));
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(body);
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

async function readJsonOrEmpty(req) {
  try {
    const body = await readBody(req);
    return body ? JSON.parse(body) : {};
  } catch (error) {
    if (error instanceof RequestEntityTooLarge) throw error;
    return {};
  }
}

function cleanNudgeSource(value) {
  return String(value || "WhatsAgent").replace(/[^a-zA-Z0-9_.:@-]/g, "").slice(0, 80) || "WhatsAgent";
}

function nudgePrompt(body = {}) {
  const from = cleanNudgeSource(body.fromRole || body.source);
  const count = Number(body.count || 1);
  const subject = count > 1 ? `${count} WhatsAgent messages are waiting` : `A WhatsAgent message is waiting from ${from}`;
  // TUIs submit on carriage return; LF can leave text sitting in the input box.
  return isCodex
    ? `Use the WhatsAgent check_messages MCP tool now. ${subject}. Handle it before continuing.\r`
    : `Use the WhatsAgent check_messages tool now. ${subject}. Handle it before continuing.\r`;
}

function pendingNudgeMetadata() {
  if (!pendingNudge) return undefined;
  return {
    count: pendingNudge.count || 1,
    ...(pendingNudge.fromRole ? { from_role: pendingNudge.fromRole } : {}),
    ...(pendingNudge.source ? { source: pendingNudge.source } : {}),
    queued_at: pendingNudge.queuedAt,
    ...(nudgeBlockedByDraft ? { blocked_by_draft: true } : {}),
    ...(pendingNudge.submittedAt ? { submitted_at: pendingNudge.submittedAt } : {}),
  };
}

function updateDraftState(data) {
  if (!isCodex || !data) return;
  const text = String(data);
  if (text.startsWith("\x1b")) return;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (ch === "\r" || ch === "\n" || code === 3 || code === 21) {
      draftLength = 0;
      continue;
    }
    if (code === 8 || code === 127) {
      draftLength = Math.max(0, draftLength - 1);
      continue;
    }
    if (code >= 32 && code !== 127) draftLength += 1;
  }
  if (draftLength === 0 && nudgeBlockedByDraft) {
    nudgeBlockedByDraft = false;
    void writeMetadata();
  }
}

function clearPendingNudge() {
  pendingNudge = undefined;
  nudgeBlockedByDraft = false;
  if (nudgeTimer) clearTimeout(nudgeTimer);
  nudgeTimer = undefined;
  void writeMetadata();
}

function queueNudge(body = {}) {
  pendingNudge = {
    messageId: body.messageId,
    fromRole: body.fromRole,
    source: body.source,
    count: (pendingNudge?.count || 0) + 1,
    queuedAt: pendingNudge?.queuedAt || new Date().toISOString(),
  };
  nudgeBlockedByDraft = isCodex && draftLength > 0;
  void writeMetadata();
  if (!isCodex) scheduleNudgeFlush();
}

function scheduleNudgeFlush() {
  if (nudgeTimer) clearTimeout(nudgeTimer);
  if (isCodex || !pendingNudge || pendingNudge.submittedAt || childExit) return;
  const idleAt = isCodex ? lastInputAt : lastActivityAt;
  const idleIn = Math.max(0, NUDGE_IDLE_MS - (Date.now() - idleAt));
  const throttleIn = Math.max(0, NUDGE_THROTTLE_MS - (Date.now() - lastNudgeAt));
  nudgeTimer = setTimeout(() => void flushNudge(), Math.max(idleIn, throttleIn)).unref();
}

async function flushNudge() {
  nudgeTimer = undefined;
  if (!pendingNudge || childExit) return;
  const idleAt = isCodex ? lastInputAt : lastActivityAt;
  if (Date.now() - idleAt < NUDGE_IDLE_MS || Date.now() - lastNudgeAt < NUDGE_THROTTLE_MS) {
    scheduleNudgeFlush();
    return;
  }
  const body = pendingNudge;
  nudgeBlockedByDraft = false;
  const data = nudgePrompt(body);
  child.write(data);
  lastNudgeAt = Date.now();
  await log("runner.nudge", { role: opts.role, sessionId: opts.sessionId, messageId: body.messageId, fromRole: body.fromRole || body.source || "unknown", count: body.count, bytes: data.length });
  pendingNudge = isCodex ? { ...body, submittedAt: new Date().toISOString() } : undefined;
  await writeMetadata();
}

async function writeMetadata(nextControlUrl = controlUrl) {
  controlUrl = nextControlUrl;
  await mkdir(opts.runDir, { recursive: true, mode: 0o700 });
  await writeFile(opts.metadataPath, JSON.stringify({
    fleet_id: opts.fleetId,
    ...(opts.workspaceId ? { workspace_id: opts.workspaceId } : {}),
    role: opts.role,
    display_id: opts.displayId,
    session_id: opts.sessionId,
    host_type: opts.hostType,
    mode: "pty",
    status: childExit ? "exited" : "running",
    ...(opts.nativePush ? { native_push: opts.nativePush } : {}),
    tui_redraw: redrawMetadata(),
    ...(pendingNudgeMetadata() ? { pending_nudge: pendingNudgeMetadata() } : {}),
    ...(approvalWaiting ? { attention: { approval_waiting: approvalWaiting } } : {}),
    runner_pid: process.pid,
    child_pid: child?.pid,
    ...(childExit ? childExit : {}),
    ...(childExit ? { output_tail: outputTail() } : {}),
    cwd: opts.cwd,
    socket_path: opts.socketPath,
    control_url: controlUrl,
    control_secret: opts.controlSecret,
    started_at: opts.startedAt,
  }, null, 2), { encoding: "utf8", mode: 0o600 });
}

function exitAfterChildExit() {
  setTimeout(() => {
    server?.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  }, 1500).unref();
}

async function stop(signal) {
  if (stopping) return;
  stopping = true;
  await flushInputActivity();
  await log("runner.stop", { role: opts.role, sessionId: opts.sessionId, signal });
  try { child?.kill(); } catch {}
  await rm(opts.metadataPath, { force: true }).catch(() => undefined);
  server?.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}

await mkdir(opts.runDir, { recursive: true, mode: 0o700 });
append("status", `WhatsAgent PTY runner started for ${opts.role}\n`);
append("status", `host=${opts.hostType} cwd=${opts.cwd}\n`);
append("status", `command=${opts.command} ${redactSensitiveArgs(opts.args || []).join(" ")}\n`);

child = spawnPty(opts.command, opts.args || [], {
  name: "xterm-256color",
  cols: opts.cols || 100,
  rows: opts.rows || 30,
  cwd: opts.cwd,
  env: { ...process.env, ...(opts.env || {}) },
});
setRedrawSettings(redrawSettings);

child.onData((data) => append("output", data));
child.onExit((event) => {
  childExit = {
    exit_code: event.exitCode,
    ...(event.signal ? { exit_signal: event.signal } : {}),
    exited_at: new Date().toISOString(),
  };
  append("status", `\n[process exited ${event.exitCode}${event.signal ? ` signal ${event.signal}` : ""}]\n`);
  void (async () => {
    await flushInputActivity();
    await log("runner.child_exit", { role: opts.role, sessionId: opts.sessionId, exitCode: event.exitCode, signal: event.signal });
  })();
  void writeMetadata();
  setTimeout(() => void writeMetadata(), 250).unref();
  exitAfterChildExit();
});

server = createServer(async (req, res) => {
  if (!isRunnerControlAuthorized(req)) return sendUnauthorized(res);
  const url = new URL(req.url || "/", "http://127.0.0.1");
  try {
    if (req.method === "GET" && url.pathname === "/health") return sendJson(res, 200, { ok: !childExit, status: childExit ? "exited" : "running", role: opts.role, sessionId: opts.sessionId, seq, tuiRedraw: redrawMetadata() });
    if (req.method === "GET" && url.pathname === "/output") {
      const cursor = Number(url.searchParams.get("cursor") || "0");
      return sendJson(res, 200, {
        cursor: seq,
        events: output.filter((event) => event.seq > cursor),
        ...(approvalWaiting ? { attention: { approval_waiting: approvalWaiting } } : {}),
      });
    }
    if (req.method === "POST" && url.pathname === "/input") {
      if (childExit) return sendJson(res, 409, { error: "PTY child has exited", ...childExit });
      const body = await readJsonOrEmpty(req);
      const data = body.data || "";
      lastActivityAt = Date.now();
      lastInputAt = lastActivityAt;
      // Only persist metadata when approvalWaiting was actually cleared. Per-input
      // file I/O saturates the runner event loop during wheel-burst input,
      // delaying SIGTERM handling and starving /output requests. updateDraftState
      // performs its own writeMetadata on codex draft transitions when needed.
      const hadApprovalWaiting = approvalWaiting !== undefined;
      approvalWaiting = undefined;
      updateDraftState(data);
      if (hadApprovalWaiting) await writeMetadata();
      child.write(data);
      recordInputActivity(data.length);
      return sendJson(res, 200, { ok: true, cursor: seq });
    }
    if (req.method === "POST" && url.pathname === "/nudge") {
      if (childExit) return sendJson(res, 409, { error: "PTY child has exited", ...childExit });
      const body = await readJsonOrEmpty(req);
      queueNudge(body);
      await log("runner.nudge_queued", { role: opts.role, sessionId: opts.sessionId, messageId: body.messageId, fromRole: body.fromRole || body.source || "unknown", count: pendingNudge?.count || 1 });
      return sendJson(res, 200, { ok: true, queued: true, nudged: false, pending: pendingNudge?.count || 1, blocked_by_draft: nudgeBlockedByDraft, cursor: seq });
    }
    if (req.method === "POST" && url.pathname === "/nudge-clear") {
      clearPendingNudge();
      await log("runner.nudge_clear", { role: opts.role, sessionId: opts.sessionId });
      return sendJson(res, 200, { ok: true, cursor: seq });
    }
    if (req.method === "POST" && url.pathname === "/redraw-settings") {
      if (childExit) return sendJson(res, 409, { error: "PTY child has exited", ...childExit });
      try {
        const body = await readJsonOrEmpty(req);
        const tuiRedraw = setRedrawSettings(validateRedrawSettings(body));
        await log("runner.tui_redraw_settings", { role: opts.role, sessionId: opts.sessionId, workaround: tuiRedraw.workaround });
        await writeMetadata();
        return sendJson(res, 200, { ok: true, tuiRedraw, cursor: seq });
      } catch (error) {
        return sendRunnerError(res, error);
      }
    }
    if (req.method === "POST" && url.pathname === "/redraw-pulse") {
      if (childExit) return sendJson(res, 409, { error: "PTY child has exited", ...childExit });
      if (process.platform === "win32") return sendJson(res, 200, { ok: true, skipped: "win32" });
      if (pulseInFlight) return sendJson(res, 200, { ok: true, skipped: "in-flight" });
      const body = await readJsonOrEmpty(req);
      const reason = normalizePulseReason(body.reason);
      const { cols, rows } = lastDims;
      if (rows < 2) return sendJson(res, 200, { ok: true, skipped: "rows-too-small" });
      startRedrawPulse(reason);
      return sendJson(res, 200, { ok: true, cols, rows, pulses: redrawPulseCount, reason });
    }
    if (req.method === "POST" && url.pathname === "/resize") {
      if (childExit) return sendJson(res, 409, { error: "PTY child has exited", ...childExit });
      const body = await readJsonOrEmpty(req);
      const cols = Number(body.cols || lastDims.cols);
      const rows = Number(body.rows || lastDims.rows);
      lastDims = { cols, rows };
      child.resize(cols, rows);
      return sendJson(res, 200, { ok: true, cols, rows });
    }
    return sendJson(res, 404, { error: "not found" });
  } catch (error) {
    return sendRunnerError(res, error);
  }
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  controlUrl = `http://127.0.0.1:${address.port}`;
  void writeMetadata(controlUrl);
  void log("runner.start", { role: opts.role, sessionId: opts.sessionId, hostType: opts.hostType, mode: "pty", pid: process.pid, childPid: child.pid });
});

process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGHUP", () => void stop("SIGHUP"));
