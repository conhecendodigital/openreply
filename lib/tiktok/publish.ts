/**
 * 23/10/2026: publicação do TikTok. O cron (/api/cron/tiktok-publish, a cada
 * 5 minutos) pega os agendados que venceram e confere os que estão publicando;
 * "Publicar agora" chama o mesmo caminho na hora. Só publica o que uma pessoa
 * agendou ou mandou publicar na tela: rascunho nunca vai sozinho.
 */
import { prisma } from "@/lib/db/client";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import { fetchPublishStatus, initDirectPost, TikTokApiError, uploadVideoInChunks } from "@/lib/tiktok/client";
import { refreshTikTokToken, TikTokAuthError } from "@/lib/tiktok/oauth";
import { settingsProblem, tiktokSettingsSchema } from "@/lib/tiktok/settings";

const REFRESH_MARGIN_MS = 10 * 60 * 1000;
const STALE_LOCK_MS = 30 * 60 * 1000;
const CONFIRM_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;

type AccountRow = {
  id: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  status: string;
};

/** Access token válido (renova pelo refresh token quando falta pouco). */
export async function getValidAccessToken(account: AccountRow): Promise<string> {
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

function describe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

/** Pega o post (SCHEDULED, ou PUBLISHING parado sem publishId) de forma atômica. */
export async function claimPost(id: string): Promise<boolean> {
  const now = new Date();
  const claimed = await prisma.scheduledPost.updateMany({
    where: {
      id,
      OR: [
        { status: "SCHEDULED" },
        { status: "DRAFT" },
        { status: "FAILED" },
        { status: "PUBLISHING", publishId: null, lockedAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) } },
      ],
    },
    data: { status: "PUBLISHING", lockedAt: now, lastError: null, attempts: { increment: 1 } },
  });
  return claimed.count === 1;
}

/** Envia o vídeo ao TikTok. O post já tem que estar PUBLISHING (claimPost). */
export async function runClaimedPost(id: string): Promise<void> {
  const post = await prisma.scheduledPost.findUnique({ where: { id }, include: { socialAccount: true } });
  if (!post || post.status !== "PUBLISHING") return;
  const fail = (message: string) =>
    prisma.scheduledPost.update({ where: { id }, data: { status: "FAILED", lastError: message, lockedAt: null } });

  try {
    if (post.socialAccount.status !== "ACTIVE") {
      await fail("The TikTok account is not connected. Connect it again.");
      return;
    }
    const parsed = tiktokSettingsSchema.safeParse(post.settings);
    if (!parsed.success) {
      await fail("The post options are incomplete.");
      return;
    }
    const problem = settingsProblem(parsed.data);
    if (problem) {
      await fail(problem);
      return;
    }
    const settings = parsed.data;
    const accessToken = await getValidAccessToken(post.socialAccount);
    const init = await initDirectPost(accessToken, {
      title: post.caption,
      privacyLevel: settings.privacyLevel,
      disableComment: !settings.allowComment,
      disableDuet: !settings.allowDuet,
      disableStitch: !settings.allowStitch,
      brandContentToggle: settings.commercial.enabled && settings.commercial.brandedContent,
      brandOrganicToggle: settings.commercial.enabled && settings.commercial.yourBrand,
      isAigc: settings.isAigc,
      videoSize: post.mediaBytes,
    });
    await prisma.scheduledPost.update({ where: { id }, data: { publishId: init.publishId } });
    await uploadVideoInChunks({
      uploadUrl: init.uploadUrl,
      mediaUrl: post.mediaUrl,
      contentType: post.mediaContentType,
      videoSize: post.mediaBytes,
      chunkSize: init.chunkSize,
      totalChunks: init.totalChunks,
    });
    // A confirmação final chega pelo cron (conferirPublicacao).
    await prisma.scheduledPost.update({ where: { id }, data: { lockedAt: new Date() } });
  } catch (error) {
    if (error instanceof TikTokApiError && error.isAuth) {
      await prisma.socialAccount.update({
        where: { id: post.socialAccountId },
        data: { status: "NEEDS_RECONNECT", lastError: "TikTok refused the access. Connect the account again." },
      });
    }
    await fail(describe(error));
  }
}

/** Pergunta ao TikTok como está uma publicação que já foi enviada. */
export async function checkPublishing(id: string): Promise<void> {
  const post = await prisma.scheduledPost.findUnique({ where: { id }, include: { socialAccount: true } });
  if (!post || post.status !== "PUBLISHING" || !post.publishId) return;
  try {
    const accessToken = await getValidAccessToken(post.socialAccount);
    const result = await fetchPublishStatus(accessToken, post.publishId);
    if (result.state === "PUBLISH_COMPLETE") {
      await prisma.scheduledPost.update({
        where: { id },
        data: { status: "PUBLISHED", publishedAt: new Date(), lockedAt: null, lastError: null },
      });
    } else if (result.state === "FAILED") {
      await prisma.scheduledPost.update({
        where: { id },
        data: { status: "FAILED", lockedAt: null, lastError: (result.failReason || "TikTok could not publish the video").slice(0, 500) },
      });
    } else if (post.lockedAt && Date.now() - post.lockedAt.getTime() > CONFIRM_TIMEOUT_MS) {
      await prisma.scheduledPost.update({
        where: { id },
        data: { status: "FAILED", lockedAt: null, lastError: "TikTok did not confirm the publication in 2 hours" },
      });
    }
  } catch (error) {
    // Falha de rede ao conferir não derruba o post: o próximo ciclo tenta de novo.
    console.warn("[tiktok-publish] status check failed", id, describe(error));
  }
}

export interface SweepResult {
  started: number;
  checked: number;
  recovered: number;
}

/** Um ciclo do cron. */
export async function sweepTikTokPosts(now: Date = new Date()): Promise<SweepResult> {
  const result: SweepResult = { started: 0, checked: 0, recovered: 0 };

  const due = await prisma.scheduledPost.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    take: 5,
    select: { id: true },
  });
  for (const { id } of due) {
    if (await claimPost(id)) {
      await runClaimedPost(id);
      result.started += 1;
    }
  }

  // Parados no meio do envio, antes de existir publishId: nada foi criado no TikTok, pode tentar de novo.
  const stuck = await prisma.scheduledPost.findMany({
    where: { status: "PUBLISHING", publishId: null, lockedAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) } },
    select: { id: true, attempts: true },
    take: 10,
  });
  for (const post of stuck) {
    await prisma.scheduledPost.update({
      where: { id: post.id },
      data:
        post.attempts >= MAX_ATTEMPTS
          ? { status: "FAILED", lockedAt: null, lastError: "The publication stopped and did not finish after 3 tries" }
          : { status: "SCHEDULED", lockedAt: null, scheduledAt: now },
    });
    result.recovered += 1;
  }

  const waiting = await prisma.scheduledPost.findMany({
    where: { status: "PUBLISHING", publishId: { not: null } },
    take: 20,
    select: { id: true },
  });
  for (const { id } of waiting) {
    await checkPublishing(id);
    result.checked += 1;
  }
  return result;
}
