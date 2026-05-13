# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-05-12

Per-agent persona profiles.

### Added

- **Persona profile per agent**
  - Six freeform fields: `description`, `responsibilities`, `boundaries`, `skills`, `working_style`, `extra_prompt`.
  - Soft size limits (warned, not enforced) plus hard caps per field and per total.
  - Clearing all fields removes the persona; deleting an agent cascades.
  - Surfaced in `whoami` (full persona including `extra_prompt`) and `list_peers` (description by default, fuller persona without `extra_prompt` when called with `details: true`), so agents can pick a peer by capability instead of by name.
  - Editable through the HTTP API (`GET`/`POST`/`PATCH` of the agent record accept a `persona` object or `null` to clear, and return any soft-limit warnings).
  - Visible in kanban — assignee description shows as a hover hint on the lane's agent name and avatar, and inline on the task-detail "Assigned" field.
- **Six starter persona templates**
  - Engineer, Reviewer, Architect, Researcher, Coordinator, Frontend Specialist (wording adapted from the MIT-licensed agency-agents project).
  - Picker fills only empty fields and toasts how many it touched.
- **Dedicated agent config and create pages**
  - Replaces the previous modals; reachable at `/agents/new` and `/agents/<repo:name>/settings`.
  - Identity, Access (RBAC roles), and Persona sections.
  - Persona editor shows per-field "long field" markers, a total-token-budget banner, and a `Clear persona` action behind a confirm dialog.

### Changed

- **Agents overview redesigned**
  - Repo-grouped table with avatar, name + runtime, RBAC role chips, persona description, current summary, and row actions — replacing the card grid.
  - Rows are clickable and open the config page.
  - Name cell drops the runtime icon and online/offline pill (presence stays on the avatar dot).
  - Roles column narrower (two chips per row); description and current-summary cells wrap, clamp to three lines, and expand inline on click (with a hover tooltip showing the full text).
- **Agent config / create pages refinements**
  - Agents tab bar kept on top, content area scrolls inside.
  - Tab bar and save bar are fixed and full-width, with save-bar content aligned to the form column.
  - Text inputs and textareas styled to match the rest of the app (sans-serif, themed).
  - Repository shown as a compact readonly chip instead of a large empty-state box.
  - "Start from template" picker aligned to the persona fields.
  - Plainer copy for the "acts on behalf of a human" option.
- Runtime-default labels reworded from "Daemon default" to "Global default".

### Notes

- Persona text is stored and surfaced but not yet injected into agent launch prompts; the token-budget banner reflects the planned injection.

## [0.1.1] - 2026-05-12

Web UI polish.

### Fixed

- Hover tooltip popup no longer clips its own text — wraps with a viewport-safe max width instead of `nowrap` at 280px, so the full text of a truncated label is actually shown.
- About page banner now uses the branded PNG app icons (accent-aware, `256` / `512` srcset) instead of a hand-rolled inline SVG, matching the favicon and nav logo.

### Added

- **Kanban card meta pills now expose hover hints**
  - `GitHub issue #N` on the issue-number pill.
  - `Priority: PN` on the priority pill.
  - `Effort estimate: <XS…XL>` on the effort pill.
  - Also applied to the archive, task-detail, and epic-drawer pill variants.

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
