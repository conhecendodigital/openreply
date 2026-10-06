/**
 * Processa um job da fila wa-ingest: grava o evento normalizado no banco.
 * Idempotente: rodar o mesmo job duas vezes não duplica nada.
 */
import type { WaIngestJob } from "@/lib/whatsapp/queue";
import type { WaRepository } from "@/lib/whatsapp/repository";
import type { NormalizedMessage, NormalizedSessionEvent } from "@/lib/whatsapp/types";

export interface IngestDeps {
  repo: WaRepository;
  /** Mensagem nova do contato (pra fila do agente / SSE). Não roda em reprocessamento nem histórico. */
  onInboundMessage?: (info: { ownerUserId: string; sessionId: string; conversationId: string; messageId: string }) => Promise<void>;
  /**
   * Mensagem nova do DONO pelo celular (eco fromMe, sentBy USER_PHONE). É aqui que
   * o "Assumir" automático entra (agentes/modo.ts aoMensagemDoUsuario).
   * ATENÇÃO: no OpenWA o eco "message.sent" do que o próprio Lead Engine enviou
   * pode chegar ANTES do envio gravar a linha como AGENT/USER_APP. Quem implementar
   * este gancho tem que esperar uns segundos (job atrasado ~30 s) e reler a
   * mensagem pelo id: se o sentBy virou AGENT/USER_APP, não é o dono e não pausa.
   */
  onOwnerMessage?: (info: { ownerUserId: string; sessionId: string; conversationId: string; messageId: string }) => Promise<void>;
  /** QR e status (pra SSE da página Canais). */
  onSessionEvent?: (info: { ownerUserId: string; sessionId: string; event: NormalizedSessionEvent }) => Promise<void>;
}

export type IngestResult =
  | { kind: "message"; conversationId: string; messageId: string; created: boolean }
  | { kind: "ack" }
  | { kind: "session" }
  | { kind: "skipped"; reason: string };

function preview(m: NormalizedMessage): string | null {
  if (m.body) return m.body.slice(0, 120);
  return m.type === "unknown" ? null : `[${m.type}]`;
}

export async function processIngestJob(job: WaIngestJob, deps: IngestDeps): Promise<IngestResult> {
  const session = await deps.repo.getSession(job.sessionId);
  if (!session || session.ownerUserId !== job.ownerUserId) return { kind: "skipped", reason: "sessao_inexistente" };
  const event = job.event;

  if (event.kind === "ack") {
    await deps.repo.updateMessageAck(session.id, event.providerMessageId, event.ack);
    return { kind: "ack" };
  }

  if (event.kind === "session") {
    await deps.repo.updateSessionStatus(session.id, {
      status: event.status,
      phoneE164: event.phoneE164,
      at: new Date(event.timestamp),
    });
    await deps.onSessionEvent?.({ ownerUserId: session.ownerUserId, sessionId: session.id, event });
    return { kind: "session" };
  }

  const contact = await deps.repo.upsertContact({
    ownerUserId: session.ownerUserId,
    sessionId: session.id,
    jid: event.chatJid,
    phoneE164: event.phoneE164,
    pushName: event.fromMe ? null : event.pushName,
  });
  const conversation = await deps.repo.upsertConversation({
    ownerUserId: session.ownerUserId,
    sessionId: session.id,
    contactId: contact.id,
  });
  const sentAt = new Date(event.timestamp);
  const { created, message } = await deps.repo.insertMessage({
    ownerUserId: session.ownerUserId,
    conversationId: conversation.id,
    sessionId: session.id,
    providerMessageId: event.providerMessageId,
    fromMe: event.fromMe,
    sentBy: event.sentBy,
    type: event.type,
    body: event.body,
    quotedId: event.quotedProviderMessageId,
    ack: event.fromMe ? "sent" : "delivered",
    agentRunId: null,
    sentAt,
  });
  if (created) {
    await deps.repo.touchConversation(conversation.id, {
      lastMessageAt: sentAt,
      preview: preview(event),
      incrementUnread: !event.fromMe && !event.isHistory,
    });
    if (event.fromMe && event.sentBy === "USER_PHONE" && !event.isHistory) {
      await deps.onOwnerMessage?.({
        ownerUserId: session.ownerUserId,
        sessionId: session.id,
        conversationId: conversation.id,
        messageId: message.id,
      });
    }
    if (!event.fromMe && !event.isHistory) {
      await deps.onInboundMessage?.({
        ownerUserId: session.ownerUserId,
        sessionId: session.id,
        conversationId: conversation.id,
        messageId: message.id,
      });
    }
  }
  return { kind: "message", conversationId: conversation.id, messageId: message.id, created };
}
