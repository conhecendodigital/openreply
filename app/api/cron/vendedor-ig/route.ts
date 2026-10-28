import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { rodarVendedorIg } from "@/lib/vendedor-ig/rodar";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * A cada minuto (scripts/cron.sh): o vendedor automático do Instagram atende, em fila e uma
 * conversa por vez, quem mandou DM nas contas em que o dono LIGOU o modo automático. Contas
 * desligadas (o padrão) nunca são tocadas; VENDEDOR_IG_DISABLED=1 desliga tudo.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const resumo = await rodarVendedorIg();
  return NextResponse.json({ success: true, data: resumo });
}
