/**
 * Link curto e domínio dos links (07/10/2026), num Postgres de verdade
 * (PGlite) com todas as migrações e as rotas de verdade:
 * - migração só aditiva, depois de 20261020120000, RLS forçada na tabela nova;
 * - RLS: membro lê só o workspace ativo, ninguém grava pelo le_app;
 * - o código é curto, estável por pessoa e atualiza a DM;
 * - /r/<slug>/<codigo> resolve o contato certo e conta o clique com dmLog;
 * - /r/<slug>?c= antigo continua;
 * - robô e HEAD não contam;
 * - domínio do link: só /r/* e só os links daquele workspace;
 * - salvar o domínio confere se ele chega no Lead Engine.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import type { PrismaClient } from "../app/generated/prisma/client";
import { migratedDb, migrationNames, startPrisma } from "./helpers/pglite-db";

const h = vi.hoisted(() => ({
  ctx: null as null | { userId: string; workspaceId: string; role: "OWNER" | "ADMIN" | "MEMBER" },
  byKey: false,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => null),
  isApiTokenRequest: vi.fn(async () => h.byKey),
}));
vi.mock("@/lib/workspace-access", () => ({
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
  getCurrentWorkspaceContext: vi.fn(async () => (h.ctx ? { ...h.ctx, workspace: { id: h.ctx.workspaceId, name: "ws" } } : null)),
}));
vi.mock("@/lib/http-rate-limit", () => ({
  hitRateLimit: vi.fn(async () => ({ allowed: true, count: 1, limit: 20 })),
}));
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) => {
    if (host === "interno.cloudmatheus.com.br") return [{ address: "10.0.0.8", family: 4 }];
    return [{ address: "104.21.12.34", family: 4 }];
  }),
}));

import { ensureRecipientCode, resolveRecipientCode, CODE_RE } from "../lib/links/codes";
import { invalidateLinkDomainCache } from "../lib/links/domain";
import { recipientLinkUrls } from "../lib/links/urls";
import { recipientToken } from "../lib/tracking/recipient";
import { LINK_PING_BODY } from "../lib/links/hosts";
import * as shortRoute from "../app/r/[slug]/[code]/route";
import * as slugRoute from "../app/r/[slug]/route";
import * as domainRoute from "../app/api/workspace/link-domain/route";
import { proxy } from "../proxy";

const NAME = "20261021120000_links_previa_curto";
const APP = "https://many.leadenginer.com";
const LINK_HOST = "comando.cloudmatheus.com.br";
const PERSON_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0";

let db: PGlite;
let prisma: PrismaClient;
let stop: () => Promise<void>;

beforeAll(async () => {
  db = await migratedDb();
  await db.exec(`
    INSERT INTO "User"(id, email, name, "updatedAt") VALUES
      ('u_dono', 'dono@ex.com', 'Matheus', now()),
      ('u_kay', 'kay@ex.com', 'Kayanne', now()),
      ('u_bia', 'bia@ex.com', 'Bia', now());
    INSERT INTO "Workspace"(id, name, "ownerId", "updatedAt", "linkDomain") VALUES
      ('ws_a', 'Matheus', 'u_dono', now(), '${LINK_HOST}'),
      ('ws_b', 'Loja da Bia', 'u_bia', now(), NULL);
    INSERT INTO "WorkspaceMember"(id, "workspaceId", "userId", role) VALUES
      ('wm1', 'ws_a', 'u_dono', 'OWNER'),
      ('wm2', 'ws_a', 'u_kay', 'MEMBER'),
      ('wm3', 'ws_b', 'u_bia', 'OWNER');
    INSERT INTO "InstagramAccount"(id, "workspaceId", "instagramId", username, "accessToken", "updatedAt") VALUES
      ('acc_a', 'ws_a', '1784_a', 'omatheus.ai', 'enc', now()),
      ('acc_b', 'ws_b', '1784_b', 'lojadabia', 'enc', now());
    INSERT INTO "Automation"(id, "workspaceId", "instagramAccountId", name, keywords, "dmMessage", "updatedAt") VALUES
      ('auto_a', 'ws_a', 'acc_a', 'Chat Sem Frescura', ARRAY['CHAT'], 'oi {link}', now()),
      ('auto_b', 'ws_b', 'acc_b', 'Promo', ARRAY['EU'], 'oi {link}', now());
    INSERT INTO "TrackedLink"(id, "workspaceId", "automationId", slug, label, "destinationUrl", "previewTitle", "updatedAt") VALUES
      ('tl_a', 'ws_a', 'auto_a', 'njuGA_aEXw', 'Primary campaign link', 'https://hotmart.example.com/oferta', 'Chat Sem Frescura', now()),
      ('tl_b', 'ws_b', 'auto_b', 'biaLINK123', 'Primary campaign link', 'https://loja.example.com', NULL, now());
    INSERT INTO "DmLog"(id, "workspaceId", "automationId", "instagramAccountId", "commenterId", "commentText", "commentId", status, "dmSentAt", "updatedAt") VALUES
      ('log_old', 'ws_a', 'auto_a', 'acc_a', 'ig_maria', 'CHAT', 'c1', 'SENT', now() - interval '2 days', now()),
      ('log_new', 'ws_a', 'auto_a', 'acc_a', 'ig_maria', 'CHAT', 'c2', 'SENT', now(), now());
  `);
  ({ prisma, stop } = await startPrisma(db));
  (globalThis as unknown as { prisma?: PrismaClient }).prisma = prisma;
}, 60_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await stop?.();
  await db?.close();
});

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_URL", APP);
  vi.stubEnv("QUIZ_DOMAINS", "");
  invalidateLinkDomainCache();
  h.ctx = { userId: "u_dono", workspaceId: "ws_a", role: "OWNER" };
  h.byKey = false;
});

function request(url: string, init: { method?: string; ua?: string; host?: string } = {}) {
  const u = new URL(url);
  return new NextRequest(url, {
    method: init.method ?? "GET",
    headers: { host: init.host ?? u.host, "user-agent": init.ua ?? PERSON_UA },
  });
}
const short = (slug: string, code: string, init?: Parameters<typeof request>[1], base = `https://${LINK_HOST}`) =>
  shortRoute.GET(request(`${base}/r/${slug}/${code}`, init), { params: Promise.resolve({ slug, code }) });
const old = (slug: string, query = "", init?: Parameters<typeof request>[1], base = APP) =>
  slugRoute.GET(request(`${base}/r/${slug}${query}`, init), { params: Promise.resolve({ slug }) });

async function clicks() {
  return (
    await db.query<{ trackedLinkId: string; contactIgUserId: string | null; dmLogId: string | null }>(
      `SELECT "trackedLinkId", "contactIgUserId", "dmLogId" FROM "LinkClick" ORDER BY "createdAt", id`
    )
  ).rows;
}

/** Runs `sql` as the app role (le_app) for this person and workspace. */
async function asApp<T>(userId: string, workspaceId: string, sql: string): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true), set_config('role', 'le_app', true)`, [userId, workspaceId]);
    return (await tx.query<T>(sql)).rows;
  });
}

describe(`migração ${NAME}`, () => {
  it("vem logo depois de 20261020120000 e só adiciona", () => {
    const names = migrationNames();
    const i = names.indexOf(NAME);
    expect(names[i - 1]).toBe("20261020120000_wa_regras_aprendizado");
    const sql = readFileSync(join(__dirname, "..", "prisma", "migrations", NAME, "migration.sql"), "utf8").replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/\b(DROP\s+(TABLE|COLUMN|INDEX|SCHEMA)|TRUNCATE|ALTER COLUMN|DELETE FROM|UPDATE\s+"?\w+"?\s+SET)\b/i);
  });

  it("TrackedLinkRecipient nasce com RLS forçada", async () => {
    const r = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'TrackedLinkRecipient'`
    );
    expect(r.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
  });
});

describe("código curto", () => {
  it("7 letras e números, o mesmo pra mesma pessoa, e a DM mais nova fica guardada", async () => {
    const a = await ensureRecipientCode({ workspaceId: "ws_a", slug: "njuGA_aEXw", igUserId: "ig_maria", dmLogId: "log_old" });
    expect(a).toMatch(CODE_RE);
    expect(a).toHaveLength(7);
    const again = await ensureRecipientCode({ workspaceId: "ws_a", slug: "njuGA_aEXw", igUserId: "ig_maria", dmLogId: "log_new" });
    expect(again).toBe(a);
    expect(await resolveRecipientCode("njuGA_aEXw", a)).toEqual({ workspaceId: "ws_a", igUserId: "ig_maria", dmLogId: "log_new" });
    const other = await ensureRecipientCode({ workspaceId: "ws_a", slug: "njuGA_aEXw", igUserId: "ig_joao" });
    expect(other).not.toBe(a);
    // Código de um link não vale em outro.
    expect(await resolveRecipientCode("biaLINK123", a)).toBeNull();
    expect(await resolveRecipientCode("njuGA_aEXw", "x")).toBeNull();
  });

  it("RLS: membro lê só o workspace ativo e ninguém grava pelo le_app", async () => {
    await ensureRecipientCode({ workspaceId: "ws_b", slug: "biaLINK123", igUserId: "ig_cliente" });
    const kay = await asApp<{ workspaceId: string }>("u_kay", "ws_a", `SELECT "workspaceId" FROM "TrackedLinkRecipient"`);
    expect(kay.length).toBeGreaterThan(0);
    expect(new Set(kay.map((r) => r.workspaceId))).toEqual(new Set(["ws_a"]));
    // Kayanne pedindo o workspace da Bia: não é membro, não vê nada.
    expect(await asApp("u_kay", "ws_b", `SELECT 1 FROM "TrackedLinkRecipient"`)).toEqual([]);
    expect((await asApp<{ workspaceId: string }>("u_bia", "ws_b", `SELECT "workspaceId" FROM "TrackedLinkRecipient"`)).map((r) => r.workspaceId)).toEqual(["ws_b"]);
    await expect(
      asApp("u_dono", "ws_a", `INSERT INTO "TrackedLinkRecipient"("workspaceId", slug, code, "igUserId") VALUES ('ws_a', 'njuGA_aEXw', 'abcdefg', 'ig_x')`)
    ).rejects.toThrow();
    await expect(asApp("u_dono", "ws_a", `UPDATE "TrackedLinkRecipient" SET "igUserId" = 'ig_x'`)).rejects.toThrow();
  });

  it("o worker monta https://<domínio>/r/<slug>/<codigo>; sem pessoa, só /r/<slug>", async () => {
    const urls = await recipientLinkUrls({ workspaceId: "ws_a", slugs: ["njuGA_aEXw"], recipientId: "ig_maria", dmLogId: "log_new" });
    const code = await ensureRecipientCode({ workspaceId: "ws_a", slug: "njuGA_aEXw", igUserId: "ig_maria" });
    expect(urls.get("njuGA_aEXw")).toBe(`https://${LINK_HOST}/r/njuGA_aEXw/${code}`);
    const pub = await recipientLinkUrls({ workspaceId: "ws_b", slugs: ["biaLINK123"], recipientId: null });
    expect(pub.get("biaLINK123")).toBe(`${APP}/r/biaLINK123`);
  });
});

describe("/r/<slug>/<codigo> e /r/<slug>?c=", () => {
  beforeEach(async () => {
    await db.exec(`DELETE FROM "LinkClick"`);
  });

  it("pessoa: 302 pro destino e o clique vai pra pessoa certa, com a DM do código", async () => {
    const code = await ensureRecipientCode({ workspaceId: "ws_a", slug: "njuGA_aEXw", igUserId: "ig_maria", dmLogId: "log_old" });
    const res = await short("njuGA_aEXw", code);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://hotmart.example.com/oferta");
    expect(await clicks()).toEqual([{ trackedLinkId: "tl_a", contactIgUserId: "ig_maria", dmLogId: "log_old" }]);
  });

  it("código desconhecido: a pessoa vai pro destino, sem crédito", async () => {
    const res = await short("njuGA_aEXw", "ZZZZZZZ");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://hotmart.example.com/oferta");
    expect(await clicks()).toEqual([{ trackedLinkId: "tl_a", contactIgUserId: null, dmLogId: null }]);
  });

  it("?c= antigo continua: credita a pessoa e a última DM enviada", async () => {
    const res = await old("njuGA_aEXw", `?c=${encodeURIComponent(recipientToken("njuGA_aEXw", "ig_maria"))}`);
    expect(res.status).toBe(302);
    expect(await clicks()).toEqual([{ trackedLinkId: "tl_a", contactIgUserId: "ig_maria", dmLogId: "log_new" }]);
  });

  it("robô de prévia e HEAD: 200 com as meta tags e nenhum clique", async () => {
    const code = await ensureRecipientCode({ workspaceId: "ws_a", slug: "njuGA_aEXw", igUserId: "ig_maria" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html></html>", { headers: { "content-type": "text/html" } })));
    try {
      const bot = await short("njuGA_aEXw", code, { ua: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)" });
      expect(bot.status).toBe(200);
      const html = await bot.text();
      expect(html).toContain('<meta property="og:title" content="Chat Sem Frescura">');
      expect(html).toContain(`<meta property="og:url" content="https://${LINK_HOST}/r/njuGA_aEXw">`);
      expect(html).not.toContain("Lead Engine");
      const head = await shortRoute.HEAD(request(`https://${LINK_HOST}/r/njuGA_aEXw/${code}`, { method: "HEAD" }), {
        params: Promise.resolve({ slug: "njuGA_aEXw", code }),
      });
      expect(head.status).toBe(200);
      expect(head.headers.get("location")).toBeNull();
      const wa = await old("njuGA_aEXw", "", { ua: "WhatsApp/2.23.20.0 A" });
      expect(wa.status).toBe(200);
      expect(await clicks()).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("domínio do link", () => {
  beforeEach(async () => {
    await db.exec(`DELETE FROM "LinkClick"`);
  });

  it("só abre os links do workspace dono do domínio", async () => {
    expect((await old("njuGA_aEXw", "", undefined, `https://${LINK_HOST}`)).status).toBe(302);
    // Link da Bia pelo domínio do Matheus: 404, nada contado.
    expect((await old("biaLINK123", "", undefined, `https://${LINK_HOST}`)).status).toBe(404);
    // Host que não é domínio de ninguém: 404.
    expect((await old("njuGA_aEXw", "", undefined, "https://outro.cloudmatheus.com.br")).status).toBe(404);
    // No endereço do app, todos continuam.
    expect((await old("biaLINK123")).status).toBe(302);
    expect((await clicks()).map((c) => c.trackedLinkId)).toEqual(["tl_a", "tl_b"]);
  });

  it("proxy: no domínio do link, /r/*, os ícones e os quizzes publicados (/<slug>); nunca o painel", async () => {
    const at = (path: string) => proxy(new NextRequest(`https://${LINK_HOST}${path}`, { headers: { host: LINK_HOST } }));
    expect((await at("/r/njuGA_aEXw/abc1234")).headers.get("x-middleware-next")).toBe("1");
    expect((await at("/favicon.ico")).headers.get("x-middleware-next")).toBe("1");
    // comando.../diag abre o quiz direto (07/10: sem depender da regra do Cloudflare).
    expect((await at("/diag")).headers.get("x-middleware-rewrite")).toContain("/q/diag");
    expect((await at("/api/q/diag/events")).headers.get("x-middleware-next")).toBe("1");
    // Página do painel com nome de uma palavra vira busca de quiz, nunca a página do app.
    for (const path of ["/dashboard", "/login", "/settings"]) {
      expect((await at(path)).headers.get("x-middleware-rewrite"), path).toContain(`/q${path}`);
    }
    for (const path of ["/", "/api/mcp", "/whatsapp/agents", "/admin/users"]) {
      const res = await at(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("x-middleware-rewrite"), path).toBeNull();
    }
    // O domínio do quiz continua igual.
    const quiz = await proxy(new NextRequest("https://quiz.cloudmatheus.com.br/diag", { headers: { host: "quiz.cloudmatheus.com.br" } }));
    expect(quiz.headers.get("x-middleware-rewrite")).toContain("/q/diag");
  });

  it("listado também em QUIZ_DOMAINS, o domínio mostra o quiz e os links", async () => {
    vi.stubEnv("QUIZ_DOMAINS", `quiz.cloudmatheus.com.br,${LINK_HOST}`);
    const at = (path: string) => proxy(new NextRequest(`https://${LINK_HOST}${path}`, { headers: { host: LINK_HOST } }));
    expect((await at("/diag")).headers.get("x-middleware-rewrite")).toContain("/q/diag");
    expect((await at("/r/njuGA_aEXw")).headers.get("x-middleware-next")).toBe("1");
  });
});

describe("salvar o domínio (Canais)", () => {
  const put = (domain: unknown) =>
    domainRoute.PUT(new NextRequest(`${APP}/api/workspace/link-domain`, { method: "PUT", body: JSON.stringify({ domain }), headers: { "content-type": "application/json" } }));

  it("só salva quando o domínio já chega no Lead Engine (/r/_ping)", async () => {
    h.ctx = { userId: "u_bia", workspaceId: "ws_b", role: "OWNER" };
    const fetchMock = vi.fn(async () => new Response("Not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const notYet = await put("https://links.lojadabia.com.br/");
      expect(notYet.status).toBe(400);
      expect((await notYet.json()).code).toBe("domain_not_pointed");
      expect(fetchMock).toHaveBeenCalledWith("https://links.lojadabia.com.br/r/_ping", expect.objectContaining({ redirect: "manual" }));

      fetchMock.mockImplementation(async () => new Response(LINK_PING_BODY, { status: 200 }));
      const ok = await put("links.lojadabia.com.br");
      expect(ok.status).toBe(200);
      expect((await ok.json()).data).toMatchObject({ domain: "links.lojadabia.com.br", linkBase: "https://links.lojadabia.com.br" });

      // O domínio de outro workspace, o do app, IP e rede interna: recusados.
      expect((await (await put(LINK_HOST)).json()).code).toBe("domain_taken");
      expect((await (await put("many.leadenginer.com")).json()).code).toBe("domain_app");
      expect((await (await put("10.0.0.1")).json()).code).toBe("domain_invalid");
      expect((await (await put("painel.localhost")).json()).code).toBe("domain_internal");
      expect((await (await put("interno.cloudmatheus.com.br")).json()).code).toBe("domain_not_pointed");

      // Remover volta pro endereço do app.
      const removed = await put(null);
      expect((await removed.json()).data).toMatchObject({ domain: null, linkBase: APP });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("membro comum e chave de API não mudam", async () => {
    h.ctx = { userId: "u_kay", workspaceId: "ws_a", role: "MEMBER" };
    expect((await put("x.cloudmatheus.com.br")).status).toBe(403);
    h.ctx = { userId: "u_dono", workspaceId: "ws_a", role: "OWNER" };
    h.byKey = true;
    expect((await put("x.cloudmatheus.com.br")).status).toBe(403);
    expect((await domainRoute.GET()).status).toBe(403);
  });
});
