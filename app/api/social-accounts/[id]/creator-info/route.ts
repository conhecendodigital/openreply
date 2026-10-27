import { fail, ok, requireContext } from "@/lib/api-helpers";
import { prisma } from "@/lib/db/client";
import { queryCreatorInfo, TikTokApiError } from "@/lib/tiktok/client";
import { getValidAccessToken } from "@/lib/tiktok/token";
import { TikTokAuthError } from "@/lib/tiktok/oauth";
import { isTikTokViaZernio } from "@/lib/zernio/config";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** Opções que o TikTok deixa esta conta usar agora (privacidade, comentário, dueto, stitch, duração). */
export async function GET(_request: Request, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const account = await prisma.socialAccount.findFirst({ where: { id, workspaceId: auth.context.workspaceId } });
  if (!account) return fail("Account not found", 404);
  // 27/10/2026: pela Zernio não há consulta ao TikTok; as opções são fixas (Público ou rascunho no app).
  if (isTikTokViaZernio() && account.platform === "TIKTOK" && account.status !== "DISCONNECTED") {
    return ok({
      nickname: account.displayName,
      username: account.username ?? "",
      avatarUrl: account.avatarUrl,
      privacyLevelOptions: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
      commentDisabled: false,
      duetDisabled: false,
      stitchDisabled: false,
      maxVideoPostDurationSec: 3600,
      via: "zernio",
    });
  }
  if (account.status !== "ACTIVE") return fail("Connect the TikTok account again", 409, { code: "needs_reconnect" });
  try {
    const token = await getValidAccessToken(account);
    return ok(await queryCreatorInfo(token));
  } catch (error) {
    if (error instanceof TikTokAuthError || (error instanceof TikTokApiError && error.isAuth)) {
      return fail("Connect the TikTok account again", 409, { code: "needs_reconnect" });
    }
    return fail("TikTok did not answer. Try again in a moment.", 502, { code: "tiktok_unavailable" });
  }
}
