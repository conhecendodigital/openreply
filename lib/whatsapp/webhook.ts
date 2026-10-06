/**
 * Núcleo do POST /api/whatsapp/webhook (a rota só faz a ponte com o Next).
 *
 * Recebe dos dois conectores:
 *   OpenWA: X-OpenWA-Signature = HMAC do corpo com o segredo DAQUELE número
 *           (WaSession.webhookSecretEnc). O corpo assinado traz sessionId,
 *           timestamp e idempotencyKey, que usamos contra replay.
 *   Meta:   X-Hub-Signature-256 = HMAC do corpo com o segredo do app.
 *
 * Ordem: tamanho → limite por IP → assinatura → janela de tempo (OpenWA) →
 * idempotência (WaWebhookEvent.dedupeKey) → normaliza → fila wa-ingest → 200.
 * Assinatura errada responde 401 e não grava nada.
 */
import { hitRateLimit } from "@/lib/http-rate-limit";
import { metaDedupeKey, normalizeMeta, normalizeOpenWAEnvelope, openwaDedupeKey, parseOpenWAEnvelope } from "@/lib/whatsapp/normalize";
import type { WaQueuePort } from "@/lib/whatsapp/queue";
import type { WaRepository } from "@/lib/whatsapp/repository";
import { verifyAnySecret, verifyHmacSignature } from "@/lib/whatsapp/signature";
import type { WaProvider } from "@/lib/whatsapp/types";

/** Payload de WhatsApp é pequeno; histórico da coexistência vem em lotes, por isso folga. */
export const MAX_WA_WEBHOOK_BYTES = 2 * 1024 * 1024;
/** Evento do OpenWA mais velho que isso é recusado (o OpenWA reentrega em minutos). */
export const OPENWA_MAX_EVENT_AGE_MS = 6 * 60 * 60 * 1000;
/** Relógio do gateway adiantado tolerado. */
export const OPENWA_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
/** Requisições por IP por minuto. */
export const WA_WEBHOOK_RATE_LIMIT = { limit: 600, windowSeconds: 60 };

type CounterStore = Parameters<typeof hitRateLimit>[4];

export interface WebhookDeps {
  repo: WaRepository;
  queue: WaQueuePort;
  /** Segredos do app Meta (WHATSAPP_APP_SECRET, FACEBOOK_APP_SECRET). */
  metaAppSecrets: Array<string | undefined>;
  now?: () => number;
  /** Contador do limite por IP (Redis em produção; falso nos testes). */
  rateLimitStore?: CounterStore;
}

export interface WebhookInput {
  headers: Headers;
  rawBody: string;
  ip: string;
}

export interface WebhookResponse {
  status: number;
  body: Record<string, unknown>;
}

const reply = (status: number, body: Record<string, unknown>): WebhookResponse => ({ status, body });

export function declaredTooLarge(headers: Headers): boolean {
  const declared = Number(headers.get("content-length") ?? "0");
  return Number.isFinite(declared) && declared > MAX_WA_WEBHOOK_BYTES;
}

export async function enqueueOnce(
  deps: WebhookDeps,
  item: { dedupeKey: string; provider: WaProvider; eventType: string; sessionId: string; ownerUserId: string; payload: unknown },
  event: Parameters<WaQueuePort["addIngest"]>[0]["event"] | null
): Promise<"queued" | "duplicate" | "ignored"> {
  const recorded = await deps.repo.recordWebhookEvent(item);
  if (recorded.result === "duplicate" && recorded.queued) return "duplicate";
  if (!event) {
    await deps.repo.markWebhookEventQueued(item.dedupeKey);
    return "ignored";
  }
  // Se a fila falhar, o erro sobe (500) e o provedor reentrega; o evento gravado
  // sem "queued" é enfileirado nessa nova tentativa. O jobId fixo evita job duplo.
  await deps.queue.addIngest({ dedupeKey: item.dedupeKey, sessionId: item.sessionId, ownerUserId: item.ownerUserId, event });
  await deps.repo.markWebhookEventQueued(item.dedupeKey);
  return recorded.result === "duplicate" ? "duplicate" : "queued";
}

/** Lê o corpo até `max` bytes. Passou disso: cancela a leitura e devolve null. */
export async function readBodyLimited(body: ReadableStream<Uint8Array> | null, max: number): Promise<string | null> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function handleOpenWA(input: WebhookInput, deps: WebhookDeps, now: number): Promise<WebhookResponse> {
  const signature = input.headers.get("x-openwa-signature");
  const parsed = parseJson(input.rawBody);
  const env = parseOpenWAEnvelope(parsed);
  if (!env) return reply(401, { ok: false, error: "Assinatura inválida" });

  // O sessionId só serve pra achar o segredo; nada é gravado antes de conferir.
  const session = await deps.repo.findSessionByProvider("OPENWA", env.sessionId);
  if (!session || !verifyHmacSignature(input.rawBody, signature, session.webhookSecret)) {
    return reply(401, { ok: false, error: "Assinatura inválida" });
  }
  // Replay: o timestamp está dentro do corpo assinado.
  if (!Number.isFinite(env.timestamp) || now - env.timestamp > OPENWA_MAX_EVENT_AGE_MS || env.timestamp - now > OPENWA_MAX_CLOCK_SKEW_MS) {
    return reply(401, { ok: false, error: "Evento fora da janela de tempo" });
  }
  // Só a chave de dentro do corpo (assinada); o cabeçalho pode ser trocado por quem reenviar.
  const dedupeKey = openwaDedupeKey(env, null);
  const events = normalizeOpenWAEnvelope(env);
  const outcome = await enqueueOnce(
    deps,
    { dedupeKey, provider: "OPENWA", eventType: env.event, sessionId: session.id, ownerUserId: session.ownerUserId, payload: parsed },
    events[0] ?? null
  );
  return reply(200, { ok: true, [outcome]: 1 });
}

async function handleMeta(input: WebhookInput, deps: WebhookDeps): Promise<WebhookResponse> {
  const signature = input.headers.get("x-hub-signature-256");
  const secrets = deps.metaAppSecrets.filter((s): s is string => Boolean(s));
  if (secrets.length === 0) return reply(503, { ok: false, error: "WhatsApp Cloud API não configurada" });
  if (!verifyAnySecret(input.rawBody, signature, secrets)) {
    return reply(401, { ok: false, error: "Assinatura inválida" });
  }
  const payload = parseJson(input.rawBody);
  if (payload === undefined) return reply(400, { ok: false, error: "JSON inválido" });

  const counts = { queued: 0, duplicate: 0, ignored: 0, unknownNumber: 0 };
  const sessions = new Map<string, Awaited<ReturnType<WaRepository["findSessionByProvider"]>>>();
  for (const event of normalizeMeta(payload)) {
    if (!sessions.has(event.providerSessionId)) {
      sessions.set(event.providerSessionId, await deps.repo.findSessionByProvider("CLOUD_API", event.providerSessionId));
    }
    const session = sessions.get(event.providerSessionId);
    if (!session) {
      counts.unknownNumber += 1;
      continue;
    }
    const outcome = await enqueueOnce(
      deps,
      {
        dedupeKey: metaDedupeKey(event),
        provider: "CLOUD_API",
        eventType: event.kind,
        sessionId: session.id,
        ownerUserId: session.ownerUserId,
        payload: event,
      },
      event
    );
    counts[outcome] += 1;
  }
  // 200 sempre que a assinatura bate: a Meta não deve reentregar o que não é nosso.
  return reply(200, { ok: true, ...counts });
}

export async function handleWhatsAppWebhook(input: WebhookInput, deps: WebhookDeps): Promise<WebhookResponse> {
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

  if (input.headers.has("x-openwa-signature")) return handleOpenWA(input, deps, now);
  if (input.headers.has("x-hub-signature-256")) return handleMeta(input, deps);
  return reply(401, { ok: false, error: "Assinatura ausente" });
}

