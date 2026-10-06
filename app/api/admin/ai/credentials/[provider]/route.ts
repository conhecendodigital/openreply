/**
 * /admin > Chaves de IA: salvar (ou trocar) e remover a chave de um provedor.
 * A resposta só traz provedor, 4 últimos caracteres e datas. Cada mudança
 * fica em AdminAccessLog.
 */
import { fail, ok, readJson } from "@/lib/api-helpers";
import { requireAiAdmin } from "@/lib/ai/admin-guard";
import { removeAiCredential, saveAiCredential } from "@/lib/ai/credentials";
import { isAiProvider } from "@/lib/ai/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ provider: string }> };

export async function PUT(request: Request, { params }: RouteProps) {
  const guard = await requireAiAdmin();
  if ("response" in guard) return guard.response;
  const { provider } = await params;
  if (!isAiProvider(provider)) return fail("Unknown provider.", 404);
  const body = (await readJson(request)) as { key?: unknown } | null;
  const result = await saveAiCredential({ adminUserId: guard.admin.user.id, provider, key: body?.key });
  if (!result.ok) return fail(result.error, 400);
  return ok({ credential: result.credential, replaced: result.replaced });
}

export async function DELETE(_request: Request, { params }: RouteProps) {
  const guard = await requireAiAdmin();
  if ("response" in guard) return guard.response;
  const { provider } = await params;
  if (!isAiProvider(provider)) return fail("Unknown provider.", 404);
  const { removed } = await removeAiCredential({ adminUserId: guard.admin.user.id, provider });
  if (!removed) return fail("There is no key saved for this provider.", 404);
  return ok({ removed: true });
}
