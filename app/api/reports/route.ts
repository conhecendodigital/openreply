import { NextRequest } from "next/server";
import { ok, requireContext } from "@/lib/api-helpers";
import { buildPeriodReport, parseReportDays } from "@/lib/reports/period";

export const dynamic = "force-dynamic";

// Workspace report for ?days=1|7|30|90 (default 30; 1 or "hoje" = today in São Paulo). Read only; any member.
export async function GET(request: NextRequest) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const days = parseReportDays(request.nextUrl.searchParams.get("days"));
  return ok(await buildPeriodReport(auth.context.workspaceId, days));
}
