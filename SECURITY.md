# Security Policy

## Reporting a Vulnerability

If you believe you've found a security vulnerability in WhatsAgent, please report it privately rather than opening a public GitHub issue.

Email the maintainer with:

- A description of the vulnerability and its impact.
- Steps to reproduce, ideally with a minimal proof-of-concept.
- The affected version (commit SHA or tag).
- Any suggested mitigation.

You'll get an acknowledgement within a few days. Coordinated disclosure: please give the maintainer a reasonable window to ship a fix before publishing.

## Threat model (v0.1.0)

WhatsAgent is designed for **single-machine, trusted-user** operation. The daemon binds to `127.0.0.1` by default and the SQLite databases sit on local disk. The threat model assumes the local user is trusted; protections target:

- Same-UID drive-by access (e.g. browser tabs trying to hit the daemon's loopback API). Loopback bearer tokens, Origin/CSRF checks, and bounded request bodies are in place.
- Untrusted message bodies from agents. Inbox envelopes mark sender content as untrusted; trusted metadata sits outside the body marker.
- Stale runner binaries serving old endpoints. The daemon detects stale `/redraw-pulse` endpoints and surfaces a respawn hint in the web UI.
- Transitive dependency vulnerabilities. `bun audit --json` runs in CI; advisories are pinned with package overrides.

WhatsAgent is **not** designed to defend against:

- A malicious agent runtime running locally — agents have a curated MCP tool surface but ultimately execute arbitrary code in the PTY they own.
- A multi-user host where another local user can read your home directory.
- Network-exposed deployment without an authenticating reverse proxy in front.

## Hardening already in place

- Origin / CSRF checks on every state-mutating route.
- Per-runner bearer auth on the loopback control plane.
- Bounded request bodies; bootstrap token exchange instead of long-lived static secrets.
- Body-free push notifications (no message content in OS notifications).
- Login return-URL validator (no open redirect).
- Hardening response headers (`X-Content-Type-Options`, `Referrer-Policy`, etc.).
- Static debug-log redaction for paths and long-token-like strings.
- Dependency overrides: `fast-uri ^3.1.2` to close GHSA-v39h-62p7-jpjc + GHSA-q3j6-qgpj-74h6.

## CI

Every PR runs `bunx tsc --noEmit`, `bun test`, `bun run smoke`, and `bun audit --json`. A failed audit blocks merge.
