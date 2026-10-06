import { NextRequest } from "next/server";
import { withPainel } from "@/lib/whatsapp/painel-http";
import { getThread } from "@/lib/whatsapp/painel";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** Conversa aberta: mensagens, janela de 24h, pausa do agente e rascunho pendente. */
export async function GET(_request: NextRequest, { params }: RouteProps) {
  const { id } = await params;
  return withPainel({ action: "read WhatsApp" }, (ctx, deps) => getThread(ctx, id, deps));
}
