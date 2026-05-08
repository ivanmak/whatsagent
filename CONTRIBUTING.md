# Contributing

Thanks for your interest. This is an early-stage project — surface area is moving — but contributions are welcome.

## Setup

Requires [Bun](https://bun.sh) ≥ 1.3. Clone, install, run the test gate:

```bash
git clone https://github.com/ivanmak/whatsagent-mcp.git
cd whatsagent-mcp
bun install
bunx tsc --noEmit
bun test
bun run smoke
```

The smoke runner boots a temp fleet with fake runners and exercises the full lifecycle in roughly 120 ms. Both `bun test` and `bun run smoke` should be green before opening a PR.

## Running the daemon

```bash
bun src/cli.ts start
```

For development against a sandboxed daemon home, point `WHATSAGENT_DAEMON_HOME` somewhere disposable:

```bash
WHATSAGENT_DAEMON_HOME=/tmp/wa-dev bun src/cli.ts start
```

## Code style

- TypeScript with strict mode. Types preferred over `any`. Errors thrown, not returned-as-strings.
- Test discipline: tests live next to source under `tests/`. Source-pin tests for built bundles live in `tests/web-shell.test.ts`.
- No comments unless the *why* is non-obvious. Don't restate what the code does.
- Match the surrounding style for existing modules.
- For UI changes, prefer custom widgets over native `confirm()` / `<select>` — the daemon ships its own `openConfirm` and dropdown helpers.

## Branching and commits

- Branch off `master`. Use a descriptive prefix: `feature/...`, `fix/...`, `docs/...`.
- Keep commits scoped. Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`) preferred but not enforced.
- Don't squash other people's commits without asking.

## Pull requests

- Run the full gate locally first: `bunx tsc --noEmit`, `bun test`, `bun run smoke`.
- Fill in what the change does and why. Link issues if any.
- PRs that touch the daemon-runner protocol or the SQLite schema need explicit migration notes.
- The maintainer may ask for changes; please don't take that personally.

## Security

Don't open public issues for vulnerabilities. See [`SECURITY.md`](./SECURITY.md).

## License

By contributing you agree your contributions are licensed under the MIT License (see [`LICENSE`](./LICENSE)).
