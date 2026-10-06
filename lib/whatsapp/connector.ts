/**
 * Interface única dos conectores de WhatsApp.
 *
 * Cada número (WaSession) escolhe o seu conector pelo campo `provider`. A fila
 * de saída, o webhook e o inbox só falam com esta interface, então trocar um
 * número de OpenWA pra Cloud API (ou o contrário) é mudar `provider` e as
 * credenciais, sem mexer no resto.
 */
import type { WaProvider, WaStatus } from "@/lib/whatsapp/types";

export interface SendOptions {
  /** Mesmo valor em reenvio = a mensagem não duplica (OpenWA respeita Idempotency-Key). */
  idempotencyKey?: string;
  quotedProviderMessageId?: string | null;
}

export interface SendResult {
  providerMessageId: string;
  /** ms */
  timestamp: number;
}

export interface MediaToSend {
  mediaType: "image" | "video" | "audio" | "document";
  url?: string;
  base64?: string;
  mime?: string;
  filename?: string;
  caption?: string;
}

export interface TemplateToSend {
  name: string;
  language: string;
  components?: unknown[];
}

export interface ConnectResult {
  status: WaStatus;
  /** OpenWA: QR pra escanear (data URL). Cloud API: sempre null. */
  qr: string | null;
}

export interface TypingOptions {
  /**
   * Cloud API: o indicador de digitação vai junto com o "lida" de uma mensagem
   * recebida, então precisa do id dela. OpenWA ignora.
   */
  replyToProviderMessageId?: string | null;
}

export interface WhatsAppConnector {
  readonly provider: WaProvider;
  /** Liga a sessão. OpenWA: inicia e devolve o QR. Cloud API: confere o número. */
  connect(): Promise<ConnectResult>;
  /** QR atual (OpenWA). Cloud API devolve null. */
  getQr(): Promise<string | null>;
  getStatus(): Promise<WaStatus>;
  sendText(to: string, text: string, options?: SendOptions): Promise<SendResult>;
  sendMedia(to: string, media: MediaToSend, options?: SendOptions): Promise<SendResult>;
  /** Só a Cloud API tem template. OpenWA lança erro. A fila de saída aplica a regra das 24h antes. */
  sendTemplate(to: string, template: TemplateToSend, options?: SendOptions): Promise<SendResult>;
  /** "digitando..." ligado (true) ou desligado (false). */
  setTyping(to: string, on: boolean, options?: TypingOptions): Promise<void>;
  markRead(chatJid: string, providerMessageIds: string[]): Promise<void>;
  /** Desconecta o número. Nunca apaga nada no nosso banco. */
  disconnect(): Promise<void>;
}

export class WhatsAppConnectorError extends Error {
  constructor(
    message: string,
    readonly provider: WaProvider,
    readonly status: number | null,
    /** true = vale tentar de novo (rede, 429, 5xx). */
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "WhatsAppConnectorError";
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Credenciais por número, já decifradas pelo chamador. Nunca logar. */
export interface ConnectorCredentials {
  openwa?: { baseUrl: string; apiKey: string };
  cloudApi?: { accessToken: string; graphVersion?: string };
}

/** 5511999999999@c.us | 5511999999999@s.whatsapp.net | +55 11 99999-9999 → 5511999999999 */
export function jidToDigits(jid: string): string {
  return jid.split("@")[0].replace(/\D/g, "");
}

export function digitsToE164(digits: string): string | null {
  return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
}
