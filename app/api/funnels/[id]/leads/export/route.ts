import { NextRequest, NextResponse } from "next/server";
import { fail, requireContext } from "@/lib/api-helpers";
import { findFunnel, humanOnly } from "@/lib/funnels/api";
import { leadsCsvRows } from "@/lib/funnels/service";
import { toCsv } from "@/lib/utils/csv-write";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

// CSV of the leads (formula-safe cells). Human only: personal data.
export async function GET(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("export quiz leads");
  if (blocked) return blocked;
  const { id } = await params;
  const row = await findFunnel(id, auth.context.workspaceId);
  if (!row) return fail("Funnel not found", 404);
  const csv = toCsv(await leadsCsvRows(row));
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${row.slug}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
