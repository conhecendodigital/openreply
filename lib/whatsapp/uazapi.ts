/**
 * Adaptador da uazapi (https://docs.uazapi.com, API 2.4.x).
 *
 * Não oficial, igual ao OpenWA (QR ou código de pareamento), mas com proxy
 * gerenciado por país e cidade: a sessão sai por um IP do Brasil em vez do IP
 * do datacenter. Foi esse o motivo da troca (06/10/2026): o número pessoal do
 * dono foi bloqueado 5 s depois de conectar pelo OpenWA.
 *
 * Duas credenciais, só no servidor:
 *   admintoken (UAZAPI_ADMIN_TOKEN): cria e lista instâncias. Nunca sai daqui.
 *   token da instância: tudo o mais daquele número. Fica cifrado no banco
 *   (WaSession.instanceTokenEnc) e só é aberto no servidor.
 *
 * Rotas usadas:
 *   GET  /proxy-managed/countries, /proxy-managed/cities   (públicas)
 *   GET  /instance/all                                     (admintoken) vagas usadas
 *   POST /instance/create                                  (admintoken) com a região do proxy
 *   POST /instance/connect                                 QR (sem phone) ou código (com phone)
 *   GET  /instance/status                                  status, QR, código, número
 *   GET  /instance/proxy                                   confere se não caiu pra "direct"
 *   POST /instance/disconnect                              logout (não apaga a instância)
 *   POST /instance/reset                                   reinicia a conexão sem novo pareamento
 *   DELETE /instance                                       apaga a instância e libera a vaga do plano
 *                                                          (só no "Excluir número" de Conexões)
 *   GET/POST /webhook                                      webhook do Lead Engine (modo simples)
 *   POST /send/text, /send/media                           envios
 *   POST /message/presence                                 "digitando..."
 *   POST /message/markread, /chat/read                     lida
 *   POST /message/download                                 mídia recebida (fileURL)
 *
 * Desconectar nunca chama DELETE /instance (o dono pediu que desconectar não
 * apague nada): só o botão separado "Excluir número", com confirmação.
 * Nunca usado: o evento "history" (histórico antigo não entra no Lead Engine,
 * ver docs/whatsapp-uazapi.md).
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
/** Mídia que o inbox busca (igual ao OpenWA). */
export const UAZAPI_MAX_MEDIA_BYTES = 25 * 1024 * 1024;

/**
 * Eventos que o Lead Engine assina. "history" fica de fora de propósito: o
 * histórico antigo não é importado (privacidade e volume).
 */
export const UAZAPI_WEBHOOK_EVENTS = ["messages", "messages_update", "connection"] as const;
/**
 * O que o Lead Engine envia pela API já fica gravado na hora do envio; o eco
 * não volta (evita loop e o "dono respondeu pelo celular" falso).
 */
export const UAZAPI_WEBHOOK_EXCLUDE = ["wasSentByApi"] as const;

export interface ProxyRegion {
  /** ISO alpha-2 minúsculo (br). */
  country: string;
  /** UF minúscula quando a cidade tem (sp). */
  state: string | null;
  /** Slug de cities[].value (campinas). */
  city: string;
}

export interface RegionOption {
  value: string;
  label: string;
  state?: string | null;
  stateLabel?: string | null;
}

export interface UazapiInfo {
  status: WaStatus;
  qr: string | null;
  pairCode: string | null;
  phoneE164: string | null;
  pushName: string | null;
  /** Texto curto da última queda (lastDisconnectReason), quando vier. */
  lastDisconnectReason: string | null;
}

export interface UazapiProxyState {
  /** custom | internal | direct ("direct" = saindo sem proxy). */
  effectiveMode: string | null;
  fallbackActive: boolean;
}

export interface UazapiConfig {
  serverUrl: string;
  instanceToken: string;
  fetch?: FetchLike;
}

export interface UazapiAdminConfig {
  serverUrl: string;
  adminToken: string;
  fetch?: FetchLike;
}

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function digitsToE164(digits: string): string | null {
  return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
}

/** Status da instância (disconnected | connecting | connected | hibernated | ...) → WaStatus. */
export function mapUazapiStatus(status: unknown, hasCode = false, transitionType?: unknown): WaStatus {
  const type = String(transitionType ?? "").toLowerCase();
  if (type.includes("ban")) return "RESTRICTED";
  switch (String(status ?? "").toLowerCase()) {
    case "connected":
      return "CONNECTED";
    case "connecting":
      return hasCode ? "QR_READY" : "PENDING";
    case "disconnected":
    case "hibernated":
      return "DISCONNECTED";
    case "registration_conflict":
      return "RESTRICTED";
    default:
      return "PENDING";
  }
}

/** Telefone ou jid → "number" da uazapi. Contato vira só dígitos; grupo, LID e newsletter vão como vieram. */
export function toUazapiNumber(to: string): string {
  if (to.includes("@")) {
    if (to.endsWith("@c.us") || to.endsWith("@s.whatsapp.net")) return to.split("@")[0].replace(/\D/g, "");
    return to;
  }
  const digits = to.replace(/\D/g, "");
  if (!digits) throw new Error("Destino inválido");
  return digits;
}

/** QR que às vezes vem como base64 cru: vira data URL pra tela. */
function asDataUrl(qr: string | null): string | null {
  if (!qr) return null;
  if (qr.startsWith("data:image/")) return qr;
  if (/^[A-Za-z0-9+/=]{100,}$/.test(qr)) return `data:image/png;base64,${qr}`;
  return qr;
}

function phoneFromJid(jid: unknown): string | null {
  const o = obj(jid);
  const raw = o ? str(o.user) : str(jid);
  if (!raw) return null;
  return digitsToE164(raw.split("@")[0].split(":")[0].replace(/\D/g, ""));
}

function cleanPath(path: string): string {
  // Só a rota: nada de token, número ou texto no erro.
  return path.split("?")[0];
}

async function call<T>(
  fetchImpl: FetchLike,
  baseUrl: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  headers: Record<string, string>,
  body?: unknown,
  timeoutMs = REQUEST_TIMEOUT_MS,
  /** Envio de mensagem: rede caída ou 5xx deixam o resultado incerto, então não repete. */
  sendLike = false
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "tempo esgotado" : "erro de rede";
    throw new WhatsAppConnectorError(`uazapi indisponível (${message}) em ${method} ${cleanPath(path)}`, "UAZAPI", null, !sendLike);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) {
    // A uazapi orienta: 429 respeita Retry-After; envio com 5xx não se repete às cegas.
    const retryable = res.status === 429 || (res.status >= 500 && !sendLike);
    throw new WhatsAppConnectorError(`uazapi respondeu ${res.status} em ${method} ${cleanPath(path)}`, "UAZAPI", res.status, retryable);
  }
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

function trimUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

// ─── Rotas públicas e administrativas ────────────────────────────────────────

/** Países do proxy gerenciado (rota pública). */
export async function listProxyCountries(serverUrl: string, fetchImpl: FetchLike = (i, n) => fetch(i, n)): Promise<RegionOption[]> {
  const res = await call<{ countries?: unknown }>(fetchImpl, trimUrl(serverUrl), "GET", "/proxy-managed/countries", {});
  const list = Array.isArray(res.countries) ? res.countries : [];
  return list
    .map((c) => obj(c))
    .filter((c): c is Obj => Boolean(c && str(c.value)))
    .map((c) => ({ value: String(c.value).toLowerCase(), label: str(c.label) ?? String(c.value).toUpperCase() }))
    .filter((c) => /^[a-z]{2}$/.test(c.value));
}

/** Cidades do proxy gerenciado num país (rota pública). */
export async function listProxyCities(
  serverUrl: string,
  country: string,
  search: string | null = null,
  fetchImpl: FetchLike = (i, n) => fetch(i, n)
): Promise<RegionOption[]> {
  if (!/^[a-z]{2}$/.test(country)) throw new Error("País inválido");
  const qs = new URLSearchParams({ country });
  if (search) qs.set("search", search.slice(0, 40));
  const res = await call<{ cities?: unknown }>(fetchImpl, trimUrl(serverUrl), "GET", `/proxy-managed/cities?${qs}`, {});
  const list = Array.isArray(res.cities) ? res.cities : [];
  return list
    .map((c) => obj(c))
    .filter((c): c is Obj => Boolean(c && str(c.value)))
    .map((c) => ({
      value: String(c.value),
      label: str(c.label) ?? String(c.value),
      state: str(c.state)?.toLowerCase() ?? null,
      stateLabel: str(c.state_label),
    }));
}

export class UazapiAdmin {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly config: UazapiAdminConfig) {
    this.baseUrl = trimUrl(config.serverUrl);
    this.fetchImpl = config.fetch ?? ((input, init) => fetch(input, init));
  }

  private req<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    return call<T>(this.fetchImpl, this.baseUrl, method, path, { admintoken: this.config.adminToken }, body);
  }

  /** Quantas instâncias existem no servidor (cada uma ocupa um dispositivo do plano). */
  async countInstances(): Promise<number> {
    const res = await this.req<unknown>("GET", "/instance/all");
    if (Array.isArray(res)) return res.length;
    const o = obj(res);
    const list = o && (Array.isArray(o.instances) ? o.instances : Array.isArray(o.data) ? o.data : null);
    if (list) return list.length;
    throw new WhatsAppConnectorError("uazapi não devolveu a lista de instâncias", "UAZAPI", null, false);
  }

  /**
   * Cria a instância já com a região do proxy. Devolve o id (vira
   * WaSession.providerSessionId) e o token (vai cifrado pro banco).
   */
  async createInstance(name: string, region: ProxyRegion): Promise<{ instanceId: string; token: string; status: WaStatus }> {
    const res = await this.req<Obj>("POST", "/instance/create", {
      name,
      proxy_managed_country: region.country,
      ...(region.state ? { proxy_managed_state: region.state } : {}),
      proxy_managed_city: region.city,
    });
    const instance = obj(res.instance);
    const token = str(res.token) ?? str(instance?.token);
    const instanceId = str(instance?.id) ?? str(res.id);
    if (!token || !instanceId) throw new WhatsAppConnectorError("uazapi não devolveu o id e o token da instância", "UAZAPI", null, false);
    return { instanceId, token, status: mapUazapiStatus(instance?.status) };
  }
}

// ─── Conector de uma instância ───────────────────────────────────────────────

export class UazapiConnector implements WhatsAppConnector {
  readonly provider = "UAZAPI" as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly config: UazapiConfig) {
    this.baseUrl = trimUrl(config.serverUrl);
    this.fetchImpl = config.fetch ?? ((input, init) => fetch(input, init));
    if (!config.instanceToken) throw new Error("Token da instância da uazapi ausente");
  }

  private req<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, opts: { sendLike?: boolean; timeoutMs?: number } = {}): Promise<T> {
    return call<T>(this.fetchImpl, this.baseUrl, method, path, { token: this.config.instanceToken }, body, opts.timeoutMs, opts.sendLike);
  }

  /** Conectar sem phone = QR; com phone = código de pareamento. Sempre com a região do proxy. */
  async connect(options: { phone?: string | null; region?: ProxyRegion | null } = {}): Promise<ConnectResult> {
    const phone = options.phone ? options.phone.replace(/\D/g, "") : "";
    if (options.phone && !/^\d{10,15}$/.test(phone)) throw new Error("Número inválido pro código de pareamento");
    const region = options.region;
    let res: Obj;
    try {
      res = await this.req<Obj>("POST", "/instance/connect", {
        ...(phone ? { phone } : {}),
        ...(region
          ? {
              proxy_managed_country: region.country,
              ...(region.state ? { proxy_managed_state: region.state } : {}),
              proxy_managed_city: region.city,
            }
          : {}),
      });
    } catch (error) {
      // 409 = já tem uma conexão em andamento: segue com o status atual.
      if (!(error instanceof WhatsAppConnectorError && error.status === 409)) throw error;
      res = {};
    }
    const instance = obj(res.instance);
    let qr = asDataUrl(str(instance?.qrcode) ?? str(res.qrcode));
    let pairCode = str(instance?.paircode) ?? str(res.paircode);
    let status = mapUazapiStatus(instance?.status ?? (obj(res.status)?.connected ? "connected" : "connecting"), Boolean(qr || pairCode));
    if (!qr && !pairCode && status !== "CONNECTED") {
      // O QR às vezes só aparece no status logo depois.
      const info = await this.getInfo();
      qr = info.qr;
      pairCode = info.pairCode;
      status = info.status;
    }
    return { status, qr: phone ? null : qr, pairCode: phone ? pairCode : null };
  }

  async getInfo(): Promise<UazapiInfo> {
    const res = await this.req<Obj>("GET", "/instance/status");
    const instance = obj(res.instance);
    const st = obj(res.status);
    const qr = asDataUrl(str(instance?.qrcode));
    const pairCode = str(instance?.paircode);
    const raw = instance?.status ?? (st?.connected && st?.loggedIn ? "connected" : undefined);
    const status = mapUazapiStatus(raw, Boolean(qr || pairCode));
    const pushName = str(instance?.profileName);
    return {
      status,
      qr: status === "CONNECTED" ? null : qr,
      pairCode: status === "CONNECTED" ? null : pairCode,
      phoneE164: phoneFromJid(st?.jid) ?? (status === "CONNECTED" ? phoneFromJid(instance?.owner) : null),
      pushName: pushName ? pushName.slice(0, 80) : null,
      lastDisconnectReason: str(instance?.lastDisconnectReason)?.slice(0, 120) ?? null,
    };
  }

  async getQr(): Promise<string | null> {
    return (await this.getInfo()).qr;
  }

  async getStatus(): Promise<WaStatus> {
    return (await this.getInfo()).status;
  }

  /** Por onde a sessão está saindo agora. "direct" = sem proxy (a tela avisa). */
  async getProxy(): Promise<UazapiProxyState> {
    const res = await this.req<Obj>("GET", "/instance/proxy");
    return { effectiveMode: str(res.effective_mode), fallbackActive: obj(res.fallback)?.active === true };
  }

  /**
   * Garante o webhook do Lead Engine (modo simples da uazapi: um webhook por
   * instância, cria ou atualiza). A URL leva o segredo do número.
   */
  async ensureWebhook(url: string): Promise<void> {
    if (!url.startsWith("https://")) throw new Error("Webhook do WhatsApp só por HTTPS");
    await this.req("POST", "/webhook", {
      enabled: true,
      url,
      events: [...UAZAPI_WEBHOOK_EVENTS],
      excludeMessages: [...UAZAPI_WEBHOOK_EXCLUDE],
      addUrlEvents: false,
      addUrlTypesMessages: false,
    });
  }

  /** Reinicia a conexão sem apagar a instância nem o pareamento. */
  async reset(): Promise<{ resetting: boolean; message: string | null }> {
    const res = await this.req<Obj>("POST", "/instance/reset", {});
    return { resetting: res.resetting === true, message: str(res.response)?.slice(0, 120) ?? null };
  }

  /** Logout do WhatsApp. A instância continua na uazapi; nada é apagado no Lead Engine. */
  async disconnect(): Promise<void> {
    await this.req("POST", "/instance/disconnect", {});
  }

  /**
   * Apaga a instância na uazapi (libera o dispositivo do plano). Só o
   * "Excluir número" de Conexões chama, nunca o Desconectar. 404 = já não
   * existe lá, conta como feito.
   */
  async deleteInstance(): Promise<void> {
    try {
      await this.req("DELETE", "/instance");
    } catch (error) {
      if (error instanceof WhatsAppConnectorError && error.status === 404) return;
      throw error;
    }
  }

  private toResult(res: Obj): SendResult {
    const id = str(res.messageid) ?? (str(res.id)?.split(":").pop() || null);
    if (!id) throw new WhatsAppConnectorError("uazapi não devolveu o id da mensagem", "UAZAPI", null, false);
    const ts = typeof res.messageTimestamp === "number" ? res.messageTimestamp : Date.now();
    return { providerMessageId: id, timestamp: ts < 1e12 ? ts * 1000 : ts };
  }

  private tracking(options?: SendOptions) {
    // track_id não é idempotência (a uazapi aceita repetido); serve pra achar o envio depois.
    return options?.idempotencyKey ? { track_source: "lead-engine", track_id: options.idempotencyKey.slice(0, 120) } : {};
  }

  async sendText(to: string, text: string, options?: SendOptions): Promise<SendResult> {
    const res = await this.req<Obj>(
      "POST",
      "/send/text",
      {
        number: toUazapiNumber(to),
        text,
        ...(options?.quotedProviderMessageId ? { replyid: options.quotedProviderMessageId } : {}),
        ...this.tracking(options),
      },
      { sendLike: true }
    );
    return this.toResult(res);
  }

  async sendMedia(to: string, media: MediaToSend, options?: SendOptions): Promise<SendResult> {
    if (!media.url && !media.base64) throw new Error("Mídia sem url nem base64");
    const res = await this.req<Obj>(
      "POST",
      "/send/media",
      {
        number: toUazapiNumber(to),
        type: media.mediaType,
        file: media.url ?? media.base64,
        ...(media.caption ? { text: media.caption } : {}),
        ...(media.mediaType === "document" && media.filename ? { docName: media.filename } : {}),
        ...(media.mime ? { mimetype: media.mime } : {}),
        ...(options?.quotedProviderMessageId ? { replyid: options.quotedProviderMessageId } : {}),
        ...this.tracking(options),
      },
      { sendLike: true, timeoutMs: 60_000 }
    );
    return this.toResult(res);
  }

  async sendTemplate(to: string, template: TemplateToSend): Promise<SendResult> {
    void to;
    void template;
    throw new WhatsAppConnectorError("Template só existe na Cloud API oficial", "UAZAPI", null, false);
  }

  async setTyping(to: string, on: boolean, options?: TypingOptions): Promise<void> {
    void options;
    await this.req("POST", "/message/presence", { number: toUazapiNumber(to), presence: on ? "composing" : "paused" });
  }

  /** Com ids: marca essas mensagens. Sem ids: marca a conversa toda como lida. */
  async markRead(chatJid: string, providerMessageIds: string[]): Promise<void> {
    if (providerMessageIds.length) {
      await this.req("POST", "/message/markread", { id: providerMessageIds });
      return;
    }
    const number = chatJid.endsWith("@c.us") ? `${chatJid.split("@")[0]}@s.whatsapp.net` : chatJid;
    await this.req("POST", "/chat/read", { number, read: true });
  }

  /**
   * Bytes de uma mídia recebida: pede o fileURL (vale 2 dias) e baixa no
   * servidor. null quando não tem ou passou do limite.
   */
  async fetchMedia(chatJid: string, providerMessageId: string): Promise<{ bytes: Uint8Array; contentType: string | null } | null> {
    void chatJid;
    let res: Obj;
    try {
      res = await this.req<Obj>("POST", "/message/download", { id: providerMessageId }, { timeoutMs: 30_000 });
    } catch (error) {
      if (error instanceof WhatsAppConnectorError && (error.status === 404 || error.status === 400)) return null;
      throw error;
    }
    const url = str(res.fileURL);
    if (!url || !/^https?:\/\//.test(url)) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const file = await this.fetchImpl(url, { method: "GET", signal: controller.signal });
      if (!file.ok) return null;
      const declared = Number(file.headers.get("content-length") ?? "0");
      if (declared > UAZAPI_MAX_MEDIA_BYTES) return null;
      const buf = new Uint8Array(await file.arrayBuffer());
      if (buf.byteLength > UAZAPI_MAX_MEDIA_BYTES) return null;
      return { bytes: buf, contentType: str(res.mimetype) ?? file.headers.get("content-type") };
    } catch {
      throw new WhatsAppConnectorError("uazapi indisponível ao buscar mídia", "UAZAPI", null, true);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ─── Variáveis de ambiente ───────────────────────────────────────────────────

export const UAZAPI_DEFAULT_MAX_INSTANCES = 2;

export interface UazapiEnv {
  serverUrl: string;
  adminToken: string;
  maxInstances: number;
}

/** null = uazapi não configurada (a opção aparece desabilitada na tela). */
export function uazapiFromEnv(env: Record<string, string | undefined> = process.env): UazapiEnv | null {
  const serverUrl = env.UAZAPI_SERVER_URL?.trim();
  const adminToken = env.UAZAPI_ADMIN_TOKEN?.trim();
  if (!serverUrl || !adminToken || !/^https?:\/\//.test(serverUrl)) return null;
  const n = Number.parseInt(env.UAZAPI_MAX_INSTANCES ?? "", 10);
  return { serverUrl: trimUrl(serverUrl), adminToken, maxInstances: Number.isFinite(n) && n > 0 && n <= 100 ? n : UAZAPI_DEFAULT_MAX_INSTANCES };
}
