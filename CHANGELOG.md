# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-05-12

Web UI polish (EP-036).

### Fixed

- Hover tooltip popup no longer clips its own text — `.app-tooltip` now wraps with a viewport-safe max width instead of `nowrap` at 280px, so the full text of a truncated label is actually shown.
- About page banner now uses the branded PNG app icons from `assets/icons` (accent-aware, `256`/`512` srcset) instead of a hand-rolled inline SVG, matching the favicon and nav logo.

### Added

- Kanban card meta pills expose hover hints via a new always-on `data-hint` tooltip: `GitHub issue #N` on the issue-number pill, `Priority: PN`, and `Effort estimate: <XS…XL>` — also on the archive, task-detail, and epic-drawer pill variants.

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
