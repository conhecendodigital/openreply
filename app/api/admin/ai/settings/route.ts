/** /admin > Chaves de IA: modelo de cada agente, tetos diários, preços e cotação. */
import { fail, ok, readJson } from "@/lib/api-helpers";
import { requireAiAdmin } from "@/lib/ai/admin-guard";
import { saveAiSettings } from "@/lib/ai/credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const guard = await requireAiAdmin();
  if ("response" in guard) return guard.response;
  const body = await readJson(request);
  const result = await saveAiSettings({ adminUserId: guard.admin.user.id, data: body });
  if (!result.ok) return fail(result.error, 400, { field: result.field });
  return ok({ settings: result.settings });
}
