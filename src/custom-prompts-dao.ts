import type { Database } from "bun:sqlite";

import { DEFAULT_MESSAGE_MAX_BODY_CHARS } from "./db.ts";
import { nowIso } from "./daemon-db.ts";

export interface CustomPromptRow {
  id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface CreateCustomPromptInput {
  title?: unknown;
  body?: unknown;
}

export interface UpdateCustomPromptInput {
  title?: unknown;
  body?: unknown;
}

export class DuplicateCustomPromptTitleError extends Error {
  constructor(title: string) {
    super(`custom prompt title already exists: ${title}`);
    this.name = "DuplicateCustomPromptTitleError";
  }
}

export function listCustomPrompts(db: Database): CustomPromptRow[] {
  return db.query<CustomPromptRow, []>("SELECT * FROM custom_prompts ORDER BY title ASC").all();
}

export function getCustomPromptById(db: Database, id: string): CustomPromptRow | null {
  return db.query<CustomPromptRow, [string]>("SELECT * FROM custom_prompts WHERE id = ?").get(id) ?? null;
}

export function createCustomPrompt(db: Database, input: CreateCustomPromptInput): CustomPromptRow {
  const title = normalizeCustomPromptTitle(input.title);
  const body = normalizeCustomPromptBody(input.body);
  ensureUniqueTitle(db, title);
  const now = nowIso();
  const id = crypto.randomUUID();
  db.run(
    "INSERT INTO custom_prompts (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [id, title, body, now, now],
  );
  const row = getCustomPromptById(db, id);
  if (!row) throw new Error("custom prompt insert failed");
  return row;
}

export function updateCustomPrompt(db: Database, id: string, input: UpdateCustomPromptInput): CustomPromptRow {
  const existing = getCustomPromptById(db, id);
  if (!existing) throw new Error("custom prompt not found");
  const title = input.title === undefined ? existing.title : normalizeCustomPromptTitle(input.title);
  const body = input.body === undefined ? existing.body : normalizeCustomPromptBody(input.body);
  if (title !== existing.title) ensureUniqueTitle(db, title, id);
  db.run("UPDATE custom_prompts SET title = ?, body = ?, updated_at = ? WHERE id = ?", [title, body, nowIso(), id]);
  return getCustomPromptById(db, id) ?? existing;
}

export function deleteCustomPrompt(db: Database, id: string): boolean {
  const result = db.run("DELETE FROM custom_prompts WHERE id = ?", [id]);
  return result.changes > 0;
}

export function normalizeCustomPromptTitle(value: unknown): string {
  if (typeof value !== "string") throw new Error("title is required");
  const title = value.trim();
  if (!title) throw new Error("title is required");
  if (title.length > 120) throw new Error("title must be 1-120 characters");
  return title;
}

export function normalizeCustomPromptBody(value: unknown): string {
  if (typeof value !== "string") throw new Error("body must be a string");
  if (value.length > DEFAULT_MESSAGE_MAX_BODY_CHARS) throw new Error(`body must be 0-${DEFAULT_MESSAGE_MAX_BODY_CHARS} characters`);
  return value;
}

function ensureUniqueTitle(db: Database, title: string, exceptId?: string): void {
  const existing = db.query<{ id: string }, [string]>("SELECT id FROM custom_prompts WHERE title = ?").get(title);
  if (existing && existing.id !== exceptId) throw new DuplicateCustomPromptTitleError(title);
}
