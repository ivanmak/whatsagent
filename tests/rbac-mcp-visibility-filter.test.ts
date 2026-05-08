/**
 * EP-022 / WA-097 — register-time MCP tool visibility filter.
 *
 * The dispatcher gates execution at call time; this slice extends RBAC
 * to gate visibility at MCP server boot. Agents lacking a tool's
 * `tool_family` grant never see the tool in their MCP tool list, so
 * forbidden tools cannot be invoked + the model doesn't waste tokens
 * on tool-call attempts that would 403. `mode === "off"` short-circuits
 * to expose every tool (operator opted out of RBAC entirely).
 *
 * Coverage shape:
 *   - `getToolFamily` table: each MCP tool name maps to its expected
 *     family (or `null` for housekeeping tools that have no family
 *     requirement).
 *   - `shouldExposeTool` matrix: enforce/soft/off × representative
 *     role grants × sample tools.
 *   - `loadRbacBootSnapshot`: parses `whoami` reply happy path; falls
 *     back to permissive default on HTTP error / malformed JSON /
 *     network throw.
 *   - Static source check: each integration file imports
 *     `shouldExposeTool` and threads the snapshot through its
 *     `createXxxMcpServer` / hooks function.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getToolFamily, shouldExposeTool } from "../src/rbac-enforce.ts";
import { loadRbacBootSnapshot, PERMISSIVE_RBAC_BOOT_SNAPSHOT } from "../src/integrations/rbac-snapshot.ts";

const repoRoot = join(import.meta.dir, "..");

describe("getToolFamily — single-source-of-truth tool→family map", () => {
  // EP-022 / WA-097: derives from ACTION_GRANT_REQUIREMENTS so adding a
  // new gated tool there auto-flows here. Snake_case input matches the
  // MCP integration tool names; `getToolFamily` converts internally.
  const cases: Array<[string, string | null]> = [
    // Always-on housekeeping (advisor msg #419 ¶ resolution): whoami
    // and check_messages stay null because the boot snapshot + inbox
    // protocol depend on them universally.
    ["whoami", null],
    ["check_messages", null],

    // Summary family (advisor msg #419 fix): list_peers + set_summary
    // are gated on `tool_family:summary` so unticking the chip on the
    // Roles tab actually hides the tools.
    ["list_peers", "summary"],
    ["set_summary", "summary"],

    // Messaging (single-target).
    ["send_message", "messaging"],

    // Channel split (EP-022 / WA-093).
    ["read_channel_messages", "channel-read"],
    ["post_channel_message", "channel-write"],
    ["reply_channel_thread", "channel-write"],
    ["broadcast_message", "channel-write"],

    // Kanban families.
    ["list_kanban_tasks", "kanban-read"],
    ["read_kanban_task", "kanban-read"],
    ["list_kanban_epics", "kanban-read"],
    ["read_kanban_epic", "kanban-read"],
    ["comment_kanban_task", "kanban-comment"],
    ["comment_kanban_epic", "kanban-comment"],
    ["update_kanban_task_status", "kanban-status"],
    ["update_kanban_epic_status", "kanban-status"],
    ["request_kanban_epic_close", "kanban-status"],
    ["cancel_kanban_epic_close", "kanban-status"],
    ["create_kanban_task", "kanban-admin"],
    ["update_kanban_task", "kanban-admin"],
    ["archive_kanban_task", "kanban-admin"],
    ["create_kanban_epic", "kanban-admin"],
    ["update_kanban_epic", "kanban-admin"],
    ["archive_kanban_epic", "kanban-admin"],
  ];

  for (const [tool, expected] of cases) {
    test(`${tool} → ${expected ?? "null (housekeeping)"}`, () => {
      expect(getToolFamily(tool)).toBe(expected);
    });
  }
});

describe("shouldExposeTool — visibility decision per (tool, families, mode)", () => {
  const PM_FAMILIES = ["messaging", "channel-read", "channel-write", "summary", "kanban-read", "kanban-comment", "kanban-status", "kanban-admin"];
  const ENGINEER_FAMILIES = ["messaging", "channel-read", "channel-write", "summary", "kanban-read", "kanban-comment", "kanban-status"];
  const RESTRICTED_FAMILIES = ["summary", "kanban-read", "channel-read"];

  test("off mode short-circuits — every tool exposed regardless of families", () => {
    const empty: readonly string[] = [];
    for (const tool of ["create_kanban_task", "broadcast_message", "post_channel_message", "read_channel_messages"]) {
      expect(shouldExposeTool(tool, empty, "off")).toBe(true);
    }
  });

  test("always-on housekeeping (whoami + check_messages) exposed even with empty families", () => {
    // EP-022 / WA-097 (advisor msg #419): whoami + check_messages stay
    // unmapped in ACTION_GRANT_REQUIREMENTS so they always register —
    // boot snapshot fetch + inbox-delivery primitive depend on them.
    const empty: readonly string[] = [];
    for (const mode of ["enforce", "soft"] as const) {
      for (const tool of ["whoami", "check_messages"]) {
        expect(shouldExposeTool(tool, empty, mode)).toBe(true);
      }
    }
  });

  test("summary family gates list_peers + set_summary (advisor msg #419 fix)", () => {
    // Without `summary` in the agent's families, both tools are hidden.
    expect(shouldExposeTool("list_peers", [], "enforce")).toBe(false);
    expect(shouldExposeTool("set_summary", [], "enforce")).toBe(false);
    // With `summary`, both tools register.
    expect(shouldExposeTool("list_peers", ["summary"], "enforce")).toBe(true);
    expect(shouldExposeTool("set_summary", ["summary"], "enforce")).toBe(true);
  });

  test("pm sees every tool under enforce", () => {
    for (const tool of ["create_kanban_task", "broadcast_message", "post_channel_message", "read_channel_messages"]) {
      expect(shouldExposeTool(tool, PM_FAMILIES, "enforce")).toBe(true);
    }
  });

  test("engineer sees most tools but NOT kanban-admin under enforce", () => {
    expect(shouldExposeTool("update_kanban_task_status", ENGINEER_FAMILIES, "enforce")).toBe(true);
    expect(shouldExposeTool("post_channel_message", ENGINEER_FAMILIES, "enforce")).toBe(true);
    // Engineer lacks kanban-admin → these tools must NOT register.
    expect(shouldExposeTool("create_kanban_task", ENGINEER_FAMILIES, "enforce")).toBe(false);
    expect(shouldExposeTool("update_kanban_task", ENGINEER_FAMILIES, "enforce")).toBe(false);
    expect(shouldExposeTool("archive_kanban_task", ENGINEER_FAMILIES, "enforce")).toBe(false);
    expect(shouldExposeTool("create_kanban_epic", ENGINEER_FAMILIES, "enforce")).toBe(false);
  });

  test("restricted sees only summary + kanban-read + channel-read tools (channel split closes the skip-rule)", () => {
    // EP-022 / WA-093: restricted gained explicit `channel-read` family
    // so `read_channel_messages` is visible. Channel-write tools stay
    // hidden. Verifies the family split eliminates the special-case
    // skip the dispatcher used to carry.
    expect(shouldExposeTool("read_channel_messages", RESTRICTED_FAMILIES, "enforce")).toBe(true);
    expect(shouldExposeTool("post_channel_message", RESTRICTED_FAMILIES, "enforce")).toBe(false);
    expect(shouldExposeTool("reply_channel_thread", RESTRICTED_FAMILIES, "enforce")).toBe(false);
    expect(shouldExposeTool("broadcast_message", RESTRICTED_FAMILIES, "enforce")).toBe(false);
    expect(shouldExposeTool("list_kanban_tasks", RESTRICTED_FAMILIES, "enforce")).toBe(true);
    expect(shouldExposeTool("create_kanban_task", RESTRICTED_FAMILIES, "enforce")).toBe(false);
    expect(shouldExposeTool("send_message", RESTRICTED_FAMILIES, "enforce")).toBe(false);
  });

  test("soft mode obeys families just like enforce (visibility filter does not depend on enforce)", () => {
    // The visibility filter is the same shape regardless of soft vs
    // enforce; only `off` short-circuits. Soft mode is for operators
    // who want call-time misses logged but the visibility surface to
    // already match what enforce will see post-flip.
    expect(shouldExposeTool("create_kanban_task", ENGINEER_FAMILIES, "soft")).toBe(false);
    expect(shouldExposeTool("create_kanban_task", PM_FAMILIES, "soft")).toBe(true);
  });
});

describe("loadRbacBootSnapshot — happy path + failure modes", () => {
  const baseContext = {
    workspaceId: "ws-1",
    fleetRoot: "/tmp/x",
    role: "alpha",
    sessionId: "s-1",
    daemonUrl: "http://127.0.0.1:65535",
    launchToken: "tok",
  };

  test("parses whoami reply with grants + rbac.mode", async () => {
    const fetchImpl = async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
      return new Response(JSON.stringify({
        ok: true,
        grants: { tool_families: ["messaging", "kanban-read"] },
        rbac: { mode: "enforce" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const snapshot = await loadRbacBootSnapshot(baseContext, fetchImpl);
    expect(snapshot.toolFamilies).toEqual(["messaging", "kanban-read"]);
    expect(snapshot.mode).toBe("enforce");
  });

  test("falls back to permissive default on HTTP non-ok", async () => {
    const fetchImpl = async () => new Response("err", { status: 500 });
    const snapshot = await loadRbacBootSnapshot(baseContext, fetchImpl);
    expect(snapshot).toEqual(PERMISSIVE_RBAC_BOOT_SNAPSHOT);
  });

  test("falls back to permissive default on network throw", async () => {
    const fetchImpl = async (): Promise<Response> => { throw new Error("conn-refused"); };
    const snapshot = await loadRbacBootSnapshot(baseContext, fetchImpl);
    expect(snapshot).toEqual(PERMISSIVE_RBAC_BOOT_SNAPSHOT);
  });

  test("falls back to permissive default when ok=false", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ ok: false, error: "x" }), { status: 200 });
    const snapshot = await loadRbacBootSnapshot(baseContext, fetchImpl);
    expect(snapshot).toEqual(PERMISSIVE_RBAC_BOOT_SNAPSHOT);
  });

  test("normalizes missing tool_families to empty array", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ ok: true, grants: {}, rbac: { mode: "soft" } }), { status: 200 });
    const snapshot = await loadRbacBootSnapshot(baseContext, fetchImpl);
    expect(snapshot.toolFamilies).toEqual([]);
    expect(snapshot.mode).toBe("soft");
  });

  test("rejects bogus rbac.mode by defaulting to off", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ ok: true, grants: { tool_families: ["messaging"] }, rbac: { mode: "loud" } }), { status: 200 });
    const snapshot = await loadRbacBootSnapshot(baseContext, fetchImpl);
    expect(snapshot.toolFamilies).toEqual(["messaging"]);
    expect(snapshot.mode).toBe("off");
  });
});

describe("static source check — integration files use the visibility filter", () => {
  const FILES = [
    "src/integrations/claude-mcp.ts",
    "src/integrations/codex-mcp.ts",
    "src/integrations/opencode-plugin.ts",
  ];

  for (const f of FILES) {
    describe(f, () => {
      const source = readFileSync(join(repoRoot, f), "utf8");

      test("imports shouldExposeTool from rbac-enforce", () => {
        expect(source).toContain("shouldExposeTool");
        expect(source).toMatch(/from\s+"\.\.\/rbac-enforce\.ts"/);
      });

      test("threads RbacBootSnapshot through the create function", () => {
        // claude-mcp / codex-mcp accept the snapshot as a 4th arg;
        // opencode-plugin builds it via loadRbacBootSnapshot inside
        // createWhatsAgentOpenCodeHooks. Either pattern proves the
        // filter is wired.
        expect(source.includes("RbacBootSnapshot") || source.includes("loadRbacBootSnapshot")).toBe(true);
      });
    });
  }

  test("claude-mcp.ts wraps server.registerTool with the local register helper (boot-snapshot caveat)", () => {
    const source = readFileSync(join(repoRoot, "src/integrations/claude-mcp.ts"), "utf8");
    // The unconditional `server.registerTool(` shape from pre-EP-022
    // should be gone — only the wrapped `register(` shape remains for
    // gated tool registration. Two unrelated `server.registerTool`
    // references survive: the type-cast inside the local helper itself
    // and a comment paragraph. Both are intentional; the gated calls
    // must use the helper.
    const gatedRegistrations = source.match(/^\s+register\("[a-z_]+",/gm) ?? [];
    expect(gatedRegistrations.length).toBeGreaterThan(20);
  });

  test("codex-mcp.ts wraps server.registerTool with the local register helper", () => {
    const source = readFileSync(join(repoRoot, "src/integrations/codex-mcp.ts"), "utf8");
    const gatedRegistrations = source.match(/^\s+register\("[a-z_]+",/gm) ?? [];
    expect(gatedRegistrations.length).toBeGreaterThan(20);
  });

  test("opencode-plugin.ts filters its tool object via Object.fromEntries + expose predicate", () => {
    const source = readFileSync(join(repoRoot, "src/integrations/opencode-plugin.ts"), "utf8");
    expect(source).toContain("Object.fromEntries");
    expect(source).toContain("expose(name)");
    // The all-tools catalog still uses the snake_case `name: tool({...})`
    // shape so adding a tool stays grep-friendly.
    expect(source).toMatch(/whoami:\s*tool\(/);
    expect(source).toMatch(/create_kanban_task:\s*tool\(/);
  });
});
