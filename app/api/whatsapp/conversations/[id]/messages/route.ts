import { NextRequest } from "next/server";
import { readJson } from "@/lib/api-helpers";
import { withPainel } from "@/lib/whatsapp/painel-http";
import { sendReply } from "@/lib/whatsapp/painel";
import { hitRateLimit } from "@/lib/http-rate-limit";
import { fail } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** Resposta humana pelo inbox (regra das 24h vale aqui também). Pausa o agente nessa conversa. */
export async function POST(request: NextRequest, { params }: RouteProps) {
  const { id } = await params;
  const userId = await getCurrentUserId();
  if (userId) {
    const limited = await hitRateLimit("wa-inbox-send", userId, 60, 60);
    if (!limited.allowed) return fail("Too many messages in a short time. Wait a moment.", 429, { code: "rate_limited" });
  }
  const body = ((await readJson(request)) ?? {}) as Record<string, unknown>;
  return withPainel({ action: "send WhatsApp messages" }, (ctx, deps) => sendReply(ctx, id, { text: body.text }, deps), 202);
}
