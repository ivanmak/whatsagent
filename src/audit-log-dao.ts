import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

import { nowIso } from "./db.ts";

/**
 * Append-only audit log of permission decisions and role-mutation events.
 *
 * Introduced in migration v16 for RBAC Phase 3 soft-enforcement. The same
 * table absorbs Phase 4 hard-deny rows and EP-SEC-C session/auth events
 * via new `kind` values — schema does not change between phases.
 *
 * `actor_agent_id` is NOT a foreign key. Agents can be deleted after a
 * row is written and the audit log must outlive its subjects. Readers
 * join to `agents` opportunistically and fall back to the raw id.
 */
export type AuditKind =
  | "grant_miss_soft"
  | "grant_check_pass"
  | "grant_miss_hard"
  | "role_assigned"
  | "role_revoked"
  | "role_grants_changed";

export interface AuditLogRow {
  id: string;
  ts: string;
  kind: string;
  actor_agent_id: string | null;
  target_kind: string | null;
  target_id: string | null;
  payload_json: string;
}

export interface AuditLogEntry extends Omit<AuditLogRow, "payload_json"> {
  payload: Record<string, unknown>;
  /**
   * Joined `<repo_name>:<agent_name>` for the actor agent at read time.
   * Computed via LEFT JOIN on `agents` + `workspace_repos`; falls back
   * to `null` when the agent has been deleted (the row's
   * `actor_agent_id` UUID still surfaces unchanged for forensic use).
   */
  actor_display_id: string | null;
}

export interface AppendAuditInput {
  kind: AuditKind | (string & {});
  actor_agent_id?: string | null;
  target_kind?: string | null;
  target_id?: string | null;
  payload: Record<string, unknown>;
}

export interface ListAuditFilter {
  kind?: string | string[];
  actor_agent_id?: string;
  target_kind?: string;
  target_id?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
  /**
   * Optional override for the upper bound on `limit`. Defaults to 500 to
   * keep the read endpoint paged. Bulk callers (CSV export) raise it so
   * a single response can serve a whole filtered window — without this
   * the export silently truncated at 500 rows. Callers that don't set
   * this fall back to the historical clamp.
   */
  maxLimit?: number;
}

export function appendAudit(db: Database, input: AppendAuditInput): AuditLogEntry {
  const id = randomUUID();
  const ts = nowIso();
  const payload_json = JSON.stringify(input.payload ?? {});
  db.run(
    "INSERT INTO audit_log (id, ts, kind, actor_agent_id, target_kind, target_id, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      ts,
      input.kind,
      input.actor_agent_id ?? null,
      input.target_kind ?? null,
      input.target_id ?? null,
      payload_json,
    ],
  );
  // Resolve actor display id for the return value. Round-trip via
  // getAuditEntry keeps the JOIN logic in one place; the row was just
  // inserted so this read is cheap (indexed + warm cache).
  const fresh = getAuditEntry(db, id);
  if (fresh) return fresh;
  // Defensive fallback — should be unreachable.
  return {
    id,
    ts,
    kind: input.kind,
    actor_agent_id: input.actor_agent_id ?? null,
    target_kind: input.target_kind ?? null,
    target_id: input.target_id ?? null,
    payload: input.payload ?? {},
    actor_display_id: null,
  };
}

export function getAuditEntry(db: Database, id: string): AuditLogEntry | null {
  const row = db.query<AuditLogRowJoined, [string]>(
    `${SELECT_AUDIT_WITH_ACTOR} WHERE audit_log.id = ?`,
  ).get(id);
  if (!row) return null;
  return rowToEntry(row);
}

/**
 * Paginated audit query with optional filters. Most-recent first by ts.
 *
 * `kind` accepts either a single string or an array; arrays expand to an
 * `IN (...)` clause. Caller-supplied limit is clamped to [1, 500] to keep
 * the audit endpoint cheap; UI pages at 50.
 */
export function listAudit(db: Database, filter: ListAuditFilter = {}): AuditLogEntry[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filter.kind !== undefined) {
    const kinds = Array.isArray(filter.kind) ? filter.kind : [filter.kind];
    if (kinds.length === 0) return [];
    const placeholders = kinds.map(() => "?").join(", ");
    where.push(`audit_log.kind IN (${placeholders})`);
    params.push(...kinds);
  }
  if (filter.actor_agent_id !== undefined) {
    where.push("audit_log.actor_agent_id = ?");
    params.push(filter.actor_agent_id);
  }
  if (filter.target_kind !== undefined) {
    where.push("audit_log.target_kind = ?");
    params.push(filter.target_kind);
  }
  if (filter.target_id !== undefined) {
    where.push("audit_log.target_id = ?");
    params.push(filter.target_id);
  }
  if (filter.since !== undefined) {
    where.push("audit_log.ts >= ?");
    params.push(filter.since);
  }
  if (filter.until !== undefined) {
    where.push("audit_log.ts < ?");
    params.push(filter.until);
  }

  const limit = clampLimit(filter.limit, filter.maxLimit);
  const offset = Math.max(0, filter.offset ?? 0);
  const whereSql = where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`;
  // Join the actor's `<repo_name>:<agent_name>` display id so the UI
  // renders a human-readable identifier. LEFT JOIN because the agent
  // row may have been deleted post-write; entry survives, display id
  // resolves to NULL, UI falls back to the raw UUID.
  const sql = `${SELECT_AUDIT_WITH_ACTOR}
               ${whereSql}
               ORDER BY audit_log.ts DESC
               LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = (db.query(sql) as { all(...args: never[]): AuditLogRowJoined[] }).all(...(params as never[]));
  return rows.map(rowToEntry);
}

/**
 * Count rows matching the filter. Used by the Audit subtab summary cards
 * and the inner-tabbar badge. Same filter shape as `listAudit` minus
 * limit/offset.
 */
export function countAudit(db: Database, filter: Omit<ListAuditFilter, "limit" | "offset"> = {}): number {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filter.kind !== undefined) {
    const kinds = Array.isArray(filter.kind) ? filter.kind : [filter.kind];
    if (kinds.length === 0) return 0;
    const placeholders = kinds.map(() => "?").join(", ");
    where.push(`kind IN (${placeholders})`);
    params.push(...kinds);
  }
  if (filter.actor_agent_id !== undefined) {
    where.push("actor_agent_id = ?");
    params.push(filter.actor_agent_id);
  }
  if (filter.target_kind !== undefined) {
    where.push("target_kind = ?");
    params.push(filter.target_kind);
  }
  if (filter.target_id !== undefined) {
    where.push("target_id = ?");
    params.push(filter.target_id);
  }
  if (filter.since !== undefined) {
    where.push("ts >= ?");
    params.push(filter.since);
  }
  if (filter.until !== undefined) {
    where.push("ts < ?");
    params.push(filter.until);
  }

  const whereSql = where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`;
  const row = (db.query(`SELECT COUNT(*) AS n FROM audit_log ${whereSql}`) as {
    get(...args: never[]): { n: number } | null;
  }).get(...(params as never[]));
  return row?.n ?? 0;
}

/**
 * Distinct actor_agent_ids that have at least one row matching the
 * filter. Used to render the Audit subtab "Agents w/ misses" summary
 * card and to populate the Agent filter dropdown.
 */
export function listAuditActors(db: Database, filter: Omit<ListAuditFilter, "limit" | "offset" | "actor_agent_id"> = {}): string[] {
  const where: string[] = ["actor_agent_id IS NOT NULL"];
  const params: unknown[] = [];
  if (filter.kind !== undefined) {
    const kinds = Array.isArray(filter.kind) ? filter.kind : [filter.kind];
    if (kinds.length === 0) return [];
    const placeholders = kinds.map(() => "?").join(", ");
    where.push(`kind IN (${placeholders})`);
    params.push(...kinds);
  }
  if (filter.target_kind !== undefined) {
    where.push("target_kind = ?");
    params.push(filter.target_kind);
  }
  if (filter.target_id !== undefined) {
    where.push("target_id = ?");
    params.push(filter.target_id);
  }
  if (filter.since !== undefined) {
    where.push("ts >= ?");
    params.push(filter.since);
  }
  if (filter.until !== undefined) {
    where.push("ts < ?");
    params.push(filter.until);
  }
  const sql = `SELECT DISTINCT actor_agent_id FROM audit_log WHERE ${where.join(" AND ")} ORDER BY actor_agent_id`;
  const rows = (db.query(sql) as {
    all(...args: never[]): Array<{ actor_agent_id: string }>;
  }).all(...(params as never[]));
  return rows.map((r) => r.actor_agent_id);
}

interface AuditLogRowJoined extends AuditLogRow {
  actor_repo_name: string | null;
  actor_role_name: string | null;
}

const SELECT_AUDIT_WITH_ACTOR = `SELECT
  audit_log.id, audit_log.ts, audit_log.kind, audit_log.actor_agent_id,
  audit_log.target_kind, audit_log.target_id, audit_log.payload_json,
  workspace_repos.name AS actor_repo_name,
  agents.name AS actor_role_name
FROM audit_log
LEFT JOIN agents ON agents.id = audit_log.actor_agent_id
LEFT JOIN workspace_repos ON workspace_repos.id = agents.repo_id`;

function rowToEntry(row: AuditLogRowJoined): AuditLogEntry {
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.payload_json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    payload = { _raw: row.payload_json };
  }
  const display = row.actor_repo_name && row.actor_role_name
    ? `${row.actor_repo_name}:${row.actor_role_name}`
    : null;
  return {
    id: row.id,
    ts: row.ts,
    kind: row.kind,
    actor_agent_id: row.actor_agent_id,
    target_kind: row.target_kind,
    target_id: row.target_id,
    payload,
    actor_display_id: display,
  };
}

function clampLimit(raw: number | undefined, maxOverride?: number): number {
  const max = typeof maxOverride === "number" && Number.isFinite(maxOverride) && maxOverride > 0
    ? Math.floor(maxOverride)
    : 500;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return Math.min(50, max);
  if (raw < 1) return 1;
  if (raw > max) return max;
  return Math.floor(raw);
}
