import { describe, expect, it } from "vitest";
import { SOCIAL } from "../src/lib/roster";
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

  it("offers only the selected parts as owners, and Gojo when nothing is selected", () => {
    expect(matchedAreas("sửa API login")).toEqual(["sasuke", "natsu"]);
    expect(matchedAreas("Check lại luồng API")).toEqual(["sasuke"]);
    expect(matchedAreas("Review the feature logic")).toEqual([]);

    expect(ownerCandidates(["sasuke"]).map((agent) => agent.id)).toEqual(["sasuke"]);
    expect(ownerCandidates([]).map((agent) => agent.id)).toEqual(["gojo"]);
    const owners = ownerCandidates(["sasuke", "natsu"]).map((agent) => agent.id);
    expect(owners).toEqual(["sasuke", "natsu"]);
    expect(owners).not.toContain("gojo");

    const team = relevantAgents("sửa API login", "gojo", ["sasuke", "natsu"]);
    expect(team[0]).toBe("gojo");
    expect(team).toContain("sasuke");
    expect(team).toContain("natsu");
    expect(team).not.toContain("ceo");
    expect(relevantAgents("Check lại luồng API", "sasuke", ["sasuke"])).toEqual(["sasuke"]);
  });

  it("routes facebook work inside the social floor", () => {
    expect(recommendAgent("Viết bài đăng Facebook có hook và hashtag", SOCIAL)).toBe("duongtang");
    expect(recommendAgent("Tạo prompt Midjourney tỷ lệ 4:5", SOCIAL)).toBe("phatto");
    expect(recommendAgent("Bộ ảnh carousel 4 slide", SOCIAL)).toBe("bachlongma");
    expect(recommendAgent("Soạn phản hồi bình luận Messenger", SOCIAL)).toBe("satang");
    expect(recommendAgent("Góc nhìn quảng cáo Facebook Ads", SOCIAL)).toBe("batgioi");
    expect(recommendAgent("Từ khóa hot search đang tăng", SOCIAL)).toBe("ngokhong");
    expect(recommendAgent("Lịch đăng và content pillars", SOCIAL)).toBe("quanam");
    expect(recommendAgent("việc lặt vặt", SOCIAL)).toBe("duongtang");
    expect(ownerCandidates([], SOCIAL).map((agent) => agent.id)).toEqual(["duongtang"]);
  });

  it("keeps the copywriter when a post also needs an image", () => {
    const areas = matchedAreas("Viết bài đăng Facebook và prompt ảnh 4:5", SOCIAL);
    expect(areas).toContain("duongtang");
    expect(areas).toContain("phatto");
    const team = relevantAgents("Viết bài đăng Facebook và prompt ảnh 4:5", "phatto", areas, SOCIAL);
    expect(team[0]).toBe("phatto");
    expect(team).toContain("duongtang");
    expect(team).not.toContain("haotu");
  });
});
