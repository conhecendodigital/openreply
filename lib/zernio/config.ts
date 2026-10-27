/**
 * 27/10/2026: TikTok via Zernio. Tudo aqui é leitura de variável de ambiente do
 * SERVIDOR. Sem TIKTOK_VIA_ZERNIO=1 nada muda: o TikTok segue pelo app próprio.
 * A chave (ZERNIO_API_KEY) nunca sai deste lado do servidor.
 */
import type { SocialAccount } from "@/app/generated/prisma/client";

export const ZERNIO_BASE_URL = "https://zernio.com/api/v1";

export function isTikTokViaZernio(): boolean {
  const v = (process.env.TIKTOK_VIA_ZERNIO ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

export function zernioApiKey(): string | null {
  const key = (process.env.ZERNIO_API_KEY ?? "").trim();
  return key || null;
}

/**
 * Conta da Zernio que corresponde à conta de TikTok do Lead Engine.
 * 1. ZERNIO_TIKTOK_ACCOUNT_MAP: JSON {"<id da SocialAccount ou @username>": "<accountId da Zernio>"}.
 * 2. ZERNIO_TIKTOK_ACCOUNT_ID: uma conta só (o caso do Matheus).
 */
export function zernioAccountIdFor(account: Pick<SocialAccount, "id" | "username"> | null | undefined): string | null {
  if (!account) return null;
  const raw = (process.env.ZERNIO_TIKTOK_ACCOUNT_MAP ?? "").trim();
  if (raw) {
    try {
      const map = JSON.parse(raw) as Record<string, unknown>;
      const username = account.username?.replace(/^@/, "") ?? "";
      for (const key of [account.id, username, `@${username}`]) {
        const v = key ? map[key] : undefined;
        if (typeof v === "string" && v.trim()) return v.trim();
      }
    } catch {
      // Mapa inválido: cai para a conta única.
    }
  }
  const single = (process.env.ZERNIO_TIKTOK_ACCOUNT_ID ?? "").trim();
  return single || null;
}
