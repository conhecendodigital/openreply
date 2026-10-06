import { NextRequest } from "next/server";
import { readJson } from "@/lib/api-helpers";
import { withPainel } from "@/lib/whatsapp/painel-http";
import { refreshSession } from "@/lib/whatsapp/painel";
import { deleteSession } from "@/lib/whatsapp/painel-excluir";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** Status e QR atuais, direto do gateway (a tela chama a cada poucos segundos até conectar). */
export async function GET(_request: NextRequest, { params }: RouteProps) {
  const { id } = await params;
  return withPainel({ action: "read WhatsApp" }, (ctx, deps) => refreshSession(ctx, id, deps));
}

/**
 * Excluir número (ação separada do Desconectar, sempre com confirmação na tela).
 * body: { mode: "number_only" | "number_and_conversations", confirmName? }.
 * Só dono ou admin do workspace; chave de API recebe 403.
 */
export async function DELETE(request: NextRequest, { params }: RouteProps) {
  const { id } = await params;
  const body = ((await readJson(request)) ?? {}) as Record<string, unknown>;
  return withPainel({ manage: true, action: "delete WhatsApp numbers" }, (ctx, deps) =>
    deleteSession(ctx, id, { mode: body.mode, confirmName: body.confirmName }, deps)
  );
}
