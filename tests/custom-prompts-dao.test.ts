import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createCustomPrompt,
  deleteCustomPrompt,
  DuplicateCustomPromptTitleError,
  getCustomPromptById,
  listCustomPrompts,
  updateCustomPrompt,
} from "../src/custom-prompts-dao.ts";
import { migrateDaemonDb, openDaemonDb } from "../src/daemon-db.ts";
import { daemonHomePaths } from "../src/paths.ts";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "wa-prompts-dao-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("custom prompts DAO", () => {
  test("creates, lists, updates, and deletes prompts", () => {
    const db = openDaemonDb(daemonHomePaths(home).daemonDbPath);
    try {
      migrateDaemonDb(db);
      const beta = createCustomPrompt(db, { title: "Beta", body: "second" });
      const alpha = createCustomPrompt(db, { title: "Alpha", body: "first" });

      expect(listCustomPrompts(db).map((prompt) => prompt.title)).toEqual(["Alpha", "Beta"]);
      expect(getCustomPromptById(db, alpha.id)).toMatchObject({ title: "Alpha", body: "first" });

      const updated = updateCustomPrompt(db, beta.id, { title: "Gamma", body: "updated" });
      expect(updated).toMatchObject({ title: "Gamma", body: "updated" });
      expect(deleteCustomPrompt(db, alpha.id)).toBe(true);
      expect(deleteCustomPrompt(db, alpha.id)).toBe(false);
      expect(listCustomPrompts(db).map((prompt) => prompt.title)).toEqual(["Gamma"]);
    } finally {
      db.close();
    }
  });

  test("rejects duplicate titles and invalid fields", () => {
    const db = openDaemonDb(daemonHomePaths(home).daemonDbPath);
    try {
      migrateDaemonDb(db);
      const prompt = createCustomPrompt(db, { title: "Shared", body: "one" });
      expect(() => createCustomPrompt(db, { title: "Shared", body: "two" })).toThrow(DuplicateCustomPromptTitleError);
      expect(() => updateCustomPrompt(db, prompt.id, { title: "" })).toThrow("title is required");
      expect(() => updateCustomPrompt(db, prompt.id, { body: "x".repeat(32_001) })).toThrow("body must be 0-32000 characters");
      expect(() => updateCustomPrompt(db, "missing", { title: "Missing" })).toThrow("custom prompt not found");
    } finally {
      db.close();
    }
  });
});
