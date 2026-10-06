/**
 * /admin > Gastos de IA: relatório de todos (o admin vê tudo) e o CSV
 * (?format=csv). Filtros: period (today, 7d, 30d, month, custom + from/to),
 * userId, workspaceId, agent, provider, model.
 */
import { fail, ok } from "@/lib/api-helpers";
import { requireAiAdmin } from "@/lib/ai/admin-guard";
import { getUsageCsv, getUsageReport, parseUsageFilters } from "@/lib/ai/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireAiAdmin();
  if ("response" in guard) return guard.response;
  const params = new URL(request.url).searchParams;
  const parsed = parseUsageFilters(params);
  if (!parsed.ok) return fail(parsed.error, 400);
  const viewer = { userId: guard.admin.user.id, admin: true };
  if (params.get("format") === "csv") {
    const csv = await getUsageCsv(viewer, parsed.filters);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="gastos-ia-${parsed.filters.from.toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store",
      },
    });
  }
  return ok(await getUsageReport(viewer, parsed.filters));
}
