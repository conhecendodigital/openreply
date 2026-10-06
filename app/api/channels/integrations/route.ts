import { withSystemRole } from "@/lib/db/rls";
import { getPrisma } from "@/lib/db/client";
import { AI_PROVIDERS } from "@/lib/ai/catalog";
import { listIntegrationAudit, listIntegrationsForManager } from "@/lib/integrations/credentials";
import { integrationsFail, integrationsJson, requireIntegrationManager } from "@/lib/integrations/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Canais > Conexões e chaves: o que está configurado em cada serviço deste
 * workspace (uazapi, gateway OpenWA), de onde vem (Canais ou servidor) e as
 * últimas mudanças. Nunca o valor: só "salvo", os 4 últimos, quem e quando.
 * As chaves de IA são da plataforma: só o admin da plataforma recebe o status
 * (configurada ou não), pra ir ao /admin trocar.
 */
export async function GET() {
  const gate = await requireIntegrationManager();
  if ("error" in gate) return gate.error;
  const ctx = { userId: gate.context.userId, workspaceId: gate.context.workspaceId };
  try {
    const [services, audit] = await Promise.all([listIntegrationsForManager(ctx), listIntegrationAudit(ctx).catch(() => [])]);
    let ai: Record<string, boolean> | null = null;
    if (gate.isPlatformAdmin) {
      const rows = await withSystemRole(
        (tx) => tx.platformAiCredential.findMany({ where: { active: true }, select: { provider: true } }),
        getPrisma()
      ).catch(() => [] as Array<{ provider: string }>);
      ai = Object.fromEntries(AI_PROVIDERS.map((p) => [p, rows.some((r) => r.provider === p)]));
    }
    return integrationsJson({
      success: true,
      data: { services, audit, whatsappEnabled: process.env.WHATSAPP_ENABLED === "1", ai },
    });
  } catch {
    console.warn("[integrações] não deu pra carregar Conexões e chaves");
    return integrationsFail("Could not load", "load_failed", 500);
  }
}
