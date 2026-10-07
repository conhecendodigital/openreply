/**
 * Chaves de IA no /admin e Gastos de IA (06/10/2026), num Postgres de verdade
 * (PGlite) com todas as migrações e as rotas de verdade:
 * - salvar, trocar e remover a chave; a chave nunca volta em resposta;
 * - não-admin, admin sem 2FA e chave de API recebem 403;
 * - Testar com provedor de mentira (ok e erro), sem vazar a chave, URL oficial
 *   fixa e limite de testes;
 * - getAiCredential / getAgentModelConfig leem a chave e os modelos e tetos;
 * - RLS: só o admin lê as chaves; cada usuário só vê o próprio gasto;
 * - custo pela tabela de preços, filtros do relatório, CSV sem fórmula,
 *   alerta de 80% do teto.
 */
import { openAiReasoningEffort } from "@/lib/ai/catalog";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { PrismaClient } from "../app/generated/prisma/client";
import { migratedDb, startPrisma } from "./helpers/pglite-db";

const h = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string; role: "USER" | "ADMIN"; twoFactorEnabled: boolean } },
  byKey: false,
  hits: 0,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () =>
    h.session ? { user: { name: null, image: null, ...h.session.user }, session: { id: "s", expiresAt: new Date() } } : null
  ),
  isApiTokenRequest: vi.fn(async () => h.byKey),
  needsTwoFactorSetup: (u: { role: string; twoFactorEnabled: boolean } | null) => Boolean(u && u.role === "ADMIN" && !u.twoFactorEnabled),
}));
vi.mock("@/lib/http-rate-limit", () => ({
  hitRateLimit: vi.fn(async (_b: string, _id: string, limit: number) => {
    h.hits += 1;
    return { allowed: h.hits <= limit, count: h.hits, limit };
  }),
}));

process.env.ENCRYPTION_KEY = "a".repeat(64);

import { withRls } from "../lib/db/rls";
import { isApiKeyRouteAllowed } from "../lib/api-key-routes";
import { DEFAULT_PRICES, MODEL_HAIKU, MODEL_SONNET, defaultSettings, normalizeSettings, parseSettingsInput } from "../lib/ai/catalog";
import { getAgentModelConfig, getAiCredential, getAiSettings, saveAiCredential } from "../lib/ai/credentials";
import { OFFICIAL_TEST_URLS, redactSecrets, testAiKey } from "../lib/ai/provider-test";
import {
  capAlerts,
  capUse,
  checkDailyCap,
  costMicroUsd,
  getUsageCsv,
  getUsageReport,
  parseUsageFilters,
  recordAiUsage,
  resolvePeriod,
  usageCsv,
} from "../lib/ai/usage";
import * as aiRoute from "../app/api/admin/ai/route";
import * as settingsRoute from "../app/api/admin/ai/settings/route";
import * as credRoute from "../app/api/admin/ai/credentials/[provider]/route";
import * as testRoute from "../app/api/admin/ai/credentials/[provider]/test/route";
import * as usageRoute from "../app/api/admin/ai/usage/route";
import * as myUsageRoute from "../app/api/account/ai-usage/route";

const ANTHROPIC_KEY = "sk-ant-api03-SEGREDO-do-dono-1234567890abcd";
const OPENAI_KEY = "sk-proj-SEGREDO-openai-0987654321wxyz";

let db: PGlite;
let prisma: PrismaClient;
let stop: () => Promise<void>;

const ADMIN = { id: "u_admin", email: "matheus@ex.com", role: "ADMIN" as const, twoFactorEnabled: true };
const BIA = { id: "u_bia", email: "bia@ex.com", role: "USER" as const, twoFactorEnabled: false };
const CAIO = { id: "u_caio", email: "caio@ex.com", role: "USER" as const, twoFactorEnabled: false };

beforeAll(async () => {
  db = await migratedDb();
  await db.exec(`
    INSERT INTO "User"(id, email, "updatedAt", role) VALUES
      ('u_admin', 'matheus@ex.com', now(), 'ADMIN'),
      ('u_bia', 'bia@ex.com', now(), 'USER'),
      ('u_caio', 'caio@ex.com', now(), 'USER');
    INSERT INTO "Workspace"(id, name, "ownerId", "updatedAt") VALUES
      ('ws_b', 'Loja da Bia', 'u_bia', now()),
      ('ws_c', 'Caio Imóveis', 'u_caio', now());
    INSERT INTO "WorkspaceMember"(id, "workspaceId", "userId", role) VALUES
      ('wm1', 'ws_b', 'u_bia', 'OWNER'),
      ('wm2', 'ws_c', 'u_caio', 'OWNER');
  `);
  ({ prisma, stop } = await startPrisma(db));
  // As rotas usam o cliente de sempre (lib/db/client.ts): aponta pro PGlite.
  (globalThis as unknown as { prisma?: PrismaClient }).prisma = prisma;
}, 60_000);

afterAll(async () => {
  await stop?.();
  await db?.close();
});

beforeEach(() => {
  h.session = { user: ADMIN };
  h.byKey = false;
  h.hits = 0;
  vi.unstubAllGlobals();
});

function req(path: string, method = "GET", body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}
const params = (provider: string) => ({ params: Promise.resolve({ provider }) });

async function text(res: Response) {
  return res.text();
}

describe("Chaves de IA: salvar, trocar e remover", () => {
  it("salva, mostra só os 4 últimos e nunca devolve a chave", async () => {
    const res = await credRoute.PUT(req("/api/admin/ai/credentials/anthropic", "PUT", { key: ANTHROPIC_KEY }), params("anthropic"));
    const body = await text(res);
    expect(res.status).toBe(200);
    expect(body).not.toContain("SEGREDO");
    expect(body).not.toContain("keyEnc");
    expect(JSON.parse(body).data.credential).toMatchObject({ provider: "anthropic", keyLast4: "abcd", active: true });

    const list = await text(await aiRoute.GET());
    expect(list).not.toContain("SEGREDO");
    expect(list).not.toContain("keyEnc");
    expect(list).toContain('"keyLast4":"abcd"');

    // No banco fica cifrada.
    const [row] = await db.query<{ keyEnc: string }>(`SELECT "keyEnc" FROM "PlatformAiCredential" WHERE provider = 'anthropic'`).then((r) => r.rows);
    expect(row.keyEnc).not.toContain("SEGREDO");
  });

  it("trocar substitui a chave e grava quem trocou na auditoria", async () => {
    const novo = "sk-ant-api03-SEGREDO-novo-000000000000efgh";
    const res = await credRoute.PUT(req("/api/admin/ai/credentials/anthropic", "PUT", { key: novo }), params("anthropic"));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ replaced: true, credential: { keyLast4: "efgh" } });
    expect((await getAiCredential("anthropic", prisma))?.apiKey).toBe(novo);

    const logs = await db.query<{ adminUserId: string; resource: string; resourceId: string; reason: string }>(
      `SELECT "adminUserId", resource, "resourceId", reason FROM "AdminAccessLog" WHERE resource = 'ai.credential' ORDER BY "createdAt"`
    );
    expect(logs.rows.map((r) => r.reason)).toEqual(["salvou a chave", "trocou a chave"]);
    expect(logs.rows.every((r) => r.adminUserId === "u_admin" && r.resourceId === "anthropic")).toBe(true);
    expect(JSON.stringify(logs.rows)).not.toContain("SEGREDO");
  });

  it("chave com formato errado não é salva", async () => {
    const res = await credRoute.PUT(req("/api/admin/ai/credentials/openai", "PUT", { key: "sk-ant-api03-isso-e-da-anthropic-123" }), params("openai"));
    expect(res.status).toBe(400);
    expect(await getAiCredential("openai", prisma)).toBeNull();
    const bad = await credRoute.PUT(req("/api/admin/ai/credentials/gemini", "PUT", { key: OPENAI_KEY }), params("gemini"));
    expect(bad.status).toBe(404);
  });

  it("remover apaga a chave, registra e o agente deixa de receber", async () => {
    await credRoute.PUT(req("/api/admin/ai/credentials/openai", "PUT", { key: OPENAI_KEY }), params("openai"));
    expect((await getAiCredential("openai", prisma))?.keyLast4).toBe("wxyz");
    const res = await credRoute.DELETE(req("/api/admin/ai/credentials/openai", "DELETE"), params("openai"));
    expect(res.status).toBe(200);
    expect(await getAiCredential("openai", prisma)).toBeNull();
    const again = await credRoute.DELETE(req("/api/admin/ai/credentials/openai", "DELETE"), params("openai"));
    expect(again.status).toBe(404);
    const logs = await db.query<{ reason: string }>(`SELECT reason FROM "AdminAccessLog" WHERE "resourceId" = 'openai' ORDER BY "createdAt"`);
    expect(logs.rows.map((r) => r.reason)).toEqual(["salvou a chave", "removeu a chave"]);
  });
});

describe("Chaves de IA: quem entra", () => {
  const calls = () => [
    aiRoute.GET(),
    credRoute.PUT(req("/x", "PUT", { key: ANTHROPIC_KEY }), params("anthropic")),
    credRoute.DELETE(req("/x", "DELETE"), params("anthropic")),
    testRoute.POST(req("/x", "POST", {}), params("anthropic")),
    settingsRoute.PUT(req("/x", "PUT", { dailyCapUserUsd: 50 })),
    usageRoute.GET(req("/api/admin/ai/usage")),
  ];

  it("usuário comum recebe 403 em todas as rotas", async () => {
    h.session = { user: BIA };
    for (const r of await Promise.all(calls())) expect(r.status).toBe(403);
  });

  it("admin sem 2FA recebe 403", async () => {
    h.session = { user: { ...ADMIN, twoFactorEnabled: false } };
    for (const r of await Promise.all(calls())) expect(r.status).toBe(403);
  });

  it("chave de API recebe 403, mesmo junto com a sessão do admin", async () => {
    h.byKey = true;
    for (const r of await Promise.all(calls())) expect(r.status).toBe(403);
    const mine = await myUsageRoute.GET(req("/api/account/ai-usage"));
    expect(mine.status).toBe(403);
  });

  it("sem sessão recebe 401", async () => {
    h.session = null;
    for (const r of await Promise.all(calls())) expect(r.status).toBe(401);
  });

  it("as rotas novas não estão liberadas pra chave de API no proxy", () => {
    for (const p of ["/api/admin/ai", "/api/admin/ai/settings", "/api/admin/ai/credentials/openai", "/api/admin/ai/credentials/openai/test", "/api/admin/ai/usage", "/api/account/ai-usage"]) {
      for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE"]) expect(isApiKeyRouteAllowed(m, p)).toBe(false);
    }
  });

  it("nada mudou: a chave salva continua a mesma", async () => {
    expect((await getAiCredential("anthropic", prisma))?.keyLast4).toBe("efgh");
  });
});

describe("RLS das chaves e configurações", () => {
  it("usuário comum não lê nem grava chave, mesmo direto no banco", async () => {
    const rows = await withRls({ userId: "u_bia", workspaceId: "ws_b" }, (tx) => tx.platformAiCredential.findMany(), prisma);
    expect(rows).toEqual([]);
    await expect(
      withRls(
        { userId: "u_bia", workspaceId: "ws_b" },
        (tx) =>
          tx.platformAiCredential.create({
            data: { provider: "typesafe", keyEnc: "x", keyLast4: "x", createdById: "u_bia", updatedById: "u_bia" },
          }),
        prisma
      )
    ).rejects.toThrow();
    const settings = await withRls({ userId: "u_bia", workspaceId: "ws_b" }, (tx) => tx.platformAiSettings.findMany(), prisma);
    expect(settings).toEqual([]);
  });

  it("saveAiCredential como usuário comum é recusado pela RLS", async () => {
    await expect(saveAiCredential({ adminUserId: "u_bia", provider: "typesafe", key: "ts_live_abcdefghijklmnopqrstuvwxyz" }, prisma)).rejects.toThrow();
    expect(await getAiCredential("typesafe", prisma)).toBeNull();
  });
});

describe("Testar a chave", () => {
  it("chama a URL oficial fixa (ignora OPENAI_BASE_URL) e diz ok", async () => {
    process.env.OPENAI_BASE_URL = "http://localhost:11434/v1";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await testRoute.POST(req("/x", "POST", { key: OPENAI_KEY }), params("openai"));
    const body = await text(res);
    expect(res.status).toBe(200);
    expect(JSON.parse(body).data).toEqual({ ok: true, message: "The key works." });
    expect(body).not.toContain("SEGREDO");
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe("https://api.openai.com/v1/models");
    delete process.env.OPENAI_BASE_URL;
  });

  it("Anthropic: max_tokens 1 no Haiku 4.5, com a chave salva", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await testRoute.POST(req("/x", "POST", {}), params("anthropic"));
    expect((await res.json()).data.ok).toBe(true);
    const [url, init] = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toBe(OFFICIAL_TEST_URLS.anthropic);
    expect(JSON.parse(String(init.body))).toMatchObject({ model: MODEL_HAIKU, max_tokens: 1 });
  });

  it("erro do provedor vem em português, sem a chave (nem se o provedor ecoar)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { type: "authentication_error", message: `invalid x-api-key ${ANTHROPIC_KEY}` } }), { status: 401 })
      )
    );
    const res = await testRoute.POST(req("/x", "POST", { key: ANTHROPIC_KEY }), params("anthropic"));
    const body = await text(res);
    expect(body).not.toContain("SEGREDO");
    expect(body).not.toContain(ANTHROPIC_KEY);
    const data = JSON.parse(body).data;
    expect(data.ok).toBe(false);
    expect(data.status).toBe(401);
    expect(data.message).toBe("The provider refused this key. Check that you copied all of it.");
    expect(data.detail).toContain("invalid x-api-key");
  });

  it("sem saldo, fora do ar e sem rede viram mensagens claras", async () => {
    const f = (status: number, msg: string) => vi.fn(async () => new Response(JSON.stringify({ error: { message: msg } }), { status }));
    expect((await testAiKey("anthropic", ANTHROPIC_KEY, { fetchImpl: f(400, "Your credit balance is too low") })).message).toMatch(/balance/);
    expect((await testAiKey("openai", OPENAI_KEY, { fetchImpl: f(429, "quota") })).message).toMatch(/limit or the balance/);
    expect((await testAiKey("typesafe", "ts_abcdefghijklmnopqrstuvwxyz", { fetchImpl: f(503, "down") })).message).toMatch(/unstable/);
    const offline = await testAiKey("openai", OPENAI_KEY, { fetchImpl: vi.fn(async () => { throw new TypeError("fetch failed"); }) });
    expect(offline).toMatchObject({ ok: false, message: "Could not reach the provider." });
  });

  it("TypeSafe: a chamada mais barata do jev.py (1 pergunta sim/não)", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    await testAiKey("typesafe", "ts_abcdefghijklmnopqrstuvwxyz", { fetchImpl: fetchMock });
    const [url, init] = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    const sent = JSON.parse(String(init.body));
    expect(sent.model).toBe("jev-latest");
    expect(Object.values(sent.questions)).toEqual([{ type: "noul", instructions: expect.any(String) }]);
  });

  it("redactSecrets tira chave e token", () => {
    expect(redactSecrets(`erro ${OPENAI_KEY} Bearer abc.def`, OPENAI_KEY)).not.toMatch(/SEGREDO|abc\.def/);
  });

  it("limite: o 11º teste em 10 minutos recebe 429", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    for (let i = 0; i < 10; i++) expect((await testRoute.POST(req("/x", "POST", {}), params("anthropic"))).status).toBe(200);
    expect((await testRoute.POST(req("/x", "POST", {}), params("anthropic"))).status).toBe(429);
  });
});

describe("Modelos e tetos lidos pelos agentes", () => {
  it("padrão: Haiku 4.5 no dia a dia, Sonnet 5 no difícil, US$ 1 e US$ 3", async () => {
    const cfg = await getAgentModelConfig("atendimento", prisma);
    expect(cfg).toEqual({
      agent: "atendimento",
      provider: "anthropic",
      model: MODEL_HAIKU,
      hardModel: MODEL_SONNET,
      dailyCapUserUsd: 1,
      dailyCapWorkspaceUsd: 3,
    });
  });

  it("o admin muda pela rota e o agente lê na hora", async () => {
    const res = await settingsRoute.PUT(
      req("/x", "PUT", {
        agents: { suporte: { provider: "openai", model: "gpt-5-mini", hardModel: "gpt-5-mini" } },
        dailyCapUserUsd: 2,
        dailyCapWorkspaceUsd: "5,5",
        usdToBrl: 5.4,
      })
    );
    expect(res.status).toBe(200);
    expect(await getAgentModelConfig("suporte", prisma)).toMatchObject({ provider: "openai", model: "gpt-5-mini", dailyCapUserUsd: 2, dailyCapWorkspaceUsd: 5.5 });
    expect((await getAgentModelConfig("qualificacao", prisma)).model).toBe(MODEL_HAIKU);
    const log = await db.query(`SELECT 1 FROM "AdminAccessLog" WHERE resource = 'ai.settings'`);
    expect(log.rows.length).toBe(1);
  });

  it("modelo sem preço na tabela é recusado", async () => {
    const res = await settingsRoute.PUT(req("/x", "PUT", { agents: { suporte: { provider: "openai", model: "gpt-9", hardModel: "gpt-9" } } }));
    expect(res.status).toBe(400);
    const bad = parseSettingsInput({ dailyCapUserUsd: -1 }, defaultSettings());
    expect(bad.ok).toBe(false);
  });

  it("configuração estragada no banco volta pros padrões", () => {
    const s = normalizeSettings({ agentModels: { atendimento: { provider: "x" } }, prices: "lixo", dailyCapUserUsd: "abc" });
    expect(s.agents.atendimento.model).toBe(MODEL_HAIKU);
    expect(s.prices[MODEL_HAIKU]).toEqual(DEFAULT_PRICES[MODEL_HAIKU]);
    expect(s.dailyCapUserUsd).toBe(1);
  });
});

describe("Gastos de IA", () => {
  const now = new Date("2026-10-06T15:00:00Z"); // 12h em Brasília

  it("custo pela tabela de preços (micro dólar, arredonda pra cima)", () => {
    const p = DEFAULT_PRICES;
    expect(costMicroUsd(p[MODEL_HAIKU], { tokensIn: 1_000_000, tokensOut: 1_000_000 })).toBe(6_000_000);
    expect(costMicroUsd(p[MODEL_SONNET], { tokensIn: 1000, tokensOut: 500 })).toBe(7000);
    expect(costMicroUsd(p["gpt-5-mini"], { tokensIn: 1000, tokensOut: 1000 })).toBe(2250);
    expect(costMicroUsd(p["text-embedding-3-small"], { tokensIn: 1_000_000 })).toBe(20_000);
    expect(costMicroUsd(p[MODEL_HAIKU], { tokensIn: 100, cacheRead: 10_000, cacheWrite: 1000 })).toBe(100 + 1000 + 1250);
    expect(costMicroUsd(undefined, { tokensIn: 999 })).toBe(0);
    expect(costMicroUsd(p[MODEL_HAIKU], { tokensIn: 1 })).toBe(1);
  });

  it("grava cada chamada com o custo do preço atual; bloqueada custa 0", async () => {
    const settings = await getAiSettings(prisma);
    const base = { base: prisma, settings };
    const at = (iso: string) => db.query(`UPDATE whatsapp."WaAiUsage" SET "createdAt" = '${iso}' WHERE "refId" = 'last'`);
    const rec = async (e: Parameters<typeof recordAiUsage>[0], iso: string) => {
      const r = await recordAiUsage({ ...e, refId: "last" }, base);
      await at(iso);
      await db.query(`UPDATE whatsapp."WaAiUsage" SET "refId" = NULL WHERE "refId" = 'last'`);
      return r;
    };
    // Bia: hoje 0,85 dólar (85% do teto de US$ 1... que agora é 2) e ontem.
    const a = await rec({ ownerUserId: "u_bia", workspaceId: "ws_b", kind: "agent", agent: "atendimento", provider: "anthropic", model: MODEL_HAIKU, conversationId: "cv1", contactId: "ct1", tokensIn: 100_000, tokensOut: 100_000 }, "2026-10-06T13:00:00Z");
    expect(a).toEqual({ recorded: true, costMicroUsd: 600_000, priced: true });
    await rec({ ownerUserId: "u_bia", workspaceId: "ws_b", kind: "agent", agent: "qualificacao", provider: "anthropic", model: MODEL_SONNET, conversationId: "cv2", tokensIn: 50_000, tokensOut: 100_000 }, "2026-10-06T14:00:00Z");
    await rec({ ownerUserId: "u_bia", workspaceId: "ws_b", kind: "embedding", agent: "cerebro", provider: "openai", model: "text-embedding-3-small", tokensIn: 1_000_000 }, "2026-10-05T14:00:00Z");
    const blocked = await rec({ ownerUserId: "u_bia", workspaceId: "ws_b", kind: "agent", agent: "suporte", provider: "anthropic", model: MODEL_SONNET, tokensIn: 50_000, blocked: true }, "2026-10-06T14:30:00Z");
    expect(blocked.costMicroUsd).toBe(0);
    // Caio: pouco gasto hoje, e um gasto de mês passado.
    await rec({ ownerUserId: "u_caio", workspaceId: "ws_c", kind: "triage", agent: "triagem", provider: "typesafe", model: "jev-latest", tokensIn: 1_000_000 }, "2026-10-06T12:00:00Z");
    await rec({ ownerUserId: "u_caio", workspaceId: "ws_c", kind: "agent", agent: "atendimento", provider: "openai", model: "gpt-5-mini", conversationId: "cv9", tokensIn: 1000, tokensOut: 1000 }, "2026-09-20T12:00:00Z");
    const total = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM whatsapp."WaAiUsage"`);
    expect(total.rows[0].n).toBe(6);
    // Sem dado pessoal: o contato vai só pelo id.
    const cols = await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'whatsapp' AND table_name = 'WaAiUsage'`);
    expect(cols.rows.map((c) => c.column_name)).not.toEqual(expect.arrayContaining(["contactName", "phone", "body"]));
  });

  it("RLS: cada usuário só vê o próprio gasto, o admin vê todos", async () => {
    const bia = await withRls({ userId: "u_bia", workspaceId: "ws_b" }, (tx) => tx.waAiUsage.findMany(), prisma);
    expect(new Set(bia.map((r) => r.ownerUserId))).toEqual(new Set(["u_bia"]));
    const caioForcing = await withRls({ userId: "u_caio", workspaceId: "ws_b" }, (tx) => tx.waAiUsage.findMany({ where: { ownerUserId: "u_bia" } }), prisma);
    expect(caioForcing).toEqual([]);
    const admin = await withRls({ userId: "u_admin", workspaceId: null }, (tx) => tx.waAiUsage.findMany(), prisma);
    expect(admin.length).toBe(6);
    // Ninguém apaga nem edita pelo papel da aplicação.
    await expect(withRls({ userId: "u_admin", workspaceId: null }, (tx) => tx.waAiUsage.deleteMany({}), prisma)).rejects.toThrow();
    await expect(
      withRls({ userId: "u_bia", workspaceId: "ws_b" }, (tx) => tx.waAiUsage.updateMany({ data: { costMicroUsd: BigInt(0) } }), prisma)
    ).rejects.toThrow();
  });

  it("filtros: período, usuário, agente, provedor e modelo", async () => {
    const settings = await getAiSettings(prisma);
    const labels = { users: async () => ({ u_bia: "bia@ex.com", u_caio: "caio@ex.com" }), workspaces: async () => ({ ws_b: "Loja da Bia" }) };
    const run = async (q: string) => {
      const f = parseUsageFilters(new URLSearchParams(q), now);
      if (!f.ok) throw new Error(f.error);
      return getUsageReport({ userId: "u_admin", admin: true }, f.filters, { base: prisma, settings, now, labels });
    };
    const today = await run("period=today");
    expect(today.totals.calls).toBe(4);
    expect(today.totals.costMicroUsd).toBe(600_000 + 1_100_000 + 42_000);
    expect(today.totals.blockedCalls).toBe(1);

    const week = await run("period=7d");
    expect(week.totals.calls).toBe(5);
    expect(week.byDay.map((d) => d.day)).toEqual(["2026-10-05", "2026-10-06"]);
    expect(week.byUser[0]).toMatchObject({ key: "u_bia", label: "bia@ex.com" });
    expect(week.totals.conversations).toBe(2);
    expect(week.totals.avgPerConversationMicroUsd).toBe((600_000 + 1_100_000) / 2);
    expect(week.totals.responses).toBe(2);

    expect((await run("period=month")).totals.calls).toBe(5);
    expect((await run("period=30d")).totals.calls).toBe(6);
    expect((await run("period=custom&from=2026-09-20&to=2026-09-20")).totals.calls).toBe(1);
    expect((await run("period=7d&userId=u_caio")).totals.calls).toBe(1);
    expect((await run("period=7d&workspaceId=ws_b")).totals.calls).toBe(4);
    expect((await run("period=7d&agent=cerebro")).totals.costMicroUsd).toBe(20_000);
    expect((await run("period=7d&provider=typesafe")).byModel.map((m) => m.model)).toEqual(["jev-latest"]);
    expect((await run(`period=7d&model=${MODEL_SONNET}`)).totals.calls).toBe(2);
  });

  it("usuário comum: o relatório ignora filtro de outra pessoa", async () => {
    const settings = await getAiSettings(prisma);
    const f = parseUsageFilters(new URLSearchParams("period=30d&userId=u_bia"), now);
    if (!f.ok) throw new Error();
    const caio = await getUsageReport({ userId: "u_caio", admin: false }, f.filters, { base: prisma, settings, now });
    expect(caio.totals.calls).toBe(2);
    expect(caio.byUser.map((u) => u.key)).toEqual(["u_caio"]);
    expect(caio.byUser[0].label).toBeNull();
  });

  it("período personalizado inválido dá erro claro", () => {
    expect(resolvePeriod("custom", { from: "2026-10-06", to: "2026-10-01" }, now)).toMatchObject({ ok: false });
    expect(resolvePeriod("custom", { from: "2026-02-30", to: "2026-03-01" }, now)).toMatchObject({ ok: false });
    expect(resolvePeriod("custom", { from: "2024-01-01", to: "2026-01-01" }, now)).toMatchObject({ ok: false });
    const today = resolvePeriod("today", {}, now);
    expect(today.ok && today.from.toISOString()).toBe("2026-10-06T03:00:00.000Z");
  });

  it("alerta de 80%: aparece pra quem passou, no admin e no painel da pessoa", async () => {
    // Teto do usuário agora é US$ 2: Bia gastou US$ 1,70 hoje = 85%.
    const settings = await getAiSettings(prisma);
    const f = parseUsageFilters(new URLSearchParams("period=today"), now);
    if (!f.ok) throw new Error();
    const admin = await getUsageReport({ userId: "u_admin", admin: true }, f.filters, {
      base: prisma, settings, now, labels: { users: async () => ({ u_bia: "bia@ex.com" }), workspaces: async () => ({}) },
    });
    expect(admin.alerts).toEqual([expect.objectContaining({ kind: "user", id: "u_bia", label: "bia@ex.com" })]);
    expect(admin.alerts[0].ratio).toBeCloseTo(0.85, 5);
    const bia = await getUsageReport({ userId: "u_bia", admin: false }, f.filters, { base: prisma, settings, now });
    expect(bia.alerts.map((a) => a.id)).toEqual(["u_bia"]);
    const caio = await getUsageReport({ userId: "u_caio", admin: false }, f.filters, { base: prisma, settings, now });
    expect(caio.alerts).toEqual([]);

    expect(capAlerts(capUse([{ id: "a", spentMicroUsd: 790_000 }, { id: "b", spentMicroUsd: 800_000 }], 1), [])).toEqual([
      expect.objectContaining({ id: "b", kind: "user" }),
    ]);
  });

  it("teto antes de chamar: barra quem passaria do teto", async () => {
    const settings = await getAiSettings(prisma);
    const ok = await checkDailyCap({ ownerUserId: "u_caio", workspaceId: "ws_c", expectedCostMicroUsd: 10_000, now }, { base: prisma, settings });
    expect(ok.ok).toBe(true);
    const no = await checkDailyCap({ ownerUserId: "u_bia", workspaceId: "ws_b", expectedCostMicroUsd: 400_000, now }, { base: prisma, settings });
    expect(no).toMatchObject({ ok: false, reason: "teto_usuario", spentMicroUsd: 1_700_000, capMicroUsd: 2_000_000 });
  });

  it("CSV: protegido contra fórmula, com R$ quando há cotação", async () => {
    const csv = usageCsv(
      [{ createdAt: new Date("2026-10-06T12:00:00Z"), ownerUserId: "u1", workspaceId: "ws", kind: "agent", agent: "atendimento", provider: "openai", model: "=HYPERLINK(1)", contactId: "+5511", conversationId: "@x", tokensIn: 1, tokensOut: 2, cacheRead: 0, cacheWrite: 0, costMicroUsd: BigInt(1500), blocked: false }],
      { usdToBrl: 5, emails: { u1: "-cmd@ex.com" } }
    );
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv).toContain("'+5511");
    expect(csv).toContain("'@x");
    expect(csv).toContain("'-cmd@ex.com");
    expect(csv).toContain("custo_brl");
    expect(csv).toContain("0.0015,0.0075");

    const settings = await getAiSettings(prisma);
    const f = parseUsageFilters(new URLSearchParams("period=30d"), now);
    if (!f.ok) throw new Error();
    const mine = await getUsageCsv({ userId: "u_caio", admin: false }, f.filters, { base: prisma, settings });
    const lines = mine.trim().split("\r\n");
    expect(lines.length).toBe(3);
    expect(mine).not.toContain("u_bia");
    expect(mine).not.toContain("usuario_email");
  });

  it("rotas do relatório: admin vê todos e o CSV baixa; usuário vê só o dele", async () => {
    const res = await usageRoute.GET(req("/api/admin/ai/usage?period=30d"));
    expect(res.status).toBe(200);
    expect((await res.json()).data.totals.calls).toBeGreaterThanOrEqual(6);
    const csv = await usageRoute.GET(req("/api/admin/ai/usage?period=30d&format=csv"));
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(await csv.text()).toContain("usuario_email");

    h.session = { user: CAIO };
    const mine = await myUsageRoute.GET(req("/api/account/ai-usage?period=30d&userId=u_bia"));
    const data = (await mine.json()).data;
    expect(data.byUser.map((u: { key: string }) => u.key)).toEqual(["u_caio"]);
    expect(JSON.stringify(data)).not.toContain("bia@ex.com");
  });
});

describe("modelos Luna da OpenAI", () => {
  it("aparecem mesmo com tabela de preço salva antes", () => {
    const s = normalizeSettings({ prices: { "gpt-5-mini": { provider: "openai", input: 0.3, output: 2 } } });
    expect(s.prices["gpt-5-mini"].input).toBe(0.3);
    expect(s.prices["gpt-6-luna"]).toMatchObject({ provider: "openai", input: 0.1, output: 0.5 });
    expect(s.prices["gpt-5.6-luna"]).toMatchObject({ provider: "openai", input: 0.2, output: 1.2 });
    const a = normalizeSettings({ agentModels: { atendimento: { provider: "openai", model: "gpt-6-luna", hardModel: "gpt-5.6-luna" } } });
    expect(a.agents.atendimento).toMatchObject({ model: "gpt-6-luna", hardModel: "gpt-5.6-luna" });
  });
  it("Luna não recebe minimal (a OpenAI recusa)", () => {
    expect(openAiReasoningEffort("gpt-5-mini")).toBe("minimal");
    expect(openAiReasoningEffort("gpt-6-luna")).toBe("low");
    expect(openAiReasoningEffort("gpt-5.6-luna")).toBe("low");
  });
});
