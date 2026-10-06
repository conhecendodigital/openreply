import { NextRequest } from "next/server";
import { fail, readJson } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { hitRateLimit } from "@/lib/http-rate-limit";
import { withPainel } from "@/lib/whatsapp/painel-http";
import { runAgentTest } from "@/lib/whatsapp/regras/painel";
import { depsIaDoAdmin } from "@/lib/whatsapp/regras/servidor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Até 6 conversas simuladas ao mesmo tempo, algumas trocas cada.
export const maxDuration = 300;

/** "Testar o agente" ({ sessionId }): simula os casos de teste do briefing. Custo em Gastos de IA (Teste do agente). */
export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (userId) {
    const limited = await hitRateLimit("wa-testar", userId, 6, 60 * 60);
    if (!limited.allowed) return fail("Too many tests in a short time. Try again in a while.", 429, { code: "rate_limited" });
  }
  const body = ((await readJson(request)) ?? {}) as Record<string, unknown>;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
  return withPainel({ manage: true, action: "test the WhatsApp agents" }, async (ctx, deps) => runAgentTest(ctx, sessionId, deps, await depsIaDoAdmin(ctx, "teste")));
}
