/**
 * Conexões > "Excluir número" num Postgres de verdade (PGlite com TODAS as
 * migrações) contra o gateway OpenWA FALSO e o servidor uazapi FALSO.
 *
 * - migração aditiva: deletedAt/deletedById opcionais, WaNumberDeletion com RLS forçada;
 * - "só o número": tira do provedor (OpenWA logout + DELETE da sessão; uazapi
 *   disconnect + DELETE /instance, a vaga volta), some de Conexões e Agentes,
 *   conversas ficam só leitura (sem envio, sem aprovar rascunho), webhook recusado;
 * - "número e conversas": exige o nome, apaga só o que é daquele número
 *   (outro número, outro workspace e o Instagram ficam intactos);
 * - outro workspace não exclui (RLS); provedor fora do ar não trava;
 * - auditoria sem conteúdo e só cresce; Desconectar continua sem apagar nada.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { PrismaClient } from "../app/generated/prisma/client";
import { migratedDb, startPrisma } from "./helpers/pglite-db";
import { FAKE_ADMIN_TOKEN, FakeUazapi } from "./helpers/fake-uazapi";
import { FAKE_OPENWA_KEY, FakeOpenWA } from "./helpers/fake-openwa";

process.env.ENCRYPTION_KEY = "d".repeat(64);

import { encryptToken } from "../lib/meta/oauth";
import { withRls, withSystemRole } from "../lib/db/rls";
import { PrismaWaRepository } from "../lib/whatsapp/prisma-repository";
import { handleWhatsAppWebhook } from "../lib/whatsapp/webhook";
import type { WaIngestJob, WaQueuePort, WaSendJob } from "../lib/whatsapp/queue";
import {
  createSession,
  decideDraft,
  disconnectSession,
  getAgents,
  getThread,
  listConversations,
  listSessions,
  messageMedia,
  sendReply,
  type PainelDeps,
} from "../lib/whatsapp/painel";
import { confirmNameMatches, deleteSession, listRemovedSessions } from "../lib/whatsapp/painel-excluir";
import { uazapiOverview } from "../lib/whatsapp/painel-uazapi";

let db: PGlite;
let prisma: PrismaClient;
let stop: () => Promise<void>;
const openwa = new FakeOpenWA();
const uazapi = new FakeUazapi();

class FakeQueue implements WaQueuePort {
  async addIngest(job: WaIngestJob) {
    void job;
  }
  async addSend(job: WaSendJob) {
    void job;
  }
}

let repo: PrismaWaRepository;
let deps: PainelDeps;
const SECRET = "s".repeat(43);
const matheus = { userId: "u_m", workspaceId: "ws_m" };
const bia = { userId: "u_b", workspaceId: "ws_b" };

/** Contato, conversa, 2 mensagens (uma com mídia), rascunho, memória, perfil, agente, envio barrado, evento e etiqueta. */
async function seedNumber(sessionId: string, ws: string, owner: string) {
  const k = sessionId;
  await db.exec(`
    INSERT INTO whatsapp."WaContact"(id, "workspaceId", "sessionId", jid, "pushName", "updatedAt")
      VALUES ('c_${k}', '${ws}', '${k}', '55119000${k.length}@c.us', 'Cliente ${k}', now());
    INSERT INTO whatsapp."WaConversation"(id, "workspaceId", "sessionId", "contactId", "lastMessageAt", "lastMessagePreview", "updatedAt")
      VALUES ('v_${k}', '${ws}', '${k}', 'c_${k}', now(), 'segredo ${k}', now());
    INSERT INTO whatsapp."WaMessage"(id, "workspaceId", "sessionId", "conversationId", "providerMessageId", "fromMe", "sentBy", type, body, "sentAt", "mediaMime") VALUES
      ('m1_${k}', '${ws}', '${k}', 'v_${k}', 'p1_${k}', false, 'CONTACT', 'text', 'segredo ${k}', now(), NULL),
      ('m2_${k}', '${ws}', '${k}', 'v_${k}', 'p2_${k}', false, 'CONTACT', 'image', NULL, now(), 'image/jpeg');
    INSERT INTO whatsapp."WaAgentRun"(id, "workspaceId", "ownerUserId", "sessionId", "conversationId", "triggerMsgId", mode, status, output)
      VALUES ('r_${k}', '${ws}', '${owner}', '${k}', 'v_${k}', 'm1_${k}', 'DRAFT', 'draft', '{"bolhas":["Oi!"]}');
    INSERT INTO whatsapp."WaContactMemory"("contactId", "workspaceId", "ownerUserId", interesse) VALUES ('c_${k}', '${ws}', '${owner}', 'orçamento');
    INSERT INTO whatsapp."WaAgentProfile"(id, "workspaceId", "ownerUserId", "sessionId", "baseCommand") VALUES ('ap_${k}', '${ws}', '${owner}', '${k}', 'Loja');
    INSERT INTO whatsapp."WaAgentConfig"(id, "workspaceId", "ownerUserId", "sessionId", agente) VALUES ('ac_${k}', '${ws}', '${owner}', '${k}', 'atendimento');
    INSERT INTO whatsapp."WaSendBlock"("ownerUserId", "workspaceId", "sessionId", "conversationId", "sentBy", reason, preview)
      VALUES ('${owner}', '${ws}', '${k}', 'v_${k}', 'AGENT', 'fora_da_janela_24h', 'segredo');
    INSERT INTO whatsapp."WaWebhookEvent"("sessionId", "ownerUserId", provider, "eventType", "dedupeKey", payload)
      VALUES ('${k}', '${owner}', 'OPENWA', 'message.received', 'dk_${k}', '{"body":"segredo"}');
    INSERT INTO whatsapp."WaConversationLabel"("conversationId", "labelId", "workspaceId") VALUES ('v_${k}', 'lab_${ws}', '${ws}');
  `);
}

async function countsFor(sessionId: string) {
  return withSystemRole(async (tx) => {
    const where = { sessionId };
    return {
      contacts: await tx.waContact.count({ where }),
      conversations: await tx.waConversation.count({ where }),
      messages: await tx.waMessage.count({ where }),
      runs: await tx.waAgentRun.count({ where }),
      memories: await tx.waContactMemory.count({ where: { contactId: `c_${sessionId}` } }),
      profiles: await tx.waAgentProfile.count({ where }),
      configs: await tx.waAgentConfig.count({ where }),
      blocks: await tx.waSendBlock.count({ where }),
      events: await tx.waWebhookEvent.count({ where }),
      labelLinks: await tx.waConversationLabel.count({ where: { conversationId: `v_${sessionId}` } }),
      docs: await tx.waKnowledgeDocument.count({ where }),
    };
  }, prisma);
}

const FULL = { contacts: 1, conversations: 1, messages: 2, runs: 1, memories: 1, profiles: 1, configs: 1, blocks: 1, events: 1, labelLinks: 1 };
const EMPTY = { contacts: 0, conversations: 0, messages: 0, runs: 0, memories: 0, profiles: 0, configs: 0, blocks: 0, events: 0, labelLinks: 0, docs: 0 };

async function addOpenwaSession(id: string, ws: string, owner: string, providerSessionId: string, displayName: string | null, phone: string | null) {
  await db.query(
    `INSERT INTO whatsapp."WaSession"(id, "workspaceId", "ownerUserId", provider, "providerSessionId", status, "displayName", "phoneE164", "webhookSecretEnc", "riskAcceptedAt", "agentMode", "conversationCount", "messageCount", "updatedAt")
     VALUES ($1, $2, $3, 'OPENWA', $4, 'CONNECTED', $5, $6, $7, now(), 'DRAFT', 1, 2, now())`,
    [id, ws, owner, providerSessionId, displayName, phone, encryptToken(SECRET)]
  );
  openwa.sessions.set(providerSessionId, "ready");
}

beforeAll(async () => {
  await openwa.start();
  await uazapi.start();
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
    INSERT INTO whatsapp."WaLabel"(id, "workspaceId", name, color, "updatedAt") VALUES
      ('lab_ws_m', 'ws_m', 'Cliente', '#00aa00', now()),
      ('lab_ws_b', 'ws_b', 'Cliente', '#00aa00', now());
    -- Instagram do mesmo workspace: nada do WhatsApp pode tocar nisso.
    INSERT INTO "DirectMessage"(id, "workspaceId", "accountId", "contactId", mid, "fromMe", text, "sentAt")
      VALUES ('dm_ig', 'ws_m', 'ig_1', 'igc_1', 'mid_ig_1', false, 'oi pelo Instagram', now());
  `);
  await addOpenwaSession("s1", "ws_m", "u_m", "owa-1", "Loja", "+5511911110001");
  await addOpenwaSession("s2", "ws_m", "u_m", "owa-2", "Suporte", "+5511911110002");
  await addOpenwaSession("sb", "ws_b", "u_b", "owa-b", "Bia", "+5511911110009");
  for (const [s, ws, o] of [["s1", "ws_m", "u_m"], ["s2", "ws_m", "u_m"], ["sb", "ws_b", "u_b"]] as const) await seedNumber(s, ws, o);
  // PDF ligado só ao s2 e um do workspace inteiro (sem número).
  await db.exec(`
    INSERT INTO whatsapp."WaKnowledgeDocument"(id, "ownerUserId", "workspaceId", "agentKind", "sessionId", "fileName", "sizeBytes", sha256)
    VALUES ('doc_s2', 'u_m', 'ws_m', 'atendimento', 's2', 'precos.pdf', 10, 'aa'),
           ('doc_ws', 'u_m', 'ws_m', 'atendimento', NULL, 'geral.pdf', 10, 'bb');
  `);
  ({ prisma, stop } = await startPrisma(db));
  repo = new PrismaWaRepository(prisma);
  deps = {
    repo,
    queue: new FakeQueue(),
    app: prisma,
    system: prisma,
    removePendingSend: async () => false,
    env: {
      WHATSAPP_ENABLED: "1",
      BETTER_AUTH_URL: "https://app.exemplo.com",
      OPENWA_BASE_URL: openwa.url,
      OPENWA_API_KEY: FAKE_OPENWA_KEY,
      UAZAPI_SERVER_URL: uazapi.url,
      UAZAPI_ADMIN_TOKEN: FAKE_ADMIN_TOKEN,
    },
  };
}, 60_000);

afterAll(async () => {
  await stop?.();
  await db?.close();
  await openwa.stop();
  await uazapi.stop();
});

beforeEach(() => {
  openwa.calls = [];
  openwa.down = false;
  uazapi.calls = [];
});

describe("migração 20261018120000_wa_excluir_numero (banco vazio)", () => {
  it("colunas novas opcionais e a auditoria com RLS forçada", async () => {
    const cols = await db.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'whatsapp' AND table_name = 'WaSession'
       AND column_name IN ('deletedAt','deletedById') ORDER BY 1`
    );
    expect(cols.rows).toEqual([
      { column_name: "deletedAt", is_nullable: "YES" },
      { column_name: "deletedById", is_nullable: "YES" },
    ]);
    const rls = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'whatsapp."WaNumberDeletion"'::regclass`
    );
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});

describe("confirmação pelo nome", () => {
  it("aceita o nome sem diferença de maiúscula e espaço, ou o número; recusa o resto", () => {
    const row = { displayName: "Loja Centro", phoneE164: "+5511911110001" };
    expect(confirmNameMatches("  loja   centro ", row)).toBe(true);
    expect(confirmNameMatches("55 11 91111-0001", row)).toBe(true);
    expect(confirmNameMatches("Loja", row)).toBe(false);
    expect(confirmNameMatches("", row)).toBe(false);
    expect(confirmNameMatches(undefined, row)).toBe(false);
    expect(confirmNameMatches("WhatsApp", { displayName: null, phoneE164: null })).toBe(true);
  });
});

describe("Excluir número", () => {
  it("outro workspace não exclui (RLS): 404, nada muda e o gateway nem é chamado", async () => {
    await expect(deleteSession(bia, "s1", { mode: "number_only" }, deps)).rejects.toMatchObject({ status: 404 });
    await expect(deleteSession(bia, "s1", { mode: "number_and_conversations", confirmName: "Loja" }, deps)).rejects.toMatchObject({ status: 404 });
    expect(openwa.calls).toEqual([]);
    expect(await countsFor("s1")).toMatchObject(FULL);
    expect((await listSessions(matheus, deps)).map((s) => s.id)).toContain("s1");
  });

  it("opção inválida não faz nada", async () => {
    await expect(deleteSession(matheus, "s1", { mode: "tudo" }, deps)).rejects.toMatchObject({ code: "invalid_mode", status: 400 });
    expect(openwa.calls).toEqual([]);
  });

  it("OpenWA, só o número: logout e DELETE da sessão no gateway, some de Conexões e Agentes, conversas ficam", async () => {
    const out = await deleteSession(matheus, "s1", { mode: "number_only" }, deps);
    expect(out).toMatchObject({ deleted: true, mode: "number_only", providerOk: true, provider: "OPENWA", providerRef: "owa-1", label: "Loja" });
    expect(openwa.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/sessions/owa-1/logout", "DELETE /api/sessions/owa-1"]);
    expect(openwa.sessions.has("owa-1")).toBe(false);

    expect((await listSessions(matheus, deps)).map((s) => s.id)).toEqual(["s2"]);
    expect((await getAgents(matheus, null, deps)).sessions.map((s) => s.id)).toEqual(["s2"]);
    expect(await listRemovedSessions(matheus, deps)).toMatchObject([{ id: "s1", label: "Loja", conversationCount: 1, messageCount: 2 }]);
    expect(await listRemovedSessions(bia, deps)).toEqual([]);

    // Tudo guardado, só pra leitura.
    expect(await countsFor("s1")).toMatchObject(FULL);
    const list = await listConversations(matheus, {}, deps);
    expect(list.find((c) => c.id === "v_s1")).toMatchObject({ numberRemoved: true });
    expect(list.find((c) => c.id === "v_s2")).toMatchObject({ numberRemoved: false });
    const thread = await getThread(matheus, "v_s1", deps);
    expect(thread.session).toMatchObject({ removed: true, status: "DISCONNECTED" });
    expect(thread.messages.map((m) => m.body)).toContain("segredo s1");

    const row = await withSystemRole((tx) => tx.waSession.findUnique({ where: { id: "s1" } }), prisma);
    expect(row).toMatchObject({ deletedById: "u_m", status: "DISCONNECTED", agentMode: "OFF", webhookSecretEnc: null, instanceTokenEnc: null });
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });

  it("número excluído: sem envio, sem aprovar rascunho, sem mídia, sem webhook, sem desconectar de novo", async () => {
    await expect(sendReply(matheus, "v_s1", { text: "oi" }, deps)).rejects.toMatchObject({ code: "number_removed", status: 409 });
    await expect(decideDraft(matheus, "r_s1", { action: "approve" }, deps)).rejects.toMatchObject({ code: "number_removed", status: 409 });
    await expect(messageMedia(matheus, "m2_s1", deps)).rejects.toMatchObject({ code: "number_removed_media", status: 410 });
    await expect(disconnectSession(matheus, "s1", deps)).rejects.toMatchObject({ status: 404 });
    await expect(deleteSession(matheus, "s1", { mode: "number_only" }, deps)).rejects.toMatchObject({ code: "already_deleted", status: 409 });
    expect(await repo.getSession("s1")).toBeNull();
    expect(await repo.findSessionByProvider("OPENWA", "owa-1")).toBeNull();
    const res = await handleWhatsAppWebhook(
      { headers: new Headers(), rawBody: JSON.stringify({ event: "message.received", sessionId: "owa-1", timestamp: Date.now(), data: {} }), ip: "1.2.3.4" },
      { repo, queue: new FakeQueue(), metaAppSecrets: [], rateLimitStore: { incr: async () => 1, expire: async () => 1 } }
    );
    expect(res.status).toBe(401);
    expect(openwa.calls).toEqual([]);
  });

  it("número e conversas: sem o nome certo não apaga nada e não chama o gateway", async () => {
    await expect(deleteSession(matheus, "s2", { mode: "number_and_conversations" }, deps)).rejects.toMatchObject({ code: "confirm_name", status: 400 });
    await expect(deleteSession(matheus, "s2", { mode: "number_and_conversations", confirmName: "Loja" }, deps)).rejects.toMatchObject({ code: "confirm_name" });
    expect(openwa.calls).toEqual([]);
    expect(await countsFor("s2")).toMatchObject({ ...FULL, docs: 1 });
  });

  it("número e conversas: apaga só o que é daquele número (outro número, outro workspace e Instagram intactos)", async () => {
    const out = await deleteSession(matheus, "s2", { mode: "number_and_conversations", confirmName: " SUPORTE " }, deps);
    expect(out).toMatchObject({ mode: "number_and_conversations", providerOk: true, conversationsDeleted: 1, messagesDeleted: 2 });
    expect(openwa.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/sessions/owa-2/logout", "DELETE /api/sessions/owa-2"]);
    expect(await withSystemRole((tx) => tx.waSession.findUnique({ where: { id: "s2" } }), prisma)).toBeNull();
    expect(await countsFor("s2")).toEqual(EMPTY);

    // Os outros ficam como estavam.
    expect(await countsFor("s1")).toMatchObject(FULL);
    expect(await countsFor("sb")).toMatchObject(FULL);
    const kept = await withSystemRole(
      async (tx) => ({
        labels: await tx.waLabel.count(),
        wsDoc: await tx.waKnowledgeDocument.count({ where: { id: "doc_ws" } }),
      }),
      prisma
    );
    expect(kept).toEqual({ labels: 2, wsDoc: 1 });
    const ig = await prisma.directMessage.findMany({ where: { workspaceId: "ws_m" }, select: { id: true, text: true } });
    expect(ig).toEqual([{ id: "dm_ig", text: "oi pelo Instagram" }]);
  });

  it("depois de excluir só o número, dá pra apagar as conversas guardadas (sem chamar o provedor de novo)", async () => {
    await expect(deleteSession(matheus, "s1", { mode: "number_and_conversations", confirmName: "Loja" }, deps)).resolves.toMatchObject({
      providerOk: true,
      conversationsDeleted: 1,
    });
    expect(openwa.calls).toEqual([]);
    expect(await countsFor("s1")).toEqual(EMPTY);
    expect(await listRemovedSessions(matheus, deps)).toEqual([]);
    expect(await countsFor("sb")).toMatchObject(FULL);
  });

  it("gateway OpenWA fora do ar: exclui no Lead Engine do mesmo jeito e devolve o id pra conferir no painel", async () => {
    await addOpenwaSession("s3", "ws_m", "u_m", "owa-3", null, "+5511911110003");
    await seedNumber("s3", "ws_m", "u_m");
    openwa.down = true;
    const out = await deleteSession(matheus, "s3", { mode: "number_only" }, deps);
    expect(out).toMatchObject({ providerOk: false, providerRef: "owa-3", label: "+5511911110003" });
    expect((await listSessions(matheus, deps)).map((s) => s.id)).not.toContain("s3");
    expect(await countsFor("s3")).toMatchObject(FULL);
    // E também a opção que apaga tudo, com o número digitado.
    await addOpenwaSession("s4", "ws_m", "u_m", "owa-4", null, "+5511911110004");
    await seedNumber("s4", "ws_m", "u_m");
    const all = await deleteSession(matheus, "s4", { mode: "number_and_conversations", confirmName: "55 11 91111-0004" }, deps);
    expect(all).toMatchObject({ providerOk: false, providerRef: "owa-4", conversationsDeleted: 1 });
    expect(await countsFor("s4")).toEqual(EMPTY);
  });

  it("sem o gateway configurado no servidor: também não trava", async () => {
    await addOpenwaSession("s5", "ws_m", "u_m", "owa-5", "Teste", null);
    const noGateway = { ...deps, env: { ...deps.env, OPENWA_BASE_URL: undefined, OPENWA_API_KEY: undefined } };
    await expect(deleteSession(matheus, "s5", { mode: "number_only" }, noGateway)).resolves.toMatchObject({ providerOk: false, providerRef: "owa-5" });
  });

  describe("uazapi", () => {
    let uazId = "";
    it("só o número: desconecta, apaga a instância (a vaga do plano volta) e as conversas ficam", async () => {
      uazapi.reset();
      const created = await createSession(matheus, { provider: "UAZAPI", acceptRisk: true, displayName: "Vendas", proxy: { country: "br", city: "campinas" } }, deps);
      uazId = created.session.id;
      const instanceId = uazapi.instances[0].id;
      await seedNumber(uazId, "ws_m", "u_m");
      expect(await uazapiOverview(deps)).toMatchObject({ used: 1, remaining: 1 });
      uazapi.calls = [];

      const out = await deleteSession(matheus, uazId, { mode: "number_only" }, deps);
      expect(out).toMatchObject({ providerOk: true, provider: "UAZAPI", providerRef: instanceId, label: "Vendas" });
      expect(uazapi.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /instance/disconnect", "DELETE /instance"]);
      expect(uazapi.instances).toHaveLength(0);
      expect(await uazapiOverview(deps)).toMatchObject({ used: 0, remaining: 2 });
      expect(await countsFor(uazId)).toMatchObject(FULL);
      const row = await withSystemRole((tx) => tx.waSession.findUnique({ where: { id: uazId } }), prisma);
      expect(row?.instanceTokenEnc).toBeNull();
      expect(row?.webhookSecretEnc).toBeNull();
    });

    it("uazapi fora do ar: exclui no Lead Engine e avisa", async () => {
      uazapi.reset();
      const created = await createSession(matheus, { provider: "UAZAPI", acceptRisk: true, proxy: { country: "br", city: "campinas" } }, deps);
      const instanceId = uazapi.instances[0].id;
      const down = { ...deps, env: { ...deps.env, UAZAPI_SERVER_URL: "http://127.0.0.1:9" } };
      const out = await deleteSession(matheus, created.session.id, { mode: "number_only" }, down);
      expect(out).toMatchObject({ providerOk: false, provider: "UAZAPI", providerRef: instanceId });
      expect(uazapi.instances).toHaveLength(1); // ficou lá: a pessoa confere no painel da uazapi
      expect((await listSessions(matheus, deps)).map((s) => s.id)).not.toContain(created.session.id);
    });
  });

  it("Desconectar continua igual: só logout, nada apagado, número continua na lista", async () => {
    await addOpenwaSession("s6", "ws_m", "u_m", "owa-6", "Fica", null);
    await seedNumber("s6", "ws_m", "u_m");
    const out = await disconnectSession(matheus, "s6", deps);
    expect(out).toMatchObject({ gatewayOk: true, session: { status: "DISCONNECTED" } });
    expect(openwa.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/sessions/owa-6/logout"]);
    expect(openwa.sessions.has("owa-6")).toBe(true);
    expect(await countsFor("s6")).toMatchObject(FULL);
    expect((await listSessions(matheus, deps)).map((s) => s.id)).toContain("s6");
    const row = await withSystemRole((tx) => tx.waSession.findUnique({ where: { id: "s6" } }), prisma);
    expect(row?.deletedAt).toBeNull();
    expect(row?.webhookSecretEnc).toBeTruthy();
  });

  it("auditoria: quem, quando e qual opção, sem conteúdo; só o workspace vê; ninguém edita nem apaga", async () => {
    const logs = await withRls(matheus, (tx) => tx.waNumberDeletion.findMany({ orderBy: { createdAt: "asc" } }), prisma);
    expect(logs.map((l) => [l.sessionId, l.mode, l.providerOk])).toEqual([
      ["s1", "number_only", true],
      ["s2", "number_and_conversations", true],
      ["s1", "conversations_after", true],
      ["s3", "number_only", false],
      ["s4", "number_and_conversations", false],
      ["s5", "number_only", false],
      [expect.any(String), "number_only", true],
      [expect.any(String), "number_only", false],
    ]);
    expect(logs.every((l) => l.deletedById === "u_m" && l.workspaceId === "ws_m" && l.createdAt instanceof Date)).toBe(true);
    expect(JSON.stringify(logs)).not.toContain("segredo");
    expect(await withRls(bia, (tx) => tx.waNumberDeletion.count(), prisma)).toBe(0);

    // Só cresce. Direto no PGlite (um erro dentro da transação derruba o socket do Prisma).
    const attempt = async (sql: string, params: unknown[] = []) => {
      await db.exec("BEGIN");
      try {
        await db.query(`SELECT set_config('app.user_id', 'u_m', true), set_config('app.workspace_id', 'ws_m', true)`);
        await db.exec("SET LOCAL ROLE le_app");
        const r = await db.query(sql, params);
        return { denied: false, affected: r.affectedRows ?? 0 };
      } catch {
        return { denied: true, affected: 0 };
      } finally {
        await db.exec("ROLLBACK");
      }
    };
    const del = await attempt(`DELETE FROM whatsapp."WaNumberDeletion"`);
    expect(del.denied || del.affected === 0).toBe(true);
    const upd = await attempt(`UPDATE whatsapp."WaNumberDeletion" SET mode = 'x'`);
    expect(upd.denied || upd.affected === 0).toBe(true);
    // E ninguém grava em nome de outra pessoa.
    const fake = await attempt(
      `INSERT INTO whatsapp."WaNumberDeletion"("workspaceId", "sessionId", "deletedById", mode, provider, "providerSessionId", "providerOk")
       VALUES ('ws_m', 'x', 'u_b', 'number_only', 'OPENWA', 'x', true)`
    );
    expect(fake.denied).toBe(true);
    // Sanidade: a própria pessoa grava (é o que o deleteSession faz).
    const own = await attempt(
      `INSERT INTO whatsapp."WaNumberDeletion"("workspaceId", "sessionId", "deletedById", mode, provider, "providerSessionId", "providerOk")
       VALUES ('ws_m', 'x', 'u_m', 'number_only', 'OPENWA', 'x', true)`
    );
    expect(own).toEqual({ denied: false, affected: 1 });
    const after = await withSystemRole((tx) => tx.waNumberDeletion.findMany(), prisma);
    expect(after).toHaveLength(logs.length);
  });
});
