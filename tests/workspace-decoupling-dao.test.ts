import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { migrate, openFleetDb } from "../src/db.ts";
import {
  buildRoleDisplayId,
  deleteRepo,
  deleteRoleById,
  deleteScanDir,
  getRepoById,
  getRepoByName,
  getRepoByPath,
  getRoleByDisplayId,
  getRoleById,
  getScanDirById,
  insertRepo,
  insertRole,
  insertScanDir,
  listRepos,
  listAgentsByRepo,
  listAgentsByWorkspace,
  listScanDirs,
  markRepoMissing,
  parseRoleAddress,
  refreshRepoMeta,
  renameRepo,
  renameRoleById,
  runScanDir,
  setScanDirStartup,
} from "../src/workspace-decoupling-dao.ts";

let workspaceDir: string;
let dbPath: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "wa-dao-"));
  dbPath = join(workspaceDir, "ws.sqlite");
});

afterEach(() => {
  rmSync(workspaceDir, { recursive: true, force: true });
});

function freshDb() {
  const db = openFleetDb(dbPath);
  migrate(db);
  return db;
}

describe("workspace decoupling DAO — address helpers", () => {
  test("buildRoleDisplayId concatenates with colon", () => {
    expect(buildRoleDisplayId("whatsagent", "dev")).toBe("whatsagent:dev");
  });

  test("parseRoleAddress accepts canonical form", () => {
    expect(parseRoleAddress("whatsagent:dev")).toEqual({ repoName: "whatsagent", roleName: "dev" });
  });

  test.each([
    [""],
    [":"],
    [":dev"],
    ["whatsagent:"],
    ["whatsagent"],
    ["a:b:c"],
    ["whatsagent:dev:extra"],
    ["whats agent:dev"],
    ["whatsagent:de v"],
    ["whatsagent:de.v"],
  ])("parseRoleAddress rejects %p", (input) => {
    expect(() => parseRoleAddress(input)).toThrow();
  });
});

describe("workspace decoupling DAO — scan dirs", () => {
  test("insert/list/get/setStartup/delete round-trip", () => {
    const db = freshDb();
    try {
      const dir = mkdtempSync(join(tmpdir(), "wa-scan-"));
      try {
        const scan = insertScanDir(db, { absolutePath: dir, scanOnStartup: true });
        expect(scan.scan_on_startup).toBe(1);
        expect(listScanDirs(db)).toHaveLength(1);
        expect(getScanDirById(db, scan.id)?.id).toBe(scan.id);
        const flipped = setScanDirStartup(db, scan.id, false);
        expect(flipped.scan_on_startup).toBe(0);
        expect(deleteScanDir(db, scan.id)).toBe(true);
        expect(getScanDirById(db, scan.id)).toBeNull();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    } finally {
      db.close();
    }
  });

  test("absolute_path UNIQUE rejects duplicate", () => {
    const db = freshDb();
    try {
      const dir = mkdtempSync(join(tmpdir(), "wa-scan-"));
      try {
        insertScanDir(db, { absolutePath: dir });
        expect(() => insertScanDir(db, { absolutePath: dir })).toThrow();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    } finally {
      db.close();
    }
  });
});

describe("workspace decoupling DAO — repos", () => {
  test("insert default name + git_root + lookup paths", () => {
    const db = freshDb();
    try {
      const repoDir = mkdtempSync(join(tmpdir(), "wa-repo-"));
      try {
        mkdirSync(join(repoDir, ".git"));
        const repo = insertRepo(db, { absolutePath: repoDir });
        expect(repo.name).toBeTruthy();
        expect(repo.git_root).toBe(repoDir);
        expect(repo.missing_at).toBeNull();
        expect(getRepoById(db, repo.id)?.id).toBe(repo.id);
        expect(getRepoByPath(db, repoDir)?.id).toBe(repo.id);
        expect(getRepoByName(db, repo.name)?.id).toBe(repo.id);
      } finally {
        rmSync(repoDir, { recursive: true, force: true });
      }
    } finally {
      db.close();
    }
  });

  test("insertRepo uses provided name + sanitises", () => {
    const db = freshDb();
    try {
      const dir = mkdtempSync(join(tmpdir(), "wa-repo-"));
      try {
        const repo = insertRepo(db, { absolutePath: dir, name: "Custom Name!" });
        expect(repo.name).toBe("Custom_Name");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    } finally {
      db.close();
    }
  });

  test("rename respects collision", () => {
    const db = freshDb();
    try {
      const a = mkdtempSync(join(tmpdir(), "wa-a-"));
      const b = mkdtempSync(join(tmpdir(), "wa-b-"));
      try {
        const r1 = insertRepo(db, { absolutePath: a, name: "alpha" });
        insertRepo(db, { absolutePath: b, name: "beta" });
        expect(() => renameRepo(db, r1.id, "beta")).toThrow();
        const renamed = renameRepo(db, r1.id, "gamma");
        expect(renamed.name).toBe("gamma");
      } finally {
        rmSync(a, { recursive: true, force: true });
        rmSync(b, { recursive: true, force: true });
      }
    } finally {
      db.close();
    }
  });

  test("delete cascades to roles", () => {
    const db = freshDb();
    try {
      const dir = mkdtempSync(join(tmpdir(), "wa-r-"));
      try {
        const repo = insertRepo(db, { absolutePath: dir });
        insertRole(db, { repoId: repo.id, name: "agent" });
        expect(listAgentsByRepo(db, repo.id)).toHaveLength(1);
        deleteRepo(db, repo.id);
        expect(listAgentsByRepo(db, repo.id)).toHaveLength(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    } finally {
      db.close();
    }
  });

  test("markRepoMissing toggles + idempotent set", () => {
    const db = freshDb();
    try {
      const dir = mkdtempSync(join(tmpdir(), "wa-r-"));
      try {
        const repo = insertRepo(db, { absolutePath: dir });
        const a = markRepoMissing(db, repo.id, true)!;
        expect(a.missing_at).not.toBeNull();
        const b = markRepoMissing(db, repo.id, true)!;
        expect(b.missing_at).toBe(a.missing_at);
        const c = markRepoMissing(db, repo.id, false)!;
        expect(c.missing_at).toBeNull();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    } finally {
      db.close();
    }
  });

  test("refreshRepoMeta sets missing when path gone", () => {
    const db = freshDb();
    try {
      const dir = mkdtempSync(join(tmpdir(), "wa-r-"));
      const repo = insertRepo(db, { absolutePath: dir });
      rmSync(dir, { recursive: true, force: true });
      const refreshed = refreshRepoMeta(db, repo.id)!;
      expect(refreshed.missing_at).not.toBeNull();
    } finally {
      db.close();
    }
  });
});

describe("workspace decoupling DAO — roles (new shape)", () => {
  test("insertRole + getRoleById + display id", () => {
    const db = freshDb();
    try {
      const dir = mkdtempSync(join(tmpdir(), "wa-r-"));
      try {
        const repo = insertRepo(db, { absolutePath: dir, name: "alpha" });
        const role = insertRole(db, { repoId: repo.id, name: "dev", host: "claude-code" });
        expect(role.display_id).toBe("alpha:dev");
        expect(getRoleById(db, role.id)?.id).toBe(role.id);
        expect(getRoleByDisplayId(db, "alpha:dev")?.id).toBe(role.id);
        expect(getRoleByDisplayId(db, "alpha:nope")).toBeNull();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    } finally {
      db.close();
    }
  });

  test("insertRole rejects duplicate name within same repo", () => {
    const db = freshDb();
    try {
      const dir = mkdtempSync(join(tmpdir(), "wa-r-"));
      try {
        const repo = insertRepo(db, { absolutePath: dir, name: "alpha" });
        insertRole(db, { repoId: repo.id, name: "dev" });
        expect(() => insertRole(db, { repoId: repo.id, name: "dev" })).toThrow();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    } finally {
      db.close();
    }
  });

  test("insertRole allows same name across different repos", () => {
    const db = freshDb();
    try {
      const a = mkdtempSync(join(tmpdir(), "wa-a-"));
      const b = mkdtempSync(join(tmpdir(), "wa-b-"));
      try {
        const r1 = insertRepo(db, { absolutePath: a, name: "alpha" });
        const r2 = insertRepo(db, { absolutePath: b, name: "beta" });
        expect(() => {
          insertRole(db, { repoId: r1.id, name: "agent" });
          insertRole(db, { repoId: r2.id, name: "agent" });
        }).not.toThrow();
        expect(listAgentsByWorkspace(db).map((r) => r.display_id).sort()).toEqual(["alpha:agent", "beta:agent"]);
      } finally {
        rmSync(a, { recursive: true, force: true });
        rmSync(b, { recursive: true, force: true });
      }
    } finally {
      db.close();
    }
  });

  test("renameRoleById rejects intra-repo collision, allows rename to fresh name", () => {
    const db = freshDb();
    try {
      const dir = mkdtempSync(join(tmpdir(), "wa-r-"));
      try {
        const repo = insertRepo(db, { absolutePath: dir, name: "alpha" });
        const a = insertRole(db, { repoId: repo.id, name: "agent" });
        insertRole(db, { repoId: repo.id, name: "scout" });
        expect(() => renameRoleById(db, a.id, "scout")).toThrow();
        const renamed = renameRoleById(db, a.id, "ranger");
        expect(renamed.name).toBe("ranger");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    } finally {
      db.close();
    }
  });

  test("deleteRoleById removes the role, sibling untouched", () => {
    const db = freshDb();
    try {
      const dir = mkdtempSync(join(tmpdir(), "wa-r-"));
      try {
        const repo = insertRepo(db, { absolutePath: dir, name: "alpha" });
        const a = insertRole(db, { repoId: repo.id, name: "agent" });
        insertRole(db, { repoId: repo.id, name: "scout" });
        expect(deleteRoleById(db, a.id)).toBe(true);
        expect(listAgentsByRepo(db, repo.id).map((r) => r.name)).toEqual(["scout"]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    } finally {
      db.close();
    }
  });
});

describe("workspace decoupling DAO — runScanDir", () => {
  test("filters non-marker dirs, keeps marker dirs, dedupes", () => {
    const db = freshDb();
    try {
      const parent = mkdtempSync(join(tmpdir(), "wa-scan-"));
      try {
        // Three children: one with .git, one with package.json, one without markers.
        mkdirSync(join(parent, "git-repo", ".git"), { recursive: true });
        mkdirSync(join(parent, "node-repo"));
        writeFileSync(join(parent, "node-repo", "package.json"), "{}");
        mkdirSync(join(parent, "blank"));
        // Pre-register one of them to test dedupe.
        insertRepo(db, { absolutePath: join(parent, "git-repo"), name: "git-repo" });

        const scan = insertScanDir(db, { absolutePath: parent });
        const result = runScanDir(db, scan.id);
        expect(result.added.map((r) => r.absolute_path).sort()).toEqual([join(parent, "node-repo")]);
        // Skipped should include the blank (no marker) and the pre-registered git-repo (dedupe).
        expect(result.skipped.sort()).toEqual([join(parent, "blank"), join(parent, "git-repo")].sort());
        // last_scan_at populated.
        const refreshed = getScanDirById(db, scan.id);
        expect(refreshed?.last_scan_at).not.toBeNull();
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    } finally {
      db.close();
    }
  });

  test("missing scan-dir path produces empty added + skipped fallback", () => {
    const db = freshDb();
    try {
      const parent = mkdtempSync(join(tmpdir(), "wa-scan-"));
      const scan = insertScanDir(db, { absolutePath: parent });
      rmSync(parent, { recursive: true, force: true });
      const result = runScanDir(db, scan.id);
      expect(result.added).toHaveLength(0);
      expect(result.skipped).toEqual([parent]);
    } finally {
      db.close();
    }
  });

  test("repo name collision auto-suffixes", () => {
    const db = freshDb();
    try {
      // Pre-register a repo with name "shared" pointing at directory A.
      const dirA = mkdtempSync(join(tmpdir(), "wa-A-"));
      insertRepo(db, { absolutePath: dirA, name: "shared" });

      // Scan-dir contains a child "shared" (different absolute path, same default name).
      const parent = mkdtempSync(join(tmpdir(), "wa-scan-"));
      mkdirSync(join(parent, "shared", ".git"), { recursive: true });

      const scan = insertScanDir(db, { absolutePath: parent });
      const result = runScanDir(db, scan.id);
      expect(result.added).toHaveLength(1);
      expect(result.added[0]?.name).toBe("shared-2");

      rmSync(dirA, { recursive: true, force: true });
      rmSync(parent, { recursive: true, force: true });
    } finally {
      db.close();
    }
  });
});
