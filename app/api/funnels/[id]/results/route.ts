import { NextRequest } from "next/server";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { findFunnel } from "@/lib/funnels/api";
import { funnelResults } from "@/lib/funnels/service";
import { parsePeriod } from "@/lib/reports/period";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

// Numbers of the period, no personal data (API keys may read it).
export async function GET(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const row = await findFunnel(id, auth.context.workspaceId);
  if (!row) return fail("Funnel not found", 404);
  const days = parsePeriod(request.nextUrl.searchParams.get("days"));
  const source = request.nextUrl.searchParams.get("source")?.slice(0, 60) || null;
  return ok(await funnelResults({ funnel: row, days, source }));
}
