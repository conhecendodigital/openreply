import { NextRequest } from "next/server";
import { readJson } from "@/lib/api-helpers";
import { withPainel } from "@/lib/whatsapp/painel-http";
import { createSession, listSessions } from "@/lib/whatsapp/painel";

export const dynamic = "force-dynamic";

/** Números de WhatsApp do workspace. */
export async function GET() {
  return withPainel({ action: "read WhatsApp" }, async (ctx, deps) => ({ sessions: await listSessions(ctx, deps) }));
}

/** Conectar um número novo pelo QR (pede o termo de risco aceito). Só dono ou admin do workspace. */
export async function POST(request: NextRequest) {
  const body = ((await readJson(request)) ?? {}) as Record<string, unknown>;
  return withPainel(
    { manage: true, action: "connect WhatsApp numbers" },
    (ctx, deps) => createSession(ctx, { acceptRisk: body.acceptRisk, displayName: body.displayName }, deps),
    201
  );
}
