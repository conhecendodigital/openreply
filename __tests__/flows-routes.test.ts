/**
 * Etapa 3: rotas /api/flows. 401 sem login, tudo no workspace de quem chama,
 * fluxo nasce desligado, PATCH só mexe no rascunho, publicar e ligar só com
 * sessão humana (chave de API = 403 human_only), desligar pode por chave,
 * "abrir como fluxo" só LÊ a campanha, e o MCP nunca publica nem liga.
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
  const prisma = new Proxy({} as Record<string, unknown>, {
    get(_t, name: string) {
      if (name === "$transaction") return vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
      return model(name);
    },
  });
  return {
    prisma: prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>,
    models,
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

import * as listRoute from "../app/api/flows/route";
import * as flowRoute from "../app/api/flows/[id]/route";
import * as publishRoute from "../app/api/flows/[id]/publish/route";
import * as activeRoute from "../app/api/flows/[id]/active/route";
import * as reportRoute from "../app/api/flows/[id]/report/route";
import * as convertRoute from "../app/api/flows/from-campaign/[automationId]/route";
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
const params = (id = "f_1") => ({ params: Promise.resolve({ id }) });

const validDraft = {
  schemaVersion: 1,
  trigger: { type: "DM", keywords: ["OI"], matchAnyWord: false, wholeWordMatch: true, matchAnyPost: false, next: "m1" },
  nodes: [
    { id: "m1", type: "message", text: "Oi {first_name}", buttons: [{ id: "l1", kind: "link", label: "Site", url: "https://example.com" }], next: "fim" },
    { id: "fim", type: "end" },
  ],
};
function flowRow(over: Record<string, unknown> = {}) {
  return {
    id: "f_1",
    workspaceId: "ws_A",
    name: "Fluxo",
    isActive: false,
    instagramAccountId: "acc_1",
    draft: validDraft,
    published: null,
    publishedVersion: 0,
    publishedAt: null,
    triggerType: null,
    sourceAutomationId: null,
    enteredCount: 0,
    completedCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    instagramAccount: { username: "omatheus.ai", status: "ACTIVE" },
    ...over,
  };
}

function resetModels() {
  for (const m of h.models.values()) for (const key of Object.keys(m)) delete m[key];
}

beforeEach(() => {
  vi.clearAllMocks();
  resetModels();
  h.mockContext.mockResolvedValue(CTX);
  h.mockCaller.mockResolvedValue(SESSION);
});

describe("401 without login", () => {
  it.each([
    ["GET /api/flows", () => listRoute.GET(req("/api/flows"))],
    ["POST /api/flows", () => listRoute.POST(req("/api/flows", "POST", { name: "x" }))],
    ["GET /api/flows/[id]", () => flowRoute.GET(req("/api/flows/f_1"), params())],
    ["PATCH /api/flows/[id]", () => flowRoute.PATCH(req("/api/flows/f_1", "PATCH", { name: "y" }), params())],
    ["DELETE /api/flows/[id]", () => flowRoute.DELETE(req("/api/flows/f_1", "DELETE"), params())],
    ["POST publish", () => publishRoute.POST(req("/api/flows/f_1/publish", "POST"), params())],
    ["POST active", () => activeRoute.POST(req("/api/flows/f_1/active", "POST", { isActive: true }), params())],
    ["GET report", () => reportRoute.GET(req("/api/flows/f_1/report"), params())],
    ["POST from-campaign", () => convertRoute.POST(req("/api/flows/from-campaign/a", "POST"), { params: Promise.resolve({ automationId: "a" }) })],
  ])("%s", async (_name, call) => {
    h.mockContext.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });
});

describe("create and edit drafts", () => {
  it("a new flow is always OFF, even if the body asks otherwise (API key too)", async () => {
    h.mockCaller.mockResolvedValue(TOKEN);
    h.prisma.instagramAccount.findFirst.mockResolvedValue({ id: "acc_1" });
    h.prisma.flow.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => flowRow(data));
    const res = await listRoute.POST(req("/api/flows", "POST", { name: "Meu fluxo", isActive: true, draft: validDraft }));
    expect(res.status).toBe(201);
    const data = h.prisma.flow.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ workspaceId: "ws_A", instagramAccountId: "acc_1", isActive: false, name: "Meu fluxo" });
    expect(data.published).toBeUndefined();
  });

  it("rejects a malformed definition", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue({ id: "acc_1" });
    const res = await listRoute.POST(req("/api/flows", "POST", { name: "x", draft: { trigger: { type: "SMS" }, nodes: [] } }));
    expect(res.status).toBe(400);
    expect(h.prisma.flow.create).not.toHaveBeenCalled();
  });

  it("PATCH only touches the draft and the name: isActive / published are refused", async () => {
    h.prisma.flow.findFirst.mockResolvedValue(flowRow());
    const bad = await flowRoute.PATCH(req("/api/flows/f_1", "PATCH", { isActive: true }), params());
    expect(bad.status).toBe(400);
    expect((await bad.json()).details).toEqual({ code: "draft_only" });
    h.prisma.flow.update.mockResolvedValue(flowRow());
    const good = await flowRoute.PATCH(req("/api/flows/f_1", "PATCH", { draft: validDraft, name: "Novo" }), params());
    expect(good.status).toBe(200);
    const update = h.prisma.flow.update.mock.calls[0][0];
    expect(Object.keys(update.data).sort()).toEqual(["draft", "name"]);
  });

  it("everything is scoped to the caller's workspace", async () => {
    await flowRoute.GET(req("/api/flows/f_1"), params());
    expect(h.prisma.flow.findFirst.mock.calls[0][0].where).toEqual({ id: "f_1", workspaceId: "ws_A" });
    expect((await flowRoute.GET(req("/api/flows/f_1"), params())).status).toBe(404);
  });

  it("GET shows the validation of the draft", async () => {
    h.prisma.flow.findFirst.mockResolvedValue(flowRow());
    h.prisma.automation.findMany.mockResolvedValue([]);
    const body = await (await flowRoute.GET(req("/api/flows/f_1"), params())).json();
    expect(body.data.validation).toEqual({ ok: true, errors: [], warnings: [] });
    expect(body.data.order).toEqual(["m1", "fim"]);
  });
});

describe("publish and turn on: human only", () => {
  it("an API key cannot publish (403 human_only) and nothing changes", async () => {
    h.mockCaller.mockResolvedValue(TOKEN);
    h.prisma.flow.findFirst.mockResolvedValue(flowRow());
    const res = await publishRoute.POST(req("/api/flows/f_1/publish", "POST"), params());
    expect(res.status).toBe(403);
    expect((await res.json()).details).toEqual({ code: "human_only" });
    expect(h.prisma.flow.update).not.toHaveBeenCalled();
  });

  it("an invalid draft cannot be published", async () => {
    h.prisma.flow.findFirst.mockResolvedValue(flowRow({ draft: { trigger: { type: "DM", keywords: [] }, nodes: [] } }));
    const res = await publishRoute.POST(req("/api/flows/f_1/publish", "POST"), params());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details.code).toBe("invalid_flow");
    expect(body.details.errors.map((e: { code: string }) => e.code)).toEqual(expect.arrayContaining(["no_nodes", "trigger_missing_keywords"]));
    expect(h.prisma.flow.update).not.toHaveBeenCalled();
  });

  it("a human publishes: draft copied, version up, trigger columns, tracked links created; isActive untouched", async () => {
    h.prisma.flow.findFirst.mockResolvedValue(flowRow());
    h.prisma.flow.update.mockResolvedValue({ publishedVersion: 1 });
    h.prisma.flow.findUnique.mockResolvedValue(flowRow({ published: validDraft, publishedVersion: 1, triggerType: "DM" }));
    h.prisma.automation.findMany.mockResolvedValue([]);
    const res = await publishRoute.POST(req("/api/flows/f_1/publish", "POST"), params());
    expect(res.status).toBe(200);
    const data = h.prisma.flow.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      publishedVersion: { increment: 1 },
      publishedBy: "u_A",
      triggerType: "DM",
      keywords: ["OI"],
      matchAnyWord: false,
    });
    expect(data.published).toMatchObject({ trigger: { type: "DM" } });
    expect("isActive" in data).toBe(false);
    expect(h.prisma.flowLink.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ flowId: "f_1", nodeId: "m1", buttonId: "l1", destinationUrl: "https://example.com" }) })
    );
  });

  it("turning ON needs a human and a published flow; turning OFF works with an API key", async () => {
    h.prisma.flow.findFirst.mockResolvedValue(flowRow());
    h.mockCaller.mockResolvedValue(TOKEN);
    const tokenOn = await activeRoute.POST(req("/api/flows/f_1/active", "POST", { isActive: true }), params());
    expect(tokenOn.status).toBe(403);

    h.mockCaller.mockResolvedValue(SESSION);
    const unpublished = await activeRoute.POST(req("/api/flows/f_1/active", "POST", { isActive: true }), params());
    expect(unpublished.status).toBe(409);
    expect(h.prisma.flow.update).not.toHaveBeenCalled();

    h.prisma.flow.findFirst.mockResolvedValue(flowRow({ published: validDraft, triggerType: "DM", publishedVersion: 1 }));
    h.prisma.flow.update.mockResolvedValue(flowRow({ isActive: true, published: validDraft }));
    h.prisma.automation.findMany.mockResolvedValue([
      { id: "auto_1", name: "Campanha OI", trigger: "DM", postId: null, matchAnyPost: false, storyId: null, keywords: ["oi"], matchAnyWord: false, wholeWordMatch: true, dmTriggerEnabled: true },
    ]);
    const on = await activeRoute.POST(req("/api/flows/f_1/active", "POST", { isActive: true }), params());
    expect(on.status).toBe(200);
    expect(h.prisma.flow.update.mock.calls[0][0].data).toEqual({ isActive: true });
    // The campaign with the same words wins: the screen is told.
    expect((await on.json()).data.conflicts).toEqual([{ id: "auto_1", name: "Campanha OI", trigger: "DM" }]);

    h.mockCaller.mockResolvedValue(TOKEN);
    const off = await activeRoute.POST(req("/api/flows/f_1/active", "POST", { isActive: false }), params());
    expect(off.status).toBe(200);
  });

  it("deleting is human-only and only for a flow that is off", async () => {
    h.mockCaller.mockResolvedValue(TOKEN);
    expect((await flowRoute.DELETE(req("/api/flows/f_1", "DELETE"), params())).status).toBe(403);
    h.mockCaller.mockResolvedValue(SESSION);
    h.prisma.flow.findFirst.mockResolvedValue(flowRow({ isActive: true }));
    expect((await flowRoute.DELETE(req("/api/flows/f_1", "DELETE"), params())).status).toBe(409);
    expect(h.prisma.flow.delete).not.toHaveBeenCalled();
  });
});

describe("abrir como fluxo", () => {
  it("creates a NEW flow OFF from the campaign and never writes to the campaign", async () => {
    h.prisma.automation.findFirst.mockResolvedValue({
      id: "auto_1",
      name: "FOTO",
      workspaceId: "ws_A",
      instagramAccountId: "acc_1",
      trigger: "COMMENT",
      postId: "media_1",
      postUrl: null,
      matchAnyPost: false,
      pendingNextReel: false,
      storyId: null,
      keywords: ["FOTO"],
      matchAnyWord: false,
      wholeWordMatch: true,
      dmTriggerEnabled: false,
      dmMessage: "Link: {link}",
      openingDmEnabled: true,
      openingDmMessage: "Oi!",
      openingDmButtonLabel: "Quero",
      linkButtonLabel: null,
      requireFollow: false,
      followPromptMessage: null,
      followPromptButtonLabel: null,
      followUpEnabled: false,
      followUpMessage: null,
      followUpDelayMinutes: 0,
      publicReplyEnabled: true,
      isActive: true,
      trackedLinks: [{ label: null, destinationUrl: "https://example.com" }],
      sequence: null,
    });
    h.prisma.flow.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => flowRow(data));
    const res = await convertRoute.POST(req("/api/flows/from-campaign/auto_1", "POST"), { params: Promise.resolve({ automationId: "auto_1" }) });
    expect(res.status).toBe(201);
    expect(h.prisma.automation.findFirst.mock.calls[0][0].where).toEqual({ id: "auto_1", workspaceId: "ws_A" });
    const data = h.prisma.flow.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ isActive: false, sourceAutomationId: "auto_1", instagramAccountId: "acc_1", name: "FOTO (fluxo)" });
    const body = await res.json();
    expect(body.data.validation.ok).toBe(true);
    expect(body.data.warnings.map((w: { code: string }) => w.code)).toContain("public_reply_not_copied");
    // The campaign is only read.
    const automation = h.models.get("automation")!;
    for (const method of ["update", "updateMany", "delete", "deleteMany", "upsert", "create"]) {
      expect(automation[method]?.mock.calls.length ?? 0).toBe(0);
    }
  });
});

describe("report", () => {
  it("groups steps per node, clicks and where runs stopped", async () => {
    h.prisma.flow.findFirst.mockResolvedValue(flowRow({ enteredCount: 3, completedCount: 1 }));
    h.prisma.flowStep.groupBy.mockResolvedValue([
      { nodeId: "m1", outcome: "sent", _count: { _all: 3 } },
      { nodeId: "m1", outcome: "tapped", _count: { _all: 2 } },
    ]);
    h.prisma.flowLinkClick.groupBy.mockResolvedValue([{ nodeId: "m1", _count: { _all: 2 } }]);
    h.prisma.flowRun.groupBy.mockResolvedValue([
      { currentNodeId: "m1", status: "WAITING_TAP", _count: { _all: 1 } },
      { currentNodeId: "m2", status: "STOPPED_WINDOW", _count: { _all: 1 } },
      { currentNodeId: "fim", status: "DONE", _count: { _all: 1 } },
    ]);
    const body = await (await reportRoute.GET(req("/api/flows/f_1/report"), params())).json();
    expect(body.data.entered).toBe(3);
    expect(body.data.nodes.m1).toEqual({ passed: 3, outcomes: { sent: 3, tapped: 2 }, clicks: 2, stoppedHere: {}, waitingHere: 1 });
    expect(body.data.nodes.m2.stoppedHere).toEqual({ STOPPED_WINDOW: 1 });
    expect(body.data.totals).toEqual({ runs: 3, byStatus: { WAITING_TAP: 1, STOPPED_WINDOW: 1, DONE: 1 } });
  });
});

describe("MCP flow tools", () => {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const fake: InternalCall = async (method, path, body) => {
    calls.push({ method, path, body });
    if (path === "/api/flows" && method === "GET") return { status: 200, json: { success: true, data: [] } };
    return { status: 200, json: { success: true, data: { id: "f_1", name: "x", isActive: false } } };
  };
  const callTool = (name: string, args: Record<string, unknown>) =>
    handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, fake);

  beforeEach(() => {
    calls.length = 0;
  });

  it("lists, reads, creates and edits drafts, and never calls publish or turn-on", async () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["listar_fluxos", "ver_fluxo", "criar_fluxo", "editar_fluxo", "abrir_campanha_como_fluxo"]));
    expect(names.some((n) => /publicar_fluxo|ativar_fluxo|ligar_fluxo/.test(n))).toBe(false);

    await callTool("listar_fluxos", {});
    await callTool("ver_fluxo", { id: "f_1" });
    await callTool("criar_fluxo", { name: "Novo", gatilho: "DM", rascunho: validDraft });
    await callTool("editar_fluxo", { id: "f_1", rascunho: validDraft, isActive: true });
    await callTool("abrir_campanha_como_fluxo", { automationId: "auto_1" });

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /api/flows",
      "GET /api/flows/f_1",
      "GET /api/flows/f_1/report",
      "POST /api/flows",
      "PATCH /api/flows/f_1",
      "POST /api/flows/from-campaign/auto_1",
    ]);
    expect(calls.some((c) => /\/publish|\/active/.test(c.path))).toBe(false);
    expect(calls[3].body).toEqual({ name: "Novo", triggerType: "DM", draft: validDraft });
    // editar_fluxo only forwards name / draft (isActive is dropped).
    expect(calls[4].body).toEqual({ draft: validDraft });
  });
});
