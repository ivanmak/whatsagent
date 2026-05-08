import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAgentTools } from "../src/integrations/agent-client.ts";
import { CLAUDE_TOOL_NAMES, createClaudeToolHandlers } from "../src/integrations/claude-mcp.ts";
import { requireLaunchContext } from "../src/integrations/launch-token.ts";

const launchEnv = {
  WHATSAGENT_ENABLED: "1",
  WHATSAGENT_FLEET_ROOT: "/project",
  WHATSAGENT_WORKSPACE_ID: "ws-search",
  WHATSAGENT_ROLE: "repo:alpha",
  WHATSAGENT_SESSION_ID: "session-search",
  WHATSAGENT_DAEMON_URL: "http://127.0.0.1:4017",
  WHATSAGENT_LAUNCH_TOKEN: "secret",
};

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeTempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "wa-search-mcp-"));
  tempDirs.push(dir);
  return dir;
}

describe("WA-112 MCP search registration", () => {
  test("agent client search methods post to daemon and unwrap results", async () => {
    makeTempHome();
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const tools = createAgentTools(requireLaunchContext(launchEnv), async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
      return new Response(JSON.stringify({ ok: true, results: [{ id: calls.length, bodyPreview: "mouse" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    await expect(tools.search_direct_messages({ q: "mouse", sender: "repo:beta", limit: 5 })).resolves.toEqual([{ id: 1, bodyPreview: "mouse" }]);
    await expect(tools.search_channel_messages({ q: "mouse", channel: "shared" })).resolves.toEqual([{ id: 2, bodyPreview: "mouse" }]);
    await expect(tools.search_kanban_tasks({ q: "mouse", status: "Review", includeArchived: true })).resolves.toEqual([{ id: 3, bodyPreview: "mouse" }]);
    await expect(tools.search_kanban_epics({ q: "mouse", assignee: "repo:beta" })).resolves.toEqual([{ id: 4, bodyPreview: "mouse" }]);

    expect(calls).toEqual([
      { url: "http://127.0.0.1:4017/api/v1/agent/search-direct-messages", body: { workspaceId: "ws-search", role: "repo:alpha", sessionId: "session-search", q: "mouse", sender: "repo:beta", limit: 5 } },
      { url: "http://127.0.0.1:4017/api/v1/agent/search-channel-messages", body: { workspaceId: "ws-search", role: "repo:alpha", sessionId: "session-search", q: "mouse", channel: "shared" } },
      { url: "http://127.0.0.1:4017/api/v1/agent/search-kanban-tasks", body: { workspaceId: "ws-search", role: "repo:alpha", sessionId: "session-search", q: "mouse", status: "Review", includeArchived: true } },
      { url: "http://127.0.0.1:4017/api/v1/agent/search-kanban-epics", body: { workspaceId: "ws-search", role: "repo:alpha", sessionId: "session-search", q: "mouse", assignee: "repo:beta" } },
    ]);
  });

  test("Claude handlers expose the four search tools", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const handlers = createClaudeToolHandlers(requireLaunchContext(launchEnv), async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
      return new Response(JSON.stringify({ ok: true, results: [{ id: calls.length }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    await expect(handlers.search_direct_messages({ q: "mouse", sender: "repo:beta" })).resolves.toEqual([{ id: 1 }]);
    await expect(handlers.search_channel_messages({ q: "mouse", channel: "shared" })).resolves.toEqual([{ id: 2 }]);
    await expect(handlers.search_kanban_tasks({ q: "mouse", status: "Queued" })).resolves.toEqual([{ id: 3 }]);
    await expect(handlers.search_kanban_epics({ q: "mouse", includeArchived: true })).resolves.toEqual([{ id: 4 }]);

    expect(calls.map((call) => call.url)).toEqual([
      "http://127.0.0.1:4017/api/v1/agent/search-direct-messages",
      "http://127.0.0.1:4017/api/v1/agent/search-channel-messages",
      "http://127.0.0.1:4017/api/v1/agent/search-kanban-tasks",
      "http://127.0.0.1:4017/api/v1/agent/search-kanban-epics",
    ]);
  });

  test("Claude MCP tool catalog and descriptions include distinct search tools", () => {
    expect(CLAUDE_TOOL_NAMES).toContain("search_direct_messages");
    expect(CLAUDE_TOOL_NAMES).toContain("search_channel_messages");
    expect(CLAUDE_TOOL_NAMES).toContain("search_kanban_tasks");
    expect(CLAUDE_TOOL_NAMES).toContain("search_kanban_epics");

    const source = readFileSync(join(import.meta.dir, "../src/integrations/claude-mcp.ts"), "utf8");
    for (const tool of ["search_direct_messages", "search_channel_messages", "search_kanban_tasks", "search_kanban_epics"]) {
      const match = source.match(new RegExp(`register\\("${tool}",\\s*\\{[^}]*?description:\\s*"([^"]+)"`, "s"));
      expect(match?.[1]).toBeTruthy();
      expect(match?.[1]).toContain("Search");
    }
    expect(source.match(/register\("search_direct_messages",/g)?.length).toBe(1);
    expect(source.match(/register\("search_channel_messages",/g)?.length).toBe(1);
    expect(source.match(/register\("search_kanban_tasks",/g)?.length).toBe(1);
    expect(source.match(/register\("search_kanban_epics",/g)?.length).toBe(1);
  });
});
