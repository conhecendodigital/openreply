import { fail, ok, requireContext } from "@/lib/api-helpers";
import { prisma } from "@/lib/db/client";
import { TikTokAuthError } from "@/lib/tiktok/oauth";
import { TikTokApiError, queryCreatorInfo } from "@/lib/tiktok/client";
import { getValidAccessToken } from "@/lib/tiktok/token";
import { getYouTubeAccessToken } from "@/lib/youtube/client";
import { YouTubeApiError, YouTubeAuthError, getYouTubeChannel } from "@/lib/youtube/oauth";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * 23/10/2026: "Testar conexão" de uma conta TikTok ou YouTube. Renova o token se preciso
 * e faz uma leitura barata na rede. Não publica nem muda nada. Só dono e admin.
 */
export async function POST(_request: Request, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const account = await prisma.socialAccount.findFirst({ where: { id, workspaceId: auth.context.workspaceId } });
  if (!account) return fail("Account not found", 404);
  if (account.status === "DISCONNECTED") return fail("The account is disconnected", 409, { code: "disconnected" });

  const checkedAt = new Date().toISOString();
  try {
    if (account.platform === "YOUTUBE") {
      const channel = await getYouTubeChannel(await getYouTubeAccessToken(account));
      return ok({ ok: true, checkedAt, detail: channel.title ?? null });
    }
    await queryCreatorInfo(await getValidAccessToken(account));
    return ok({ ok: true, checkedAt, detail: null });
  } catch (error) {
    const needsReconnect =
      (error instanceof TikTokAuthError && error.needsReconnect) ||
      (error instanceof TikTokApiError && error.isAuth) ||
      (error instanceof YouTubeAuthError && error.needsReconnect);
    const message = error instanceof YouTubeApiError || error instanceof YouTubeAuthError ? error.message : "The network did not answer. Try again in a moment.";
    return ok({ ok: false, checkedAt, needsReconnect, error: message });
  }
}
