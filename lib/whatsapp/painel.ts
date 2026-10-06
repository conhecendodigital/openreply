/**
 * O que as telas do WhatsApp (Conexões, Conversas, Agentes) leem e gravam.
 * Só no servidor. Toda leitura e gravação passa por withRls com a pessoa
 * logada e o workspace ativo: a RLS da Fase 0 confere de novo no banco.
 *
 * Regras do dono:
 * - Desconectar NUNCA apaga conversa, contato nem configuração. Só faz logout
 *   no gateway e marca o número como desconectado. Não existe "apagar número".
 * - IA e chave de API nunca ligam nada sozinhas: os agentes nascem desligados e
 *   só a pessoa liga, nesta tela.
 * - O navegador nunca fala com o gateway: só este código, com a chave do servidor.
 */
import { randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@/app/generated/prisma/client";
import { getPrisma } from "@/lib/db/client";
import { getAppPrisma, withRls, withSystemRole, type RlsContext } from "@/lib/db/rls";
import { encryptToken } from "@/lib/meta/oauth";
import { aprovarRascunho, rejeitarRascunho } from "@/lib/whatsapp/agentes/motor";
import { assumirConversa, devolverAoAgente, janelaAberta, JANELA_MS } from "@/lib/whatsapp/agentes/modo";
import { storeFor } from "@/lib/whatsapp/agentes/worker";
import { AGENTES, type AgenteTipo } from "@/lib/whatsapp/agentes/types";
import { enqueuePlanned, humanReplyPlan } from "@/lib/whatsapp/outbound";
import { OpenWAConnector } from "@/lib/whatsapp/openwa";
import { WhatsAppConnectorError } from "@/lib/whatsapp/connector";
import type { WaQueuePort } from "@/lib/whatsapp/queue";
import type { WaRepository } from "@/lib/whatsapp/repository";
import { IntegrationReadError, resolveOpenwa } from "@/lib/integrations/credentials";
import { webhookUrl, whatsappStatusFor } from "@/lib/whatsapp/setup";
import {
  createUazapiSession,
  disconnectUazapi,
  reconnectUazapi,
  refreshUazapi,
  uazapiConnectorFor,
} from "@/lib/whatsapp/painel-uazapi";
import type { WaProvider, WaStatus } from "@/lib/whatsapp/types";

type Tx = Parameters<Parameters<typeof withRls>[1]>[0];

export type PainelDeps = {
  repo: WaRepository;
  queue: WaQueuePort;
  /** Tira da fila um envio do agente que ainda não começou (BullMQ). */
  removePendingSend?: (outboxId: string) => Promise<boolean>;
  app?: PrismaClient;
  system?: PrismaClient;
  env?: Record<string, string | undefined>;
  /** Troca o cliente do gateway (testes). */
  connectorFor?: (providerSessionId: string, riskAcceptedAt: Date | null) => GatewayClient;
  createGatewaySession?: (name: string) => Promise<{ providerSessionId: string; status: WaStatus }>;
};

/** O pedaço do OpenWAConnector que o painel usa. */
export type GatewayClient = Pick<
  OpenWAConnector,
  "connect" | "getQr" | "getInfo" | "disconnect" | "ensureWebhook" | "markRead" | "fetchMedia"
>;

export class PainelError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export function rls<T>(ctx: RlsContext, deps: PainelDeps, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withRls(ctx, fn, deps.app ?? getAppPrisma());
}

/** Chaves salvas em Canais não abriram (banco fora): erro claro, nunca cai pro ambiente às cegas. */
export function credentialsReadError(): PainelError {
  return new PainelError("keys_unreadable", "Could not read the keys saved in Channels. Try again in a minute.", 503);
}

/** Gateway OpenWA do workspace: Canais > OPENWA_* do ambiente. */
async function gatewayCreds(deps: PainelDeps, workspaceId: string | null | undefined) {
  let creds: Awaited<ReturnType<typeof resolveOpenwa>>;
  try {
    creds = await resolveOpenwa(workspaceId, { env: deps.env ?? process.env, system: deps.system });
  } catch (error) {
    if (error instanceof IntegrationReadError) throw credentialsReadError();
    throw error;
  }
  if (!creds) {
    throw new PainelError("gateway_off", "The WhatsApp gateway is not configured yet. Add the URL and the key in Channels, Connections and keys.", 503);
  }
  return { baseUrl: creds.baseUrl, apiKey: creds.apiKey };
}

async function connectorFor(
  deps: PainelDeps,
  workspaceId: string | null | undefined,
  providerSessionId: string,
  riskAcceptedAt: Date | null
): Promise<GatewayClient> {
  if (deps.connectorFor) return deps.connectorFor(providerSessionId, riskAcceptedAt);
  const creds = await gatewayCreds(deps, workspaceId);
  return new OpenWAConnector({ ...creds, sessionId: providerSessionId, riskAcceptedAt });
}

function gatewayMessage(error: unknown): PainelError {
  if (error instanceof PainelError) return error;
  if (error instanceof WhatsAppConnectorError && error.status === 401) {
    return new PainelError("gateway_auth", "The gateway refused the key. Check it in Channels, Connections and keys.", 502);
  }
  return new PainelError("gateway_error", "The WhatsApp gateway did not answer. Try again in a minute.", 502);
}

// ─── Números (Conexões) ──────────────────────────────────────────────────────

export type SessionView = {
  id: string;
  provider: WaProvider;
  /** uazapi: região do proxy (a conexão sai por um IP dessa cidade). */
  proxy: { country: string; city: string; label: string | null } | null;
  status: WaStatus;
  phoneE164: string | null;
  displayName: string | null;
  connectedAt: string | null;
  lastEventAt: string | null;
  riskAcceptedAt: string | null;
  agentMode: string;
  conversationCount: number;
  messageCount: number;
  createdAt: string;
};

export const SESSION_VIEW_SELECT = {
  id: true,
  provider: true,
  status: true,
  phoneE164: true,
  displayName: true,
  connectedAt: true,
  lastEventAt: true,
  riskAcceptedAt: true,
  agentMode: true,
  conversationCount: true,
  messageCount: true,
  createdAt: true,
  providerSessionId: true,
  proxyCountry: true,
  proxyCity: true,
  proxyCityLabel: true,
} as const;

export type SessionRow = {
  id: string;
  provider: WaProvider;
  status: WaStatus;
  phoneE164: string | null;
  displayName: string | null;
  connectedAt: Date | null;
  lastEventAt: Date | null;
  riskAcceptedAt: Date | null;
  agentMode: string;
  conversationCount: number;
  messageCount: number;
  createdAt: Date;
  providerSessionId: string;
  proxyCountry: string | null;
  proxyCity: string | null;
  proxyCityLabel: string | null;
};

export function toSessionView(r: SessionRow): SessionView {
  return {
    id: r.id,
    provider: r.provider,
    proxy: r.proxyCountry && r.proxyCity ? { country: r.proxyCountry, city: r.proxyCity, label: r.proxyCityLabel } : null,
    status: r.status,
    phoneE164: r.phoneE164,
    displayName: r.displayName,
    connectedAt: r.connectedAt?.toISOString() ?? null,
    lastEventAt: r.lastEventAt?.toISOString() ?? null,
    riskAcceptedAt: r.riskAcceptedAt?.toISOString() ?? null,
    agentMode: r.agentMode,
    conversationCount: r.conversationCount,
    messageCount: r.messageCount,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listSessions(ctx: RlsContext, deps: PainelDeps): Promise<SessionView[]> {
  const rows = await rls(ctx, deps, (tx) =>
    tx.waSession.findMany({ where: { workspaceId: ctx.workspaceId ?? "" }, select: SESSION_VIEW_SELECT, orderBy: { createdAt: "asc" } })
  );
  return rows.map(toSessionView);
}

export async function loadSession(ctx: RlsContext, deps: PainelDeps, sessionId: string): Promise<SessionRow & { riskAcceptedAt: Date | null }> {
  const row = await rls(ctx, deps, (tx) =>
    tx.waSession.findFirst({ where: { id: sessionId, workspaceId: ctx.workspaceId ?? "" }, select: SESSION_VIEW_SELECT })
  );
  if (!row) throw new PainelError("not_found", "Number not found.", 404);
  return row;
}

/** Status do servidor pra tela (ligado, gateway, IA do /admin). Nunca devolve chave. */
export async function serverStatus(deps: PainelDeps, workspaceId?: string | null) {
  const base = await whatsappStatusFor(workspaceId, { env: deps.env ?? process.env, system: deps.system });
  let ai = { anthropic: false, openai: false };
  try {
    const rows = await withSystemRole(
      (tx) => tx.platformAiCredential.findMany({ where: { active: true }, select: { provider: true } }),
      deps.system ?? getPrisma()
    );
    ai = { anthropic: rows.some((r) => r.provider === "anthropic"), openai: rows.some((r) => r.provider === "openai") };
  } catch {
    // Sem a tabela ou sem permissão: a tela só avisa que falta a chave.
  }
  return { ...base, webhookReady: Boolean(webhookUrl(deps.env ?? process.env)), ai };
}

/**
 * Conectar um número novo pelo QR (gateway OpenWA). Só depois do termo de
 * risco aceito na tela. Cria a sessão no gateway, guarda o segredo do webhook
 * cifrado, registra o webhook e pede o QR.
 */
export async function createSession(
  ctx: RlsContext & { workspaceId: string },
  input: { acceptRisk: unknown; displayName?: unknown; provider?: unknown; method?: unknown; phone?: unknown; proxy?: unknown },
  deps: PainelDeps
): Promise<{ session: SessionView; qr: string | null; pairCode?: string | null; proxyWarning?: boolean }> {
  // Provedor por número: uazapi (proxy com IP do Brasil) ou OpenWA (padrão, como sempre foi).
  if (input.provider === "UAZAPI") return createUazapiSession(ctx, input, deps);
  if (input.acceptRisk !== true) {
    throw new PainelError("risk_not_accepted", "Read and accept the risk notice before connecting a number.", 400);
  }
  const env = deps.env ?? process.env;
  if (env.WHATSAPP_ENABLED !== "1") throw new PainelError("whatsapp_off", "WhatsApp is not turned on on the server yet.", 503);
  const hook = webhookUrl(env);
  if (!hook) throw new PainelError("no_webhook_url", "The server has no public https address for the webhook yet.", 503);
  const creds = await gatewayCreds(deps, ctx.workspaceId);
  const existing = await rls(ctx, deps, (tx) => tx.waSession.count({ where: { workspaceId: ctx.workspaceId } }));
  if (existing >= 5) throw new PainelError("too_many", "This workspace already has 5 numbers.", 409);

  const displayName = typeof input.displayName === "string" ? input.displayName.trim().slice(0, 60) || null : null;
  const name = `le-${ctx.workspaceId.slice(-10)}-${randomBytes(4).toString("hex")}`;
  let created: { providerSessionId: string; status: WaStatus };
  try {
    created = deps.createGatewaySession
      ? await deps.createGatewaySession(name)
      : await OpenWAConnector.createSession({ baseUrl: creds.baseUrl, apiKey: creds.apiKey }, name);
  } catch (error) {
    throw gatewayMessage(error);
  }
  // Segredo forte por número (o OpenWA assina cada evento com ele). Só cifrado no banco.
  const secret = randomBytes(32).toString("base64url");
  const riskAcceptedAt = new Date();
  const row = await rls(ctx, deps, (tx) =>
    tx.waSession.create({
      data: {
        workspaceId: ctx.workspaceId,
        ownerUserId: ctx.userId,
        provider: "OPENWA",
        providerSessionId: created.providerSessionId,
        displayName,
        status: "PENDING",
        webhookSecretEnc: encryptToken(secret),
        riskAcceptedAt,
      },
      select: SESSION_VIEW_SELECT,
    })
  );
  const connector = await connectorFor(deps, ctx.workspaceId, created.providerSessionId, riskAcceptedAt);
  try {
    await connector.ensureWebhook(hook, secret);
    const started = await connector.connect();
    const updated = await saveStatus(ctx, deps, row.id, started.status, null, null);
    return { session: updated, qr: started.qr };
  } catch (error) {
    // O número fica salvo (sem nada apagado); a tela oferece "Tentar de novo".
    throw gatewayMessage(error);
  }
}

export async function saveStatus(
  ctx: RlsContext,
  deps: PainelDeps,
  sessionId: string,
  status: WaStatus,
  phoneE164: string | null,
  pushName: string | null
): Promise<SessionView> {
  const now = new Date();
  const row = await rls(ctx, deps, async (tx) => {
    const current = await tx.waSession.findFirst({ where: { id: sessionId, workspaceId: ctx.workspaceId ?? "" }, select: { status: true, displayName: true } });
    if (!current) throw new PainelError("not_found", "Number not found.", 404);
    return tx.waSession.update({
      where: { id: sessionId },
      data: {
        status,
        lastEventAt: now,
        ...(phoneE164 ? { phoneE164 } : {}),
        ...(pushName && !current.displayName ? { displayName: pushName } : {}),
        ...(status === "CONNECTED" && current.status !== "CONNECTED" ? { connectedAt: now } : {}),
      },
      select: SESSION_VIEW_SELECT,
    });
  });
  return toSessionView(row);
}

/**
 * QR e status atuais, direto do gateway (a tela chama a cada poucos segundos
 * enquanto não conecta). Também atualiza o banco.
 */
export async function refreshSession(
  ctx: RlsContext,
  sessionId: string,
  deps: PainelDeps
): Promise<{ session: SessionView; qr: string | null; pairCode?: string | null }> {
  const row = await loadSession(ctx, deps, sessionId);
  if (row.provider === "UAZAPI") return refreshUazapi(ctx, sessionId, deps);
  if (row.provider !== "OPENWA") return { session: toSessionView(row), qr: null };
  try {
    const connector = await connectorFor(deps, ctx.workspaceId, row.providerSessionId, row.riskAcceptedAt);
    const info = await connector.getInfo();
    const qr = info.status === "QR_READY" || info.status === "PENDING" ? await connector.getQr() : null;
    const status = qr && info.status === "PENDING" ? "QR_READY" : info.status;
    const session = await saveStatus(ctx, deps, sessionId, status, info.phoneE164, info.pushName);
    return { session, qr };
  } catch (error) {
    throw gatewayMessage(error);
  }
}

/** Reconectar um número que caiu (gera QR de novo). Não muda nada das conversas. */
export async function reconnectSession(
  ctx: RlsContext,
  sessionId: string,
  deps: PainelDeps,
  input: { method?: unknown; phone?: unknown } = {}
): Promise<{ session: SessionView; qr: string | null; pairCode?: string | null; proxyWarning?: boolean }> {
  const row = await loadSession(ctx, deps, sessionId);
  if (row.provider === "UAZAPI") return reconnectUazapi(ctx, sessionId, input, deps);
  if (row.provider !== "OPENWA") throw new PainelError("not_supported", "Only numbers connected by QR code can reconnect here.", 400);
  try {
    const connector = await connectorFor(deps, ctx.workspaceId, row.providerSessionId, row.riskAcceptedAt);
    const hook = webhookUrl(deps.env ?? process.env);
    const secretRow = await rls(ctx, deps, (tx) => tx.waSession.findFirst({ where: { id: sessionId }, select: { webhookSecretEnc: true } }));
    if (hook && secretRow?.webhookSecretEnc) {
      const { decryptToken } = await import("@/lib/meta/oauth");
      await connector.ensureWebhook(hook, decryptToken(secretRow.webhookSecretEnc));
    }
    const started = await connector.connect();
    const session = await saveStatus(ctx, deps, sessionId, started.status, null, null);
    return { session, qr: started.qr };
  } catch (error) {
    throw gatewayMessage(error);
  }
}

/**
 * Desconectar: logout no gateway e status DISCONNECTED. Conversas, contatos,
 * mensagens, etiquetas, agentes e PDFs ficam todos onde estão. Se o gateway não
 * responder, o número fica marcado como desconectado do mesmo jeito (nada
 * mais sai por ele) e a tela avisa.
 */
export async function disconnectSession(ctx: RlsContext, sessionId: string, deps: PainelDeps): Promise<{ session: SessionView; gatewayOk: boolean }> {
  const row = await loadSession(ctx, deps, sessionId);
  let gatewayOk = true;
  if (row.provider === "OPENWA") {
    try {
      await (await connectorFor(deps, ctx.workspaceId, row.providerSessionId, row.riskAcceptedAt)).disconnect();
    } catch {
      gatewayOk = false;
    }
  } else if (row.provider === "UAZAPI") {
    gatewayOk = await disconnectUazapi(ctx, sessionId, deps);
  }
  const session = await saveStatus(ctx, deps, sessionId, "DISCONNECTED", null, null);
  return { session, gatewayOk };
}

// ─── Conversas ───────────────────────────────────────────────────────────────

export type ConversationItem = {
  id: string;
  sessionId: string;
  contact: { id: string; name: string | null; pushName: string | null; phoneE164: string | null; isGroup: boolean };
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  hasDraft: boolean;
  paused: boolean;
};

export async function listConversations(
  ctx: RlsContext,
  query: { q?: string | null; filter?: string | null; sessionId?: string | null; limit?: number },
  deps: PainelDeps
): Promise<ConversationItem[]> {
  const ws = ctx.workspaceId ?? "";
  const q = (query.q ?? "").trim().slice(0, 80);
  const now = new Date();
  return rls(ctx, deps, async (tx) => {
    const rows = await tx.waConversation.findMany({
      where: {
        workspaceId: ws,
        archivedAt: null,
        ...(query.sessionId ? { sessionId: query.sessionId } : {}),
        ...(query.filter === "unread" ? { unreadCount: { gt: 0 } } : {}),
        ...(q
          ? {
              OR: [
                { contact: { name: { contains: q, mode: "insensitive" } } },
                { contact: { pushName: { contains: q, mode: "insensitive" } } },
                { contact: { phoneE164: { contains: q.replace(/[^\d+]/g, "") || q } } },
                { messages: { some: { body: { contains: q, mode: "insensitive" } } } },
              ],
            }
          : {}),
      },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }],
      take: Math.min(200, Math.max(1, query.limit ?? 100)),
      include: { contact: { select: { id: true, name: true, pushName: true, phoneE164: true, isGroup: true } } },
    });
    const ids = rows.map((r) => r.id);
    const drafts = ids.length
      ? await tx.waAgentRun.findMany({ where: { conversationId: { in: ids }, status: "draft" }, select: { conversationId: true } })
      : [];
    const withDraft = new Set(drafts.map((d) => d.conversationId));
    if (query.filter === "drafts") {
      return rows.filter((r) => withDraft.has(r.id)).map((r) => toItem(r, withDraft, now));
    }
    return rows.map((r) => toItem(r, withDraft, now));
  });
}

function toItem(
  r: {
    id: string;
    sessionId: string;
    lastMessageAt: Date | null;
    lastMessagePreview: string | null;
    unreadCount: number;
    humanTakeoverUntil: Date | null;
    contact: { id: string; name: string | null; pushName: string | null; phoneE164: string | null; isGroup: boolean };
  },
  withDraft: Set<string>,
  now: Date
): ConversationItem {
  return {
    id: r.id,
    sessionId: r.sessionId,
    contact: r.contact,
    lastMessageAt: r.lastMessageAt?.toISOString() ?? null,
    lastMessagePreview: r.lastMessagePreview,
    unreadCount: r.unreadCount,
    hasDraft: withDraft.has(r.id),
    paused: Boolean(r.humanTakeoverUntil && r.humanTakeoverUntil > now),
  };
}

export type MessageView = {
  id: string;
  fromMe: boolean;
  sentBy: string;
  type: string;
  body: string | null;
  ack: string;
  sentAt: string;
  media: { mime: string | null; filename: string | null } | null;
  revoked: boolean;
};

export type DraftView = { runId: string; bubbles: string[]; alert: string | null; agente: string | null; createdAt: string };

export type ThreadView = {
  conversation: ConversationItem & { agentMode: string; humanTakeoverUntil: string | null };
  session: { id: string; status: WaStatus; phoneE164: string | null; displayName: string | null; agentMode: string };
  messages: MessageView[];
  window: { open: boolean; closesAt: string | null };
  draft: DraftView | null;
};

const MEDIA_TYPES = new Set(["image", "video", "audio", "document", "sticker"]);

export async function getThread(ctx: RlsContext, conversationId: string, deps: PainelDeps, now = new Date()): Promise<ThreadView> {
  return rls(ctx, deps, async (tx) => {
    const c = await tx.waConversation.findFirst({
      where: { id: conversationId, workspaceId: ctx.workspaceId ?? "" },
      include: {
        contact: { select: { id: true, name: true, pushName: true, phoneE164: true, isGroup: true } },
        session: { select: { id: true, status: true, phoneE164: true, displayName: true, agentMode: true } },
      },
    });
    if (!c) throw new PainelError("not_found", "Conversation not found.", 404);
    const [rows, lastInbound, draft] = await Promise.all([
      tx.waMessage.findMany({ where: { conversationId }, orderBy: { sentAt: "desc" }, take: 200 }),
      tx.waMessage.findFirst({ where: { conversationId, sentBy: "CONTACT", fromMe: false }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
      tx.waAgentRun.findFirst({ where: { conversationId, status: "draft" }, orderBy: { createdAt: "desc" } }),
    ]);
    const bubbles =
      draft?.output && typeof draft.output === "object" && Array.isArray((draft.output as { bolhas?: unknown }).bolhas)
        ? ((draft.output as { bolhas: unknown[] }).bolhas.map(String) as string[])
        : [];
    return {
      conversation: {
        ...toItem(c, new Set(draft ? [c.id] : []), now),
        agentMode: c.agentMode,
        humanTakeoverUntil: c.humanTakeoverUntil?.toISOString() ?? null,
      },
      session: c.session,
      messages: rows.reverse().map((m) => ({
        id: m.id,
        fromMe: m.fromMe,
        sentBy: m.sentBy,
        type: m.type,
        body: m.body,
        ack: m.ack,
        sentAt: m.sentAt.toISOString(),
        media: MEDIA_TYPES.has(m.type) ? { mime: m.mediaMime, filename: m.mediaFilename } : null,
        revoked: Boolean(m.revokedAt),
      })),
      window: {
        open: janelaAberta(lastInbound?.sentAt ?? null, now),
        closesAt: lastInbound ? new Date(lastInbound.sentAt.getTime() + JANELA_MS).toISOString() : null,
      },
      draft: draft && bubbles.length ? { runId: draft.id, bubbles, alert: draft.blockedReason, agente: draft.agente, createdAt: draft.createdAt.toISOString() } : null,
    };
  });
}

/** O que impede (ou não) uma resposta humana sair. Texto em inglês: a tela traduz. */
const BLOCK_MESSAGES: Record<string, string> = {
  fora_da_janela_24h: "24 hours passed since the contact's last message. Now only they can restart the conversation.",
  sem_mensagem_do_contato: "This contact has not written to you yet, so WhatsApp does not let you start the conversation here.",
  humano_assumiu: "This conversation is paused.",
  sessao_desconectada: "This number is disconnected. Reconnect it in Connections.",
};

/**
 * Resposta humana pelo inbox (sentBy USER_APP). Uma mensagem só, espera curta.
 * Como você respondeu, o agente pausa nessa conversa (igual ao Instagram).
 */
export async function sendReply(
  ctx: RlsContext,
  conversationId: string,
  input: { text: unknown },
  deps: PainelDeps
): Promise<{ queued: true; pausedUntil: string }> {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) throw new PainelError("empty", "Write a message first.", 400);
  if (text.length > 4000) throw new PainelError("too_long", "The message is too long (4000 characters at most).", 400);
  const c = await rls(ctx, deps, (tx) =>
    tx.waConversation.findFirst({
      where: { id: conversationId, workspaceId: ctx.workspaceId ?? "" },
      select: { id: true, sessionId: true, session: { select: { ownerUserId: true, status: true } } },
    })
  );
  if (!c) throw new PainelError("not_found", "Conversation not found.", 404);
  if (c.session.status !== "CONNECTED") throw new PainelError("sessao_desconectada", BLOCK_MESSAGES.sessao_desconectada, 409);
  const result = await enqueuePlanned(
    { ownerUserId: c.session.ownerUserId, sessionId: c.sessionId, conversationId, sentBy: "USER_APP", content: { type: "text", text } },
    humanReplyPlan(text),
    { repo: deps.repo, queue: deps.queue }
  );
  if (result.status === "blocked") {
    throw new PainelError(result.reason, BLOCK_MESSAGES[result.reason] ?? "This message could not be sent.", 409);
  }
  const store = storeFor(c.session.ownerUserId, ctx.workspaceId ?? "", deps);
  const paused = await assumirConversa(store, conversationId, { motivo: "você respondeu pelo inbox" });
  return { queued: true, pausedUntil: paused.ate.toISOString() };
}

export async function markRead(ctx: RlsContext, conversationId: string, deps: PainelDeps): Promise<void> {
  const c = await rls(ctx, deps, async (tx) => {
    const row = await tx.waConversation.findFirst({
      where: { id: conversationId, workspaceId: ctx.workspaceId ?? "" },
      select: { id: true, unreadCount: true, contact: { select: { jid: true } }, session: { select: { id: true, provider: true, providerSessionId: true, status: true, riskAcceptedAt: true } } },
    });
    if (!row) throw new PainelError("not_found", "Conversation not found.", 404);
    if (row.unreadCount > 0) await tx.waConversation.update({ where: { id: conversationId }, data: { unreadCount: 0 } });
    return row;
  });
  // "Lida" no celular do contato: cosmético, nunca trava a tela.
  if (c.unreadCount > 0 && c.session.provider === "OPENWA" && c.session.status === "CONNECTED") {
    try {
      await (await connectorFor(deps, ctx.workspaceId, c.session.providerSessionId, c.session.riskAcceptedAt)).markRead(c.contact.jid, []);
    } catch {
      // ignora
    }
  } else if (c.unreadCount > 0 && c.session.provider === "UAZAPI" && c.session.status === "CONNECTED") {
    try {
      await (await uazapiConnectorFor(ctx, deps, c.session.id)).markRead(c.contact.jid, []);
    } catch {
      // ignora
    }
  }
}

async function ownerOf(ctx: RlsContext, conversationId: string, deps: PainelDeps): Promise<string> {
  const c = await rls(ctx, deps, (tx) =>
    tx.waConversation.findFirst({ where: { id: conversationId, workspaceId: ctx.workspaceId ?? "" }, select: { session: { select: { ownerUserId: true } } } })
  );
  if (!c) throw new PainelError("not_found", "Conversation not found.", 404);
  return c.session.ownerUserId;
}

/** Pausar (Assumir) ou retomar o agente numa conversa; ligar ou desligar o envio automático nela. */
export async function setConversationAgent(
  ctx: RlsContext,
  conversationId: string,
  input: { action: unknown; hours?: unknown },
  deps: PainelDeps
): Promise<{ humanTakeoverUntil: string | null; agentMode: string }> {
  const owner = await ownerOf(ctx, conversationId, deps);
  const store = storeFor(owner, ctx.workspaceId ?? "", deps);
  const action = input.action;
  if (action === "pause") {
    const hours = typeof input.hours === "number" ? input.hours : undefined;
    await assumirConversa(store, conversationId, { horas: hours, motivo: "você pausou o agente nessa conversa" });
  } else if (action === "resume") {
    await devolverAoAgente(store, conversationId);
  } else if (action === "auto_on" || action === "auto_off" || action === "draft") {
    const agentMode = action === "auto_on" ? "AUTO" : action === "draft" ? "DRAFT" : "INHERIT";
    await rls(ctx, deps, (tx) => tx.waConversation.updateMany({ where: { id: conversationId, workspaceId: ctx.workspaceId ?? "" }, data: { agentMode } }));
  } else {
    throw new PainelError("invalid_action", "Unknown action.", 400);
  }
  const row = await rls(ctx, deps, (tx) =>
    tx.waConversation.findFirst({ where: { id: conversationId }, select: { humanTakeoverUntil: true, agentMode: true } })
  );
  return { humanTakeoverUntil: row?.humanTakeoverUntil?.toISOString() ?? null, agentMode: row?.agentMode ?? "INHERIT" };
}

/** Aprovar (com ou sem edição) ou recusar o rascunho do agente. */
export async function decideDraft(
  ctx: RlsContext,
  runId: string,
  input: { action: unknown; bubbles?: unknown },
  deps: PainelDeps
): Promise<{ ok: true }> {
  const run = await rls(ctx, deps, (tx) =>
    tx.waAgentRun.findFirst({ where: { id: runId, workspaceId: ctx.workspaceId ?? "" }, select: { ownerUserId: true } })
  );
  if (!run) throw new PainelError("not_found", "Draft not found.", 404);
  const store = storeFor(run.ownerUserId, ctx.workspaceId ?? "", deps);
  if (input.action === "reject") {
    const ok = await rejeitarRascunho(store, { runId, ownerUserId: run.ownerUserId });
    if (!ok) throw new PainelError("nao_pendente", "This draft was already handled.", 409);
    return { ok: true };
  }
  if (input.action !== "approve") throw new PainelError("invalid_action", "Unknown action.", 400);
  const bubbles = Array.isArray(input.bubbles)
    ? input.bubbles.filter((b): b is string => typeof b === "string").map((b) => b.slice(0, 1000)).slice(0, 5)
    : undefined;
  const result = await aprovarRascunho({ store }, { runId, ownerUserId: run.ownerUserId, aprovadoPor: ctx.userId, bolhasEditadas: bubbles });
  if (!result.ok) {
    const map: Record<string, string> = {
      nao_encontrado: "Draft not found.",
      nao_pendente: "This draft was already handled.",
      janela_fechada: BLOCK_MESSAGES.fora_da_janela_24h,
      vazio: "The draft is empty.",
      falha_envio: "Could not queue the message right now. Try again.",
    };
    throw new PainelError(result.erro, map[result.erro] ?? result.mensagem, result.erro === "nao_encontrado" ? 404 : 409);
  }
  return { ok: true };
}

// ─── Mídia ───────────────────────────────────────────────────────────────────

const SAFE_INLINE = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|3gpp|webm)|audio\/(ogg|mpeg|mp4|aac|amr|webm)(;.*)?)$/i;

export async function messageMedia(
  ctx: RlsContext,
  messageId: string,
  deps: PainelDeps
): Promise<{ bytes: Uint8Array; contentType: string; inline: boolean; filename: string | null }> {
  const m = await rls(ctx, deps, (tx) =>
    tx.waMessage.findFirst({
      where: { id: messageId, workspaceId: ctx.workspaceId ?? "" },
      select: {
        providerMessageId: true,
        type: true,
        mediaMime: true,
        mediaFilename: true,
        session: { select: { id: true, provider: true, providerSessionId: true, riskAcceptedAt: true } },
        conversation: { select: { contact: { select: { jid: true } } } },
      },
    })
  );
  if (!m || !MEDIA_TYPES.has(m.type)) throw new PainelError("not_found", "Media not found.", 404);
  if (m.session.provider !== "OPENWA" && m.session.provider !== "UAZAPI") throw new PainelError("not_found", "Media not found.", 404);
  let media: Awaited<ReturnType<GatewayClient["fetchMedia"]>>;
  try {
    const client =
      m.session.provider === "UAZAPI"
        ? await uazapiConnectorFor(ctx, deps, m.session.id)
        : await connectorFor(deps, ctx.workspaceId, m.session.providerSessionId, m.session.riskAcceptedAt);
    media = await client.fetchMedia(m.conversation.contact.jid, m.providerMessageId);
  } catch (error) {
    throw gatewayMessage(error);
  }
  if (!media) throw new PainelError("not_found", "Media not found.", 404);
  const declared = (m.mediaMime || media.contentType || "").split(",")[0].trim();
  const inline = SAFE_INLINE.test(declared);
  return { bytes: media.bytes, contentType: inline ? declared : "application/octet-stream", inline, filename: m.mediaFilename };
}

// ─── Agentes ─────────────────────────────────────────────────────────────────

export type AgentsView = {
  sessions: Array<{ id: string; label: string; status: WaStatus }>;
  sessionId: string | null;
  numberMode: "OFF" | "DRAFT";
  profile: {
    baseCommand: string;
    quietStart: string;
    quietEnd: string;
    maxAutoPerDay: number;
    delayMinSeconds: number;
    delayMaxSeconds: number;
    facts: string[];
  };
  agents: Array<{ agente: AgenteTipo; ativo: boolean; instrucoes: string }>;
};

const DEFAULT_PROFILE: AgentsView["profile"] = {
  baseCommand: "",
  quietStart: "",
  quietEnd: "",
  maxAutoPerDay: 50,
  delayMinSeconds: 20,
  delayMaxSeconds: 90,
  facts: [],
};

export async function getAgents(ctx: RlsContext, sessionId: string | null, deps: PainelDeps): Promise<AgentsView> {
  return rls(ctx, deps, async (tx) => {
    const sessions = await tx.waSession.findMany({
      where: { workspaceId: ctx.workspaceId ?? "" },
      orderBy: { createdAt: "asc" },
      select: { id: true, phoneE164: true, displayName: true, status: true, agentMode: true },
    });
    const chosen = sessions.find((s) => s.id === sessionId) ?? sessions[0] ?? null;
    if (!chosen) {
      return { sessions: [], sessionId: null, numberMode: "OFF", profile: DEFAULT_PROFILE, agents: AGENTES.map((agente) => ({ agente, ativo: false, instrucoes: "" })) };
    }
    const [profile, configs] = await Promise.all([
      tx.waAgentProfile.findUnique({ where: { sessionId: chosen.id } }),
      tx.waAgentConfig.findMany({ where: { sessionId: chosen.id } }),
    ]);
    const quiet = profile?.quietHours as { start?: string; end?: string } | null;
    return {
      sessions: sessions.map((s) => ({ id: s.id, label: s.displayName || s.phoneE164 || "WhatsApp", status: s.status })),
      sessionId: chosen.id,
      numberMode: chosen.agentMode === "OFF" || chosen.agentMode === "INHERIT" ? "OFF" : "DRAFT",
      profile: profile
        ? {
            baseCommand: profile.baseCommand,
            quietStart: typeof quiet?.start === "string" ? quiet.start : "",
            quietEnd: typeof quiet?.end === "string" ? quiet.end : "",
            maxAutoPerDay: profile.maxAutoPerDay,
            delayMinSeconds: profile.delayMinSeconds,
            delayMaxSeconds: profile.delayMaxSeconds,
            facts: Array.isArray(profile.fatosPermitidos) ? (profile.fatosPermitidos as unknown[]).filter((f): f is string => typeof f === "string") : [],
          }
        : DEFAULT_PROFILE,
      agents: AGENTES.map((agente) => {
        const row = configs.find((c) => c.agente === agente);
        return { agente, ativo: Boolean(row?.ativo), instrucoes: row?.instrucoes ?? "" };
      }),
    };
  });
}

function intIn(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "string" ? Number.parseInt(v, 10) : typeof v === "number" ? Math.round(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Salva a configuração dos agentes de um número. Nada liga sem a pessoa marcar. */
export async function saveAgents(ctx: RlsContext, input: Record<string, unknown>, deps: PainelDeps): Promise<AgentsView> {
  const sessionId = typeof input.sessionId === "string" ? input.sessionId : "";
  const session = await loadSession(ctx, deps, sessionId);
  const p = (input.profile && typeof input.profile === "object" ? input.profile : {}) as Record<string, unknown>;
  const baseCommand = typeof p.baseCommand === "string" ? p.baseCommand.slice(0, 8000) : "";
  const quietStart = typeof p.quietStart === "string" && HHMM.test(p.quietStart) ? p.quietStart : null;
  const quietEnd = typeof p.quietEnd === "string" && HHMM.test(p.quietEnd) ? p.quietEnd : null;
  const delayMin = intIn(p.delayMinSeconds, 0, 600, 20);
  const delayMax = Math.max(delayMin, intIn(p.delayMaxSeconds, 0, 600, 90));
  const facts = Array.isArray(p.facts)
    ? p.facts.filter((f): f is string => typeof f === "string").map((f) => f.trim().slice(0, 300)).filter(Boolean).slice(0, 30)
    : [];
  const profileData = {
    baseCommand,
    quietHours: quietStart && quietEnd ? { start: quietStart, end: quietEnd } : undefined,
    maxAutoPerDay: intIn(p.maxAutoPerDay, 0, 1000, 50),
    delayMinSeconds: delayMin,
    delayMaxSeconds: delayMax,
    fatosPermitidos: facts,
  };
  const numberMode = input.numberMode === "DRAFT" ? "DRAFT" : "OFF";
  const agentsIn = Array.isArray(input.agents) ? (input.agents as Array<Record<string, unknown>>) : [];

  await rls(ctx, deps, async (tx) => {
    const ws = ctx.workspaceId ?? "";
    await tx.waSession.update({ where: { id: session.id }, data: { agentMode: numberMode } });
    await tx.waAgentProfile.upsert({
      where: { sessionId: session.id },
      create: { workspaceId: ws, ownerUserId: ctx.userId, sessionId: session.id, ...profileData, quietHours: profileData.quietHours ?? undefined },
      update: { ...profileData, quietHours: profileData.quietHours ?? Prisma.DbNull },
    });
    for (const agente of AGENTES) {
      const a = agentsIn.find((x) => x?.agente === agente);
      if (!a) continue;
      const data = {
        ativo: a.ativo === true,
        instrucoes: typeof a.instrucoes === "string" ? a.instrucoes.slice(0, 4000) || null : null,
      };
      await tx.waAgentConfig.upsert({
        where: { sessionId_agente: { sessionId: session.id, agente } },
        create: { workspaceId: ws, ownerUserId: ctx.userId, sessionId: session.id, agente, ...data },
        update: data,
      });
    }
  });
  return getAgents(ctx, session.id, deps);
}
