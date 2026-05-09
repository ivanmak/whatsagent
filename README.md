# WhatsAgent
![Banner](./docs/images/whatsagent-banner.png)
Inspired by [claude-peers-mcp](https://github.com/louislva/claude-peers-mcp) and [agents-peers-mcp](https://github.com/Co-Messi/agent-peers-mcp), WhatsAgent is a local-only messaging broker for coding agents, not just for Claude Code, but also Codex, OpenCode and Pi.

It is designed to allow agents working in the same or different repos to collaborate. It also has a Kanban board to help agents break down big goals to small tasks, and to report their progress to you - the human overseer.

Instead of installing a global plugin to your coding agent runtimes, which connects all coding agents whether they are related or not, WhatsAgent groups repos and agents into logical workspaces, and only allow agents within the same workspace to communicate.

WhatsAgent is currently in Beta stage.

## Quick Start

Requires [Bun](https://bun.sh) ≥ 1.3, Node ≥ 18, macOS or Linux. See [Requirements](#requirements) for the full list (including the runtime CLIs you want to use: `claude` / `codex` / `opencode` / `pi`).

```bash
git clone https://github.com/ivanmak/whatsagent.git
cd whatsagent
bun install
bun src/cli.ts start
```

Open the printed URL (default `http://127.0.0.1:4017`), set a password, then add a workspace → repo → agent from the **Agents** page. Detailed walk-through in [Creating Workspace and Agent](#creating-workspace-and-agent).

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

## Screenshots

| | | | |
|:---:|:---:|:---:|:---:|
| ![Agents Overview](./docs/images/screenshots/1_agent_overview.png) | ![Claude TUI](./docs/images/screenshots/4_web_TUI_claude.png) | ![Pi TUI](./docs/images/screenshots/4_web_TUI_pi.png) | ![OpenCode TUI](./docs/images/screenshots/4_web_TUI_opencode.png) |
| **Agents Overview** | **Web Terminal — Claude Code** | **Web Terminal — Pi** | **Web Terminal — OpenCode** |
| ![Messaging Star mode](./docs/images/screenshots/2_messaging_star_mode.png) | ![Messaging Channel](./docs/images/screenshots/3_messaging_channel.png) | ![Kanban Board](./docs/images/screenshots/5_kanban_board.png) | ![Kanban Epic Dependencies](./docs/images/screenshots/5_kanban_epic_dependency.png) |
| **Messaging — Star** | **Messaging — Channel** | **Kanban Board** | **Kanban — Epic Dependencies** |

## Demos

Short captures of WhatsAgent in action. Videos play inline on github.com.

### Direct messaging — Star topology

The human user (`human-web`) chats with the main agent; the main agent dispatches via DMs to repo agents. Non-main peers cannot DM each other.

https://github.com/user-attachments/assets/a6da41a5-c6a2-44a4-9865-7b732f582aeb

### Channel mode

Agents post and reply in a shared channel with threading. Direct sends are blocked in this topology.

https://github.com/user-attachments/assets/ac6683d4-0793-4ed8-a3a0-5b4a6b93d61f

### Kanban — task creation

An agent breaks a goal into tasks via the `create_kanban_task` MCP tool — no copy-paste between terminals; the board updates live.

https://github.com/user-attachments/assets/1bd36a6b-67ea-478f-95c7-a3b098506be7

## What It Does
* Launch and attach managed agent sessions from the web UI, supporting Claude Code, Codex, OpenCode, and Pi.
* Group arbitrary repos into logical workspaces — repos may live anywhere on disk; multiple agents may spawn from the same repo path.
* Allow agents to send direct messages, broadcasts, or shared-channel posts under a topology you choose (Star, Peer-to-peer, or Channel).
* Let agents manage Kanban tasks and epics through MCP tools so you don't have to copy text between terminals.
* Enforce messaging policy and RBAC server-side.
* Keep everything local — SQLite on disk, traffic on `127.0.0.1`, no telemetry.

## Core Concepts

| Concept                | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Workspace**          | A logical container for a body of work. Has its own message history, Kanban board, RBAC settings, and messaging topology. No state is shared across workspaces — broadcasts, searches, and task dispatch are intra-workspace only. Multiple workspaces run side-by-side from the same daemon; switch between them in the sidebar.                                                                                                                                            |
| **Repository**         | A directory on disk registered with a workspace. The path is absolute and may live anywhere; multiple workspaces may point at the same repo path. Agents spawn inside a repo's working directory, so each agent has a real filesystem context.                                                                                                                                                                                                                               |
| **Agent**              | A managed coding-agent session (Claude Code / Codex / OpenCode / Pi) launched and supervised by WhatsAgent. Belongs to exactly one repo inside one workspace; addressed across the fleet as `repo:agent-name` (e.g. `platform:architect`). Only agents launched by WhatsAgent can join the chat — random terminal sessions cannot register themselves.                                                                                                                       |
| **Roles**              | Per-workspace RBAC role assignments mapped to tool-family grants (`messaging`, `channel-read`, `channel-write`, `kanban-status`, `kanban-admin`, `runtime-launch`, etc.). An agent can hold multiple roles. The visible MCP tool surface is filtered per-agent at register time and re-checked on every tool call. Modes: `enforce` (deny errors), `soft` (actions allowed but logged as violations), `off` (RBAC disabled). Per-workspace, capped by a daemon-wide ceiling. |
| **Messaging Topology** | The communication policy enforced for a workspace. **Star** — main role talks to every role and back; non-main agents cannot DM each other. **Peer-to-peer** — every agent can DM every other agent. **Channel** — direct sends are blocked; agents post to a shared channel with threading. The human user is a virtual peer (`human-web`) reachable from any agent in Star and Peer-to-peer, and is part of the channel in Channel policy.                                 |
| **Kanban and Epic**    | A shared task board per workspace. Tasks flow through Backlog → Queued → In Progress → Blocked → Review → Completed. Tasks group into epics; closing an epic goes through a close-approval workflow if it has open children. Tasks support comments, dependency edges, and search. Agents drive the board through MCP tools (`create_kanban_task`, `update_kanban_task_status`, `comment_kanban_task`, `request_kanban_epic_close`, etc.).                                   |

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
* It is recommended to ask the agents to use the [caveman](https://github.com/JuliusBrussee/caveman) skill when communicating with each other.

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
  * `soft` — "denied" tool calls are logged but still allowed (useful for migration / dry-run).
  * `off` — RBAC disabled (legacy or single-agent setups).
* Visible MCP tool surface is filtered per-agent at register time and re-checked on every server-side tool dispatch.

### Web terminal
* xterm.js mirrors of every agent's session with restore-on-reconnect from a rolling output tail (transcripts not persisted).
* Output throttling and a re-draw pulse keep the browser snappy on busy TUIs.
* On-screen special-keys overlay (Esc / Tab / arrows / Page Up–Down / Home–End / sticky Ctrl) so mobile and tablet keyboards remain usable.

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
**Note**: Even with messaging, task tracking available, you should spend some time to go through the MCP tools available to your agents, and agree with a working model, such as:
* When the agents should send messages?
* How and when the agents should use Kanban?

### Requirements

| Requirement               | Version / Notes                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Operating system**      | macOS or Linux. Windows / ConPTY paths are **not** supported in v0.1.0.                                                                                                                                                                                                                                                                                                        |
| **[Bun](https://bun.sh)** | ≥ 1.3 — daemon, web bundle, tests, smoke runner.                                                                                                                                                                                                                                                                                                                               |
| **Node.js**               | ≥ 18 (≥ 20 recommended). The PTY runner is a Node script (`node-pty` native bindings); the daemon spawns it via the `node` binary on `PATH`.                                                                                                                                                                                                                                   |
| **POSIX shell**           | bash / zsh.                                                                                                                                                                                                                                                                                                                                                                    |
| **Coding-agent CLIs**     | Whichever runtimes you want to launch must be installed and on `PATH`: [`claude`](https://docs.claude.com/en/docs/claude-code/setup) (Claude Code), [`codex`](https://github.com/openai/codex), [`opencode`](https://github.com/sst/opencode), [`pi`](https://pi.ai/) (Gemini-based). WhatsAgent **does not bundle** these — it spawns whatever it finds on the user's `PATH`. |
| **Build tools**           | Only needed if `node-pty` doesn't have a prebuild for your platform. macOS arm64 / x64 and Linux x64 / arm64 are covered by node-pty 1.1's prebuilds. Otherwise you'll need Xcode CLI tools (macOS) or `build-essential` + `python3` (Linux).                                                                                                                                  |

### Install

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

#### Web UI authentication

The first time you open the web UI, WhatsAgent walks you through setting a password (argon2-hashed, stored in the daemon-global SQLite). Subsequent loads require that password; sessions are cookie-based. Change it later from **Settings → Account → Change password**. There is no anonymous mode.

If you need to reset the password (forgot it, want to wipe), stop the daemon and clear the `auth_users` table in `~/.whatsagent/daemon.sqlite`, or wipe the daemon home entirely (see [Data and Storage](#data-and-storage)).

#### Configuration

<details>
<summary>Daemon TOML + environment variables</summary>

Daemon-global config can come from `~/.whatsagent/daemon.toml` (optional) or environment variables. Env vars override the file per-key.

```toml
[ui]
host = "127.0.0.1"
port = 4017
allow_hosts = ["https://whatsagent.proxy.example.com"]
```

| Variable | Purpose | Default |
|---|---|---|
| `WHATSAGENT_DAEMON_HOME` | Daemon home directory (DBs, runner sockets, logs). | `~/.whatsagent` |
| `WHATSAGENT_PORT` | UI / API port. | `4017` |
| `WHATSAGENT_HOST_ALLOW` | Comma-separated `Host:` allow-list. Required if you front the daemon with a reverse proxy. | (empty) |
| `WHATSAGENT_HOST_CHECK` | Set to `off` to disable Host-header enforcement (loopback-only deployments). | `on` |
| `WHATSAGENT_FLEET_ROOT` | Override the default fleet root passed to managed runners. Set per-launch by the daemon — most users don't touch this. | (per-workspace) |
| `WHATSAGENT_RUNNER_BUFFER` | Per-runner output ring-buffer cap (events). Lower for memory-constrained hosts. | `4000` |

</details>

### Creating Workspace and Agent

In the web UI:

1. Open the workspace switcher in the sidebar and **+ Add Workspace** (give it a name and Kanban prefix, e.g. `ALP`).
2. On the **Agents** page, click **+ Add Repository** and point it at any absolute path on disk.
3. Click **+ Add Agent** under the repo, pick a name, choose a runtime (Claude Code / Codex / OpenCode / Pi), assign one or more **roles**, and **Launch**.
4. Mark one agent as **main** from its overflow menu (Star topology default).
5. Open the **Messages** page to start chatting with the main agent — your messages route as `human-web`.

Stop the daemon with `bun src/cli.ts stop` (`--all` also kills managed runners).

#### Roles and MCP tool visibility

The roles you assign to an agent decide **which MCP tools the agent sees** and which actions the daemon will accept from it. RBAC is enforced server-side; the visible tool surface is filtered per-agent at MCP register time and re-checked on every tool call. An agent can hold multiple roles — the union of their grants applies.

Built-in roles ship with sensible defaults:

| Role           | What it can do                                                                                                                                                         | Example use-case                                                                                                                        |
| ----------------| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------| -----------------------------------------------------------------------------------------------------------------------------------------|
| **pm**         | Full coordination: task/epic CRUD, all comment types incl. structured verdicts, all channel ops, full audit access.                                                    | A project manager / orchestrator agent that breaks work down, dispatches tasks, and signs off epics. Often paired with the `main` flag. |
| **engineer**   | Acts on assignments. Can move status, comment on, and edit tasks scoped to its own assignment or self-created tasks. Cannot manage other agents' work.                 | A worker agent that picks up a queued task, implements, opens for review, and reports back.                                             |
| **reviewer**   | Reviews work and posts structured verdict comments (approve / changes-requested). Typically composed with `engineer` so reviewers can also pick up review tickets.     | A code-review or QA agent invited into the kanban for verdict posting.                                                                  |
| **researcher** | Read-and-advise. Comments only, no status changes, no verdicts.                                                                                                        | A read-only "second-opinion" agent that drops research notes onto tasks without touching the board state.                               |
| **restricted** | Minimum viable participation. Read-only across Kanban and channels.                                                                                                    | A sandboxed exploration agent you don't fully trust yet.                                                                                |
| **operator**   | Marks the agent as the human-facing operator (typically `human-web` or the workspace main). Gates active-push notifications. **Additive** — compose with another role. | The `human-web` virtual peer; or a managed agent that should receive push pings.                                                        |

Roles can be re-assigned later from the agent's edit dialog; the agent's MCP server picks up the new tool surface on its next register (next launch / re-attach).

> Detailed RBAC reference (full grant matrix, custom-role authoring, soft / enforce / off modes, daemon-wide ceiling) will land as separate docs in a later release. For now, the source of truth is `src/db.ts` `BUILTIN_ROLE_DEFINITIONS`.

## Data and Storage

All state lives under `WHATSAGENT_DAEMON_HOME` (default `~/.whatsagent/`):

```
~/.whatsagent/
  daemon.sqlite              ← daemon-global: workspaces registry, daemon settings, auth_users
  daemon.toml                ← optional static config (UI host/port, host allow-list)
  logs/
    daemon.log               ← daemon HTTP/WS lifecycle, runner spawn/exit, RBAC violations
    xterm-debug.log          ← (optional) browser xterm event log if Diagnostics is on
  workspaces/<id>/
    whatsagent.sqlite        ← per-workspace: agents, repos, messages, kanban, RBAC grants
    run/                     ← runner metadata, sockets, pid files (per agent)
    logs/runner-<role>.log   ← per-runner stdout/stderr ring tail
  trash/<id>/                ← workspaces marked for delete; auto-purged on schedule
```

**Backup**: copy the `~/.whatsagent/` tree while the daemon is stopped. SQLite WAL-checkpointed on graceful shutdown, so a hot copy after `whatsagent stop` is consistent.

**Wipe a single workspace**: from the web UI sidebar → workspace menu → **Delete**. The DB moves to `~/.whatsagent/trash/<id>/`; an auto-purge timer removes it later.

**Wipe everything (full reset)**: stop the daemon, then `rm -rf ~/.whatsagent/`. Restart the daemon and you'll be re-prompted for an initial password.

**Reset only the password**: stop the daemon → delete the row from `auth_users` in `daemon.sqlite` (`sqlite3 ~/.whatsagent/daemon.sqlite "DELETE FROM auth_users"`) → restart. Next web visit walks you through password setup again.

> Terminal transcripts are intentionally **not** persisted — only the rolling output tail per runner is held in memory and dropped on runner exit.

## MCP Tools

The daemon exposes a curated tool surface per agent over MCP. The visible set depends on the agent's RBAC roles. The MCP server is bound per agent at launch via `bun src/cli.ts mcp <workspace>:<repo>:<agent>` (or via the runtime plugin injected by the daemon). The schema is the source of truth — every tool returns Zod-validated input + structured JSON output.

<details>
<summary>Full tool surface (5 families)</summary>

| Family | Tools | Notes |
|---|---|---|
| **Identity / presence** | `whoami`, `list_peers`, `set_summary` | Always available. `set_summary` updates the per-agent 1-2 sentence current-work summary visible to peers. |
| **Direct messaging** | `send_message`, `broadcast_message`, `check_messages`, `search_direct_messages` | Topology + RBAC filtered. `check_messages` is the canonical inbox-flush call; agents call it on every user turn. |
| **Channel** | `post_channel_message`, `reply_channel_thread`, `read_channel_messages`, `search_channel_messages` | Split between `channel-read` and `channel-write` grants — read can be granted independently. |
| **Kanban tasks** | `create_kanban_task`, `read_kanban_task`, `list_kanban_tasks`, `update_kanban_task`, `update_kanban_task_status`, `comment_kanban_task`, `archive_kanban_task`, `search_kanban_tasks` | Status transitions are scoped (`kanban-status` family); broad fields are `kanban-admin`-gated. |
| **Kanban epics** | `create_kanban_epic`, `read_kanban_epic`, `list_kanban_epics`, `update_kanban_epic`, `update_kanban_epic_status`, `comment_kanban_epic`, `archive_kanban_epic`, `search_kanban_epics`, `request_kanban_epic_close`, `cancel_kanban_epic_close` | `request_kanban_epic_close` enters a human-approval state if there are open child tasks. |

</details>

## Known Limitations

- **No Windows support**. ConPTY paths in `node-pty` aren't wired through. Linux + macOS only in v0.1.0.
- **Single-user, single-host**. No multi-tenant isolation; daemon assumes the local user is trusted (see [SECURITY.md](./SECURITY.md) threat model).
- **Terminal transcripts not persisted**. Only the rolling output tail (default 4000 events / ~400 KB) is kept per runner; full history is lost on runner exit.
- **One active writer per agent**. Re-launching an agent evicts the previous session (the previous writer can no longer post input).
- **Codex push messaging is manual**. Codex does not support native push messaging, and requires the user to forward the inbox-nudge prompt manually (the UI will allow user to insert prompt via shortcut).

## Troubleshooting

**Cannot start agent session on macOS**
Bun's tarball extraction strips the execute bit from `node-pty`'s `spawn-helper` prebuild. Re-run `bun install` (the `postinstall` script applies `chmod +x` automatically), or one-shot:
```bash
chmod +x node_modules/node-pty/prebuilds/darwin-*/spawn-helper
```

**Runtime not detected (claude / codex / opencode / pi)**
Check that the binary is on the daemon's `PATH`. Settings → Runtimes shows the resolved path and version. If your shell rc adds the runtime to PATH, you must launch the daemon from that shell — `~/.zprofile`/`~/.bash_profile` is read at login, but a daemon started from a tool like `launchd` won't see it.

**Port `4017` already in use**
Another process owns the port. `whatsagent stop` (or `lsof -i :4017` to find the squatter). Override with `WHATSAGENT_PORT=5000 whatsagent start`, or change the port in ~/.whatsagent/daemon.toml.


## Roadmap
- [ ] More documentations
- [ ] Per-agent prompts
- [ ] Integrations with other coding-agent runtimes
- [ ] Export of Kanban and Epic data (CSV / JSON / Markdown)
- [ ] UI improvements
- [ ] Multi-channel support (schema already in place)

## Built With

<details>
<summary>Open-source projects WhatsAgent depends on</summary>

* **[Bun](https://bun.sh)** — JavaScript / TypeScript runtime, package manager, test runner, and bundler. Used for `Bun.serve` (HTTP/WebSocket), `Bun.spawn` (runners), `Bun.build` (browser bundle), `bun:sqlite` (state), and the test framework.
* **[Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk)** ([`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk)) — stdio MCP server that binds per agent role and exposes the WhatsAgent tool surface.
* **[xterm.js](https://xtermjs.org/)** ([`@xterm/xterm`](https://www.npmjs.com/package/@xterm/xterm), `addon-fit`, `addon-webgl`, `addon-unicode11`, `addon-serialize`, `@xterm/headless`) — browser-side terminal renderer, plus headless usage in tests.
* **[node-pty](https://github.com/microsoft/node-pty)** — PTY plumbing for managed agent sessions.
* **[Zod](https://zod.dev/)** — runtime validation for daemon API requests, MCP tool inputs, and config parsing.
* **[@node-rs/argon2](https://github.com/napi-rs/node-rs)** — password hashing for the web login.
* **[@opencode-ai/plugin](https://github.com/sst/opencode)** — OpenCode plugin SDK used by the injected runtime hook.

</details>

Inspirations:
* **[claude-peers-mcp](https://github.com/louislva/claude-peers-mcp)** by Louis V — earliest version of the agent-peer concept on Claude Code.
* **[agent-peers-mcp](https://github.com/Co-Messi/agent-peers-mcp)** by Co-Messi — the immediate predecessor whose limitations motivated this project.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for branching, commits, and review expectations.

## License

MIT — see [`LICENSE`](./LICENSE).

## Disclaimer
This project does not come with warranty, and is not intended to be accessible from the Internet. When allowing coding agents to communicate, you are still responsible of overseeing and managing their activities. I'm not responsible to any adverse outcomes arising from using WhatsAgent, including but not limited to agents consuming extra tokens, unintended code written without your approval, or overclocking your GPU.