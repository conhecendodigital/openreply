import { NextRequest } from "next/server";
import { withPainel } from "@/lib/whatsapp/painel-http";
import { reconnectSession } from "@/lib/whatsapp/painel";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** Reconectar (gera QR de novo). Conversas e configurações ficam como estão. */
export async function POST(_request: NextRequest, { params }: RouteProps) {
  const { id } = await params;
  return withPainel({ manage: true, action: "connect WhatsApp numbers" }, (ctx, deps) => reconnectSession(ctx, id, deps));
}
