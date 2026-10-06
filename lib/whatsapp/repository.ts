/**
 * Persistência do conector, escrita contra uma interface.
 *
 * Nos testes: InMemoryWaRepository (abaixo). Em produção: a implementação com
 * o Prisma da Fase 0 (feat/multiusuario), que cria o schema "whatsapp" com os
 * mesmos nomes. O mapa método → tabela está em docs/whatsapp-conector.md.
 *
 * Regras que toda implementação tem que manter:
 * - recordWebhookEvent é a trava de idempotência (WaWebhookEvent.dedupeKey @unique).
 * - insertMessage não duplica (WaMessage @@unique([sessionId, providerMessageId])).
 *   Se a linha já existe, não troca sentBy, COM UMA EXCEÇÃO: o eco "message.sent"
 *   do OpenWA pode chegar antes do envio do app gravar e entra como USER_PHONE.
 *   Quando o envio do Lead Engine (AGENT ou USER_APP) grava depois, ele corrige
 *   sentBy e agentRunId. Sem isso a mensagem do agente parecia "o dono respondeu
 *   pelo celular": pausava o agente (takeover) e entrava no aprendizado de tom.
 * - updateMessageAck nunca volta o ack (read não vira delivered).
 */
import type {
  BlockReason,
  SentBy,
  WaAck,
  WaContactRecord,
  WaConversationRecord,
  WaMessageRecord,
  WaProvider,
  WaSessionRecord,
  WaStatus,
} from "@/lib/whatsapp/types";

export interface WebhookEventInput {
  dedupeKey: string;
  provider: WaProvider;
  eventType: string;
  sessionId: string | null;
  ownerUserId: string | null;
  payload: unknown;
}

export interface BlockedSendInput {
  ownerUserId: string;
  sessionId: string;
  conversationId: string;
  sentBy: SentBy;
  reason: BlockReason;
  agentRunId: string | null;
  /** Começo do texto, só pra tela de auditoria. */
  preview: string | null;
  at: Date;
}

export interface WaRepository {
  /** Webhook: dono da sessão (no banco, via app.resolve_wa_session com le_system). */
  findSessionByProvider(provider: WaProvider, providerSessionId: string): Promise<WaSessionRecord | null>;
  getSession(sessionId: string): Promise<WaSessionRecord | null>;
  /**
   * "created" na primeira vez; "duplicate" se a dedupeKey já existe. `queued`
   * diz se aquele evento já entrou na fila (WaWebhookEvent.status = "queued"):
   * duplicado que não chegou a entrar é enfileirado de novo.
   */
  recordWebhookEvent(input: WebhookEventInput): Promise<{ result: "created" | "duplicate"; queued: boolean }>;
  markWebhookEventQueued(dedupeKey: string): Promise<void>;
  updateSessionStatus(sessionId: string, patch: { status: WaStatus; phoneE164?: string | null; at: Date }): Promise<void>;
  upsertContact(input: Omit<WaContactRecord, "id">): Promise<WaContactRecord>;
  upsertConversation(input: { ownerUserId: string; sessionId: string; contactId: string }): Promise<WaConversationRecord>;
  insertMessage(input: Omit<WaMessageRecord, "id">): Promise<{ created: boolean; message: WaMessageRecord }>;
  touchConversation(
    conversationId: string,
    patch: { lastMessageAt: Date; preview: string | null; incrementUnread: boolean }
  ): Promise<void>;
  updateMessageAck(sessionId: string, providerMessageId: string, ack: WaAck): Promise<void>;
  getConversation(conversationId: string): Promise<WaConversationRecord | null>;
  getContact(contactId: string): Promise<WaContactRecord | null>;
  /** Última mensagem do CONTATO (sentBy = CONTACT). Base da regra das 24h. */
  findLastInboundMessage(conversationId: string): Promise<{ providerMessageId: string; sentAt: Date } | null>;
  /** Envio barrado (24h, "Assumir", sessão caída). Fica registrado; nada sai. */
  recordBlockedSend(input: BlockedSendInput): Promise<void>;
}

// ─── Em memória (testes e desenvolvimento) ───────────────────────────────────

const ACK_ORDER: Record<WaAck, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: -1 };

let seq = 0;
function newId(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq.toString(36)}`;
}

export class InMemoryWaRepository implements WaRepository {
  sessions = new Map<string, WaSessionRecord>();
  contacts = new Map<string, WaContactRecord>();
  conversations = new Map<string, WaConversationRecord & { lastMessagePreview: string | null; unreadCount: number }>();
  messages = new Map<string, WaMessageRecord & { isHistory?: boolean }>();
  webhookEvents = new Map<string, WebhookEventInput & { createdAt: Date; status: "received" | "queued" }>();
  blocked: BlockedSendInput[] = [];

  addSession(session: WaSessionRecord): WaSessionRecord {
    this.sessions.set(session.id, session);
    return session;
  }

  async findSessionByProvider(provider: WaProvider, providerSessionId: string) {
    for (const s of this.sessions.values()) {
      if (s.provider === provider && s.providerSessionId === providerSessionId) return s;
    }
    return null;
  }

  async getSession(sessionId: string) {
    return this.sessions.get(sessionId) ?? null;
  }

  async recordWebhookEvent(input: WebhookEventInput) {
    const existing = this.webhookEvents.get(input.dedupeKey);
    if (existing) return { result: "duplicate" as const, queued: existing.status === "queued" };
    this.webhookEvents.set(input.dedupeKey, { ...input, createdAt: new Date(), status: "received" });
    return { result: "created" as const, queued: false };
  }

  async markWebhookEventQueued(dedupeKey: string) {
    const e = this.webhookEvents.get(dedupeKey);
    if (e) e.status = "queued";
  }

  async updateSessionStatus(sessionId: string, patch: { status: WaStatus; phoneE164?: string | null; at: Date }) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.status = patch.status;
    if (patch.phoneE164) s.phoneE164 = patch.phoneE164;
  }

  async upsertContact(input: Omit<WaContactRecord, "id">) {
    for (const c of this.contacts.values()) {
      if (c.sessionId === input.sessionId && c.jid === input.jid) {
        if (input.pushName) c.pushName = input.pushName;
        if (input.phoneE164) c.phoneE164 = input.phoneE164;
        return c;
      }
    }
    const created = { ...input, id: newId("ct") };
    this.contacts.set(created.id, created);
    return created;
  }

  async upsertConversation(input: { ownerUserId: string; sessionId: string; contactId: string }) {
    for (const c of this.conversations.values()) {
      if (c.sessionId === input.sessionId && c.contactId === input.contactId) return c;
    }
    const created = {
      ...input,
      id: newId("cv"),
      lastMessageAt: null,
      humanTakeoverUntil: null,
      lastMessagePreview: null,
      unreadCount: 0,
    };
    this.conversations.set(created.id, created);
    return created;
  }

  async insertMessage(input: Omit<WaMessageRecord, "id">) {
    for (const m of this.messages.values()) {
      if (m.sessionId === input.sessionId && m.providerMessageId === input.providerMessageId) {
        if (m.sentBy === "USER_PHONE" && (input.sentBy === "AGENT" || input.sentBy === "USER_APP")) {
          m.sentBy = input.sentBy;
          m.agentRunId = input.agentRunId;
        }
        return { created: false, message: m };
      }
    }
    const created = { ...input, id: newId("msg") };
    this.messages.set(created.id, created);
    return { created: true, message: created };
  }

  async touchConversation(conversationId: string, patch: { lastMessageAt: Date; preview: string | null; incrementUnread: boolean }) {
    const c = this.conversations.get(conversationId);
    if (!c) return;
    if (!c.lastMessageAt || patch.lastMessageAt >= c.lastMessageAt) {
      c.lastMessageAt = patch.lastMessageAt;
      c.lastMessagePreview = patch.preview;
    }
    if (patch.incrementUnread) c.unreadCount += 1;
  }

  async updateMessageAck(sessionId: string, providerMessageId: string, ack: WaAck) {
    for (const m of this.messages.values()) {
      if (m.sessionId === sessionId && m.providerMessageId === providerMessageId) {
        if (ack === "failed" || ACK_ORDER[ack] > ACK_ORDER[m.ack]) m.ack = ack;
      }
    }
  }

  async getConversation(conversationId: string) {
    return this.conversations.get(conversationId) ?? null;
  }

  async getContact(contactId: string) {
    return this.contacts.get(contactId) ?? null;
  }

  async findLastInboundMessage(conversationId: string) {
    let best: WaMessageRecord | null = null;
    for (const m of this.messages.values()) {
      if (m.conversationId !== conversationId || m.sentBy !== "CONTACT" || m.fromMe) continue;
      if (!best || m.sentAt > best.sentAt) best = m;
    }
    return best ? { providerMessageId: best.providerMessageId, sentAt: best.sentAt } : null;
  }

  async recordBlockedSend(input: BlockedSendInput) {
    this.blocked.push(input);
  }
}
