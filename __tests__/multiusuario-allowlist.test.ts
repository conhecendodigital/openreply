/**
 * Fase 0 (06/10/2026): allowlist (ALLOWED_EMAILS + BetaAllowlist + convites)
 * e o cookie do login novo no proxy.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  beta: new Set<string>(),
  dbDown: false,
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    betaAllowlist: {
      count: vi.fn(async () => {
        if (h.dbDown) throw new Error("db down");
        return h.beta.size;
      }),
      findUnique: vi.fn(async ({ where }: { where: { email: string } }) => (h.beta.has(where.email) ? { email: where.email } : null)),
    },
    workspaceInvitation: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    workspaceMember: { findFirst: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/queue/client", () => ({
  getRedisConnection: () => ({ incr: async () => 1, expire: async () => 1 }),
}));

import { allowSignIn } from "../lib/auth-signin";
import { proxy, hasSessionCookie } from "../proxy";
import { normalizeAllowlistEmail } from "../lib/platform-admin";

beforeEach(() => {
  h.beta = new Set();
  h.dbDown = false;
  vi.unstubAllEnvs();
});

const as = (email: string | null) => allowSignIn({ user: { email } });

describe("login aberto (28/10/2026) e allowlist do beta atrás do interruptor", () => {
  it("sem nenhuma lista, qualquer e-mail entra", async () => {
    expect(await as("qualquer@ex.com")).toBe(true);
  });

  it("aberto mesmo com BetaAllowlist, ALLOWED_EMAILS e banco fora do ar", async () => {
    vi.stubEnv("ALLOWED_EMAILS", "matheus@ex.com");
    h.beta = new Set(["bia@ex.com"]);
    h.dbDown = true;
    expect(await as("intruso@ex.com")).toBe(true);
    expect(await as(null)).toBe(false);
    expect(await as("   ")).toBe(false);
  });

  it("SIGNIN_RESTRICTED=1 fecha: uma linha na BetaAllowlist barra os outros", async () => {
    vi.stubEnv("SIGNIN_RESTRICTED", "1");
    h.beta = new Set(["bia@ex.com"]);
    expect(await as("bia@ex.com")).toBe(true);
    expect(await as("Bia@Ex.com")).toBe(true);
    expect(await as("intruso@ex.com")).toBe(false);
    expect(await as(null)).toBe(false);
  });

  it("SIGNIN_RESTRICTED=1: ALLOWED_EMAILS e BetaAllowlist somam", async () => {
    vi.stubEnv("SIGNIN_RESTRICTED", "true");
    vi.stubEnv("ALLOWED_EMAILS", "matheus@ex.com");
    h.beta = new Set(["bia@ex.com"]);
    expect(await as("matheus@ex.com")).toBe(true);
    expect(await as("bia@ex.com")).toBe(true);
    expect(await as("intruso@ex.com")).toBe(false);
  });

  it("SIGNIN_RESTRICTED=1: banco fora do ar = fechado", async () => {
    vi.stubEnv("SIGNIN_RESTRICTED", "1");
    h.dbDown = true;
    expect(await as("qualquer@ex.com")).toBe(false);
  });

  it("valores que não ligam o interruptor", async () => {
    for (const v of ["", "0", "false", "no"]) {
      vi.stubEnv("SIGNIN_RESTRICTED", v);
      h.beta = new Set(["bia@ex.com"]);
      expect(await as("intruso@ex.com")).toBe(true);
    }
  });

  it("e-mail da allowlist é sempre normalizado", async () => {
    expect(normalizeAllowlistEmail("  Bia@Ex.COM ")).toBe("bia@ex.com");
    expect(normalizeAllowlistEmail("não é email")).toBeNull();
  });
});

describe("proxy com o cookie do login novo", () => {
  const req = (path: string, cookie?: string) =>
    new NextRequest(new URL(path, "http://localhost"), { headers: cookie ? { cookie } : {} });

  it("reconhece o cookie do Better Auth e ignora o do NextAuth", async () => {
    expect(hasSessionCookie(req("/dashboard", "better-auth.session_token=x"))).toBe(true);
    expect(hasSessionCookie(req("/dashboard", "__Secure-better-auth.session_token=x"))).toBe(true);
    expect(hasSessionCookie(req("/dashboard", "authjs.session-token=velho"))).toBe(false);
  });

  it("cookie velho do NextAuth manda pro login, e /login não volta pro painel sozinho (sem laço)", async () => {
    const r = await proxy(req("/settings", "__Secure-authjs.session-token=velho"));
    expect(r.headers.get("location")).toContain("/login?callbackUrl=%2Fsettings");
    expect((await proxy(req("/login", "better-auth.session_token=vencido"))).headers.get("location")).toBeNull();
  });

  it("/admin e /account também pedem login", async () => {
    expect((await proxy(req("/admin"))).headers.get("location")).toContain("/login");
    expect((await proxy(req("/account/two-factor"))).headers.get("location")).toContain("/login");
  });
});

describe("e-mail do login: falha no envio vai pro log sem vazar", () => {
  it("registra a falha com e-mail mascarado, sem chave nem endereço completo", async () => {
    const { sendLoginEmailLogged, maskEmail } = await import("../lib/auth-email");
    expect(maskEmail("robério@ex.com")).toBe("r***@ex.com");
    vi.stubEnv("RESEND_API_KEY", "re_SEGREDO123");
    vi.stubEnv("EMAIL_SERVER", "");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 403 })));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendLoginEmailLogged("roberio@ex.com", "https://x/link")).rejects.toThrow(/403/);
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("r***@ex.com");
    expect(logged).toContain("403");
    expect(logged).not.toContain("roberio@ex.com");
    expect(logged).not.toContain("re_SEGREDO123");
    spy.mockRestore();
    vi.unstubAllGlobals();
  });
});
