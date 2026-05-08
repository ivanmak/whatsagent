import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

import { nowIso } from "./db.ts";

/**
 * RBAC permission-set table introduced in migration 15. Distinct from the
 * legacy identity table (now `agents` post-v14). `is_builtin = 1` rows are
 * non-deletable and have name-locked; their description + grants are
 * editable. `is_builtin = 0` rows are user-created custom roles with full
 * CRUD.
 */
export interface RbacRoleRow {
  id: string;
  name: string;
  description: string;
  is_builtin: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface RoleGrantRow {
  id: string;
  role_id: string;
  grant_kind: string;
  grant_value: string;
  scope_qualifier: string | null;
  created_at: string;
}

export interface RbacRoleWithGrants extends RbacRoleRow {
  grants: Array<Pick<RoleGrantRow, "grant_kind" | "grant_value" | "scope_qualifier">>;
}

export interface RbacRoleCreateInput {
  name: string;
  description?: string;
}

export interface RbacRoleUpdateInput {
  /** Only honored on `is_builtin = 0` roles. Built-in roles 409 on rename. */
  name?: string;
  description?: string;
}

export interface RoleGrantInput {
  grant_kind: string;
  grant_value: string;
  scope_qualifier?: string | null;
}

const RBAC_ROLE_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Sanitize an RBAC role name. Trims surrounding whitespace, lowercases, then
 * validates against the canonical shape. Built-in role names (pm, engineer,
 * …) follow the same pattern.
 *
 * Auto-lowercasing means callers can pass `"Release-Manager"` or
 * `"RELEASE_MANAGER"` and the DAO normalizes to `release-manager` /
 * `release_manager`. The duplicate check downstream uses the canonical form,
 * so two callers submitting `Release` and `release` collide as expected.
 *
 * Throws on empty input, on a non-letter/digit first character, or on any
 * character outside the `[a-z0-9_-]` set.
 */
export function sanitizeRbacRoleName(name: unknown): string {
  if (typeof name !== "string") throw new Error("role name must be a string");
  const canonical = name.trim().toLowerCase();
  if (!RBAC_ROLE_NAME_PATTERN.test(canonical)) {
    throw new Error(`role name has illegal characters or shape: ${JSON.stringify(name)}`);
  }
  return canonical;
}

/** List every RBAC role with its grant set, ordered builtin-first then by name. */
export function listRbacRoles(db: Database): RbacRoleWithGrants[] {
  const roles = db.query<RbacRoleRow, []>(
    "SELECT id, name, description, is_builtin, created_at, updated_at FROM roles ORDER BY is_builtin DESC, name ASC",
  ).all();
  const grants = db.query<RoleGrantRow, []>(
    "SELECT id, role_id, grant_kind, grant_value, scope_qualifier, created_at FROM role_grants",
  ).all();
  const byRole = new Map<string, RoleGrantRow[]>();
  for (const g of grants) {
    const arr = byRole.get(g.role_id) ?? [];
    arr.push(g);
    byRole.set(g.role_id, arr);
  }
  return roles.map((r) => ({
    ...r,
    grants: (byRole.get(r.id) ?? []).map((g) => ({
      grant_kind: g.grant_kind,
      grant_value: g.grant_value,
      scope_qualifier: g.scope_qualifier,
    })),
  }));
}

export function getRbacRoleById(db: Database, id: string): RbacRoleWithGrants | null {
  const role = db.query<RbacRoleRow, [string]>(
    "SELECT id, name, description, is_builtin, created_at, updated_at FROM roles WHERE id = ?",
  ).get(id);
  if (!role) return null;
  const grants = db.query<RoleGrantRow, [string]>(
    "SELECT id, role_id, grant_kind, grant_value, scope_qualifier, created_at FROM role_grants WHERE role_id = ?",
  ).all(id);
  return {
    ...role,
    grants: grants.map((g) => ({
      grant_kind: g.grant_kind,
      grant_value: g.grant_value,
      scope_qualifier: g.scope_qualifier,
    })),
  };
}

export function getRbacRoleByName(db: Database, name: string): RbacRoleWithGrants | null {
  const role = db.query<RbacRoleRow, [string]>(
    "SELECT id, name, description, is_builtin, created_at, updated_at FROM roles WHERE name = ?",
  ).get(name);
  if (!role) return null;
  return getRbacRoleById(db, role.id);
}

/**
 * Create a custom (`is_builtin = 0`) role. Returns the new row with empty
 * grant set; caller invokes `replaceRoleGrants` to populate. Throws on name
 * collision with an existing role (built-in or custom).
 */
export function createRbacRole(db: Database, input: RbacRoleCreateInput): RbacRoleWithGrants {
  const name = sanitizeRbacRoleName(input.name);
  const description = (input.description ?? "").trim();
  if (db.query<{ id: string }, [string]>("SELECT id FROM roles WHERE name = ?").get(name)) {
    throw new Error(`role name "${name}" already exists`);
  }
  const id = randomUUID();
  const ts = nowIso();
  db.run(
    "INSERT INTO roles (id, name, description, is_builtin, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
    [id, name, description, ts, ts],
  );
  return {
    id, name, description, is_builtin: 0, created_at: ts, updated_at: ts, grants: [],
  };
}

/**
 * Update an RBAC role's metadata.
 * - `is_builtin = 1`: only `description` may change. `name` change throws 409
 *   (caller maps to HTTP).
 * - `is_builtin = 0`: both `name` and `description` may change.
 *
 * Grant edits go through `replaceRoleGrants`, not this function.
 */
export function updateRbacRole(db: Database, id: string, input: RbacRoleUpdateInput): RbacRoleWithGrants {
  const existing = db.query<RbacRoleRow, [string]>(
    "SELECT id, name, description, is_builtin, created_at, updated_at FROM roles WHERE id = ?",
  ).get(id);
  if (!existing) throw new Error(`role ${id} not found`);

  const ts = nowIso();
  const updates: Array<{ col: string; value: string }> = [];

  if (input.name !== undefined) {
    if (existing.is_builtin === 1) {
      throw new Error("cannot rename a built-in role");
    }
    const newName = sanitizeRbacRoleName(input.name);
    if (newName !== existing.name) {
      const collider = db.query<{ id: string }, [string, string]>(
        "SELECT id FROM roles WHERE name = ? AND id != ?",
      ).get(newName, id);
      if (collider) throw new Error(`role name "${newName}" already exists`);
      updates.push({ col: "name", value: newName });
    }
  }
  if (input.description !== undefined) {
    updates.push({ col: "description", value: String(input.description ?? "") });
  }
  if (updates.length === 0) {
    return getRbacRoleById(db, id)!;
  }
  // Build a parametrized SET … chain.
  const setSql = updates.map((u) => `${u.col} = ?`).join(", ");
  const params: unknown[] = updates.map((u) => u.value);
  params.push(ts);
  params.push(id);
  db.run(`UPDATE roles SET ${setSql}, updated_at = ? WHERE id = ?`, params as never);
  return getRbacRoleById(db, id)!;
}

/**
 * Delete a custom role. Throws on `is_builtin = 1`. Grants cascade-delete
 * via the FK ON DELETE CASCADE; agent_roles assignments do NOT cascade
 * (FK is RESTRICT) so callers must clear assignments first or accept the
 * SQLite FK-constraint failure surfaced as a thrown Error.
 */
export function deleteRbacRole(db: Database, id: string): void {
  const existing = db.query<RbacRoleRow, [string]>(
    "SELECT id, name, is_builtin FROM roles WHERE id = ?" as string,
  ).get(id);
  if (!existing) throw new Error(`role ${id} not found`);
  if (existing.is_builtin === 1) {
    throw new Error("cannot delete a built-in role");
  }
  db.run("DELETE FROM roles WHERE id = ?", [id]);
}

/**
 * Replace the entire grant set for a role atomically. Old grants are
 * deleted; new grants inserted in one transaction. Used both for built-in
 * roles (grant set is editable on built-ins per spec) and custom roles.
 *
 * Each input grant is deduped by (kind, value, scope) before insert; the
 * UNIQUE index on `role_grants` would surface duplicates as an error
 * otherwise.
 */
export function replaceRoleGrants(db: Database, roleId: string, grants: RoleGrantInput[]): RbacRoleWithGrants {
  const existing = db.query<{ id: string }, [string]>("SELECT id FROM roles WHERE id = ?").get(roleId);
  if (!existing) throw new Error(`role ${roleId} not found`);

  // Dedup by (kind, value, scope-or-empty).
  const seen = new Set<string>();
  const dedup: RoleGrantInput[] = [];
  for (const g of grants) {
    const key = `${g.grant_kind}\x00${g.grant_value}\x00${g.scope_qualifier ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(g);
  }

  const ts = nowIso();
  db.transaction(() => {
    db.run("DELETE FROM role_grants WHERE role_id = ?", [roleId]);
    for (const g of dedup) {
      db.run(
        "INSERT INTO role_grants (id, role_id, grant_kind, grant_value, scope_qualifier, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [randomUUID(), roleId, g.grant_kind, g.grant_value, g.scope_qualifier ?? null, ts],
      );
    }
    db.run("UPDATE roles SET updated_at = ? WHERE id = ?", [ts, roleId]);
  })();
  return getRbacRoleById(db, roleId)!;
}

/** List the role names assigned to an agent. */
export function listAgentRoleNames(db: Database, agentId: string): string[] {
  return db.query<{ name: string }, [string]>(
    `SELECT roles.name FROM agent_roles
     JOIN roles ON roles.id = agent_roles.role_id
     WHERE agent_roles.agent_id = ?
     ORDER BY roles.name`,
  ).all(agentId).map((r) => r.name);
}

/**
 * Bucketed view of an agent's effective grants — union over every role
 * in `agent_roles`. Returned to the agent via `whoami` so the agent can
 * introspect its own permissions; also used by the soft-enforce
 * `requireGrant` helper landing in slice 4.
 *
 * Boolean grants (tool_family, comment_type, channel_action,
 * audit_grant, meta) flatten to plain string sets — these are
 * scope-less by design.
 *
 * Kanban actions retain their scope qualifier so the consumer can tell
 * `update_task_status (any)` from `update_task_status (own_assignment)`
 * — same value, different scope. `null` scope renders as "any" to
 * UI-side code.
 */
export interface EffectiveGrants {
  roles: string[];
  tool_families: string[];
  kanban_actions: Array<{ value: string; scope: string | null }>;
  comment_types: string[];
  channel_actions: string[];
  audit_grants: string[];
  meta: string[];
}

export function getEffectiveGrants(db: Database, agentId: string): EffectiveGrants {
  const rows = db.query<{ kind: string; value: string; scope: string | null; role_name: string }, [string]>(
    `SELECT role_grants.grant_kind AS kind,
            role_grants.grant_value AS value,
            role_grants.scope_qualifier AS scope,
            roles.name AS role_name
     FROM agent_roles
     JOIN roles ON roles.id = agent_roles.role_id
     LEFT JOIN role_grants ON role_grants.role_id = agent_roles.role_id
     WHERE agent_roles.agent_id = ?
     ORDER BY roles.name, role_grants.grant_kind, role_grants.grant_value`,
  ).all(agentId);

  const roles = new Set<string>();
  const toolFamilies = new Set<string>();
  const commentTypes = new Set<string>();
  const channelActions = new Set<string>();
  const auditGrants = new Set<string>();
  const meta = new Set<string>();
  const kanbanActions = new Map<string, { value: string; scope: string | null }>();

  for (const row of rows) {
    roles.add(row.role_name);
    // The LEFT JOIN can produce a row with the role but no grants
    // (role exists but has no grant rows). Skip those — kind will be null.
    if (!row.kind) continue;
    switch (row.kind) {
      case "tool_family":
        toolFamilies.add(row.value);
        break;
      case "comment_type":
        commentTypes.add(row.value);
        break;
      case "channel_action":
        channelActions.add(row.value);
        break;
      case "audit_grant":
        auditGrants.add(row.value);
        break;
      case "meta":
        meta.add(row.value);
        break;
      case "kanban_action": {
        const key = `${row.value}\x00${row.scope ?? ""}`;
        if (!kanbanActions.has(key)) {
          kanbanActions.set(key, { value: row.value, scope: row.scope });
        }
        break;
      }
      default:
        // Unknown kind — silently skip. Future kinds can land without
        // forcing this helper to update first.
        break;
    }
  }

  return {
    roles: Array.from(roles).sort(),
    tool_families: Array.from(toolFamilies).sort(),
    kanban_actions: Array.from(kanbanActions.values()).sort((a, b) => {
      if (a.value !== b.value) return a.value < b.value ? -1 : 1;
      return (a.scope ?? "") < (b.scope ?? "") ? -1 : 1;
    }),
    comment_types: Array.from(commentTypes).sort(),
    channel_actions: Array.from(channelActions).sort(),
    audit_grants: Array.from(auditGrants).sort(),
    meta: Array.from(meta).sort(),
  };
}

export interface AgentRoleAssignment {
  role_id: string;
  name: string;
  description: string;
  is_builtin: 0 | 1;
  assigned_at: string;
}

/**
 * List the full role rows assigned to an agent. Joined view; ordered
 * by role name. Empty array when no assignments — does not 404.
 */
export function getAgentRoles(db: Database, agentId: string): AgentRoleAssignment[] {
  return db.query<AgentRoleAssignment, [string]>(
    `SELECT roles.id AS role_id, roles.name, roles.description, roles.is_builtin, agent_roles.assigned_at
     FROM agent_roles
     JOIN roles ON roles.id = agent_roles.role_id
     WHERE agent_roles.agent_id = ?
     ORDER BY roles.name`,
  ).all(agentId);
}

/**
 * Replace the agent's full role-assignment set atomically.
 *
 * - Validates that every supplied `role_id` exists in `roles` (else
 *   throws — caller maps to HTTP 400).
 * - Deletes existing rows for the agent and re-inserts the new set.
 * - Dedupes input; same role_id twice in the array collapses to one
 *   row.
 *
 * Caller is responsible for verifying the agent exists; this function
 * trusts the caller-supplied agent_id and will create no rows if the
 * input role list is empty (legitimate "this agent has no roles"
 * state — used during onboarding flows).
 */
export function setAgentRoles(db: Database, agentId: string, roleIds: string[]): AgentRoleAssignment[] {
  const dedup = Array.from(new Set(roleIds));
  if (dedup.length > 0) {
    const placeholders = dedup.map(() => "?").join(", ");
    const existing = (db.query(
      `SELECT id FROM roles WHERE id IN (${placeholders})`,
    ) as { all(...args: never[]): Array<{ id: string }> }).all(...(dedup as never[]));
    const validIds = new Set(existing.map((r) => r.id));
    const missing = dedup.filter((id) => !validIds.has(id));
    if (missing.length > 0) {
      throw new Error(`unknown role ids: ${missing.join(", ")}`);
    }
  }

  const ts = nowIso();
  db.transaction(() => {
    db.run("DELETE FROM agent_roles WHERE agent_id = ?", [agentId]);
    for (const roleId of dedup) {
      db.run(
        "INSERT INTO agent_roles (agent_id, role_id, assigned_at) VALUES (?, ?, ?)",
        [agentId, roleId, ts],
      );
    }
  })();
  return getAgentRoles(db, agentId);
}
