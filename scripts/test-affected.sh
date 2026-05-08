#!/usr/bin/env bash
# test-affected — run a subset of `bun test` based on git-changed files.
#
# Usage:
#   ./scripts/test-affected.sh           # against HEAD (staged + unstaged + untracked)
#   ./scripts/test-affected.sh --vs main # against a base ref
#   bun run test:affected                 # via package.json
#
# Strategy:
#   1. Collect changed source paths via `git diff --name-only`.
#   2. Map each to its likely test files using a path-prefix table.
#   3. If any "fan-out" file changed (db.ts, daemon.ts, web/*), include
#      the conservative always-run set (web-shell, daemon, smoke).
#   4. Run `bun test <files...>`. Empty match → fallback to full suite
#      so the script never silently passes by skipping everything.
#
# The mapping table is intentionally a flat case statement — easy to
# read and extend, no clever globs. When a new module + test pair lands,
# add one case clause.

set -euo pipefail

base="HEAD"
if [[ "${1:-}" == "--vs" && -n "${2:-}" ]]; then
  base="$2"
  shift 2
fi

if [[ ! -d .git ]]; then
  echo "test-affected: not a git repo; running full suite" >&2
  exec bun test
fi

# Combine: tracked changes vs base + uncommitted + untracked-but-tracked-pattern.
# Untracked .ts files are intentionally ignored — they wouldn't run anyway.
mapfile -t changed < <(
  {
    git diff --name-only "$base" --diff-filter=ACMR 2>/dev/null || true
    git diff --name-only --cached --diff-filter=ACMR 2>/dev/null || true
    git diff --name-only --diff-filter=ACMR 2>/dev/null || true
  } | sort -u
)

if [[ ${#changed[@]} -eq 0 ]]; then
  echo "test-affected: no changed files vs $base; running full suite" >&2
  exec bun test
fi

declare -A picked=()
fanout=0

add() {
  for t in "$@"; do
    [[ -f "$t" ]] && picked["$t"]=1
  done
}

for f in "${changed[@]}"; do
  case "$f" in
    # Test changes — run the test itself.
    tests/*.test.ts) add "$f" ;;

    # RBAC stack
    src/rbac-dao.ts)      add tests/rbac-dao.test.ts tests/rbac-api.test.ts tests/rbac-enforce.test.ts tests/agent-roles-api.test.ts ;;
    src/rbac-enforce.ts)  add tests/rbac-enforce.test.ts tests/rbac-hard-deny.test.ts ;;
    src/audit-log-dao.ts) add tests/audit-log-dao.test.ts tests/audit-api.test.ts tests/rbac-enforce.test.ts ;;

    # Kanban
    src/kanban*.ts)       add tests/kanban-db.test.ts tests/display-snapshot-e2e.test.ts ;;

    # Messaging / channel
    src/messages/*)       add tests/inbox-envelope.test.ts tests/notifications.test.ts tests/daemon.test.ts ;;

    # Auth
    src/auth/*)           add tests/auth-dao.test.ts tests/web-auth.test.ts ;;

    # Custom prompts
    src/prompts/*)        add tests/custom-prompts-dao.test.ts ;;

    # Web client + shell — string-fragment chunks. web-shell pin tests
    # cover the integration surface; per-module changes add their own.
    src/web/client/agents.ts)         add tests/web-shell.test.ts ;;
    src/web/client/settings.ts)       add tests/web-shell.test.ts tests/audit-api.test.ts ;;
    src/web/client/messages.ts)       add tests/web-shell.test.ts ;;
    src/web/client/kanban.ts)         add tests/web-shell.test.ts ;;
    src/web/client/router.ts)         add tests/web-shell.test.ts tests/router.test.ts ;;
    src/web/client/notifications.ts)  add tests/web-shell.test.ts tests/notifications.test.ts ;;
    src/web/client/markdown.ts)       add tests/web-shell.test.ts ;;
    src/web/client/main.ts)           add tests/web-shell.test.ts ;;
    src/web/shell.ts|src/web/shell-styles.ts|src/web/shell-overrides.ts)
      add tests/web-shell.test.ts ;;

    # Runner / launch
    src/runner/*)         add tests/runner-protocol.test.ts ;;

    # Workspace decoupling DAO
    src/workspace-decoupling-dao.ts)  add tests/workspace-decoupling-dao.test.ts tests/legacy-role-compat.test.ts ;;
    src/cli.ts|src/cli/*)             add tests/cli-decoupling.test.ts ;;
    src/config.ts)                    add tests/daemon-config.test.ts tests/cli-decoupling.test.ts ;;

    # Daemon DB / migrations
    src/db.ts|src/server/workspace-state.ts)
      add tests/workspace-db-migration-11.test.ts tests/workspace-db-migration-12.test.ts \
          tests/workspace-db-migration-14.test.ts tests/workspace-db-migration-15.test.ts \
          tests/workspace-db-migration-16.test.ts tests/workspace-db-migration-17.test.ts \
          tests/kanban-db.test.ts tests/rbac-dao.test.ts tests/audit-log-dao.test.ts \
          tests/display-snapshot-e2e.test.ts tests/legacy-role-compat.test.ts
      fanout=1 ;;
    src/daemon-db.ts) add tests/daemon-migration-3.test.ts tests/daemon-config.test.ts ;;

    # Daemon HTTP — broad fan-out.
    src/server/daemon.ts) fanout=1 ;;

    # Integration / token surfaces.
    src/integrations/*)   add tests/integration-token.test.ts tests/runner-protocol.test.ts tests/rbac-tool-family-filter.test.ts ;;

    # Always-conservative paths (untyped fallback, helpers).
    src/*.ts)             fanout=1 ;;
    *.json|bun.lockb)     fanout=1 ;;

    # Docs / mockups / specs / handoff: skip — no runtime tests.
    docs/*|HANDOFF.md|README.md|AGENTS.md|*.md) ;;
    scripts/*) ;;
    .claude/*|.codex|.f9*) ;;

    # Unknown — be conservative.
    *) fanout=1 ;;
  esac
done

if [[ $fanout -eq 1 ]]; then
  add tests/web-shell.test.ts tests/daemon.test.ts tests/rbac-api.test.ts \
      tests/agent-roles-api.test.ts tests/audit-api.test.ts \
      tests/workspace-db-migration-15.test.ts tests/workspace-db-migration-16.test.ts \
      tests/rbac-dao.test.ts tests/audit-log-dao.test.ts tests/rbac-enforce.test.ts \
      tests/rbac-flag-env.test.ts \
      tests/kanban-db.test.ts
fi

if [[ ${#picked[@]} -eq 0 ]]; then
  echo "test-affected: changed files map to no tests; running full suite as a safety net" >&2
  exec bun test
fi

# Print plan, then run.
files=("${!picked[@]}")
mapfile -t files < <(printf '%s\n' "${files[@]}" | sort)
echo "test-affected: ${#files[@]} test file(s) selected${fanout:+ (fan-out triggered)}:" >&2
for t in "${files[@]}"; do echo "  $t" >&2; done
exec bun test "${files[@]}"
