import type { NotificationEvent } from "./ledger.ts";

export function truncate(value: unknown, limit: number): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? text.slice(0, limit - 3) + "..." : text;
}

type Message = { id: number; from_role_name?: string; to_role_name?: string; body?: string; state?: string };

export function buildEventForMessage(msg: Message): Omit<NotificationEvent, "id" | "ts" | "read"> {
  return {
    kind: "new_message",
    title: (msg.from_role_name ?? "?") + " -> " + (msg.to_role_name ?? "?"),
    body: truncate(msg.body, 180),
    role: msg.from_role_name,
    link: { page: "messages", inbox: msg.to_role_name, peer: msg.from_role_name, messageId: msg.id },
    dedupKey: "new_message:" + msg.id,
  };
}

type Runner = { role: string; session_id?: string; exit_code?: number | null; exit_signal?: string | null; host_type?: string; pending_nudge?: { queued_at?: string; blocked_by_draft?: boolean }; attention?: { approval_waiting?: { at?: string } } };

export function buildEventForRunnerExit(runner: Runner): Omit<NotificationEvent, "id" | "ts" | "read"> {
  const detail = runner.exit_code != null ? "exit code " + runner.exit_code : (runner.exit_signal ? "signal " + runner.exit_signal : "offline");
  return {
    kind: "runner_exit",
    title: "Agent exited: " + runner.role,
    body: detail,
    role: runner.role,
    link: { page: "agents", role: runner.role },
    dedupKey: "runner_exit:" + runner.role + ":" + (runner.session_id ?? ""),
  };
}

export function buildEventForApprovalWaiting(runner: Runner): Omit<NotificationEvent, "id" | "ts" | "read"> {
  const at = runner.attention?.approval_waiting?.at ?? "";
  return {
    kind: "approval_waiting",
    title: "Approval waiting: " + runner.role,
    body: "The background TUI appears to be waiting for permission approval.",
    role: runner.role,
    link: { page: "agents", role: runner.role },
    dedupKey: "approval_waiting:" + runner.role + ":" + at,
  };
}

export function buildEventForCodexNudgeBlocked(runner: Runner): Omit<NotificationEvent, "id" | "ts" | "read"> {
  const queued = runner.pending_nudge?.queued_at ?? "";
  return {
    kind: "codex_nudge_blocked",
    title: "Inbox waiting: " + runner.role,
    body: "A Codex draft is delaying the check_messages nudge.",
    role: runner.role,
    link: { page: "agents", role: runner.role },
    dedupKey: "codex_nudge_blocked:" + runner.role + ":" + queued,
  };
}

export function buildEventForCodexInboxPending(runner: Runner): Omit<NotificationEvent, "id" | "ts" | "read"> {
  const queued = runner.pending_nudge?.queued_at ?? "";
  return {
    kind: "codex_inbox_pending",
    title: "Inbox queued: " + runner.role,
    body: "New inbox waiting for " + runner.role + ".",
    role: runner.role,
    link: { page: "agents", role: runner.role },
    dedupKey: "codex_inbox_pending:" + runner.role + ":" + queued,
  };
}

export function buildEventForLaunchFailure(role: string, message: string, ts: number): Omit<NotificationEvent, "id" | "ts" | "read"> {
  return {
    kind: "launch_failure",
    title: "Launch failed: " + role,
    body: truncate(message, 180),
    role,
    link: { page: "agents", role },
    dedupKey: "launch_failure:" + role + ":" + ts,
  };
}
