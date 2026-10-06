import { NextRequest } from "next/server";
import { readJson } from "@/lib/api-helpers";
import { withPainel } from "@/lib/whatsapp/painel-http";
import { reconnectSession } from "@/lib/whatsapp/painel";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** Reconectar (QR de novo; na uazapi também por código). Conversas e configurações ficam como estão. */
export async function POST(request: NextRequest, { params }: RouteProps) {
  const { id } = await params;
  const body = ((await readJson(request)) ?? {}) as Record<string, unknown>;
  return withPainel({ manage: true, action: "connect WhatsApp numbers" }, (ctx, deps) =>
    reconnectSession(ctx, id, deps, { method: body.method, phone: body.phone })
  );
}
