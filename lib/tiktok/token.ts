import { prisma } from "@/lib/db/client";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import { refreshTikTokToken, TikTokAuthError } from "@/lib/tiktok/oauth";

const REFRESH_MARGIN_MS = 10 * 60 * 1000;

export type TikTokAccountRow = {
  id: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  status: string;
};

/** Access token válido (renova pelo refresh token quando falta pouco). */
export async function getValidAccessToken(account: TikTokAccountRow): Promise<string> {
  const expiring = account.tokenExpiresAt && account.tokenExpiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS;
  if (!expiring) return decryptToken(account.accessToken);
  if (!account.refreshToken) throw new TikTokAuthError("TikTok session expired. Connect the account again.", "invalid_grant");
  try {
    const fresh = await refreshTikTokToken(decryptToken(account.refreshToken));
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: {
        accessToken: encryptToken(fresh.accessToken),
        refreshToken: fresh.refreshToken ? encryptToken(fresh.refreshToken) : account.refreshToken,
        tokenExpiresAt: new Date(Date.now() + fresh.expiresIn * 1000),
        refreshExpiresAt: fresh.refreshExpiresIn ? new Date(Date.now() + fresh.refreshExpiresIn * 1000) : null,
        status: "ACTIVE",
        lastError: null,
      },
    });
    return fresh.accessToken;
  } catch (error) {
    if (error instanceof TikTokAuthError && error.needsReconnect) {
      await prisma.socialAccount.update({
        where: { id: account.id },
        data: { status: "NEEDS_RECONNECT", lastError: "TikTok session expired. Connect the account again." },
      });
    }
    throw error;
  }
}
