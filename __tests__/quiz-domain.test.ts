/**
 * Domínio próprio do quiz (pedido do dono 05/10: "camuflar o link do quiz"):
 * quiz.cloudmatheus.com.br/diag mostra o quiz publicado e mais nada do app.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { isQuizHost, proxy } from "../proxy";

const req = (url: string, headers: Record<string, string> = {}) => new NextRequest(url, { headers });

afterEach(() => vi.unstubAllEnvs());

describe("isQuizHost", () => {
  const env = { NEXTAUTH_URL: "https://many.leadenginer.com" };
  it("o host do painel e os de desenvolvimento não são domínio de quiz", () => {
    expect(isQuizHost("many.leadenginer.com", env)).toBe(false);
    expect(isQuizHost("localhost", env)).toBe(false);
    expect(isQuizHost("127.0.0.1", env)).toBe(false);
    expect(isQuizHost("", env)).toBe(false);
    // o cron chama o web pelo nome interno do serviço (sem ponto)
    expect(isQuizHost("openreply-web-qsbqgu", env)).toBe(false);
    expect(isQuizHost("web", env)).toBe(false);
  });
  it("outro host é domínio de quiz; com QUIZ_DOMAINS só os listados", () => {
    expect(isQuizHost("quiz.cloudmatheus.com.br", env)).toBe(true);
    const listado = { ...env, QUIZ_DOMAINS: "quiz.cloudmatheus.com.br" };
    expect(isQuizHost("quiz.cloudmatheus.com.br", listado)).toBe(true);
    expect(isQuizHost("outro.com", listado)).toBe(false);
  });
  it("sem NEXTAUTH_URL nem lista, nada vira domínio de quiz (fica como o app)", () => {
    expect(isQuizHost("quiz.cloudmatheus.com.br", {})).toBe(false);
  });
});

describe("proxy no domínio do quiz", () => {
  const quiz = (path: string) => req(`https://quiz.cloudmatheus.com.br${path}`, { host: "quiz.cloudmatheus.com.br" });

  it("/<slug> abre o quiz (reescreve pra /q/<slug>)", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://many.leadenginer.com");
    const r = proxy(quiz("/diag"));
    expect(r.headers.get("x-middleware-rewrite")).toContain("/q/diag");
  });

  it("assets, ícones e a API do quiz passam", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://many.leadenginer.com");
    for (const p of ["/_next/static/chunks/a.js", "/favicon.ico", "/og-lead-engine.png", "/api/q/diag/events", "/q/diag"]) {
      const r = proxy(quiz(p));
      expect(r.status, p).toBe(200);
      expect(r.headers.get("x-middleware-next"), p).toBe("1");
    }
  });

  it("API do app, webhooks, sub-rotas do painel e a raiz dão 404", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://many.leadenginer.com");
    for (const p of ["/", "/api/auth/session", "/api/mcp", "/api/webhooks/hotmart", "/api/funnels", "/settings/x", "/quizzes/abc/results"]) {
      expect(proxy(quiz(p)).status, p).toBe(404);
    }
  });

  it("nome de página do painel com uma palavra só vira busca de quiz (nunca a página do app)", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://many.leadenginer.com");
    for (const p of ["/login", "/dashboard", "/quizzes", "/diag/../login"]) {
      const rewrite = proxy(quiz(p)).headers.get("x-middleware-rewrite") ?? "";
      expect(rewrite, p).toMatch(/\/q\/[a-z]+$/);
    }
  });

  it("no host do painel nada muda: /quizzes sem sessão vai pro login", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://many.leadenginer.com");
    const r = proxy(req("https://many.leadenginer.com/quizzes", { host: "many.leadenginer.com" }));
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toContain("/login");
    expect(proxy(req("https://many.leadenginer.com/diag", { host: "many.leadenginer.com" })).headers.get("x-middleware-rewrite")).toBeNull();
  });
});
