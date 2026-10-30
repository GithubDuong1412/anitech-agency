import { describe, expect, it } from "vitest";
import { matchedAreas, ownerCandidates, recommendAgent, relevantAgents } from "../src/lib/routing";

describe("task routing", () => {
  it("recommends the specialist from task intent", () => {
    expect(recommendAgent("Add pagination to the Catalog API")).toBe("sasuke");
    expect(recommendAgent("Rà soát phân quyền đăng nhập")).toBe("natsu");
    expect(recommendAgent("Viết test hồi quy checkout")).toBe("levi");
    expect(recommendAgent("Cải thiện giao diện React")).toBe("luffy");
    expect(recommendAgent("Review the feature logic")).toBe("gojo");
  });

  it("routes the examples from the project brief", () => {
    expect(recommendAgent("sửa API login")).toBe("sasuke");
    expect(recommendAgent("test Playwright")).toBe("levi");
    expect(recommendAgent("Phát hành bản 1.2")).toBe("goku");
  });

  it("matches keywords at word starts only", () => {
    expect(recommendAgent("Plan the capital budget")).toBe("gojo");
    expect(recommendAgent("Build the quick guide")).toBe("gojo");
    expect(recommendAgent("Fix the apis")).toBe("sasuke");
  });

  it("falls back to the senior developer", () => {
    expect(recommendAgent("")).toBe("gojo");
  });

  it("picks related agents without the CEO or the release gate", () => {
    const api = relevantAgents("Add pagination to the Catalog API", "sasuke");
    expect(api).toContain("sasuke");
    expect(api).toContain("natsu");
    expect(api).not.toContain("ceo");
    expect(api).not.toContain("goku");
    expect(relevantAgents("Review the feature logic", "gojo").length).toBeGreaterThanOrEqual(2);
    expect(relevantAgents("react ui and api and tests", "luffy").length).toBeLessThanOrEqual(3);
    expect(relevantAgents("react ui and api and tests", "luffy")[0]).toBe("luffy");
  });

  it("always keeps the owner", () => {
    expect(relevantAgents("deploy the release", "goku")).toContain("goku");
  });

  it("detects the parts a task touches and offers those characters, with Gojo as the default owner", () => {
    expect(matchedAreas("sửa API login")).toEqual(["sasuke", "natsu"]);
    expect(matchedAreas("Review the feature logic")).toEqual([]);

    const owners = ownerCandidates(["sasuke", "natsu"]).map((agent) => agent.id);
    expect(owners[0]).toBe("gojo");
    expect(owners).toContain("sasuke");
    expect(owners).toContain("natsu");
    expect(owners).not.toContain("ceo");
    expect(owners).not.toContain("luffy");

    const team = relevantAgents("sửa API login", "gojo", ["sasuke", "natsu"]);
    expect(team[0]).toBe("gojo");
    expect(team).toContain("sasuke");
    expect(team).toContain("natsu");
    expect(team).not.toContain("ceo");
  });
});
