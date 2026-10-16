import { NextRequest } from "next/server";
import { fail, intParam, ok, requireContext } from "@/lib/api-helpers";
import { findFunnel } from "@/lib/funnels/api";
import { funnelLeads } from "@/lib/funnels/service";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

// Leads are personal data: only an owner/admin (session or their own API key) reads them. Read-only; export and delete stay on the screen.
export async function GET(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const row = await findFunnel(id, auth.context.workspaceId);
  if (!row) return fail("Funnel not found", 404);
  const sp = request.nextUrl.searchParams;
  const cursor = sp.get("cursor")?.slice(0, 40) || null;
  return ok(await funnelLeads({ funnelId: row.id, cursor, limit: intParam(sp.get("limit"), 50, 1, 100) }));
}
