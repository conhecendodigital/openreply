import { NextRequest } from "next/server";
import { withPainel } from "@/lib/whatsapp/painel-http";
import { markRead } from "@/lib/whatsapp/painel";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** Zera as não lidas (e marca como lida no WhatsApp, quando dá). */
export async function POST(_request: NextRequest, { params }: RouteProps) {
  const { id } = await params;
  return withPainel({ action: "read WhatsApp" }, async (ctx, deps) => {
    await markRead(ctx, id, deps);
    return { read: true };
  });
}
