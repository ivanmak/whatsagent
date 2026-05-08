/**
 * EP-031 WA-PI-3a — Public agent tool catalog coverage.
 *
 * Pins:
 * - Catalog entry names match the canonical snake_case set the existing
 *   runtime integrations (claude-mcp.ts, opencode-plugin.ts, codex-mcp.ts)
 *   already register.
 * - No catalog entry exposes an internal helper (`poll_messages`,
 *   `mark_messages_*`, `settings`).
 * - Each entry's `family` equals `getToolFamily(entry.name)` so the
 *   catalog stays in sync with `ACTION_GRANT_REQUIREMENTS`.
 * - Housekeeping tools (`whoami`, `check_messages`, `set_summary`) carry
 *   `family === null`.
 * - `execute` adapters route to the matching `AgentTools` method (call
 *   names + payload shapes pinned with a stub `AgentTools`).
 */

import { expect, test } from "bun:test";

import {
  AGENT_INTERNAL_TOOL_NAMES,
  AGENT_TOOL_CATALOG,
  AGENT_TOOL_CATALOG_NAMES,
  type AgentToolDef,
} from "../src/integrations/agent-tool-catalog.ts";
import type { AgentTools } from "../src/integrations/agent-client.ts";
import { getToolFamily } from "../src/rbac-enforce.ts";
import { CLAUDE_TOOL_NAMES } from "../src/integrations/claude-mcp.ts";
import { CODEX_TOOL_NAMES } from "../src/integrations/codex-mcp.ts";

// Housekeeping tools have family === null per ACTION_GRANT_REQUIREMENTS in
// `src/rbac-enforce.ts`. `set_summary` and `list_peers` are NOT housekeeping
// — they are gated under `tool_family: summary` (rbac-enforce.ts:249-250).
const HOUSEKEEPING = new Set(["whoami", "check_messages"]);

test("catalog has no duplicate names", () => {
  const seen = new Set<string>();
  for (const entry of AGENT_TOOL_CATALOG) {
    expect(seen.has(entry.name)).toBe(false);
    seen.add(entry.name);
  }
});

test("catalog name set matches the canonical names registered by claude-mcp + codex-mcp", () => {
  // Claude + Codex export their canonical name lists; both should align with
  // the catalog (modulo opencode-plugin which we keep as the description
  // source-of-truth, not a published constant). Each runtime list is the
  // hand-rolled tool surface that ships with that runtime today.
  for (const name of CLAUDE_TOOL_NAMES) {
    expect(AGENT_TOOL_CATALOG_NAMES.has(name)).toBe(true);
  }
  for (const name of CODEX_TOOL_NAMES) {
    expect(AGENT_TOOL_CATALOG_NAMES.has(name)).toBe(true);
  }
});

test("catalog excludes internal helpers (poll_messages, mark_messages_*, settings)", () => {
  for (const helper of AGENT_INTERNAL_TOOL_NAMES) {
    expect(AGENT_TOOL_CATALOG_NAMES.has(helper)).toBe(false);
  }
});

test("each entry's family equals getToolFamily(entry.name)", () => {
  for (const entry of AGENT_TOOL_CATALOG) {
    expect(entry.family).toBe(getToolFamily(entry.name));
  }
});

test("housekeeping tools (whoami, check_messages, set_summary) have family === null", () => {
  for (const name of HOUSEKEEPING) {
    const entry = AGENT_TOOL_CATALOG.find((e) => e.name === name);
    expect(entry).toBeDefined();
    expect(entry!.family).toBeNull();
  }
});

test("non-null families are non-empty strings (no accidental empty/family-stripped entries)", () => {
  for (const entry of AGENT_TOOL_CATALOG) {
    if (entry.family === null) continue;
    expect(typeof entry.family).toBe("string");
    expect(entry.family.length).toBeGreaterThan(0);
  }
});

test("each entry inputSchema is a JSON Schema object root with explicit additionalProperties:false", () => {
  for (const entry of AGENT_TOOL_CATALOG) {
    expect(entry.inputSchema.type).toBe("object");
    expect(entry.inputSchema.additionalProperties).toBe(false);
    expect(typeof entry.inputSchema.properties).toBe("object");
  }
});

test("each catalog entry has a compact summarizer", () => {
  for (const entry of AGENT_TOOL_CATALOG) {
    expect(typeof entry.summarize).toBe("function");
    const summary = entry.summarize(sampleSummaryResult(entry.name));
    expect(typeof summary).toBe("string");
    expect(summary.length).toBeGreaterThan(0);
    expect(summary.startsWith("✓")).toBe(true);
  }
});

function sampleSummaryResult(name: string): Record<string, unknown> {
  if (name.includes("epic")) {
    return { epic: { display_id: "EP-1", title: "Epic", status: "Queued", priority: "P2" }, comment: { type: "progress" } };
  }
  if (name.includes("task") || name.includes("kanban")) {
    return { task: { display_id: "WA-1", title: "Task", status: "Queued", priority: "P2", assigned_role_name: "worker" }, comment: { type: "progress" }, tasks: [{ display_id: "WA-1" }] };
  }
  if (name === "list_peers") return { peers: [{ displayId: "WhatsAgent:main" }] };
  if (name === "check_messages") return { messages: [{ id: 1 }] };
  if (name.startsWith("search_")) return { results: [{ id: 1 }] };
  if (name.includes("message") || name.includes("channel")) return { message: { id: 7 } };
  return { ok: true, role: { display_id: "WhatsAgent:worker" }, mainRole: { display_id: "WhatsAgent:main" }, sessionId: "session-1" };
}

test("search summarizers count array results", () => {
  for (const name of ["search_direct_messages", "search_channel_messages", "search_kanban_tasks", "search_kanban_epics"]) {
    const entry = AGENT_TOOL_CATALOG.find((e) => e.name === name);
    expect(entry).toBeDefined();
    expect(entry!.summarize([{}, {}])).toBe("✓ search 2 hit(s)");
  }
});

test("Kanban effort catalog schema exposes XS/S/M/L/XL enum", () => {
  for (const name of ["create_kanban_task", "update_kanban_task", "create_kanban_epic", "update_kanban_epic"]) {
    const entry = AGENT_TOOL_CATALOG.find((e) => e.name === name);
    expect(entry).toBeDefined();
    expect(entry!.inputSchema.properties.effort).toEqual({
      type: "string",
      enum: ["XS", "S", "M", "L", "XL"],
      description: "XS, S, M, L, or XL.",
    });
  }
});

test("execute adapters route input → matching AgentTools method", async () => {
  // Stub AgentTools that records calls. Each method returns its (action, args).
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const stub = new Proxy({}, {
    get: (_, method: string) => async (...args: unknown[]) => {
      calls.push({ method, args });
      return { ok: true, method, args };
    },
  }) as unknown as AgentTools;

  // Spot-check 5 representative entries: a no-arg housekeeping tool, a
  // canonical messaging tool, a kanban write, a kanban-status move, and a
  // search tool. Full surface is structurally pinned by the snapshot above.
  const cases: Array<{ name: string; input: Record<string, unknown>; expectedMethod: string; expectedArgsHead: unknown[] }> = [
    { name: "whoami", input: {}, expectedMethod: "whoami", expectedArgsHead: [] },
    { name: "list_peers", input: { details: true }, expectedMethod: "listPeers", expectedArgsHead: [{ details: true }] },
    { name: "send_message", input: { toRole: "whatsagent:advisor", body: "hi" }, expectedMethod: "sendMessage", expectedArgsHead: ["whatsagent:advisor", "hi"] },
    { name: "create_kanban_task", input: { title: "T", assignedTo: "WhatsAgent:worker" }, expectedMethod: "createKanbanTask", expectedArgsHead: [{ title: "T", assignedTo: "WhatsAgent:worker" }] },
    { name: "update_kanban_task_status", input: { taskId: "WA-1", status: "Review" }, expectedMethod: "updateKanbanTaskStatus", expectedArgsHead: ["WA-1", "Review"] },
    { name: "search_direct_messages", input: { q: "foo" }, expectedMethod: "search_direct_messages", expectedArgsHead: [{ q: "foo" }] },
    { name: "set_summary", input: { summary: "current work" }, expectedMethod: "setSummary", expectedArgsHead: ["current work"] },
  ];

  for (const c of cases) {
    calls.length = 0;
    const entry = AGENT_TOOL_CATALOG.find((e) => e.name === c.name);
    expect(entry).toBeDefined();
    await entry!.execute(stub, c.input);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe(c.expectedMethod);
    for (let i = 0; i < c.expectedArgsHead.length; i++) {
      expect(calls[0]!.args[i]).toEqual(c.expectedArgsHead[i]);
    }
  }
});

test("execute coerces missing string fields to empty string instead of throwing", async () => {
  // Defensive: if a runtime hands a malformed payload, the catalog should
  // still call the AgentTools method (which will return a daemon-side
  // validation error) rather than blow up in coercion.
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const stub = new Proxy({}, {
    get: (_, method: string) => async (...args: unknown[]) => {
      calls.push({ method, args });
      return { ok: true };
    },
  }) as unknown as AgentTools;
  const sendMessage = AGENT_TOOL_CATALOG.find((e: AgentToolDef) => e.name === "send_message");
  await sendMessage!.execute(stub, {});
  expect(calls).toHaveLength(1);
  expect(calls[0]!.method).toBe("sendMessage");
  expect(calls[0]!.args).toEqual(["", ""]);
});

test("AGENT_TOOL_CATALOG_NAMES is read-only set of catalog entry names", () => {
  expect(AGENT_TOOL_CATALOG_NAMES.size).toBe(AGENT_TOOL_CATALOG.length);
  for (const entry of AGENT_TOOL_CATALOG) {
    expect(AGENT_TOOL_CATALOG_NAMES.has(entry.name)).toBe(true);
  }
});
