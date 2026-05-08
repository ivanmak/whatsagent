/**
 * WA-071 — `~/.whatsagent/daemon.toml` loader + per-key env overrides.
 *
 * Covers:
 *   - `parseDaemonToml`: tolerant key/section parser; ignores unknown
 *     sections, malformed lines, mixed quoting; rejects malformed arrays.
 *   - `loadDaemonToml`: missing file → empty overrides; existing file →
 *     parsed overrides.
 *   - `resolveDaemonConfig`: precedence
 *       defaults < daemon.toml < env (per-key) < explicit opts.port.
 *     Env replaces (does not append) the matching field.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadDaemonToml,
  parseDaemonToml,
  resolveDaemonConfig,
} from "../src/config.ts";

let daemonHome: string;

beforeEach(async () => {
  daemonHome = await mkdtemp(join(tmpdir(), "wa-daemon-config-"));
});

afterEach(async () => {
  await rm(daemonHome, { recursive: true, force: true });
});

describe("parseDaemonToml", () => {
  test("parses [fleet] name + [ui] host/port/allow_hosts", () => {
    const overrides = parseDaemonToml([
      "# header",
      "[fleet]",
      'name = "ops-team"',
      "",
      "[ui]",
      'host = "0.0.0.0"',
      "port = 4500",
      'allow_hosts = ["proxy.example.com", "alt.example.com"]',
    ].join("\n"));
    expect(overrides).toEqual({
      fleetName: "ops-team",
      host: "0.0.0.0",
      port: 4500,
      allowHosts: ["proxy.example.com", "alt.example.com"],
    });
  });

  test("ignores unknown sections + unknown keys + malformed lines", () => {
    const overrides = parseDaemonToml([
      "[mystery]",
      'something = "ignored"',
      "[ui]",
      'host = "127.0.0.1"',
      "garbage line no equals",
      "unknown_key = 99",
      "[fleet]",
      "name = unquoted-not-allowed",
    ].join("\n"));
    expect(overrides).toEqual({ host: "127.0.0.1" });
  });

  test("rejects malformed allow_hosts (mixed types) without throwing", () => {
    const overrides = parseDaemonToml([
      "[ui]",
      "allow_hosts = [\"ok\", 42]",
    ].join("\n"));
    expect(overrides.allowHosts).toBeUndefined();
  });

  test("rejects non-integer port silently", () => {
    const overrides = parseDaemonToml([
      "[ui]",
      "port = not-a-number",
    ].join("\n"));
    expect(overrides.port).toBeUndefined();
  });

  test("strips trailing comments after a value", () => {
    const overrides = parseDaemonToml([
      "[ui]",
      "port = 4017 # default port",
    ].join("\n"));
    expect(overrides.port).toBe(4017);
  });

  test("returns empty overrides for empty input", () => {
    expect(parseDaemonToml("")).toEqual({});
    expect(parseDaemonToml("\n\n   \n")).toEqual({});
  });
});

describe("loadDaemonToml", () => {
  test("missing file returns empty overrides", async () => {
    const overrides = await loadDaemonToml(daemonHome);
    expect(overrides).toEqual({});
  });

  test("existing file parses overrides", async () => {
    await writeFile(
      join(daemonHome, "daemon.toml"),
      `[ui]\nport = 4321\nallow_hosts = ["a.example.com"]\n`,
      "utf8",
    );
    const overrides = await loadDaemonToml(daemonHome);
    expect(overrides).toEqual({
      port: 4321,
      allowHosts: ["a.example.com"],
    });
  });
});

describe("resolveDaemonConfig (precedence)", () => {
  test("defaults only when no toml + no env", async () => {
    const config = await resolveDaemonConfig({ daemonHome, env: {} });
    expect(config.ui.host).toBe("127.0.0.1");
    expect(config.ui.port).toBe(4017);
    expect(config.ui.allowHosts).toEqual([]);
    expect(config.fleet.name).toBe("WhatsAgent");
    expect(config.fleet.root).toBe(daemonHome);
  });

  test("daemon.toml fields land in config", async () => {
    await writeFile(
      join(daemonHome, "daemon.toml"),
      `[fleet]\nname = "alpha"\n[ui]\nhost = "0.0.0.0"\nport = 5000\nallow_hosts = ["one.example.com"]\n`,
      "utf8",
    );
    const config = await resolveDaemonConfig({ daemonHome, env: {} });
    expect(config.fleet.name).toBe("alpha");
    expect(config.ui.host).toBe("0.0.0.0");
    expect(config.ui.port).toBe(5000);
    expect(config.ui.allowHosts).toEqual(["one.example.com"]);
  });

  test("WHATSAGENT_PORT env replaces toml port", async () => {
    const config = await resolveDaemonConfig({
      daemonHome,
      overrides: { port: 5000 },
      env: { WHATSAGENT_PORT: "6000" },
    });
    expect(config.ui.port).toBe(6000);
  });

  test("WHATSAGENT_HOST_ALLOW env replaces (not appends to) toml allow_hosts", async () => {
    const config = await resolveDaemonConfig({
      daemonHome,
      overrides: { allowHosts: ["from-toml.example.com"] },
      env: { WHATSAGENT_HOST_ALLOW: "env-a.example.com,env-b.example.com" },
    });
    expect(config.ui.allowHosts).toEqual(["env-a.example.com", "env-b.example.com"]);
  });

  test("WHATSAGENT_HOST_ALLOW with empty entries trims and drops them", async () => {
    const config = await resolveDaemonConfig({
      daemonHome,
      env: { WHATSAGENT_HOST_ALLOW: " host-a , , host-b " },
    });
    expect(config.ui.allowHosts).toEqual(["host-a", "host-b"]);
  });

  test("invalid WHATSAGENT_PORT silently falls through to toml/default", async () => {
    const config = await resolveDaemonConfig({
      daemonHome,
      overrides: { port: 5500 },
      env: { WHATSAGENT_PORT: "not-a-number" },
    });
    expect(config.ui.port).toBe(5500);
  });

  test("explicit opts.port wins over env + toml", async () => {
    const config = await resolveDaemonConfig({
      daemonHome,
      port: 0,
      overrides: { port: 5000 },
      env: { WHATSAGENT_PORT: "6000" },
    });
    expect(config.ui.port).toBe(0);
  });
});
