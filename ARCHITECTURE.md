# Architecture

WhatsAgent is one daemon process. Everything else — the web UI, the MCP server, the agent runners — runs as children, sockets, or buffered state owned by that daemon.

## Top-level shape

```
                ┌────────────────────────────────────┐
                │ Browser (xterm.js + SPA)           │
                │  HTTP + WebSocket on 127.0.0.1     │
                └────────────────────────────────────┘
                            │
                ┌──────────────────────────┐
                │ daemon (Bun)             │
                │  HTTP API, WS terminals  │
                │  RBAC, topology, kanban  │
                │  MCP server (stdio)      │
                └──────────────────────────┘
                  │                    │
        ┌─────────┴────────┐   ┌───────┴────────┐
        │ runner #1         │   │ runner #N      │
        │ node-pty + PTY    │   │ node-pty + PTY │
        │ Unix socket       │   │ Unix socket    │
        │ /redraw-pulse, …  │   │                │
        └───────────────────┘   └────────────────┘
                  │
        ┌─────────┴───────────┐
        │ Claude Code / Codex │
        │ / OpenCode / Pi     │
        │ (TUI inside PTY)    │
        └─────────────────────┘
```

The daemon home is `~/.whatsagent/` (override via `WHATSAGENT_DAEMON_HOME`). Inside it:

- `workspaces/<id>/` — per-workspace SQLite, run dir, logs.
- `workspaces/<id>/run/` — runner metadata (`<role>.runner.json`), Unix sockets (`<role>.sock`), pid files.
- `daemon.sqlite` — workspace registry + daemon-global settings.
- `logs/daemon.log`, `logs/xterm-debug.log`.

## State storage

Two SQLite layers:

- **Daemon-global** (`~/.whatsagent/daemon.sqlite`): workspaces, daemon settings (UI port, allow-list, redraw workaround toggle, agent text), notifications.
- **Per-workspace** (`workspaces/<id>/state.sqlite`): repos, agents, messages, channel posts, kanban epics/tasks/comments/activity, role grants, runtime overrides.

Schema migrations live in `src/daemon-db.ts` (daemon-global) and `src/db.ts` (per-workspace). Migration runner is forward-only with explicit version pins; alpha-break migrations clear data when topology changes.

## Communication topology

A workspace has a topology setting:

- **Star** (default): main agent ↔ every other agent. Agent-to-agent (non-main) is blocked. `human-web` is a virtual peer reachable from any agent.
- **Peer-to-peer**: any agent ↔ any agent. `human-web` still virtual.
- **Channel**: shared room. Direct sends are rejected; everything goes through `post_channel_message` and `reply_channel_thread`.

Topology is enforced server-side. Agents see the same envelope contract regardless: a trusted `from`/`to` header above a sandboxed body — body claims do not bind behavior.

## RBAC

Each agent has zero or more role grants per workspace. Grants are tool-family bundles: `messaging`, `channel-read`, `channel-write`, `kanban-status`, `kanban-admin`, `runtime-launch`, etc. Modes:

- `enforce` — denied tool calls error.
- `soft` — denied tool calls log + succeed (for migration).
- `off` — RBAC disabled (legacy / single-agent setups).

Mode is per-workspace, capped by a daemon-wide ceiling that can be set via the `whatsagent start --rbac-mode=…` CLI flag. Grants are evaluated at MCP register time (the visible tool surface is filtered per agent), and re-checked at every server-side tool dispatch.

## Terminal mirroring

Each agent runs inside a `node-pty` PTY managed by a runner process (`src/runner/node-pty-runner.mjs`). The runner:

- Owns the PTY and the child process (Claude Code / Codex / OpenCode / Pi).
- Buffers a circular output tail for restore on reconnect.
- Exposes a small loopback HTTP control plane (resize, write, redraw-pulse, kill).
- Pushes output frames to the daemon over its Unix socket; daemon multicasts to subscribed browser WebSockets.

The browser uses xterm.js. On reconnect, the daemon replays the tail; xterm rehydrates without re-running the TUI. Terminal transcripts are deliberately not persisted — only the rolling tail.

## MCP server

The daemon hosts an MCP server reachable two ways:

- **Embedded launch**: when WhatsAgent launches an agent runtime, it injects the MCP server config so the runtime sees a `whatsagent` server bound to that agent's role.
- **Stdio CLI**: `bun src/cli.ts mcp <workspace>:<repo>:<role>` opens an stdio MCP server that any MCP-aware client can connect to.

The exposed tools mirror the daemon's HTTP API (`whoami`, `list_peers`, `send_message`, `check_messages`, `read_channel_messages`, `post_channel_message`, `reply_channel_thread`, `read_kanban_task`, `list_kanban_tasks`, `comment_kanban_task`, `update_kanban_task_status`, `request_kanban_epic_close`, `set_summary`, `search_*`, etc.). The visible set is RBAC-filtered at registration time per agent.

## Web UI

The browser SPA is bundled at daemon startup via `Bun.build` and inlined into the HTML shell (`src/web/shell.ts`). All client modules live under `src/web/client/`. Hot reload is not part of v0.1.0 — daemon restart is the dev loop. The shell-level CSS overrides live in `src/web/shell-overrides.ts` as a single `String.raw` template.

## Key invariants

- Workspace IDs are stable strings; references between SQLite layers use them.
- Repo paths are absolute and may live anywhere on disk.
- Agent display IDs are `repo:role`; the daemon never falls back to bare names for routing.
- One active writer session per agent. Re-launch evicts the previous writer.
- Cross-workspace operations are never allowed (no broadcast across workspaces, no cross-workspace search, no shared kanban).
- Runners are per-agent; the daemon does not multiplex one runner across agents.

## Where to look in the code

- `src/cli.ts` — CLI entrypoint and subcommands.
- `src/server/daemon.ts` — HTTP/WebSocket router, lifecycle, MCP server wiring, runner proxy.
- `src/db.ts` / `src/daemon-db.ts` — schemas + migrations.
- `src/runner/launcher.ts` / `src/runner/process.ts` / `src/runner/node-pty-runner.mjs` — runner lifecycle and PTY plumbing.
- `src/integrations/agent-client.ts` — daemon-side client used by the MCP server.
- `src/integrations/rbac-snapshot.ts` — RBAC evaluation surface.
- `src/web/shell.ts` / `src/web/client/main.ts` — browser shell + SPA entry.
- `tests/` — unit tests (Bun test runner). `scripts/smoke.ts` — lifecycle smoke gate.
