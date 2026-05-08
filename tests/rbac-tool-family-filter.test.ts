/**
 * RBAC Phase 4 slice 4-5 (WA-086): Star-decomposition for tool_family
 * `kanban-admin` gating. The MCP integration tool descriptions used to
 * say "Star policy: main-role-only"; post-Phase-4 the gate is a
 * `role_grants(tool_family, kanban-admin)` lookup performed by the
 * dispatcher (WA-084). The descriptions now reference the grant model.
 *
 * Per-tool assertions (advisor msg 379): file-level scans masked individual
 * stale descriptions when at least one tool in the file had been updated.
 * Each gated tool's description block is now extracted and matched
 * individually.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

interface IntegrationFile {
  path: string;
  /** Pull a single tool's description string out of the source. The opencode
   * plugin uses `<tool>: tool({ description: "..." ... })`; claude-mcp +
   * codex-mcp use `server.registerTool("<tool>", { ... description: "..." })`.
   * This regex matches both shapes by anchoring on the description literal
   * inside the named tool's block. */
  describeFor(name: string, source: string): string;
}

function readSource(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}

function describeBlockOpenCode(name: string, source: string): string {
  // `<name>: tool({ description: "...", ...`
  const re = new RegExp(`${name}:\\s*tool\\(\\{\\s*description:\\s*"([^"]*)"`, "s");
  const m = source.match(re);
  if (!m) throw new Error(`opencode tool ${name} description not found`);
  return m[1] ?? "";
}

function describeBlockRegister(name: string, source: string): string {
  // EP-022 / WA-097: claude-mcp + codex-mcp now wrap `server.registerTool`
  // in a local `register(...)` helper so the visibility filter can skip
  // tools per agent's tool_families. Match either form.
  const re = new RegExp(`(?:server\\.registerTool|register)\\("${name}",\\s*\\{[^}]*?description:\\s*"([^"]*)"`, "s");
  const m = source.match(re);
  if (!m) throw new Error(`registerTool ${name} description not found`);
  return m[1] ?? "";
}

const FILES: IntegrationFile[] = [
  { path: "src/integrations/opencode-plugin.ts", describeFor: describeBlockOpenCode },
  { path: "src/integrations/claude-mcp.ts", describeFor: describeBlockRegister },
  { path: "src/integrations/codex-mcp.ts", describeFor: describeBlockRegister },
];

const STALE_PHRASES = [
  "main-role-only",
  "main role only",
  "main-only",
  "Star policy: main",
  "Star policy allows only the main role",
  "In Star policy, assigned non-main agents",
  "In Star policy main and assignee can move",
  "Assignee or main role only",
  "epic assignee or the main role",
  "policy-gated by the daemon",
];

interface ToolExpectation {
  tool: string;
  /** Substrings that MUST appear in this tool's description. */
  mustContain: readonly string[];
}

const TOOL_EXPECTATIONS: readonly ToolExpectation[] = [
  { tool: "create_kanban_task", mustContain: ["kanban-admin"] },
  { tool: "update_kanban_task", mustContain: ["kanban-admin"] },
  { tool: "update_kanban_task_status", mustContain: ["kanban-status"] },
  { tool: "create_kanban_epic", mustContain: ["kanban-admin"] },
  { tool: "update_kanban_epic", mustContain: ["kanban-admin"] },
  { tool: "update_kanban_epic_status", mustContain: ["kanban-status"] },
  { tool: "cancel_kanban_epic_close", mustContain: ["cancel_epic_close"] },
];

describe("RBAC Phase 4 slice 4-5 — tool_family kanban-admin description copy", () => {
  for (const f of FILES) {
    describe(f.path, () => {
      const source = readSource(f.path);

      test("no stale Star/main-role copy file-wide (cheap pin)", () => {
        for (const phrase of STALE_PHRASES) {
          expect(source).not.toContain(phrase);
        }
      });

      for (const exp of TOOL_EXPECTATIONS) {
        test(`${exp.tool}: cites RBAC grant`, () => {
          const desc = f.describeFor(exp.tool, source);
          for (const needle of exp.mustContain) {
            expect(desc).toContain(needle);
          }
          for (const phrase of STALE_PHRASES) {
            expect(desc).not.toContain(phrase);
          }
        });
      }
    });
  }
});
