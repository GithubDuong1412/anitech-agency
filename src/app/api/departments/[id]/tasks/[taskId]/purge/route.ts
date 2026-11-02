import { openStore } from "@/server/db";
import { TASK_ID, clientKey, department, parseDelete, rateLimited, readJson, sameOrigin, tryLock, unlock } from "@/server/security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Erase a task that is already in the trash, including its conversation. */

export async function POST(request: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const dept = department(id);
  if (!dept || !TASK_ID.test(taskId)) return Response.json({ error: "not_found" }, { status: 404 });
  if (!sameOrigin(request)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (rateLimited(`purge:${clientKey(request)}`, 30, 60_000)) return Response.json({ error: "rate_limited" }, { status: 429 });
  if (!parseDelete(await readJson(request))) return Response.json({ error: "invalid" }, { status: 400 });

  const store = await openStore(dept.id);
  const existing = await store.getTask(taskId);
  if (!existing?.deletedAt) return Response.json({ error: "not_found" }, { status: 404 });
  if (!tryLock(dept.id)) return Response.json({ error: "busy" }, { status: 409 });
  try {
    const removed = await store.purgeTask(taskId);
    if (!removed) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ ok: true });
  } finally {
    unlock(dept.id);
  }
}
