import { describe, expect, it } from "vitest";
import { approveTask, createTask, requestTaskChanges } from "../src/lib/tasks";

describe("task lifecycle", () => {
  it("creates an active task with a trimmed title", () => {
    expect(createTask({ id: "task-test", title: "  Build API  ", ownerId: "sasuke", createdAt: 100 })).toEqual({
      id: "task-test",
      titleKey: "custom",
      title: "Build API",
      ownerId: "sasuke",
      status: "active",
      progress: 12,
      createdAt: 100,
    });
  });

  it("approves review tasks and leaves other statuses unchanged", () => {
    const reviewTask = createTask({ id: "review", title: "Ship", ownerId: "goku", createdAt: 10 });
    expect(approveTask({ ...reviewTask, status: "review", progress: 100 }).status).toBe("complete");
    expect(approveTask(reviewTask)).toBe(reviewTask);
  });

  it("returns review tasks to active work when changes are requested", () => {
    const reviewTask = { ...createTask({ id: "review", title: "Ship", ownerId: "goku" }), status: "review" as const, progress: 100 };
    expect(requestTaskChanges(reviewTask)).toMatchObject({ status: "active", progress: 35 });
    expect(requestTaskChanges(createTask({ id: "active", title: "Build", ownerId: "sasuke" })).status).toBe("active");
  });
});
