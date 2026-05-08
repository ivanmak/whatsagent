import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  path: string;
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

function redact(fields: Record<string, unknown> = {}): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (/token|secret|password/i.test(key)) result[key] = "[redacted]";
    else result[key] = value;
  }
  return result;
}

export function createLogger(path: string, opts: { console?: boolean } = {}): Logger {
  const write = (level: LogLevel, event: string, fields: Record<string, unknown> = {}) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...redact(fields) }) + "\n";
    appendFile(path, line, "utf8").catch((e) => {
      console.error(`[whatsagent] failed to write log ${path}: ${e instanceof Error ? e.message : String(e)}`);
    });
    if (opts.console ?? true) {
      const msg = `[whatsagent] ${event}`;
      if (level === "error") console.error(msg);
      else if (level === "warn") console.warn(msg);
      else console.log(msg);
    }
  };

  mkdir(dirname(path), { recursive: true, mode: 0o700 }).catch(() => undefined);

  return {
    path,
    debug(event, fields) { write("debug", event, fields); },
    info(event, fields) { write("info", event, fields); },
    warn(event, fields) { write("warn", event, fields); },
    error(event, fields) { write("error", event, fields); },
  };
}
