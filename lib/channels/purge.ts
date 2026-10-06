import { prisma as defaultPrisma } from "@/lib/db/client";
import type { PrismaClient } from "@/app/generated/prisma/client";

/**
 * "Excluir de verdade" de um canal do Instagram, numa transação só (tudo ou
 * nada). Usado pelo botão da tela Canais (/api/instagram/purge) e pelo
 * callback de exclusão de dados da Meta (/api/instagram/data-deletion).
 *
 * Apaga: rascunhos, envios, moderação, links de conversa, cliques, histórico
 * de DMs, campanhas (+ links, sequências), contatos (+ etiquetas, eventos),
 * histórico de seguidores, mensagens do Direct (+ mídias), comentários
 * processados, os webhooks brutos que a Meta mandou pra essa conta, os eventos
 * operacionais dela e, por último, a própria conta.
 *
 * Quem chama confere antes de quem é a conta. Aqui não tem trava nenhuma.
 */
export type PurgeTarget = { id: string; instagramId: string };

export async function purgeInstagramAccountData(
  account: PurgeTarget,
  client: PrismaClient = defaultPrisma
): Promise<{ webhookEvents: number; operationalEvents: number }> {
  return client.$transaction(async (tx) => {
    const byAccount = { instagramAccountId: account.id };
    await tx.draftReply.deleteMany({ where: byAccount });
    await tx.outboundMessage.deleteMany({ where: byAccount });
    await tx.commentModeration.deleteMany({ where: byAccount });
    await tx.moderationSettings.deleteMany({ where: byAccount });
    await tx.conversationLink.deleteMany({ where: byAccount }); // + opens
    await tx.linkClick.deleteMany({ where: byAccount });
    await tx.dmLog.deleteMany({ where: byAccount });
    await tx.automation.deleteMany({ where: byAccount }); // + tracked links, sequences, steps, enrollments
    await tx.contact.deleteMany({ where: byAccount }); // + tags, events, enrollments
    await tx.followerSnapshot.deleteMany({ where: byAccount });
    await tx.directMessage.deleteMany({ where: { accountId: account.instagramId } }); // + media
    await tx.processedComment.deleteMany({
      where: { instagramAccountId: { in: [account.id, account.instagramId] } },
    });

    // Webhook bruto (texto de comentário e de mensagem): a Meta manda
    // { object, entry: [{ id: <instagramId>, ... }] }.
    const webhookEvents = await tx.$executeRaw`
      DELETE FROM "WebhookEvent" w
      WHERE EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(w."payload"->'entry') = 'array' THEN w."payload"->'entry' ELSE '[]'::jsonb END
        ) AS e
        WHERE e->>'id' = ${account.instagramId}
      )`;

    const operational = await tx.operationalEvent.deleteMany({
      where: {
        OR: [
          { payload: { path: ["instagramAccountId"], equals: account.id } },
          { payload: { path: ["instagramId"], equals: account.instagramId } },
        ],
      },
    });

    await tx.instagramAccount.delete({ where: { id: account.id } });
    return { webhookEvents: Number(webhookEvents ?? 0), operationalEvents: operational?.count ?? 0 };
  });
}
