import type { Database } from "bun:sqlite";

import { appendAudit } from "./audit-log-dao.ts";
import { type RbacMode } from "./daemon-db.ts";
import { getEffectiveGrants, type EffectiveGrants } from "./rbac-dao.ts";
import {
  ACTION_GRANT_REQUIREMENTS,
  getToolFamily,
  shouldExposeTool,
  type GrantRequirement,
} from "./rbac-visibility.ts";

// Re-export the DB-free visibility helpers so existing call sites keep
// importing them from `rbac-enforce.ts`. Pi extension and the agent tool
// catalog import from `rbac-visibility.ts` directly to avoid the audit /
// rbac DAO chain that pulls `bun:sqlite`.
export { ACTION_GRANT_REQUIREMENTS, getToolFamily, shouldExposeTool };
export type { GrantRequirement };

/**
 * RBAC hard-deny audit kind. Emitted by the dispatcher when the effective
 * RBAC mode is `enforce` AND a grant requirement misses. Distinct from
 * `grant_miss_soft` so the audit subtab can split observation rows
 * (`soft` mode) from enforced denies. EP-022 / WA-094 replaced the prior
 * single-flag plumbing with per-workspace `rbac_mode`; the audit-kind
 * names didn't move.
 */
export const HARD_DENY_AUDIT_KIND = "grant_miss_hard" as const;

/**
 * RBAC enforcement helper. Maps every gated MCP action name (kebab-case
 * as it arrives at `handleAgentApi`) to one or more grant requirements.
 * On a request, the dispatcher calls `checkActionGrants` BEFORE
 * delegating to the action handler.
 *
 * EP-022 / WA-094: behavior is selected per-call by `input.mode`:
 *   - `enforce`: deny on miss, audit kind `grant_miss_hard`.
 *   - `soft`: allow on miss, audit kind `grant_miss_soft` (observation-
 *     only mode for operators staging RBAC adoption).
 *   - `off`: short-circuit (no grant lookup, no audit row).
 *
 * The require shape `{kind, value, scope?}` matches the underlying
 * `role_grants` row format. A match exists when:
 *   - `kind === required.kind` AND
 *   - `value === required.value` AND
 *   - (required.scope is undefined → match any scope)
 *     OR (required.scope is null → match scope=null exactly)
 *     OR (required.scope is a string → match that scope OR scope=null)
 *
 * The "or scope=null" branch implements the "any" superset rule:
 * a grant scoped to `any` (NULL) covers narrower-scoped requirements.
 * Note: this is "operator semantics" — narrower-scope grants do NOT
 * cover broader requirements (e.g. `own_assignment` does not satisfy
 * a request that needs `any`). That's the case the Audit tab calls
 * out as `has-close` (yellow): the agent has the grant but at narrower
 * scope than the call demands.
 */

export interface GrantCheckTarget {
  kind?: string;
  id?: string;
}

export interface CheckActionGrantsInput {
  agentId: string;
  action: string;
  target?: GrantCheckTarget;
  /**
   * Per-call dynamic scope override. Some kanban actions (status moves,
   * comments) need to know the actor's relation to the target —
   * `own_assignment` if the actor is assignee, `created_by_self` if
   * creator, `null` (any) otherwise. Caller computes this and passes
   * it in so requireGrant can pick the narrowest matching grant.
   */
  dynamicScope?: string | null;
  /**
   * EP-022 / WA-094: per-call effective RBAC mode resolved by the
   * dispatcher from `min(workspace.rbac_mode, state.rbacModeCeiling)`
   * where the order is `off < soft < enforce` and the CLI ceiling caps
   * (most-permissive) without ever tightening the workspace's stored
   * mode.
   *
   *   - `enforce`: deny on miss, audit kind `grant_miss_hard`,
   *     `outcome.allowed = false` when any requirement misses.
   *   - `soft`: allow on miss, audit kind `grant_miss_soft`,
   *     `outcome.allowed = true`. Used by operators who want to observe
   *     what would deny before flipping to `enforce`.
   *   - `off`: short-circuit. No grant evaluation, no DB lookups, no
   *     audit row — `outcome` is `{allowed: true, hasMiss: false,
   *     auditIds: [], agentRolesSnapshot: []}`.
   *
   * Required (advisor msg #409): no default. Forgetting `mode` in a
   * future production caller would silently fail-open as `soft`, so the
   * type contract demands the choice is always explicit. Tests that
   * exercise the helper directly pass `mode: "soft"` to preserve
   * Phase-3 helper semantics.
   */
  mode: RbacMode;
  /**
   * Phase 4 (WA-087): for `comment-kanban-task` / `comment-kanban-epic`,
   * the dispatcher reads `body.type` and forwards it here. The check
   * dynamically appends a `comment_type:<value>` requirement so each
   * comment kind (progress / note / blocker / verdict_go /
   * verdict_no_go / verdict_needs_revision) can be gated independently.
   * Empty string / undefined / null skip the check.
   */
  dynamicCommentType?: string | null;
}

export interface GrantMatchOutcome {
  /** True when call should proceed. Soft mode: always true. Hard mode:
   * true when no miss; false when at least one requirement missed. */
  allowed: boolean;
  /** Whether at least one required grant was unmet on this call. */
  hasMiss: boolean;
  /** The audit row ids written for misses + the pass row (when applicable). */
  auditIds: string[];
  /** First miss requirement (with dynamicScope already applied), present
   * iff hasMiss. Dispatcher feeds this to `denyResponse` to render the
   * 403 body in hard mode. */
  firstMissRequirement?: GrantRequirement;
  /** Snapshot of actor's role names at the time of the call, used by
   * `denyResponse.agent_roles`. Captured here so the dispatcher does not
   * have to call `getEffectiveGrants` a second time. */
  agentRolesSnapshot: readonly string[];
}

/**
 * For an action that has dynamic scope (kanban_action requirements),
 * the dispatcher computes a scope qualifier from the actor's relation
 * to the target (assignee / creator / neither) and passes it in. The
 * helper then narrows the requirement to that scope so a `has-close`
 * verdict can be distinguished from `has-exact` in the audit row.
 */
function isKanbanActionRequirement(req: GrantRequirement): boolean {
  return req.kind === "kanban_action";
}

interface MatchResult {
  matchKind: "has-exact" | "has-close" | "has-none";
  matchedScope: string | null | undefined;
}

function matchRequirement(req: GrantRequirement, grants: EffectiveGrants): MatchResult {
  // Boolean kinds — flat string sets.
  switch (req.kind) {
    case "tool_family":
      return grants.tool_families.includes(req.value)
        ? { matchKind: "has-exact", matchedScope: undefined }
        : { matchKind: "has-none", matchedScope: undefined };
    case "comment_type":
      return grants.comment_types.includes(req.value)
        ? { matchKind: "has-exact", matchedScope: undefined }
        : { matchKind: "has-none", matchedScope: undefined };
    case "channel_action":
      return grants.channel_actions.includes(req.value)
        ? { matchKind: "has-exact", matchedScope: undefined }
        : { matchKind: "has-none", matchedScope: undefined };
    case "audit_grant":
      return grants.audit_grants.includes(req.value)
        ? { matchKind: "has-exact", matchedScope: undefined }
        : { matchKind: "has-none", matchedScope: undefined };
    case "meta":
      return grants.meta.includes(req.value)
        ? { matchKind: "has-exact", matchedScope: undefined }
        : { matchKind: "has-none", matchedScope: undefined };
    case "kanban_action":
      return matchKanbanAction(req, grants);
    default:
      return { matchKind: "has-none", matchedScope: undefined };
  }
}

function matchKanbanAction(req: GrantRequirement, grants: EffectiveGrants): MatchResult {
  const candidates = grants.kanban_actions.filter((g) => g.value === req.value);
  if (candidates.length === 0) {
    return { matchKind: "has-none", matchedScope: undefined };
  }
  // Required scope: undefined → exact-match if ANY candidate exists.
  // null → exact-match only if a NULL-scope (any) candidate exists.
  // string → exact-match if that scope present OR null-scope present.
  if (req.scope === undefined) {
    // Boolean-style requirement on a kanban_action — value alone is enough.
    return { matchKind: "has-exact", matchedScope: candidates[0]!.scope };
  }
  if (req.scope === null) {
    const any = candidates.find((g) => g.scope === null);
    if (any) return { matchKind: "has-exact", matchedScope: null };
    // Has the value but only at narrower scope — close miss.
    return { matchKind: "has-close", matchedScope: candidates[0]!.scope };
  }
  // req.scope is a specific string.
  const exact = candidates.find((g) => g.scope === req.scope);
  if (exact) return { matchKind: "has-exact", matchedScope: req.scope };
  const any = candidates.find((g) => g.scope === null);
  if (any) return { matchKind: "has-exact", matchedScope: null }; // any-scope satisfies narrower
  // Has the value but at a different specific scope — close miss.
  return { matchKind: "has-close", matchedScope: candidates[0]!.scope };
}

/**
 * RBAC hard-deny response shape. Returned by the dispatcher on a hard
 * miss when the effective workspace mode is `enforce` (post-EP-022 the
 * env-var kill switch is gone; mode is per-workspace plus an optional
 * CLI ceiling). Shape per spec L388-391:
 *
 * ```json
 * { "ok": false, "error": "rbac_denied", "tool": "...", "expected_grant": "...",
 *   "agent_roles": [...], "hint": "..." }
 * ```
 *
 * `expected_grant` is rendered as `kind:value` (or `kind:value@scope` for
 * scoped kanban_action requirements). The `hint` is computed from
 * `role_grants` so custom roles surface in the suggestion text without a
 * hardcoded role table.
 */
export interface DenyResponseInput {
  tool: string;
  expectedGrant: GrantRequirement;
  agentRoles: readonly string[];
}

export interface DenyResponseBody {
  ok: false;
  error: "rbac_denied";
  tool: string;
  expected_grant: string;
  agent_roles: readonly string[];
  hint: string;
}

export function formatExpectedGrant(req: GrantRequirement): string {
  if (req.scope) return `${req.kind}:${req.value}@${req.scope}`;
  return `${req.kind}:${req.value}`;
}

function lookupGrantingRoles(db: Database, req: GrantRequirement): string[] {
  // Three cases for kanban_action — mirrors the runtime match semantics in
  // `matchKanbanAction`:
  //   - `scope === null` → caller demands any-scope explicitly; only roles
  //     with `scope_qualifier IS NULL` satisfy. Narrower grants
  //     (`own_assignment`, `created_by_self`) do NOT qualify because they
  //     fail the call when invoked.
  //   - `typeof scope === "string"` → specific scope; NULL (any) OR
  //     matching specific scope satisfy. The any-scope superset rule.
  //   - `scope === undefined` → boolean/value-only requirement (rare for
  //     kanban_action but kept for symmetry); any grant with the value
  //     qualifies regardless of scope_qualifier.
  // For non-kanban_action kinds, scope is irrelevant on the grant side.
  if (req.kind === "kanban_action") {
    if (req.scope === null) {
      const rows = db.query<{ name: string }, [string, string]>(
        `SELECT DISTINCT r.name FROM roles r
           JOIN role_grants g ON g.role_id = r.id
          WHERE g.grant_kind = ? AND g.grant_value = ?
            AND g.scope_qualifier IS NULL
          ORDER BY r.name`,
      ).all(req.kind, req.value);
      return rows.map((r) => r.name);
    }
    if (typeof req.scope === "string") {
      const rows = db.query<{ name: string }, [string, string, string]>(
        `SELECT DISTINCT r.name FROM roles r
           JOIN role_grants g ON g.role_id = r.id
          WHERE g.grant_kind = ? AND g.grant_value = ?
            AND (g.scope_qualifier IS NULL OR g.scope_qualifier = ?)
          ORDER BY r.name`,
      ).all(req.kind, req.value, req.scope);
      return rows.map((r) => r.name);
    }
  }
  const rows = db.query<{ name: string }, [string, string]>(
    `SELECT DISTINCT r.name FROM roles r
       JOIN role_grants g ON g.role_id = r.id
      WHERE g.grant_kind = ? AND g.grant_value = ?
      ORDER BY r.name`,
  ).all(req.kind, req.value);
  return rows.map((r) => r.name);
}

export function denyResponse(db: Database, input: DenyResponseInput): DenyResponseBody {
  const granting = lookupGrantingRoles(db, input.expectedGrant);
  let hint: string;
  if (granting.length === 0) {
    hint = `No role currently grants ${formatExpectedGrant(input.expectedGrant)}; create a custom role with that grant or contact an admin.`;
  } else if (granting.length === 1) {
    hint = `Ask an agent with the '${granting[0]}' role to invoke this.`;
  } else {
    hint = `Ask an agent with one of these roles: ${granting.map((r) => `'${r}'`).join(", ")}.`;
  }
  return {
    ok: false,
    error: "rbac_denied",
    tool: input.tool,
    expected_grant: formatExpectedGrant(input.expectedGrant),
    agent_roles: input.agentRoles,
    hint,
  };
}

export function checkActionGrants(db: Database, input: CheckActionGrantsInput): GrantMatchOutcome {
  const mode: RbacMode = input.mode;
  // EP-022 / WA-094: `off` short-circuits without touching the audit
  // log. No grant lookup, no DB hit beyond what the caller already did.
  // The legacy `requireKanban*Policy` star-fallback (T5 will delete
  // wholesale) also short-circuits in `off` mode at its own call sites.
  if (mode === "off") {
    return { allowed: true, hasMiss: false, auditIds: [], agentRolesSnapshot: [] };
  }
  const hardEnforce = mode === "enforce";
  const baseRequirements = ACTION_GRANT_REQUIREMENTS[input.action];
  // Phase 4 (WA-087): comment_type is a dynamic predicate driven by
  // `body.type`. When present and the action is one of the gated comment
  // endpoints, append a `comment_type:<value>` requirement on top of the
  // static list. Other kinds get no extra requirement.
  const dynamicCommentType = input.dynamicCommentType;
  const isCommentAction = input.action === "comment-kanban-task" || input.action === "comment-kanban-epic";
  const hasCommentType = isCommentAction && typeof dynamicCommentType === "string" && dynamicCommentType.length > 0;
  if ((!baseRequirements || baseRequirements.length === 0) && !hasCommentType) {
    return { allowed: true, hasMiss: false, auditIds: [], agentRolesSnapshot: [] };
  }
  const requirements: readonly GrantRequirement[] = hasCommentType
    ? [...(baseRequirements ?? []), { kind: "comment_type", value: dynamicCommentType! }]
    : (baseRequirements ?? []);
  const grants = getEffectiveGrants(db, input.agentId);

  const auditIds: string[] = [];
  let hasMiss = false;
  let firstMissRequirement: GrantRequirement | undefined;
  const missKind = hardEnforce ? HARD_DENY_AUDIT_KIND : "grant_miss_soft";
  const missOutcome = hardEnforce ? "hard_deny" : "soft_allow";

  for (const baseReq of requirements) {
    // Inject dynamicScope for kanban_action requirements when caller
    // supplied one. Other kinds ignore dynamicScope.
    const req: GrantRequirement = isKanbanActionRequirement(baseReq) && input.dynamicScope !== undefined
      ? { ...baseReq, scope: input.dynamicScope }
      : baseReq;

    const result = matchRequirement(req, grants);
    if (result.matchKind === "has-exact") continue;

    if (!hasMiss) firstMissRequirement = req;
    hasMiss = true;
    // Audit-write failure must not bypass miss detection (advisor msg
    // 369): isolate the appendAudit call so a DB error here cannot
    // cause the dispatcher to fail-open under hard enforcement. The
    // `hasMiss` + `firstMissRequirement` state is already set; an
    // audit-write failure just means no row gets written, but the
    // dispatcher still denies the call in hard mode.
    try {
      const audit = appendAudit(db, {
        kind: missKind,
        actor_agent_id: input.agentId,
        target_kind: input.target?.kind ?? null,
        target_id: input.target?.id ?? null,
        payload: {
          tool: input.action,
          expected_grant: { kind: req.kind, value: req.value, scope: req.scope ?? null },
          match: result.matchKind, // "has-close" | "has-none"
          matched_scope: result.matchedScope ?? null,
          agent_roles: grants.roles,
          outcome: missOutcome,
        },
      });
      auditIds.push(audit.id);
    } catch {
      // Swallow — caller fails closed under hard enforcement on the
      // miss state we already captured. Audit retention loss noted
      // by the absence of an id in `auditIds`.
    }
  }

  // Emit a single `grant_check_pass` row when every requirement matched
  // exactly. One row per call (NOT per requirement) keeps audit_log
  // growth proportional to call volume rather than action complexity.
  // Phase 4 retention controls land alongside the audit_admin grant —
  // until then `audit_log` grows unbounded during alpha soak (acceptable
  // per user direction; pass-emission was deferred from slice 4 and is
  // now on for completeness so summary cards reflect real numbers).
  if (!hasMiss) {
    try {
      const audit = appendAudit(db, {
        kind: "grant_check_pass",
        actor_agent_id: input.agentId,
        target_kind: input.target?.kind ?? null,
        target_id: input.target?.id ?? null,
        payload: {
          tool: input.action,
          agent_roles: grants.roles,
          requirements: requirements.map((r) => ({
            kind: r.kind,
            value: r.value,
            scope: (isKanbanActionRequirement(r) && input.dynamicScope !== undefined ? input.dynamicScope : r.scope) ?? null,
          })),
          outcome: "pass",
        },
      });
      auditIds.push(audit.id);
    } catch {
      // Pass-row audit-write failures are non-fatal (advisor msg 369).
    }
  }

  // allowed: soft mode → always true (Phase 3 semantics retained for
  // off-flag callers); hard mode → false when any requirement missed.
  const allowed = hardEnforce ? !hasMiss : true;
  return { allowed, hasMiss, auditIds, firstMissRequirement, agentRolesSnapshot: grants.roles };
}
