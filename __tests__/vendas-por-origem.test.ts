/**
 * Vendas por origem (28/10/2026): agrupamento por transação, mapa sck -> fluxo,
 * reembolso, sem origem, fuso de Brasília; rota/MCP com prisma mockado e escopo
 * de workspace; webhook herdando sck/visita do primeiro evento da venda.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  ctx: { value: null as null | { userId: string; workspaceId: string; role: string } },
  userRole: { value: "MEMBER" as string },
  purchases: [] as Record<string, unknown>[],
  lastWhere: [] as unknown[],
  flows: [] as Record<string, unknown>[],
  flowLinks: [] as Record<string, unknown>[],
  automations: [] as Record<string, unknown>[],
  trackedLinks: [] as Record<string, unknown>[],
  funnels: [] as Record<string, unknown>[],
  flowRuns: [] as Record<string, unknown>[],
  flowClicks: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => h.ctx.value),
  canManageWorkspace: (r: string) => r === "OWNER" || r === "ADMIN",
}));
vi.mock("@/lib/db/client", () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => ({ role: h.userRole.value })) },
    funnelPurchase: {
      findMany: vi.fn(async (args: { where: Record<string, unknown>; distinct?: unknown }) => {
        h.lastWhere.push(args.where);
        if (args.distinct) {
          const seen = [...new Set(h.purchases.map((p) => p.transaction as string))];
          return seen.map((transaction) => ({ transaction }));
        }
        return h.purchases;
      }),
      count: vi.fn(async () => h.purchases.length),
    },
    flow: { findMany: vi.fn(async () => h.flows) },
    flowLink: { findMany: vi.fn(async () => h.flowLinks) },
    automation: { findMany: vi.fn(async () => h.automations) },
    trackedLink: { findMany: vi.fn(async () => h.trackedLinks) },
    broadcast: { findMany: vi.fn(async () => []) },
    broadcastLink: { findMany: vi.fn(async () => []) },
    funnel: { findMany: vi.fn(async () => h.funnels) },
    flowRun: { groupBy: vi.fn(async () => h.flowRuns) },
    flowLinkClick: { groupBy: vi.fn(async () => h.flowClicks) },
    dmLog: { groupBy: vi.fn(async () => []) },
    linkClick: { groupBy: vi.fn(async () => []) },
    broadcastRecipient: { groupBy: vi.fn(async () => []) },
    broadcastLinkClick: { groupBy: vi.fn(async () => []) },
    funnelVisit: { groupBy: vi.fn(async () => []) },
  },
}));

import { GET } from "../app/api/reports/vendas/route";
import {
  buildOriginMap,
  formatBrasilia,
  groupSales,
  lookupTag,
  sideOfTag,
  tagsFromText,
  totalsByOrigin,
  type PurchaseInput,
} from "../lib/reports/vendas";
import { VENDAS_TOOLS } from "../lib/mcp/vendas-tools";
import { resolveHandler } from "../lib/mcp/routes";
import { isApiKeyRouteAllowed } from "../lib/api-key-routes";

const row = (over: Partial<PurchaseInput>): PurchaseInput => ({
  transaction: "HP1", event: "PURCHASE_APPROVED", status: "APPROVED", productName: "Chat Sem Frescura", productId: "1",
  amountCents: 9700, currency: "BRL", sck: null, src: null, xcod: null, occurredAt: new Date("2026-10-28T17:03:00Z"),
  funnelId: null, funnelName: null, visitTracking: null, abVariant: null, ...over,
});

const map = buildOriginMap([
  { kind: "flow", refId: "f1", name: "Fluxo QUERO", texts: ["Compre: https://pay.hotmart.com/X?sck=quero-a-checkout", "https://x.com/p?utm_campaign=quero-b-pagina"] },
  { kind: "campaign", refId: "c1", name: "Campanha Lembrete", texts: ["https://pay.hotmart.com/X?sck=quero-a-lembrete&xcod=1"] },
]);

describe("etiquetas e mapa", () => {
  it("acha sck, src e utm_campaign nos links", () => {
    expect(tagsFromText("oi https://a.com/x?sck=ABC&utm_campaign=Def&src=ghi, fim").sort()).toEqual(["abc", "def", "ghi"]);
  });
  it("traduz sck para o fluxo e reconhece sck montado pelo checkout (utm_source_utm_campaign)", () => {
    expect(lookupTag("quero-a-checkout", map)?.name).toBe("Fluxo QUERO");
    expect(lookupTag("instagram_quero-b-pagina", map)?.name).toBe("Fluxo QUERO");
    expect(lookupTag("desconhecida", map)).toBeNull();
  });
  it("lado A/B vem da etiqueta", () => {
    expect(sideOfTag("quero-b-pagina")).toBe("B");
    expect(sideOfTag("quero-a-checkout")).toBe("A");
    expect(sideOfTag("quero")).toBeNull();
  });
  it("mesma etiqueta em duas coisas vira 'A ou B'", () => {
    const m = buildOriginMap([
      { kind: "flow", refId: "1", name: "Um", texts: ["https://a.com?sck=x"] },
      { kind: "campaign", refId: "2", name: "Dois", texts: ["https://a.com?sck=x"] },
    ]);
    expect(m.get("x")?.name).toBe("Um ou Dois");
  });
});

describe("agrupamento", () => {
  it("fuso de Brasília com dia da semana (meia-noite UTC cai no dia anterior)", () => {
    expect(formatBrasilia(new Date("2026-10-28T17:03:00Z"))).toBe("qua 28/10/2026 14:03");
    expect(formatBrasilia(new Date("2026-10-29T02:30:00Z"))).toBe("qua 28/10/2026 23:30");
  });
  it("uma venda por transação; APPROVED+COMPLETE não duplica", () => {
    const sales = groupSales(
      [row({ sck: "quero-a-checkout" }), row({ event: "PURCHASE_COMPLETE", sck: "quero-a-checkout", occurredAt: new Date("2026-10-30T00:00:00Z") })],
      map
    );
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ estado: "paga", origem: "Fluxo QUERO", lado: "A", amountCents: 9700 });
  });
  it("reembolso vence aprovada, herda o sck do primeiro evento e não entra na receita", () => {
    const sales = groupSales(
      [row({ sck: "quero-a-lembrete" }), row({ event: "PURCHASE_REFUNDED", status: "REFUNDED", sck: null, occurredAt: new Date("2026-10-29T12:00:00Z") })],
      map
    );
    expect(sales[0]).toMatchObject({ estado: "reembolsada", origem: "Campanha Lembrete" });
    const t = totalsByOrigin(sales);
    expect(t[0]).toMatchObject({ vendas: 0, reembolsos: 1, receitaCents: {}, reembolsadoCents: { BRL: 9700 } });
  });
  it("chargeback conta como reembolso; cancelada fica à parte", () => {
    const s = groupSales(
      [row({ transaction: "A", event: "PURCHASE_CHARGEBACK" }), row({ transaction: "B", event: "PURCHASE_CANCELED", status: "CANCELED" })],
      map
    );
    expect(s.find((x) => x.transaction === "A")?.estado).toBe("reembolsada");
    expect(s.find((x) => x.transaction === "B")?.estado).toBe("cancelada");
  });
  it("sem etiqueta vira 'Sem origem' e nunca some; etiqueta desconhecida aparece crua", () => {
    const sales = groupSales([row({ transaction: "N" }), row({ transaction: "U", sck: "Misteriosa" })], map);
    expect(sales.find((s) => s.transaction === "N")).toMatchObject({ origem: "Sem origem", tipo: "none" });
    expect(sales.find((s) => s.transaction === "U")).toMatchObject({ origem: "Misteriosa", tipo: "unknown" });
  });
  it("usa a etiqueta que a visita do quiz guardou, e o nome do quiz quando só casou a visita", () => {
    const a = groupSales([row({ transaction: "V", visitTracking: { sck: "quero-a-checkout" } })], map);
    expect(a[0].origem).toBe("Fluxo QUERO");
    const b = groupSales([row({ transaction: "Q", funnelId: "q1", funnelName: "Quiz Foto", xcod: "abc" })], map);
    expect(b[0]).toMatchObject({ origem: "Quiz: Quiz Foto", tipo: "quiz" });
  });
  it("conversão sobre entradas e cliques só quando há base", () => {
    const sales = groupSales([row({ sck: "quero-a-checkout" }), row({ transaction: "N2" })], map);
    const t = totalsByOrigin(sales, new Map([["flow:f1", { entraram: 50, clicaram: 10 }]]));
    const quero = t.find((x) => x.chave === "flow:f1")!;
    expect(quero).toMatchObject({ entraram: 50, clicaram: 10, conversaoEntrada: 2, conversaoClique: 10 });
    expect(t.find((x) => x.chave === "none")).toMatchObject({ entraram: null, conversaoEntrada: null });
  });
});

describe("rota e MCP", () => {
  beforeEach(() => {
    h.ctx.value = { userId: "u1", workspaceId: "w1", role: "OWNER" };
    h.userRole.value = "MEMBER";
    h.lastWhere.length = 0;
    h.purchases = [];
    h.flows = [{ id: "f1", name: "Fluxo QUERO", published: { nodes: [{ text: "https://pay.hotmart.com/X?sck=quero-a-checkout" }] }, draft: {} }];
    h.flowLinks = []; h.automations = []; h.trackedLinks = []; h.funnels = [];
    h.flowRuns = [{ flowId: "f1", _count: { _all: 40 } }];
    h.flowClicks = [{ flowId: "f1", _count: { _all: 8 } }];
  });
  const req = (q = "") => new NextRequest(`http://localhost/api/reports/vendas${q}`);

  it("401 sem login, 403 para MEMBER", async () => {
    h.ctx.value = null;
    expect((await GET(req())).status).toBe(401);
    h.ctx.value = { userId: "u1", workspaceId: "w1", role: "MEMBER" };
    expect((await GET(req())).status).toBe(403);
  });

  it("tabela vazia: avisa e mostra a URL do webhook", async () => {
    const body = await (await GET(req())).json();
    expect(body.data.nenhumaCompraAindaRecebida).toBe(true);
    expect(body.data.aviso).toContain("https://many.leadenginer.com/api/webhooks/hotmart");
    expect(body.data.vendas).toEqual([]);
  });

  it("escopo: dono comum só vê o próprio workspace; admin da plataforma inclui as sem workspace", async () => {
    await GET(req());
    expect(h.lastWhere[0]).toMatchObject({ OR: [{ workspaceId: "w1" }] });
    h.lastWhere.length = 0;
    h.userRole.value = "ADMIN";
    await GET(req());
    expect(h.lastWhere[0]).toMatchObject({ OR: [{ workspaceId: "w1" }, { workspaceId: null }] });
  });

  it("monta o relatório com mapa, entradas e sem e-mail", async () => {
    h.userRole.value = "ADMIN";
    h.purchases = [
      { transaction: "HP1", event: "PURCHASE_APPROVED", status: "APPROVED", productName: "CSF", productId: "1", amountCents: 9700, currency: "BRL", sck: "quero-a-checkout", src: null, xcod: null, occurredAt: new Date(), funnelId: null, funnel: null, visit: null },
      { transaction: "HP2", event: "PURCHASE_APPROVED", status: "APPROVED", productName: "CSF", productId: "1", amountCents: 9700, currency: "BRL", sck: null, src: null, xcod: null, occurredAt: new Date(), funnelId: null, funnel: null, visit: null },
    ];
    const res = await GET(req("?days=7"));
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/buyerEmail|@/);
    const body = JSON.parse(text);
    const quero = body.data.origens.find((o: { origem: string }) => o.origem === "Fluxo QUERO");
    expect(quero).toMatchObject({ vendas: 1, entraram: 40, clicaram: 8, conversaoEntrada: 2.5 });
    expect(body.data.totais).toMatchObject({ vendas: 2, semOrigem: 1 });
    expect(body.data.nenhumaCompraAindaRecebida).toBe(false);
  });

  it("MCP: ferramenta só chama GET e a chave só alcança a rota por GET", async () => {
    expect(VENDAS_TOOLS[0].name).toBe("vendas_por_origem");
    expect(resolveHandler("GET", "/api/reports/vendas")).not.toBeNull();
    expect(resolveHandler("POST", "/api/reports/vendas")).toBeNull();
    expect(resolveHandler("PATCH", "/api/reports/vendas")).toBeNull();
    expect(isApiKeyRouteAllowed("GET", "/api/reports/vendas")).toBe(true);
    expect(isApiKeyRouteAllowed("POST", "/api/reports/vendas")).toBe(false);
    const calls: string[] = [];
    const fake = vi.fn(async (method: string, path: string) => {
      calls.push(`${method} ${path}`);
      return { status: 200, json: { success: true, data: { dias: 7, fuso: "x", aviso: null, nenhumaCompraAindaRecebida: false, webhookUrl: "u", totais: { vendas: 1, reembolsos: 0, semOrigem: 0 }, origens: [], vendas: [], truncado: false } } };
    });
    const out = await VENDAS_TOOLS[0].run({ dias: 7, origem: "quero" }, fake as never);
    expect(calls).toEqual(["GET /api/reports/vendas?days=7&origem=quero"]);
    expect(out.isError).toBeUndefined();
    const err = await VENDAS_TOOLS[0].run({}, (async () => ({ status: 403, json: { success: false, error: "no" } })) as never);
    expect(err.isError).toBe(true);
  });
});
