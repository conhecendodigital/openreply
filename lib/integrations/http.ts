/**
 * Porta das rotas /api/channels/integrations/* (Canais > Conexões e chaves).
 * Só dono ou admin do workspace, com sessão no navegador. Chave de API recebe
 * 403 no proxy.ts (as rotas não estão em lib/api-key-routes.ts) e de novo
 * aqui. Admin da plataforma sem 2FA não passa (getCurrentUserId devolve null).
 * Resposta sempre com Cache-Control: no-store.
 */
import { NextResponse } from "next/server";
import { auth, isApiTokenRequest, needsTwoFactorSetup } from "@/lib/auth";
import { canManageWorkspace, getCurrentWorkspaceContext, type WorkspaceContext } from "@/lib/workspace-access";

export function integrationsJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function integrationsFail(error: string, code: string, status: number) {
  return integrationsJson({ success: false, error, code }, status);
}

export type IntegrationGate = { context: WorkspaceContext; isPlatformAdmin: boolean };

export async function requireIntegrationManager(): Promise<IntegrationGate | { error: NextResponse }> {
  if (await isApiTokenRequest()) {
    return { error: integrationsFail("API keys cannot use this route. Do it in the Lead Engine.", "human_only", 403) };
  }
  const context = await getCurrentWorkspaceContext();
  if (!context) return { error: integrationsFail("Unauthorized", "unauthorized", 401) };
  if (!canManageWorkspace(context.role)) {
    return { error: integrationsFail("Only owners and admins can change this", "forbidden", 403) };
  }
  const session = await auth().catch(() => null);
  const isPlatformAdmin = Boolean(session && session.user.id === context.userId && session.user.role === "ADMIN" && !needsTwoFactorSetup(session.user));
  return { context, isPlatformAdmin };
}
