import { NextRequest } from "next/server";
import { withPainel } from "@/lib/whatsapp/painel-http";
import { disconnectSession } from "@/lib/whatsapp/painel";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** Desconectar: só logout no gateway. NUNCA apaga conversas, contatos nem configurações. */
export async function POST(_request: NextRequest, { params }: RouteProps) {
  const { id } = await params;
  return withPainel({ manage: true, action: "disconnect WhatsApp numbers" }, (ctx, deps) => disconnectSession(ctx, id, deps));
}
