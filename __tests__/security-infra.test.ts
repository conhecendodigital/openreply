/**
 * Revisão de segurança (04/10), parte de infraestrutura:
 * - proxy.ts: chave de API só alcança MCP, cron, health e as rotas que o MCP
 *   usa (lib/api-key-routes.ts), nunca DELETE; sem Authorization passa direto;
 * - headers de segurança no next.config (sem quebrar imagem da Meta);
 * - limite de magic link por e-mail e de chamadas no MCP (falha aberta);
 * - webhook: corpo gigante = 413, assinatura ruim grava no máximo 1 evento
 *   por minuto, verify token em tempo constante;
 * - cron sem segredo nunca passa ("Bearer undefined");
 * - mídia do inbox nunca vira página no nosso domínio; redirect só pra Meta;
 * - /api/health público sem detalhe; diagnóstico só pra dono/admin.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  const counters = new Map<string, number>();
  return {
    counters,
    redisFails: false,
    role: "OWNER" as string,
    redis: {
      incr: vi.fn(async (key: string) => {
        if (h.redisFails) throw new Error("redis down");
        const n = (counters.get(key) ?? 0) + 1;
        counters.set(key, n);
        return n;
      }),
      expire: vi.fn(async () => 1),
      ping: vi.fn(async () => "PONG"),
    },
    prisma: {
      $queryRaw: vi.fn(async () => [1]),
      operationalEvent: { create: vi.fn(async () => ({})) },
      webhookEvent: { create: vi.fn(async () => ({ id: "we1" })), findMany: vi.fn(async () => []) },
      directMedia: { findUnique: vi.fn() },
      instagramAccount: { count: vi.fn(async () => 0), updateMany: vi.fn(async () => ({})) },
      // Fase 0: allowlist do beta vazia (login aberto como antes, sem ALLOWED_EMAILS).
      betaAllowlist: { count: vi.fn(async () => 0), findUnique: vi.fn(async () => null) },
    },
    worker: vi.fn(async () => ({ healthy: true, heartbeat: { hostname: "container-123", pid: 42 }, ageMs: 10 })),
  };
});

vi.mock("@/lib/queue/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/queue/client")>();
  return {
    ...real,
    getRedisConnection: () => h.redis,
    getDMQueue: () => ({ add: vi.fn(), getJobCounts: vi.fn(async () => ({ waiting: 3 })) }),
  };
});
vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/ops/worker-health", () => ({ getWorkerHealth: h.worker, getWorkerAlerts: vi.fn(async () => []) }));
vi.mock("@/lib/auth", () => ({ getCurrentWorkspaceId: vi.fn(async () => "ws") }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({ workspaceId: "ws", userId: "u1", role: h.role })),
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));

import { proxy, config as proxyConfig } from "../proxy";
import { API_KEY_ROUTES, isApiKeyRouteAllowed } from "../lib/api-key-routes";
import nextConfig, { PUBLIC_FUNNEL_CSP, SECURITY_HEADERS } from "../next.config";
import { hitRateLimit, MAGIC_LINK_LIMIT } from "../lib/http-rate-limit";
import { allowSignIn } from "../lib/auth-signin";
import {
  MAX_WEBHOOK_BODY_BYTES,
  resetSignatureFailureThrottle,
  shouldRecordSignatureFailure,
  verifyTokenMatches,
} from "../lib/meta/webhook-guards";
import * as webhook from "../app/api/webhook/route";
import { isCronAuthorized } from "../lib/cron-auth";
import { mediaHeaders } from "../lib/messages/media-headers";
import * as media from "../app/api/inbox/media/[id]/route";
import * as health from "../app/api/health/route";
import * as diagnostics from "../app/api/admin/diagnostics/route";

function req(path: string, method = "GET", headers: Record<string, string> = {}, body?: string) {
  return new NextRequest(new URL(path, "http://localhost"), { method, headers, ...(body !== undefined ? { body } : {}) });
}
const BEARER = { authorization: "Bearer chave-qualquer-da-ia-com-mais-de-32-caracteres" };

beforeEach(() => {
  vi.clearAllMocks();
  h.counters.clear();
  h.redisFails = false;
  h.role = "OWNER";
  vi.unstubAllEnvs();
});

describe("proxy: chave de API só nas rotas do MCP", () => {
  it.each([
    ["POST", "/api/workspace/members"],
    ["PATCH", "/api/workspace/members"],
    ["POST", "/api/workspace/api-tokens"],
    ["POST", "/api/automations/import"],
    ["DELETE", "/api/automations"],
    ["DELETE", "/api/segments/s1"],
    ["POST", "/api/broadcasts/b1/send"],
    ["DELETE", "/api/channels/c1"],
    ["GET", "/api/admin/diagnostics"],
  ])("%s %s com Bearer = 403", async (method, path) => {
    const res = await proxy(req(path, method, BEARER));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("human_only");
  });

  it.each([
    ["POST", "/api/mcp"],
    ["GET", "/api/cron/refresh-tokens"],
    ["GET", "/api/health"],
    ["GET", "/api/automations"],
    ["PATCH", "/api/automations"],
    ["POST", "/api/drafts/d1/approve"],
    ["POST", "/api/broadcasts"],
  ])("%s %s com Bearer passa (a rota decide)", async (method, path) => {
    expect((await proxy(req(path, method, BEARER))).headers.get("x-middleware-next")).toBe("1");
  });

  it("sem Authorization nada muda (tela, webhook da Meta, login)", async () => {
    for (const [method, path] of [["POST", "/api/webhook"], ["DELETE", "/api/automations"], ["POST", "/api/workspace/members"]]) {
      expect((await proxy(req(path, method))).headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("o proxy roda em todas as rotas (inclusive /api), menos os arquivos estáticos do build", async () => {
    expect(proxyConfig.matcher).toEqual(["/((?!_next/static|_next/image).*)"]);
  });

  it("toda rota do lib/mcp/routes.ts está liberada pra chave (MCP não quebra)", async () => {
    const source = readFileSync(join(__dirname, "../lib/mcp/routes.ts"), "utf8");
    const patterns = [...source.matchAll(/\[\/(\^\\\/api[^\s]*?\$)\/,/g)].map((m) => m[1]);
    expect(patterns.length).toBeGreaterThan(30);
    for (const pattern of patterns) {
      const sample = pattern.replace(/^\^/, "").replace(/\$$/, "").replace(/\(\[\^\/\]\+\)/g, "x1").replace(/\\\//g, "/");
      for (const method of ["GET", "POST", "PATCH"]) {
        expect(isApiKeyRouteAllowed(method, sample), `${method} ${sample}`).toBe(true);
      }
      expect(isApiKeyRouteAllowed("DELETE", sample)).toBe(false);
    }
    expect(API_KEY_ROUTES.length).toBeGreaterThan(0);
  });
});

describe("headers de segurança", () => {
  it("anti-iframe, nosniff, HSTS, referrer e sem x-powered-by", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const rules = await nextConfig.headers!();
    expect(rules[0].source).toBe("/:path*");
    const map = Object.fromEntries(rules[0].headers.map((x) => [x.key, x.value]));
    expect(map["X-Frame-Options"]).toBe("DENY");
    expect(map["X-Content-Type-Options"]).toBe("nosniff");
    expect(map["Strict-Transport-Security"]).toContain("max-age=31536000");
    expect(map["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(map["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
  });

  it("a CSP não bloqueia imagem da Meta nem script do Next (sem default-src/img-src/script-src)", async () => {
    const csp = SECURITY_HEADERS.find((x) => x.key === "Content-Security-Policy")!.value;
    expect(csp).not.toMatch(/default-src|img-src|script-src|connect-src/);
  });
});

describe("limites de requisição", () => {
  it("conta por janela e bloqueia depois do limite", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await hitRateLimit("t", "a@ex.com", 3, 60)).allowed);
    expect(results).toEqual([true, true, true, false]);
    expect(h.redis.expire).toHaveBeenCalledTimes(1);
    // Outro e-mail tem a própria conta.
    expect((await hitRateLimit("t", "b@ex.com", 3, 60)).allowed).toBe(true);
  });

  it("Redis fora do ar = deixa passar (nunca trava o login)", async () => {
    h.redisFails = true;
    expect((await hitRateLimit("t", "a@ex.com", 1, 60)).allowed).toBe(true);
  });

  it("Redis travado = deixa passar em até ~0,5s", async () => {
    const stuck = { incr: () => new Promise<number>(() => {}), expire: async () => 1 };
    const started = Date.now();
    expect((await hitRateLimit("t", "a@ex.com", 1, 60, stuck)).allowed).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("magic link: no máximo 5 por e-mail por hora; verificar o link nunca é limitado", async () => {
    const send = { user: { email: "dono@ex.com" }, email: { verificationRequest: true } };
    const answers = [];
    for (let i = 0; i < MAGIC_LINK_LIMIT.limit + 1; i++) answers.push(await allowSignIn(send));
    expect(answers.slice(0, MAGIC_LINK_LIMIT.limit).every(Boolean)).toBe(true);
    expect(answers[MAGIC_LINK_LIMIT.limit]).toBe(false);
    expect(await allowSignIn({ user: { email: "dono@ex.com" }, email: { verificationRequest: false } })).toBe(true);
  });

  it("magic link: e-mail fora do ALLOWED_EMAILS continua barrado", async () => {
    vi.stubEnv("ALLOWED_EMAILS", "dono@ex.com");
    const semConvite = async () => false;
    expect(await allowSignIn({ user: { email: "intruso@ex.com" }, email: { verificationRequest: true } }, semConvite)).toBe(false);
    expect(await allowSignIn({ user: { email: "dono@ex.com" }, email: { verificationRequest: true } }, semConvite)).toBe(true);
  });

  it("magic link: convidado entra mesmo fora do ALLOWED_EMAILS; erro no banco barra", async () => {
    vi.stubEnv("ALLOWED_EMAILS", "dono@ex.com");
    const convidados = async (email: string) => email === "convidada@ex.com";
    expect(await allowSignIn({ user: { email: "convidada@ex.com" }, email: { verificationRequest: true } }, convidados)).toBe(true);
    expect(await allowSignIn({ user: { email: "convidada@ex.com" }, email: { verificationRequest: false } }, convidados)).toBe(true);
    expect(await allowSignIn({ user: { email: "intruso@ex.com" }, email: { verificationRequest: true } }, convidados)).toBe(false);
    const bancoCaiu = async () => { throw new Error("db down"); };
    expect(await allowSignIn({ user: { email: "convidada@ex.com" }, email: { verificationRequest: true } }, bancoCaiu)).toBe(false);
    expect(await allowSignIn({ user: { email: null }, email: { verificationRequest: true } }, convidados)).toBe(false);
  });
});

describe("webhook da Meta", () => {
  beforeEach(() => {
    resetSignatureFailureThrottle();
    vi.stubEnv("FACEBOOK_APP_SECRET", "test_app_secret_12345");
  });

  it("corpo maior que o teto = 413, antes de ler/gravar", async () => {
    const res = await webhook.POST(
      req("/api/webhook", "POST", { "content-length": String(MAX_WEBHOOK_BODY_BYTES + 1) }, "{}")
    );
    expect(res.status).toBe(413);
    expect(h.prisma.operationalEvent.create).not.toHaveBeenCalled();
    expect(h.prisma.webhookEvent.create).not.toHaveBeenCalled();
  });

  it("o teto é folgado pra payload real da Meta (5 MB)", async () => {
    expect(MAX_WEBHOOK_BODY_BYTES).toBeGreaterThanOrEqual(5 * 1024 * 1024);
  });

  it("assinatura inválida em rajada grava 1 evento, não 1 por request", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await webhook.POST(req("/api/webhook", "POST", { "x-hub-signature-256": "sha256=errada" }, '{"a":1}'));
      expect(res.status).toBe(401);
    }
    expect(h.prisma.operationalEvent.create).toHaveBeenCalledTimes(1);
    expect(shouldRecordSignatureFailure(Date.now() + 61_000)).toBe(true);
  });

  it("verify token: igual passa, diferente/vazio/sem env não", async () => {
    expect(verifyTokenMatches("abc", "abc")).toBe(true);
    expect(verifyTokenMatches("abd", "abc")).toBe(false);
    expect(verifyTokenMatches("ab", "abc")).toBe(false);
    expect(verifyTokenMatches(null, "abc")).toBe(false);
    expect(verifyTokenMatches("abc", undefined)).toBe(false);
    vi.stubEnv("WEBHOOK_VERIFY_TOKEN", "meu-token");
    const ok = await webhook.GET(req("/api/webhook?hub.mode=subscribe&hub.verify_token=meu-token&hub.challenge=42"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("42");
    const bad = await webhook.GET(req("/api/webhook?hub.mode=subscribe&hub.verify_token=outro&hub.challenge=42"));
    expect(bad.status).toBe(403);
  });
});

describe("cron", () => {
  it("sem CRON_SECRET e sem NEXTAUTH_SECRET nunca passa (nem 'Bearer undefined')", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NEXTAUTH_SECRET", "");
    expect(isCronAuthorized("Bearer undefined")).toBe(false);
    expect(isCronAuthorized("Bearer ")).toBe(false);
    expect(isCronAuthorized(null)).toBe(false);
  });

  it("CRON_SECRET certo passa; o fallback NEXTAUTH_SECRET continua valendo por enquanto", async () => {
    vi.stubEnv("CRON_SECRET", "segredo-do-cron");
    expect(isCronAuthorized("Bearer segredo-do-cron")).toBe(true);
    expect(isCronAuthorized("Bearer segredo-do-cro")).toBe(false);
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NEXTAUTH_SECRET", "segredo-da-sessao");
    expect(isCronAuthorized("Bearer segredo-da-sessao")).toBe(true);
  });
});

describe("mídia do inbox", () => {
  it("foto/vídeo/áudio abrem inline; html, svg e desconhecido viram download", async () => {
    expect(mediaHeaders("image/jpeg")["Content-Type"]).toBe("image/jpeg");
    expect(mediaHeaders("video/mp4")["Content-Disposition"]).toBeUndefined();
    expect(mediaHeaders("audio/mpeg")["Content-Type"]).toBe("audio/mpeg");
    for (const bad of ["text/html", "image/svg+xml", "application/xhtml+xml", null, ""]) {
      const headers = mediaHeaders(bad);
      expect(headers["Content-Type"]).toBe("application/octet-stream");
      expect(headers["Content-Disposition"]).toBe("attachment");
    }
    expect(mediaHeaders("image/png")["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("mídia salva com mime perigoso sai como download", async () => {
    h.prisma.directMedia.findUnique.mockResolvedValue({
      status: "saved", mime: "text/html", data: Buffer.from("<script>alert(1)</script>"), originalUrl: "https://x.example",
      message: { workspaceId: "ws", accountId: "acc" },
    });
    const res = await media.GET(req("/api/inbox/media/m1"), { params: Promise.resolve({ id: "m1" }) });
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toBe("attachment");
  });

  it("redirect só pro CDN da Meta; outro site = 404", async () => {
    const row = (url: string) => ({ status: "failed", mime: null, data: null, originalUrl: url, message: { workspaceId: "ws", accountId: "acc" } });
    h.prisma.directMedia.findUnique.mockResolvedValue(row("https://evil.example/x"));
    expect((await media.GET(req("/api/inbox/media/m1"), { params: Promise.resolve({ id: "m1" }) })).status).toBe(404);
    h.prisma.directMedia.findUnique.mockResolvedValue(row("https://scontent.cdninstagram.com/v/x.jpg"));
    const ok = await media.GET(req("/api/inbox/media/m1"), { params: Promise.resolve({ id: "m1" }) });
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toContain("cdninstagram.com");
  });
});

describe("health e diagnóstico", () => {
  it("público: só ok/erro, sem mensagem de erro, contagem nem host/pid", async () => {
    h.prisma.$queryRaw.mockRejectedValueOnce(new Error("connect ECONNREFUSED postgres://admin@db-host:5432"));
    const res = await health.GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(503);
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/ECONNREFUSED|db-host|admin|container-123|"pid"|waiting/);
    expect(text).toContain('"status":"error"');
  });

  it("com o segredo do cron mostra o detalhe", async () => {
    vi.stubEnv("CRON_SECRET", "segredo-do-cron");
    const res = await health.GET(new Request("http://localhost/api/health", { headers: { authorization: "Bearer segredo-do-cron" } }));
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain("container-123");
  });

  it("diagnóstico: membro comum = 403", async () => {
    h.role = "MEMBER";
    expect((await diagnostics.GET()).status).toBe(403);
  });
});

// Etapa 6 (quiz): só casos novos.
describe("quiz (funis)", () => {
  it.each([
    ["POST", "/api/funnels/f1/publish"],
    ["POST", "/api/funnels/f1/unpublish"],
    ["GET", "/api/funnels/f1/leads"],
    ["GET", "/api/funnels/f1/leads/export"],
    ["DELETE", "/api/funnels/f1"],
  ])("%s %s com Bearer = 403 no proxy", async (method, path) => {
    const res = await proxy(req(path, method, BEARER));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("human_only");
  });

  it("rascunho por chave passa (a rota decide)", async () => {
    for (const [method, path] of [["POST", "/api/funnels"], ["PATCH", "/api/funnels/f1"], ["GET", "/api/funnels/f1/results"]]) {
      expect((await proxy(req(path, method, BEARER))).headers.get("x-middleware-next"), path).toBe("1");
    }
  });

  it("APIs públicas do quiz e webhook da Hotmart sem Authorization passam", async () => {
    for (const path of ["/api/q/chat/event", "/api/q/chat/lead", "/api/webhooks/hotmart"]) {
      expect((await proxy(req(path, "POST"))).headers.get("x-middleware-next"), path).toBe("1");
    }
  });

  it("/quizzes deslogado vai pro login; /q é público", async () => {
    const res = await proxy(req("/quizzes/f1"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login?callbackUrl=%2Fquizzes%2Ff1");
    // /q passa direto no host do painel (público, sem login).
    const q = await proxy(req("/q/qualquer"));
    expect(q.headers.get("x-middleware-next")).toBe("1");
    expect(q.headers.get("location")).toBeNull();
  });

  it("/q tem CSP de iframe fechada (só vídeo e Facebook) e mantém frame-ancestors; a regra geral não muda", async () => {
    const rules = await nextConfig.headers!();
    expect(rules[0].source).toBe("/:path*");
    expect(rules[0].headers).toEqual(SECURITY_HEADERS);
    const q = rules.find((r) => r.source === "/q/:path*")!;
    const csp = q.headers.find((x) => x.key === "Content-Security-Policy")!.value;
    expect(csp).toBe(PUBLIC_FUNNEL_CSP);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/frame-src https:\/\/www\.youtube-nocookie\.com https:\/\/www\.youtube\.com https:\/\/player\.vimeo\.com https:\/\/\*\.pandavideo\.com\.br https:\/\/www\.facebook\.com/);
    expect(csp).not.toMatch(/script-src|connect-src|default-src/);
  });
});
