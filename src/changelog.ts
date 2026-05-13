import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ChangelogEntry {
  version: string;
  title?: string;
  bodyMarkdown: string;
}

function parseChangelogHeading(heading: string): { version: string; title?: string } {
  const raw = heading.trim();
  const match = raw.match(/^(\[?v?\d+\.\d+\.\d+[^\]\s]*\]?)(?:\s+[—-]\s+(.+))?$/i);
  if (!match) return { version: raw };
  const version = match[1] || raw;
  const suffix = (match[2] || "").trim();
  if (!suffix || /^\d{4}-\d{2}-\d{2}$/.test(suffix)) return { version: raw };
  return { version, title: suffix };
}

export function parseChangelog(text: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: { version: string; title?: string } | null = null;
  let body: string[] = [];

  const flush = () => {
    if (!current) return;
    entries.push({ ...current, bodyMarkdown: body.join("\n").trim() });
  };

  for (const line of String(text || "").split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      flush();
      current = parseChangelogHeading(line.slice(3));
      body = [];
      continue;
    }
    if (!current) continue;
    body.push(line);
  }
  flush();

  return entries.filter((entry) => entry.version.length > 0);
}

export function loadChangelog(rootPath: string): ChangelogEntry[] {
  try {
    return parseChangelog(readFileSync(join(rootPath, "CHANGELOG.md"), "utf8"));
  } catch {
    return [];
  }
}
