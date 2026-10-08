import { NextRequest } from "next/server";
import { ok, requireContext } from "@/lib/api-helpers";
import { listarEnviados } from "@/lib/whatsapp/programados";

export const dynamic = "force-dynamic";

const UMA_SEMANA_MS = 7 * 86_400_000;

/**
 * O que os textos programados já mandaram desde ?desde= (padrão: 7 dias):
 * só rótulo, horário e conversa, nunca o texto. Aceita chave de API (lista
 * em lib/api-key-routes.ts): é o que o Mac do dono lê pra mover a pasta do
 * roteiro pra "gravados" no Drive.
 */
export async function GET(request: NextRequest) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const raw = request.nextUrl.searchParams.get("desde");
  const parsed = raw ? new Date(raw) : null;
  const desde = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(Date.now() - UMA_SEMANA_MS);
  return ok(await listarEnviados({ userId: auth.context.userId, workspaceId: auth.context.workspaceId }, desde));
}
