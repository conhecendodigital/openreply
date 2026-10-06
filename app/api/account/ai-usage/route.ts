/**
 * Configurações > Gasto de IA: só o gasto da própria pessoa (o código filtra
 * pelo usuário da sessão e a RLS confere de novo). Mesmo formato do relatório
 * do admin, sem e-mail nem nome de ninguém. ?format=csv baixa as linhas.
 */
import { fail, ok } from "@/lib/api-helpers";
import { requireSessionUser } from "@/lib/ai/admin-guard";
import { getUsageCsv, getUsageReport, parseUsageFilters } from "@/lib/ai/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireSessionUser();
  if ("response" in guard) return guard.response;
  const params = new URL(request.url).searchParams;
  // Filtro de outra pessoa ou workspace não vale aqui.
  params.delete("userId");
  const parsed = parseUsageFilters(params);
  if (!parsed.ok) return fail(parsed.error, 400);
  const viewer = { userId: guard.session.user.id, admin: false };
  if (params.get("format") === "csv") {
    const csv = await getUsageCsv(viewer, parsed.filters);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="meu-gasto-ia-${parsed.filters.from.toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store",
      },
    });
  }
  return ok(await getUsageReport(viewer, parsed.filters));
}
