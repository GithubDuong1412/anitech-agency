import { openStore } from "@/server/db";
import { TASK_ID, clientKey, department, rateLimited, sameOrigin, tryLock, unlock } from "@/server/security";
import type { Task } from "@/lib/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const dept = department(id);
  if (!dept || !TASK_ID.test(taskId)) return Response.json({ error: "not_found" }, { status: 404 });
  if (!sameOrigin(request)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (rateLimited(`restore:${clientKey(request)}`, 30, 60_000)) return Response.json({ error: "rate_limited" }, { status: 429 });

  const store = await openStore(dept.id);
  const existing = await store.getTask(taskId);
  if (!existing?.deletedAt) return Response.json({ error: "not_found" }, { status: 404 });
  if (!tryLock(dept.id)) return Response.json({ error: "busy" }, { status: 409 });
  try {
    const task = await store.getTask(taskId);
    if (!task?.deletedAt) return Response.json({ error: "not_found" }, { status: 404 });
    const next: Task = { ...task, deletedAt: undefined };
    await store.saveTask(next);
    const restored = await store.getTask(taskId);
    return Response.json({ task: restored ?? next });
  } finally {
    unlock(dept.id);
  }
}
