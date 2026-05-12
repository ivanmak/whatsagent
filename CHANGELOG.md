# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-05-12

Per-agent Persona Profiles (EP-037, Epic A).

### Added

- **Persona profile per agent.** New `agent_personas` table (schema migration 25) holding six freeform fields — `description`, `responsibilities`, `boundaries`, `skills`, `working_style`, `extra_prompt` — with soft size limits (warned, not enforced) and hard caps per field and per total. An empty persona deletes the row; the row cascades on agent deletion.
- **Persona in agent discovery.** `whoami` returns the full persona (including `extra_prompt`); `list_peers` returns the persona `description` by default and the fuller persona (without `extra_prompt`) when called with `details: true`, so agents can pick a peer by capability instead of by name.
- **Persona-aware HTTP APIs.** `GET /api/v1/workspaces/current/roles-by-id` and the new `GET /api/v1/workspaces/current/roles-by-id/:id` include `persona`; `POST` (create) and `PATCH` (edit) accept a `persona` object (or `null` to clear) and return any soft-limit `warnings`. New `GET /api/v1/persona-templates`.
- **Six starter persona templates** — Engineer, Reviewer, Architect, Researcher, Coordinator, Frontend Specialist (wording adapted from the MIT-licensed agency-agents project) — selectable from a dropdown that fills only empty fields and toasts how many it touched.
- **Agent config & create pages.** Adding or editing an agent is now a dedicated page (`/agents/new`, `/agents/<repo:name>/settings`) instead of a modal, with Identity, Access (RBAC roles), and Persona sections. The Persona editor shows per-field "long field" markers, a total-token-budget banner, and a `Clear persona` action behind a confirm dialog.

### Changed

- **Agents overview redesigned** as a repo-grouped table — avatar, name + runtime, RBAC role chips, persona description, current summary, and row actions — replacing the card grid; rows are clickable to open the config page. The name cell drops the runtime icon and online/offline pill (presence stays on the avatar dot); the roles column is narrower (two chips per row); description and current-summary cells wrap, clamp to three lines, and expand inline on click (with a hover tooltip showing the full text).
- **Agent config / create pages** keep the agents tab bar on top, scroll inside the content area (the tab bar and save bar are fixed and full-width, with the save-bar content aligned to the form column), style their text inputs/textareas to match the rest of the app (sans-serif, themed), show the (fixed) repository as a compact readonly chip instead of a large empty-state box, align the "Start from template" picker to the persona fields, and use plainer copy for the "acts on behalf of a human" option.
- **Kanban shows persona context** — the assignee's persona `description` is a hover hint on the lane's agent name and avatar, and appears inline on the task-detail "Assigned" field.
- Runtime-default labels reworded from "Daemon default" to "Global default".

### Notes

- Persona text is stored and surfaced but not yet injected into agent launch prompts; the token-budget banner reflects the planned injection (Epic B).

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
