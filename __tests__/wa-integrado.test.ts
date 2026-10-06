/**
 * WhatsApp integrado (06/10/2026): conector + cérebro + agentes em cima da
 * Fase 0, num Postgres de verdade (PGlite) com TODAS as migrações aplicadas.
 *
 * - migrações novas: só aditivas, RLS forçada, rodam sem pgvector (real[]);
 * - webhook assinado -> fila -> ingest grava contato, conversa e mensagem, sem duplicar;
 * - telas (lib/whatsapp/painel.ts) com RLS: Kayanne vê o inbox do Matheus, Bia não;
 * - desconectar NÃO apaga nada; conectar guarda o segredo cifrado e registra o webhook;
 * - agentes nascem desligados; motor com chave do /admin gera rascunho; aprovar
 *   é atômico; envio do agente respeita "Assumir"; gasto vai pra WaAiUsage.
 */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { PrismaClient } from "../app/generated/prisma/client";
import { migratedDb, startPrisma } from "./helpers/pglite-db";

process.env.ENCRYPTION_KEY = "b".repeat(64);

import { encryptToken } from "../lib/meta/oauth";
import { withSystemRole } from "../lib/db/rls";
import { PrismaWaRepository } from "../lib/whatsapp/prisma-repository";
import { handleWhatsAppWebhook } from "../lib/whatsapp/webhook";
import { processIngestJob } from "../lib/whatsapp/ingest";
import { processSendJob } from "../lib/whatsapp/outbound";
import { InMemorySendRateLimiter } from "../lib/whatsapp/pacing";
import type { WaIngestJob, WaQueuePort, WaSendJob } from "../lib/whatsapp/queue";
import {
  createSession,
  decideDraft,
  disconnectSession,
  getAgents,
  getThread,
  listConversations,
  markRead,
  PainelError,
  saveAgents,
  sendReply,
  setConversationAgent,
  type GatewayClient,
  type PainelDeps,
} from "../lib/whatsapp/painel";
import { agentIngestHooks, agentSendHooks, storeFor } from "../lib/whatsapp/agentes/worker";
import { processarMensagem } from "../lib/whatsapp/agentes/motor";
import { purgeOldWebhookEvents } from "../lib/whatsapp/retencao";
import { CerebroStore, detectVectorMode } from "../lib/whatsapp/cerebro/store";
import { createPrismaSqlExecutor, type PrismaRawLike } from "../lib/whatsapp/cerebro/sql";

let db: PGlite;
let prisma: PrismaClient;
let stop: () => Promise<void>;

const SECRET = "s".repeat(43);
const NOW = Date.now();

class FakeQueue implements WaQueuePort {
  ingest: WaIngestJob[] = [];
  send: Array<{ job: WaSendJob; delayMs?: number }> = [];
  async addIngest(job: WaIngestJob) {
    this.ingest.push(job);
  }
  async addSend(job: WaSendJob, options?: { delayMs?: number }) {
    this.send.push({ job, delayMs: options?.delayMs });
  }
}

const rateLimitStore = { incr: async () => 1, expire: async () => 1 };

function fakeGateway(): GatewayClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async connect() {
      calls.push("connect");
      return { status: "QR_READY" as const, qr: "data:image/png;base64,QQ==" };
    },
    async getQr() {
      calls.push("qr");
      return "data:image/png;base64,QQ==";
    },
    async getInfo() {
      calls.push("info");
      return { status: "CONNECTED" as const, phoneE164: "+5511911112222", pushName: "Loja" };
    },
    async disconnect() {
      calls.push("logout");
    },
    async ensureWebhook(url: string, secret: string) {
      calls.push(`webhook ${url} ${secret.length}`);
      return { created: true };
    },
    async markRead() {
      calls.push("read");
    },
    async fetchMedia() {
      return null;
    },
  };
}

let repo: PrismaWaRepository;
let queue: FakeQueue;
let gateway: ReturnType<typeof fakeGateway>;
let deps: PainelDeps;

const matheus = { userId: "u_m", workspaceId: "ws_m" };
const kayanne = { userId: "u_k", workspaceId: "ws_m" };
const bia = { userId: "u_b", workspaceId: "ws_b" };

beforeAll(async () => {
  db = await migratedDb();
  await db.exec(`
    INSERT INTO "User"(id, email, "updatedAt", role) VALUES
      ('u_m', 'matheus@ex.com', now(), 'ADMIN'),
      ('u_k', 'kayanne@ex.com', now(), 'USER'),
      ('u_b', 'bia@ex.com', now(), 'USER');
    INSERT INTO "Workspace"(id, name, "ownerId", "updatedAt") VALUES
      ('ws_m', 'Matheus', 'u_m', now()),
      ('ws_b', 'Bia', 'u_b', now());
    INSERT INTO "WorkspaceMember"(id, "workspaceId", "userId", role) VALUES
      ('wm1', 'ws_m', 'u_m', 'OWNER'),
      ('wm2', 'ws_m', 'u_k', 'MEMBER'),
      ('wm3', 'ws_b', 'u_b', 'OWNER');
  `);
  await db.query(
    `INSERT INTO whatsapp."WaSession"(id, "workspaceId", "ownerUserId", provider, "providerSessionId", status, "webhookSecretEnc", "riskAcceptedAt", "updatedAt")
     VALUES ('s_m', 'ws_m', 'u_m', 'OPENWA', 'owa-m', 'CONNECTED', $1, now(), now()),
            ('s_b', 'ws_b', 'u_b', 'OPENWA', 'owa-b', 'CONNECTED', $2, now(), now())`,
    [encryptToken(SECRET), encryptToken(SECRET)]
  );
  ({ prisma, stop } = await startPrisma(db));
  repo = new PrismaWaRepository(prisma);
  queue = new FakeQueue();
  gateway = fakeGateway();
  deps = {
    repo,
    queue,
    app: prisma,
    system: prisma,
    removePendingSend: async () => false,
    env: {
      WHATSAPP_ENABLED: "1",
      OPENWA_BASE_URL: "https://gw.exemplo.com",
      OPENWA_API_KEY: "chave-falsa",
      BETTER_AUTH_URL: "https://app.exemplo.com",
    },
    connectorFor: () => gateway,
    createGatewaySession: async () => ({ providerSessionId: "owa-novo", status: "PENDING" }),
  };
}, 60_000);

afterAll(async () => {
  await stop?.();
  await db?.close();
});

function signedOpenWA(body: object) {
  const rawBody = JSON.stringify(body);
  const sig = "sha256=" + createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex");
  return { headers: new Headers({ "x-openwa-signature": sig, "content-type": "application/json" }), rawBody, ip: "10.0.0.1" };
}

function inbound(id: string, text: string, at = NOW - 10 * 60_000) {
  return {
    event: "message.received",
    sessionId: "owa-m",
    timestamp: new Date(at).toISOString(),
    idempotencyKey: `idem-${id}`,
    deliveryId: `dlv-${id}`,
    data: { id, chatId: "5511988887777@c.us", fromMe: false, type: "chat", body: text, timestamp: Math.floor(at / 1000), contact: { pushName: "Cliente Teste" } },
  };
}

async function deliver(body: object) {
  const res = await handleWhatsAppWebhook(signedOpenWA(body), { repo, queue, metaAppSecrets: [], now: () => NOW, rateLimitStore });
  const jobs = queue.ingest.splice(0);
  const enqueued: string[] = [];
  for (const job of jobs) {
    await processIngestJob(job, {
      repo,
      ...agentIngestHooks(repo, async (j) => {
        enqueued.push(`${j.kind}:${j.workspaceId}`);
      }),
    });
  }
  return { res, enqueued };
}

describe("migrações novas no Postgres", () => {
  it("criam as tabelas com RLS forçada e rodam sem pgvector", async () => {
    const r = await db.query<{ relname: string; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'whatsapp' AND c.relkind = 'r' ORDER BY 1`
    );
    const tables = Object.fromEntries(r.rows.map((x) => [x.relname, x.relforcerowsecurity]));
    for (const t of [
      "WaWebhookEvent",
      "WaSendBlock",
      "WaAgentProfile",
      "WaAgentRun",
      "WaAgentConfig",
      "WaKnowledgeDocument",
      "WaKnowledgeChunk",
      "WaContactMemory",
      "WaAiUsage",
    ]) {
      expect(tables[t], t).toBe(true);
    }
    const sys = createPrismaSqlExecutor(prisma as unknown as PrismaRawLike, { userId: "u_m", workspaceId: "ws_m" });
    expect(await detectVectorMode(sys)).toBe("array");
  });

  it("o papel da aplicação não lê o evento cru do webhook", async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', 'u_m', true), set_config('app.workspace_id', 'ws_m', true), set_config('role', 'le_app', true)`;
      return tx.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM whatsapp."WaWebhookEvent"`).catch((e: Error) => e);
    });
    // Sem GRANT pro le_app: erro de permissão (ou nada visível).
    expect(rows instanceof Error || (Array.isArray(rows) && rows.length === 0)).toBe(true);
  });
});

describe("webhook -> ingest no Postgres", () => {
  it("grava contato, conversa e mensagem e enfileira o agente com o workspace", async () => {
    const { res, enqueued } = await deliver(inbound("wamid.1", "Oi, como funciona o clareamento?"));
    expect(res.status).toBe(200);
    expect(enqueued).toEqual(["inbound:ws_m"]);
    const msg = await withSystemRole((tx) => tx.waMessage.findFirst({ where: { providerMessageId: "wamid.1" } }), prisma);
    expect(msg).toMatchObject({ workspaceId: "ws_m", sentBy: "CONTACT", body: "Oi, como funciona o clareamento?" });
    const conv = await withSystemRole((tx) => tx.waConversation.findFirst({ where: { id: msg!.conversationId } }), prisma);
    expect(conv?.unreadCount).toBe(1);
    const session = await withSystemRole((tx) => tx.waSession.findUnique({ where: { id: "s_m" } }), prisma);
    expect(session).toMatchObject({ conversationCount: 1, messageCount: 1 });
  });

  it("o mesmo evento de novo não duplica nada", async () => {
    const { res } = await deliver(inbound("wamid.1", "Oi, como funciona o clareamento?"));
    expect(res.body).toMatchObject({ duplicate: 1 });
    const count = await withSystemRole((tx) => tx.waMessage.count({ where: { providerMessageId: "wamid.1" } }), prisma);
    expect(count).toBe(1);
  });

  it("assinatura errada responde 401 e não grava", async () => {
    const body = inbound("wamid.x", "forjado");
    const res = await handleWhatsAppWebhook(
      { headers: new Headers({ "x-openwa-signature": "sha256=" + "0".repeat(64) }), rawBody: JSON.stringify(body), ip: "1.1.1.1" },
      { repo, queue, metaAppSecrets: [], now: () => NOW, rateLimitStore }
    );
    expect(res.status).toBe(401);
    const n = await withSystemRole((tx) => tx.waWebhookEvent.count({ where: { dedupeKey: { contains: "wamid.x" } } }), prisma);
    expect(n).toBe(0);
  });

  it("status de sessão mais velho que o último não volta o status", async () => {
    await repo.updateSessionStatus("s_m", { status: "CONNECTED", at: new Date(NOW) });
    await repo.updateSessionStatus("s_m", { status: "QR_READY", at: new Date(NOW - 60_000) });
    const s = await repo.getSession("s_m");
    expect(s?.status).toBe("CONNECTED");
  });

  it("retenção apaga só o evento cru antigo, nunca a mensagem", async () => {
    await withSystemRole((tx) => tx.waWebhookEvent.updateMany({ data: { createdAt: new Date(NOW - 40 * 86_400_000) } }), prisma);
    const removed = await purgeOldWebhookEvents(repo, new Date(NOW));
    expect(removed).toBeGreaterThan(0);
    const msgs = await withSystemRole((tx) => tx.waMessage.count(), prisma);
    expect(msgs).toBe(1);
  });
});

describe("telas com RLS", () => {
  it("Kayanne (membro) vê o inbox do Matheus; Bia não", async () => {
    const list = await listConversations(kayanne, { q: "clareamento" }, deps);
    expect(list).toHaveLength(1);
    expect(list[0].contact.pushName).toBe("Cliente Teste");
    expect(await listConversations(bia, {}, deps)).toEqual([]);
    await expect(getThread(bia, list[0].id, deps)).rejects.toBeInstanceOf(PainelError);
  });

  it("conversa aberta mostra a janela de 24h aberta e zera as não lidas", async () => {
    const [c] = await listConversations(matheus, { filter: "unread" }, deps);
    const thread = await getThread(matheus, c.id, deps);
    expect(thread.window.open).toBe(true);
    expect(thread.messages.map((m) => m.body)).toEqual(["Oi, como funciona o clareamento?"]);
    await markRead(matheus, c.id, deps);
    expect(await listConversations(matheus, { filter: "unread" }, deps)).toEqual([]);
  });

  it("resposta humana entra na fila com uma bolha só e pausa o agente na conversa", async () => {
    const [c] = await listConversations(matheus, {}, deps);
    queue.send = [];
    const out = await sendReply(kayanne, c.id, { text: "Oi! Já te explico." }, deps);
    expect(out.queued).toBe(true);
    expect(queue.send).toHaveLength(1);
    expect(queue.send[0].job.request.sentBy).toBe("USER_APP");
    expect(queue.send[0].job.plan.map((b) => b.text)).toEqual(["Oi! Já te explico."]);
    const thread = await getThread(matheus, c.id, deps);
    expect(thread.conversation.paused).toBe(true);
    await setConversationAgent(matheus, c.id, { action: "resume" }, deps);
    expect((await getThread(matheus, c.id, deps)).conversation.paused).toBe(false);
  });

  it("fora da janela de 24h a resposta é barrada com motivo claro", async () => {
    await deliver({
      ...inbound("wamid.velho", "mensagem antiga", NOW - 5 * 3600_000),
      sessionId: "owa-m",
      data: { ...inbound("wamid.velho", "mensagem antiga", NOW - 30 * 3600_000).data, chatId: "5511977776666@c.us" },
    });
    const list = await listConversations(matheus, { q: "antiga" }, deps);
    expect(list).toHaveLength(1);
    await expect(sendReply(matheus, list[0].id, { text: "oi" }, deps)).rejects.toMatchObject({ code: "fora_da_janela_24h", status: 409 });
  });

  it("conectar exige o termo de risco e guarda o segredo só cifrado", async () => {
    await expect(createSession({ ...matheus }, { acceptRisk: false }, deps)).rejects.toMatchObject({ code: "risk_not_accepted" });
    const out = await createSession({ ...matheus }, { acceptRisk: true, displayName: "Atendimento" }, deps);
    expect(out.qr).toContain("data:image/png");
    expect(out.session.status).toBe("QR_READY");
    expect(gateway.calls).toContain("webhook https://app.exemplo.com/api/whatsapp/webhook 43");
    const row = await withSystemRole((tx) => tx.waSession.findFirst({ where: { providerSessionId: "owa-novo" } }), prisma);
    expect(row?.webhookSecretEnc).toBeTruthy();
    expect(row?.webhookSecretEnc).not.toContain("s".repeat(10));
    expect(row?.riskAcceptedAt).toBeTruthy();
  });

  it("desconectar faz logout e NÃO apaga conversa, contato, mensagem nem configuração", async () => {
    const before = await withSystemRole(
      async (tx) => [await tx.waConversation.count(), await tx.waContact.count(), await tx.waMessage.count()],
      prisma
    );
    gateway.calls.length = 0;
    const out = await disconnectSession(matheus, "s_m", deps);
    expect(out.gatewayOk).toBe(true);
    expect(out.session.status).toBe("DISCONNECTED");
    expect(gateway.calls).toEqual(["logout"]);
    const after = await withSystemRole(
      async (tx) => [await tx.waConversation.count(), await tx.waContact.count(), await tx.waMessage.count()],
      prisma
    );
    expect(after).toEqual(before);
    await repo.updateSessionStatus("s_m", { status: "CONNECTED", at: new Date(Date.now() + 1000) });
  });
});

describe("agentes", () => {
  it("nascem desligados; salvar liga só o que a pessoa marcou", async () => {
    const view = await getAgents(matheus, "s_m", deps);
    expect(view.numberMode).toBe("OFF");
    expect(view.agents.every((a) => !a.ativo)).toBe(true);
    const saved = await saveAgents(
      matheus,
      {
        sessionId: "s_m",
        numberMode: "DRAFT",
        profile: { baseCommand: "Clínica odontológica. Respostas curtas.", delayMinSeconds: 30, delayMaxSeconds: 10, facts: ["Avaliação custa R$ 80"] },
        agents: [{ agente: "atendimento", ativo: true, instrucoes: "Pergunte o nome." }],
      },
      deps
    );
    expect(saved.numberMode).toBe("DRAFT");
    expect(saved.agents.find((a) => a.agente === "atendimento")?.ativo).toBe(true);
    expect(saved.agents.filter((a) => a.ativo)).toHaveLength(1);
    // atraso: o máximo nunca fica menor que o mínimo
    expect(saved.profile).toMatchObject({ delayMinSeconds: 30, delayMaxSeconds: 30, facts: ["Avaliação custa R$ 80"] });
  });

  it("motor com a chave do /admin gera RASCUNHO e o gasto vai pro relatório", async () => {
    // Como o admin faria em /admin > Chaves de IA (aqui direto no banco, como dono).
    await db.query(
      `INSERT INTO "PlatformAiCredential"(id, provider, "keyEnc", "keyLast4", "createdById", "updatedById", "updatedAt")
       VALUES ('k1', 'anthropic', $1, 'xxxx', 'u_m', 'u_m', now())`,
      [encryptToken("sk-ant-" + "x".repeat(30))]
    );
    const [c] = await listConversations(matheus, { q: "clareamento" }, deps);
    const msg = await withSystemRole((tx) => tx.waMessage.findFirst({ where: { providerMessageId: "wamid.1" } }), prisma);
    const store = storeFor("u_m", "ws_m", deps);
    const usos: string[] = [];
    let keySeen = "";
    const result = await processarMensagem(
      {
        store,
        cerebro: { buscar: async () => [] },
        limites: { tetoUsuarioUsd: 1, tetoWorkspaceUsd: 3 },
        jev: { apiKey: "" },
        chamar: async (p) => {
          keySeen = p.apiKey;
          return {
            texto: JSON.stringify({ bolhas: ["Oi! O clareamento é feito no consultório.", "Quer marcar uma avaliação?"], passar_pra_humano: false, motivo: "" }),
            uso: { tokensIn: 900, tokensOut: 60, cacheRead: 0, cacheWrite: 0 },
          };
        },
        registrarUso: async (u) => {
          usos.push(`${u.agente}:${u.provider}:${u.bloqueado}`);
        },
      },
      { conversationId: c.id, triggerMsgId: msg!.id }
    );
    expect(result.acao).toBe("rascunho");
    expect(keySeen).toBe("sk-ant-" + "x".repeat(30));
    expect(usos).toEqual(["atendimento:anthropic:false"]);
    const thread = await getThread(kayanne, c.id, deps);
    expect(thread.draft?.bubbles).toEqual(["Oi! O clareamento é feito no consultório.", "Quer marcar uma avaliação?"]);
  });

  it("aprovar é atômico: o segundo clique não agenda de novo", async () => {
    const [c] = await listConversations(matheus, { filter: "drafts" }, deps);
    const thread = await getThread(matheus, c.id, deps);
    queue.send = [];
    await decideDraft(matheus, thread.draft!.runId, { action: "approve", bubbles: ["Oi! O clareamento é feito no consultório."] }, deps);
    await expect(decideDraft(kayanne, thread.draft!.runId, { action: "approve" }, deps)).rejects.toMatchObject({ code: "nao_pendente" });
    expect(queue.send).toHaveLength(1);
    const { job, delayMs } = queue.send[0];
    expect(job.outboxId).toBe(thread.draft!.runId);
    expect(job.request).toMatchObject({ sentBy: "AGENT", agentRunId: thread.draft!.runId });
    expect(delayMs).toBeGreaterThanOrEqual(2_000);
    expect(job.plan[0].waitBeforeTypingMs).toBe(0);
  });

  it("envio do agente sai, grava como AGENT e o run vira sent", async () => {
    const { job } = queue.send[0];
    const sent: string[] = [];
    const connector = {
      provider: "OPENWA" as const,
      connect: async () => ({ status: "CONNECTED" as const, qr: null }),
      getQr: async () => null,
      getStatus: async () => "CONNECTED" as const,
      sendText: async (_to: string, text: string) => {
        sent.push(text);
        return { providerMessageId: `out-${sent.length}`, timestamp: Date.now() };
      },
      sendMedia: async () => ({ providerMessageId: "m", timestamp: Date.now() }),
      sendTemplate: async () => ({ providerMessageId: "t", timestamp: Date.now() }),
      setTyping: async () => {},
      markRead: async () => {},
      disconnect: async () => {},
    };
    const result = await processSendJob(job, {
      repo,
      getConnector: () => connector,
      limiter: new InMemorySendRateLimiter(),
      sleep: async () => {},
      ...agentSendHooks(deps),
    });
    expect(result.status).toBe("sent");
    expect(sent).toEqual(["Oi! O clareamento é feito no consultório."]);
    const run = await withSystemRole((tx) => tx.waAgentRun.findUnique({ where: { id: job.outboxId } }), prisma);
    expect(run?.status).toBe("sent");
    const out = await withSystemRole((tx) => tx.waMessage.findFirst({ where: { providerMessageId: "out-1" } }), prisma);
    expect(out).toMatchObject({ sentBy: "AGENT", agentRunId: job.outboxId, fromMe: true });
  });

  it("depois de Assumir, um envio do agente que já estava na fila não sai", async () => {
    const [c] = await listConversations(matheus, { q: "clareamento" }, deps);
    const store = storeFor("u_m", "ws_m", deps);
    const runId = await store.registrarRun({
      ownerUserId: "u_m",
      workspaceId: "ws_m",
      sessionId: "s_m",
      conversationId: c.id,
      triggerMsgId: "x",
      agente: "atendimento",
      mode: "AUTO",
      status: "scheduled",
      output: { bolhas: ["isso não pode sair"] },
      blockedReason: null,
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      tokensIn: 0,
      tokensOut: 0,
      cacheRead: 0,
      cacheWrite: 0,
      custoUsdMicro: 0,
      triagem: null,
      createdAt: new Date(),
    });
    await setConversationAgent(matheus, c.id, { action: "pause" }, deps);
    let sent = 0;
    const result = await processSendJob(
      {
        outboxId: runId,
        nextIndex: 0,
        plan: [{ text: "isso não pode sair", waitBeforeTypingMs: 0, typingMs: 0 }],
        request: { ownerUserId: "u_m", sessionId: "s_m", conversationId: c.id, sentBy: "AGENT", agentRunId: runId, content: { type: "text", text: "x" } },
      },
      {
        repo,
        getConnector: () => ({ setTyping: async () => {}, sendText: async () => ({ providerMessageId: `n${++sent}`, timestamp: Date.now() }) }) as never,
        limiter: new InMemorySendRateLimiter(),
        sleep: async () => {},
        ...agentSendHooks(deps),
      }
    );
    expect(result.status).toBe("blocked");
    expect(sent).toBe(0);
    const run = await withSystemRole((tx) => tx.waAgentRun.findUnique({ where: { id: runId } }), prisma);
    expect(run?.status).toBe("rejected");
  });
});

describe("cérebro sem pgvector (coluna real[])", () => {
  it("grava pedaços e acha o mais parecido pela função de cosseno", async () => {
    const exec = createPrismaSqlExecutor(prisma as unknown as PrismaRawLike, { userId: "u_m", workspaceId: "ws_m" });
    const store = new CerebroStore(exec, await detectVectorMode(exec));
    const { document } = await store.createDocument(
      { ownerUserId: "u_m", workspaceId: "ws_m" },
      { agentKind: "suporte", sessionId: null, fileName: "faq.pdf", sizeBytes: 10, sha256: "abc", data: new Uint8Array([1]), pageCount: 1 }
    );
    const v = (i: number) => Array.from({ length: 1536 }, (_, j) => (j === i ? 1 : 0));
    await store.saveChunks(document, [
      { position: 0, page: 1, content: "Prazo de entrega", tokenEstimate: 3, embedding: v(0) },
      { position: 1, page: 2, content: "Troca em 7 dias", tokenEstimate: 3, embedding: v(1) },
    ], { embeddingModel: "m", embeddingTokens: 6, pageCount: 2 });
    const hits = await store.nearestChunks({ workspaceId: "ws_m", agentKind: "suporte", embeddingModel: "m", vector: v(1), limit: 2 });
    expect(hits[0].content).toBe("Troca em 7 dias");
    expect(hits[0].score).toBeCloseTo(1);
    // Bia não enxerga o cérebro do Matheus
    const biaExec = createPrismaSqlExecutor(prisma as unknown as PrismaRawLike, { userId: "u_b", workspaceId: "ws_m" });
    expect(await new CerebroStore(biaExec, "array").listDocuments("ws_m", "suporte")).toEqual([]);
  });
});
