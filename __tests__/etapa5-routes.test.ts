/**
 * Etapa 5: rotas e MCP. 401 sem login; chave de API só cria RASCUNHO de
 * disparo (nunca envia: /send = 403 human_only), pode cancelar; ligar A/B e
 * declarar vencedora só com sessão humana; desligar A/B pode por chave;
 * segmentos e relatórios no workspace de quem chama; MCP com as rotas de
 * fluxo consertadas e as ferramentas novas sem caminho pra enviar.
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
  const queryRaw = vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []);
  const prisma = new Proxy({} as Record<string, unknown>, {
    get(_t, name: string) {
      if (name === "$transaction") return vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
      if (name === "$queryRaw") return queryRaw;
      return model(name);
    },
  });
  return {
    prisma: prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>,
    models,
    queryRaw,
    mockContext: vi.fn(),
    mockCaller: vi.fn(),
    add: vi.fn(),
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: h.mockContext,
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));
vi.mock("@/lib/auth", () => ({ getApiCaller: h.mockCaller }));
vi.mock("@/lib/queue/client", () => ({ getDMQueue: () => ({ add: h.add }) }));

import * as segmentsRoute from "../app/api/segments/route";
import * as segmentRoute from "../app/api/segments/[id]/route";
import * as segmentCountRoute from "../app/api/segments/count/route";
import * as broadcastsRoute from "../app/api/broadcasts/route";
import * as broadcastRoute from "../app/api/broadcasts/[id]/route";
import * as sendRoute from "../app/api/broadcasts/[id]/send/route";
import * as cancelRoute from "../app/api/broadcasts/[id]/cancel/route";
import * as winnerRoute from "../app/api/broadcasts/[id]/winner/route";
import * as abRoute from "../app/api/automations/[id]/ab/route";
import * as abActiveRoute from "../app/api/automations/[id]/ab/active/route";
import * as abWinnerRoute from "../app/api/automations/[id]/ab/winner/route";
import * as reportsRoute from "../app/api/reports/route";
import * as exportRoute from "../app/api/reports/export/route";
import { resolveHandler } from "../lib/mcp/routes";
import { handleMcpMessage, TOOLS, type InternalCall } from "../lib/mcp/server";

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
const params = (id = "b_1") => ({ params: Promise.resolve({ id }) });
const m = (name: string) => h.prisma[name];

function broadcastRow(over: Record<string, unknown> = {}) {
  return {
    id: "b_1",
    workspaceId: "ws_A",
    instagramAccountId: "acc_1",
    segmentId: null,
    filtersSnapshot: {},
    name: "Promo",
    text: "Oi",
    buttons: [],
    variants: null,
    abWinnerKey: null,
    skipBusy: true,
    status: "DRAFT",
    stopReason: null,
    scheduledAt: null,
    startedAt: null,
    finishedAt: null,
    canceledAt: null,
    canceledBy: null,
    createdBy: "u_A",
    createdVia: "session",
    sentBy: null,
    batchSize: 20,
    pauseSeconds: 60,
    segmentCount: 0,
    eligibleCount: 0,
    sentCount: 0,
    failedCount: 0,
    skippedCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    segment: null,
    instagramAccount: { username: "omatheus.ai", status: "ACTIVE" },
    ...over,
  };
}

function resetModels() {
  for (const mod of h.models.values()) for (const key of Object.keys(mod)) delete mod[key];
}

beforeEach(() => {
  vi.clearAllMocks();
  resetModels();
  h.queryRaw.mockResolvedValue([]);
  h.mockContext.mockResolvedValue(CTX);
  h.mockCaller.mockResolvedValue(SESSION);
  h.add.mockResolvedValue({});
});

describe("401 without login", () => {
  it.each([
    ["GET /api/segments", () => segmentsRoute.GET(req("/api/segments"))],
    ["POST /api/segments", () => segmentsRoute.POST(req("/api/segments", "POST", { name: "x" }))],
    ["POST /api/segments/count", () => segmentCountRoute.POST(req("/api/segments/count", "POST", {}))],
    ["GET /api/segments/[id]", () => segmentRoute.GET(req("/api/segments/s"), params("s"))],
    ["GET /api/broadcasts", () => broadcastsRoute.GET(req("/api/broadcasts"))],
    ["POST /api/broadcasts", () => broadcastsRoute.POST(req("/api/broadcasts", "POST", {}))],
    ["GET /api/broadcasts/[id]", () => broadcastRoute.GET(req("/api/broadcasts/b_1"), params())],
    ["POST send", () => sendRoute.POST(req("/api/broadcasts/b_1/send", "POST", {}), params())],
    ["POST cancel", () => cancelRoute.POST(req("/api/broadcasts/b_1/cancel", "POST"), params())],
    ["GET ab", () => abRoute.GET(req("/api/automations/a/ab"), params("a"))],
    ["GET reports", () => reportsRoute.GET(req("/api/reports"))],
    ["GET export", () => exportRoute.GET(req("/api/reports/export"))],
  ])("%s", async (_name, call) => {
    h.mockContext.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });
});

describe("broadcasts: API key only drafts", () => {
  it("POST creates a DRAFT (createdVia mcp for a key), even if the body says otherwise", async () => {
    h.mockCaller.mockResolvedValue(TOKEN);
    m("instagramAccount").findFirst.mockResolvedValue({ id: "acc_1", workspaceId: "ws_A" });
    m("broadcast").create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => broadcastRow(data));
    const res = await broadcastsRoute.POST(
      req("/api/broadcasts", "POST", { name: "Promo", text: "Oi {first_name}", status: "SCHEDULED", scheduledAt: "2026-10-09T10:00:00Z" })
    );
    expect(res.status).toBe(201);
    const data = m("broadcast").create.mock.calls[0][0].data;
    expect(data.status).toBe("DRAFT");
    expect(data.createdVia).toBe("mcp");
    expect(data).not.toHaveProperty("scheduledAt");
    expect(data.workspaceId).toBe("ws_A");
    expect(h.add).not.toHaveBeenCalled();
  });

  it("send with an API key = 403 human_only, nothing changes or is queued", async () => {
    h.mockCaller.mockResolvedValue(TOKEN);
    m("broadcast").findFirst.mockResolvedValue(broadcastRow());
    const res = await sendRoute.POST(req("/api/broadcasts/b_1/send", "POST", {}), params());
    expect(res.status).toBe(403);
    expect((await res.json()).details.code).toBe("human_only");
    expect(m("broadcast").updateMany).not.toHaveBeenCalled();
    expect(h.add).not.toHaveBeenCalled();
  });

  it("send refuses a draft changed since the person opened it (409 changed); the same updatedAt goes", async () => {
    const seen = new Date("2026-10-04T12:00:00.000Z");
    m("broadcast").findFirst.mockResolvedValue(broadcastRow({ updatedAt: new Date(seen.getTime() + 5_000) }));
    const res = await sendRoute.POST(
      req("/api/broadcasts/b_1/send", "POST", { expectedUpdatedAt: seen.toISOString() }),
      params()
    );
    expect(res.status).toBe(409);
    expect((await res.json()).details.code).toBe("changed");
    expect(m("broadcast").updateMany).not.toHaveBeenCalled();
    expect(h.add).not.toHaveBeenCalled();

    m("broadcast").findFirst.mockResolvedValue(broadcastRow({ updatedAt: seen }));
    m("broadcast").updateMany.mockResolvedValue({ count: 1 });
    m("instagramAccount").findUnique.mockResolvedValue({ instagramId: "ig_1" });
    const okRes = await sendRoute.POST(
      req("/api/broadcasts/b_1/send", "POST", { expectedUpdatedAt: seen.toISOString() }),
      params()
    );
    expect(okRes.status).toBe(200);
  });

  it("a MEMBER cannot send even signed in", async () => {
    h.mockContext.mockResolvedValue({ ...CTX, role: "MEMBER" });
    expect((await sendRoute.POST(req("/api/broadcasts/b_1/send", "POST", {}), params())).status).toBe(403);
  });

  it("a signed-in owner sends: SCHEDULED + start job; the answer carries the live audience", async () => {
    m("broadcast").findFirst.mockResolvedValue(broadcastRow());
    m("broadcast").updateMany.mockResolvedValue({ count: 1 });
    m("instagramAccount").findUnique.mockResolvedValue({ instagramId: "ig_1" });
    h.queryRaw.mockResolvedValue([{ total: 259, windowOpen: 12, optedOut: 1, takeover: 0, busy: 1, eligible: 10 }]);
    const res = await sendRoute.POST(req("/api/broadcasts/b_1/send", "POST", {}), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.audience).toMatchObject({ total: 259, eligible: 10 });
    const update = m("broadcast").updateMany.mock.calls[0][0];
    expect(update.where).toEqual({ id: "b_1", status: "DRAFT" });
    expect(update.data).toMatchObject({ status: "SCHEDULED", sentBy: "u_A" });
    expect(h.add).toHaveBeenCalledWith(
      "broadcast-start",
      { instagramAccountId: "ig_1", broadcastId: "b_1" },
      expect.objectContaining({ attempts: 1 })
    );
    // The start job never carries commentId (older workers skip it).
    expect(h.add.mock.calls[0][1]).not.toHaveProperty("commentId");
  });

  it("send refuses a broadcast that is not a draft, a channel off and a flow button whose flow is off", async () => {
    m("broadcast").findFirst.mockResolvedValue(broadcastRow({ status: "DONE" }));
    expect((await sendRoute.POST(req("/x", "POST", {}), params())).status).toBe(409);
    m("broadcast").findFirst.mockResolvedValue(broadcastRow({ instagramAccount: { username: "x", status: "DISCONNECTED" } }));
    const off = await sendRoute.POST(req("/x", "POST", {}), params());
    expect(off.status).toBe(409);
    expect((await off.json()).details.code).toBe("channel_off");
    m("broadcast").findFirst.mockResolvedValue(broadcastRow({ buttons: [{ id: "b1", label: "Fluxo", kind: "flow", flowId: "f_1" }] }));
    m("flow").findMany.mockResolvedValue([]);
    const flowOff = await sendRoute.POST(req("/x", "POST", {}), params());
    expect((await flowOff.json()).details.code).toBe("flow_off");
    expect(h.add).not.toHaveBeenCalled();
  });

  it("PATCH only edits a draft", async () => {
    h.mockCaller.mockResolvedValue(TOKEN);
    m("broadcast").findFirst.mockResolvedValue(broadcastRow({ status: "SENDING" }));
    expect((await broadcastRoute.PATCH(req("/x", "PATCH", { text: "novo" }), params())).status).toBe(409);
    m("broadcast").findFirst.mockResolvedValue(broadcastRow());
    m("broadcast").update.mockResolvedValue(broadcastRow({ text: "novo" }));
    expect((await broadcastRoute.PATCH(req("/x", "PATCH", { text: "novo" }), params())).status).toBe(200);
  });

  it("cancel works with an API key (stopping is safe)", async () => {
    h.mockCaller.mockResolvedValue(TOKEN);
    m("broadcast").findFirst.mockResolvedValue(broadcastRow({ status: "SENDING" }));
    m("broadcast").updateMany.mockResolvedValue({ count: 1 });
    m("broadcastRecipient").groupBy.mockResolvedValue([]);
    const res = await cancelRoute.POST(req("/x", "POST"), params());
    expect(res.status).toBe(200);
    expect(m("broadcast").updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "b_1", workspaceId: "ws_A" },
      data: { status: "CANCELED", canceledBy: "mcp" },
    });
    expect(m("broadcastRecipient").updateMany).toHaveBeenCalledWith({
      where: { broadcastId: "b_1", status: "PENDING" },
      data: { status: "SKIPPED_CANCELED" },
    });
  });

  it("declaring a broadcast winner is human only", async () => {
    h.mockCaller.mockResolvedValue(TOKEN);
    expect((await winnerRoute.POST(req("/x", "POST", { key: "A" }), params())).status).toBe(403);
    h.mockCaller.mockResolvedValue(SESSION);
    m("broadcast").findFirst.mockResolvedValue(
      broadcastRow({ variants: [{ key: "A", weight: 50, text: "ta" }, { key: "B", weight: 50, text: "tb" }] })
    );
    expect((await winnerRoute.POST(req("/x", "POST", { key: "B" }), params())).status).toBe(200);
    expect(m("broadcast").update.mock.calls[0][0].data).toEqual({ abWinnerKey: "B", text: "tb" });
  });

  it("another workspace's broadcast is a 404", async () => {
    m("broadcast").findFirst.mockResolvedValue(null);
    expect((await broadcastRoute.GET(req("/x"), params())).status).toBe(404);
    expect(m("broadcast").findFirst.mock.calls[0][0].where).toEqual({ id: "b_1", workspaceId: "ws_A" });
  });
});

describe("campaign A/B routes", () => {
  const automation = {
    id: "a_1",
    workspaceId: "ws_A",
    name: "C",
    abTestEnabled: false,
    abWinnerKey: null,
    openingDmEnabled: false,
    openingDmMessage: null,
    dmMessage: "Base",
  };
  const variants = [
    { id: "v_a", key: "A", weight: 50, openingDmMessage: null, dmMessage: null },
    { id: "v_b", key: "B", weight: 50, openingDmMessage: null, dmMessage: "Nova" },
  ];

  it("turning A/B on is human only; off is allowed for a key", async () => {
    m("automation").findFirst.mockResolvedValue(automation);
    m("campaignVariant").findMany.mockResolvedValue(variants);
    h.mockCaller.mockResolvedValue(TOKEN);
    expect((await abActiveRoute.POST(req("/x", "POST", { enabled: true }), params("a_1"))).status).toBe(403);
    expect(m("automation").update).not.toHaveBeenCalled();
    expect((await abActiveRoute.POST(req("/x", "POST", { enabled: false }), params("a_1"))).status).toBe(200);
    expect(m("automation").update.mock.calls[0][0].data).toEqual({ abTestEnabled: false });
    h.mockCaller.mockResolvedValue(SESSION);
    expect((await abActiveRoute.POST(req("/x", "POST", { enabled: true }), params("a_1"))).status).toBe(200);
  });

  it("cannot turn on without 2+ variants adding up to 100", async () => {
    m("automation").findFirst.mockResolvedValue(automation);
    m("campaignVariant").findMany.mockResolvedValue([variants[0]]);
    expect((await abActiveRoute.POST(req("/x", "POST", { enabled: true }), params("a_1"))).status).toBe(409);
  });

  it("PUT validates weights and needs a changed text; a key cannot change a running test", async () => {
    m("automation").findFirst.mockResolvedValue(automation);
    const bad = await abRoute.PUT(req("/x", "PUT", { variants: [{ key: "A", weight: 60 }, { key: "B", weight: 30, dmMessage: "x" }] }), params("a_1"));
    expect(bad.status).toBe(400);
    const same = await abRoute.PUT(req("/x", "PUT", { variants: [{ key: "A", weight: 50 }, { key: "B", weight: 50 }] }), params("a_1"));
    expect(same.status).toBe(400);
    h.mockCaller.mockResolvedValue(TOKEN);
    m("automation").findFirst.mockResolvedValue({ ...automation, abTestEnabled: true });
    const running = await abRoute.PUT(req("/x", "PUT", { variants: [{ key: "A", weight: 50 }, { key: "B", weight: 50, dmMessage: "x" }] }), params("a_1"));
    expect(running.status).toBe(403);
    m("automation").findFirst.mockResolvedValue(automation);
    const prep = await abRoute.PUT(req("/x", "PUT", { variants: [{ key: "A", weight: 50 }, { key: "B", weight: 50, dmMessage: "x" }] }), params("a_1"));
    expect(prep.status).toBe(200);
    expect(m("campaignVariant").upsert).toHaveBeenCalledTimes(2);
    // Saving variants never turns the test on.
    expect(m("automation").update).not.toHaveBeenCalled();
  });

  it("declare winner (human): copies only its texts, turns the test off", async () => {
    h.mockCaller.mockResolvedValue(TOKEN);
    expect((await abWinnerRoute.POST(req("/x", "POST", { key: "B" }), params("a_1"))).status).toBe(403);
    h.mockCaller.mockResolvedValue(SESSION);
    m("automation").findFirst.mockResolvedValue({ ...automation, abTestEnabled: true });
    m("campaignVariant").findMany.mockResolvedValue(variants);
    expect((await abWinnerRoute.POST(req("/x", "POST", { key: "B" }), params("a_1"))).status).toBe(200);
    expect(m("automation").update.mock.calls[0][0]).toEqual({
      where: { id: "a_1" },
      data: { abTestEnabled: false, abWinnerKey: "B", dmMessage: "Nova" },
    });
    expect(m("campaignVariant").update.mock.calls[0][0]).toMatchObject({ where: { id: "v_b" }, data: { winnerAt: expect.any(Date) } });
  });
});

describe("segments", () => {
  it("live count is scoped to the caller's workspace", async () => {
    h.queryRaw.mockResolvedValue([{ total: 5, windowOpen: 2, optedOut: 0, takeover: 0, busy: 0, eligible: 2 }]);
    const res = await segmentCountRoute.POST(req("/x", "POST", { filters: { hasTags: ["clicou"] } }));
    expect((await res.json()).data).toEqual({ total: 5, windowOpen: 2, optedOut: 0, takeover: 0, busy: 0, eligible: 2 });
    const sql = h.queryRaw.mock.calls[0][0] as { values: unknown[] };
    expect((sql as unknown as { sql: string }).sql).toContain('FROM "Contact" c WHERE c."workspaceId" = ?');
    expect(sql.values).toContain("ws_A");
    expect(sql.values).toContain("clicou");
  });

  it("an account of another workspace is a 404; unknown filter keys are a 400", async () => {
    m("instagramAccount").findFirst.mockResolvedValue(null);
    expect((await segmentCountRoute.POST(req("/x", "POST", { instagramAccountId: "acc_B" }))).status).toBe(404);
    expect((await segmentsRoute.POST(req("/x", "POST", { name: "x", filters: { workspaceId: "ws_B" } }))).status).toBe(400);
  });

  it("an API key may save a segment (it sends nothing)", async () => {
    h.mockCaller.mockResolvedValue(TOKEN);
    h.queryRaw.mockResolvedValue([{ total: 3 }]);
    m("segment").create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "s_1", createdAt: new Date(), updatedAt: new Date(), ...data }));
    const res = await segmentsRoute.POST(req("/x", "POST", { name: "Quentes", filters: { clicked: "yes" } }));
    expect(res.status).toBe(201);
    expect(m("segment").create.mock.calls[0][0].data).toMatchObject({ workspaceId: "ws_A", createdVia: "mcp", lastCount: 3 });
  });
});

describe("segments used by a scheduled broadcast", () => {
  const segRow = {
    id: "s_1", workspaceId: "ws_A", instagramAccountId: null, name: "VIP", filters: { hasTags: ["vip"] },
    createdBy: "u_A", createdVia: "session", lastCount: null, lastCountAt: null, createdAt: new Date(), updatedAt: new Date(),
  };

  it("an API key cannot change (widen) the filters of a segment a scheduled broadcast will use", async () => {
    h.mockCaller.mockResolvedValue(TOKEN);
    m("segment").findFirst.mockResolvedValue(segRow);
    m("broadcast").count.mockResolvedValue(1);
    const res = await segmentRoute.PATCH(req("/x", "PATCH", { filters: {} }), params("s_1"));
    expect(res.status).toBe(403);
    expect((await res.json()).details.code).toBe("human_only");
    expect(m("segment").update).not.toHaveBeenCalled();
    expect(m("broadcast").count.mock.calls[0][0].where).toMatchObject({ segmentId: "s_1", workspaceId: "ws_A" });
  });

  it("a signed-in person still can; an API key can rename it", async () => {
    m("segment").findFirst.mockResolvedValue(segRow);
    m("broadcast").count.mockResolvedValue(1);
    m("segment").update.mockResolvedValue(segRow);
    expect((await segmentRoute.PATCH(req("/x", "PATCH", { filters: {} }), params("s_1"))).status).toBe(200);
    h.mockCaller.mockResolvedValue(TOKEN);
    expect((await segmentRoute.PATCH(req("/x", "PATCH", { name: "Novo" }), params("s_1"))).status).toBe(200);
  });
});

describe("reports", () => {
  it("CSV export is text/csv with a filename", async () => {
    const res = await exportRoute.GET(req("/api/reports/export?days=7&section=funnel"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    expect(res.headers.get("content-disposition")).toMatch(/relatorio-7d-funnel-/);
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM, so Excel reads the accents
    const text = await res.text();
    expect(text.replace(/^﻿/, "").startsWith("secao,item,metrica,valor")).toBe(true);
    expect(text).toContain("funil,comentou,pessoas,0");
  });
});

describe("MCP", () => {
  it("routes the flow tools (they answered 404 before) and the new ones; static paths first", () => {
    expect(resolveHandler("GET", "/api/flows")).not.toBeNull();
    expect(resolveHandler("GET", "/api/flows/f_1")?.id).toBe("f_1");
    expect(resolveHandler("GET", "/api/flows/f_1/report")?.id).toBe("f_1");
    const fromCampaign = resolveHandler("POST", "/api/flows/from-campaign/a_9");
    expect(fromCampaign).toMatchObject({ id: "a_9", param: "automationId" });
    expect(resolveHandler("POST", "/api/segments/count")?.id).toBe("");
    expect(resolveHandler("GET", "/api/segments/s_1")?.id).toBe("s_1");
    expect(resolveHandler("GET", "/api/reports")).not.toBeNull();
    // ver_canais answered 404 "No route" before.
    expect(resolveHandler("GET", "/api/channels")).not.toBeNull();
    expect(resolveHandler("POST", "/api/broadcasts")).not.toBeNull();
    expect(resolveHandler("POST", "/api/broadcasts/b_1/cancel")?.id).toBe("b_1");
    // No way to send or to publish through the MCP router.
    expect(resolveHandler("POST", "/api/broadcasts/b_1/send")).toBeNull();
    expect(resolveHandler("POST", "/api/broadcasts/b_1/winner")).toBeNull();
    expect(resolveHandler("POST", "/api/flows/f_1/publish")).toBeNull();
    expect(resolveHandler("POST", "/api/automations/a_1/ab/active")).toBeNull();
  });

  it("has the new tools and criar_rascunho_disparo only POSTs a draft", async () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["ver_relatorio", "listar_segmentos", "criar_rascunho_disparo"]));
    const calls: [string, string, unknown][] = [];
    const call: InternalCall = async (method, path, body) => {
      calls.push([method, path, body]);
      if (method === "POST") return { status: 201, json: { success: true, data: { id: "b_9", name: "Promo", status: "DRAFT" } } };
      return { status: 200, json: { success: true, data: { audience: { total: 259, eligible: 4 } } } };
    };
    const res = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "criar_rascunho_disparo", arguments: { name: "Promo", text: "Oi {first_name}", segmentId: "s_1" } },
      },
      call
    );
    const out = JSON.parse((res?.result as { content: { text: string }[] }).content[0].text);
    expect(out).toMatchObject({ criado: true, status: "DRAFT", enviado: false, contatosNoSegmento: 259, receberiamAgora: 4 });
    expect(calls.map(([mth, p]) => `${mth} ${p}`)).toEqual(["POST /api/broadcasts", "GET /api/broadcasts/b_9"]);
    expect(calls.some(([, p]) => p.includes("/send"))).toBe(false);
  });

  it("ver_relatorio is a GET of the period", async () => {
    const call = vi.fn<InternalCall>(async () => ({ status: 200, json: { success: true, data: { days: 7, dms: { total: 3, groups: { campaign: 2, flow: 1 } } } } }));
    const res = await handleMcpMessage(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ver_relatorio", arguments: { dias: 7 } } },
      call
    );
    expect(call).toHaveBeenCalledWith("GET", "/api/reports?days=7", undefined);
    const out = JSON.parse((res?.result as { content: { text: string }[] }).content[0].text);
    expect(out.dmsEnviadas).toMatchObject({ total: 3, campanha: 2, fluxo: 1 });
  });

  it("instructions say broadcasts are draft-only through the key", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "initialize", params: {} }, vi.fn());
    expect((res?.result as { instructions: string }).instructions).toMatch(/Disparos: pela chave você só cria RASCUNHO/);
  });
});

describe("A/B and broadcast numbers", () => {
  it("campaign A/B: people sent / clicked / replied and CTR per variant", async () => {
    m("automation").findFirst.mockResolvedValue({
      id: "a_1",
      workspaceId: "ws_A",
      name: "C",
      abTestEnabled: true,
      abWinnerKey: null,
      openingDmEnabled: true,
      openingDmMessage: "Abre",
      dmMessage: "Base",
    });
    m("campaignVariant").findMany.mockResolvedValue([]);
    h.queryRaw.mockResolvedValue([
      { key: "A", sent: 40, clicked: 8, replied: 5 },
      { key: "B", sent: 38, clicked: 3, replied: 9 },
    ]);
    const res = await abRoute.GET(req("/x"), params("a_1"));
    const data = (await res.json()).data;
    expect(data.stats).toEqual([
      { key: "A", sent: 40, clicked: 8, replied: 5, ctr: 20 },
      { key: "B", sent: 38, clicked: 3, replied: 9, ctr: 7.9 },
    ]);
    const sql = h.queryRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(sql.sql).toContain('d."variantKey" IS NOT NULL');
    expect(sql.values).toContain("a_1");
  });

  it("broadcast history: sent, failed, clicks, replies and per variant", async () => {
    m("broadcast").findFirst.mockResolvedValue(broadcastRow({ status: "DONE" }));
    m("broadcastRecipient").groupBy.mockResolvedValue([
      { status: "SENT", _count: { _all: 9 } },
      { status: "MAYBE_SENT", _count: { _all: 1 } },
      { status: "SKIPPED_WINDOW", _count: { _all: 4 } },
    ]);
    m("broadcastLinkClick").count.mockResolvedValue(5);
    h.queryRaw.mockResolvedValue([
      { key: "A", sent: 5, failed: 1, skipped: 2, clicked: 2, replied: 1 },
      { key: "B", sent: 4, failed: 0, skipped: 2, clicked: 1, replied: 3 },
    ]);
    const res = await broadcastRoute.GET(req("/x"), params());
    const data = (await res.json()).data;
    expect(data.audience).toBeNull(); // finished: no live audience
    expect(data.stats.totals).toMatchObject({ sent: 9, failed: 1, skipped: 4, clicked: 3, replied: 4, clicks: 5, maybeSent: 1, ctr: 33.3 });
    expect(data.stats.variants.map((v: { key: string; ctr: number }) => [v.key, v.ctr])).toEqual([
      ["A", 40],
      ["B", 25],
    ]);
    expect(data.stats.replyWindowHours).toBe(72);
  });
});
