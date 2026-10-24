/**
 * 23/10/2026: publicação de todas as redes da aba Posts. O cron
 * (/api/cron/social-publish, a cada 5 minutos) pega os agendados que venceram e
 * confere os que a rede ainda processa; "Publicar agora" chama o mesmo caminho
 * na hora. Só publica o que uma pessoa agendou ou mandou publicar na tela:
 * rascunho nunca vai sozinho.
 */
import { prisma } from "@/lib/db/client";
import { commonMediaProblem, describe } from "@/lib/social/common";
import { providerForPost } from "@/lib/social/providers";

const STALE_LOCK_MS = 30 * 60 * 1000;
const DEFAULT_CONFIRM_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;

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

const WITH_ACCOUNTS = { socialAccount: true, channel: true } as const;

/** Envia o vídeo à rede. O post já tem que estar PUBLISHING (claimPost). */
export async function runClaimedPost(id: string): Promise<void> {
  const post = await prisma.scheduledPost.findUnique({ where: { id }, include: WITH_ACCOUNTS });
  if (!post || post.status !== "PUBLISHING") return;
  const fail = (message: string) =>
    prisma.scheduledPost.update({ where: { id }, data: { status: "FAILED", lastError: message, lockedAt: null } });

  try {
    const provider = providerForPost(post);
    // O servidor só baixa vídeo do nosso armazenamento, na pasta deste workspace (a conferência vale de novo aqui).
    const media = commonMediaProblem(provider, post);
    if (media) {
      await fail(media.message);
      return;
    }
    const result = await provider.publish(post, {
      savePublishId: async (publishId) => {
        await prisma.scheduledPost.update({ where: { id }, data: { publishId } });
      },
    });
    if (result.state === "published") {
      await prisma.scheduledPost.update({
        where: { id },
        data: { status: "PUBLISHED", publishedAt: new Date(), lockedAt: null, lastError: null, ...(result.publishId ? { publishId: result.publishId } : {}) },
      });
    } else {
      // A rede ainda processa: a confirmação final chega pelo cron (checkPublishing).
      await prisma.scheduledPost.update({
        where: { id },
        data: { lockedAt: new Date(), ...(result.publishId ? { publishId: result.publishId } : {}) },
      });
    }
  } catch (error) {
    await fail(describe(error));
  }
}

/** Pergunta à rede como está uma publicação que já foi enviada. */
export async function checkPublishing(id: string): Promise<void> {
  const post = await prisma.scheduledPost.findUnique({ where: { id }, include: WITH_ACCOUNTS });
  if (!post || post.status !== "PUBLISHING" || !post.publishId) return;
  try {
    const provider = providerForPost(post);
    if (!provider.check) return;
    const result = await provider.check(post);
    if (result.state === "published") {
      await prisma.scheduledPost.update({
        where: { id },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
          lockedAt: null,
          lastError: null,
          ...(result.publishId ? { publishId: result.publishId } : {}),
        },
      });
    } else if (result.state === "failed") {
      await prisma.scheduledPost.update({
        where: { id },
        data: { status: "FAILED", lockedAt: null, lastError: result.message.slice(0, 500) },
      });
    } else if (post.lockedAt && Date.now() - post.lockedAt.getTime() > (provider.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS)) {
      await prisma.scheduledPost.update({
        where: { id },
        data: { status: "FAILED", lockedAt: null, lastError: `${provider.label} did not confirm the publication in 2 hours` },
      });
    }
  } catch (error) {
    // Falha de rede ao conferir não derruba o post: o próximo ciclo tenta de novo.
    console.warn("[social-publish] status check failed", id, describe(error));
  }
}

export interface SweepResult {
  started: number;
  checked: number;
  recovered: number;
}

/** Um ciclo do cron, para todas as redes. */
export async function sweepSocialPosts(now: Date = new Date()): Promise<SweepResult> {
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

  // Parados no meio do envio, antes de existir publishId: nada foi criado na rede, pode tentar de novo.
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
