import { NextRequest } from "next/server";
import { fail, requireContext } from "@/lib/api-helpers";
import { humanOnly } from "@/lib/flows/api";
import { painelDeps } from "@/lib/whatsapp/painel-http";
import { PainelError } from "@/lib/whatsapp/painel";
import { exportLeadsCsv } from "@/lib/whatsapp/regras/painel";

export const dynamic = "force-dynamic";

/** CSV dos leads (?kind=leads, padrão) ou do histórico de estágio (?kind=history). Mesmos filtros do quadro. */
export async function GET(request: NextRequest) {
  const auth = await requireContext({});
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("export WhatsApp leads");
  if (blocked) return blocked;
  const p = request.nextUrl.searchParams;
  const kind = p.get("kind") === "history" ? "history" : "leads";
  try {
    const csv = await exportLeadsCsv(
      { userId: auth.context.userId, workspaceId: auth.context.workspaceId },
      { kind, sessionId: p.get("sessionId"), stage: p.get("stage"), from: p.get("from"), to: p.get("to"), q: p.get("q") },
      painelDeps()
    );
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="whatsapp-${kind === "history" ? "historico-estagios" : "leads"}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof PainelError) return fail(error.message, error.status, { code: error.code });
    return fail("Something went wrong. Try again in a minute.", 500, { code: "internal" });
  }
}
