/**
 * Webhook da uazapi: POST /api/whatsapp/webhook/uazapi/<sessionId>/<segredo>.
 *
 * A uazapi não assina o corpo (não tem HMAC). Então a origem é conferida de
 * dois jeitos, os dois em tempo constante:
 *   1. o segredo na URL, gerado por número (32 bytes aleatórios) e guardado
 *      só cifrado (WaSession.webhookSecretEnc). Sem ele: 401 e nada gravado;
 *   2. o campo `token` que a uazapi manda em todo evento (é o token DAQUELA
 *      instância). Se vier e não bater com o token guardado: 401.
 *
 * O evento cru não é gravado (ele traz o token da instância). Vai pro
 * WaWebhookEvent só o evento já normalizado, igual à Meta.
 *
 * Histórico ("history") é ignorado sem gravar nada: o Lead Engine só pega
 * mensagens novas a partir da conexão (privacidade e volume).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { hitRateLimit } from "@/lib/http-rate-limit";
import { digitsToE164 } from "@/lib/whatsapp/connector";
import { toMs } from "@/lib/whatsapp/normalize";
import { mapUazapiStatus } from "@/lib/whatsapp/uazapi";
import type {
  NormalizedAck,
  NormalizedEvent,
  NormalizedMessage,
  NormalizedSessionEvent,
  WaAck,
  WaMessageType,
} from "@/lib/whatsapp/types";
import {
  declaredTooLarge,
  enqueueOnce,
  MAX_WA_WEBHOOK_BYTES,
  WA_WEBHOOK_RATE_LIMIT,
  type WebhookDeps,
  type WebhookResponse,
} from "@/lib/whatsapp/webhook";

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj | null {
  if (typeof value === "string" && value.startsWith("{")) {
    try {
      return obj(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : null;
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

const MAX_BODY_CHARS = 8_000;

/** Compara dois segredos sem vazar tempo nem tamanho. */
export function sameSecret(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = createHmac("sha256", "wa-uazapi-cmp").update(a).digest();
  const y = createHmac("sha256", "wa-uazapi-cmp").update(b).digest();
  return timingSafeEqual(x, y);
}

/** messageType da uazapi (Conversation, ExtendedTextMessage, ImageMessage...) → WaMessageType. */
export function mapUazapiType(messageType: unknown): WaMessageType {
  const t = String(messageType ?? "")
    .toLowerCase()
    .replace(/message$/, "");
  switch (t) {
    case "conversation":
    case "extendedtext":
    case "text":
    case "buttonsresponse":
    case "listresponse":
    case "templatebuttonreply":
    case "interactiveresponse":
      return "text";
    case "image":
    case "video":
    case "sticker":
    case "reaction":
      return t;
    case "audio":
    case "ptt":
      return "audio";
    case "document":
    case "documentwithcaption":
      return "document";
    case "location":
    case "livelocation":
      return "location";
    default:
      return "unknown";
  }
}

function mapUazapiAck(state: unknown): WaAck | null {
  switch (String(state ?? "").toLowerCase()) {
    case "sent":
    case "serverack":
    case "server":
      return "sent";
    case "delivered":
    case "deliveryack":
      return "delivered";
    case "read":
    case "played":
      return "read";
    case "failed":
    case "error":
      return "failed";
    default:
      return null;
  }
}

const MEDIA: ReadonlySet<WaMessageType> = new Set(["image", "video", "audio", "document", "sticker"]);

function uazapiMessage(m: Obj, instanceId: string): NormalizedMessage | null {
  // O que o Lead Engine envia já está gravado; o eco (se vier mesmo com o filtro) não entra.
  if (m.wasSentByApi === true) return null;
  const id = str(m.messageid) ?? str(m.id)?.split(":").pop() ?? null;
  const chat = str(m.chatid);
  if (!id || !chat) return null;
  if (chat === "status@broadcast" || chat.endsWith("@newsletter") || chat.endsWith("@broadcast")) return null;
  const fromMe = m.fromMe === true;
  const isGroup = m.isGroup === true || chat.endsWith("@g.us");
  let digits = "";
  if (!isGroup) {
    if (chat.endsWith("@s.whatsapp.net")) digits = chat.split("@")[0].replace(/\D/g, "");
    else {
      const pn = str(m.sender_pn);
      if (!fromMe && pn?.endsWith("@s.whatsapp.net")) digits = pn.split("@")[0].replace(/\D/g, "");
    }
  }
  const type = mapUazapiType(m.messageType);
  const content = obj(m.content);
  const text = str(m.text);
  return {
    kind: "message",
    provider: "UAZAPI",
    providerSessionId: instanceId,
    providerMessageId: id,
    chatJid: chat,
    phoneE164: digits ? digitsToE164(digits) : null,
    pushName: fromMe ? null : str(m.senderName)?.slice(0, 80) ?? null,
    fromMe,
    // fromMe sem wasSentByApi = o dono mandou pelo celular.
    sentBy: fromMe ? "USER_PHONE" : "CONTACT",
    type,
    body: text ? text.slice(0, MAX_BODY_CHARS) : null,
    quotedProviderMessageId: str(m.quoted),
    media: MEDIA.has(type)
      ? {
          // Os bytes ficam na uazapi; o inbox pede por /message/download na hora.
          ref: null,
          mime: str(content?.mimetype) ?? str(content?.mimeType),
          filename: str(content?.fileName) ?? str(content?.title),
          caption: null,
        }
      : null,
    timestamp: toMs(m.messageTimestamp),
    isGroup,
    isHistory: false,
  };
}

/** Evento da uazapi → eventos normalizados. Função pura. */
export function normalizeUazapi(payload: unknown, instanceId: string, now = Date.now()): NormalizedEvent[] {
  const p = obj(payload);
  if (!p) return [];
  const type = str(p.EventType);
  if (type === "messages") {
    const m = obj(p.message);
    const n = m ? uazapiMessage(m, instanceId) : null;
    return n ? [n] : [];
  }
  if (type === "messages_update") {
    // Recibo de grupo vem em lote por participante; o status da mensagem não muda com ele.
    if (str(p.type) === "GroupReceipts") return [];
    const e = obj(p.event);
    if (!e || e.IsFromMe === false) return [];
    const ack = mapUazapiAck(p.state ?? e.Type);
    const ids = Array.isArray(e.MessageIDs) ? e.MessageIDs.map(str).filter((x): x is string => Boolean(x)) : [];
    if (!ack || ids.length === 0) return [];
    const at = toMs(e.Timestamp, now);
    return ids.slice(0, 200).map(
      (id): NormalizedAck => ({ kind: "ack", provider: "UAZAPI", providerSessionId: instanceId, providerMessageId: id, ack, timestamp: at })
    );
  }
  if (type === "connection") {
    const instance = obj(p.instance);
    const status = mapUazapiStatus(instance?.status, false, p.type);
    const owner = str(p.owner)?.split("@")[0].replace(/\D/g, "") ?? "";
    const event: NormalizedSessionEvent = {
      kind: "session",
      provider: "UAZAPI",
      providerSessionId: instanceId,
      status,
      qr: null,
      phoneE164: status === "CONNECTED" && owner ? digitsToE164(owner) : null,
      timestamp: now,
    };
    return [event];
  }
  return [];
}

export function uazapiDedupeKey(e: NormalizedEvent, connectionEventId: string | null): string {
  if (e.kind === "message") return `uazapi:${e.providerSessionId}:msg:${e.providerMessageId}`;
  if (e.kind === "ack") return `uazapi:${e.providerSessionId}:ack:${e.providerMessageId}:${e.ack}`;
  return `uazapi:${e.providerSessionId}:conn:${connectionEventId ?? `${e.status}:${e.timestamp}`}`;
}

export interface UazapiWebhookInput {
  headers: Headers;
  rawBody: string;
  ip: string;
  /** WaSession.id da URL. */
  sessionId: string;
  /** Segredo da URL. */
  secret: string;
}

const reply = (status: number, body: Record<string, unknown>): WebhookResponse => ({ status, body });

export async function handleUazapiWebhook(input: UazapiWebhookInput, deps: Omit<WebhookDeps, "metaAppSecrets">): Promise<WebhookResponse> {
  const now = (deps.now ?? Date.now)();
  if (declaredTooLarge(input.headers) || Buffer.byteLength(input.rawBody) > MAX_WA_WEBHOOK_BYTES) {
    return reply(413, { ok: false, error: "Corpo grande demais" });
  }
  const rl = await hitRateLimit(
    "wa-webhook",
    input.ip || "sem-ip",
    WA_WEBHOOK_RATE_LIMIT.limit,
    WA_WEBHOOK_RATE_LIMIT.windowSeconds,
    deps.rateLimitStore
  );
  if (!rl.allowed) return reply(429, { ok: false, error: "Muitas requisições" });

  // Mesma resposta pra sessão desconhecida e segredo errado: não dá pra adivinhar qual errou.
  const denied = reply(401, { ok: false, error: "Origem não confirmada" });
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.sessionId) || !input.secret || input.secret.length > 200) return denied;
  const session = await deps.repo.getSession(input.sessionId);
  const okSecret = sameSecret(input.secret, session?.webhookSecret ?? "sem-segredo");
  if (!session || session.provider !== "UAZAPI" || !session.webhookSecret || !okSecret) return denied;

  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    return reply(400, { ok: false, error: "JSON inválido" });
  }
  const p = obj(payload);
  if (!p) return reply(400, { ok: false, error: "JSON inválido" });
  // Toda entrega da uazapi traz o token da instância: se veio, tem que ser o deste número.
  const bodyToken = str(p.token);
  if (bodyToken !== null && !sameSecret(bodyToken, session.instanceToken ?? "sem-token")) return denied;

  const eventType = str(p.EventType) ?? "desconhecido";
  // Histórico antigo não entra (nem como evento cru).
  if (eventType === "history") return reply(200, { ok: true, ignored: 1 });

  const events = normalizeUazapi(p, session.providerSessionId, now);
  if (events.length === 0) return reply(200, { ok: true, ignored: 1 });

  const counts = { queued: 0, duplicate: 0, ignored: 0 };
  const connectionId = str(p.event_id);
  for (const event of events) {
    const outcome = await enqueueOnce(
      deps as WebhookDeps,
      {
        dedupeKey: uazapiDedupeKey(event, connectionId),
        provider: "UAZAPI",
        eventType: eventType.slice(0, 80),
        sessionId: session.id,
        ownerUserId: session.ownerUserId,
        payload: event,
      },
      event
    );
    counts[outcome] += 1;
  }
  return reply(200, { ok: true, ...counts });
}
