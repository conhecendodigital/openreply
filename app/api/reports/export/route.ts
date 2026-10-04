import { NextRequest, NextResponse } from "next/server";
import { requireContext } from "@/lib/api-helpers";
import { toCsv } from "@/lib/utils/csv-write";
import {
  buildPeriodReport,
  parsePeriod,
  REPORT_SECTIONS,
  reportCsvRows,
  type ReportSection,
} from "@/lib/reports/period";

export const dynamic = "force-dynamic";

// CSV of the report: ?days=7|30|90&section=all|dms|campaigns|flows|broadcasts|contacts|tags|posts|moderation|funnel.
export async function GET(request: NextRequest) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const days = parsePeriod(request.nextUrl.searchParams.get("days"));
  const raw = request.nextUrl.searchParams.get("section") ?? "all";
  const section = (REPORT_SECTIONS as readonly string[]).includes(raw) ? (raw as ReportSection) : "all";
  const report = await buildPeriodReport(auth.context.workspaceId, days);
  const csv = toCsv(reportCsvRows(report, section));
  const filename = `relatorio-${days}d-${section}-${report.until.slice(0, 10)}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
