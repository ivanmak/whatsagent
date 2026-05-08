#!/usr/bin/env node
// Bun's tar extraction strips the execute bit from native prebuild helper
// binaries on macOS, so node-pty's `spawn-helper` arrives without +x and
// posix_spawnp fails with "Error: posix_spawnp failed." the first time a
// runner tries to launch a PTY child.
//
// Re-apply the execute bit on every install. Idempotent + safe on Linux
// (no-op since the prebuild dir doesn't exist there).
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = "node_modules/node-pty/prebuilds";
if (!existsSync(root)) process.exit(0);

let fixed = 0;
for (const entry of readdirSync(root)) {
  const dir = join(root, entry);
  if (!statSync(dir).isDirectory()) continue;
  const helper = join(dir, "spawn-helper");
  if (!existsSync(helper)) continue;
  const mode = statSync(helper).mode & 0o777;
  if ((mode & 0o111) === 0o111) continue; // already executable
  chmodSync(helper, 0o755);
  fixed++;
}

if (fixed > 0) console.log(`fix-node-pty-perms: chmod +x on ${fixed} spawn-helper file(s)`);
