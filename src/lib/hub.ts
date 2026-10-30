import { AGENT_IDS, AgentId } from "./roster";
import type { TaskTitleKey } from "./tasks";

export type HubMessageKind = "plan" | "question" | "answer" | "handoff" | "review" | "decision";
export type HubThreadStatus = "open" | "synced" | "closed";

export interface HubThread {
  id: string;
  /** i18n key (tasks.*) for seeded threads, or a free-text title for custom tasks. */
  topicKey?: TaskTitleKey;
  topicTitle?: string;
  taskId?: string;
  participants: AgentId[];
  status: HubThreadStatus;
}

export interface HubMessage {
  id: string;
  threadId: string;
  from: AgentId;
  kind: HubMessageKind;
  /** i18n key under hub.msg.* */
  textKey: string;
  at: number;
}

export interface HubState {
  version: number;
  threads: HubThread[];
  messages: HubMessage[];
  /** Latest hub version each agent has received. */
  knownVersion: Record<AgentId, number>;
}

function allKnown(version: number): Record<AgentId, number> {
  return Object.fromEntries(AGENT_IDS.map((id) => [id, version])) as Record<AgentId, number>;
}

export function createHub(): HubState {
  return { version: 0, threads: [], messages: [], knownVersion: allKnown(0) };
}

/** Push the current hub version to every agent (full sync). */
export function syncAll(state: HubState): HubState {
  return { ...state, knownVersion: allKnown(state.version) };
}

/** Agents that are not up to date with the hub. */
export function unsyncedAgents(state: HubState): AgentId[] {
  return AGENT_IDS.filter((id) => state.knownVersion[id] < state.version);
}

export function syncedCount(state: HubState): number {
  return AGENT_IDS.length - unsyncedAgents(state).length;
}

export function openThread(
  state: HubState,
  input: { id: string; participants: AgentId[]; taskId?: string; topicKey?: TaskTitleKey; topicTitle?: string },
): HubState {
  if (state.threads.some((thread) => thread.id === input.id)) return state;
  const thread: HubThread = {
    id: input.id,
    taskId: input.taskId,
    topicKey: input.topicKey,
    topicTitle: input.topicTitle,
    participants: Array.from(new Set(input.participants)),
    status: "open",
  };
  return syncAll({ ...state, version: state.version + 1, threads: [...state.threads, thread] });
}

/** Add an agent to a thread (e.g. when responsibility shifts). Everyone is re-synced. */
export function joinThread(state: HubState, threadId: string, agentId: AgentId): HubState {
  const thread = state.threads.find((item) => item.id === threadId);
  if (!thread || thread.participants.includes(agentId)) return state;
  return syncAll({
    ...state,
    version: state.version + 1,
    threads: state.threads.map((item) => item.id === threadId ? { ...item, participants: [...item.participants, agentId] } : item),
  });
}

export function closeThread(state: HubState, threadId: string): HubState {
  return syncAll({
    ...state,
    version: state.version + 1,
    threads: state.threads.map((item) => item.id === threadId ? { ...item, status: "closed" } : item),
  });
}

/**
 * Append a message. Only thread participants may speak; the update is then synced to
 * every agent so non-participants stay informed without joining the conversation.
 */
export function postMessage(
  state: HubState,
  input: { id: string; threadId: string; from: AgentId; kind: HubMessageKind; textKey: string; at: number },
): HubState {
  const thread = state.threads.find((item) => item.id === input.threadId);
  if (!thread || thread.status === "closed" || !thread.participants.includes(input.from)) return state;
  return syncAll({
    ...state,
    version: state.version + 1,
    messages: [...state.messages, input],
    threads: state.threads.map((item) => item.id === thread.id ? { ...item, status: "synced" } : item),
  });
}

export type ScriptStep = { from: AgentId; kind: HubMessageKind; textKey: string };

/** Scripted (simulated) conversation between the participants of a new task. */
export function conversationScript(ownerId: AgentId, participants: AgentId[]): ScriptStep[] {
  const others = participants.filter((id) => id !== ownerId);
  const second = others[0];
  const third = others[1];
  const steps: ScriptStep[] = [{ from: ownerId, kind: "plan", textKey: "hub.msg.plan" }];
  if (second) {
    steps.push({ from: second, kind: "question", textKey: "hub.msg.question" });
    steps.push({ from: ownerId, kind: "answer", textKey: "hub.msg.answer" });
  }
  if (third) steps.push({ from: third, kind: "handoff", textKey: "hub.msg.handoff" });
  return steps;
}

export function threadIsActive(thread: HubThread): boolean {
  return thread.status !== "closed";
}
