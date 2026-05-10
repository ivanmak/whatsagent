/**
 * WA-208 — `stripControlChars` removes C0/C1 control bytes from
 * daemon-supplied strings before they reach the operator's terminal,
 * neutralizing cursor-control / fake-prompt injection by an authorized
 * peer who set a hostile workspace/repo/role name.
 */
import { describe, expect, test } from "bun:test";

import { stripControlChars } from "../src/cli.ts";

describe("stripControlChars", () => {
  test("strips ANSI CSI clear-screen + cursor-home sequence", () => {
    const hostile = "\x1b[2J\x1b[1;1H$ rm -rf ~";
    expect(stripControlChars(hostile)).toBe("[2J[1;1H$ rm -rf ~");
  });

  test("strips C0 control bytes (BEL, BS, NUL, etc.)", () => {
    expect(stripControlChars("name\x07with\x08bell\x00bytes")).toBe("namewithbellbytes");
  });

  test("strips C1 control bytes (0x80-0x9F)", () => {
    expect(stripControlChars("a\x9bb\x9dc")).toBe("abc");
  });

  test("preserves printable ASCII and unicode", () => {
    expect(stripControlChars("workspace-α/β")).toBe("workspace-α/β");
  });

  test("coerces null/undefined to empty string", () => {
    expect(stripControlChars(null)).toBe("");
    expect(stripControlChars(undefined)).toBe("");
  });
});
