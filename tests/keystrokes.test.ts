import { expect, test } from "bun:test";

import * as keystrokes from "../src/web/client/keystrokes.ts";
import {
  KEY_DOWN,
  KEY_END,
  KEY_ESC,
  KEY_HOME,
  KEY_LEFT,
  KEY_PG_DN,
  KEY_PG_UP,
  KEY_RIGHT,
  KEY_SHIFT_TAB,
  KEY_TAB,
  KEY_UP,
} from "../src/web/client/keystrokes.ts";

const EXPECTED_EXPORTS = [
  "KEY_DOWN",
  "KEY_END",
  "KEY_ESC",
  "KEY_HOME",
  "KEY_LEFT",
  "KEY_PG_DN",
  "KEY_PG_UP",
  "KEY_RIGHT",
  "KEY_SHIFT_TAB",
  "KEY_TAB",
  "KEY_UP",
];

test("EP-035 WA-190: keystroke constants match terminal escape sequences", () => {
  expect(KEY_ESC).toBe("\x1b");
  expect(KEY_TAB).toBe("\t");
  expect(KEY_SHIFT_TAB).toBe("\x1b[Z");
  expect(KEY_UP).toBe("\x1b[A");
  expect(KEY_DOWN).toBe("\x1b[B");
  expect(KEY_RIGHT).toBe("\x1b[C");
  expect(KEY_LEFT).toBe("\x1b[D");
  expect(KEY_PG_UP).toBe("\x1b[5~");
  expect(KEY_PG_DN).toBe("\x1b[6~");
  expect(KEY_HOME).toBe("\x1b[H");
  expect(KEY_END).toBe("\x1b[F");
});

test("EP-035 WA-190: keystrokes export surface stays stable", () => {
  expect(Object.keys(keystrokes).sort()).toEqual(EXPECTED_EXPORTS);
  expect("KEY_CTRL_C" in keystrokes).toBe(false);
  expect("ctrlByte" in keystrokes).toBe(false);
});
