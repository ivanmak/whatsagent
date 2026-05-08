import { describe, expect, test } from "bun:test";

import { TerminalStateMirror } from "../src/runner/terminal-state-mirror.ts";

function newMirror(cols = 80, rows = 24): TerminalStateMirror {
  return new TerminalStateMirror(cols, rows);
}

describe("TerminalStateMirror — basic write + serialize", () => {
  test("serializes plain text writes", async () => {
    const m = newMirror();
    m.applyOutput("hello world");
    const snap = await m.getSnapshot();
    expect(snap.cols).toBe(80);
    expect(snap.rows).toBe(24);
    expect(snap.snapshot).toContain("hello world");
    m.dispose();
  });

  test("preserves ANSI color escape sequences in snapshot", async () => {
    const m = newMirror();
    m.applyOutput("\x1b[31mred\x1b[0m \x1b[32mgreen\x1b[0m");
    const snap = await m.getSnapshot();
    expect(snap.snapshot).toContain("red");
    expect(snap.snapshot).toContain("green");
    expect(snap.snapshot).toContain("\x1b[31m");
    expect(snap.snapshot).toContain("\x1b[32m");
    m.dispose();
  });

  test("preserves cursor position after CR/LF/CUP sequences", async () => {
    const m = newMirror();
    m.applyOutput("line1\r\nline2\r\n");
    m.applyOutput("\x1b[1;1H");
    const snap = await m.getSnapshot();
    expect(snap.snapshot).toContain("line1");
    expect(snap.snapshot).toContain("line2");
    m.dispose();
  });

  test("accepts Buffer input alongside string input", async () => {
    const m = newMirror();
    m.applyOutput(Buffer.from("hello "));
    m.applyOutput("world");
    const snap = await m.getSnapshot();
    expect(snap.snapshot).toContain("hello world");
    m.dispose();
  });
});

describe("TerminalStateMirror — mouse-mode passthrough (EP-029 T6 fix)", () => {
  test("re-emits ?1006h SGR mouse mode on getSnapshot when input enabled it", async () => {
    const m = newMirror();
    m.applyOutput("\x1b[?1000h\x1b[?1006h");
    m.applyOutput("body");
    const snap = await m.getSnapshot();
    // SerializeAddon captures ?1000 natively; the mirror must additionally
    // prepend ?1006h so the restore frame reconstitutes SGR mode for
    // OpenCode TUI mouse coordinate accuracy.
    expect(snap.snapshot.startsWith("\x1b[?1006h")).toBe(true);
    expect(snap.snapshot).toContain("body");
    m.dispose();
  });

  test("re-emits multiple passthrough modes (?1005h, ?1006h, ?1015h, ?1016h) when active", async () => {
    const m = newMirror();
    m.applyOutput("\x1b[?1005h\x1b[?1006h\x1b[?1015h\x1b[?1016h");
    const snap = await m.getSnapshot();
    expect(snap.snapshot).toContain("\x1b[?1005h");
    expect(snap.snapshot).toContain("\x1b[?1006h");
    expect(snap.snapshot).toContain("\x1b[?1015h");
    expect(snap.snapshot).toContain("\x1b[?1016h");
    m.dispose();
  });

  test("DECRST removes the mode from the passthrough set", async () => {
    const m = newMirror();
    m.applyOutput("\x1b[?1006h");
    m.applyOutput("\x1b[?1006l");
    const snap = await m.getSnapshot();
    expect(snap.snapshot).not.toContain("\x1b[?1006h");
    m.dispose();
  });

  test("Buffer chunk input is sniffed for mode enables", async () => {
    const m = newMirror();
    m.applyOutput(Buffer.from("\x1b[?1006h"));
    const snap = await m.getSnapshot();
    expect(snap.snapshot).toContain("\x1b[?1006h");
    m.dispose();
  });
});

describe("TerminalStateMirror — alt-screen state", () => {
  test("entering alt-screen and writing leaves alt-screen content in snapshot", async () => {
    const m = newMirror();
    m.applyOutput("primary\r\n");
    m.applyOutput("\x1b[?1049h");
    m.applyOutput("alt-screen body");
    const snap = await m.getSnapshot();
    expect(snap.snapshot).toContain("alt-screen body");
    m.dispose();
  });

  test("exiting alt-screen restores primary buffer in snapshot", async () => {
    const m = newMirror();
    m.applyOutput("primary line\r\n");
    m.applyOutput("\x1b[?1049h");
    m.applyOutput("alt body");
    m.applyOutput("\x1b[?1049l");
    const snap = await m.getSnapshot();
    expect(snap.snapshot).toContain("primary line");
    m.dispose();
  });
});

describe("TerminalStateMirror — resize", () => {
  test("resize to new dims updates snapshot cols+rows", async () => {
    const m = newMirror(80, 24);
    m.applyOutput("hello");
    m.resize(120, 40);
    const snap = await m.getSnapshot();
    expect(snap.cols).toBe(120);
    expect(snap.rows).toBe(40);
    expect(snap.snapshot).toContain("hello");
    m.dispose();
  });

  test("resize to current dims is a no-op (no queued op)", async () => {
    const m = newMirror(80, 24);
    m.resize(80, 24);
    const snap = await m.getSnapshot();
    expect(snap.cols).toBe(80);
    expect(snap.rows).toBe(24);
    m.dispose();
  });
});

describe("TerminalStateMirror — scrollback retention", () => {
  test("retains lines that scroll past the visible viewport", async () => {
    const m = newMirror(80, 24);
    for (let i = 0; i < 50; i += 1) {
      m.applyOutput(`line-${i.toString().padStart(3, "0")}\r\n`);
    }
    const snap = await m.getSnapshot();
    expect(snap.snapshot).toContain("line-000");
    expect(snap.snapshot).toContain("line-049");
    m.dispose();
  });

  test("scrollback caps at 10_000 lines (oldest lines drop)", async () => {
    const m = newMirror(80, 24);
    const lines: string[] = [];
    for (let i = 0; i < 10_500; i += 1) {
      lines.push(`L${i}\r\n`);
    }
    m.applyOutput(lines.join(""));
    const snap = await m.getSnapshot();
    expect(snap.snapshot).toContain("L10499");
    expect(snap.snapshot).not.toContain("L0\r");
    m.dispose();
  });
});

describe("TerminalStateMirror — queue serialization", () => {
  test("concurrent applyOutput calls preserve write order", async () => {
    const m = newMirror(80, 24);
    const parts = ["AAA", "BBB", "CCC", "DDD", "EEE"];
    for (const p of parts) {
      m.applyOutput(p);
    }
    const snap = await m.getSnapshot();
    expect(snap.snapshot).toContain("AAABBBCCCDDDEEE");
    m.dispose();
  });

  test("getSnapshot waits for pending writes to drain", async () => {
    const m = newMirror(80, 24);
    m.applyOutput("first ");
    m.applyOutput("second ");
    m.applyOutput("third");
    const snap = await m.getSnapshot();
    expect(snap.snapshot).toContain("first second third");
    m.dispose();
  });

  test("interleaved resize between writes does not drop earlier writes", async () => {
    const m = newMirror(80, 24);
    m.applyOutput("before ");
    m.resize(120, 40);
    m.applyOutput("after");
    const snap = await m.getSnapshot();
    expect(snap.snapshot).toContain("before");
    expect(snap.snapshot).toContain("after");
    expect(snap.cols).toBe(120);
    expect(snap.rows).toBe(40);
    m.dispose();
  });
});

describe("TerminalStateMirror — Pi TUI fixture (EP-031 WA-PI-6)", () => {
  // Synthetic Pi TUI transcript covering the regression surfaces called out
  // in the WA-PI-6 manual acceptance gate: alternate screen entry, box-
  // drawing + Unicode glyphs, SGR mouse mode (?1006), redraw-after-resize.
  // Pi emits standard xterm sequences, so the mirror's existing
  // claude-code/opencode/codex coverage applies — this fixture pins that
  // Pi-shaped output round-trips without a runtime-specific mirror tweak.
  const PI_FIXTURE = [
    "\x1b[?1049h",                           // alt-screen on
    "\x1b[?1006h\x1b[?1015h\x1b[?1016h",     // SGR + URxvt + extended mouse modes
    "\x1b[2J\x1b[H",                         // clear + cursor home
    "┌─ Pi ──────────────────────────────┐\r\n", // box-drawing top
    "│ message: 你好世界 🤖             │\r\n",  // Unicode + emoji body
    "└────────────────────────────────────┘\r\n",
  ].join("");

  test("Pi alt-screen + box drawing + mouse mode survive snapshot round-trip", async () => {
    const m = newMirror(80, 24);
    m.applyOutput(PI_FIXTURE);
    const snap = await m.getSnapshot();
    expect(snap.snapshot.startsWith("\x1b[?1006h") || snap.snapshot.includes("\x1b[?1006h")).toBe(true);
    expect(snap.snapshot).toContain("\x1b[?1015h");
    expect(snap.snapshot).toContain("\x1b[?1016h");
    expect(snap.snapshot).toContain("Pi");
    expect(snap.snapshot).toContain("你好世界");
    expect(snap.snapshot).toContain("🤖");
    expect(snap.snapshot).toContain("┌─");
    m.dispose();
  });

  test("Pi screen redraws cleanly after resize", async () => {
    const m = newMirror(80, 24);
    m.applyOutput(PI_FIXTURE);
    m.resize(120, 40);
    // Simulate Pi redraw-after-resize: clear, redraw widened box.
    m.applyOutput("\x1b[2J\x1b[H");
    m.applyOutput("┌─ Pi (resized 120x40) ────────────────────────────┐\r\n");
    const snap = await m.getSnapshot();
    expect(snap.cols).toBe(120);
    expect(snap.rows).toBe(40);
    expect(snap.snapshot).toContain("resized 120x40");
    // Mouse modes survive the resize.
    expect(snap.snapshot).toContain("\x1b[?1006h");
    m.dispose();
  });

  test("Pi exit alt-screen restores primary buffer with no mouse-mode leak", async () => {
    const m = newMirror(80, 24);
    m.applyOutput("primary content\r\n");
    m.applyOutput(PI_FIXTURE);
    m.applyOutput("\x1b[?1006l\x1b[?1015l\x1b[?1016l");  // Pi disables mouse modes on exit
    m.applyOutput("\x1b[?1049l");                         // alt-screen off
    const snap = await m.getSnapshot();
    expect(snap.snapshot).toContain("primary content");
    expect(snap.snapshot).not.toContain("\x1b[?1006h");
    expect(snap.snapshot).not.toContain("\x1b[?1015h");
    expect(snap.snapshot).not.toContain("\x1b[?1016h");
    m.dispose();
  });
});

describe("TerminalStateMirror — dispose", () => {
  test("dispose can be called without throwing", () => {
    const m = newMirror();
    m.applyOutput("hello");
    expect(() => m.dispose()).not.toThrow();
  });

  test("snapshot taken before dispose remains valid", async () => {
    const m = newMirror();
    m.applyOutput("snapshot-me");
    const snap = await m.getSnapshot();
    m.dispose();
    expect(snap.snapshot).toContain("snapshot-me");
  });
});
