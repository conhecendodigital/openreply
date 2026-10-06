import { NextRequest } from "next/server";
import { withPainel } from "@/lib/whatsapp/painel-http";
import { refreshSession } from "@/lib/whatsapp/painel";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** Status e QR atuais, direto do gateway (a tela chama a cada poucos segundos até conectar). */
export async function GET(_request: NextRequest, { params }: RouteProps) {
  const { id } = await params;
  return withPainel({ action: "read WhatsApp" }, (ctx, deps) => refreshSession(ctx, id, deps));
}
