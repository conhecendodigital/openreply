import { NextRequest } from "next/server";
import { fail, readJson } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { hitRateLimit } from "@/lib/http-rate-limit";
import { withPainel } from "@/lib/whatsapp/painel-http";
import { generateSuggestionsAi } from "@/lib/whatsapp/regras/painel";
import { depsIaDoAdmin } from "@/lib/whatsapp/regras/servidor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/** "Gerar sugestões com IA" ({ sessionId }): grava sugestões PENDENTES. Nada vira regra sem o clique do dono. */
export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (userId) {
    const limited = await hitRateLimit("wa-sugestoes", userId, 10, 60 * 60);
    if (!limited.allowed) return fail("Too many requests in a short time. Try again in a while.", 429, { code: "rate_limited" });
  }
  const body = ((await readJson(request)) ?? {}) as Record<string, unknown>;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
  return withPainel({ manage: true, action: "change the WhatsApp agents" }, async (ctx, deps) =>
    generateSuggestionsAi(ctx, sessionId, deps, await depsIaDoAdmin(ctx, "aprendizado"))
  );
}
