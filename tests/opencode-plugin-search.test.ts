import { describe, expect, test } from "bun:test";

import { createWhatsAgentOpenCodeHooks } from "../src/integrations/opencode-plugin.ts";

const launchEnv = {
  WHATSAGENT_ENABLED: "1",
  WHATSAGENT_FLEET_ROOT: "/project",
  WHATSAGENT_WORKSPACE_ID: "ws-search",
  WHATSAGENT_ROLE: "repo:alpha",
  WHATSAGENT_SESSION_ID: "session-search",
  WHATSAGENT_DAEMON_URL: "http://127.0.0.1:4017",
  WHATSAGENT_LAUNCH_TOKEN: "secret",
};

describe("WA-113 OpenCode search plugin tools", () => {
  test("registers search tools and routes execution to agent search APIs", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const hooks = await createWhatsAgentOpenCodeHooks(launchEnv, async (url, init) => {
      const href = String(url);
      if (href.endsWith("/api/v1/launch-token/validate")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (!href.endsWith("/api/v1/agent/whoami")) calls.push({ url: href, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
      return new Response(JSON.stringify({ ok: true, results: [{ id: calls.length, bodyPreview: "mouse" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    expect(Object.keys(hooks.tool ?? {})).toContain("search_direct_messages");
    expect(Object.keys(hooks.tool ?? {})).toContain("search_channel_messages");
    expect(Object.keys(hooks.tool ?? {})).toContain("search_kanban_tasks");
    expect(Object.keys(hooks.tool ?? {})).toContain("search_kanban_epics");
    if (!hooks.tool?.search_direct_messages || !hooks.tool.search_channel_messages || !hooks.tool.search_kanban_tasks || !hooks.tool.search_kanban_epics) throw new Error("OpenCode search tools were not registered");

    await expect(hooks.tool.search_direct_messages.execute({ q: "mouse", sender: "repo:beta", limit: 5 }, {} as never)).resolves.toContain("bodyPreview");
    await hooks.tool.search_channel_messages.execute({ q: "mouse", channel: "shared" }, {} as never);
    await hooks.tool.search_kanban_tasks.execute({ q: "mouse", status: "Review", includeArchived: true }, {} as never);
    await hooks.tool.search_kanban_epics.execute({ q: "mouse", assignee: "repo:beta" }, {} as never);

    expect(calls).toEqual([
      { url: "http://127.0.0.1:4017/api/v1/agent/search-direct-messages", body: { workspaceId: "ws-search", role: "repo:alpha", sessionId: "session-search", q: "mouse", sender: "repo:beta", limit: 5 } },
      { url: "http://127.0.0.1:4017/api/v1/agent/search-channel-messages", body: { workspaceId: "ws-search", role: "repo:alpha", sessionId: "session-search", q: "mouse", channel: "shared" } },
      { url: "http://127.0.0.1:4017/api/v1/agent/search-kanban-tasks", body: { workspaceId: "ws-search", role: "repo:alpha", sessionId: "session-search", q: "mouse", status: "Review", includeArchived: true } },
      { url: "http://127.0.0.1:4017/api/v1/agent/search-kanban-epics", body: { workspaceId: "ws-search", role: "repo:alpha", sessionId: "session-search", q: "mouse", assignee: "repo:beta" } },
    ]);
  });

  test("applies search tool visibility by family", async () => {
    const hooks = await createWhatsAgentOpenCodeHooks(launchEnv, async (url) => {
      const href = String(url);
      if (href.endsWith("/api/v1/launch-token/validate")) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      if (href.endsWith("/api/v1/agent/whoami")) {
        return new Response(JSON.stringify({ ok: true, grants: { tool_families: ["channel-read", "kanban-read"] }, rbac: { mode: "enforce" } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    expect(hooks.tool?.search_direct_messages).toBeUndefined();
    expect(hooks.tool?.search_channel_messages).toBeDefined();
    expect(hooks.tool?.search_kanban_tasks).toBeDefined();
    expect(hooks.tool?.search_kanban_epics).toBeDefined();
  });
});
