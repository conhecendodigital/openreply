/**
 * Abrir a conversa de UMA pessoa no Direct (link de Aprovações, cartão do
 * contato...), mesmo quando ela não está entre as conversas recentes que a
 * Meta lista.
 *
 * Ordem: (1) a lista recente (feita pela tela); (2) a Meta pelo usuário
 * (GET /<IG_ID>/conversations?user_id=<IGSID>); (3) só as mensagens salvas
 * (DirectMessage), com id "saved:<igsid>", que nunca chama a Meta no thread;
 * (4) nada: devolve "none" com o @ pra abrir o perfil.
 */
import { profileUrlFor, savedConversationId } from "@/lib/inbox/saved-conversation";
import { prisma } from "@/lib/db/client";
import { findConversationIdByUser } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { isChannelOffError, noteMetaError } from "@/lib/channels/status";
import { messagePreviewText } from "@/lib/dm/message-preview";

export type ResolvedConversation = {
  id: string;
  contact: { id: string; username: string | null };
  updatedTime: string | null;
  lastMessage: { text: string; fromMe: boolean; createdTime: string | null } | null;
};

export type ResolveResult =
  | { source: "meta" | "saved"; conversation: ResolvedConversation }
  | { source: "none"; username: string | null; profileUrl: string | null };

type AccountLike = {
  id: string;
  instagramId: string;
  status: string;
  accessToken: string | null;
};

export async function resolveConversation(
  account: AccountLike,
  contactIgUserId: string
): Promise<ResolveResult> {
  const contactRow = await prisma.contact.findFirst({
    where: { instagramAccountId: account.id, igUserId: contactIgUserId },
    select: { username: true },
  });
  const username = contactRow?.username ?? null;

  const last = await prisma.directMessage.findFirst({
    where: { accountId: account.instagramId, contactId: contactIgUserId, deleted: false },
    orderBy: { sentAt: "desc" },
    include: { media: { select: { type: true } } },
  });
  const lastMessage = last
    ? {
        text: last.text || messagePreviewText({ ...last, media: last.media }),
        fromMe: last.fromMe,
        createdTime: last.sentAt.toISOString(),
      }
    : null;

  // (2) Meta, by user. Failure here is never fatal: fall back to saved messages.
  if (account.status === "ACTIVE" && account.accessToken) {
    try {
      const metaId = await findConversationIdByUser(
        decryptToken(account.accessToken),
        account.instagramId,
        contactIgUserId
      );
      if (metaId) {
        return {
          source: "meta",
          conversation: {
            id: metaId,
            contact: { id: contactIgUserId, username },
            updatedTime: lastMessage?.createdTime ?? null,
            lastMessage,
          },
        };
      }
    } catch (err) {
      if (!isChannelOffError(err)) {
        console.warn("[Conversations] user_id lookup failed:", err instanceof Error ? err.message : err);
        await noteMetaError({ id: account.id }, err);
      }
    }
  }

  // (3) saved messages only.
  if (last) {
    return {
      source: "saved",
      conversation: {
        id: savedConversationId(contactIgUserId),
        contact: { id: contactIgUserId, username },
        updatedTime: lastMessage?.createdTime ?? null,
        lastMessage,
      },
    };
  }

  return { source: "none", username, profileUrl: profileUrlFor(username) };
}
