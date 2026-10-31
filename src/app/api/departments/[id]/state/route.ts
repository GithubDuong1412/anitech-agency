import { openStore } from "@/server/db";
import { department } from "@/server/security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dept = department(id);
  if (!dept) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(openStore(dept.id).snapshot(), { headers: { "Cache-Control": "no-store" } });
}
