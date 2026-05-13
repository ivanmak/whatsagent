import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadChangelog, parseChangelog } from "../src/changelog.ts";

describe("parseChangelog", () => {
  test("extracts ordered version sections and keeps bodies trimmed", () => {
    const entries = parseChangelog(`# Changelog

Intro text ignored.

## v0.3.0 — Channel history

### Added

- Root-aware pages.

## [0.2.0] - 2026-05-12

Per-agent Persona Profiles.

### Added

- Persona profile per agent.
- Persona-aware HTTP APIs.

## v0.1.1

### Fixed

- Tooltip wrap.
`);

    expect(entries).toEqual([
      {
        version: "v0.3.0",
        title: "Channel history",
        bodyMarkdown: "### Added\n\n- Root-aware pages.",
      },
      {
        version: "[0.2.0] - 2026-05-12",
        bodyMarkdown: "Per-agent Persona Profiles.\n\n### Added\n\n- Persona profile per agent.\n- Persona-aware HTTP APIs.",
      },
      {
        version: "v0.1.1",
        bodyMarkdown: "### Fixed\n\n- Tooltip wrap.",
      },
    ]);
  });

  test("keeps non-version h2 headings as changelog entries", () => {
    expect(parseChangelog("# Changelog\n\n## Notes\n\n### Added\n\n- Thing")).toEqual([
      { version: "Notes", bodyMarkdown: "### Added\n\n- Thing" },
    ]);
  });

  test("returns an empty list when no version sections exist", () => {
    expect(parseChangelog("# Changelog\n\nNo releases yet.")).toEqual([]);
  });
});

describe("loadChangelog", () => {
  test("returns [] for a missing changelog without throwing", () => {
    const root = mkdtempSync(join(tmpdir(), "wa-missing-changelog-"));
    expect(loadChangelog(root)).toEqual([]);
  });

  test("reads CHANGELOG.md from the supplied root", async () => {
    const root = mkdtempSync(join(tmpdir(), "wa-changelog-"));
    await writeFile(join(root, "CHANGELOG.md"), "## v1.2.3 — Test\n\n- Loaded\n", "utf8");
    expect(loadChangelog(root)).toEqual([{ version: "v1.2.3", title: "Test", bodyMarkdown: "- Loaded" }]);
  });
});
