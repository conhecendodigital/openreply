/**
 * Etapa 6: rotas /api/funnels do painel. 401 sem login, tudo no workspace de
 * quem chama, funil nasce RASCUNHO, PATCH só mexe no rascunho, publicar /
 * despublicar / apagar / leads só com sessão humana (chave = 403 human_only),
 * publicar bloqueado com colchete, slug livre no POST e 409 no PATCH, CSV
 * protegido contra fórmula.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  const models = new Map<string, Record<string, ReturnType<typeof vi.fn>>>();
  const model = (name: string) => {
    if (!models.has(name)) {
      models.set(
        name,
        new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
          get(target, method: string) {
            if (!target[method]) target[method] = vi.fn(async () => null);
            return target[method];
          },
        })
      );
    }
    return models.get(name)!;
  };
  const queryRaw = vi.fn(async () => [] as unknown[]);
  const prisma = new Proxy({} as Record<string, unknown>, {
    get(_t, name: string) {
      if (name === "$queryRaw") return queryRaw;
      if (name === "$transaction") return vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
      return model(name);
    },
  });
  return {
    prisma: prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>,
    models,
    queryRaw,
    mockContext: vi.fn(),
    mockCaller: vi.fn(),
  };
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
import * as publishRoute from "../app/api/funnels/[id]/publish/route";
import * as unpublishRoute from "../app/api/funnels/[id]/unpublish/route";
import * as resultsRoute from "../app/api/funnels/[id]/results/route";
import * as leadsRoute from "../app/api/funnels/[id]/leads/route";
import * as exportRoute from "../app/api/funnels/[id]/leads/export/route";
import { getFunnelTemplate } from "../lib/funnels/templates";
import type { FunnelDefinition } from "../lib/funnels/types";

const CTX = { userId: "u_A", workspaceId: "ws_A", workspace: { id: "ws_A" }, role: "OWNER" };
const SESSION = { kind: "session" };
const TOKEN = { kind: "token", tokenId: "tok_1", scopes: [] };

function req(path: string, method = "GET", body?: unknown) {
  return new NextRequest(new URL(path, "http://localhost"), {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
const params = (id = "f_1") => ({ params: Promise.resolve({ id }) });

const readyDraft: FunnelDefinition = {
  schemaVersion: 1,
  settings: {
    theme: { mode: "light", primary: "#0095f6", background: "#ffffff", text: "#000000" },
    checkoutUrl: "https://pay.hotmart.com/X1",
  },
  steps: [
    { id: "s1", title: "Capa", blocks: [{ id: "b1", type: "heading", text: "Oi" }, { id: "b2", type: "button", label: "Ir", action: { kind: "next" } }] },
    {
      id: "s2",
      title: "Oferta",
      blocks: [
        { id: "b3", type: "options", name: "p1", multiple: false, options: [{ id: "o1", label: "A" }, { id: "o2", label: "B" }] },
        { id: "b4", type: "button", label: "Comprar", action: { kind: "checkout" } },
      ],
    },
  ],
};

function row(over: Record<string, unknown> = {}) {
  return {
    id: "f_1",
    workspaceId: "ws_A",
    name: "Chat Sem Frescura",
    slug: "chat-sem-frescura",
    status: "DRAFT",
    draft: readyDraft,
    published: null,
    publishedVersion: 0,
    publishedAt: null,
    templateId: null,
    createdAt: new Date("2026-10-05T10:00:00Z"),
    updatedAt: new Date("2026-10-05T10:00:00Z"),
    ...over,
  };
}

function resetModels() {
  for (const m of h.models.values()) for (const key of Object.keys(m)) delete m[key];
}

beforeEach(() => {
  vi.clearAllMocks();
  resetModels();
  h.queryRaw.mockResolvedValue([]);
  h.mockContext.mockResolvedValue(CTX);
  h.mockCaller.mockResolvedValue(SESSION);
});

describe("401 sem login", () => {
  it.each([
    ["GET /api/funnels", () => listRoute.GET(req("/api/funnels"))],
    ["POST /api/funnels", () => listRoute.POST(req("/api/funnels", "POST", { name: "x" }))],
    ["GET [id]", () => funnelRoute.GET(req("/api/funnels/f_1"), params())],
    ["PATCH [id]", () => funnelRoute.PATCH(req("/api/funnels/f_1", "PATCH", { name: "y" }), params())],
    ["DELETE [id]", () => funnelRoute.DELETE(req("/api/funnels/f_1", "DELETE"), params())],
    ["duplicate", () => duplicateRoute.POST(req("/api/funnels/f_1/duplicate", "POST", {}), params())],
    ["publish", () => publishRoute.POST(req("/api/funnels/f_1/publish", "POST"), params())],
    ["unpublish", () => unpublishRoute.POST(req("/api/funnels/f_1/unpublish", "POST", {}), params())],
    ["results", () => resultsRoute.GET(req("/api/funnels/f_1/results"), params())],
    ["leads", () => leadsRoute.GET(req("/api/funnels/f_1/leads"), params())],
    ["export", () => exportRoute.GET(req("/api/funnels/f_1/leads/export"), params())],
  ])("%s", async (_n, call) => {
    h.mockContext.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });
});

describe("criar e editar rascunho", () => {
  it("POST cria DRAFT; mandar status/published = 400 draft_only e nada é criado", async () => {
    h.mockCaller.mockResolvedValue(TOKEN);
    const bad = await listRoute.POST(req("/api/funnels", "POST", { name: "Chat", status: "PUBLISHED" }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).details.code).toBe("draft_only");
    expect(h.prisma.funnel.create).not.toHaveBeenCalled();

    h.prisma.funnel.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row(data));
    const res = await listRoute.POST(req("/api/funnels", "POST", { name: "Chat Sem Frescura", templateId: "escada-sim-vsl" }));
    expect(res.status).toBe(201);
    const data = h.prisma.funnel.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ workspaceId: "ws_A", status: "DRAFT", publishedVersion: 0, slug: "chat-sem-frescura", templateId: "escada-sim-vsl" });
    expect(data.draft.steps).toHaveLength(6);
    const body = await res.json();
    expect(body.data.status).toBe("DRAFT");
    expect(body.data.validation.ok).toBe(false);
  });

  it("modelo desconhecido = 400 invalid_template; rascunho inválido = 400 invalid_funnel", async () => {
    const a = await listRoute.POST(req("/api/funnels", "POST", { name: "x", templateId: "nao-existe" }));
    expect((await a.json()).details.code).toBe("invalid_template");
    const b = await listRoute.POST(req("/api/funnels", "POST", { name: "x", draft: { schemaVersion: 1, steps: "nada" } }));
    expect(b.status).toBe(400);
    expect((await b.json()).details.code).toBe("invalid_funnel");
    expect(h.prisma.funnel.create).not.toHaveBeenCalled();
  });

  it("slug repetido no POST ganha -2", async () => {
    h.prisma.funnel.findUnique.mockImplementation(async ({ where }: { where: { slug: string } }) =>
      where.slug === "chat" ? { id: "outro" } : null
    );
    h.prisma.funnel.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row(data));
    const res = await listRoute.POST(req("/api/funnels", "POST", { name: "Chat", slug: "chat" }));
    expect(res.status).toBe(201);
    expect(h.prisma.funnel.create.mock.calls[0][0].data.slug).toBe("chat-2");
  });

  it("PATCH: status = 400 draft_only; slug ocupado = 409; publicado mantém published e status", async () => {
    h.prisma.funnel.findFirst.mockResolvedValue(row());
    const bad = await funnelRoute.PATCH(req("/api/funnels/f_1", "PATCH", { status: "PUBLISHED" }), params());
    expect(bad.status).toBe(400);
    expect((await bad.json()).details.code).toBe("draft_only");
    const badPub = await funnelRoute.PATCH(req("/api/funnels/f_1", "PATCH", { publishedVersion: 9 }), params());
    expect((await badPub.json()).details.code).toBe("draft_only");

    h.prisma.funnel.findUnique.mockResolvedValue({ id: "outro" });
    const taken = await funnelRoute.PATCH(req("/api/funnels/f_1", "PATCH", { slug: "ocupado" }), params());
    expect(taken.status).toBe(409);
    expect((await taken.json()).details.code).toBe("slug_taken");

    const live = row({ status: "PUBLISHED", published: readyDraft, publishedVersion: 2 });
    h.prisma.funnel.findFirst.mockResolvedValue(live);
    h.prisma.funnel.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...live, ...data }));
    const res = await funnelRoute.PATCH(
      req("/api/funnels/f_1", "PATCH", { patches: [{ stepId: "s1", blockId: "b1", set: { text: "Novo título" } }] }),
      params()
    );
    expect(res.status).toBe(200);
    const update = h.prisma.funnel.update.mock.calls[0][0];
    expect(Object.keys(update.data)).toEqual(["draft"]);
    expect(update.data.draft.steps[0].blocks[0].text).toBe("Novo título");
    const body = await res.json();
    expect(body.data.status).toBe("PUBLISHED");
    expect(body.data.hasUnpublishedChanges).toBe(true);
    expect(body.data.published.steps[0].blocks[0].text).toBe("Oi");
  });

  it("PATCH com patch que quebra o formato ou bloco inexistente = 400", async () => {
    h.prisma.funnel.findFirst.mockResolvedValue(row());
    const a = await funnelRoute.PATCH(req("/api/funnels/f_1", "PATCH", { patches: [{ stepId: "s1", blockId: "zz", set: { text: "x" } }] }), params());
    expect(a.status).toBe(400);
    const b = await funnelRoute.PATCH(
      req("/api/funnels/f_1", "PATCH", { patches: [{ stepId: "s1", blockId: "b1", set: { level: 7 } }] }),
      params()
    );
    expect(b.status).toBe(400);
    expect(h.prisma.funnel.update).not.toHaveBeenCalled();
  });

  it("tudo no workspace de quem chama (outro workspace = 404)", async () => {
    const res = await funnelRoute.GET(req("/api/funnels/f_1"), params());
    expect(h.prisma.funnel.findFirst.mock.calls[0][0].where).toEqual({ id: "f_1", workspaceId: "ws_A" });
    expect(res.status).toBe(404);
    expect((await publishRoute.POST(req("/api/funnels/f_1/publish", "POST"), params())).status).toBe(404);
  });

  it("lista sem arquivados por padrão", async () => {
    h.prisma.funnel.findMany.mockResolvedValue([row()]);
    const res = await listRoute.GET(req("/api/funnels"));
    expect(h.prisma.funnel.findMany.mock.calls[0][0].where).toEqual({ workspaceId: "ws_A", status: { not: "ARCHIVED" } });
    const body = await res.json();
    expect(body.data[0]).toMatchObject({ slug: "chat-sem-frescura", publicPath: "/q/chat-sem-frescura", stepCount: 2, stats: { visits7d: 0 } });
    await listRoute.GET(req("/api/funnels?status=ARCHIVED"));
    expect(h.prisma.funnel.findMany.mock.calls[1][0].where.status).toBe("ARCHIVED");
  });

  it("duplicar cria cópia DRAFT do rascunho", async () => {
    h.mockCaller.mockResolvedValue(TOKEN);
    h.prisma.funnel.findFirst.mockResolvedValue(row({ status: "PUBLISHED", published: readyDraft }));
    h.prisma.funnel.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row(data));
    const res = await duplicateRoute.POST(req("/api/funnels/f_1/duplicate", "POST", {}), params());
    expect(res.status).toBe(201);
    const data = h.prisma.funnel.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "DRAFT", name: "Chat Sem Frescura (cópia)", slug: "chat-sem-frescura-copia" });
  });
});

describe("só humano: publicar, despublicar, apagar, leads", () => {
  it.each([
    ["publish", () => publishRoute.POST(req("/api/funnels/f_1/publish", "POST"), params())],
    ["unpublish", () => unpublishRoute.POST(req("/api/funnels/f_1/unpublish", "POST", { archive: true }), params())],
    ["delete", () => funnelRoute.DELETE(req("/api/funnels/f_1", "DELETE"), params())],
    ["leads", () => leadsRoute.GET(req("/api/funnels/f_1/leads"), params())],
    ["export", () => exportRoute.GET(req("/api/funnels/f_1/leads/export"), params())],
  ])("%s com chave = 403 human_only", async (_n, call) => {
    h.mockCaller.mockResolvedValue(TOKEN);
    h.prisma.funnel.findFirst.mockResolvedValue(row());
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).details).toEqual({ code: "human_only" });
    expect(h.prisma.funnel.update).not.toHaveBeenCalled();
    expect(h.prisma.funnel.delete).not.toHaveBeenCalled();
  });

  it("publicar rascunho com [colchete] = 400 fix_before_publish", async () => {
    h.prisma.funnel.findFirst.mockResolvedValue(row({ draft: getFunnelTemplate("escada-sim-vsl")!.build() }));
    const res = await publishRoute.POST(req("/api/funnels/f_1/publish", "POST"), params());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details.code).toBe("fix_before_publish");
    expect(body.details.validation.errors.map((e: { code: string }) => e.code)).toEqual(
      expect.arrayContaining(["placeholder_left", "offer_no_price", "checkout_no_url"])
    );
    expect(h.prisma.funnel.update).not.toHaveBeenCalled();
  });

  it("publicar ok copia draft -> published, versão +1 e PUBLISHED", async () => {
    h.prisma.funnel.findFirst.mockResolvedValue(row());
    h.prisma.funnel.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      row({ ...data, publishedVersion: 1, status: "PUBLISHED" })
    );
    const res = await publishRoute.POST(req("/api/funnels/f_1/publish", "POST"), params());
    expect(res.status).toBe(200);
    const data = h.prisma.funnel.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "PUBLISHED", publishedVersion: { increment: 1 }, publishedBy: "u_A" });
    expect(data.published).toEqual(readyDraft);
    expect((await res.json()).data.status).toBe("PUBLISHED");
  });

  it("despublicar e arquivar mantêm a versão publicada guardada", async () => {
    h.prisma.funnel.findFirst.mockResolvedValue(row({ status: "PUBLISHED", published: readyDraft }));
    h.prisma.funnel.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row({ ...data, published: readyDraft }));
    await unpublishRoute.POST(req("/api/funnels/f_1/unpublish", "POST", { archive: true }), params());
    expect(h.prisma.funnel.update.mock.calls[0][0].data).toEqual({ status: "ARCHIVED" });
    await unpublishRoute.POST(req("/api/funnels/f_1/unpublish", "POST", {}), params());
    expect(h.prisma.funnel.update.mock.calls[1][0].data).toEqual({ status: "DRAFT" });
  });

  it("apagar só fora do ar", async () => {
    h.prisma.funnel.findFirst.mockResolvedValue(row({ status: "PUBLISHED" }));
    const res = await funnelRoute.DELETE(req("/api/funnels/f_1", "DELETE"), params());
    expect(res.status).toBe(409);
    expect((await res.json()).details.code).toBe("published");
    h.prisma.funnel.findFirst.mockResolvedValue(row());
    expect((await funnelRoute.DELETE(req("/api/funnels/f_1", "DELETE"), params())).status).toBe(200);
    expect(h.prisma.funnel.delete).toHaveBeenCalledWith({ where: { id: "f_1" } });
  });
});

describe("resultados e leads", () => {
  it("resultados: funil por tela com % do início e desistência", async () => {
    h.prisma.funnel.findFirst.mockResolvedValue(row({ published: readyDraft }));
    h.queryRaw
      .mockResolvedValueOnce([{ visits: 10, started: 6, completed: 4, checkouts: 2, leads: 0, purchases: 1, refunds: 0 }])
      .mockResolvedValueOnce([
        { stepId: "s1", views: 10 },
        { stepId: "s2", views: 4 },
      ])
      .mockResolvedValueOnce([{ blockId: "b3", optionId: "o1", count: 3 }])
      .mockResolvedValueOnce([{ source: "instagram", visits: 8, checkouts: 2, purchases: 1 }]);
    const res = await resultsRoute.GET(req("/api/funnels/f_1/results?days=7"), params());
    const body = (await res.json()).data;
    expect(body.days).toBe(7);
    expect(body.totals).toMatchObject({ visits: 10, checkouts: 2, purchases: 1 });
    expect(body.steps).toEqual([
      { stepId: "s1", title: "Capa", index: 0, views: 10, pctOfFirst: 100, dropFromPrev: 0 },
      { stepId: "s2", title: "Oferta", index: 1, views: 4, pctOfFirst: 40, dropFromPrev: 60 },
    ]);
    expect(body.answers[0].options).toEqual([
      { id: "o1", label: "A", count: 3 },
      { id: "o2", label: "B", count: 0 },
    ]);
    expect(body.sources[0]).toEqual({ source: "instagram", visits: 8, checkouts: 2, purchases: 1 });
  });

  it("leads paginados e CSV com proteção de fórmula", async () => {
    h.prisma.funnel.findFirst.mockResolvedValue(row({ published: readyDraft }));
    const lead = {
      id: "l1",
      createdAt: new Date("2026-10-05T10:00:00Z"),
      name: "=HYPERLINK(\"x\")",
      email: "ana@ex.com",
      phone: "5511999998888",
      answers: { p1: "A" },
      tags: ["quiz:x"],
      contactId: null,
      purchasedAt: null,
      contact: null,
      visit: { source: "instagram", purchasedAt: null },
    };
    h.prisma.funnelLead.findMany.mockResolvedValue([lead]);
    h.prisma.funnelLead.count.mockResolvedValue(1);
    const page = (await (await leadsRoute.GET(req("/api/funnels/f_1/leads?limit=10"), params())).json()).data;
    expect(page).toMatchObject({ total: 1, nextCursor: null, rows: [{ id: "l1", whatsapp: "5511999998888", answers: { p1: "A" }, source: "instagram" }] });

    const res = await exportRoute.GET(req("/api/funnels/f_1/leads/export"), params());
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv).toContain("data,nome,email,whatsapp,origem,contato,comprou,etiquetas,p1");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/,=HYPERLINK/);
  });
});
