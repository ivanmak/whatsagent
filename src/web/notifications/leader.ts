export const LEADER_TTL_MS = 30_000;
export const LEADER_HEARTBEAT_MS = 10_000;

export type LeaderRecord = { tabId: string; ts: number };

export function isLeaderTab(record: LeaderRecord | null, ourTabId: string, now: number): boolean {
  if (!record) return true;
  if (now - record.ts > LEADER_TTL_MS) return true;
  return record.tabId === ourTabId;
}

export function makeLeaderRecord(tabId: string, now: number): LeaderRecord {
  return { tabId, ts: now };
}
