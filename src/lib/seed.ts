import { type DepartmentId, SOCIAL } from "./roster";
import { createHub, openThread, postMessage, type HubState } from "./hub";
import type { Task } from "./tasks";
import type { ActivityRecord, DeptSnapshot } from "./state";

const itTasks: Task[] = [
  { id: "task-1", titleKey: "catalogApi", ownerId: "sasuke", status: "active", progress: 64, createdAt: 0 },
  { id: "task-2", titleKey: "checkoutTests", ownerId: "goku", status: "review", progress: 100, createdAt: 0 },
];

const itActivity: ActivityRecord[] = [
  { id: "activity-1", type: "seed", agentId: "sasuke", messageKey: "activity.seedApi" },
  { id: "activity-2", type: "seed", agentId: "goku", messageKey: "activity.seedReview" },
  { id: "activity-3", type: "seed", agentId: "levi", messageKey: "activity.seedTests" },
];

const socialTasks: Task[] = [
  { id: "task-s1", titleKey: "facebookCaption", ownerId: "duongtang", status: "active", progress: 64, createdAt: 0 },
  { id: "task-s2", titleKey: "carouselBrief", ownerId: "bachlongma", status: "review", progress: 100, createdAt: 0 },
];

const socialActivity: ActivityRecord[] = [
  { id: "activity-s1", type: "seed", agentId: "duongtang", messageKey: "activity.seedCaption" },
  { id: "activity-s2", type: "seed", agentId: "bachlongma", messageKey: "activity.seedCarousel" },
  { id: "activity-s3", type: "seed", agentId: "ngokhong", messageKey: "activity.seedTrend" },
];

function buildItHub(): HubState {
  let hub = createHub();
  hub = openThread(hub, { id: "thread-task-1", taskId: "task-1", topicKey: "catalogApi", participants: ["sasuke", "natsu"] });
  hub = postMessage(hub, { id: "hub-seed-1", threadId: "thread-task-1", from: "sasuke", kind: "plan", textKey: "hub.msg.plan", at: 0 });
  hub = postMessage(hub, { id: "hub-seed-2", threadId: "thread-task-1", from: "natsu", kind: "question", textKey: "hub.msg.question", at: 0 });
  hub = openThread(hub, { id: "thread-task-2", taskId: "task-2", topicKey: "checkoutTests", participants: ["levi", "goku"] });
  hub = postMessage(hub, { id: "hub-seed-3", threadId: "thread-task-2", from: "levi", kind: "handoff", textKey: "hub.msg.handoff", at: 0 });
  hub = postMessage(hub, { id: "hub-seed-4", threadId: "thread-task-2", from: "goku", kind: "review", textKey: "hub.msg.review", at: 0 });
  return hub;
}

function buildSocialHub(): HubState {
  let hub = createHub(SOCIAL.agents.map((agent) => agent.id));
  hub = openThread(hub, { id: "thread-task-s1", taskId: "task-s1", topicKey: "facebookCaption", participants: ["duongtang", "phatto"] });
  hub = postMessage(hub, { id: "hub-social-1", threadId: "thread-task-s1", from: "duongtang", kind: "plan", textKey: "hub.msg.plan", at: 0 });
  hub = postMessage(hub, { id: "hub-social-2", threadId: "thread-task-s1", from: "phatto", kind: "question", textKey: "hub.msg.question", at: 0 });
  hub = openThread(hub, { id: "thread-task-s2", taskId: "task-s2", topicKey: "carouselBrief", participants: ["bachlongma", "quanam"] });
  hub = postMessage(hub, { id: "hub-social-3", threadId: "thread-task-s2", from: "bachlongma", kind: "handoff", textKey: "hub.msg.handoff", at: 0 });
  hub = postMessage(hub, { id: "hub-social-4", threadId: "thread-task-s2", from: "quanam", kind: "review", textKey: "hub.msg.review", at: 0 });
  return hub;
}

/** The demo content every department starts with, before any real task. */
export function seedSnapshot(id: DepartmentId): DeptSnapshot {
  const social = id === SOCIAL.id;
  return {
    tasks: social ? socialTasks : itTasks,
    activities: social ? socialActivity : itActivity,
    hub: social ? buildSocialHub() : buildItHub(),
  };
}
