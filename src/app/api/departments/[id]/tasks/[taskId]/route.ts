import { openStore } from "@/server/db";
import { createLlmClient, llmConfig } from "@/server/llm";
import { canResolve, runResolve } from "@/server/orchestrator";
import { TASK_ID, clientKey, department, parseResolve, rateLimited, readJson, sameOrigin, tryLock, unlock } from "@/server/security";
import { ndjson } from "@/server/stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const dept = department(id);
  if (!dept || !TASK_ID.test(taskId)) return Response.json({ error: "not_found" }, { status: 404 });
  if (!sameOrigin(request)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (rateLimited(`resolve:${clientKey(request)}`, 30, 60_000)) return Response.json({ error: "rate_limited" }, { status: 429 });

  const input = parseResolve(await readJson(request));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });

  const store = openStore(dept.id);
  if (!store.getTask(taskId)) return Response.json({ error: "not_found" }, { status: 404 });
  if (!tryLock(dept.id)) return Response.json({ error: "busy" }, { status: 409 });
  // Checked after the lock so two clicks cannot both resolve the same task.
  if (!canResolve(store.getTask(taskId))) {
    unlock(dept.id);
    return Response.json({ error: "not_in_review" }, { status: 409 });
  }

  const config = llmConfig();
  return ndjson(async (emit) => {
    try {
      await runResolve({ store, dept, llm: config ? createLlmClient(config) : null, locale: input.locale, emit }, taskId, input.action, input.note);
    } finally {
      unlock(dept.id);
    }
  });
}
