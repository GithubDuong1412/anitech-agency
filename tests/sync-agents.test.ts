import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEAM_RULE, defaultPaths, syncAgents, yamlQuote } from "../scripts/sync-agents.mjs";
import { AGENTS, CEO } from "../src/lib/roster";

const root = path.resolve(__dirname, "..");
let outDir = "";
let result: ReturnType<typeof syncAgents>;

beforeAll(() => {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "anitech-rules-"));
  // upstreamDir null: always build from the pinned copy in vendor/, so the test does not depend on a checkout.
  result = syncAgents({ ...defaultPaths(root), upstreamDir: null, outDir });
});

afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

const read = (name: string) => fs.readFileSync(path.join(outDir, name + ".mdc"), "utf8");

const FRONTMATTER = /^---\ndescription: '((?:[^']|'')*)'\nglobs: ""\nalwaysApply: (true|false)\n---\n/;

function frontmatter(text: string) {
  const match = text.match(FRONTMATTER);
  if (!match) throw new Error("invalid frontmatter:\n" + text.slice(0, 300));
  return { description: match[1].replace(/''/g, "'"), alwaysApply: match[2] === "true", body: text.slice(match[0].length) };
}

describe("sync-agents", () => {
  it("generates the team rule and one rule per character (8 files)", () => {
    expect(result.files).toHaveLength(8);
    const expected = [TEAM_RULE, ...AGENTS.map((agent) => agent.rule)].map((name) => name + ".mdc").sort();
    expect(fs.readdirSync(outDir).sort()).toEqual(expected);
  });

  it("writes valid Cursor frontmatter, with the character name in the description", () => {
    for (const agent of AGENTS) {
      const { description, alwaysApply } = frontmatter(read(agent.rule));
      expect(alwaysApply).toBe(false);
      expect(description).toContain(agent.name);
    }
  });

  it("starts every character rule with the persona, then the upstream skill", () => {
    for (const agent of AGENTS) {
      const { body } = frontmatter(read(agent.rule));
      expect(body.startsWith(`# ${agent.name} — `), agent.id).toBe(true);
      expect(body).toContain("## Kỹ năng: ");
      expect(body.indexOf("## Kỹ năng: ")).toBeGreaterThan(body.indexOf("## Tôi là ai"));
      // upstream frontmatter must be stripped
      expect(body).not.toMatch(/^name: /m);
      expect(body).not.toMatch(/^emoji: /m);
    }
  });

  it("gives the CEO both skill blocks", () => {
    const { body } = frontmatter(read(CEO.rule));
    const orchestrator = body.indexOf("## Kỹ năng: Agents Orchestrator");
    const git = body.indexOf("## Kỹ năng: Git Workflow Master");
    expect(orchestrator).toBeGreaterThan(-1);
    expect(git).toBeGreaterThan(orchestrator);
  });

  it("makes the team rule always-applied and lists every character", () => {
    const { alwaysApply, body } = frontmatter(read(TEAM_RULE));
    expect(alwaysApply).toBe(true);
    for (const agent of AGENTS) {
      expect(body).toContain(agent.name);
      expect(body).toContain("`@" + agent.rule + "`");
    }
  });

  it("tells Gojo about his stack and to ignore the missing ai/system paths", () => {
    const gojo = read("gojo-senior");
    expect(gojo).toContain("ai/system/");
    expect(gojo).toContain("Laravel + Livewire");
    expect(gojo).toContain("Three.js");
  });

  it("makes Goku default to NEEDS WORK and Levi hand over to Goku", () => {
    expect(read("goku-reality")).toContain("NEEDS WORK");
    expect(read("levi-testing")).toContain("**Goku** để duyệt");
  });

  it("quotes YAML like convert.sh", () => {
    expect(yamlQuote("it's")).toBe("'it''s'");
  });

  it("fails clearly when an upstream file is missing", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "anitech-empty-"));
    try {
      expect(() =>
        syncAgents({ ...defaultPaths(root), upstreamDir: empty, outDir: path.join(empty, "out"), vendorDir: path.join(empty, "vendor") }),
      ).toThrow(/not found/);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
