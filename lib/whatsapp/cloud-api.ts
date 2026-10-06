/**
 * Adaptador da WhatsApp Cloud API oficial (Meta), com coexistência: o número
 * continua no app WhatsApp Business do celular e a API usa o mesmo número.
 *
 * Envio:   POST /{phone_number_id}/messages   (text, image, video, audio, document, template)
 * Lida + "digitando...": o mesmo POST com { status: "read", message_id, typing_indicator }
 *          (o indicador some sozinho quando a resposta sai ou depois de ~25 s).
 * Status:  GET  /{phone_number_id}?fields=status,display_phone_number,...
 * Desligar: DELETE /{waba_id}/subscribed_apps (para os webhooks; o número segue
 *          funcionando no app do celular e nada é apagado do nosso lado).
 *
 * Fluxo da coexistência (ver completeCoexistenceOnboarding abaixo):
 *   1. Embedded Signup v4 no navegador com featureType
 *      "whatsapp_business_app_onboarding". A pessoa escaneia o QR no app
 *      Business e escolhe compartilhar o histórico. A Meta devolve `code`,
 *      `waba_id` e `phone_number_id`.
 *   2. Servidor troca o `code` por um token de negócio (/oauth/access_token).
 *   3. POST /{waba_id}/subscribed_apps: liga os webhooks deste app no WABA.
 *      Número de coexistência NÃO passa pelo /register.
 *   4. Até 24 h depois do passo 1: POST /{phone_number_id}/smb_app_data com
 *      sync_type "smb_app_state_sync" (contatos) e depois "history" (até 180
 *      dias de conversas, chegam pelo webhook "history").
 *   5. Webhooks assinados com X-Hub-Signature-256: "messages" (recebidas e
 *      status), "smb_message_echoes" (o que a pessoa mandou pelo celular),
 *      "history" e "smb_app_state_sync". Grupos não sincronizam.
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
import { getMetaGraphApiVersion } from "@/lib/env";
import type { WaStatus } from "@/lib/whatsapp/types";

const REQUEST_TIMEOUT_MS = 15_000;

/** Campos de webhook que o app precisa assinar no WABA. */
export const CLOUD_API_WEBHOOK_FIELDS = [
  "messages",
  "smb_message_echoes",
  "history",
  "smb_app_state_sync",
  "account_update",
] as const;

/** jid, +55 (11) 9..., 5511...@s.whatsapp.net → 5511... (formato que a Cloud API quer). */
export function toCloudRecipient(to: string): string {
  const digits = to.split("@")[0].replace(/\D/g, "");
  if (!/^\d{8,15}$/.test(digits)) throw new Error("Destino inválido");
  return digits;
}

export function mapCloudStatus(status: unknown): WaStatus {
  switch (String(status ?? "").toUpperCase()) {
    case "CONNECTED":
      return "CONNECTED";
    case "FLAGGED":
    case "RESTRICTED":
    case "RATE_LIMITED":
      return "RESTRICTED";
    case "BANNED":
      return "BANNED";
    case "DISCONNECTED":
    case "DELETED":
    case "UNAVAILABLE":
      return "DISCONNECTED";
    default:
      return "PENDING";
  }
}

export interface CloudApiConfig {
  accessToken: string;
  phoneNumberId: string;
  wabaId: string | null;
  graphVersion?: string;
  fetch?: FetchLike;
}

async function graphRequest<T>(
  fetchImpl: FetchLike,
  url: string,
  init: { method: string; token?: string; body?: unknown }
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: init.method,
      headers: {
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro de rede";
    throw new WhatsAppConnectorError(`Cloud API indisponível: ${message}`, "CLOUD_API", null, true);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: number; message?: string } }).error;
    // Código e mensagem da Meta não carregam token; o corpo enviado não é repetido.
    throw new WhatsAppConnectorError(
      `Cloud API respondeu ${res.status}${err?.code ? ` (código ${err.code})` : ""}`,
      "CLOUD_API",
      res.status,
      res.status === 429 || res.status >= 500
    );
  }
  return json as T;
}

export class CloudApiConnector implements WhatsAppConnector {
  readonly provider = "CLOUD_API" as const;
  private readonly fetchImpl: FetchLike;
  private readonly base: string;

  constructor(private readonly config: CloudApiConfig) {
    this.fetchImpl = config.fetch ?? ((input, init) => fetch(input, init));
    this.base = `https://graph.facebook.com/${config.graphVersion ?? getMetaGraphApiVersion()}`;
  }

  private messagesUrl(): string {
    return `${this.base}/${encodeURIComponent(this.config.phoneNumberId)}/messages`;
  }

  private async postMessage(payload: Record<string, unknown>, options?: SendOptions): Promise<SendResult> {
    const body: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      ...payload,
      ...(options?.quotedProviderMessageId ? { context: { message_id: options.quotedProviderMessageId } } : {}),
    };
    const res = await graphRequest<{ messages?: Array<{ id?: string }> }>(this.fetchImpl, this.messagesUrl(), {
      method: "POST",
      token: this.config.accessToken,
      body,
    });
    const id = res.messages?.[0]?.id;
    if (!id) throw new WhatsAppConnectorError("Cloud API não devolveu o id da mensagem", "CLOUD_API", null, false);
    return { providerMessageId: id, timestamp: Date.now() };
  }

  async connect(): Promise<ConnectResult> {
    return { status: await this.getStatus(), qr: null };
  }

  async getQr(): Promise<string | null> {
    return null;
  }

  async getStatus(): Promise<WaStatus> {
    const res = await graphRequest<{ status?: string }>(
      this.fetchImpl,
      `${this.base}/${encodeURIComponent(this.config.phoneNumberId)}?fields=status,display_phone_number,quality_rating`,
      { method: "GET", token: this.config.accessToken }
    );
    return mapCloudStatus(res.status);
  }

  async sendText(to: string, text: string, options?: SendOptions): Promise<SendResult> {
    return this.postMessage(
      { to: toCloudRecipient(to), type: "text", text: { body: text, preview_url: /https?:\/\//.test(text) } },
      options
    );
  }

  async sendMedia(to: string, media: MediaToSend, options?: SendOptions): Promise<SendResult> {
    if (!media.url) {
      // A Cloud API recebe link público ou id de mídia já enviada (/media). base64 não.
      throw new Error("Na Cloud API a mídia precisa de um link público");
    }
    const object: Record<string, unknown> = { link: media.url };
    if (media.caption && media.mediaType !== "audio") object.caption = media.caption;
    if (media.filename && media.mediaType === "document") object.filename = media.filename;
    return this.postMessage({ to: toCloudRecipient(to), type: media.mediaType, [media.mediaType]: object }, options);
  }

  async sendTemplate(to: string, template: TemplateToSend, options?: SendOptions): Promise<SendResult> {
    return this.postMessage(
      {
        to: toCloudRecipient(to),
        type: "template",
        template: {
          name: template.name,
          language: { code: template.language },
          ...(template.components ? { components: template.components } : {}),
        },
      },
      options
    );
  }

  async setTyping(to: string, on: boolean, options?: TypingOptions): Promise<void> {
    void to;
    // Desligar não existe na API: some quando a resposta sai.
    if (!on || !options?.replyToProviderMessageId) return;
    await graphRequest(this.fetchImpl, this.messagesUrl(), {
      method: "POST",
      token: this.config.accessToken,
      body: {
        messaging_product: "whatsapp",
        status: "read",
        message_id: options.replyToProviderMessageId,
        typing_indicator: { type: "text" },
      },
    });
  }

  async markRead(chatJid: string, providerMessageIds: string[]): Promise<void> {
    void chatJid;
    // A Meta marca como lidas todas as anteriores da conversa: basta a última.
    const last = providerMessageIds[providerMessageIds.length - 1];
    if (!last) return;
    await graphRequest(this.fetchImpl, this.messagesUrl(), {
      method: "POST",
      token: this.config.accessToken,
      body: { messaging_product: "whatsapp", status: "read", message_id: last },
    });
  }

  async disconnect(): Promise<void> {
    if (!this.config.wabaId) return;
    await graphRequest(this.fetchImpl, `${this.base}/${encodeURIComponent(this.config.wabaId)}/subscribed_apps`, {
      method: "DELETE",
      token: this.config.accessToken,
    });
  }
}

// ─── Coexistência: passos de servidor depois do Embedded Signup ──────────────

export interface CoexistenceInput {
  /** `code` devolvido pelo Embedded Signup (vale poucos minutos, uso único). */
  code: string;
  wabaId: string;
  phoneNumberId: string;
  appId: string;
  appSecret: string;
  graphVersion?: string;
  fetch?: FetchLike;
  /** false pula a sincronização (ex.: a pessoa não quis compartilhar o histórico). */
  syncHistory?: boolean;
}

export interface CoexistenceResult {
  /** Token de negócio. O chamador cifra (encryptToken) antes de guardar. Nunca logar. */
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
  status: WaStatus;
  historyRequested: boolean;
}

export async function completeCoexistenceOnboarding(input: CoexistenceInput): Promise<CoexistenceResult> {
  const fetchImpl = input.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const base = `https://graph.facebook.com/${input.graphVersion ?? getMetaGraphApiVersion()}`;

  // 2. code → token de negócio (formato da documentação do Embedded Signup).
  // A URL leva o segredo do app: nunca logar esta chamada.
  const query = new URLSearchParams({ client_id: input.appId, client_secret: input.appSecret, code: input.code });
  const tokenRes = await graphRequest<{ access_token?: string }>(fetchImpl, `${base}/oauth/access_token?${query}`, {
    method: "GET",
  });
  const accessToken = tokenRes.access_token;
  if (!accessToken) throw new WhatsAppConnectorError("A Meta não devolveu o token de negócio", "CLOUD_API", null, false);

  // 3. webhooks do app neste WABA.
  await graphRequest(fetchImpl, `${base}/${encodeURIComponent(input.wabaId)}/subscribed_apps`, {
    method: "POST",
    token: accessToken,
  });

  // 4. contatos e histórico do app Business (janela de 24 h depois do signup).
  let historyRequested = false;
  if (input.syncHistory !== false) {
    const smbUrl = `${base}/${encodeURIComponent(input.phoneNumberId)}/smb_app_data`;
    await graphRequest(fetchImpl, smbUrl, {
      method: "POST",
      token: accessToken,
      body: { messaging_product: "whatsapp", sync_type: "smb_app_state_sync" },
    });
    await graphRequest(fetchImpl, smbUrl, {
      method: "POST",
      token: accessToken,
      body: { messaging_product: "whatsapp", sync_type: "history" },
    });
    historyRequested = true;
  }

  const connector = new CloudApiConnector({
    accessToken,
    phoneNumberId: input.phoneNumberId,
    wabaId: input.wabaId,
    graphVersion: input.graphVersion,
    fetch: fetchImpl,
  });
  const status = await connector.getStatus().catch(() => "PENDING" as WaStatus);
  return { accessToken, wabaId: input.wabaId, phoneNumberId: input.phoneNumberId, status, historyRequested };
}
