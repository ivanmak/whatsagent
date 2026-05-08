import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DAEMON_SETTING_TUI_REDRAW_INTERVAL_SECONDS,
  DAEMON_SETTING_TUI_REDRAW_WORKAROUND,
  getDaemonSetting,
  getTuiRedrawSettings,
  migrateDaemonDb,
  openDaemonDb,
  setDaemonSetting,
  setTuiRedrawSettings,
} from "../src/daemon-db.ts";
import { daemonHomePaths } from "../src/paths.ts";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "wa-daemon-db-"));
  const paths = daemonHomePaths(home);
  mkdirSync(paths.workspacesDir, { recursive: true });
  mkdirSync(paths.trashDir, { recursive: true });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function openMigratedDb() {
  const paths = daemonHomePaths(home);
  const db = openDaemonDb(paths.daemonDbPath);
  migrateDaemonDb(db, { daemonHome: home });
  return db;
}

describe("daemon DB TUI redraw settings", () => {
  test("fresh DB defaults resize-pulse workaround to on", () => {
    const db = openMigratedDb();
    try {
      expect(getTuiRedrawSettings(db)).toEqual({ workaround: "on" });
    } finally {
      db.close();
    }
  });

  test.each([
    ["none", "off"],
    ["client", "on"],
    ["server", "on"],
    ["both", "on"],
  ] as const)("legacy stored %s coerces to %s and writes back", (legacy, expected) => {
    const db = openMigratedDb();
    try {
      setDaemonSetting(db, DAEMON_SETTING_TUI_REDRAW_WORKAROUND, legacy);

      expect(getTuiRedrawSettings(db)).toEqual({ workaround: expected });
      expect(getDaemonSetting(db, DAEMON_SETTING_TUI_REDRAW_WORKAROUND)).toBe(expected);

      expect(getTuiRedrawSettings(db)).toEqual({ workaround: expected });
      expect(getDaemonSetting(db, DAEMON_SETTING_TUI_REDRAW_WORKAROUND)).toBe(expected);
    } finally {
      db.close();
    }
  });

  test("setTuiRedrawSettings rejects legacy workaround values", () => {
    const db = openMigratedDb();
    try {
      expect(() => setTuiRedrawSettings(db, { workaround: "none" })).toThrow(/off or on/);
      expect(() => setTuiRedrawSettings(db, { workaround: "client" })).toThrow(/off or on/);
      expect(() => setTuiRedrawSettings(db, { workaround: "server" })).toThrow(/off or on/);
      expect(() => setTuiRedrawSettings(db, { workaround: "both" })).toThrow(/off or on/);
    } finally {
      db.close();
    }
  });

  test("setTuiRedrawSettings accepts new enum without intervalSeconds", () => {
    const db = openMigratedDb();
    try {
      expect(setTuiRedrawSettings(db, { workaround: "on" })).toEqual({ workaround: "on" });
      expect(getDaemonSetting(db, DAEMON_SETTING_TUI_REDRAW_WORKAROUND)).toBe("on");

      expect(setTuiRedrawSettings(db, { workaround: "off" })).toEqual({ workaround: "off" });
      expect(getDaemonSetting(db, DAEMON_SETTING_TUI_REDRAW_WORKAROUND)).toBe("off");
    } finally {
      db.close();
    }
  });

  test("setTuiRedrawSettings ignores legacy intervalSeconds from transitional callers", () => {
    const db = openMigratedDb();
    try {
      expect(setTuiRedrawSettings(db, { workaround: "on", intervalSeconds: 99 })).toEqual({ workaround: "on" });
      expect(getTuiRedrawSettings(db)).toEqual({ workaround: "on" });
      expect(getDaemonSetting(db, DAEMON_SETTING_TUI_REDRAW_INTERVAL_SECONDS)).toBeNull();
      expect(setTuiRedrawSettings(db, { workaround: "off", intervalSeconds: 4 })).toEqual({ workaround: "off" });
      expect(getTuiRedrawSettings(db)).toEqual({ workaround: "off" });
    } finally {
      db.close();
    }
  });
});
