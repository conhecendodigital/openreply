import { NextRequest } from "next/server";
import { readJson } from "@/lib/api-helpers";
import { withPainel } from "@/lib/whatsapp/painel-http";
import { adicionarProgramados, listarProgramados } from "@/lib/whatsapp/programados";

export const dynamic = "force-dynamic";

/** A fila de textos programados (?conversationId= pra uma conversa só). */
export async function GET(request: NextRequest) {
  const conversationId = request.nextUrl.searchParams.get("conversationId");
  return withPainel({ action: "read WhatsApp" }, (ctx, deps) => listarProgramados(ctx, deps, conversationId));
}

/** Põe textos no fim da fila: { conversationId, itens: [{ label, text }] }. Só dono ou admin. */
export async function POST(request: NextRequest) {
  const body = ((await readJson(request)) ?? {}) as Record<string, unknown>;
  return withPainel(
    { manage: true, action: "schedule WhatsApp messages" },
    (ctx, deps) => adicionarProgramados(ctx, deps, { conversationId: body.conversationId, itens: body.itens }),
    201
  );
}
