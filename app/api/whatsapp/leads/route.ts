import { NextRequest } from "next/server";
import { withPainelLeitura } from "@/lib/whatsapp/painel-http";
import { listLeads } from "@/lib/whatsapp/regras/painel";

export const dynamic = "force-dynamic";

/** Quadro de leads (CRM): colunas por estágio. ?sessionId= ?stage= ?from=AAAA-MM-DD ?to= ?q= */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  return withPainelLeitura((ctx, deps) =>
    listLeads(ctx, { sessionId: p.get("sessionId"), stage: p.get("stage"), from: p.get("from"), to: p.get("to"), q: p.get("q") }, deps)
  );
}
