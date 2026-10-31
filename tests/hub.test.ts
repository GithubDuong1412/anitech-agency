import { describe, expect, it } from "vitest";
import { SOCIAL } from "../src/lib/roster";
import { closeThread, conversationScript, createHub, joinThread, openThread, postMessage, syncedCount, unsyncedAgents } from "../src/lib/hub";

describe("data hub", () => {
  it("syncs every agent when a thread opens", () => {
    const hub = openThread(createHub(), { id: "t1", participants: ["sasuke", "natsu"], topicTitle: "API" });
    expect(hub.version).toBe(1);
    expect(syncedCount(hub)).toBe(7);
    expect(unsyncedAgents(hub)).toEqual([]);
  });

  it("only lets participants speak, then syncs everyone", () => {
    let hub = openThread(createHub(), { id: "t1", participants: ["sasuke", "natsu"] });
    const rejected = postMessage(hub, { id: "m1", threadId: "t1", from: "levi", kind: "plan", textKey: "hub.msg.plan", at: 1 });
    expect(rejected.messages).toHaveLength(0);

    hub = postMessage(hub, { id: "m1", threadId: "t1", from: "sasuke", kind: "plan", textKey: "hub.msg.plan", at: 1 });
    expect(hub.messages).toHaveLength(1);
    expect(hub.threads[0].status).toBe("synced");
    expect(Object.values(hub.knownVersion).every((v) => v === hub.version)).toBe(true);
  });

  it("lets an agent join and ignores messages on closed threads", () => {
    let hub = openThread(createHub(), { id: "t1", participants: ["sasuke"] });
    hub = joinThread(hub, "t1", "goku");
    expect(hub.threads[0].participants).toContain("goku");
    hub = closeThread(hub, "t1");
    const after = postMessage(hub, { id: "m", threadId: "t1", from: "goku", kind: "review", textKey: "hub.msg.review", at: 2 });
    expect(after.messages).toHaveLength(0);
  });

  it("syncs the social floor on its own roster", () => {
    const hub = openThread(createHub(SOCIAL.agents.map((agent) => agent.id)), { id: "s1", participants: ["duongtang", "phatto"], topicTitle: "Caption" });
    expect(syncedCount(hub)).toBe(8);
    expect(unsyncedAgents(hub)).toEqual([]);
    expect(hub.agentIds).not.toContain("sasuke");
  });

  it("scripts a conversation led by the owner", () => {
    const script = conversationScript("sasuke", ["sasuke", "natsu", "levi"]);
    expect(script[0]).toMatchObject({ from: "sasuke", kind: "plan" });
    expect(script.map((step) => step.from)).toContain("natsu");
    expect(script.at(-1)?.from).toBe("levi");
  });
});
