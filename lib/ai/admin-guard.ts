/**
 * Porta das rotas de /api/admin/ai/*: só a sessão do admin da plataforma com
 * 2FA ligado. Chave de API (qualquer Authorization) recebe 403 aqui também,
 * além do bloqueio do proxy.ts (essas rotas não estão em lib/api-key-routes.ts).
 */
import type { NextResponse } from "next/server";
import { fail } from "@/lib/api-helpers";
import { auth, isApiTokenRequest, needsTwoFactorSetup, type AppSession } from "@/lib/auth";

export async function requireAiAdmin(): Promise<{ admin: AppSession } | { response: NextResponse }> {
  if (await isApiTokenRequest()) {
    return { response: fail("API keys cannot use this route. Do it in the Lead Engine.", 403) };
  }
  const session = await auth().catch(() => null);
  if (!session) return { response: fail("Unauthorized", 401) };
  if (session.user.role !== "ADMIN" || needsTwoFactorSetup(session.user)) {
    return { response: fail("Only the platform admin can do this.", 403) };
  }
  return { admin: session };
}

/** Configurações > Gasto de IA: a própria pessoa, pela sessão (nunca chave de API). */
export async function requireSessionUser(): Promise<{ session: AppSession } | { response: NextResponse }> {
  if (await isApiTokenRequest()) {
    return { response: fail("API keys cannot use this route. Do it in the Lead Engine.", 403) };
  }
  const session = await auth().catch(() => null);
  if (!session) return { response: fail("Unauthorized", 401) };
  if (needsTwoFactorSetup(session.user)) return { response: fail("Turn on two-step verification first.", 403) };
  return { session };
}
