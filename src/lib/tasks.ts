import type { AgentId } from "./roster";

/** Typed exactly, including the space, before a task can move to the trash. */
export const DELETE_PHRASE = "delete task";

export type TaskStatus = "active" | "review" | "complete" | "failed";
export type TaskTitleKey = "catalogApi" | "checkoutTests" | "adminAudit" | "facebookCaption" | "carouselBrief" | "custom";

export interface Task {
  id: string;
  titleKey: TaskTitleKey;
  title?: string;
  ownerId: AgentId;
  status: TaskStatus;
  runMode?: "ai" | "demo";
  provider?: string;
  model?: string;
  progress: number;
  createdAt: number;
  /** Set when the task is in the trash. Absent means it is still in the queue. */
  deletedAt?: number;
}

export function liveTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter((task) => task.deletedAt == null);
}

export function createTask(input: {
  id: string;
  title: string;
  ownerId: AgentId;
  createdAt?: number;
}): Task {
  return {
    id: input.id,
    titleKey: "custom",
    title: input.title.trim(),
    ownerId: input.ownerId,
    status: "active",
    progress: 12,
    createdAt: input.createdAt ?? Date.now(),
  };
}

export function approveTask(task: Task): Task {
  if (task.status !== "review") return task;
  return { ...task, status: "complete", progress: 100 };
}

export function requestTaskChanges(task: Task): Task {
  if (task.status !== "review") return task;
  return { ...task, status: "active", progress: 35 };
}
