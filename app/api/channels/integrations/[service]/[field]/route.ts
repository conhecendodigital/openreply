import { readJson } from "@/lib/api-helpers";
import { hitRateLimit } from "@/lib/http-rate-limit";
import { fieldKind, INTEGRATION_WRITE_LIMIT, isIntegrationService, removeIntegrationField, saveIntegrationField } from "@/lib/integrations/credentials";
import { integrationsFail, integrationsJson, requireIntegrationManager } from "@/lib/integrations/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ service: string; field: string }> };

async function target(params: RouteProps["params"]) {
  const { service, field } = await params;
  if (!isIntegrationService(service) || !fieldKind(service, field)) return null;
  return { service, field };
}

/**
 * Canais > Conexões e chaves > Salvar (ou Trocar) um campo. O valor entra e
 * nunca volta: a resposta só diz se trocou e os 4 últimos caracteres.
 */
export async function PUT(request: Request, { params }: RouteProps) {
  const gate = await requireIntegrationManager();
  if ("error" in gate) return gate.error;
  const t = await target(params);
  if (!t) return integrationsFail("Unknown field", "unknown_field", 404);
  const limit = await hitRateLimit("integration-write", gate.context.userId, INTEGRATION_WRITE_LIMIT.limit, INTEGRATION_WRITE_LIMIT.windowSeconds);
  if (!limit.allowed) return integrationsFail("Too many changes. Wait a few minutes and try again.", "rate_limited", 429);
  const body = (await readJson(request)) as { value?: unknown } | null;
  try {
    const result = await saveIntegrationField(
      { userId: gate.context.userId, workspaceId: gate.context.workspaceId },
      { service: t.service, field: t.field, value: body?.value }
    );
    if (!result.ok) return integrationsFail("Invalid value", result.code, 400);
    const kind = fieldKind(t.service, t.field);
    return integrationsJson({ success: true, data: { replaced: result.replaced, last4: kind === "number" ? null : result.last4 } });
  } catch {
    // Nunca ecoa o erro: ele poderia carregar o que foi enviado.
    console.warn("[integrações] não deu pra salvar um campo");
    return integrationsFail("Could not save", "save_failed", 500);
  }
}

/** Remover um campo (a tela pede confirmação antes). */
export async function DELETE(_request: Request, { params }: RouteProps) {
  const gate = await requireIntegrationManager();
  if ("error" in gate) return gate.error;
  const t = await target(params);
  if (!t) return integrationsFail("Unknown field", "unknown_field", 404);
  const limit = await hitRateLimit("integration-write", gate.context.userId, INTEGRATION_WRITE_LIMIT.limit, INTEGRATION_WRITE_LIMIT.windowSeconds);
  if (!limit.allowed) return integrationsFail("Too many changes. Wait a few minutes and try again.", "rate_limited", 429);
  try {
    const { removed } = await removeIntegrationField(
      { userId: gate.context.userId, workspaceId: gate.context.workspaceId },
      { service: t.service, field: t.field }
    );
    if (!removed) return integrationsFail("Nothing saved here", "not_found", 404);
    return integrationsJson({ success: true, data: { removed: true } });
  } catch {
    console.warn("[integrações] não deu pra remover um campo");
    return integrationsFail("Could not remove", "remove_failed", 500);
  }
}
