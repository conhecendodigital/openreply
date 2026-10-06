import { hitRateLimit } from "@/lib/http-rate-limit";
import { auditIntegrationTest, IntegrationReadError, isIntegrationService } from "@/lib/integrations/credentials";
import { integrationsFail, integrationsJson, requireIntegrationManager } from "@/lib/integrations/http";
import { INTEGRATION_TEST_LIMIT, testIntegration } from "@/lib/integrations/test-connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ service: string }> };

/**
 * Canais > Conexões e chaves > Testar conexão. Só leitura no serviço
 * (uazapi: /status e /instance/all; OpenWA: /api/health) com o que vale pra
 * este workspace. Responde ok ou um código; nunca o valor. 10 testes a cada
 * 10 minutos por pessoa.
 */
export async function POST(_request: Request, { params }: RouteProps) {
  const gate = await requireIntegrationManager();
  if ("error" in gate) return gate.error;
  const { service } = await params;
  if (!isIntegrationService(service)) return integrationsFail("Unknown service", "unknown_service", 404);
  const limit = await hitRateLimit("integration-test", gate.context.userId, INTEGRATION_TEST_LIMIT.limit, INTEGRATION_TEST_LIMIT.windowSeconds);
  if (!limit.allowed) return integrationsFail("Too many tests. Wait a few minutes and try again.", "rate_limited", 429);
  const ctx = { userId: gate.context.userId, workspaceId: gate.context.workspaceId };
  try {
    const result = await testIntegration(service, ctx.workspaceId);
    await auditIntegrationTest(ctx, service);
    return integrationsJson({ success: true, data: result });
  } catch (error) {
    if (error instanceof IntegrationReadError) return integrationsFail("Could not read the saved keys", "keys_unreadable", 503);
    console.warn("[integrações] o teste de conexão falhou antes de chamar o serviço");
    return integrationsFail("The test failed", "test_failed", 500);
  }
}
