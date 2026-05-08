import { expect, spyOn, test } from "bun:test";
import * as crypto from "node:crypto";

import { DEFAULT_MESSAGE_MAX_BODY_CHARS } from "../src/db.ts";
import type { MessageRow } from "../src/db.ts";
import { DEFAULT_INBOX_INSTRUCTIONS } from "../src/messages/agent-text-settings.ts";
import { formatInboxEnvelope } from "../src/messages/inbox-envelope.ts";

function baseRow(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 1,
    thread_id: "role:actor:recipient",
    from_role_id: "actor",
    from_role_name: "WhatsAgent:main",
    to_role_id: "recipient",
    to_role_name: "WhatsAgent:worker",
    from_session_id: null,
    to_session_id: null,
    body: "default body",
    state: "delivered",
    delivery_kind: "direct",
    broadcast_id: null,
    sent_at: "2026-05-05T20:00:00.000Z",
    delivered_at: "2026-05-05T20:00:00.000Z",
    acked_at: null,
    pushed_at: null,
    error: null,
    ...overrides,
  };
}

function withNonceSequence<T>(hexValues: string[], fn: () => T): T {
  let index = 0;
  const spy = spyOn(crypto, "randomBytes").mockImplementation(((size: number) => {
    const hex = hexValues[index++] ?? hexValues[hexValues.length - 1] ?? "a3f8c1";
    return Buffer.from(hex.padEnd(size * 2, "0").slice(0, size * 2), "hex");
  }) as typeof crypto.randomBytes);
  try {
    return fn();
  } finally {
    spy.mockRestore();
  }
}

test("formatInboxEnvelope renders v2 header, trusted metadata, body markers, and compact actions", () => {
  const out = withNonceSequence(["a3f8c1"], () => formatInboxEnvelope([
    baseRow({ id: 41, body: "plain direct body", broadcast_id: "bcast-1" }),
    baseRow({
      id: 42,
      thread_id: "channel:shared",
      body: "channel body",
      delivery_kind: "channel",
      channel_id: "shared",
      channel_name: "shared",
      parent_message_id: 40,
      root_message_id: 39,
    }),
    baseRow({
      id: 43,
      thread_id: "kanban:WA-115",
      body: "WA-115 queued",
      delivery_kind: "kanban",
      kanban_notification_id: 430,
      kanban_task_id: 115,
      kanban_task_display_id: "WA-115",
      kanban_event_type: "status_queued",
    }),
  ]));

  expect(out).toStartWith("WHATSAGENT INBOX v2 nonce=a3f8c1\n3 message(s) for WhatsAgent:worker\nWARNING:");
  expect(out.match(/WARNING:/g)?.length).toBe(1);
  expect(out).toContain("--- 1 ---\nfrom: WhatsAgent:main\nto: WhatsAgent:worker\nsent: 2026-05-05T20:00:00.000Z\nid: 41\nbroadcast_id: bcast-1\n<<<UNTRUSTED-BODY-a3f8c1\nplain direct body\n>>>END-UNTRUSTED-a3f8c1\nactions: reply(toRole=from)");
  expect(out).toContain("--- 2 ---\nfrom: WhatsAgent:main\nsent: 2026-05-05T20:00:00.000Z\nid: 42\ndelivery: channel\nchannel: shared\nparent_message_id: 40\nroot_message_id: 39\n<<<UNTRUSTED-BODY-a3f8c1\nchannel body\n>>>END-UNTRUSTED-a3f8c1\nactions: post_channel | reply_channel_thread(messageId=42) | history(sinceId=42)");
  expect(out).toContain("--- 3 ---\nfrom: WhatsAgent:main\nto: WhatsAgent:worker\nsent: 2026-05-05T20:00:00.000Z\nid: 43\ndelivery: kanban\nkanban_event: status_queued\nkanban_task_id: WA-115\nkanban_notification_id: 430\n<<<UNTRUSTED-BODY-a3f8c1\nWA-115 queued\n>>>END-UNTRUSTED-a3f8c1\nactions: read(taskId=WA-115) | start(In Progress) | progress(comment)");
  expect(out).not.toContain("delivery: direct");
  expect(out).not.toContain("sent_at:");
  expect(out).not.toContain("\nmessage_id:");
  expect(out).not.toContain("char_count:");
  expect(out).not.toContain("word_count:");
  expect(out).toEndWith("\n");
});

test("default inbox instructions point agents at the v2 actions line", () => {
  expect(DEFAULT_INBOX_INSTRUCTIONS).toContain("listed actions");
  expect(DEFAULT_INBOX_INSTRUCTIONS).not.toContain("reply_action");
});

test("formatInboxEnvelope renders compact kanban action variants", () => {
  const rows = [
    baseRow({ id: 1, delivery_kind: "kanban", kanban_task_display_id: "WA-001", kanban_notification_id: 1, kanban_event_type: "assignment" }),
    baseRow({ id: 2, delivery_kind: "kanban", kanban_task_display_id: "WA-002", kanban_notification_id: 2, kanban_event_type: "blocker_comment" }),
    baseRow({ id: 3, delivery_kind: "kanban", kanban_epic_display_id: "EP-001", kanban_epic_notification_id: 3, kanban_event_type: "epic_assigned" }),
    baseRow({ id: 4, delivery_kind: "kanban", kanban_epic_display_id: "EP-002", kanban_epic_notification_id: 4, kanban_event_type: "epic_close_pending_approval" }),
    baseRow({ id: 5, delivery_kind: "kanban", kanban_epic_display_id: "EP-003", kanban_epic_notification_id: 5, kanban_event_type: "epic_status_in_progress" }),
  ];
  const out = withNonceSequence(["a3f8c1"], () => formatInboxEnvelope(rows));

  expect(out).toContain("actions: read(taskId=WA-001) | ack(comment) | wait_for_queued");
  expect(out).toContain("actions: read(taskId=WA-002) | progress | status(In Progress|Blocked|Review)");
  expect(out).toContain("actions: read(epicId=EP-001) | ack(comment)");
  expect(out).toContain("actions: read(epicId=EP-002) | note (close approval needs human-web)");
  expect(out).toContain("actions: read(epicId=EP-003) | progress | status(In Progress|Blocked|Review)");
  expect(out).toContain("kanban_epic_id: EP-001\nkanban_notification_id: 3");
  expect(out).not.toContain("kanban_epic_notification_id:");
});

test("formatInboxEnvelope normalizes untrusted body text before rendering inside markers", () => {
  const out = withNonceSequence(["a3f8c1"], () => formatInboxEnvelope([
    baseRow({ body: "red \u001b[31mtext\u001b[0m\u0000line\u2028next\u2029done" }),
  ]));

  expect(out).toContain("<<<UNTRUSTED-BODY-a3f8c1\nred textline\nnext\ndone\n>>>END-UNTRUSTED-a3f8c1");
  expect(out).not.toContain("\u001b[");
  expect(out).not.toContain("\u0000");
  expect(out).not.toContain("\u2028");
  expect(out).not.toContain("\u2029");
});

test("formatInboxEnvelope does not apply a redundant envelope-level length cap", () => {
  const body = "x".repeat(DEFAULT_MESSAGE_MAX_BODY_CHARS + 50);
  const out = withNonceSequence(["a3f8c1"], () => formatInboxEnvelope([baseRow({ body })]));

  expect(out).toContain(`<<<UNTRUSTED-BODY-a3f8c1\n${body}\n>>>END-UNTRUSTED-a3f8c1`);
  expect(out).not.toContain("[truncated]");
});

test("formatInboxEnvelope regenerates colliding nonce and reports non-fallback collision telemetry", () => {
  const collisions: Array<{ attempts: number; fallback: boolean }> = [];
  const out = withNonceSequence(["abcdef", "123456"], () => formatInboxEnvelope([
    baseRow({ body: "Body mentions ABCDEF so the first nonce collides." }),
  ], undefined, (info) => collisions.push(info)));

  expect(out).toStartWith("WHATSAGENT INBOX v2 nonce=123456");
  expect(out).toContain("<<<UNTRUSTED-BODY-123456");
  expect(collisions).toEqual([{ attempts: 1, fallback: false }]);
});

test("formatInboxEnvelope falls back to long nonce after three collisions and reports telemetry", () => {
  const collisions: Array<{ attempts: number; fallback: boolean }> = [];
  const out = withNonceSequence(["abcdef", "123456", "fedcba", "001122334455"], () => formatInboxEnvelope([
    baseRow({ body: "abcdef 123456 FEDCBA all collide before fallback" }),
  ], undefined, (info) => collisions.push(info)));

  expect(out).toStartWith("WHATSAGENT INBOX v2 nonce=001122334455");
  expect(out).toContain("<<<UNTRUSTED-BODY-001122334455");
  expect(collisions).toEqual([{ attempts: 3, fallback: true }]);
});

test("formatInboxEnvelope scans fallback nonces and retries colliding 12-hex candidates", () => {
  const collisions: Array<{ attempts: number; fallback: boolean }> = [];
  const out = withNonceSequence(["abcdef", "123456", "fedcba", "001122334455", "66778899aabb"], () => formatInboxEnvelope([
    baseRow({ body: "abcdef 123456 fedcba 001122334455 collide before clean fallback" }),
  ], undefined, (info) => collisions.push(info)));

  expect(out).toStartWith("WHATSAGENT INBOX v2 nonce=66778899aabb");
  expect(out).toContain("<<<UNTRUSTED-BODY-66778899aabb");
  expect(collisions).toEqual([{ attempts: 4, fallback: true }]);
});

test("formatInboxEnvelope throws when bounded nonce generation is exhausted", () => {
  expect(() => withNonceSequence(["abcdef", "123456", "fedcba", "001122334455", "66778899aabb", "ccddeeff0011"], () => formatInboxEnvelope([
    baseRow({ body: "abcdef 123456 fedcba 001122334455 66778899aabb ccddeeff0011" }),
  ]))).toThrow(/nonce exhaustion/);
});
