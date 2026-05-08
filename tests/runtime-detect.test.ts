import { expect, test } from "bun:test";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { probeRuntime, probeAllRuntimes } from "../src/runner/runtime-detect.ts";

async function makeBinary(scriptBody: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "wa-detect-"));
  const path = join(dir, "fake-bin");
  await writeFile(path, scriptBody, "utf8");
  await chmod(path, 0o755);
  return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test("probeRuntime parses semver from stdout", async () => {
  const { path, cleanup } = await makeBinary("#!/usr/bin/env bash\necho '2.1.123 (Claude Code)'\n");
  try {
    const result = await probeRuntime("claude-code", path);
    expect(result.detected).toBe(true);
    expect(result.resolvedPath).toBe(path);
    expect(result.version).toBe("2.1.123");
    expect(result.rawVersionOutput).toBe("2.1.123 (Claude Code)");
    expect(result.error).toBeNull();
  } finally {
    await cleanup();
  }
});

test("probeRuntime handles codex-cli prefix", async () => {
  const { path, cleanup } = await makeBinary("#!/usr/bin/env bash\necho 'codex-cli 0.125.0'\n");
  try {
    const result = await probeRuntime("codex", path);
    expect(result.detected).toBe(true);
    expect(result.version).toBe("0.125.0");
  } finally {
    await cleanup();
  }
});

test("probeRuntime handles bare semver", async () => {
  const { path, cleanup } = await makeBinary("#!/usr/bin/env bash\necho '1.14.29'\n");
  try {
    const result = await probeRuntime("opencode", path);
    expect(result.detected).toBe(true);
    expect(result.version).toBe("1.14.29");
  } finally {
    await cleanup();
  }
});

test("probeRuntime returns not_found for missing PATH binary", async () => {
  const result = await probeRuntime("claude-code", "whatsagent-definitely-not-a-real-binary-xyz123");
  expect(result.detected).toBe(false);
  expect(result.resolvedPath).toBeNull();
  expect(result.error).toBe("not_found");
});

test("probeRuntime returns not_found for missing absolute path", async () => {
  const result = await probeRuntime("opencode", "/nonexistent/path/to/binary");
  expect(result.detected).toBe(false);
  expect(result.error).toBe("not_found");
  expect(result.resolvedPath).toBe("/nonexistent/path/to/binary");
});

test("probeRuntime flags nonzero exit", async () => {
  const { path, cleanup } = await makeBinary("#!/usr/bin/env bash\necho 'broken'\nexit 7\n");
  try {
    const result = await probeRuntime("claude-code", path);
    expect(result.detected).toBe(false);
    expect(result.resolvedPath).toBe(path);
    expect(result.error).toBe("nonzero_exit");
  } finally {
    await cleanup();
  }
});

test("probeRuntime flags timeout when binary hangs", async () => {
  const { path, cleanup } = await makeBinary("#!/usr/bin/env bash\nsleep 30\n");
  try {
    const result = await probeRuntime("claude-code", path);
    expect(result.detected).toBe(false);
    expect(result.resolvedPath).toBe(path);
    expect(result.error).toBe("timeout");
  } finally {
    await cleanup();
  }
}, 10_000);

test("probeRuntime returns version=null when --version output has no semver", async () => {
  const { path, cleanup } = await makeBinary("#!/usr/bin/env bash\necho 'no version here'\n");
  try {
    const result = await probeRuntime("claude-code", path);
    expect(result.detected).toBe(true);
    expect(result.version).toBeNull();
    expect(result.rawVersionOutput).toBe("no version here");
  } finally {
    await cleanup();
  }
});

test("probeAllRuntimes runs all four in parallel", async () => {
  const { path, cleanup } = await makeBinary("#!/usr/bin/env bash\necho '0.0.1'\n");
  try {
    const results = await probeAllRuntimes({
      claudeCode: { command: path, args: [], enabled: true },
      openCode: { command: path, args: [], enabled: true },
      codex: { command: path, args: [], enabled: true },
      pi: { command: path, args: [], enabled: true },
    });
    expect(results["claude-code"].detected).toBe(true);
    expect(results["opencode"].detected).toBe(true);
    expect(results["codex"].detected).toBe(true);
    expect(results["pi"].detected).toBe(true);
    for (const host of ["claude-code", "opencode", "codex", "pi"] as const) {
      expect(results[host].version).toBe("0.0.1");
      expect(results[host].resolvedPath).toBe(path);
    }
  } finally {
    await cleanup();
  }
});
