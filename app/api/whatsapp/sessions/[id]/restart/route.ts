import { NextRequest } from "next/server";
import { withPainel } from "@/lib/whatsapp/painel-http";
import { restartUazapi } from "@/lib/whatsapp/painel-uazapi";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** uazapi: reiniciar a conexão travada, sem novo QR e sem apagar nada. Só dono ou admin do workspace. */
export async function POST(_request: NextRequest, { params }: RouteProps) {
  const { id } = await params;
  return withPainel({ manage: true, action: "connect WhatsApp numbers" }, (ctx, deps) => restartUazapi(ctx, id, deps));
}
