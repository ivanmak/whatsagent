import { expect, test } from "bun:test";
import { ledgerInsert, parseLogSafe, MAX_ENTRIES, NotificationLog } from "../src/web/notifications/ledger.ts";

function emptyLog(): NotificationLog {
  return { version: 1, events: [], lastReadAt: 0 };
}

function makeEvent(overrides: Partial<{ id: string; dedupKey: string; ts: number; body: string }> = {}) {
  return {
    id: overrides.id ?? "event-1",
    kind: "new_message" as const,
    ts: overrides.ts ?? 1000,
    title: "test",
    body: overrides.body ?? "test body",
    read: false,
    dedupKey: overrides.dedupKey ?? "new_message:1",
  };
}

test("ledgerInsert appends a new event and returns true", () => {
  const log = emptyLog();
  const inserted = ledgerInsert(log, makeEvent({ id: "a", dedupKey: "k1" }));
  expect(inserted).toBe(true);
  expect(log.events.length).toBe(1);
  expect(log.events[0]!.id).toBe("a");
});

test("ledgerInsert dedups by dedupKey, refreshes ts/body, and returns false", () => {
  const log = emptyLog();
  ledgerInsert(log, makeEvent({ id: "a", dedupKey: "k1", ts: 1000, body: "old" }));
  const inserted = ledgerInsert(log, makeEvent({ id: "b", dedupKey: "k1", ts: 2000, body: "new" }));
  expect(inserted).toBe(false);
  expect(log.events.length).toBe(1);
  expect(log.events[0]!.id).toBe("a");
  expect(log.events[0]!.ts).toBe(2000);
  expect(log.events[0]!.body).toBe("new");
  expect(log.events[0]!.read).toBe(false);
});

test("ledgerInsert prunes oldest when count exceeds MAX_ENTRIES", () => {
  const log = emptyLog();
  for (let i = 0; i < MAX_ENTRIES + 5; i++) {
    ledgerInsert(log, makeEvent({ id: "e" + i, dedupKey: "k" + i, ts: i }));
  }
  expect(log.events.length).toBe(MAX_ENTRIES);
  expect(log.events[0]!.id).toBe("e" + (MAX_ENTRIES + 4));
  expect(log.events[MAX_ENTRIES - 1]!.id).toBe("e5");
});

test("parseLogSafe returns empty log on bad input", () => {
  expect(parseLogSafe(null).events).toEqual([]);
  expect(parseLogSafe("not json").events).toEqual([]);
  expect(parseLogSafe('{"version":99}').events).toEqual([]);
  expect(parseLogSafe({ version: 1, events: "bad" }).events).toEqual([]);
});

test("parseLogSafe round-trips a valid log", () => {
  const log = emptyLog();
  ledgerInsert(log, makeEvent({ id: "a", dedupKey: "k" }));
  const round = parseLogSafe(JSON.stringify(log));
  expect(round.events.length).toBe(1);
  expect(round.events[0]!.id).toBe("a");
});

import { migratePrefsV2ToV3, DEFAULT_PREFS_V3 } from "../src/web/notifications/prefs.ts";

test("migratePrefsV2ToV3 returns DEFAULT_PREFS_V3 when both blobs are empty", () => {
  const result = migratePrefsV2ToV3({}, {});
  expect(result).toEqual(DEFAULT_PREFS_V3);
  expect(result.version).toBe(3);
  expect(result.enabled).toBe(true);
  expect(result.browserEnabled).toBe(true);
  expect(result.toastEnabled).toBe(true);
  expect(result.defaultSound).toBe("Chime");
  expect(result.soundThrottle).toBe("standard");
  expect(result.events.new_message.browser).toBe(true);
  expect(result.events.new_message.toast).toBe(true);
  expect(result.events.new_message.sound).toBe("Default");
});

test("migratePrefsV2ToV3 lifts notifyMessages/notifyRunnerExits from ui-prefs blob", () => {
  const result = migratePrefsV2ToV3(
    { approvalWaiting: false, nudgeBlocked: true },
    { notifyMessages: false, notifyRunnerExits: true }
  );
  expect(result.events.new_message.browser).toBe(false);
  expect(result.events.new_message.toast).toBe(false);
  expect(result.events.runner_exit.browser).toBe(true);
  expect(result.events.runner_exit.toast).toBe(true);
  expect(result.events.approval_waiting.browser).toBe(false);
  expect(result.events.codex_nudge_blocked.browser).toBe(true);
});

test("migratePrefsV2ToV3 preserves existing v3 event overrides over v2 defaults", () => {
  const result = migratePrefsV2ToV3(
    {
      version: 3,
      enabled: false,
      browserEnabled: false,
      events: { new_message: { browser: true, toast: false, sound: "Pulse" } },
    },
    { notifyMessages: false }
  );
  expect(result.enabled).toBe(false);
  expect(result.browserEnabled).toBe(false);
  expect(result.events.new_message.browser).toBe(true);
  expect(result.events.new_message.toast).toBe(false);
  expect(result.events.new_message.sound).toBe("Pulse");
});

test("migratePrefsV2ToV3 accepts and preserves Default event sound", () => {
  const result = migratePrefsV2ToV3(
    {
      version: 3,
      defaultSound: "Pulse",
      events: { new_message: { browser: true, toast: true, sound: "Default" } },
    },
    {}
  );
  expect(result.defaultSound).toBe("Pulse");
  expect(result.events.new_message.sound).toBe("Default");
});

test("migratePrefsV2ToV3 falls back to Default for missing or invalid event sound", () => {
  const result = migratePrefsV2ToV3(
    {
      version: 3,
      events: {
        new_message: { browser: true, toast: true },
        runner_exit: { browser: true, toast: true, sound: "Bogus" },
      },
    },
    {}
  );
  expect(result.events.new_message.sound).toBe("Default");
  expect(result.events.runner_exit.sound).toBe("Default");
});

import { isLeaderTab, LEADER_TTL_MS } from "../src/web/notifications/leader.ts";

test("isLeaderTab returns true when no leader record exists", () => {
  expect(isLeaderTab(null, "tab-A", 1_000_000)).toBe(true);
});

test("isLeaderTab returns true when current leader is stale", () => {
  const stale = { tabId: "tab-X", ts: 1_000_000 };
  expect(isLeaderTab(stale, "tab-A", 1_000_000 + LEADER_TTL_MS + 1)).toBe(true);
});

test("isLeaderTab returns true when our id matches the record", () => {
  const us = { tabId: "tab-A", ts: 1_000_000 };
  expect(isLeaderTab(us, "tab-A", 1_000_000 + 5_000)).toBe(true);
});

test("isLeaderTab returns false when another fresh leader holds the lock", () => {
  const them = { tabId: "tab-B", ts: 1_000_000 };
  expect(isLeaderTab(them, "tab-A", 1_000_000 + 5_000)).toBe(false);
});

import { shouldFire } from "../src/web/notifications/channelGate.ts";

function prefsWith(masterOverrides: Partial<typeof DEFAULT_PREFS_V3> = {}, eventOverrides: Partial<typeof DEFAULT_PREFS_V3.events.new_message> = {}) {
  const events = { ...DEFAULT_PREFS_V3.events, new_message: { ...DEFAULT_PREFS_V3.events.new_message, ...eventOverrides } };
  return { ...DEFAULT_PREFS_V3, ...masterOverrides, events };
}

test("shouldFire defaults to true for all channels with default prefs", () => {
  const p = DEFAULT_PREFS_V3;
  expect(shouldFire("browser", "new_message", p)).toBe(true);
  expect(shouldFire("toast", "new_message", p)).toBe(true);
  expect(shouldFire("sound", "new_message", p)).toBe(true);
});

test("shouldFire returns false when channel master is off", () => {
  expect(shouldFire("browser", "new_message", prefsWith({ browserEnabled: false }))).toBe(false);
  expect(shouldFire("toast",   "new_message", prefsWith({ toastEnabled: false }))).toBe(false);
  expect(shouldFire("sound",   "new_message", prefsWith({ enabled: false }))).toBe(false);
});

test("shouldFire returns false when per-event override is off (master on)", () => {
  expect(shouldFire("browser", "new_message", prefsWith({}, { browser: false }))).toBe(false);
  expect(shouldFire("toast",   "new_message", prefsWith({}, { toast: false }))).toBe(false);
  expect(shouldFire("sound",   "new_message", prefsWith({}, { sound: "Off" }))).toBe(false);
});

test("shouldFire sound returns true when per-event sound is non-Off", () => {
  expect(shouldFire("sound", "new_message", prefsWith({}, { sound: "Pulse" }))).toBe(true);
});

test("shouldFire sound inherits defaultSound when per-event sound is Default", () => {
  expect(shouldFire("sound", "new_message", prefsWith({ defaultSound: "Pulse" }, { sound: "Default" }))).toBe(true);
  expect(shouldFire("sound", "new_message", prefsWith({ defaultSound: "Off" }, { sound: "Default" }))).toBe(false);
});

test("shouldFire sound keeps explicit Off and concrete event sounds independent from defaultSound", () => {
  expect(shouldFire("sound", "new_message", prefsWith({ defaultSound: "Pulse" }, { sound: "Off" }))).toBe(false);
  expect(shouldFire("sound", "new_message", prefsWith({ defaultSound: "Off" }, { sound: "Signal" }))).toBe(true);
});

import {
  buildEventForMessage,
  buildEventForRunnerExit,
  buildEventForApprovalWaiting,
  buildEventForCodexNudgeBlocked,
  buildEventForCodexInboxPending,
  buildEventForLaunchFailure,
  truncate,
} from "../src/web/notifications/eventBuilders.ts";

test("truncate respects limit and replaces whitespace runs", () => {
  expect(truncate("  a   b\nc  ", 10)).toBe("a b c");
  expect(truncate("aaaaaaaaaaaaaaaaaa", 10)).toBe("aaaaaaa...");
});

test("buildEventForMessage produces correct shape", () => {
  const msg = { id: 42, from_role_name: "service-a", to_role_name: "architect", body: "build failing", state: "pending" };
  const e = buildEventForMessage(msg);
  expect(e.kind).toBe("new_message");
  expect(e.dedupKey).toBe("new_message:42");
  expect(e.role).toBe("service-a");
  expect(e.title).toContain("service-a");
  expect(e.title).toContain("architect");
  expect(e.body).toBe("build failing");
  expect(e.link?.page).toBe("messages");
  expect(e.link?.inbox).toBe("architect");
  expect(e.link?.peer).toBe("service-a");
  expect(e.link?.messageId).toBe(42);
});

test("buildEventForRunnerExit dedupKey uses session_id", () => {
  const runner = { role: "svc", session_id: "abc", exit_code: 1, exit_signal: null };
  const e = buildEventForRunnerExit(runner);
  expect(e.dedupKey).toBe("runner_exit:svc:abc");
  expect(e.body).toContain("exit code 1");
});

test("buildEventForApprovalWaiting dedupKey uses attention.at", () => {
  const runner = { role: "svc", attention: { approval_waiting: { at: "2026-04-28T10:00:00Z" } } };
  const e = buildEventForApprovalWaiting(runner);
  expect(e.dedupKey).toBe("approval_waiting:svc:2026-04-28T10:00:00Z");
});

test("buildEventForLaunchFailure dedupKey includes timestamp", () => {
  const e = buildEventForLaunchFailure("svc", "command not found", 1700_000_000);
  expect(e.dedupKey).toBe("launch_failure:svc:1700000000");
  expect(e.body).toBe("command not found");
});
