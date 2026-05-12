import { describe, expect, test } from "bun:test";

import { PERSONA_TEMPLATES } from "../src/persona-templates.ts";

const EXPECTED_IDS = [
  "engineer",
  "reviewer",
  "architect",
  "researcher",
  "coordinator",
  "frontend-specialist",
];

const FIELD_NAMES = [
  "description",
  "responsibilities",
  "boundaries",
  "skills",
  "working_style",
  "extra_prompt",
] as const;

describe("persona templates", () => {
  test("ships exactly the documented starter ids with no duplicates", () => {
    const ids = PERSONA_TEMPLATES.map(template => template.id);
    expect(ids.sort()).toEqual([...EXPECTED_IDS].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("each template has labels, summaries, and all six string fields", () => {
    for (const template of PERSONA_TEMPLATES) {
      expect(typeof template.id).toBe("string");
      expect(template.id.length).toBeGreaterThan(0);
      expect(typeof template.label).toBe("string");
      expect(template.label.length).toBeGreaterThan(0);
      expect(typeof template.summary).toBe("string");
      expect(template.summary.length).toBeGreaterThan(0);
      expect(Object.keys(template.fields).sort()).toEqual([...FIELD_NAMES].sort());
      for (const field of FIELD_NAMES) {
        expect(typeof template.fields[field]).toBe("string");
        expect(template.fields[field].length).toBeGreaterThan(0);
      }
    }
  });
});
