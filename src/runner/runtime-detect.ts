import { isAbsolute } from "node:path";
import { existsSync } from "node:fs";

import type { HostType } from "./protocol.ts";
import type { RuntimeCommandConfig, RuntimeCommands } from "../db.ts";

export type RuntimeDetectionError = "not_found" | "timeout" | "nonzero_exit" | "probe_crashed";

export interface RuntimeDetection {
  detected: boolean;
  resolvedPath: string | null;
  version: string | null;
  rawVersionOutput: string | null;
  error: RuntimeDetectionError | null;
  lastCheckedAt: string;
}

const PROBE_TIMEOUT_MS = 3000;
const VERSION_PATTERN = /(\d+\.\d+\.\d+)/;

export const HOST_TYPES: readonly HostType[] = ["claude-code", "opencode", "codex", "pi"] as const;

export function commandsKeyForHost(host: HostType): keyof RuntimeCommands {
  if (host === "opencode") return "openCode";
  if (host === "codex") return "codex";
  if (host === "pi") return "pi";
  return "claudeCode";
}

export function commandConfigForHost(commands: RuntimeCommands, host: HostType): RuntimeCommandConfig {
  return commands[commandsKeyForHost(host)];
}

export async function probeRuntime(host: HostType, customCommand: string | null | undefined): Promise<RuntimeDetection> {
  const lastCheckedAt = new Date().toISOString();
  const target = (customCommand ?? "").trim() || defaultCommandForHost(host);
  const resolved = isAbsolute(target) ? target : Bun.which(target);
  if (!resolved) {
    return { detected: false, resolvedPath: null, version: null, rawVersionOutput: null, error: "not_found", lastCheckedAt };
  }
  // Absolute paths bypass Bun.which, which means a non-existent absolute path
  // would otherwise reach Bun.spawn and surface as probe_crashed. Pre-check
  // existence so the chip says "not found" instead of a confusing crash.
  if (!existsSync(resolved)) {
    return { detected: false, resolvedPath: resolved, version: null, rawVersionOutput: null, error: "not_found", lastCheckedAt };
  }

  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  try {
    proc = Bun.spawn([resolved, "--version"], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const exitPromise = proc.exited;
    timer = setTimeout(() => {
      timedOut = true;
      try { proc?.kill(); } catch { /* ignore */ }
    }, PROBE_TIMEOUT_MS);
    const exit = await exitPromise;
    if (timer) clearTimeout(timer);
    if (timedOut) {
      return { detected: false, resolvedPath: resolved, version: null, rawVersionOutput: null, error: "timeout", lastCheckedAt };
    }
    if (exit !== 0) {
      return { detected: false, resolvedPath: resolved, version: null, rawVersionOutput: null, error: "nonzero_exit", lastCheckedAt };
    }
    const stdoutText = await readStreamText(proc.stdout);
    const stderrText = await readStreamText(proc.stderr);
    const raw = firstNonEmptyLine(stdoutText) ?? firstNonEmptyLine(stderrText);
    const match = raw?.match(VERSION_PATTERN) ?? null;
    return {
      detected: true,
      resolvedPath: resolved,
      version: match?.[1] ?? null,
      rawVersionOutput: raw ?? null,
      error: null,
      lastCheckedAt,
    };
  } catch {
    if (timer) clearTimeout(timer);
    return { detected: false, resolvedPath: resolved, version: null, rawVersionOutput: null, error: "probe_crashed", lastCheckedAt };
  }
}

export async function probeAllRuntimes(commands: RuntimeCommands): Promise<Record<HostType, RuntimeDetection>> {
  const entries = await Promise.all(
    HOST_TYPES.map(async (host) => {
      const cfg = commandConfigForHost(commands, host);
      const detection = await probeRuntime(host, cfg.command);
      return [host, detection] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<HostType, RuntimeDetection>;
}

function defaultCommandForHost(host: HostType): string {
  if (host === "opencode") return "opencode";
  if (host === "codex") return "codex";
  if (host === "pi") return "pi";
  return "claude";
}

function firstNonEmptyLine(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

async function readStreamText(stream: ReadableStream<Uint8Array> | number | undefined): Promise<string> {
  if (!stream || typeof stream === "number") return "";
  return await new Response(stream).text();
}
