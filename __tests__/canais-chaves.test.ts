/**
 * Canais > Conexões e chaves (06/10/2026), num Postgres de verdade (PGlite)
 * com todas as migrações, as rotas de verdade e servidores uazapi e OpenWA
 * FALSOS (nada chama serviço real):
 * - salvar, trocar, remover; cifrado no banco; o valor nunca volta;
 * - precedência Canais > ambiente > nada, sem misturar URL de um lado e chave do outro;
 * - salvar limpa o cache na hora; sem salvar, o cache vence em 30 s;
 * - RLS: outro workspace e membro comum não leem nem gravam;
 * - permissões: membro, chave de API, sem sessão;
 * - SSRF: http, localhost, rede interna e DNS interno recusados;
 * - Testar conexão contra os servidores falsos;
 * - painel, conector e worker usando a credencial do workspace do número;
 * - auditoria sem valor.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { PrismaClient } from "../app/generated/prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migratedDb, migrationNames, startPrisma } from "./helpers/pglite-db";
import { FAKE_ADMIN_TOKEN, FakeUazapi } from "./helpers/fake-uazapi";

type Ctx = { userId: string; workspaceId: string; role: "OWNER" | "ADMIN" | "MEMBER" };
const h = vi.hoisted(() => ({
  ctx: null as null | { userId: string; workspaceId: string; role: "OWNER" | "ADMIN" | "MEMBER" },
  sessionUser: null as null | { id: string; role: "USER" | "ADMIN"; twoFactorEnabled: boolean },
  byKey: false,
  hits: 0,
  dns: {} as Record<string, string[]>,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () =>
    h.sessionUser ? { user: { name: null, image: null, email: `${h.sessionUser.id}@ex.com`, ...h.sessionUser }, session: { id: "s", expiresAt: new Date() } } : null
  ),
  isApiTokenRequest: vi.fn(async () => h.byKey),
  needsTwoFactorSetup: (u: { role: string; twoFactorEnabled: boolean } | null) => Boolean(u && u.role === "ADMIN" && !u.twoFactorEnabled),
}));
vi.mock("@/lib/workspace-access", () => ({
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
  getCurrentWorkspaceContext: vi.fn(async () =>
    h.ctx ? { ...h.ctx, workspace: { id: h.ctx.workspaceId, name: "ws" } } : null
  ),
}));
vi.mock("@/lib/http-rate-limit", () => ({
  hitRateLimit: vi.fn(async (_b: string, _id: string, limit: number) => {
    h.hits += 1;
    return { allowed: h.hits <= limit, count: h.hits, limit };
  }),
}));
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) => {
    const ips = h.dns[host];
    if (!ips) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    return ips.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  }),
}));

process.env.ENCRYPTION_KEY = "d".repeat(64);

import { encryptToken } from "../lib/meta/oauth";
import { withRls } from "../lib/db/rls";
import { isApiKeyRouteAllowed } from "../lib/api-key-routes";
import {
  INTEGRATION_CACHE_TTL_MS,
  invalidateIntegrationCache,
  resolveOpenwa,
  resolveUazapi,
  saveIntegrationField,
} from "../lib/integrations/credentials";
import { checkPublicHttpsUrl, isPrivateIp } from "../lib/integrations/url-guard";
import { testIntegration } from "../lib/integrations/test-connection";
import { sessionCredentials, whatsappStatusFor } from "../lib/whatsapp/setup";
import { createConnector } from "../lib/whatsapp/factory";
import { PrismaWaRepository } from "../lib/whatsapp/prisma-repository";
import { createSession, serverStatus, type PainelDeps } from "../lib/whatsapp/painel";
import { uazapiOverview } from "../lib/whatsapp/painel-uazapi";
import type { WaIngestJob, WaQueuePort, WaSendJob } from "../lib/whatsapp/queue";
import * as listRoute from "../app/api/channels/integrations/route";
import * as fieldRoute from "../app/api/channels/integrations/[service]/[field]/route";
import * as testRoute from "../app/api/channels/integrations/[service]/test/route";

const UAZ_HOST = "uazapi.cliente.example";
const GW_HOST = "gw.cliente.example";
const UAZ_URL = `https://${UAZ_HOST}`;
const GW_URL = `https://${GW_HOST}`;
const OPENWA_KEY = "owa-operator-SEGREDO-1234wxyz";

let db: PGlite;
let prisma: PrismaClient;
let stop: () => Promise<void>;
const fake = new FakeUazapi();

/** Gateway OpenWA falso: /api/health e o envio de texto, conferindo a chave. */
const openwa = {
  server: null as Server | null,
  url: "",
  calls: [] as Array<{ method: string; path: string; key: string | undefined }>,
};

const realFetch = globalThis.fetch;
function routedFetch(input: string | URL | Request, init?: RequestInit) {
  const url = String(input).replace(UAZ_URL, fake.url).replace(GW_URL, openwa.url);
  return realFetch(url, init);
}

class FakeQueue implements WaQueuePort {
  async addIngest(job: WaIngestJob) {
    void job;
  }
  async addSend(job: WaSendJob) {
    void job;
  }
}

const DONO: Ctx = { userId: "u_dono", workspaceId: "ws_a", role: "OWNER" };
const ADMIN_WS: Ctx = { userId: "u_adm", workspaceId: "ws_a", role: "ADMIN" };
const MEMBRO: Ctx = { userId: "u_membro", workspaceId: "ws_a", role: "MEMBER" };
const BIA: Ctx = { userId: "u_bia", workspaceId: "ws_b", role: "OWNER" };

beforeAll(async () => {
  await fake.start();
  openwa.server = createServer((req, res) => {
    const key = req.headers["x-api-key"] as string | undefined;
    openwa.calls.push({ method: req.method ?? "", path: req.url ?? "", key });
    req.resume();
    req.on("end", () => {
      if (key !== OPENWA_KEY) {
        res.writeHead(401, { "content-type": "application/json" }).end('{"error":"unauthorized"}');
        return;
      }
      if (req.url === "/api/health") {
        res.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
        return;
      }
      if (req.method === "POST" && /\/messages\/send-text$/.test(req.url ?? "")) {
        res.writeHead(200, { "content-type": "application/json" }).end('{"messageId":"owa-msg-1","timestamp":1}');
        return;
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => openwa.server!.listen(0, "127.0.0.1", resolve));
  openwa.url = `http://127.0.0.1:${(openwa.server.address() as AddressInfo).port}`;

  db = await migratedDb();
  await db.exec(`
    INSERT INTO "User"(id, email, name, "updatedAt", role, "twoFactorEnabled") VALUES
      ('u_dono', 'dono@ex.com', 'Matheus', now(), 'ADMIN', true),
      ('u_adm', 'adm@ex.com', 'Kayanne', now(), 'USER', false),
      ('u_membro', 'membro@ex.com', NULL, now(), 'USER', false),
      ('u_bia', 'bia@ex.com', 'Bia', now(), 'USER', false);
    INSERT INTO "Workspace"(id, name, "ownerId", "updatedAt") VALUES
      ('ws_a', 'Matheus', 'u_dono', now()),
      ('ws_b', 'Loja da Bia', 'u_bia', now());
    INSERT INTO "WorkspaceMember"(id, "workspaceId", "userId", role) VALUES
      ('wm1', 'ws_a', 'u_dono', 'OWNER'),
      ('wm2', 'ws_a', 'u_adm', 'ADMIN'),
      ('wm3', 'ws_a', 'u_membro', 'MEMBER'),
      ('wm4', 'ws_b', 'u_bia', 'OWNER');
  `);
  ({ prisma, stop } = await startPrisma(db));
  (globalThis as unknown as { prisma?: PrismaClient }).prisma = prisma;
}, 60_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await stop?.();
  await db?.close();
  await fake.stop();
  openwa.server?.closeAllConnections?.();
  await new Promise<void>((resolve) => openwa.server?.close(() => resolve()) ?? resolve());
});

beforeEach(() => {
  h.ctx = DONO;
  h.sessionUser = { id: "u_dono", role: "ADMIN", twoFactorEnabled: true };
  h.byKey = false;
  h.hits = 0;
  h.dns = { [UAZ_HOST]: ["93.184.216.34"], [GW_HOST]: ["2606:4700::6810:1"], "interno.cliente.example": ["10.0.0.7"] };
  fake.calls = [];
  openwa.calls = [];
  vi.stubGlobal("fetch", routedFetch);
  invalidateIntegrationCache();
});

function req(path: string, method = "GET", body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
const fieldParams = (service: string, field: string) => ({ params: Promise.resolve({ service, field }) });
const serviceParams = (service: string) => ({ params: Promise.resolve({ service }) });

async function put(service: string, field: string, value: unknown) {
  const res = await fieldRoute.PUT(req(`/api/channels/integrations/${service}/${field}`, "PUT", { value }), fieldParams(service, field));
  return { status: res.status, text: await res.text() };
}

async function list() {
  const res = await listRoute.GET();
  return { status: res.status, text: await res.text() };
}

async function auditRows(ws = "ws_a") {
  return (await db.query<Record<string, unknown>>(`SELECT * FROM "WorkspaceIntegrationAudit" WHERE "workspaceId" = $1 ORDER BY "createdAt"`, [ws])).rows;
}

describe("migração 20261018120000_canais_chaves", () => {
  it("é a última, vem depois de 20261017120000 e só adiciona", () => {
    const names = migrationNames();
    expect(names.at(-1)).toBe("20261018120000_canais_chaves");
    expect(names.at(-2)).toBe("20261017120000_dm_formato_texto");
    const sql = readFileSync(join(__dirname, "..", "prisma", "migrations", "20261018120000_canais_chaves", "migration.sql"), "utf8").replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|ALTER COLUMN|DELETE FROM|UPDATE\s+"?\w+"?\s+SET)\b/i);
    expect(sql).not.toMatch(/ALTER TABLE\s+(?!(public\.)?"WorkspaceIntegration)/);
  });

  it("cria as duas tabelas com RLS forçada e a função de dono/admin", async () => {
    const r = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('WorkspaceIntegrationCredential','WorkspaceIntegrationAudit') ORDER BY 1`
    );
    expect(r.rows).toEqual([
      { relname: "WorkspaceIntegrationAudit", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "WorkspaceIntegrationCredential", relrowsecurity: true, relforcerowsecurity: true },
    ]);
    const fn = await db.query(`SELECT 1 FROM pg_proc WHERE proname = 'is_workspace_manager'`);
    expect(fn.rows).toHaveLength(1);
  });

  it("recusa serviço ou campo desconhecido no próprio banco", async () => {
    await expect(
      db.query(`INSERT INTO "WorkspaceIntegrationCredential"(id,"workspaceId",service,field,"valueEnc",last4,"createdById","updatedById","updatedAt")
                VALUES ('x','ws_a','uazapi','senha','e','1234','u','u',now())`)
    ).rejects.toThrow();
  });
});

describe("Salvar, trocar e remover", () => {
  it("salva cifrado e a tela só recebe os 4 últimos, quem e quando", async () => {
    expect((await put("uazapi", "serverUrl", `${UAZ_URL}/`)).status).toBe(200);
    const saved = await put("uazapi", "adminToken", FAKE_ADMIN_TOKEN);
    expect(saved.status).toBe(200);
    expect(saved.text).not.toContain(FAKE_ADMIN_TOKEN);
    expect(JSON.parse(saved.text).data).toEqual({ replaced: false, last4: FAKE_ADMIN_TOKEN.slice(-4) });

    const body = await list();
    expect(body.status).toBe(200);
    expect(body.text).not.toContain(FAKE_ADMIN_TOKEN);
    expect(body.text).not.toContain(UAZ_HOST);
    expect(body.text).not.toContain("valueEnc");
    const uaz = JSON.parse(body.text).data.services.find((s: { service: string }) => s.service === "uazapi");
    expect(uaz).toMatchObject({ source: "workspace", workspaceComplete: true });
    const token = uaz.fields.find((f: { field: string }) => f.field === "adminToken");
    expect(token).toMatchObject({ saved: true, last4: FAKE_ADMIN_TOKEN.slice(-4), updatedBy: "Matheus" });

    const rows = await db.query<{ valueEnc: string }>(`SELECT "valueEnc" FROM "WorkspaceIntegrationCredential" WHERE "workspaceId" = 'ws_a'`);
    expect(rows.rows.every((r) => !r.valueEnc.includes(FAKE_ADMIN_TOKEN) && !r.valueEnc.includes(UAZ_HOST))).toBe(true);
  });

  it("o número do plano aparece como número (não é segredo)", async () => {
    expect((await put("uazapi", "maxInstances", "3")).status).toBe(200);
    const uaz = JSON.parse((await list()).text).data.services.find((s: { service: string }) => s.service === "uazapi");
    expect(uaz.fields.find((f: { field: string }) => f.field === "maxInstances")).toMatchObject({ saved: true, number: 3, last4: null });
    expect((await put("uazapi", "maxInstances", "0")).status).toBe(400);
    expect(JSON.parse((await put("uazapi", "maxInstances", "abc")).text).code).toBe("number_invalid");
  });

  it("trocar avisa que trocou e a auditoria grava sem o valor", async () => {
    const r = await put("uazapi", "adminToken", FAKE_ADMIN_TOKEN);
    expect(JSON.parse(r.text).data.replaced).toBe(true);
    const audit = await auditRows();
    expect(audit.map((a) => a.action)).toEqual(["saved", "saved", "saved", "replaced"]);
    expect(JSON.stringify(audit)).not.toContain(FAKE_ADMIN_TOKEN);
    expect(audit.every((a) => a.actorUserId === "u_dono")).toBe(true);
  });

  it("campo desconhecido é 404; chave com espaço é recusada", async () => {
    expect((await put("uazapi", "senha", "x")).status).toBe(404);
    expect((await put("telegram", "token", "x")).status).toBe(404);
    expect(JSON.parse((await put("openwa", "apiKey", "tem espaco no meio")).text).code).toBe("secret_invalid");
  });

  it("remover apaga só aquele campo e registra", async () => {
    await put("openwa", "baseUrl", GW_URL);
    const res = await fieldRoute.DELETE(req("/api/channels/integrations/openwa/baseUrl", "DELETE"), fieldParams("openwa", "baseUrl"));
    expect(res.status).toBe(200);
    const again = await fieldRoute.DELETE(req("/api/channels/integrations/openwa/baseUrl", "DELETE"), fieldParams("openwa", "baseUrl"));
    expect(again.status).toBe(404);
    expect((await auditRows()).at(-1)).toMatchObject({ action: "removed", service: "openwa", field: "baseUrl" });
  });
});

describe("SSRF: só endereço público https", () => {
  it("recusa http, localhost, IP interno, nome sem ponto e DNS interno", async () => {
    expect(JSON.parse((await put("openwa", "baseUrl", "http://gw.cliente.example")).text).code).toBe("url_not_https");
    expect(JSON.parse((await put("openwa", "baseUrl", "https://localhost:3000")).text).code).toBe("url_internal");
    expect(JSON.parse((await put("openwa", "baseUrl", "https://169.254.169.254/latest")).text).code).toBe("url_internal");
    expect(JSON.parse((await put("openwa", "baseUrl", "https://openwa:2785")).text).code).toBe("url_internal");
    expect(JSON.parse((await put("openwa", "baseUrl", "https://[::1]/")).text).code).toBe("url_internal");
    expect(JSON.parse((await put("openwa", "baseUrl", "https://interno.cliente.example")).text).code).toBe("url_internal");
    expect(JSON.parse((await put("openwa", "baseUrl", "https://naoexiste.cliente.example")).text).code).toBe("url_invalid");
    expect(JSON.parse((await put("openwa", "baseUrl", "https://user:pw@gw.cliente.example")).text).code).toBe("url_invalid");
  });

  it("classifica IPs", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "172.20.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::6810:1"]) expect(isPrivateIp(ip)).toBe(false);
    expect(checkPublicHttpsUrl("https://x.uazapi.com/?a=1#b")).toMatchObject({ ok: true, url: "https://x.uazapi.com" });
  });
});

describe("Quem entra", () => {
  it("membro comum recebe 403 em tudo", async () => {
    h.ctx = MEMBRO;
    expect((await listRoute.GET()).status).toBe(403);
    expect((await put("openwa", "apiKey", OPENWA_KEY)).status).toBe(403);
    expect((await fieldRoute.DELETE(req("/x", "DELETE"), fieldParams("uazapi", "adminToken"))).status).toBe(403);
    expect((await testRoute.POST(req("/x", "POST"), serviceParams("uazapi"))).status).toBe(403);
  });

  it("chave de API recebe 403, mesmo junto com a sessão do dono", async () => {
    h.byKey = true;
    expect((await listRoute.GET()).status).toBe(403);
    expect((await put("openwa", "apiKey", OPENWA_KEY)).status).toBe(403);
    expect((await testRoute.POST(req("/x", "POST"), serviceParams("openwa"))).status).toBe(403);
  });

  it("sem sessão recebe 401", async () => {
    h.ctx = null;
    h.sessionUser = null;
    expect((await listRoute.GET()).status).toBe(401);
    expect((await put("openwa", "apiKey", OPENWA_KEY)).status).toBe(401);
  });

  it("as rotas novas não estão liberadas pra chave de API no proxy", () => {
    for (const method of ["GET", "PUT", "DELETE", "POST", "PATCH"]) {
      expect(isApiKeyRouteAllowed(method, "/api/channels/integrations")).toBe(false);
      expect(isApiKeyRouteAllowed(method, "/api/channels/integrations/uazapi/adminToken")).toBe(false);
      expect(isApiKeyRouteAllowed(method, "/api/channels/integrations/uazapi/test")).toBe(false);
    }
  });

  it("admin do workspace edita; chaves de IA só pro admin da plataforma", async () => {
    h.ctx = ADMIN_WS;
    h.sessionUser = { id: "u_adm", role: "USER", twoFactorEnabled: false };
    expect((await put("openwa", "apiKey", OPENWA_KEY)).status).toBe(200);
    expect(JSON.parse((await list()).text).data.ai).toBeNull();
    h.ctx = DONO;
    h.sessionUser = { id: "u_dono", role: "ADMIN", twoFactorEnabled: true };
    expect(JSON.parse((await list()).text).data.ai).toEqual({ anthropic: false, openai: false, typesafe: false });
  });

  it("limite de tentativas: a 21ª mudança em 10 minutos recebe 429", async () => {
    h.hits = 20;
    expect((await put("openwa", "apiKey", OPENWA_KEY)).status).toBe(429);
  });
});

describe("RLS das chaves", () => {
  it("outro workspace e membro comum não leem nada, nem direto no banco", async () => {
    const bia = await withRls(BIA, (tx) => tx.workspaceIntegrationCredential.findMany(), prisma);
    expect(bia).toEqual([]);
    const forced = await withRls({ userId: "u_bia", workspaceId: "ws_a" }, (tx) => tx.workspaceIntegrationCredential.findMany(), prisma);
    expect(forced).toEqual([]);
    const membro = await withRls(MEMBRO, (tx) => tx.workspaceIntegrationCredential.findMany(), prisma);
    expect(membro).toEqual([]);
    const dono = await withRls(DONO, (tx) => tx.workspaceIntegrationCredential.findMany(), prisma);
    expect(dono.length).toBeGreaterThan(0);
    const audit = await withRls(MEMBRO, (tx) => tx.workspaceIntegrationAudit.findMany(), prisma);
    expect(audit).toEqual([]);
  });

  it("membro e outro workspace não gravam", async () => {
    await expect(
      saveIntegrationField({ userId: "u_membro", workspaceId: "ws_a" }, { service: "openwa", field: "apiKey", value: OPENWA_KEY }, { app: prisma })
    ).rejects.toThrow();
    await expect(
      saveIntegrationField({ userId: "u_bia", workspaceId: "ws_a" }, { service: "openwa", field: "apiKey", value: OPENWA_KEY }, { app: prisma })
    ).rejects.toThrow();
  });

  it("auditoria só cresce (ninguém edita nem apaga pelo papel da aplicação)", async () => {
    await expect(withRls(DONO, (tx) => tx.workspaceIntegrationAudit.deleteMany({}), prisma)).rejects.toThrow();
  });
});

describe("Precedência: Canais > ambiente > nada", () => {
  const ENV = { UAZAPI_SERVER_URL: "https://env.uazapi.com", UAZAPI_ADMIN_TOKEN: "env-admin-token", UAZAPI_MAX_INSTANCES: "4", OPENWA_BASE_URL: "http://openwa:2785", OPENWA_API_KEY: "env-openwa" };

  it("workspace com tudo salvo usa o que salvou", async () => {
    const u = await resolveUazapi("ws_a", { env: ENV, system: prisma });
    expect(u).toEqual({ source: "workspace", serverUrl: UAZ_URL, adminToken: FAKE_ADMIN_TOKEN, maxInstances: 3 });
  });

  it("workspace sem nada usa o ambiente (o que está no Dokploy continua valendo)", async () => {
    expect(await resolveUazapi("ws_b", { env: ENV, system: prisma })).toEqual({
      source: "env",
      serverUrl: "https://env.uazapi.com",
      adminToken: "env-admin-token",
      maxInstances: 4,
    });
    expect(await resolveOpenwa("ws_b", { env: ENV, system: prisma })).toEqual({ source: "env", baseUrl: "http://openwa:2785", apiKey: "env-openwa" });
    expect(await resolveUazapi("ws_b", { env: {}, system: prisma })).toBeNull();
  });

  it("nunca mistura: só a chave salva (sem URL) não manda a chave do ambiente pra outra URL", async () => {
    // ws_a tem apiKey do OpenWA mas não a URL (removida acima).
    const o = await resolveOpenwa("ws_a", { env: ENV, system: prisma });
    expect(o).toEqual({ source: "env", baseUrl: "http://openwa:2785", apiKey: "env-openwa" });
  });

  it("salvar invalida o cache na hora; mudança por fora vale depois do TTL", async () => {
    let clock = 1_000_000;
    const opts = { env: ENV, system: prisma, now: () => clock };
    expect((await resolveOpenwa("ws_a", opts))?.source).toBe("env");
    await saveIntegrationField({ userId: "u_dono", workspaceId: "ws_a" }, { service: "openwa", field: "baseUrl", value: GW_URL }, { app: prisma });
    expect(await resolveOpenwa("ws_a", opts)).toEqual({ source: "workspace", baseUrl: GW_URL, apiKey: OPENWA_KEY });

    // Mudança direta no banco (outro processo): o cache segura até o TTL.
    await db.query(`UPDATE "WorkspaceIntegrationCredential" SET "valueEnc" = $1 WHERE "workspaceId" = 'ws_a' AND field = 'apiKey'`, [
      encryptToken("owa-operator-NOVA-chave-9999"),
    ]);
    expect((await resolveOpenwa("ws_a", opts))?.apiKey).toBe(OPENWA_KEY);
    clock += INTEGRATION_CACHE_TTL_MS + 1;
    expect((await resolveOpenwa("ws_a", opts))?.apiKey).toBe("owa-operator-NOVA-chave-9999");
    await db.query(`UPDATE "WorkspaceIntegrationCredential" SET "valueEnc" = $1 WHERE "workspaceId" = 'ws_a' AND field = 'apiKey'`, [encryptToken(OPENWA_KEY)]);
    invalidateIntegrationCache("ws_a");
  });

  it("status do WhatsApp conta o que o workspace salvou; WHATSAPP_ENABLED continua no ambiente", async () => {
    expect(await whatsappStatusFor("ws_a", { env: {}, system: prisma })).toEqual({ enabled: false, gatewayConfigured: true, uazapiConfigured: true });
    expect(await whatsappStatusFor("ws_b", { env: {}, system: prisma })).toEqual({ enabled: false, gatewayConfigured: false, uazapiConfigured: false });
    const listed = JSON.parse((await list()).text).data;
    expect(listed.whatsappEnabled).toBe(process.env.WHATSAPP_ENABLED === "1");
  });

  it("banco fora do ar: falha fechada (não cai pro ambiente às cegas)", async () => {
    const broken = { $transaction: async () => Promise.reject(new Error("db down")) } as unknown as PrismaClient;
    await expect(resolveUazapi("ws_z", { env: ENV, system: broken })).rejects.toThrow(/Canais/);
  });
});

describe("Testar conexão (servidores falsos)", () => {
  it("uazapi: ok com o admintoken salvo, conta as instâncias", async () => {
    const res = await testRoute.POST(req("/x", "POST"), serviceParams("uazapi"));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(FAKE_ADMIN_TOKEN);
    expect(JSON.parse(text).data).toMatchObject({ ok: true, code: "ok", source: "workspace", instances: 0 });
    expect(fake.calls.map((c) => `${c.method} ${c.path.split("?")[0]}`)).toEqual(["GET /status", "GET /instance/all"]);
    expect(fake.calls[0].headers.admintoken).toBeUndefined();
    expect(fake.calls[1].headers.admintoken).toBe(FAKE_ADMIN_TOKEN);
    expect((await auditRows()).at(-1)).toMatchObject({ action: "tested", service: "uazapi", field: null });
  });

  it("uazapi com token errado: unauthorized", async () => {
    await put("uazapi", "adminToken", "token-errado-0000");
    const r = await testIntegration("uazapi", "ws_a", { system: prisma, env: {} });
    expect(r).toMatchObject({ ok: false, code: "unauthorized" });
    await put("uazapi", "adminToken", FAKE_ADMIN_TOKEN);
  });

  it("OpenWA: /api/health com a chave operator", async () => {
    const r = await testIntegration("openwa", "ws_a", { system: prisma, env: {} });
    expect(r).toMatchObject({ ok: true, code: "ok", source: "workspace" });
    expect(openwa.calls.at(-1)).toMatchObject({ method: "GET", path: "/api/health", key: OPENWA_KEY });
  });

  it("nada configurado e servidor fora do ar", async () => {
    expect(await testIntegration("openwa", "ws_b", { system: prisma, env: {} })).toMatchObject({ ok: false, code: "not_configured" });
    const down = await testIntegration("openwa", "ws_b", {
      system: prisma,
      env: { OPENWA_BASE_URL: "http://127.0.0.1:1", OPENWA_API_KEY: "x" },
    });
    expect(down).toMatchObject({ ok: false, code: "unreachable", source: "env" });
  });

  it("URL salva que passou a resolver pra rede interna é bloqueada antes de chamar", async () => {
    h.dns[GW_HOST] = ["192.168.0.10"];
    const before = openwa.calls.length;
    expect(await testIntegration("openwa", "ws_a", { system: prisma, env: {} })).toMatchObject({ ok: false, code: "url_blocked" });
    expect(openwa.calls.length).toBe(before);
  });

  it("limite: o 11º teste em 10 minutos recebe 429", async () => {
    h.hits = 10;
    expect((await testRoute.POST(req("/x", "POST"), serviceParams("openwa"))).status).toBe(429);
  });
});

describe("Conectores e worker com a credencial do workspace", () => {
  const deps = (): PainelDeps => ({
    repo: new PrismaWaRepository(prisma),
    queue: new FakeQueue(),
    app: prisma,
    system: prisma,
    env: { WHATSAPP_ENABLED: "1", BETTER_AUTH_URL: "https://app.exemplo.com" },
  });

  it("painel: vagas e conectar um número pela uazapi salva em Canais (sem variável no ambiente)", async () => {
    expect(await uazapiOverview(deps(), "ws_a")).toMatchObject({ configured: true, max: 3, used: 0, remaining: 3, source: "server" });
    expect(await uazapiOverview(deps(), "ws_b")).toMatchObject({ configured: false });
    expect(await serverStatus(deps(), "ws_a")).toMatchObject({ uazapiConfigured: true, gatewayConfigured: true });

    const out = await createSession(
      { userId: "u_dono", workspaceId: "ws_a" },
      { provider: "UAZAPI", acceptRisk: true, proxy: { country: "br", city: "campinas" } },
      deps()
    );
    expect(out.session.provider).toBe("UAZAPI");
    const create = fake.calls.find((c) => c.path === "/instance/create");
    expect(create?.headers.admintoken).toBe(FAKE_ADMIN_TOKEN);
  });

  it("Bia (sem nada salvo e sem ambiente) não conecta pela uazapi do Matheus", async () => {
    await expect(
      createSession({ userId: "u_bia", workspaceId: "ws_b" }, { provider: "UAZAPI", acceptRisk: true, proxy: { country: "br", city: "campinas" } }, deps())
    ).rejects.toMatchObject({ code: "uazapi_off", status: 503 });
  });

  it("worker: acha a credencial pelo workspace do número e envia pela uazapi do workspace", async () => {
    const repo = new PrismaWaRepository(prisma);
    const row = await db.query<{ id: string }>(`SELECT id FROM whatsapp."WaSession" WHERE "workspaceId" = 'ws_a' AND provider = 'UAZAPI' LIMIT 1`);
    const session = await repo.getSession(row.rows[0].id);
    expect(session?.instanceToken).toBeTruthy();
    const creds = await sessionCredentials(session!, { system: prisma, env: {} });
    expect(creds.uazapi?.serverUrl).toBe(UAZ_URL);
    const connector = createConnector(session!, { credentials: creds });
    fake.instances[0].status = "connected";
    await connector.sendText("5511999990000", "oi");
    const send = fake.calls.find((c) => c.path === "/send/text");
    expect(send?.headers.token).toBe(session!.instanceToken);
  });

  it("worker: número OpenWA do workspace usa a URL e a chave salvas em Canais", async () => {
    await db.exec(`INSERT INTO whatsapp."WaSession"(id, "workspaceId", "ownerUserId", provider, "providerSessionId", status, "updatedAt")
                   VALUES ('s_owa', 'ws_a', 'u_dono', 'OPENWA', 'owa-1', 'CONNECTED', now())`);
    const repo = new PrismaWaRepository(prisma);
    const session = await repo.getSession("s_owa");
    const creds = await sessionCredentials(session!, { system: prisma, env: { OPENWA_BASE_URL: "http://outro:1", OPENWA_API_KEY: "env" } });
    expect(creds.openwa).toEqual({ baseUrl: GW_URL, apiKey: OPENWA_KEY });
    const connector = createConnector({ ...session!, riskAcceptedAt: new Date() }, { credentials: creds });
    await connector.sendText("5511999990000", "oi");
    expect(openwa.calls.at(-1)).toMatchObject({ method: "POST", path: "/api/sessions/owa-1/messages/send-text", key: OPENWA_KEY });
  });

  it("número de outro workspace sem nada salvo continua no ambiente", async () => {
    const creds = await sessionCredentials(
      { provider: "OPENWA", workspaceId: "ws_b", instanceToken: null },
      { system: prisma, env: { OPENWA_BASE_URL: "http://openwa:2785", OPENWA_API_KEY: "env-key" } }
    );
    expect(creds.openwa).toEqual({ baseUrl: "http://openwa:2785", apiKey: "env-key" });
  });
});
