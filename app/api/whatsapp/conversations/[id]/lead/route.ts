import { NextRequest } from "next/server";
import { readJson } from "@/lib/api-helpers";
import { withPainel } from "@/lib/whatsapp/painel-http";
import { PainelError } from "@/lib/whatsapp/painel";
import { editLeadFicha, releaseLeadStage, setLeadStage } from "@/lib/whatsapp/regras/painel";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * Lead da conversa:
 * { action: "stage", stage, reason?, kind? } muda o estágio na mão (vence o agente);
 * { action: "release" } devolve o estágio pro agente;
 * { action: "ficha", fields: { chave: "valor" } } edita a ficha (vale como confirmado).
 */
export async function POST(request: NextRequest, { params }: RouteProps) {
  const { id } = await params;
  const body = ((await readJson(request)) ?? {}) as Record<string, unknown>;
  return withPainel({ action: "change WhatsApp leads" }, (ctx, deps) => {
    if (body.action === "stage") return setLeadStage(ctx, id, { stage: body.stage, reason: body.reason, kind: body.kind }, deps);
    if (body.action === "release") return releaseLeadStage(ctx, id, deps);
    if (body.action === "ficha") return editLeadFicha(ctx, id, { fields: body.fields }, deps);
    throw new PainelError("invalid_action", "Unknown action.", 400);
  });
}
