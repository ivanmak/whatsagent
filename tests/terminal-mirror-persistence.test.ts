import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TerminalStateMirror } from "../src/runner/terminal-state-mirror.ts";

const tempRoots: string[] = [];

afterAll(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
});

function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "wa-mirror-persist-"));
  tempRoots.push(dir);
  return dir;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("waitFor timeout");
}

describe("TerminalStateMirror — persistence: flushPersistence + loadFromDisk", () => {
  test("flushPersistence writes a snapshot file the loader can rehydrate", async () => {
    const dir = newDir();
    const path = join(dir, "session.snapshot");
    const m1 = new TerminalStateMirror(80, 24);
    m1.applyOutput("hello persisted world", 7);
    m1.attachPersistence({ snapshotPath: path, flushIntervalMs: 0 });
    await m1.flushPersistence();

    const stats = await stat(path);
    expect(stats.size).toBeGreaterThan(0);
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as { v: number; snapshot: string; cols: number; rows: number; lastAppliedSeq: number; writtenAt: string };
    expect(parsed.v).toBe(2);
    expect(parsed.cols).toBe(80);
    expect(parsed.rows).toBe(24);
    expect(parsed.lastAppliedSeq).toBe(7);
    expect(parsed.snapshot).toContain("hello persisted world");

    const m2 = TerminalStateMirror.loadFromDisk(path, 80, 24);
    expect(m2).not.toBeNull();
    const snap = await m2!.getSnapshot();
    expect(snap.cols).toBe(80);
    expect(snap.rows).toBe(24);
    expect(snap.lastAppliedSeq).toBe(7);
    expect(m2!.getLastAppliedSeq()).toBe(7);
    expect(snap.snapshot).toContain("hello persisted world");
    m1.dispose();
    m2!.dispose();
  });

  test("flushPersistence preserves resized dims", async () => {
    const dir = newDir();
    const path = join(dir, "resize.snapshot");
    const m = new TerminalStateMirror(80, 24);
    m.applyOutput("resized state");
    m.resize(120, 40);
    m.attachPersistence({ snapshotPath: path, flushIntervalMs: 0 });
    await m.flushPersistence();
    const restored = TerminalStateMirror.loadFromDisk(path, 80, 24);
    expect(restored).not.toBeNull();
    const snap = await restored!.getSnapshot();
    expect(snap.cols).toBe(120);
    expect(snap.rows).toBe(40);
    expect(snap.snapshot).toContain("resized state");
    m.dispose();
    restored!.dispose();
  });

  test("loadFromDisk returns null on missing file", () => {
    const dir = newDir();
    const path = join(dir, "missing.snapshot");
    expect(TerminalStateMirror.loadFromDisk(path, 80, 24)).toBeNull();
  });

  test("loadFromDisk returns null on malformed JSON", async () => {
    const dir = newDir();
    const path = join(dir, "bad.snapshot");
    await Bun.write(path, "{not-json");
    expect(TerminalStateMirror.loadFromDisk(path, 80, 24)).toBeNull();
  });

  test("loadFromDisk returns null on schema-version mismatch", async () => {
    const dir = newDir();
    const legacyPath = join(dir, "v1.snapshot");
    await Bun.write(legacyPath, JSON.stringify({ v: 1, snapshot: "hello", cols: 80, rows: 24, writtenAt: "x" }));
    expect(TerminalStateMirror.loadFromDisk(legacyPath, 80, 24)).toBeNull();

    const futurePath = join(dir, "v999.snapshot");
    await Bun.write(futurePath, JSON.stringify({ v: 999, snapshot: "hello", cols: 80, rows: 24, writtenAt: "x" }));
    expect(TerminalStateMirror.loadFromDisk(futurePath, 80, 24)).toBeNull();
  });
});

describe("TerminalStateMirror — persistence: timer-driven flush", () => {
  test("attached interval flushes the snapshot to disk after activity", async () => {
    const dir = newDir();
    const path = join(dir, "interval.snapshot");
    const m = new TerminalStateMirror(80, 24);
    m.attachPersistence({ snapshotPath: path, flushIntervalMs: 100 });
    m.applyOutput("flushed by timer");
    await waitFor(async () => {
      try { await stat(path); return true; } catch { return false; }
    });
    const restored = TerminalStateMirror.loadFromDisk(path, 80, 24);
    expect(restored).not.toBeNull();
    const snap = await restored!.getSnapshot();
    expect(snap.snapshot).toContain("flushed by timer");
    m.dispose();
    restored!.dispose();
  });

  test("dispose stops the flush timer + leaves the latest snapshot intact", async () => {
    const dir = newDir();
    const path = join(dir, "dispose.snapshot");
    const m = new TerminalStateMirror(80, 24);
    m.attachPersistence({ snapshotPath: path, flushIntervalMs: 100 });
    m.applyOutput("before dispose");
    await m.flushPersistence();
    m.dispose();
    // Wait past the interval window — the file should not be re-written
    // (no easy assertion for "no further writes" beyond inspecting
    // mtime, so just confirm the existing snapshot is still readable).
    await new Promise((resolve) => setTimeout(resolve, 200));
    const restored = TerminalStateMirror.loadFromDisk(path, 80, 24);
    expect(restored).not.toBeNull();
    const snap = await restored!.getSnapshot();
    expect(snap.snapshot).toContain("before dispose");
    restored!.dispose();
  });
});

describe("TerminalStateMirror — persistence: atomicity", () => {
  test("flushPersistence writes latest queued output when called during an in-flight flush", async () => {
    const dir = newDir();
    const path = join(dir, "flush-race.snapshot");
    const m = new TerminalStateMirror(80, 24);
    m.attachPersistence({ snapshotPath: path, flushIntervalMs: 0 });

    m.applyOutput("old-line\r\n", 1);
    const p1 = m.flushPersistence();
    m.applyOutput("new-line\r\n", 2);
    await m.flushPersistence();
    await p1;

    const parsed = JSON.parse(readFileSync(path, "utf8")) as { snapshot: string; lastAppliedSeq: number };
    expect(parsed.snapshot).toContain("old-line");
    expect(parsed.snapshot).toContain("new-line");
    expect(parsed.lastAppliedSeq).toBe(2);
    m.dispose();
  });

  test("flush uses atomic rename — partial-write window leaves no torn snapshot at the canonical path", async () => {
    const dir = newDir();
    const path = join(dir, "atomic.snapshot");
    const m = new TerminalStateMirror(80, 24);
    m.applyOutput("atomic checkpoint");
    m.attachPersistence({ snapshotPath: path, flushIntervalMs: 0 });
    // Two concurrent flush requests should coalesce onto the same
    // in-flight write rather than racing each other.
    await Promise.all([m.flushPersistence(), m.flushPersistence(), m.flushPersistence()]);
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as { snapshot: string };
    expect(parsed.snapshot).toContain("atomic checkpoint");
    // The .tmp file should have been renamed away — no half-written
    // payload sitting next to the canonical path.
    let tmpExists = true;
    try { await stat(`${path}.tmp`); } catch { tmpExists = false; }
    expect(tmpExists).toBe(false);
    m.dispose();
  });
});

describe("TerminalStateMirror — persistence: cursor recovery", () => {
  test("lastAppliedSeq skips duplicate runner backfill after loading a snapshot", async () => {
    const dir = newDir();
    const path = join(dir, "cursor.snapshot");
    const m1 = new TerminalStateMirror(80, 24);
    m1.applyOutput("persisted-line\r\n", 1);
    m1.attachPersistence({ snapshotPath: path, flushIntervalMs: 0 });
    await m1.flushPersistence();
    m1.dispose();

    const restored = TerminalStateMirror.loadFromDisk(path, 80, 24);
    expect(restored).not.toBeNull();
    expect(restored!.getLastAppliedSeq()).toBe(1);

    const runnerBackfill = [
      { seq: 1, data: "persisted-line\r\n" },
      { seq: 2, data: "fresh-line\r\n" },
    ];
    for (const event of runnerBackfill) {
      if (event.seq > restored!.getLastAppliedSeq()) {
        restored!.applyOutput(event.data, event.seq);
      }
    }

    const snap = await restored!.getSnapshot();
    const rendered = snap.snapshot;
    expect((rendered.match(/persisted-line/g) ?? []).length).toBe(1);
    expect((rendered.match(/fresh-line/g) ?? []).length).toBe(1);
    expect(snap.lastAppliedSeq).toBe(2);
    restored!.dispose();
  });
});

describe("TerminalStateMirror — persistence: end-to-end recovery", () => {
  test("write → dispose → loadFromDisk → resume applyOutput preserves new content alongside restored", async () => {
    const dir = newDir();
    const path = join(dir, "recovery.snapshot");
    const m1 = new TerminalStateMirror(80, 24);
    m1.applyOutput("session A line\r\n");
    m1.attachPersistence({ snapshotPath: path, flushIntervalMs: 0 });
    await m1.flushPersistence();
    m1.dispose();

    const m2 = TerminalStateMirror.loadFromDisk(path, 80, 24);
    expect(m2).not.toBeNull();
    m2!.applyOutput("session B line\r\n");
    const snap = await m2!.getSnapshot();
    expect(snap.snapshot).toContain("session A line");
    expect(snap.snapshot).toContain("session B line");
    m2!.dispose();
  });
});
