import { NextRequest } from "next/server";
import { withPainel } from "@/lib/whatsapp/painel-http";
import { getLearning } from "@/lib/whatsapp/regras/painel";

export const dynamic = "force-dynamic";

/** "O que o agente aprendeu" de um número (?sessionId=): exemplos, erros bloqueados por regra e sugestões. */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  return withPainel({ action: "read WhatsApp" }, (ctx, deps) => getLearning(ctx, sessionId, deps));
}
