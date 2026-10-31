import { openStore } from "@/server/db";
import { createLlmClient, llmConfig } from "@/server/llm";
import { runNewTask } from "@/server/orchestrator";
import { clientKey, department, parseNewTask, rateLimited, readJson, sameOrigin, tryLock, unlock } from "@/server/security";
import { ndjson } from "@/server/stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dept = department(id);
  if (!dept) return Response.json({ error: "not_found" }, { status: 404 });
  if (!sameOrigin(request)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (rateLimited(`task:${clientKey(request)}`, 12, 60_000)) return Response.json({ error: "rate_limited" }, { status: 429 });

  const input = parseNewTask(await readJson(request), dept);
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  if (!tryLock(dept.id)) return Response.json({ error: "busy" }, { status: 409 });

  const config = llmConfig();
  const store = openStore(dept.id);
  return ndjson(async (emit) => {
    try {
      await runNewTask(
        { store, dept, llm: config ? createLlmClient(config) : null, locale: input.locale, emit },
        { title: input.title, ownerId: input.ownerId, areas: input.areas },
      );
    } finally {
      unlock(dept.id);
    }
  });
}
