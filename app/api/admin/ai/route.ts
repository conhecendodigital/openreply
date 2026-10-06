/**
 * /admin > Chaves de IA: o que a tela mostra. Chaves só como provedor + 4
 * últimos caracteres; a chave em si nunca sai daqui.
 */
import { ok } from "@/lib/api-helpers";
import { requireAiAdmin } from "@/lib/ai/admin-guard";
import { getAiSettingsForAdmin, listAiCredentialsForAdmin } from "@/lib/ai/credentials";
import { AI_PROVIDERS, CHAT_MODELS } from "@/lib/ai/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAiAdmin();
  if ("response" in guard) return guard.response;
  const adminId = guard.admin.user.id;
  const [credentials, settings] = await Promise.all([listAiCredentialsForAdmin(adminId), getAiSettingsForAdmin(adminId)]);
  return ok({ providers: AI_PROVIDERS, chatModels: CHAT_MODELS, credentials, settings });
}
