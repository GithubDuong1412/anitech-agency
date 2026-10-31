import { dbEngine } from "@/server/db";
import { llmConfig } from "@/server/llm";

export const dynamic = "force-dynamic";

/** Tells the UI whether a real model is configured, and which database is in use. Never returns secrets. */
export function GET() {
  const config = llmConfig();
  return Response.json({ llm: Boolean(config), mode: config ? "ai" : "demo", model: config?.model ?? null, db: dbEngine() });
}
