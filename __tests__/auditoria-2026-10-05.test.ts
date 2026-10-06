/**
 * Auditoria de segurança (05/10):
 * - chave de API criada em Configurações só age no workspace onde foi criada
 *   (nunca no workspace mais antigo do dono);
 * - um Authorization inválido não cai pro cookie da sessão;
 * - IP do visitante = último item do X-Forwarded-For (o que o proxy põe),
 *   não o primeiro (que qualquer um escolhe);
 * - link de privacidade do quiz não aceita "/\host" (vira outro site).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  authorization: null as string | null,
  session: null as { user: { id: string; role?: string; twoFactorEnabled?: boolean } } | null,
  resolved: null as null | { userId: string; tokenId: string; scopes: string[]; workspaceId: string | null },
  findUnique: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => (k.toLowerCase() === "authorization" ? h.authorization : null) }),
}));
// Fase 0: login novo (Better Auth). A sessão vem do getAuth().api.getSession.
vi.mock("@/lib/better-auth", () => ({
  getAuth: () => ({
    api: {
      getSession: async () =>
        h.session
          ? {
              user: { email: "pessoa@example.com", name: "", image: null, role: "USER", twoFactorEnabled: false, ...h.session.user },
              session: { id: "s1", expiresAt: new Date(Date.now() + 60_000) },
            }
          : null,
    },
  }),
}));
vi.mock("@/lib/api-token-auth", () => ({ resolveApiToken: vi.fn(async () => h.resolved) }));
vi.mock("@/lib/db/client", () => ({
  prisma: {
    workspaceMember: { findUnique: h.findUnique, findFirst: h.findFirst },
    user: { findUnique: vi.fn(async () => ({ email: "dono@example.com" })) },
  },
}));
vi.mock("@/lib/workspace", () => ({
  ensureWorkspaceForUser: vi.fn(async () => ({ id: "ws_novo" })),
  getPrimaryWorkspace: vi.fn(async () => ({ id: "ws_antigo" })),
}));
vi.mock("@/lib/auth-signin", () => ({ allowSignIn: vi.fn(async () => true) }));

import { getCurrentUserId, getCurrentWorkspaceId, needsTwoFactorSetup } from "../lib/auth";
import { getCurrentWorkspaceContext } from "../lib/workspace-access";
import { getRequestIp } from "../lib/tracking/server";
import { isLocalPath } from "../lib/funnels/media";

const KEY = { userId: "u_dono", tokenId: "tok_1", scopes: [], workspaceId: "ws_da_chave" };

beforeEach(() => {
  h.authorization = null;
  h.session = null;
  h.resolved = null;
  h.findUnique.mockReset();
  h.findFirst.mockReset();
  h.findFirst.mockResolvedValue({ workspaceId: "ws_antigo", workspace: { id: "ws_antigo" }, role: "OWNER" });
});

describe("chave de API presa ao workspace dela", () => {
  it("getCurrentWorkspaceContext usa o workspace da chave, não o mais antigo do dono", async () => {
    h.authorization = "Bearer or_x";
    h.resolved = KEY;
    h.findUnique.mockResolvedValue({ workspaceId: "ws_da_chave", workspace: { id: "ws_da_chave" }, role: "OWNER" });
    const ctx = await getCurrentWorkspaceContext();
    expect(ctx?.workspaceId).toBe("ws_da_chave");
    expect(h.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId_userId: { workspaceId: "ws_da_chave", userId: "u_dono" } } })
    );
    expect(h.findFirst).not.toHaveBeenCalled();
  });

  it("dono que não é mais membro daquele workspace = sem acesso (falha fechada)", async () => {
    h.authorization = "Bearer or_x";
    h.resolved = KEY;
    h.findUnique.mockResolvedValue(null);
    expect(await getCurrentWorkspaceContext()).toBeNull();
  });

  it("getCurrentWorkspaceId também devolve o workspace da chave", async () => {
    h.authorization = "Bearer or_x";
    h.resolved = KEY;
    expect(await getCurrentWorkspaceId()).toBe("ws_da_chave");
  });

  it("chave do deploy (sem workspace) continua no workspace principal do usuário", async () => {
    h.authorization = "Bearer env";
    h.resolved = { ...KEY, tokenId: "env", workspaceId: null };
    expect(await getCurrentWorkspaceId()).toBe("ws_antigo");
    expect((await getCurrentWorkspaceContext())?.workspaceId).toBe("ws_antigo");
  });

  it("sessão (sem Authorization) segue igual", async () => {
    h.session = { user: { id: "u_pessoa" } };
    expect(await getCurrentUserId()).toBe("u_pessoa");
    expect((await getCurrentWorkspaceContext())?.workspaceId).toBe("ws_antigo");
  });
});

describe("fase 0: login novo", () => {
  it("admin sem 2FA não usa o painel (getCurrentUserId = ninguém)", async () => {
    h.session = { user: { id: "u_admin", role: "ADMIN", twoFactorEnabled: false } };
    expect(await getCurrentUserId()).toBeNull();
    expect(await getCurrentWorkspaceContext()).toBeNull();
  });

  it("admin com 2FA ligado usa normalmente", async () => {
    h.session = { user: { id: "u_admin", role: "ADMIN", twoFactorEnabled: true } };
    expect(await getCurrentUserId()).toBe("u_admin");
  });

  it("a chave de API do admin continua funcionando e presa ao workspace dela", async () => {
    h.session = { user: { id: "u_admin", role: "ADMIN", twoFactorEnabled: false } };
    h.authorization = "Bearer or_x";
    h.resolved = { ...KEY, userId: "u_admin" };
    h.findUnique.mockResolvedValue({ workspaceId: "ws_da_chave", workspace: { id: "ws_da_chave" }, role: "OWNER" });
    expect(await getCurrentUserId()).toBe("u_admin");
    expect(await getCurrentWorkspaceId()).toBe("ws_da_chave");
    expect((await getCurrentWorkspaceContext())?.workspaceId).toBe("ws_da_chave");
  });

  it("a mesma regra pro needsTwoFactorSetup", () => {
    expect(needsTwoFactorSetup({ role: "ADMIN", twoFactorEnabled: false })).toBe(true);
    expect(needsTwoFactorSetup({ role: "ADMIN", twoFactorEnabled: true })).toBe(false);
    expect(needsTwoFactorSetup({ role: "USER", twoFactorEnabled: false })).toBe(false);
    expect(needsTwoFactorSetup(null)).toBe(false);
  });
});

describe("Authorization inválido não vira sessão", () => {
  it("chave errada + cookie válido = ninguém", async () => {
    h.authorization = "Bearer chave-errada";
    h.resolved = null;
    h.session = { user: { id: "u_pessoa" } };
    expect(await getCurrentUserId()).toBeNull();
    expect(await getCurrentWorkspaceId()).toBeNull();
    expect(await getCurrentWorkspaceContext()).toBeNull();
  });
});

describe("IP do visitante", () => {
  const req = (xff: string) => new Request("https://x.test/", { headers: { "x-forwarded-for": xff } });
  it("usa o último item (posto pelo proxy), não o que o cliente mandou", () => {
    expect(getRequestIp(req("1.2.3.4, 203.0.113.9"))).toBe("203.0.113.9");
    expect(getRequestIp(req("203.0.113.9"))).toBe("203.0.113.9");
    expect(getRequestIp(req(" 9.9.9.9 ,  ,203.0.113.9 "))).toBe("203.0.113.9");
  });
});

describe("link de privacidade do quiz", () => {
  it("aceita caminho do site e recusa o que o navegador lê como outro site", () => {
    expect(isLocalPath("/privacy")).toBe(true);
    expect(isLocalPath("//evil.example")).toBe(false);
    expect(isLocalPath("/\\evil.example")).toBe(false);
    expect(isLocalPath("/\tevil")).toBe(false);
    expect(isLocalPath("privacy")).toBe(false);
  });
});
