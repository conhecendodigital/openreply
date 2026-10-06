import { NextRequest } from "next/server";
import { readJson } from "@/lib/api-helpers";
import { withPainel } from "@/lib/whatsapp/painel-http";
import { getAgents, saveAgents } from "@/lib/whatsapp/painel";

export const dynamic = "force-dynamic";

/** Os 3 agentes de um número (?sessionId=). */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  return withPainel({ action: "read WhatsApp" }, (ctx, deps) => getAgents(ctx, sessionId, deps));
}

/** Salva modo do número, perfil e os 3 agentes. Só dono ou admin do workspace. */
export async function PUT(request: NextRequest) {
  const body = ((await readJson(request)) ?? {}) as Record<string, unknown>;
  return withPainel({ manage: true, action: "change the WhatsApp agents" }, (ctx, deps) => saveAgents(ctx, body, deps));
}
