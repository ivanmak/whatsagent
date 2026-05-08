/**
 * Unit coverage for the runner protocol path helpers (EP-DEC-RUN WA-002).
 * Verifies displayId-aware filesystem sanitisation: `:` → `__`, other
 * non-FS-safe chars → `_`, empty input → `role`. Bare names without `:`
 * keep their existing behaviour so WA-002 stays tsc-green for unmigrated
 * callers.
 *
 * WA-003 adds registry coverage: legacy `<role>.runner.json` files
 * lacking a `display_id` field are filtered out by `discoverRunners`,
 * never matched by filename (advisor msg #12).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  normalizeHostType,
  runnerLogPath,
  runnerMetadataPath,
  runnerSocketPath,
  safeRoleFileName,
} from "../src/runner/protocol.ts";
import { discoverRunners } from "../src/runner/registry.ts";

describe("safeRoleFileName (WA-002 displayId form)", () => {
  test("displayId `repo:role` becomes `repo__role`", () => {
    expect(safeRoleFileName("whatsagent:main")).toBe("whatsagent__main");
    expect(safeRoleFileName("alpha:dev")).toBe("alpha__dev");
  });

  test("bare name (no colon) keeps existing behaviour", () => {
    expect(safeRoleFileName("main")).toBe("main");
    expect(safeRoleFileName("dev-1")).toBe("dev-1");
    expect(safeRoleFileName("snake_case")).toBe("snake_case");
  });

  test("non-FS-safe chars outside [A-Za-z0-9_-] collapse to `_`", () => {
    expect(safeRoleFileName("foo bar")).toBe("foo_bar");
    expect(safeRoleFileName("foo!@bar")).toBe("foo_bar");
  });

  test("empty input falls back to `role`", () => {
    expect(safeRoleFileName("")).toBe("role");
  });

  test("path helpers compose displayId form into expected file names", () => {
    expect(runnerMetadataPath("/run", "alpha:main")).toBe("/run/alpha__main.runner.json");
    expect(runnerSocketPath("/run", "alpha:main")).toBe("/run/alpha__main.sock");
    expect(runnerLogPath("/logs", "alpha:main")).toBe("/logs/runner-alpha__main.log");
  });
});

describe("normalizeHostType (EP-031 WA-PI-1: pi joins claude-code/opencode/codex)", () => {
  test("each canonical host name returns itself", () => {
    expect(normalizeHostType("claude-code")).toBe("claude-code");
    expect(normalizeHostType("opencode")).toBe("opencode");
    expect(normalizeHostType("codex")).toBe("codex");
    expect(normalizeHostType("pi")).toBe("pi");
  });

  test("'default' falls back to provided fallback", () => {
    expect(normalizeHostType("default", "pi")).toBe("pi");
    expect(normalizeHostType(undefined, "claude-code")).toBe("claude-code");
  });

  test("unknown host throws", () => {
    expect(() => normalizeHostType("vim")).toThrow(/Invalid host type/);
    expect(() => normalizeHostType("gemini")).toThrow(/Invalid host type/);
  });
});

describe("discoverRunners (WA-003 legacy-no-display_id filter)", () => {
  let runDir: string;

  beforeEach(async () => {
    runDir = await mkdtemp(join(tmpdir(), "wa-runner-discover-"));
    await mkdir(runDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true });
  });

  test("entries without display_id are ignored, never matched by filename (advisor msg #12)", async () => {
    // Legacy stamp: pre-cutover writer (or hand-rolled) with no display_id.
    await writeFile(join(runDir, "main.runner.json"), JSON.stringify({
      fleet_id: "fleet-test",
      role: "main",
      session_id: "session-legacy",
      host_type: "claude-code",
      runner_pid: process.pid,
      cwd: "/tmp",
      socket_path: join(runDir, "main.sock"),
      started_at: new Date().toISOString(),
    }), "utf8");

    // WA-003-compliant stamp under a different bare-name slot.
    await writeFile(join(runDir, "alpha__dev.runner.json"), JSON.stringify({
      fleet_id: "fleet-test",
      role: "dev",
      display_id: "alpha:dev",
      session_id: "session-fresh",
      host_type: "claude-code",
      runner_pid: process.pid,
      cwd: "/tmp",
      socket_path: join(runDir, "alpha__dev.sock"),
      started_at: new Date().toISOString(),
    }), "utf8");

    const runners = await discoverRunners(runDir);
    expect(runners).toHaveLength(1);
    expect(runners[0]!.display_id).toBe("alpha:dev");
    expect(runners[0]!.role).toBe("dev");
    expect(runners.find((r) => r.role === "main")).toBeUndefined();
  });

  test("entries with empty-string display_id are also ignored", async () => {
    await writeFile(join(runDir, "main.runner.json"), JSON.stringify({
      fleet_id: "fleet-test",
      role: "main",
      display_id: "",
      session_id: "session-empty",
      host_type: "claude-code",
      runner_pid: process.pid,
      cwd: "/tmp",
      socket_path: join(runDir, "main.sock"),
      started_at: new Date().toISOString(),
    }), "utf8");

    const runners = await discoverRunners(runDir);
    expect(runners).toHaveLength(0);
  });

  test("corrupt JSON yields a sentinel unreachable entry (carrying empty display_id)", async () => {
    await writeFile(join(runDir, "broken.runner.json"), "{not valid json", "utf8");
    const runners = await discoverRunners(runDir);
    expect(runners).toHaveLength(1);
    expect(runners[0]!.reachable).toBe(false);
    expect(runners[0]!.display_id).toBe("");
  });
});
