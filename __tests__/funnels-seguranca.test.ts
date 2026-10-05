/**
 * Etapa 6, revisão de segurança: limite de corpo nas rotas do painel/MCP do
 * quiz e comparação do hottok sem vazar o tamanho do segredo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  const funnel = {
    create: vi.fn(async () => null),
    update: vi.fn(async () => null),
    findFirst: vi.fn(async () => null as unknown),
    findMany: vi.fn(async () => []),
  };
  const prisma = new Proxy({} as Record<string, unknown>, {
    get(_t, name: string) {
      if (name === "funnel") return funnel;
      if (name === "$queryRaw") return vi.fn(async () => []);
      return new Proxy({}, { get: () => vi.fn(async () => null) });
    },
  });
  return { prisma, funnel, mockContext: vi.fn(), mockCaller: vi.fn() };
});

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: h.mockContext,
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));
vi.mock("@/lib/auth", () => ({ getApiCaller: h.mockCaller }));

import * as listRoute from "../app/api/funnels/route";
import * as funnelRoute from "../app/api/funnels/[id]/route";
import * as duplicateRoute from "../app/api/funnels/[id]/duplicate/route";
import { MAX_PANEL_BODY } from "../lib/funnels/limits";
import { hottokMatches } from "../lib/funnels/hotmart";

const CTX = { userId: "u_A", workspaceId: "ws_A", workspace: { id: "ws_A" }, role: "OWNER" };
const params = (id = "f_1") => ({ params: Promise.resolve({ id }) });

function rawReq(path: string, method: string, text: string) {
  return new NextRequest(new URL(path, "http://localhost"), {
    method,
    headers: { "content-type": "application/json" },
    body: text,
  });
}

const huge = JSON.stringify({ name: "x", draft: { pad: "a".repeat(MAX_PANEL_BODY + 10) } });

beforeEach(() => {
  vi.clearAllMocks();
  h.mockContext.mockResolvedValue(CTX);
  h.mockCaller.mockResolvedValue({ kind: "token", tokenId: "tok_1", scopes: [] });
  h.funnel.findFirst.mockResolvedValue({
    id: "f_1",
    workspaceId: "ws_A",
    name: "Quiz",
    slug: "quiz",
    status: "DRAFT",
    draft: null,
    published: null,
    publishedVersion: 0,
    publishedAt: null,
    templateId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

describe("corpo grande nas rotas do quiz (painel e chave)", () => {
  it("POST /api/funnels acima do limite = 413 e nada é criado", async () => {
    const res = await listRoute.POST(rawReq("/api/funnels", "POST", huge));
    expect(res.status).toBe(413);
    expect(JSON.stringify(await res.json())).toContain("too_large");
    expect(h.funnel.create).not.toHaveBeenCalled();
  });

  it("PATCH /api/funnels/[id] acima do limite = 413 e nada muda", async () => {
    const res = await funnelRoute.PATCH(rawReq("/api/funnels/f_1", "PATCH", huge), params());
    expect(res.status).toBe(413);
    expect(h.funnel.update).not.toHaveBeenCalled();
  });

  it("duplicate acima do limite = 413", async () => {
    const res = await duplicateRoute.POST(rawReq("/api/funnels/f_1/duplicate", "POST", huge), params());
    expect(res.status).toBe(413);
  });

  it("JSON quebrado continua 400 (não 413 nem 500)", async () => {
    const res = await listRoute.POST(rawReq("/api/funnels", "POST", "{nao é json"));
    expect(res.status).toBe(400);
  });
});

describe("hottok", () => {
  it("compara por digest: tamanhos diferentes não quebram e não batem", () => {
    expect(hottokMatches("abc", "abcd")).toBe(false);
    expect(hottokMatches("x".repeat(5000), "abc")).toBe(false);
    expect(hottokMatches("segredo", "segredo")).toBe(true);
    expect(hottokMatches(null, "segredo")).toBe(false);
  });
});
