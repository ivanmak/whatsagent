import type { Database } from "bun:sqlite";

import { nowIso } from "./db.ts";

export const PERSONA_FIELD_NAMES = [
  "description",
  "responsibilities",
  "boundaries",
  "skills",
  "working_style",
  "extra_prompt",
] as const;

export type PersonaFieldName = typeof PERSONA_FIELD_NAMES[number];

export const PERSONA_FIELD_HARD_MAX = 32_000;
export const PERSONA_TOTAL_HARD_MAX = 64_000;

export const PERSONA_FIELD_SOFT_MAX: Record<PersonaFieldName, number> = {
  description: 280,
  responsibilities: 4_000,
  boundaries: 4_000,
  skills: 2_000,
  working_style: 2_000,
  extra_prompt: 8_000,
};
export const PERSONA_TOTAL_SOFT_MAX = 24_000;

export interface AgentPersonaFields {
  description: string;
  responsibilities: string;
  boundaries: string;
  skills: string;
  working_style: string;
  extra_prompt: string;
}

export interface AgentPersonaRow extends AgentPersonaFields {
  agent_id: string;
  created_at: string;
  updated_at: string;
}

export type AgentPersonaInput = Partial<Record<PersonaFieldName, unknown>>;
export type PersonaShape = Partial<AgentPersonaFields>;

export class PersonaSizeLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonaSizeLimitError";
  }
}

export function getAgentPersona(db: Database, agentId: string): AgentPersonaRow | null {
  return db.query<AgentPersonaRow, [string]>("SELECT * FROM agent_personas WHERE agent_id = ?").get(agentId) ?? null;
}

/**
 * Hard-limit check that performs no writes — callers (e.g. the role PATCH
 * endpoint) run this before any other mutation so an oversized persona is
 * rejected without partially-applied side effects.
 */
export function assertPersonaInputWithinHardLimits(input: AgentPersonaInput): void {
  assertPersonaWithinHardLimits(normalizePersonaFields(input));
}

export function upsertAgentPersona(db: Database, agentId: string, input: AgentPersonaInput): { row: AgentPersonaRow | null; warnings: string[] } {
  const fields = normalizePersonaFields(input);
  assertPersonaWithinHardLimits(fields);
  const warnings = personaWarnings(fields);

  if (personaIsEmpty(fields)) {
    deleteAgentPersona(db, agentId);
    return { row: null, warnings };
  }

  const now = nowIso();
  db.run(
    `INSERT INTO agent_personas (
      agent_id, description, responsibilities, boundaries, skills, working_style, extra_prompt, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      description = excluded.description,
      responsibilities = excluded.responsibilities,
      boundaries = excluded.boundaries,
      skills = excluded.skills,
      working_style = excluded.working_style,
      extra_prompt = excluded.extra_prompt,
      updated_at = excluded.updated_at`,
    [
      agentId,
      fields.description,
      fields.responsibilities,
      fields.boundaries,
      fields.skills,
      fields.working_style,
      fields.extra_prompt,
      now,
      now,
    ],
  );
  const row = getAgentPersona(db, agentId);
  if (!row) throw new Error("agent persona insert failed");
  return { row, warnings };
}

export function deleteAgentPersona(db: Database, agentId: string): boolean {
  const result = db.run("DELETE FROM agent_personas WHERE agent_id = ?", [agentId]);
  return result.changes > 0;
}

export function listAgentPersonas(db: Database, agentIds: string[]): Map<string, AgentPersonaRow> {
  const unique = Array.from(new Set(agentIds.filter(Boolean)));
  const result = new Map<string, AgentPersonaRow>();
  if (!unique.length) return result;
  const placeholders = unique.map(() => "?").join(", ");
  const rows = db.query<AgentPersonaRow, string[]>(`SELECT * FROM agent_personas WHERE agent_id IN (${placeholders})`).all(...unique);
  for (const row of rows) result.set(row.agent_id, row);
  return result;
}

export function personaForWhoami(row: AgentPersonaRow | null | undefined): PersonaShape | null {
  return shapePersona(row, { includeExtraPrompt: true });
}

export function personaForPeers(row: AgentPersonaRow | null | undefined): PersonaShape | null {
  return shapePersona(row, { includeExtraPrompt: false });
}

export function normalizePersonaFields(input: AgentPersonaInput): AgentPersonaFields {
  const normalized = {} as AgentPersonaFields;
  for (const field of PERSONA_FIELD_NAMES) normalized[field] = normalizePersonaField(input[field]);
  return normalized;
}

export function personaWarnings(fields: AgentPersonaFields): string[] {
  const warnings: string[] = [];
  for (const field of PERSONA_FIELD_NAMES) {
    const cap = PERSONA_FIELD_SOFT_MAX[field];
    if (fields[field].length > cap) warnings.push(`${field} exceeds soft limit (${cap} chars)`);
  }
  const total = personaTotalLength(fields);
  if (total > PERSONA_TOTAL_SOFT_MAX) warnings.push(`persona total exceeds soft limit (${PERSONA_TOTAL_SOFT_MAX} chars)`);
  return warnings;
}

function normalizePersonaField(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

function assertPersonaWithinHardLimits(fields: AgentPersonaFields): void {
  for (const field of PERSONA_FIELD_NAMES) {
    if (fields[field].length > PERSONA_FIELD_HARD_MAX) {
      throw new PersonaSizeLimitError(`${field} must be ${PERSONA_FIELD_HARD_MAX} characters or fewer`);
    }
  }
  const total = personaTotalLength(fields);
  if (total > PERSONA_TOTAL_HARD_MAX) {
    throw new PersonaSizeLimitError(`persona total must be ${PERSONA_TOTAL_HARD_MAX} characters or fewer`);
  }
}

function personaTotalLength(fields: AgentPersonaFields): number {
  return PERSONA_FIELD_NAMES.reduce((sum, field) => sum + fields[field].length, 0);
}

function personaIsEmpty(fields: AgentPersonaFields): boolean {
  return PERSONA_FIELD_NAMES.every(field => fields[field].length === 0);
}

function shapePersona(row: AgentPersonaRow | null | undefined, options: { includeExtraPrompt: boolean }): PersonaShape | null {
  if (!row) return null;
  const shaped: PersonaShape = {};
  for (const field of PERSONA_FIELD_NAMES) {
    if (field === "extra_prompt" && !options.includeExtraPrompt) continue;
    if (row[field]) shaped[field] = row[field];
  }
  return Object.keys(shaped).length ? shaped : null;
}
