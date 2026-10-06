/**
 * Transforma os webhooks do OpenWA e da Meta num formato só (NormalizedEvent).
 * Funções puras: não leem banco nem rede. Campos estranhos são ignorados, e
 * um evento que não dá pra entender some (não derruba o lote).
 */
import { digitsToE164, jidToDigits } from "@/lib/whatsapp/connector";
import type {
  NormalizedAck,
  NormalizedEvent,
  NormalizedMedia,
  NormalizedMessage,
  NormalizedSessionEvent,
  WaAck,
  WaMessageType,
} from "@/lib/whatsapp/types";
import { mapOpenWAStatus } from "@/lib/whatsapp/openwa";

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : null;
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

const MAX_BODY_CHARS = 8_000;

function clip(text: string | null): string | null {
  return text === null ? null : text.slice(0, MAX_BODY_CHARS);
}

/** segundos ou ms → ms; sem valor → agora. */
export function toMs(value: unknown, fallback = Date.now()): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n) || n <= 0) {
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  }
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

function mapType(type: unknown): WaMessageType {
  switch (type) {
    case "text":
    case "chat":
    case "button":
    case "interactive":
      return "text";
    case "image":
    case "video":
    case "document":
    case "sticker":
    case "location":
    case "reaction":
      return type;
    case "audio":
    case "voice":
    case "ptt":
      return "audio";
    default:
      return "unknown";
  }
}

function mapAck(status: unknown): WaAck | null {
  switch (String(status ?? "").toLowerCase()) {
    case "sent":
    case "server":
      return "sent";
    case "delivered":
    case "device":
      return "delivered";
    case "read":
    case "played":
      return "read";
    case "failed":
    case "error":
      return "failed";
    case "pending":
      return "pending";
    default:
      return null;
  }
}

// ─── OpenWA ──────────────────────────────────────────────────────────────────

export interface OpenWAEnvelope {
  event: string;
  sessionId: string;
  timestamp: number;
  idempotencyKey: string | null;
  deliveryId: string | null;
  data: Obj;
}

export function parseOpenWAEnvelope(payload: unknown): OpenWAEnvelope | null {
  const p = obj(payload);
  if (!p) return null;
  const event = str(p.event);
  const sessionId = str(p.sessionId);
  const data = obj(p.data);
  if (!event || !sessionId || !data) return null;
  return {
    event,
    sessionId,
    timestamp: toMs(p.timestamp, NaN),
    idempotencyKey: str(p.idempotencyKey),
    deliveryId: str(p.deliveryId),
    data,
  };
}

function openwaMessage(env: OpenWAEnvelope): NormalizedMessage | null {
  const d = env.data;
  const id = str(d.id);
  const chatId = str(d.chatId) ?? str(d.fromMe ? d.to : d.from);
  if (!id || !chatId) return null;
  if (d.isStatusBroadcast === true || chatId === "status@broadcast") return null;
  const fromMe = d.fromMe === true;
  const isGroup = d.isGroup === true || chatId.endsWith("@g.us");
  const contact = obj(d.contact);
  const media = obj(d.media);
  const quoted = obj(d.quotedMessage);
  const senderPhone = str(d.senderPhone);
  const digits = isGroup ? "" : senderPhone ? senderPhone.replace(/\D/g, "") : chatId.endsWith("@c.us") ? jidToDigits(chatId) : "";
  const normalizedMedia: NormalizedMedia | null = media
    ? {
        // base64 do OpenWA não vai pra fila (pesado): o worker de mídia busca de novo pelo id.
        ref: null,
        mime: str(media.mimetype),
        filename: str(media.filename),
        caption: null,
      }
    : null;
  return {
    kind: "message",
    provider: "OPENWA",
    providerSessionId: env.sessionId,
    providerMessageId: id,
    chatJid: chatId,
    phoneE164: digits ? digitsToE164(digits) : null,
    pushName: contact ? str(contact.pushName) ?? str(contact.name) : null,
    fromMe,
    // fromMe no OpenWA = o dono mandou (celular ou app). O que o Lead Engine envia
    // já está gravado com o id certo e o upsert não troca o sentBy.
    sentBy: fromMe ? "USER_PHONE" : "CONTACT",
    type: mapType(d.type),
    body: clip(str(d.body)),
    quotedProviderMessageId: quoted ? str(quoted.id) : null,
    media: normalizedMedia,
    timestamp: toMs(d.timestamp, env.timestamp || Date.now()),
    isGroup,
    isHistory: false,
  };
}

export function normalizeOpenWA(payload: unknown): NormalizedEvent[] {
  const env = parseOpenWAEnvelope(payload);
  return env ? normalizeOpenWAEnvelope(env) : [];
}

export function normalizeOpenWAEnvelope(env: OpenWAEnvelope): NormalizedEvent[] {
  const d = env.data;
  switch (env.event) {
    case "message.received":
    case "message.sent": {
      const m = openwaMessage(env);
      return m ? [m] : [];
    }
    case "message.ack": {
      const id = str(d.messageId) ?? str(d.id);
      const ack = mapAck(d.status);
      if (!id || !ack) return [];
      const event: NormalizedAck = {
        kind: "ack",
        provider: "OPENWA",
        providerSessionId: env.sessionId,
        providerMessageId: id,
        ack,
        timestamp: env.timestamp || Date.now(),
      };
      return [event];
    }
    case "session.qr":
    case "session.status":
    case "session.ready":
    case "session.authenticated":
    case "session.disconnected":
    case "session.restriction": {
      // session.status { status: "ready" | "qr_ready" | ... } é o evento real do OpenWA 0.24;
      // "session.ready" fica só por compatibilidade (o gateway não emite).
      const status =
        env.event === "session.qr"
          ? "QR_READY"
          : env.event === "session.restriction"
            ? "RESTRICTED"
            : env.event === "session.disconnected"
              ? "DISCONNECTED"
              : env.event === "session.ready" || env.event === "session.authenticated"
                ? "CONNECTED"
                : mapOpenWAStatus(d.status);
      const phone = str(d.phone);
      const event: NormalizedSessionEvent = {
        kind: "session",
        provider: "OPENWA",
        providerSessionId: env.sessionId,
        status,
        qr: env.event === "session.qr" ? str(d.qr) ?? str(d.qrCode) : null,
        phoneE164: phone ? digitsToE164(phone.replace(/\D/g, "")) : null,
        timestamp: env.timestamp || Date.now(),
      };
      return [event];
    }
    default:
      return [];
  }
}

/** Chave de idempotência de um evento do OpenWA (cabeçalho, corpo ou id da mensagem). */
export function openwaDedupeKey(env: OpenWAEnvelope, headerKey: string | null): string {
  const key = headerKey ?? env.idempotencyKey;
  if (key) return `openwa:${env.sessionId}:${key}`;
  const id = str(env.data.id) ?? str(env.data.messageId) ?? env.deliveryId ?? String(env.timestamp);
  return `openwa:${env.sessionId}:${env.event}:${id}`;
}

// ─── Meta (Cloud API + coexistência) ─────────────────────────────────────────

function metaMessage(
  m: Obj,
  phoneNumberId: string,
  contactsByWaId: Map<string, string>,
  opts: { echo: boolean; history: boolean }
): NormalizedMessage | null {
  const id = str(m.id);
  if (!id) return null;
  // Recebida: from = contato. Eco (smb_message_echoes): from = dono, to = contato.
  const fromMe = opts.echo;
  const counterpart = opts.echo ? str(m.to) : str(m.from) ?? str(m.to);
  if (!counterpart) return null;
  const digits = counterpart.replace(/\D/g, "");
  const type = str(m.type) ?? "unknown";
  const typed = obj(m[type]);
  let body: string | null = null;
  if (type === "text") body = str(obj(m.text)?.body);
  else if (type === "button") body = str(obj(m.button)?.text);
  else if (type === "interactive") {
    const it = obj(m.interactive);
    body = str(obj(it?.button_reply)?.title) ?? str(obj(it?.list_reply)?.title);
  } else if (type === "reaction") body = str(obj(m.reaction)?.emoji);
  else if (typed) body = str(typed.caption);
  const isMedia = ["image", "video", "audio", "document", "sticker"].includes(type);
  return {
    kind: "message",
    provider: "CLOUD_API",
    providerSessionId: phoneNumberId,
    providerMessageId: id,
    chatJid: `${digits}@s.whatsapp.net`,
    phoneE164: digitsToE164(digits),
    pushName: contactsByWaId.get(digits) ?? null,
    fromMe,
    sentBy: fromMe ? "USER_PHONE" : "CONTACT",
    type: mapType(type),
    body: clip(body),
    quotedProviderMessageId: str(obj(m.context)?.id),
    media:
      isMedia && typed
        ? { ref: str(typed.id), mime: str(typed.mime_type), filename: str(typed.filename), caption: str(typed.caption) }
        : null,
    timestamp: toMs(m.timestamp),
    isGroup: false,
    isHistory: opts.history,
  };
}

/**
 * entry[].changes[] da Meta. Campos tratados: messages (recebidas + status),
 * smb_message_echoes (enviadas pelo celular), history (sincronização).
 */
export function normalizeMeta(payload: unknown): NormalizedEvent[] {
  const p = obj(payload);
  if (!p || p.object !== "whatsapp_business_account" || !Array.isArray(p.entry)) return [];
  const out: NormalizedEvent[] = [];
  for (const entryRaw of p.entry) {
    const entry = obj(entryRaw);
    if (!entry || !Array.isArray(entry.changes)) continue;
    for (const changeRaw of entry.changes) {
      const change = obj(changeRaw);
      const value = obj(change?.value);
      const field = str(change?.field);
      if (!value || !field) continue;
      const phoneNumberId = str(obj(value.metadata)?.phone_number_id);
      if (!phoneNumberId) continue;
      const contacts = new Map<string, string>();
      if (Array.isArray(value.contacts)) {
        for (const c of value.contacts) {
          const co = obj(c);
          const waId = str(co?.wa_id);
          const name = str(obj(co?.profile)?.name);
          if (waId && name) contacts.set(waId.replace(/\D/g, ""), name);
        }
      }
      if (field === "messages") {
        for (const m of Array.isArray(value.messages) ? value.messages : []) {
          const mo = obj(m);
          const n = mo && metaMessage(mo, phoneNumberId, contacts, { echo: false, history: false });
          if (n) out.push(n);
        }
        for (const s of Array.isArray(value.statuses) ? value.statuses : []) {
          const so = obj(s);
          const id = str(so?.id);
          const ack = mapAck(so?.status);
          if (!id || !ack) continue;
          out.push({
            kind: "ack",
            provider: "CLOUD_API",
            providerSessionId: phoneNumberId,
            providerMessageId: id,
            ack,
            timestamp: toMs(so?.timestamp),
          });
        }
      } else if (field === "smb_message_echoes") {
        for (const m of Array.isArray(value.message_echoes) ? value.message_echoes : []) {
          const mo = obj(m);
          const n = mo && metaMessage(mo, phoneNumberId, contacts, { echo: true, history: false });
          if (n) out.push(n);
        }
      } else if (field === "history") {
        for (const h of Array.isArray(value.history) ? value.history : []) {
          for (const t of Array.isArray(obj(h)?.threads) ? (obj(h)!.threads as unknown[]) : []) {
            for (const m of Array.isArray(obj(t)?.messages) ? (obj(t)!.messages as unknown[]) : []) {
              const mo = obj(m);
              if (!mo) continue;
              // No histórico, mensagem do dono vem com from = número do negócio.
              const ownPhone = str(obj(value.metadata)?.display_phone_number)?.replace(/\D/g, "");
              const echo = Boolean(ownPhone && str(mo.from)?.replace(/\D/g, "") === ownPhone);
              const n = metaMessage(mo, phoneNumberId, contacts, { echo, history: true });
              if (n) out.push(n);
            }
          }
        }
      }
    }
  }
  return out;
}

/** Uma chave por evento: a Meta reentrega o mesmo wamid/status em retentativa. */
export function metaDedupeKey(e: NormalizedEvent): string {
  if (e.kind === "message") return `meta:${e.providerSessionId}:msg:${e.providerMessageId}`;
  if (e.kind === "ack") return `meta:${e.providerSessionId}:ack:${e.providerMessageId}:${e.ack}`;
  return `meta:${e.providerSessionId}:session:${e.status}:${e.timestamp}`;
}
