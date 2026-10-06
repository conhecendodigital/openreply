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

describe("allowlist do beta", () => {
  it("sem nenhuma lista, fica aberto como antes", async () => {
    expect(await as("qualquer@ex.com")).toBe(true);
  });

  it("uma linha na BetaAllowlist fecha o login pros outros", async () => {
    h.beta = new Set(["bia@ex.com"]);
    expect(await as("bia@ex.com")).toBe(true);
    expect(await as("Bia@Ex.com")).toBe(true);
    expect(await as("intruso@ex.com")).toBe(false);
    expect(await as(null)).toBe(false);
  });

  it("ALLOWED_EMAILS e BetaAllowlist somam", async () => {
    vi.stubEnv("ALLOWED_EMAILS", "matheus@ex.com");
    h.beta = new Set(["bia@ex.com"]);
    expect(await as("matheus@ex.com")).toBe(true);
    expect(await as("bia@ex.com")).toBe(true);
    expect(await as("intruso@ex.com")).toBe(false);
  });

  it("banco fora do ar = fechado", async () => {
    h.dbDown = true;
    expect(await as("qualquer@ex.com")).toBe(false);
  });

  it("e-mail da allowlist é sempre normalizado", () => {
    expect(normalizeAllowlistEmail("  Bia@Ex.COM ")).toBe("bia@ex.com");
    expect(normalizeAllowlistEmail("não é email")).toBeNull();
  });
});

describe("proxy com o cookie do login novo", () => {
  const req = (path: string, cookie?: string) =>
    new NextRequest(new URL(path, "http://localhost"), { headers: cookie ? { cookie } : {} });

  it("reconhece o cookie do Better Auth e ignora o do NextAuth", () => {
    expect(hasSessionCookie(req("/dashboard", "better-auth.session_token=x"))).toBe(true);
    expect(hasSessionCookie(req("/dashboard", "__Secure-better-auth.session_token=x"))).toBe(true);
    expect(hasSessionCookie(req("/dashboard", "authjs.session-token=velho"))).toBe(false);
  });

  it("cookie velho do NextAuth manda pro login, e /login não volta pro painel sozinho (sem laço)", () => {
    const r = proxy(req("/settings", "__Secure-authjs.session-token=velho"));
    expect(r.headers.get("location")).toContain("/login?callbackUrl=%2Fsettings");
    expect(proxy(req("/login", "better-auth.session_token=vencido")).headers.get("location")).toBeNull();
  });

  it("/admin e /account também pedem login", () => {
    expect(proxy(req("/admin")).headers.get("location")).toContain("/login");
    expect(proxy(req("/account/two-factor")).headers.get("location")).toContain("/login");
  });
});
