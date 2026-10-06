/**
 * WhatsApp: tipos próprios do conector.
 *
 * Os nomes seguem o schema "whatsapp" do plano (WaSession, WaContact,
 * WaConversation, WaMessage, WaWebhookEvent, WaAgentRun). Este arquivo NÃO
 * importa o Prisma de propósito: a Fase 0 (feat/multiusuario) ainda está
 * criando o schema. Quando ela entrar, os tipos daqui viram um espelho dos
 * modelos gerados (ver docs/whatsapp-conector.md, seção "Encaixe com a Fase 0").
 */

/**
 * enum WaProvider do plano. UAZAPI (06/10/2026): segundo provedor não oficial,
 * com proxy gerenciado por cidade (sai por IP do Brasil). Ver docs/whatsapp-uazapi.md.
 */
export type WaProvider = "OPENWA" | "CLOUD_API" | "UAZAPI";

/** enum WaStatus do plano. */
export type WaStatus = "PENDING" | "QR_READY" | "CONNECTED" | "DISCONNECTED" | "RESTRICTED" | "BANNED";

/** enum AgentMode do plano. */
export type AgentMode = "INHERIT" | "OFF" | "DRAFT" | "AUTO";

/** enum SentBy do plano. */
export type SentBy = "CONTACT" | "USER_APP" | "USER_PHONE" | "AGENT";

/** WaMessage.type */
export type WaMessageType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "sticker"
  | "location"
  | "reaction"
  | "unknown";

/** WaMessage.ack */
export type WaAck = "pending" | "sent" | "delivered" | "read" | "failed";

/** Linha de whatsapp."WaSession" que o conector precisa. */
export interface WaSessionRecord {
  id: string;
  ownerUserId: string;
  workspaceId: string;
  provider: WaProvider;
  /** id da sessão no OpenWA ou phone_number_id na Meta. */
  providerSessionId: string;
  phoneE164: string | null;
  status: WaStatus;
  /** Segredo HMAC do webhook do OpenWA, já decifrado pelo repositório. Nunca logar. */
  webhookSecret: string | null;
  /** OpenWA: quando a pessoa aceitou o termo de risco. Sem isso, não conecta. */
  riskAcceptedAt: Date | null;
  /** Cloud API: WABA da coexistência (fica em WaSession quando a Fase 0 juntar). */
  wabaId?: string | null;
  /** uazapi: token da instância, já decifrado pelo repositório. Nunca logar. */
  instanceToken?: string | null;
}

export interface WaContactRecord {
  id: string;
  ownerUserId: string;
  sessionId: string;
  jid: string;
  phoneE164: string | null;
  pushName: string | null;
}

export interface WaConversationRecord {
  id: string;
  ownerUserId: string;
  sessionId: string;
  contactId: string;
  lastMessageAt: Date | null;
  /** "Assumir": enquanto for futuro, nada que o agente mandar sai. */
  humanTakeoverUntil: Date | null;
}

export interface WaMessageRecord {
  id: string;
  ownerUserId: string;
  conversationId: string;
  sessionId: string;
  providerMessageId: string;
  fromMe: boolean;
  sentBy: SentBy;
  type: WaMessageType;
  body: string | null;
  quotedId: string | null;
  ack: WaAck;
  agentRunId: string | null;
  sentAt: Date;
  /** Mídia (tipo, nome e id na Meta). Os bytes ficam no gateway. */
  media?: { mime: string | null; filename: string | null; ref: string | null } | null;
}

// ─── Eventos normalizados (saída do webhook, entrada da fila wa-ingest) ──────

export interface NormalizedMedia {
  /** id da mídia na Meta ou URL/base64 do OpenWA (o worker de mídia baixa depois). */
  ref: string | null;
  mime: string | null;
  filename: string | null;
  caption: string | null;
}

export interface NormalizedMessage {
  kind: "message";
  provider: WaProvider;
  providerSessionId: string;
  providerMessageId: string;
  /** jid do contato: 5511999999999@c.us (OpenWA) ou 5511999999999@s.whatsapp.net (Cloud API). */
  chatJid: string;
  phoneE164: string | null;
  pushName: string | null;
  fromMe: boolean;
  /** CONTACT quando chegou do contato; USER_PHONE quando o dono mandou pelo celular (eco). */
  sentBy: SentBy;
  type: WaMessageType;
  body: string | null;
  quotedProviderMessageId: string | null;
  media: NormalizedMedia | null;
  /** Hora real da mensagem em ms. */
  timestamp: number;
  isGroup: boolean;
  /** Veio do histórico da coexistência (não abre janela de 24h). */
  isHistory: boolean;
}

export interface NormalizedAck {
  kind: "ack";
  provider: WaProvider;
  providerSessionId: string;
  providerMessageId: string;
  ack: WaAck;
  timestamp: number;
}

export interface NormalizedSessionEvent {
  kind: "session";
  provider: WaProvider;
  providerSessionId: string;
  status: WaStatus;
  /** QR em data URL ou texto cru, quando o evento for session.qr. */
  qr: string | null;
  phoneE164: string | null;
  timestamp: number;
}

export type NormalizedEvent = NormalizedMessage | NormalizedAck | NormalizedSessionEvent;

// ─── Fila de saída (wa-send) ─────────────────────────────────────────────────

export type OutboundContent =
  | { type: "text"; text: string }
  | {
      type: "media";
      mediaType: "image" | "video" | "audio" | "document";
      url?: string;
      base64?: string;
      mime?: string;
      filename?: string;
      caption?: string;
    }
  | { type: "template"; name: string; language: string; components?: unknown[] };

export interface OutboundRequest {
  ownerUserId: string;
  sessionId: string;
  conversationId: string;
  /** Quem pediu o envio. AGENT respeita o "Assumir" (humanTakeoverUntil). */
  sentBy: Exclude<SentBy, "CONTACT" | "USER_PHONE">;
  content: OutboundContent;
  agentRunId?: string | null;
  quotedProviderMessageId?: string | null;
}

export type BlockReason =
  | "fora_da_janela_24h"
  | "sem_mensagem_do_contato"
  | "humano_assumiu"
  | "sessao_desconectada"
  /** O run do agente não pode mais sair (podeEnviar disse não: Assumir, modo, janela). */
  | "agente_cancelado";
