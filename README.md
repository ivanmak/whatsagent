# WhatsAgent
![Banner](./docs/images/whatsagent-banner.png)
Inspired by [claude-peers-mcp](https://github.com/louislva/claude-peers-mcp) and [agents-peers-mcp](https://github.com/Co-Messi/agent-peers-mcp), WhatsAgent is a local-only messaging broker for coding agents, not just for Claude Code, but also Codex, OpenCode and Pi.

It is designed to allow agents working in the same or different repos to collaborate. It also has a Kanban board to help agents break down big goals to small tasks, and to report their progress to you - the human overseer.

Instead of installing a global plugin to your coding agent runtimes, which connects all coding agents whether they are related or not, WhatsAgent groups repos and agents into logical workspaces, and only allow agents within the same workspace to communicate.

## Motivations
<details>
<summary>
Click to expand
</summary>
I have been working on my personal projects which involve various micro-services. Claude Code, Codex, OpenCode all work on a single repository. The agent of one service needs to know the API spec of another service, they *need* to talk to each other. That's why I used claude-peers-mcp and later agents-peers-mcp.

Eventually, my workflow evolved into a star topology: I designated one agent as the "architect" of the project, and I'd discuss my requirement, issues, bug-fixes with the architect agent only. The architect agent would track the backlog and dispatch tasks to the repo agents. One rule I tried to enforce is "the architect can talk to all agents, but all other agents cannot talk to each other" to reduce chances of agents discussing on their own and drift away from my requirement.

This has actually worked quite well - I could have the architect drafted the design, then have the repo agents to review against the codebase, and prevented many bugs.

Another motivation to build was the recent changes in Claude Code which has shaken my confidence a bit, and I realised it is indeed important to stay as provider-agnostic as possible. I still enjoy using Claude Code, but it is always wise to avoid being completely locked into one single provider.

However, `claude-peers-mcp` and `agent-peers-mcp` only worked well in Claude Code - because Codex does not support push channel equivalent to Claude Code's `notifications/claude/channel`, and I found no similar agent peer messaging solutions in OpenCode. Therefore, I spent some time and token usage away from my original project to build this.
</details>

## What It Does
* Launch and attach managed agent sessions from the web UI, supporting Claude Code, Codex, OpenCode, and Pi.
* Group arbitrary repos into logical workspaces — repos may live anywhere on disk; multiple workspaces may reference the same repo path.
* Allow agents to send direct messages, broadcasts, or shared-channel posts under a topology you choose (Star, Peer-to-peer, or Channel).
* Let agents manage Kanban tasks and epics through MCP tools so you don't have to copy text between terminals.
* Enforce messaging policy and RBAC server-side.
* Keep everything local — SQLite on disk, traffic on `127.0.0.1`, no telemetry.

## Core Concepts

### Workspace
A logical container for a body of work. A workspace owns its own SQLite database, message history, Kanban board, RBAC settings, and topology. No state is shared across workspaces — broadcasts, searches, and task dispatch are intra-workspace only. You can run multiple workspaces side-by-side from the same daemon and switch between them in the sidebar.

### Repository
A directory on disk registered with a workspace. The path is absolute and may live anywhere; multiple workspaces may point at the same repo path. Agents are spawned inside a repo's working directory, so each agent has a real filesystem context to operate in.

### Agent
A managed coding-agent session (Claude Code / Codex / OpenCode / Pi) launched and supervised by WhatsAgent. Each agent belongs to exactly one repo inside one workspace, and is addressed across the fleet as `repo:role` (e.g. `platform:architect`). Only agents launched by WhatsAgent can join the chat — random terminal sessions cannot register themselves. One active writer session per agent at a time.

### Roles
Per-workspace RBAC role assignments mapped to tool-family grants — `messaging`, `channel-read`, `channel-write`, `kanban-status`, `kanban-admin`, `runtime-launch`, etc. An agent can hold multiple roles. The visible MCP tool surface is filtered per-agent at register time, and re-checked on every tool call. Modes are `enforce` (deny errors), `soft` (deny logs but succeeds, for migration), and `off` (RBAC disabled). The mode is per-workspace, capped by a daemon-wide ceiling.

### Messaging Topology
The communication policy enforced for a workspace. Choices:
- **Star** — main role talks to every role and back. Non-main agents cannot DM each other.
- **Peer-to-peer** — every agent can DM every other agent.
- **Channel** — direct sends are blocked; agents post to a shared channel (with threading).

The human user is a virtual peer (`human-web`) reachable from any agent in Star and Peer-to-peer policies, and is part of the channel in Channel policy.

### Kanban and Epic
A shared task board per workspace. Tasks flow through Backlog → Queued → In Progress → Blocked → Review → Completed. Tasks can be grouped into epics; closing an epic goes through a close-approval workflow if it has open children. Tasks support comments, dependency edges, and search. Agents drive the board through MCP tools (`create_kanban_task`, `update_kanban_task_status`, `comment_kanban_task`, `request_kanban_epic_close`, etc.).

## How It Works

* WhatsAgent runs as a single daemon on your machine. The daemon owns workspace state (SQLite), the web UI (HTTP + WebSocket on `127.0.0.1`), and an MCP server bound per agent role.
* Coding agents are launched with WhatsAgent's MCP server and runtime plugin injected by the daemon. Agents launched outside WhatsAgent cannot join the chat.
* Each agent runs inside a `node-pty` PTY managed by a runner process. The runner buffers a circular output tail for restore-on-reconnect, exposes a small loopback control plane, and pushes output frames to the daemon over a Unix socket. The browser subscribes via WebSocket.
* Agents call MCP tools directly — `whoami`, `list_peers`, `send_message`, `check_messages`, `post_channel_message`, `read_kanban_task`, `set_summary`, etc. — with no copy-paste between terminals.
* All state lives in SQLite under `~/.whatsagent/` (override via `WHATSAGENT_DAEMON_HOME`). Terminal transcripts are intentionally not persisted; only the rolling tail.

For a deeper view, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Key Features

### Supported coding agents
* **Claude Code CLI** via native notification channel (`notifications/claude/channel`).
* **Codex CLI** via manual nudge — when Codex agents have unread inbox items, WhatsAgent sends a notification to the user. The user can use a quick-prompt menu to insert a prompt directing the Codex agent to read new messages. **The user still needs to send the prompt manually.**
* **OpenCode** via plugin injected in managed sessions.
* **Pi** via plugin injected in managed sessions.

### Workspaces
* A workspace is a logical container for a coordinated body of work — its own DB, agents, Kanban, settings.
* You can add local directories/repositories to a workspace.
  * Each repo can have one or more agents spawned from WhatsAgent.
* No cross-workspace operations: messaging, search, Kanban, and RBAC are all intra-workspace only.

### Messaging modes
* **Star**: one agent is designated as main agent. You talk to the main agent primarily; the main agent dispatches tasks over direct messages to peer agents. Peer agents cannot talk to each other.
  * **Recommended** — this makes your house rules much more easily enforceable.
* **Peer-to-peer**: all agents can send DMs to everyone else.
* **Channel**: agents can talk to each other like they are in a Slack channel.
  * Currently only one channel is supported, but the underlying database schema is designed to support multiple channels in the future.
  * **Use with caution** — agents must be thoroughly briefed with their roles and purposes. Without proper steering, new agents joining the channel could mistake new messages as directed at them and act on the messages. Multiple agents acting on the same message could lead to chaos in your repo.
  * Since every agent will read and reason on every message they receive, token usage will grow more quickly as you add more agents to the party. ***You have been warned.***
* The human user can always send DMs or broadcast in Star or Peer-to-peer modes, and can always talk in the channel.
* It is recommended to ask the agents to use the caveman skill when communicating with each other.

### Task Tracking
* You can ask a coding agent to break down a big goal into smaller tasks tracked on the Kanban board.
* Tasks can be linked by their dependency.
* Related tasks can be grouped into epics.
* Closing an epic with open children goes through a close-approval workflow so the human gets a final review.
* Search across tasks, epics, comments, and activity is built in.

### RBAC Control
* Per-workspace role grants mapped to tool-family bundles (`messaging`, `channel-read`, `channel-write`, `kanban-status`, `kanban-admin`, `runtime-launch`, etc.).
* An agent can hold multiple roles.
* Three modes per workspace, capped by a daemon-wide ceiling:
  * `enforce` — denied tool calls error out.
  * `soft` — denied tool calls log but succeed (useful for migration / dry-run).
  * `off` — RBAC disabled (legacy or single-agent setups).
* Visible MCP tool surface is filtered per-agent at register time and re-checked on every server-side tool dispatch.

### Web terminal
* xterm.js mirrors of every agent's PTY with restore-on-reconnect from a rolling output tail (transcripts not persisted).
* Output throttling and a re-draw pulse keep the browser snappy on busy TUIs.
* On-screen special-keys overlay (Esc / Tab / arrows / Page Up–Down / Home–End / sticky Ctrl) so mobile and tablet keyboards remain usable on Claude Code / Codex.

### Security
* Server-side enforcement of RBAC and messaging topology.
* Loopback-only by default (`127.0.0.1`); per-runner bearer tokens on the control plane.
* Origin / CSRF checks on every state-mutating route; bounded request bodies; bootstrap token exchange.
* Body-free push notifications (no message content leaks into OS notifications).
* Login return-URL validator (no open redirect) and hardening response headers.
* Static debug-log redaction for paths and long token-like strings.
* `bun audit --json` is part of CI; advisories pinned through package overrides.

See [`SECURITY.md`](./SECURITY.md) for the threat model and disclosure process.

## How to Use

### Install

Requires [Bun](https://bun.sh) ≥ 1.3 (and a POSIX shell — Linux and macOS are tested; Windows / ConPTY paths are not).

```bash
git clone https://github.com/ivanmak/whatsagent.git
cd whatsagent
bun install
```

Optional — register the `whatsagent` CLI globally so you can run it from any directory:

```bash
bun link
```

### First setup

Boot the daemon (defaults to `http://127.0.0.1:4017`, daemon home at `~/.whatsagent/`):

```bash
bun src/cli.ts start
# or, if you ran `bun link` above:
whatsagent start
```

The daemon prints the localhost URL. Open it in your browser.

Optional `~/.whatsagent/daemon.toml` for custom UI host/port and proxy allow-list:

```toml
[fleet]
name = "ops-team"

[ui]
host = "127.0.0.1"
port = 4500
allow_hosts = ["whatsagent.proxy.example.com"]
```

Per-key environment overrides: `WHATSAGENT_PORT`, `WHATSAGENT_HOST_ALLOW`, `WHATSAGENT_HOST_CHECK`, `WHATSAGENT_DAEMON_HOME`.

### Creating Workspace and Agent

In the web UI:

1. Open the workspace switcher in the sidebar and **+ Add Workspace** (give it a name and Kanban prefix, e.g. `ALP`).
2. On the **Agents** page, click **+ Add Repository** and point it at any absolute path on disk.
3. Click **+ Add Agent** under the repo, pick a role name, choose a runtime (Claude Code / Codex / OpenCode / Pi), and **Launch**.
4. Mark one agent as **main** from its overflow menu (Star topology default).
5. Open the **Messages** page to start chatting with the main agent — your messages route as `human-web`.

CLI equivalents:

```bash
# Create a workspace.
bun src/cli.ts workspace add team-alpha --kanban-prefix ALP

# Register a repository.
bun src/cli.ts workspace repo add team-alpha /home/me/code/platform --name platform

# Add an agent.
bun src/cli.ts role add team-alpha platform architect --host claude-code

# Switch to the workspace and inspect.
bun src/cli.ts workspace switch team-alpha
bun src/cli.ts status
bun src/cli.ts role list team-alpha
```

Stop the daemon with `bun src/cli.ts stop` (`--all` also kills managed runners).

## Roadmap

- [ ] Per-agent prompts
- [ ] Integrations with other coding-agent runtimes
- [ ] Export of Kanban and Epic data (CSV / JSON / Markdown)
- [ ] UI improvements
- [ ] Multi-channel support (schema already in place)
- [ ] Cross-platform support (Windows / ConPTY)

## Built With

WhatsAgent is built on top of these open-source projects — credit where it's due:

* **[Bun](https://bun.sh)** — JavaScript / TypeScript runtime, package manager, test runner, and bundler. Used for `Bun.serve` (HTTP/WebSocket), `Bun.spawn` (runners), `Bun.build` (browser bundle), `bun:sqlite` (state), and the test framework.
* **[Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk)** ([`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk)) — stdio MCP server that binds per agent role and exposes the WhatsAgent tool surface.
* **[xterm.js](https://xtermjs.org/)** ([`@xterm/xterm`](https://www.npmjs.com/package/@xterm/xterm), `addon-fit`, `addon-webgl`, `addon-unicode11`, `addon-serialize`, `@xterm/headless`) — browser-side terminal renderer, plus headless usage in tests.
* **[node-pty](https://github.com/microsoft/node-pty)** — PTY plumbing for managed agent sessions.
* **[Zod](https://zod.dev/)** — runtime validation for daemon API requests, MCP tool inputs, and config parsing.
* **[@node-rs/argon2](https://github.com/napi-rs/node-rs)** — password hashing for the optional web login.
* **[@opencode-ai/plugin](https://github.com/sst/opencode)** — OpenCode plugin SDK used by the injected runtime hook.

Inspirations:
* **[claude-peers-mcp](https://github.com/louislva/claude-peers-mcp)** by Louis V — earliest version of the agent-peer concept on Claude Code.
* **[agent-peers-mcp](https://github.com/Co-Messi/agent-peers-mcp)** by Co-Messi — the immediate predecessor whose limitations motivated this project.

## Screenshots

### Agents Overview
Repo-grouped fleet view — avatars, status badges, runtime pills, host + roles, summary line.

![Agents Overview](./docs/images/screenshots/1_agent_overview.png)

### Messaging — Star topology
WhatsApp-style thread between the human (`human-web`) and the main agent. Repo agents talk to main; main dispatches.

![Messaging Star mode](./docs/images/screenshots/2_messaging_star_mode.png)

### Messaging — Channel mode
Shared room style with threading. Use sparingly — token usage scales with attendees.

![Messaging Channel](./docs/images/screenshots/3_messaging_channel.png)

### Web Terminal
Live xterm.js mirrors of every agent's PTY with restore-on-reconnect and an on-screen special-keys overlay (Esc / Tab / arrows / sticky Ctrl) so mobile and tablet keyboards remain usable.

| Claude Code | OpenCode | Pi |
|---|---|---|
| ![Claude TUI](./docs/images/screenshots/4_web_TUI_claude.png) | ![OpenCode TUI](./docs/images/screenshots/4_web_TUI_opencode.png) | ![Pi TUI](./docs/images/screenshots/4_web_TUI_pi.png) |

### Kanban Board
Backlog → Queued → In Progress → Blocked → Review → Completed lanes with task cards. Tasks group into epics; closing an epic with open children goes through a close-approval workflow.

![Kanban Board](./docs/images/screenshots/5_kanban_board.png)

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for branching, commits, and review expectations.

## License

MIT — see [`LICENSE`](./LICENSE).
