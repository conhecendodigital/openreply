import { fail, ok, requireContext } from "@/lib/api-helpers";
import { listPostableAccounts } from "@/lib/social/accounts";

export const dynamic = "force-dynamic";

/**
 * 23/10/2026: contas onde a aba Posts publica: TikTok, YouTube, Instagram e
 * Facebook, numa lista só (`platform` diz a rede). Nunca devolve token.
 */
export async function GET() {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const rows = await listPostableAccounts(auth.context.workspaceId);
  if (!rows) return fail("Could not load accounts", 500);
  return ok(rows);
}
