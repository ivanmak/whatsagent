export const MAX_ENTRIES = 200;

export type NotificationEvent = {
  id: string;
  kind: "new_message" | "runner_exit" | "approval_waiting" | "codex_nudge_blocked" | "codex_inbox_pending" | "launch_failure";
  ts: number;
  title: string;
  body: string;
  role?: string;
  link?: { page: "agents" | "messages"; role?: string; inbox?: string; peer?: string; messageId?: number };
  read: boolean;
  dedupKey: string;
};

export type NotificationLog = {
  version: 1;
  events: NotificationEvent[];
  lastReadAt: number;
};

export function ledgerInsert(log: NotificationLog, event: NotificationEvent): boolean {
  for (const existing of log.events) {
    if (existing.dedupKey === event.dedupKey) {
      existing.ts = event.ts;
      existing.body = event.body;
      existing.title = event.title;
      existing.read = false;
      return false;
    }
  }
  log.events.unshift(event);
  while (log.events.length > MAX_ENTRIES) log.events.pop();
  return true;
}

export function parseLogSafe(raw: unknown): NotificationLog {
  function isValid(e: unknown): boolean {
    if (!e || typeof e !== "object") return false;
    const ev = e as Record<string, unknown>;
    return typeof ev.id === "string" && typeof ev.dedupKey === "string"
      && typeof ev.ts === "number" && typeof ev.kind === "string"
      && typeof ev.title === "string" && typeof ev.body === "string"
      && typeof ev.read === "boolean";
  }
  let parsed: unknown = raw;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { parsed = null; }
  }
  if (!parsed || typeof parsed !== "object") return { version: 1, events: [], lastReadAt: 0 };
  const obj = parsed as Partial<NotificationLog>;
  if (obj.version !== 1) return { version: 1, events: [], lastReadAt: 0 };
  const events = Array.isArray(obj.events) ? (obj.events.filter(isValid) as NotificationEvent[]).slice(0, MAX_ENTRIES) : [];
  const lastReadAt = typeof obj.lastReadAt === "number" ? obj.lastReadAt : 0;
  return { version: 1, events, lastReadAt };
}
