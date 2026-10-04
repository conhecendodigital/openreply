import { NextRequest } from "next/server";
import { ok, requireContext } from "@/lib/api-helpers";
import { buildPeriodReport, parsePeriod } from "@/lib/reports/period";

export const dynamic = "force-dynamic";

// Workspace report for ?days=7|30|90 (default 30). Read only; any member.
export async function GET(request: NextRequest) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const days = parsePeriod(request.nextUrl.searchParams.get("days"));
  return ok(await buildPeriodReport(auth.context.workspaceId, days));
}
