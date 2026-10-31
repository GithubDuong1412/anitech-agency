import { llmConfig } from "@/server/llm";

export const dynamic = "force-dynamic";

/** Tells the UI whether a real model is configured. Never returns the key or the endpoint. */
export function GET() {
  const config = llmConfig();
  return Response.json({ llm: Boolean(config), model: config?.model ?? null });
}
