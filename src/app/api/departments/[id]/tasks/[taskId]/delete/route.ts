import { openStore } from "@/server/db";
import { TASK_ID, clientKey, department, parseDelete, rateLimited, readJson, sameOrigin, tryLock, unlock } from "@/server/security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Soft-delete. The phrase is checked here, not only in the browser. */


export async function POST(request: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const dept = department(id);
  if (!dept || !TASK_ID.test(taskId)) return Response.json({ error: "not_found" }, { status: 404 });
  if (!sameOrigin(request)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (rateLimited(`delete:${clientKey(request)}`, 30, 60_000)) return Response.json({ error: "rate_limited" }, { status: 429 });
  if (!parseDelete(await readJson(request))) return Response.json({ error: "invalid" }, { status: 400 });

  const store = await openStore(dept.id);
  const existing = await store.getTask(taskId);
  if (!existing || existing.deletedAt) return Response.json({ error: "not_found" }, { status: 404 });
  if (!tryLock(dept.id)) return Response.json({ error: "busy" }, { status: 409 });
  try {
    const task = await store.getTask(taskId);
    if (!task || task.deletedAt) return Response.json({ error: "not_found" }, { status: 404 });
    const next = { ...task, deletedAt: Date.now() };
    await store.saveTask(next);
    return Response.json({ task: next });
  } finally {
    unlock(dept.id);
  }
}
