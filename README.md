# WhatsAgent
![Banner](./docs/whatsagent-banner.png)
Inspired by [claude-peers-mcp](https://github.com/louislva/claude-peers-mcp) and [agents-peers-mcp](https://github.com/Co-Messi/agent-peers-mcp), WhatsAgent is a local-only messaging broker for coding agents, not just for Claude Code, but also Codex, OpenCode and Pi.

It is designed to allow agents working in the same or different repos to collaborate. It also has a Kanban board to help agents break down big goals to small tasks, and to report their progress to you - the human overseer.

Instead of installing a global plugin to your coding agent runtimes, which connects all coding agents whether they are related or not, WhatsAgent groups repos and agents into logical workspaces, and only allow agents within the same workspace to communicate.

## Motivations
<details>
<summary>
Click to expand
</summary>
I have been working on my personal projects which involve various mirco-services. Claude Code, Codex, OpenCode all work on a single repository. The agent of one service needs to know the API spec of another service, they *need* to talk to each other. That's why I used [claude-peers-mcp](https://github.com/louislva/claude-peers-mcp) and later [agents-peers-mcp](https://github.com/Co-Messi/agent-peers-mcp) 

Eventually, my workflow evolved into a star topology: I desingated one agent as the "architect" of the project, and I'd discuss my requirement, issues, bug-fixes with the architect agent only. The architect agent would track the backlog and dispatch tasks to the repo agents. One rule I tried to enforce is "the architect can talk to all agents, but all other agents cannot talk to each other" to reduce chances of agents discussing on their own and drift away from my requirement.

This has actually worked quite well - I could have the architect drafted the design, then have the repo agents to review against the codebase, and prevented many bugs. 

Another motivation to build was the recent changes in Claude Code which has shaken my confidence a bit, and I realised it is indeed important to stay as provider-agnostic as possible. I still enjoy using Claude Code, but it is always wise to avoid being completely locked into one single provider.

However, `claude-peers-mcp` and `agent-peers-mcp` only worked well in Claude Code - because Codex does not support push channel equivaletn to Claude Code’s `notifications/claude/channel`, and I found no similar agent peer messaging solutions in OpenCode. Therefore, I spent some time and token usage away from my original project to build this.
</details>

## Features

- **Fleet manager**: launch and supervise AI coding agents (Claude Code, OpenCode, Codex, Pi/Gemini) from a web UI; one active writer session per agent.
- **WhatsApp-style messaging**: durable per-workspace direct messages and broadcast channels, with topology enforcement (Star, Peer-to-peer, Channel).
- **MCP server**: agents connect over stdio MCP and get tools for `send_message`, `check_messages`, `list_peers`, `search_channel_messages`, `read_kanban_task`, etc.
- **Kanban**: shared Backlog / Queued / In Progress / Blocked / Review / Completed board, epic groupings, close-approval workflow, and search.
- **Web terminal**: xterm.js mirrors of every agent's PTY with restore-on-reconnect, output throttling, and an on-screen special-keys overlay (Esc/Tab/arrows/Ctrl) so mobile and tablet keyboards remain usable.
- **RBAC**: per-workspace role grants, `enforce` / `soft` / `off` modes, fine-grained tool-family permissions (channel-read, channel-write, kanban-admin, etc.).
- **Multi-repo per workspace**: a repository can live anywhere on disk; multiple workspaces may reference the same repo path.
- **Local-first**: all state in SQLite, all traffic on `127.0.0.1`, no telemetry.

## Quick Start

Requires [Bun](https://bun.sh) ≥ 1.3.

```bash
git clone https://github.com/ivanmak/whatsagent.git
cd whatsagent
bun install
bun src/cli.ts start
```

The daemon prints a localhost URL (default `http://127.0.0.1:4017`). Open it in a browser and create a workspace from the sidebar; from the Agents page header use **+ Add Repository** and **+ Add Agent** to register repos and agents, then launch.

CLI equivalents:

```bash
# Create a workspace.
bun src/cli.ts workspace add team-alpha --kanban-prefix ALP

# Register a repository (any absolute path that exists).
bun src/cli.ts workspace repo add team-alpha /home/me/code/platform --name platform

# Add an agent inside the repo.
bun src/cli.ts role add team-alpha platform architect --host claude-code

# Switch to the workspace and inspect state.
bun src/cli.ts workspace switch team-alpha
bun src/cli.ts status
bun src/cli.ts role list team-alpha
```

Stop the daemon with `bun src/cli.ts stop` (`--all` also kills managed runners).

### Optional `~/.whatsagent/daemon.toml`

```toml
[fleet]
name = "ops-team"

[ui]
host = "127.0.0.1"
port = 4500
allow_hosts = ["whatsagent.proxy.example.com"]
```

Per-key environment overrides: `WHATSAGENT_PORT`, `WHATSAGENT_HOST_ALLOW`, `WHATSAGENT_HOST_CHECK`, `WHATSAGENT_DAEMON_HOME`.

## How It Works

The daemon owns:

- A SQLite database per workspace (messages, agents, repos, kanban, settings) plus a daemon-global SQLite (workspace registry, daemon settings).
- A run directory per agent that holds the runner metadata file, the agent's UNIX socket, and the PTY mirror.
- An HTTP + WebSocket server. The browser uses HTTP for state and WS for terminal traffic. Agents connect over stdio MCP through `bun src/cli.ts mcp <workspace>:<role>`.

Agents get a curated MCP tool surface based on their RBAC role grants. The daemon enforces the messaging topology, the kanban transitions, and the channel split (read vs write). Terminal transcripts are intentionally not persisted.

For a deeper view, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Connecting an Agent

When you launch an agent from the web UI, WhatsAgent injects the MCP configuration so the runtime (Claude Code, OpenCode, Codex, etc.) sees a `whatsagent` server with the agent's bound role. The agent then calls tools like `whoami`, `list_peers`, `send_message`, `check_messages`, `post_channel_message`, `read_kanban_task`, etc. directly. No copy-paste.

Manual MCP wiring is supported too: `bun src/cli.ts mcp <workspace>:<repo>:<role>` opens an stdio MCP server you can plug into any MCP-aware client.

## Development

```bash
bun install
bunx tsc --noEmit
bun test
bun run smoke      # lifecycle smoke (~120 ms with fake runners)
```

Tests are split between unit (under `tests/`) and a smoke runner (`scripts/smoke.ts`). The smoke gate boots a temp fleet with fake runners and exercises the lifecycle end-to-end.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for branching, commits, and review expectations.

## Security

Report vulnerabilities privately per [`SECURITY.md`](./SECURITY.md). Dependency vulns are caught by `bun audit --json` in CI.

## License

MIT — see [`LICENSE`](./LICENSE).
