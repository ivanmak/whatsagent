import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal } from "@xterm/headless";
import { existsSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";

const TERMINAL_SCROLLBACK = 10_000;

export interface TerminalRestoreSnapshot {
  snapshot: string;
  cols: number;
  rows: number;
  /** Runner output seq fully reflected in this snapshot. */
  lastAppliedSeq: number;
}

export interface TerminalMirrorPersistenceOptions {
  /** Atomic-rename target. The mirror writes `<snapshotPath>.tmp` then
   * renames to keep readers from observing torn snapshots on crash. */
  snapshotPath: string;
  /** Periodic flush interval in ms. Default 1000. The runtime clamps to
   * [100, 60_000]. Set to 0 to disable the timer (write only on
   * `flushPersistence()` calls). */
  flushIntervalMs?: number;
}

interface PersistedSnapshot {
  /** Schema version. Bump on incompatible shape changes. */
  v: 2;
  /** Serialized ANSI snapshot from `@xterm/addon-serialize`. */
  snapshot: string;
  cols: number;
  rows: number;
  /** Runner output seq fully reflected in `snapshot`. */
  lastAppliedSeq: number;
  /** ISO timestamp of write. Diagnostic only. */
  writtenAt: string;
}

// EP-029 T6 fix — modes that SerializeAddon does NOT capture in its
// output. Confirmed empirically: ?1005, ?1006, ?1015, ?1016. The
// runtime side (e.g. OpenCode TUI) relies on ?1006 (SGR extended
// mouse) for accurate click/wheel coordinates; without it the
// fallback X10 format is either misformatted or interpreted at the
// wrong column. Mirror sniffs DECSET/DECRST sequences in the input
// stream and re-emits the active set as a prefix on getSnapshot so
// the restore frame faithfully reconstitutes mouse/paste mode.
const SNAPSHOT_PASSTHROUGH_MODES = ["1005", "1006", "1015", "1016"] as const;
const PASSTHROUGH_MODE_REGEX = /\x1b\[\?(1005|1006|1015|1016)([hl])/g;

export class TerminalStateMirror {
  private readonly terminal: Terminal;
  private readonly serializeAddon = new SerializeAddon();
  private operationQueue: Promise<void> = Promise.resolve();
  private persistOptions: TerminalMirrorPersistenceOptions | null = null;
  private persistTimer: ReturnType<typeof setInterval> | null = null;
  private persistInFlight: Promise<void> | null = null;
  private persistDirtyDuringFlush = false;
  private disposed = false;
  private lastAppliedSeq = 0;
  /** Set of DECSET mode numbers active per the live input stream that
   * SerializeAddon does not include in `serialize()` output. Tracked
   * via input-side regex sniffing in `applyOutput`. Re-emitted as a
   * prefix on `getSnapshot()` so a restore frame's first writes
   * re-establish the active modes. */
  private readonly passthroughModes = new Set<string>();

  constructor(cols: number, rows: number) {
    this.terminal = new Terminal({
      allowProposedApi: true,
      cols,
      rows,
      scrollback: TERMINAL_SCROLLBACK,
    });
    this.terminal.loadAddon(this.serializeAddon);
  }

  applyOutput(chunk: Buffer | string, seq?: number): void {
    const appliedSeq = normalizeSeq(seq);
    const payload = typeof chunk === "string" ? chunk : new Uint8Array(chunk);
    // Sniff DECSET/DECRST for modes SerializeAddon doesn't preserve so
    // getSnapshot() can re-emit them on restore. Cheap regex scan via
    // matchAll; alternative (post-restore re-replay of entire ANSI
    // history) is bounded only by daemon process lifetime.
    const text = typeof chunk === "string" ? chunk : decodeForSniffing(chunk);
    if (text) {
      for (const match of text.matchAll(PASSTHROUGH_MODE_REGEX)) {
        const mode = match[1]!;
        const onOff = match[2]!;
        if (onOff === "h") this.passthroughModes.add(mode);
        else this.passthroughModes.delete(mode);
      }
    }
    this.enqueueOperation(
      () =>
        new Promise<void>((resolve) => {
          this.terminal.write(payload as Uint8Array | string, () => {
            if (appliedSeq !== null) this.commitLastAppliedSeq(appliedSeq);
            resolve();
          });
        }),
    );
  }

  resize(cols: number, rows: number): void {
    if (cols === this.terminal.cols && rows === this.terminal.rows) {
      return;
    }
    this.enqueueOperation(() => {
      this.terminal.resize(cols, rows);
    });
  }

  getLastAppliedSeq(): number {
    return this.lastAppliedSeq;
  }

  markLastAppliedSeq(seq: unknown): void {
    const n = normalizeSeq(seq);
    if (n === null) return;
    this.enqueueOperation(() => {
      this.commitLastAppliedSeq(n);
    });
  }

  async getSnapshot(): Promise<TerminalRestoreSnapshot> {
    await this.operationQueue;
    let snapshot = this.serializeAddon.serialize();
    if (this.passthroughModes.size > 0) {
      let prefix = "";
      for (const mode of SNAPSHOT_PASSTHROUGH_MODES) {
        if (this.passthroughModes.has(mode)) prefix += `\x1b[?${mode}h`;
      }
      snapshot = prefix + snapshot;
    }
    return {
      snapshot,
      cols: this.terminal.cols,
      rows: this.terminal.rows,
      lastAppliedSeq: this.lastAppliedSeq,
    };
  }

  /**
   * EP-029 T7 — turn on disk persistence. The mirror periodically writes
   * its full state to `snapshotPath` (atomic via `<path>.tmp` + rename).
   * Crash recovery: pair with `TerminalStateMirror.loadFromDisk(...)`
   * at daemon start to rehydrate the mirror before the first WS open.
   */
  attachPersistence(opts: TerminalMirrorPersistenceOptions): void {
    if (this.disposed) return;
    this.detachPersistence();
    this.persistOptions = opts;
    const interval = clampInterval(opts.flushIntervalMs ?? 1_000);
    if (interval > 0) {
      this.persistTimer = setInterval(() => {
        void this.flushPersistence().catch(() => undefined);
      }, interval);
      // Allow the timer to keep the event loop alive only while the
      // process intends to. Daemon's stop() disposes mirrors first
      // anyway, so unref'ing here is safe.
      this.persistTimer.unref?.();
    }
  }

  detachPersistence(): void {
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }
    this.persistOptions = null;
  }

  /**
   * Force a single flush. Returns the in-flight write promise so callers
   * can await disk durability (e.g. daemon stop wants the latest state
   * persisted before exiting).
   */
  async flushPersistence(): Promise<void> {
    if (!this.persistOptions) return;
    if (this.persistInFlight) {
      // A caller is asking for durability while an older flush may have
      // already captured an older operationQueue tail. Mark dirty and let
      // the in-flight loop write again; if the request races after the
      // loop's final dirty check, recurse once after it clears.
      this.persistDirtyDuringFlush = true;
      await this.persistInFlight;
      if (this.persistDirtyDuringFlush) await this.flushPersistence();
      return;
    }
    this.persistInFlight = this.flushPersistenceLoop(this.persistOptions);
    try {
      await this.persistInFlight;
    } finally {
      this.persistInFlight = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.detachPersistence();
    this.terminal.dispose();
  }

  /**
   * Load a snapshot file written by `attachPersistence` and return a
   * fresh mirror seeded with the captured ANSI state. Returns `null`
   * when the file is missing, malformed, or has a mismatched schema
   * version — caller should fall back to a cold-start mirror.
   */
  static loadFromDisk(snapshotPath: string, fallbackCols: number, fallbackRows: number): TerminalStateMirror | null {
    if (!existsSync(snapshotPath)) return null;
    let raw: string;
    try {
      raw = readFileSync(snapshotPath, "utf8");
    } catch {
      return null;
    }
    let parsed: PersistedSnapshot;
    try {
      parsed = JSON.parse(raw) as PersistedSnapshot;
    } catch {
      return null;
    }
    if (parsed?.v !== 2 || typeof parsed.snapshot !== "string") return null;
    const cols = Number.isFinite(parsed.cols) && parsed.cols >= 2 ? parsed.cols : fallbackCols;
    const rows = Number.isFinite(parsed.rows) && parsed.rows >= 1 ? parsed.rows : fallbackRows;
    const mirror = new TerminalStateMirror(cols, rows);
    mirror.commitLastAppliedSeq(normalizeSeq(parsed.lastAppliedSeq) ?? 0);
    if (parsed.snapshot.length > 0) {
      mirror.applyOutput(parsed.snapshot);
    }
    return mirror;
  }

  private async flushPersistenceLoop(opts: TerminalMirrorPersistenceOptions): Promise<void> {
    while (true) {
      this.persistDirtyDuringFlush = false;
      await this.writePersistenceSnapshot(opts);
      if (!this.persistDirtyDuringFlush) return;
    }
  }

  private async writePersistenceSnapshot(opts: TerminalMirrorPersistenceOptions): Promise<void> {
    const snap = await this.getSnapshot();
    const payload: PersistedSnapshot = {
      v: 2,
      snapshot: snap.snapshot,
      cols: snap.cols,
      rows: snap.rows,
      lastAppliedSeq: snap.lastAppliedSeq,
      writtenAt: new Date().toISOString(),
    };
    await mkdir(dirname(opts.snapshotPath), { recursive: true, mode: 0o700 }).catch(() => undefined);
    const tmpPath = `${opts.snapshotPath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
    await rename(tmpPath, opts.snapshotPath);
  }

  private commitLastAppliedSeq(seq: number): void {
    this.lastAppliedSeq = Math.max(this.lastAppliedSeq, seq);
  }

  private enqueueOperation(operation: () => void | Promise<void>): void {
    this.operationQueue = this.operationQueue
      .catch(() => undefined)
      .then(async () => {
        await operation();
      });
  }
}

function normalizeSeq(seq: unknown): number | null {
  const n = Number(seq);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function clampInterval(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 1_000;
  if (value === 0) return 0;
  return Math.min(60_000, Math.max(100, Math.floor(value)));
}

const SNIFF_DECODER = new TextDecoder("utf-8", { fatal: false });

function decodeForSniffing(chunk: Buffer): string {
  // The mode-sniff regex only needs ASCII bytes (\x1b, [, ?, digits,
  // h/l). UTF-8 decode without `stream:true` is safe here because we
  // never relinquish bytes — wrong-decoded multi-byte sequences in
  // payload don't matter for the regex result.
  try { return SNIFF_DECODER.decode(new Uint8Array(chunk)); } catch { return ""; }
}
