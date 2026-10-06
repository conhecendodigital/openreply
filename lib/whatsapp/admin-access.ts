/**
 * Fase 0: o admin (dono do Lead Engine) vê números e status de todos os
 * números conectados, mas só abre o conteúdo de uma conversa de outro
 * workspace gravando antes um registro em AdminAccessLog (LGPD).
 *
 * Quem garante isso é o banco: a policy admin_audited_read só libera a leitura
 * quando a transação aponta (app.admin_access_id) pra um registro do próprio
 * admin, daquele workspace, criado nos últimos 15 minutos. Se a pessoa não for
 * admin, a policy admin_insert recusa o registro e nada é lido.
 */
import type { PrismaClient } from "@/app/generated/prisma/client";
import { applyContext, getAppPrisma, withRls } from "@/lib/db/rls";

export type AdminReadInput = {
  adminUserId: string;
  targetWorkspaceId: string;
  conversationId: string;
  /** Por que o admin está abrindo (vai pro log). */
  reason: string;
};

export async function openConversationAsAdmin(input: AdminReadInput, base: PrismaClient = getAppPrisma()) {
  const reason = input.reason.trim();
  if (reason.length < 5) throw new Error("Diga em poucas palavras por que você está abrindo esta conversa.");
  return withRls(
    { userId: input.adminUserId, workspaceId: null },
    async (tx) => {
      const log = await tx.adminAccessLog.create({
        data: {
          adminUserId: input.adminUserId,
          targetWorkspaceId: input.targetWorkspaceId,
          resource: "whatsapp.conversation",
          resourceId: input.conversationId,
          reason: reason.slice(0, 500),
        },
      });
      await applyContext(tx, { userId: input.adminUserId, workspaceId: null, adminAccessId: log.id });
      const conversation = await tx.waConversation.findFirst({
        where: { id: input.conversationId, workspaceId: input.targetWorkspaceId },
        include: {
          contact: true,
          messages: { orderBy: { sentAt: "desc" }, take: 200 },
        },
      });
      return { accessLogId: log.id, conversation };
    },
    base
  );
}

/** Status e números de todos os números conectados (sem conteúdo de conversa). */
export async function listSessionsAsAdmin(adminUserId: string, base: PrismaClient = getAppPrisma()) {
  return withRls(
    { userId: adminUserId, workspaceId: null },
    (tx) =>
      tx.waSession.findMany({
        select: {
          id: true,
          workspaceId: true,
          ownerUserId: true,
          provider: true,
          phoneE164: true,
          displayName: true,
          status: true,
          connectedAt: true,
          lastEventAt: true,
          conversationCount: true,
          messageCount: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    base
  );
}
