import type { MessageRow } from "../db.ts";

interface RecentEntry {
  message: MessageRow;
  deliveredAtMs: number;
}

export const RECENT_DELIVERED_MAX = 50;
export const RECENT_DELIVERED_TTL_MS = 15 * 60 * 1000;

const recentDelivered: RecentEntry[] = [];

function prune(nowMs = Date.now()): void {
  const cutoff = nowMs - RECENT_DELIVERED_TTL_MS;
  while (recentDelivered.length > 0 && recentDelivered[0]!.deliveredAtMs < cutoff) recentDelivered.shift();
  while (recentDelivered.length > RECENT_DELIVERED_MAX) recentDelivered.shift();
}

export function recordRecentDelivered(message: MessageRow, nowMs = Date.now()): void {
  recentDelivered.push({ message, deliveredAtMs: nowMs });
  prune(nowMs);
}

export function getRecentDelivered(nowMs = Date.now()): MessageRow[] {
  prune(nowMs);
  return recentDelivered.map((entry) => entry.message);
}

export function mergeRecentDelivered(messages: MessageRow[], recent: MessageRow[] = getRecentDelivered()): MessageRow[] {
  const seen = new Set<string>();
  const merged: MessageRow[] = [];
  for (const message of [...recent, ...messages]) {
    const key = `${message.delivery_kind}:${message.channel_id ?? ""}:${message.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(message);
  }
  return merged.sort((a, b) => a.id - b.id);
}

export function __resetRecentDeliveredForTest(): void {
  recentDelivered.length = 0;
}
