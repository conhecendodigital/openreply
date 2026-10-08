import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { painelDeps } from "@/lib/whatsapp/painel-http";
import { enviarProgramadosDoDia } from "@/lib/whatsapp/programados";

export const dynamic = "force-dynamic";

/**
 * Todo dia às 09:00 UTC = 6h de Brasília (scripts/cron.sh): enfileira os
 * próximos 10 textos programados de cada conversa, com 35 a 45 s entre eles.
 * Idempotente (uma vez por conversa por dia).
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const data = await enviarProgramadosDoDia(painelDeps());
  return NextResponse.json({ success: true, data });
}
