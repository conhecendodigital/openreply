/**
 * uazapi no Postgres de verdade (PGlite com TODAS as migrações, a partir de um
 * banco vazio) + painel (Conexões) contra o servidor uazapi FALSO.
 *
 * - migração aditiva: enum UAZAPI, colunas novas opcionais, OPENWA de padrão, RLS forçada;
 * - conectar exige termo de risco, cidade do proxy e vaga livre; token e segredo só cifrados;
 * - QR e código de pareamento; status; reconectar na mesma cidade; reiniciar;
 * - desconectar NÃO apaga nada (nem a instância na uazapi);
 * - webhook -> ingest grava a mensagem com o repositório Prisma.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { PrismaClient } from "../app/generated/prisma/client";
import { migratedDb, startPrisma } from "./helpers/pglite-db";
import { FAKE_ADMIN_TOKEN, FakeUazapi } from "./helpers/fake-uazapi";

process.env.ENCRYPTION_KEY = "c".repeat(64);

import { decryptToken } from "../lib/meta/oauth";
import { withSystemRole } from "../lib/db/rls";
import { PrismaWaRepository } from "../lib/whatsapp/prisma-repository";
import { processIngestJob } from "../lib/whatsapp/ingest";
import type { WaIngestJob, WaQueuePort, WaSendJob } from "../lib/whatsapp/queue";
import { createSession, disconnectSession, listSessions, reconnectSession, refreshSession, type PainelDeps } from "../lib/whatsapp/painel";
import { restartUazapi, uazapiOverview, uazapiRegions } from "../lib/whatsapp/painel-uazapi";
import { handleUazapiWebhook } from "../lib/whatsapp/uazapi-webhook";
import { serverStatus } from "../lib/whatsapp/painel";

let db: PGlite;
let prisma: PrismaClient;
let stop: () => Promise<void>;
const fake = new FakeUazapi();

class FakeQueue implements WaQueuePort {
  ingest: WaIngestJob[] = [];
  async addIngest(job: WaIngestJob) {
    this.ingest.push(job);
  }
  async addSend(job: WaSendJob) {
    void job;
  }
}

let repo: PrismaWaRepository;
let queue: FakeQueue;
let deps: PainelDeps;
const matheus = { userId: "u_m", workspaceId: "ws_m" };
const bia = { userId: "u_b", workspaceId: "ws_b" };
const PROXY = { country: "br", city: "campinas" };

beforeAll(async () => {
  await fake.start();
  db = await migratedDb();
  await db.exec(`
    INSERT INTO "User"(id, email, "updatedAt", role) VALUES
      ('u_m', 'matheus@ex.com', now(), 'ADMIN'),
      ('u_b', 'bia@ex.com', now(), 'USER');
    INSERT INTO "Workspace"(id, name, "ownerId", "updatedAt") VALUES
      ('ws_m', 'Matheus', 'u_m', now()),
      ('ws_b', 'Bia', 'u_b', now());
    INSERT INTO "WorkspaceMember"(id, "workspaceId", "userId", role) VALUES
      ('wm1', 'ws_m', 'u_m', 'OWNER'),
      ('wm3', 'ws_b', 'u_b', 'OWNER');
    -- Número antigo, gravado SEM provider: tem que virar OPENWA (padrão).
    INSERT INTO whatsapp."WaSession"(id, "workspaceId", "ownerUserId", "providerSessionId", status, "updatedAt")
      VALUES ('s_antigo', 'ws_m', 'u_m', 'owa-antigo', 'DISCONNECTED', now());
  `);
  ({ prisma, stop } = await startPrisma(db));
  repo = new PrismaWaRepository(prisma);
  queue = new FakeQueue();
  deps = {
    repo,
    queue,
    app: prisma,
    system: prisma,
    env: {
      WHATSAPP_ENABLED: "1",
      BETTER_AUTH_URL: "https://app.exemplo.com",
      UAZAPI_SERVER_URL: fake.url,
      UAZAPI_ADMIN_TOKEN: FAKE_ADMIN_TOKEN,
    },
  };
}, 60_000);

afterAll(async () => {
  await stop?.();
  await db?.close();
  await fake.stop();
});

beforeEach(() => {
  fake.calls = [];
});

describe("migração 20261016120000_wa_uazapi (banco vazio)", () => {
  it("cria o valor UAZAPI, as colunas opcionais e mantém OPENWA de padrão", async () => {
    const e = await db.query<{ v: string }>(`SELECT unnest(enum_range(NULL::whatsapp."WaProvider"))::text AS v`);
    expect(e.rows.map((r) => r.v)).toEqual(["OPENWA", "CLOUD_API", "UAZAPI"]);
    const cols = await db.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'whatsapp' AND table_name = 'WaSession'
       AND column_name IN ('instanceTokenEnc','proxyCountry','proxyState','proxyCity','proxyCityLabel') ORDER BY 1`
    );
    expect(cols.rows).toHaveLength(5);
    expect(cols.rows.every((c) => c.is_nullable === "YES")).toBe(true);
    const antigo = await db.query<{ provider: string }>(`SELECT provider::text FROM whatsapp."WaSession" WHERE id = 's_antigo'`);
    expect(antigo.rows[0].provider).toBe("OPENWA");
    const rls = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'whatsapp."WaSession"'::regclass`
    );
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});

describe("Conexões com a uazapi", () => {
  it("sem as variáveis da uazapi: aparece desligada e conectar explica o porquê", async () => {
    const off = { ...deps, env: { WHATSAPP_ENABLED: "1", BETTER_AUTH_URL: "https://app.exemplo.com" } };
    expect(await uazapiOverview(off)).toMatchObject({ configured: false, remaining: 0 });
    expect(await serverStatus(off)).toMatchObject({ uazapiConfigured: false });
    await expect(createSession(matheus, { provider: "UAZAPI", acceptRisk: true, proxy: PROXY }, off)).rejects.toMatchObject({ code: "uazapi_off", status: 503 });
  });

  it("regiões: países e cidades da própria uazapi, Brasil de padrão", async () => {
    const r = await uazapiRegions({}, deps);
    expect(r.country).toBe("br");
    expect(r.cities.map((c) => c.value)).toContain("campinas");
  });

  it("sem cidade do proxy não conecta (nada é criado na uazapi)", async () => {
    await expect(createSession(matheus, { provider: "UAZAPI", acceptRisk: true }, deps)).rejects.toMatchObject({ code: "proxy_required", status: 400 });
    await expect(createSession(matheus, { provider: "UAZAPI", acceptRisk: true, proxy: { country: "br", city: "" } }, deps)).rejects.toMatchObject({ code: "proxy_required" });
    await expect(createSession(matheus, { provider: "UAZAPI", acceptRisk: true, proxy: { country: "br", city: "gotham" } }, deps)).rejects.toMatchObject({ code: "proxy_invalid" });
    await expect(createSession(matheus, { provider: "UAZAPI", acceptRisk: false, proxy: PROXY }, deps)).rejects.toMatchObject({ code: "risk_not_accepted" });
    await expect(createSession(matheus, { provider: "UAZAPI", acceptRisk: true, proxy: PROXY, method: "code", phone: "12" }, deps)).rejects.toMatchObject({ code: "phone_required" });
    expect(fake.calls.some((c) => c.path === "/instance/create")).toBe(false);
  });

  it("servidor sem proxy gerenciado: mensagem clara e não conecta", async () => {
    fake.noManagedProxy = true;
    try {
      await expect(createSession(matheus, { provider: "UAZAPI", acceptRisk: true, proxy: PROXY }, deps)).rejects.toMatchObject({ code: "proxy_list_missing" });
    } finally {
      fake.noManagedProxy = false;
    }
  });

  let sessionId = "";

  it("conectar por QR: cria a instância em Campinas, guarda token e segredo só cifrados e registra o webhook", async () => {
    const out = await createSession(matheus, { provider: "UAZAPI", acceptRisk: true, displayName: "Atendimento", proxy: PROXY }, deps);
    sessionId = out.session.id;
    expect(out.qr).toMatch(/^data:image\/png;base64,/);
    expect(out.pairCode).toBeNull();
    expect(out.proxyWarning).toBe(false);
    expect(out.session).toMatchObject({ provider: "UAZAPI", status: "QR_READY", proxy: { country: "br", city: "campinas", label: "Campinas" } });

    const inst = fake.instances[0];
    expect(inst.region).toEqual({ country: "br", state: "sp", city: "campinas" });
    const row = await withSystemRole((tx) => tx.waSession.findUnique({ where: { id: sessionId } }), prisma);
    expect(row?.provider).toBe("UAZAPI");
    expect(row?.providerSessionId).toBe(inst.id);
    expect(row?.instanceTokenEnc).toBeTruthy();
    expect(row?.instanceTokenEnc).not.toContain(inst.token);
    expect(decryptToken(row!.instanceTokenEnc!)).toBe(inst.token);
    const secret = decryptToken(row!.webhookSecretEnc!);
    expect(secret.length).toBeGreaterThanOrEqual(43);
    expect(inst.webhook?.url).toBe(`https://app.exemplo.com/api/whatsapp/webhook/uazapi/${sessionId}/${secret}`);
    // O navegador nunca vê token nem segredo.
    expect(JSON.stringify(out)).not.toContain(inst.token);
    expect(JSON.stringify(out)).not.toContain(secret);
  });

  it("Bia (outro workspace) não vê o número", async () => {
    expect((await listSessions(bia, deps)).map((s) => s.id)).not.toContain(sessionId);
    await expect(refreshSession(bia, sessionId, deps)).rejects.toMatchObject({ status: 404 });
  });

  it("status: depois de ler o QR fica conectado com o número", async () => {
    fake.pair(fake.instances[0].id, "5511912345678", "Loja Teste");
    const out = await refreshSession(matheus, sessionId, deps);
    expect(out.session).toMatchObject({ status: "CONNECTED", phoneE164: "+5511912345678", displayName: "Atendimento" });
  });

  it("webhook -> ingest grava a mensagem nova no Postgres; histórico não entra", async () => {
    const row = await withSystemRole((tx) => tx.waSession.findUnique({ where: { id: sessionId } }), prisma);
    const secret = decryptToken(row!.webhookSecretEnc!);
    const token = fake.instances[0].token;
    const rateLimitStore = { incr: async () => 1, expire: async () => 1 };
    const send = (body: object) =>
      handleUazapiWebhook({ headers: new Headers(), rawBody: JSON.stringify(body), ip: "1.2.3.4", sessionId, secret }, { repo, queue, rateLimitStore });
    const hist = await send({ EventType: "history", token, event: "messages", messages: [{ messageid: "H1", chatid: "5511988887777@s.whatsapp.net", text: "antiga" }] });
    expect(hist.status).toBe(200);
    const res = await send({
      EventType: "messages",
      token,
      owner: "5511912345678",
      message: { messageid: "3EB0NOVA", chatid: "5511988887777@s.whatsapp.net", senderName: "Cliente", messageType: "Conversation", text: "Quero um orçamento", messageTimestamp: Date.now() },
    });
    expect(res.status).toBe(200);
    for (const job of queue.ingest.splice(0)) await processIngestJob(job, { repo });
    const msgs = await withSystemRole((tx) => tx.waMessage.findMany({ where: { sessionId } }), prisma);
    expect(msgs.map((m) => m.body)).toEqual(["Quero um orçamento"]);
    const events = await withSystemRole((tx) => tx.waWebhookEvent.findMany({ where: { sessionId } }), prisma);
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0].payload)).not.toContain(token);
  });

  it("reiniciar não pede QR novo nem apaga nada", async () => {
    const out = await restartUazapi(matheus, sessionId, deps);
    expect(out.resetting).toBe(true);
    expect(fake.calls.map((c) => c.path)).toEqual(["/instance/reset"]);
  });

  it("desconectar faz logout e NÃO apaga conversa, mensagem, configuração nem a instância", async () => {
    const before = await withSystemRole(async (tx) => [await tx.waConversation.count(), await tx.waContact.count(), await tx.waMessage.count()], prisma);
    const out = await disconnectSession(matheus, sessionId, deps);
    expect(out).toMatchObject({ gatewayOk: true, session: { status: "DISCONNECTED" } });
    expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /instance/disconnect"]);
    expect(fake.instances).toHaveLength(1);
    const after = await withSystemRole(async (tx) => [await tx.waConversation.count(), await tx.waContact.count(), await tx.waMessage.count()], prisma);
    expect(after).toEqual(before);
    const row = await withSystemRole((tx) => tx.waSession.findUnique({ where: { id: sessionId } }), prisma);
    expect(row?.instanceTokenEnc).toBeTruthy();
    expect(row?.proxyCity).toBe("campinas");
  });

  it("reconectar por código usa a mesma instância e a mesma cidade", async () => {
    const out = await reconnectSession(matheus, sessionId, deps, { method: "code", phone: "5511912345678" });
    expect(out).toMatchObject({ qr: null, pairCode: "ABCD-1234" });
    const connect = fake.calls.find((c) => c.path === "/instance/connect")!;
    expect(connect.body).toMatchObject({ phone: "5511912345678", proxy_managed_country: "br", proxy_managed_state: "sp", proxy_managed_city: "campinas" });
    expect(fake.calls.some((c) => c.path === "/instance/create")).toBe(false);
  });

  it("vagas: conta as instâncias da uazapi e barra quando o plano de 2 está cheio", async () => {
    expect(await uazapiOverview(deps)).toEqual({ configured: true, max: 2, used: 1, remaining: 1, source: "server" });
    fake.extraInstances = 1; // uma criada direto no painel da uazapi
    expect(await uazapiOverview(deps)).toMatchObject({ used: 2, remaining: 0 });
    await expect(createSession(matheus, { provider: "UAZAPI", acceptRisk: true, proxy: PROXY }, deps)).rejects.toMatchObject({ code: "no_slots", status: 409 });
    fake.extraInstances = 0;
    // Limite configurável.
    expect(await uazapiOverview({ ...deps, env: { ...deps.env, UAZAPI_MAX_INSTANCES: "3" } })).toMatchObject({ max: 3, remaining: 2 });
  });

  it("conectar por código de pareamento num número novo", async () => {
    const out = await createSession(matheus, { provider: "UAZAPI", acceptRisk: true, proxy: { country: "br", city: "saopaulo" }, method: "code", phone: "55 11 98888-7777" }, deps);
    expect(out).toMatchObject({ qr: null, pairCode: "ABCD-1234", session: { proxy: { city: "saopaulo", label: "São Paulo" } } });
  });

  it("o OpenWA continua sendo o padrão quando provider não vem", async () => {
    await expect(createSession(matheus, { acceptRisk: true }, deps)).rejects.toMatchObject({ code: "gateway_off" });
  });
});
