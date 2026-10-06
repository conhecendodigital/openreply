/**
 * /admin > Chaves de IA > Testar: uma chamada mínima na API oficial do
 * provedor com a chave salva (ou com a que você acabou de digitar, antes de
 * salvar). Responde só ok ou o erro do provedor, sem a chave.
 * Limite: 10 testes a cada 10 minutos por admin.
 */
import { fail, ok, readJson } from "@/lib/api-helpers";
import { requireAiAdmin } from "@/lib/ai/admin-guard";
import { keyForTest } from "@/lib/ai/credentials";
import { isAiProvider, keyFormatHint, validateKeyFormat } from "@/lib/ai/catalog";
import { AI_KEY_TEST_LIMIT, testAiKey } from "@/lib/ai/provider-test";
import { hitRateLimit } from "@/lib/http-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ provider: string }> };

export async function POST(request: Request, { params }: RouteProps) {
  const guard = await requireAiAdmin();
  if ("response" in guard) return guard.response;
  const { provider } = await params;
  if (!isAiProvider(provider)) return fail("Unknown provider.", 404);

  const limit = await hitRateLimit("ai-key-test", guard.admin.user.id, AI_KEY_TEST_LIMIT.limit, AI_KEY_TEST_LIMIT.windowSeconds);
  if (!limit.allowed) return fail("Too many tests. Wait a few minutes and try again.", 429);

  const body = (await readJson(request)) as { key?: unknown } | null;
  const typed = typeof body?.key === "string" ? body.key.trim() : "";
  let key: string | null;
  if (typed) {
    if (!validateKeyFormat(provider, typed)) return fail(keyFormatHint(provider), 400);
    key = typed;
  } else {
    key = await keyForTest(guard.admin.user.id, provider);
    if (!key) return fail("There is no key saved for this provider.", 404);
  }

  const result = await testAiKey(provider, key);
  return ok(result);
}
