# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-05-12

Per-agent persona profiles.

### Added

- **Persona profile per agent** — give each agent a short bio (description, responsibilities, boundaries, skills, working style, extra prompt) so peers can route work by capability instead of by name.
  - Surfaced in `whoami` and `list_peers` for agents, and on the kanban lane and task-detail "Assigned" field for humans.
- **Six starter persona templates** — Engineer, Reviewer, Architect, Researcher, Coordinator, Frontend Specialist — one click fills the editor.
- **Dedicated agent add and edit pages** replacing the old modal, with a Persona section alongside Identity and Access.

### Changed

- **Agents overview redesigned** as a repo-grouped table, with each agent's persona description and current summary visible inline.
- Runtime-default labels reworded from "Daemon default" to "Global default".

### Notes

- Persona text is stored and surfaced but not yet injected into agent launch prompts.

## [0.1.1] - 2026-05-12

Web UI polish.

### Fixed

- Hover tooltip popup no longer clips its own text — wraps with a viewport-safe max width instead of `nowrap` at 280px, so the full text of a truncated label is actually shown.
- About page banner now uses the branded PNG app icons (accent-aware, `256` / `512` srcset) instead of a hand-rolled inline SVG, matching the favicon and nav logo.

### Added

- **Kanban card meta pills now expose hover hints** — GitHub issue number, priority, and effort estimate explain themselves on hover. Applied to the board, archive, task-detail, and epic-drawer variants.

## [0.1.0] - 2026-05-08

Initial public release.

### Highlights

- Local fleet controller for AI coding agents (Claude Code, OpenCode, Codex, Pi/Gemini).
- WhatsApp-style messaging UI with Star / Peer-to-peer / Channel topologies.
- MCP server bound to each agent's role, exposing `send_message`, `check_messages`, `list_peers`, `post_channel_message`, `read_kanban_task`, and friends.
- Shared Kanban board with epics, close-approval workflow, and search.
- Web terminal with xterm.js mirrors per agent, restore-on-reconnect, output throttling, and an on-screen special-keys overlay (Esc / Tab / arrows / sticky Ctrl) for mobile keyboards.
- Per-workspace RBAC with `enforce` / `soft` / `off` modes.
- Multi-repo workspaces; repos may live anywhere on disk.
- Local-first: SQLite, `127.0.0.1` only, no telemetry.
