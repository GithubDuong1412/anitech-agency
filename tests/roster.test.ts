import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AGENTS, AGENT_IDS, CEO, REVIEWER } from "../src/lib/roster";

const root = path.resolve(__dirname, "..");
const upstream = path.join(root, "vendor", "agency-agents");

describe("roster", () => {
  it("keeps the seven characters, with Elio as CEO", () => {
    expect(AGENT_IDS).toHaveLength(7);
    expect(new Set(AGENT_IDS).size).toBe(7);
    expect(AGENTS.map((agent) => agent.name).sort()).toEqual(["Elio", "Gojo", "Goku", "Levi", "Luffy", "Natsu", "Sasuke"]);
    expect(CEO.name).toBe("Elio");
    expect(REVIEWER.name).toBe("Goku");
  });

  it("has unique ids and rule names", () => {
    expect(new Set(AGENTS.map((agent) => agent.rule)).size).toBe(AGENTS.length);
  });

  it("maps every character to existing upstream agents", () => {
    for (const agent of AGENTS) {
      expect(agent.agents.length, agent.id).toBeGreaterThan(0);
      for (const relative of agent.agents) {
        expect(fs.existsSync(path.join(upstream, relative)), `${agent.id}: ${relative}`).toBe(true);
      }
    }
    expect(CEO.agents).toHaveLength(2);
  });

  it("has a persona and image assets for every character", () => {
    for (const agent of AGENTS) {
      expect(fs.existsSync(path.join(root, "agents", "personas", agent.id + ".md")), `persona ${agent.id}`).toBe(true);
      for (const asset of [agent.assets.avatar, agent.assets.sprite]) {
        expect(fs.existsSync(path.join(root, "public", asset)), `${agent.id}: ${asset}`).toBe(true);
      }
    }
  });

  it("only references known agents as collaborators", () => {
    for (const agent of AGENTS) {
      for (const id of agent.collaborators) expect(AGENT_IDS).toContain(id);
    }
  });
});
