import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseChangelog } from "../src/changelog.ts";
import { renderSafeMarkdownHtml } from "../src/web/client/markdown.ts";

function testEsc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function render(value: string): string {
  return renderSafeMarkdownHtml(value, testEsc);
}

describe("renderSafeMarkdownHtml nested lists", () => {
  test("renders single-level nested bullets inside the previous list item", () => {
    expect(render("- A\n  - A.1\n  - A.2\n- B")).toBe(
      "<ul><li>A<ul><li>A.1</li><li>A.2</li></ul></li><li>B</li></ul>",
    );
  });

  test("renders two-level nested bullets", () => {
    expect(render("- A\n  - A.1\n    - A.1.a\n- B")).toBe(
      "<ul><li>A<ul><li>A.1<ul><li>A.1.a</li></ul></li></ul></li><li>B</li></ul>",
    );
  });

  test("joins mixed dash and star bullets at the same depth", () => {
    expect(render("* A\n- B\n* C")).toBe("<ul><li>A</li><li>B</li><li>C</li></ul>");
  });

  test("nests numbered lists under bullets and bullets under numbered lists", () => {
    expect(render("- A\n  1. A.1\n  2. A.2\n1. B\n  - B.1")).toBe(
      "<ul><li>A<ol><li>A.1</li><li>A.2</li></ol></li></ul>" +
        "<ol><li>B<ul><li>B.1</li></ul></li></ol>",
    );
  });

  test("treats four-space and tab indents as one nested level", () => {
    const expected = "<ul><li>A<ul><li>A.1</li></ul></li><li>B</li></ul>";
    expect(render("- A\n    - A.1\n- B")).toBe(expected);
    expect(render("- A\n\t- A.1\n- B")).toBe(expected);
  });

  test("keeps existing flat list output unchanged", () => {
    expect(render("- list item\n- another")).toBe("<ul><li>list item</li><li>another</li></ul>");
  });

  test("renders current changelog sub-bullets under their parent bullet", () => {
    const changelog = readFileSync(join(import.meta.dir, "..", "CHANGELOG.md"), "utf8");
    const [latest] = parseChangelog(changelog);
    expect(latest).toBeTruthy();
    const html = render(latest!.bodyMarkdown);

    expect(html).toContain("<strong>Persona profile per agent</strong>");
    expect(html).toMatch(/<strong>Persona profile per agent<\/strong>[^<]*<ul><li>/);
    expect(html).not.toMatch(/<strong>Persona profile per agent<\/strong>[^<]*<\/li><li>Surfaced/);
  });
});
