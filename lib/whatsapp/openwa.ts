/**
 * Adaptador do gateway OpenWA (https://github.com/rmyndharis/OpenWA, MIT).
 *
 * Não oficial: o número pode ser banido. Por isso `connect()` só roda depois
 * que a pessoa aceitou o termo de risco (WaSession.riskAcceptedAt).
 *
 * Fala só com a API REST do gateway (cabeçalho X-API-Key, chave guardada no
 * servidor). O navegador nunca chega no OpenWA.
 *
 * Rotas usadas (openapi.json do OpenWA 0.24):
 *   POST /api/sessions                         criar sessão
 *   POST /api/sessions/:id/start               iniciar (gera QR)
 *   GET  /api/sessions/:id/qr                  QR atual
 *   GET  /api/sessions/:id                     status
 *   POST /api/sessions/:id/logout              desconectar
 *   POST /api/sessions/:id/webhooks            registrar nosso webhook com segredo HMAC
 *   POST /api/sessions/:id/messages/send-text  (+ send-image/-video/-audio/-document)
 *   POST /api/sessions/:id/chats/typing        { chatId, state: typing|paused }
 *   POST /api/sessions/:id/chats/read          { chatId, messageIds }
 */
import {
  WhatsAppConnectorError,
  type ConnectResult,
  type FetchLike,
  type MediaToSend,
  type SendOptions,
  type SendResult,
  type TemplateToSend,
  type TypingOptions,
  type WhatsAppConnector,
} from "@/lib/whatsapp/connector";
import type { WaStatus } from "@/lib/whatsapp/types";

const REQUEST_TIMEOUT_MS = 15_000;

/** Status do OpenWA → WaStatus do plano. */
export function mapOpenWAStatus(status: unknown, restricted = false): WaStatus {
  if (restricted) return "RESTRICTED";
  switch (status) {
    case "ready":
      return "CONNECTED";
    case "qr_ready":
      return "QR_READY";
    case "disconnected":
    case "failed":
      return "DISCONNECTED";
    case "action_required":
      return "RESTRICTED";
    default:
      return "PENDING";
  }
}

/** Telefone ou jid → chatId do OpenWA (5511999999999@c.us). Grupos e @lid passam como vieram. */
export function toOpenWAChatId(to: string): string {
  if (to.includes("@")) {
    if (to.endsWith("@s.whatsapp.net")) return `${to.split("@")[0]}@c.us`;
    return to;
  }
  const digits = to.replace(/\D/g, "");
  if (!digits) throw new Error("Destino inválido");
  return `${digits}@c.us`;
}

/** Eventos que o Lead Engine assina no OpenWA. */
export const OPENWA_WEBHOOK_EVENTS = [
  "message.received",
  "message.sent",
  "message.ack",
  "message.edited",
  "message.revoked",
  "session.qr",
  // O OpenWA não tem "session.ready" (o POST /webhooks recusa evento fora de
  // WEBHOOK_EVENTS com 400). "Pronto" chega como session.status { status: "ready" }.
  "session.status",
  "session.authenticated",
  "session.disconnected",
  "session.restriction",
] as const;

export interface OpenWAConfig {
  baseUrl: string;
  apiKey: string;
  sessionId: string;
  riskAcceptedAt: Date | null;
  fetch?: FetchLike;
}

interface OpenWASession {
  id: string;
  status?: string;
  phone?: string | null;
  restriction?: unknown;
}

export class OpenWAConnector implements WhatsAppConnector {
  readonly provider = "OPENWA" as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly config: OpenWAConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = config.fetch ?? ((input, init) => fetch(input, init));
  }

  private sessionPath(suffix = ""): string {
    return `/api/sessions/${encodeURIComponent(this.config.sessionId)}${suffix}`;
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "X-API-Key": this.config.apiKey,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...extraHeaders,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "erro de rede";
      throw new WhatsAppConnectorError(`OpenWA indisponível: ${message}`, "OPENWA", null, true);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (!res.ok) {
      // Só o status e um pedaço curto: a resposta pode ecoar o texto da mensagem.
      throw new WhatsAppConnectorError(
        `OpenWA respondeu ${res.status} em ${method} ${path.replace(/\/api\/sessions\/[^/]+/, "/api/sessions/:id")}`,
        "OPENWA",
        res.status,
        res.status === 429 || res.status >= 500
      );
    }
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return {} as T;
    }
  }

  /** Cria a sessão no gateway. Devolve o id que vira WaSession.providerSessionId. */
  static async createSession(
    config: Omit<OpenWAConfig, "sessionId" | "riskAcceptedAt">,
    name: string
  ): Promise<{ providerSessionId: string; status: WaStatus }> {
    const connector = new OpenWAConnector({ ...config, sessionId: "_", riskAcceptedAt: null });
    const created = await connector.request<OpenWASession>("POST", "/api/sessions", { name });
    if (!created.id) throw new WhatsAppConnectorError("OpenWA não devolveu o id da sessão", "OPENWA", null, false);
    return { providerSessionId: created.id, status: mapOpenWAStatus(created.status) };
  }

  /** Registra o webhook do Lead Engine nesta sessão, assinado com o segredo do número. */
  async registerWebhook(url: string, secret: string): Promise<{ webhookId: string }> {
    // O OpenWA exige no mínimo 16; segredo fraco deixa forjar o HMAC por força bruta.
    if (secret.length < 32) throw new Error("Segredo do webhook curto demais (mínimo 32 caracteres aleatórios)");
    if (!url.startsWith("https://")) throw new Error("Webhook do WhatsApp só por HTTPS");
    const res = await this.request<{ id?: string }>("POST", this.sessionPath("/webhooks"), {
      url,
      secret,
      events: [...OPENWA_WEBHOOK_EVENTS],
      retryCount: 3,
    });
    return { webhookId: res.id ?? "" };
  }

  async connect(): Promise<ConnectResult> {
    if (!this.config.riskAcceptedAt) {
      throw new WhatsAppConnectorError(
        "Aceite o termo de risco do modo experimental antes de conectar o número",
        "OPENWA",
        null,
        false
      );
    }
    const started = await this.request<OpenWASession>("POST", this.sessionPath("/start"));
    const status = mapOpenWAStatus(started.status, Boolean(started.restriction));
    const qr = status === "QR_READY" ? await this.getQr() : null;
    return { status, qr };
  }

  async getQr(): Promise<string | null> {
    try {
      const res = await this.request<{ qrCode?: string }>("GET", this.sessionPath("/qr"));
      return res.qrCode || null;
    } catch (error) {
      // Sem QR o OpenWA 0.24 responde 400 ("QR code is not ready yet" ou sessão já autenticada); 404/409 por garantia.
      if (error instanceof WhatsAppConnectorError && (error.status === 400 || error.status === 404 || error.status === 409)) return null;
      throw error;
    }
  }

  async getStatus(): Promise<WaStatus> {
    const session = await this.request<OpenWASession>("GET", this.sessionPath());
    return mapOpenWAStatus(session.status, Boolean(session.restriction));
  }

  private toResult(res: { messageId?: string; timestamp?: number }): SendResult {
    if (!res.messageId) throw new WhatsAppConnectorError("OpenWA não devolveu o id da mensagem", "OPENWA", null, false);
    const ts = typeof res.timestamp === "number" ? res.timestamp : Date.now();
    // O gateway devolve segundos (engine) ou ms; normaliza pra ms.
    return { providerMessageId: res.messageId, timestamp: ts < 1e12 ? ts * 1000 : ts };
  }

  private idempotencyHeaders(options?: SendOptions): Record<string, string> {
    return options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {};
  }

  async sendText(to: string, text: string, options?: SendOptions): Promise<SendResult> {
    const res = await this.request<{ messageId?: string; timestamp?: number }>(
      "POST",
      this.sessionPath("/messages/send-text"),
      {
        chatId: toOpenWAChatId(to),
        text,
        ...(options?.quotedProviderMessageId ? { quotedMessageId: options.quotedProviderMessageId } : {}),
      },
      this.idempotencyHeaders(options)
    );
    return this.toResult(res);
  }

  async sendMedia(to: string, media: MediaToSend, options?: SendOptions): Promise<SendResult> {
    if (!media.url && !media.base64) throw new Error("Mídia sem url nem base64");
    const res = await this.request<{ messageId?: string; timestamp?: number }>(
      "POST",
      this.sessionPath(`/messages/send-${media.mediaType}`),
      {
        chatId: toOpenWAChatId(to),
        ...(media.url ? { url: media.url } : { base64: media.base64 }),
        ...(media.mime ? { mimetype: media.mime } : {}),
        ...(media.filename ? { filename: media.filename } : {}),
        ...(media.caption ? { caption: media.caption } : {}),
        ...(options?.quotedProviderMessageId ? { quotedMessageId: options.quotedProviderMessageId } : {}),
      },
      this.idempotencyHeaders(options)
    );
    return this.toResult(res);
  }

  async sendTemplate(to: string, template: TemplateToSend): Promise<SendResult> {
    void to;
    void template;
    throw new WhatsAppConnectorError("Template só existe na Cloud API oficial", "OPENWA", null, false);
  }

  async setTyping(to: string, on: boolean, options?: TypingOptions): Promise<void> {
    void options;
    await this.request("POST", this.sessionPath("/chats/typing"), {
      chatId: toOpenWAChatId(to),
      state: on ? "typing" : "paused",
    });
  }

  async markRead(chatJid: string, providerMessageIds: string[]): Promise<void> {
    await this.request("POST", this.sessionPath("/chats/read"), {
      chatId: toOpenWAChatId(chatJid),
      ...(providerMessageIds.length ? { messageIds: providerMessageIds } : {}),
    });
  }

  async disconnect(): Promise<void> {
    await this.request("POST", this.sessionPath("/logout"));
  }
}
