/**
 * WaRepository de produção, no Postgres (schema "whatsapp").
 *
 * Quem usa: o webhook (ainda não sabe de quem é o evento) e o worker
 * (wa-ingest e wa-send). Por isso roda no papel de sistema (le_system, com
 * BYPASSRLS, via withSystemRole), igual aos webhooks da Meta. É código pequeno
 * e revisado; todas as telas e rotas de pessoa usam withRls (lib/whatsapp/painel.ts).
 *
 * Regras do contrato (lib/whatsapp/repository.ts):
 * - recordWebhookEvent é a trava de idempotência (dedupeKey única);
 * - insertMessage não duplica e só corrige USER_PHONE -> AGENT/USER_APP;
 * - updateMessageAck nunca volta o ack;
 * - updateSessionStatus ignora evento mais velho que o último (lastEventAt).
 *
 * Nada aqui apaga conversa, contato ou mensagem. Desconectar só muda o status.
 */
import type { PrismaClient } from "@/app/generated/prisma/client";
import { getPrisma } from "@/lib/db/client";
import { withSystemRole } from "@/lib/db/rls";
import { decryptToken } from "@/lib/meta/oauth";
import type { BlockedSendInput, WaRepository, WebhookEventInput } from "@/lib/whatsapp/repository";
import type {
  WaAck,
  WaContactRecord,
  WaConversationRecord,
  WaMessageRecord,
  WaProvider,
  WaSessionRecord,
  WaStatus,
} from "@/lib/whatsapp/types";

type Tx = Parameters<Parameters<typeof withSystemRole>[0]>[0];

const ACK_BEFORE: Record<WaAck, WaAck[]> = {
  pending: [],
  sent: ["pending"],
  delivered: ["pending", "sent"],
  read: ["pending", "sent", "delivered"],
  failed: ["pending", "sent", "delivered"],
};

type SessionRow = {
  id: string;
  ownerUserId: string;
  workspaceId: string;
  provider: WaProvider;
  providerSessionId: string;
  phoneE164: string | null;
  status: WaStatus;
  webhookSecretEnc: string | null;
  riskAcceptedAt: Date | null;
  wabaId: string | null;
};

const SESSION_SELECT = {
  id: true,
  ownerUserId: true,
  workspaceId: true,
  provider: true,
  providerSessionId: true,
  phoneE164: true,
  status: true,
  webhookSecretEnc: true,
  riskAcceptedAt: true,
  wabaId: true,
} as const;

function openSecret(enc: string | null): string | null {
  if (!enc) return null;
  try {
    return decryptToken(enc);
  } catch {
    // ENCRYPTION_KEY trocada: o webhook dessa sessão passa a ser recusado (401).
    console.error("[whatsapp] segredo do webhook não abriu (ENCRYPTION_KEY mudou?)");
    return null;
  }
}

function toSession(row: SessionRow): WaSessionRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    workspaceId: row.workspaceId,
    provider: row.provider,
    providerSessionId: row.providerSessionId,
    phoneE164: row.phoneE164,
    status: row.status,
    webhookSecret: openSecret(row.webhookSecretEnc),
    riskAcceptedAt: row.riskAcceptedAt,
    wabaId: row.wabaId,
  };
}

export class PrismaWaRepository implements WaRepository {
  constructor(private readonly base: PrismaClient = getPrisma()) {}

  private sys<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withSystemRole(fn, this.base);
  }

  async findSessionByProvider(provider: WaProvider, providerSessionId: string) {
    const row = await this.sys((tx) =>
      tx.waSession.findUnique({ where: { providerSessionId }, select: SESSION_SELECT })
    );
    if (!row || row.provider !== provider) return null;
    return toSession(row);
  }

  async getSession(sessionId: string) {
    const row = await this.sys((tx) => tx.waSession.findUnique({ where: { id: sessionId }, select: SESSION_SELECT }));
    return row ? toSession(row) : null;
  }

  async recordWebhookEvent(input: WebhookEventInput) {
    return this.sys(async (tx) => {
      // ON CONFLICT DO NOTHING: um erro de chave única abortaria a transação.
      const { count } = await tx.waWebhookEvent.createMany({
        data: [
          {
            dedupeKey: input.dedupeKey,
            provider: input.provider,
            eventType: input.eventType.slice(0, 80),
            sessionId: input.sessionId,
            ownerUserId: input.ownerUserId,
            payload: (input.payload ?? {}) as object,
          },
        ],
        skipDuplicates: true,
      });
      if (count === 1) return { result: "created" as const, queued: false };
      const existing = await tx.waWebhookEvent.findUnique({ where: { dedupeKey: input.dedupeKey }, select: { status: true } });
      return { result: "duplicate" as const, queued: existing?.status === "queued" };
    });
  }

  async markWebhookEventQueued(dedupeKey: string) {
    await this.sys((tx) => tx.waWebhookEvent.updateMany({ where: { dedupeKey }, data: { status: "queued" } }));
  }

  async updateSessionStatus(sessionId: string, patch: { status: WaStatus; phoneE164?: string | null; at: Date }) {
    await this.sys(async (tx) => {
      const at = Number.isFinite(patch.at.getTime()) ? patch.at : new Date();
      // Evento mais velho que o último não volta o status (o OpenWA pode reentregar fora de ordem).
      await tx.waSession.updateMany({
        where: { id: sessionId, OR: [{ lastEventAt: null }, { lastEventAt: { lte: at } }] },
        data: {
          status: patch.status,
          lastEventAt: at,
          ...(patch.phoneE164 ? { phoneE164: patch.phoneE164 } : {}),
          ...(patch.status === "CONNECTED" ? { connectedAt: at } : {}),
        },
      });
    });
  }

  async upsertContact(input: Omit<WaContactRecord, "id">) {
    return this.sys(async (tx) => {
      const session = await tx.waSession.findUniqueOrThrow({ where: { id: input.sessionId }, select: { workspaceId: true } });
      const row = await tx.waContact.upsert({
        where: { sessionId_jid: { sessionId: input.sessionId, jid: input.jid } },
        create: {
          workspaceId: session.workspaceId,
          sessionId: input.sessionId,
          jid: input.jid,
          phoneE164: input.phoneE164,
          pushName: input.pushName,
          isGroup: input.jid.endsWith("@g.us"),
        },
        update: {
          ...(input.pushName ? { pushName: input.pushName } : {}),
          ...(input.phoneE164 ? { phoneE164: input.phoneE164 } : {}),
        },
      });
      return {
        id: row.id,
        ownerUserId: input.ownerUserId,
        sessionId: row.sessionId,
        jid: row.jid,
        phoneE164: row.phoneE164,
        pushName: row.pushName,
      };
    });
  }

  async upsertConversation(input: { ownerUserId: string; sessionId: string; contactId: string }) {
    return this.sys(async (tx) => {
      const session = await tx.waSession.findUniqueOrThrow({ where: { id: input.sessionId }, select: { workspaceId: true } });
      const { count } = await tx.waConversation.createMany({
        data: [{ workspaceId: session.workspaceId, sessionId: input.sessionId, contactId: input.contactId }],
        skipDuplicates: true,
      });
      if (count === 1) {
        await tx.waSession.update({ where: { id: input.sessionId }, data: { conversationCount: { increment: 1 } } });
      }
      const row = await tx.waConversation.findUniqueOrThrow({
        where: { sessionId_contactId: { sessionId: input.sessionId, contactId: input.contactId } },
      });
      return this.toConversation(row, input.ownerUserId);
    });
  }

  private toConversation(
    row: { id: string; sessionId: string; contactId: string; lastMessageAt: Date | null; humanTakeoverUntil: Date | null },
    ownerUserId: string
  ): WaConversationRecord {
    return {
      id: row.id,
      ownerUserId,
      sessionId: row.sessionId,
      contactId: row.contactId,
      lastMessageAt: row.lastMessageAt,
      humanTakeoverUntil: row.humanTakeoverUntil,
    };
  }

  async insertMessage(input: Omit<WaMessageRecord, "id">) {
    return this.sys(async (tx) => {
      const session = await tx.waSession.findUniqueOrThrow({ where: { id: input.sessionId }, select: { workspaceId: true } });
      const { count } = await tx.waMessage.createMany({
        data: [
          {
            workspaceId: session.workspaceId,
            sessionId: input.sessionId,
            conversationId: input.conversationId,
            providerMessageId: input.providerMessageId,
            fromMe: input.fromMe,
            sentBy: input.sentBy,
            type: input.type,
            body: input.body,
            quotedId: input.quotedId,
            ack: input.ack,
            agentRunId: input.agentRunId,
            sentAt: input.sentAt,
            mediaMime: input.media?.mime ?? null,
            mediaFilename: input.media?.filename ?? null,
            mediaRef: input.media?.ref ?? null,
          },
        ],
        skipDuplicates: true,
      });
      const key = { sessionId_providerMessageId: { sessionId: input.sessionId, providerMessageId: input.providerMessageId } };
      if (count === 1) {
        await tx.waSession.update({ where: { id: input.sessionId }, data: { messageCount: { increment: 1 } } });
      } else if (input.sentBy === "AGENT" || input.sentBy === "USER_APP") {
        // O eco "message.sent" do OpenWA chegou antes do envio gravar e entrou
        // como "o dono pelo celular". Corrige só nesse sentido, nunca o contrário.
        await tx.waMessage.updateMany({
          where: { sessionId: input.sessionId, providerMessageId: input.providerMessageId, sentBy: "USER_PHONE" },
          data: { sentBy: input.sentBy, agentRunId: input.agentRunId },
        });
      }
      const row = await tx.waMessage.findUniqueOrThrow({ where: key });
      return {
        created: count === 1,
        message: {
          id: row.id,
          ownerUserId: input.ownerUserId,
          conversationId: row.conversationId,
          sessionId: row.sessionId,
          providerMessageId: row.providerMessageId,
          fromMe: row.fromMe,
          sentBy: row.sentBy,
          type: row.type as WaMessageRecord["type"],
          body: row.body,
          quotedId: row.quotedId,
          ack: row.ack as WaAck,
          agentRunId: row.agentRunId,
          sentAt: row.sentAt,
        },
      };
    });
  }

  async touchConversation(conversationId: string, patch: { lastMessageAt: Date; preview: string | null; incrementUnread: boolean }) {
    await this.sys(async (tx) => {
      // Só troca a prévia se a mensagem for mais nova (histórico chega fora de ordem).
      await tx.waConversation.updateMany({
        where: { id: conversationId, OR: [{ lastMessageAt: null }, { lastMessageAt: { lte: patch.lastMessageAt } }] },
        data: { lastMessageAt: patch.lastMessageAt, lastMessagePreview: patch.preview?.slice(0, 160) ?? null },
      });
      if (patch.incrementUnread) {
        await tx.waConversation.update({ where: { id: conversationId }, data: { unreadCount: { increment: 1 } } });
      }
    });
  }

  async updateMessageAck(sessionId: string, providerMessageId: string, ack: WaAck) {
    const before = ACK_BEFORE[ack];
    if (!before.length) return;
    await this.sys((tx) =>
      tx.waMessage.updateMany({ where: { sessionId, providerMessageId, ack: { in: before } }, data: { ack } })
    );
  }

  async getConversation(conversationId: string) {
    return this.sys(async (tx) => {
      const row = await tx.waConversation.findUnique({
        where: { id: conversationId },
        include: { session: { select: { ownerUserId: true } } },
      });
      return row ? this.toConversation(row, row.session.ownerUserId) : null;
    });
  }

  async getContact(contactId: string) {
    return this.sys(async (tx) => {
      const row = await tx.waContact.findUnique({ where: { id: contactId }, include: { session: { select: { ownerUserId: true } } } });
      if (!row) return null;
      return {
        id: row.id,
        ownerUserId: row.session.ownerUserId,
        sessionId: row.sessionId,
        jid: row.jid,
        phoneE164: row.phoneE164,
        pushName: row.pushName,
      };
    });
  }

  async findLastInboundMessage(conversationId: string) {
    const row = await this.sys((tx) =>
      tx.waMessage.findFirst({
        where: { conversationId, sentBy: "CONTACT", fromMe: false },
        orderBy: { sentAt: "desc" },
        select: { providerMessageId: true, sentAt: true },
      })
    );
    return row ?? null;
  }

  async recordBlockedSend(input: BlockedSendInput) {
    await this.sys(async (tx) => {
      const session = await tx.waSession.findUnique({ where: { id: input.sessionId }, select: { workspaceId: true } });
      if (!session) return;
      await tx.waSendBlock.create({
        data: {
          ownerUserId: input.ownerUserId,
          workspaceId: session.workspaceId,
          sessionId: input.sessionId,
          conversationId: input.conversationId,
          sentBy: input.sentBy,
          reason: input.reason,
          agentRunId: input.agentRunId,
          preview: input.preview?.slice(0, 80) ?? null,
          createdAt: input.at,
        },
      });
      if (input.agentRunId) {
        // Run que já foi recusado (Assumir) fica como está.
        await tx.waAgentRun.updateMany({
          where: { id: input.agentRunId, status: { in: ["scheduled", "approved"] } },
          data: { status: "blocked", blockedReason: input.reason },
        });
      }
    });
  }

  /** Lido pelo gancho do "dono respondeu pelo celular" (~30 s depois), pra confirmar o sentBy. */
  async getMessageSentBy(messageId: string) {
    const row = await this.sys((tx) => tx.waMessage.findUnique({ where: { id: messageId }, select: { sentBy: true, fromMe: true } }));
    return row ?? null;
  }

  /** Retenção: apaga o evento cru do webhook (texto de terceiros) depois de `days` dias. */
  async purgeWebhookEvents(olderThan: Date) {
    const { count } = await this.sys((tx) => tx.waWebhookEvent.deleteMany({ where: { createdAt: { lt: olderThan } } }));
    return count;
  }
}
