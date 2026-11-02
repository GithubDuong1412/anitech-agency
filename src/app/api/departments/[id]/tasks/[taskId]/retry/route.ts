import { openStore } from "@/server/db";
import { createLlmClient, llmConfig } from "@/server/llm";
import { canRetry, runRetry } from "@/server/orchestrator";
import { TASK_ID, clientKey, department, parseLocaleBody, rateLimited, readJson, sameOrigin, tryLock, unlock } from "@/server/security";
import { ndjson } from "@/server/stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const dept = department(id);
  if (!dept || !TASK_ID.test(taskId)) return Response.json({ error: "not_found" }, { status: 404 });
  if (!sameOrigin(request)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (rateLimited(`retry:${clientKey(request)}`, 30, 60_000)) return Response.json({ error: "rate_limited" }, { status: 429 });

  const input = parseLocaleBody(await readJson(request));
  const store = await openStore(dept.id);
  const task = await store.getTask(taskId);
  if (!task || task.deletedAt) return Response.json({ error: "not_found" }, { status: 404 });
  if (!tryLock(dept.id)) return Response.json({ error: "busy" }, { status: 409 });
  if (!canRetry(await store.getTask(taskId))) {
    unlock(dept.id);
    return Response.json({ error: "not_failed" }, { status: 409 });
  }

  const config = llmConfig(process.env, dept.id);
  return ndjson(async (emit) => {
    try {
      await runRetry(
        { store, dept, llm: config ? createLlmClient(config) : null, provider: config ? "openai-compatible" : undefined, model: config?.model, locale: input.locale, emit, maxTurns: config?.maxTurns },
        taskId,
      );
    } finally {
      unlock(dept.id);
    }
  });
}
