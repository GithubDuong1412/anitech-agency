import type { AgentId } from "./roster";
import type { HubState } from "./hub";
import type { Task } from "./tasks";

export type ActivityRecord = {
  id: string;
  type: "seed" | "assigned" | "arrived" | "submitted" | "approved" | "returned";
  agentId?: AgentId;
  messageKey?: string;
};

/** Everything the dashboard shows for one department map. This is what the database stores. */
export interface DeptSnapshot {
  tasks: Task[];
  activities: ActivityRecord[];
  hub: HubState;
}

/** Events the task routes stream (one JSON object per line) while agents work. */
export type RunEvent =
  | { type: "typing"; agentId: AgentId }
  | { type: "thread"; thread: import("./hub").HubThread }
  | { type: "message"; message: import("./hub").HubMessage; thread: import("./hub").HubThread }
  | { type: "task"; task: Task }
  | { type: "activity"; activity: ActivityRecord }
  | { type: "error"; code: string }
  | { type: "done" };
