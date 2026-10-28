/**
 * 27/10/2026: o MCP envia mídia (link de PUT), cria rascunho com ela e, a pedido do dono,
 * agenda e publica. As rotas da tela continuam só da pessoa logada (403 para chave).
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
  const prisma = new Proxy({} as Record<string, unknown>, { get: (_t, name: string) => model(name) });
  return {
    prisma: prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>,
    models,
    mockContext: vi.fn(),
    mockCaller: vi.fn(),
    rate: vi.fn(),
    ready: vi.fn(),
    claim: vi.fn(),
    run: vi.fn(),
    afterFns: [] as (() => Promise<void>)[],
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: h.mockContext,
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));
vi.mock("@/lib/auth", () => ({ getApiCaller: h.mockCaller }));
vi.mock("@/lib/http-rate-limit", () => ({ hitRateLimit: h.rate }));
vi.mock("@/lib/media/s3", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/media/s3")>();
  return {
    ...real,
    readMediaStorageConfig: () => ({
      endpoint: "https://s3.example.com",
      bucket: "bucket",
      region: "us-east-1",
      accessKey: "AK",
      secretKey: "SK",
      publicBaseUrl: "https://midia.example.com/bucket",
    }),
  };
});
vi.mock("@/lib/social/publish", () => ({ claimPost: h.claim, runClaimedPost: h.run }));
vi.mock("@/lib/social/posts-api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/social/posts-api")>();
  return { ...real, readyProblem: h.ready };
});
vi.mock("next/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("next/server")>();
  return { ...real, after: (fn: () => Promise<void>) => void h.afterFns.push(fn) };
});

import { handleMcpMessage, TOOLS, type InternalCall } from "../lib/mcp/server";
import { resolveHandler } from "../lib/mcp/routes";
import { API_KEY_ROUTES, isApiKeyRouteAllowed } from "../lib/api-key-routes";
import * as mediaRoute from "../app/api/mcp-media/upload-url/route";
import * as humanUpload from "../app/api/posts/upload-url/route";
import * as humanSchedule from "../app/api/posts/[id]/schedule/route";
import * as humanPublish from "../app/api/posts/[id]/publish/route";
import * as mcpSchedule from "../app/api/mcp-publish/[id]/schedule/route";
import * as mcpPublish from "../app/api/mcp-publish/[id]/publish/route";
import * as postsRoute from "../app/api/posts/route";

const OWNER = { userId: "u_owner", workspaceId: "ws_A", role: "OWNER" };
const MB = 1024 * 1024;
const req = (method: string, path: string, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const params = (id = "p_1") => ({ params: Promise.resolve({ id }) });
const KEY = { kind: "token", tokenId: "tok_1", scopes: [] };

beforeEach(() => {
  vi.clearAllMocks();
  h.models.clear();
  h.afterFns.length = 0;
  delete process.env.MCP_PUBLISH_DISABLED;
  h.mockCaller.mockResolvedValue(KEY);
  h.mockContext.mockResolvedValue(OWNER);
  h.rate.mockResolvedValue({ allowed: true, count: 1, limit: 30 });
  h.ready.mockResolvedValue(null);
  h.claim.mockResolvedValue(true);
});

describe("enviar_midia_post (rota /api/mcp-media/upload-url)", () => {
  const body = { name: "reel.mp4", contentType: "video/mp4", size: 50 * MB };
  const post = (b: unknown) => mediaRoute.POST(req("POST", "/api/mcp-media/upload-url", b));

  it("gera link assinado dentro da pasta posts do workspace, validade curta, e registra sem conteúdo", async () => {
    const res = await post(body);
    expect(res.status).toBe(200);
    const d = (await res.json()).data;
    expect(d.mediaUrl).toMatch(/^https:\/\/midia\.example\.com\/bucket\/ws_A\/posts\/\d{4}-\d{2}\/[0-9a-f-]+\.mp4$/);
    expect(d.uploadUrl).toContain("/bucket/ws_A/posts/");
    expect(d.uploadUrl).toContain("X-Amz-Expires=900");
    expect(d.mediaBytes).toBe(50 * MB);
    const audit = h.prisma.operationalEvent.create.mock.calls[0][0].data;
    expect(audit.payload).toMatchObject({ tokenId: "tok_1", name: "reel.mp4", size: 50 * MB, contentType: "video/mp4" });
    expect(JSON.stringify(audit)).not.toContain("uploadUrl");
  });

  it("aceita imagem jpeg/png até 8 MB e recusa acima", async () => {
    expect((await post({ name: "s1.png", contentType: "image/png", size: 2 * MB })).status).toBe(200);
    expect((await post({ name: "s1.jpg", contentType: "image/jpeg", size: 9 * MB })).status).toBe(400);
  });

  it.each([
    ["tipo fora da lista", { name: "a.gif", contentType: "image/gif", size: 100 }],
    ["pdf", { name: "a.pdf", contentType: "application/pdf", size: 100 }],
    ["vídeo acima de 2 GB", { name: "a.mp4", contentType: "video/mp4", size: 3 * 1024 * MB }],
    ["tamanho zero", { name: "a.mp4", contentType: "video/mp4", size: 0 }],
    ["nome com ../", { name: "../../etc/passwd", contentType: "video/mp4", size: 100 }],
    ["nome com barra", { name: "pasta/a.mp4", contentType: "video/mp4", size: 100 }],
    ["nome com barra invertida", { name: "pasta\\a.mp4", contentType: "video/mp4", size: 100 }],
    ["campo extra", { ...body, key: "outra/pasta.mp4" }],
  ])("recusa %s", async (_n, b) => {
    const res = await post(b);
    expect(res.status).toBe(400);
    expect(h.prisma.operationalEvent.create).not.toHaveBeenCalled();
  });

  it("limite por chave: 429 quando passa de 30/hora, e usa o id da chave", async () => {
    h.rate.mockResolvedValue({ allowed: false, count: 31, limit: 30 });
    expect((await post(body)).status).toBe(429);
    expect(h.rate).toHaveBeenCalledWith("mcp-media", "tok_1", 30, 3600);
    expect(h.prisma.operationalEvent.create).not.toHaveBeenCalled();
  });

  it("sem contador (Redis fora) não gera link", async () => {
    h.rate.mockResolvedValue({ allowed: true, count: 0, limit: 30 });
    expect((await post(body)).status).toBe(503);
  });

  it("pessoa logada recebe 403 (a tela usa a rota própria); chave inválida 401", async () => {
    h.mockCaller.mockResolvedValue({ kind: "session" });
    expect((await post(body)).status).toBe(403);
    h.mockCaller.mockResolvedValue({ kind: "token", tokenId: null, scopes: [] });
    expect((await post(body)).status).toBe(401);
  });

  it("papel sem permissão de gerenciar é recusado", async () => {
    h.mockContext.mockResolvedValue({ ...OWNER, role: "MEMBER" });
    expect((await post(body)).status).toBe(403);
  });

  it("se a auditoria falha, não entrega o link", async () => {
    h.prisma.operationalEvent.create.mockRejectedValue(new Error("db"));
    expect((await post(body)).status).toBe(500);
  });

  it("a rota HTTP /api/posts/upload-url continua 403 human_only para a chave, e fora do roteador e da lista da chave", async () => {
    const res = await humanUpload.POST(req("POST", "/api/posts/upload-url", { contentType: "video/mp4", size: 1000 }));
    expect(res.status).toBe(403);
    expect(resolveHandler("POST", "/api/posts/upload-url")).toBeNull();
    expect(isApiKeyRouteAllowed("POST", "/api/posts/upload-url")).toBe(false);
  });

  it("a ferramenta chama só a rota do MCP e devolve o mediaUrl e o passo do curl", async () => {
    const call = vi.fn(async () => ({
      status: 200,
      json: { success: true, data: { uploadUrl: "https://s3/x?sig", mediaUrl: "https://midia/ws/posts/a.mp4", mediaBytes: 10, mediaContentType: "video/mp4", headers: {}, expiresAt: "x" } },
    }));
    const tool = TOOLS.find((t) => t.name === "enviar_midia_post")!;
    const out = await tool.run({ nome: "a.mp4", contentType: "video/mp4", bytes: 10 }, call as unknown as InternalCall);
    expect(call).toHaveBeenCalledWith("POST", "/api/mcp-media/upload-url", { name: "a.mp4", contentType: "video/mp4", size: 10 });
    expect(JSON.stringify(out)).toContain("mediaUrl");
    expect(JSON.stringify(out)).toContain("curl -X PUT");
  });
});

describe("rascunho com a mídia recém-enviada", () => {
  const mediaUrl = "https://midia.example.com/bucket/ws_A/posts/2026-10/abc.jpg";
  const created = () =>
    h.prisma.scheduledPost.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "p_9",
      ...data,
      channel: { username: "x", name: "x" },
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

  it("carrossel do Instagram nasce DRAFT, sem horário, e nunca SCHEDULED", async () => {
    created();
    h.prisma.instagramAccount.findFirst.mockResolvedValue({ id: "c_1", platform: "INSTAGRAM" });
    const slides = [1, 2].map((n) => ({ url: mediaUrl.replace("abc", `s${n}`), bytes: MB, contentType: "image/jpeg" }));
    const res = await postsRoute.POST(
      req("POST", "/api/posts", {
        socialAccountId: "c_1",
        caption: "oi",
        mediaUrl: slides[0].url,
        mediaBytes: MB,
        mediaContentType: "image/jpeg",
        settings: { shareToFeed: true, format: "CAROUSEL", slides },
        scheduledAt: "2030-01-01T10:00:00.000Z",
      })
    );
    expect(res.status).toBe(201);
    const data = h.prisma.scheduledPost.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "DRAFT", scheduledAt: null, createdVia: "MCP" });
  });

  it("slide de fora do armazenamento é recusado já no rascunho", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue({ id: "c_1", platform: "INSTAGRAM" });
    const res = await postsRoute.POST(
      req("POST", "/api/posts", {
        socialAccountId: "c_1",
        caption: "oi",
        mediaUrl,
        mediaBytes: MB,
        mediaContentType: "image/jpeg",
        settings: { shareToFeed: true, format: "CAROUSEL", slides: [{ url: "https://evil.example.com/a.jpg", bytes: MB, contentType: "image/jpeg" }] },
      })
    );
    expect(res.status).toBe(400);
    expect(h.prisma.scheduledPost.create).not.toHaveBeenCalled();
  });

  it("criar_rascunho_post aceita imagem no schema e só faz POST /api/posts", () => {
    const tool = TOOLS.find((t) => t.name === "criar_rascunho_post")!;
    const props = (tool.inputSchema as { properties: { mediaContentType: { enum: string[] } } }).properties;
    expect(props.mediaContentType.enum).toEqual(expect.arrayContaining(["image/jpeg", "image/png"]));
    expect(tool.description).toContain("CAROUSEL");
  });
});

describe("agendar_post e publicar_post (rotas do MCP)", () => {
  const FUTURE = new Date(Date.now() + 3 * 24 * 3600 * 1000);
  const draft = (over: Record<string, unknown> = {}) => ({
    id: "p_1",
    workspaceId: "ws_A",
    platform: "TIKTOK",
    status: "DRAFT",
    caption: "Legenda do post",
    scheduledAt: null,
    lastError: null,
    socialAccount: { displayName: "x" },
    channel: null,
    ...over,
  });
  const when = FUTURE.toISOString();
  const sched = (b: unknown, id = "p_1") => mcpSchedule.POST(req("POST", `/api/mcp-publish/${id}/schedule`, b), params(id));
  const pub = (id = "p_1") => mcpPublish.POST(req("POST", `/api/mcp-publish/${id}/publish`, {}), params(id));

  it("rascunho -> agendado -> publicado, lido do banco, com horário de Brasília e dia da semana", async () => {
    const state = draft();
    h.prisma.scheduledPost.findFirst.mockImplementation(async () => ({ ...state }));
    h.prisma.scheduledPost.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(state, data);
      return { ...state };
    });

    const r1 = await sched({ scheduledAt: when });
    expect(r1.status).toBe(200);
    const d1 = (await r1.json()).data;
    expect(d1).toMatchObject({ conferencia: "CONFERE", id: "p_1", rede: "TIKTOK", estado: "SCHEDULED", legenda: "Legenda do post" });
    expect(d1.horario).toMatch(/-feira|sábado|domingo/);
    expect(d1.horario).toContain("(Brasília)");
    expect(h.ready).toHaveBeenCalled();

    const r2 = await pub();
    expect(r2.status).toBe(202);
    expect(h.claim).toHaveBeenCalledWith("p_1");
    state.status = "PUBLISHING";
    h.prisma.scheduledPost.findFirst.mockImplementation(async () => ({ ...state }));
    expect(h.afterFns).toHaveLength(1);
    await h.afterFns[0]();
    expect(h.run).toHaveBeenCalledWith("p_1");
  });

  it("devolve NÃO CONFERE quando o estado gravado diverge do pedido", async () => {
    h.prisma.scheduledPost.findFirst.mockResolvedValue(draft());
    h.prisma.scheduledPost.update.mockResolvedValue(draft({ status: "SCHEDULED", scheduledAt: new Date(FUTURE) }));
    const res = await sched({ scheduledAt: when });
    expect((await res.json()).data.conferencia).toBe("NÃO CONFERE");
  });

  it("interruptor de emergência MCP_PUBLISH_DISABLED=1 desliga as duas, com mensagem em português", async () => {
    process.env.MCP_PUBLISH_DISABLED = "1";
    for (const res of [await sched({ scheduledAt: when }), await pub()]) {
      expect(res.status).toBe(503);
      expect(JSON.stringify(await res.json())).toContain("desligado");
    }
    expect(h.prisma.scheduledPost.update).not.toHaveBeenCalled();
    expect(h.claim).not.toHaveBeenCalled();
  });

  it("funciona por padrão (sem variável nenhuma) e não pede frase de confirmação", async () => {
    h.prisma.scheduledPost.findFirst.mockResolvedValue(draft());
    h.prisma.scheduledPost.update.mockResolvedValue(draft({ status: "SCHEDULED", scheduledAt: new Date(when) }));
    expect((await sched({ scheduledAt: when })).status).toBe(200);
    const names = TOOLS.filter((t) => ["agendar_post", "publicar_post"].includes(t.name));
    expect(names).toHaveLength(2);
    for (const t of names) expect(JSON.stringify(t.inputSchema)).not.toContain("confirmacao");
  });

  it("post de outro workspace ou inexistente dá 404 e a busca é pelo workspace da chave", async () => {
    h.prisma.scheduledPost.findFirst.mockResolvedValue(null);
    expect((await sched({ scheduledAt: when }, "p_x")).status).toBe(404);
    expect((await pub("p_x")).status).toBe(404);
    expect(h.prisma.scheduledPost.findFirst.mock.calls[0][0].where).toMatchObject({ id: "p_x", workspaceId: "ws_A" });
    expect(h.prisma.scheduledPost.update).not.toHaveBeenCalled();
    expect(h.claim).not.toHaveBeenCalled();
  });

  it("horário sem fuso, inválido ou no passado é recusado", async () => {
    h.prisma.scheduledPost.findFirst.mockResolvedValue(draft());
    expect((await sched({ scheduledAt: "2030-01-01T10:00:00" })).status).toBe(400);
    expect((await sched({ scheduledAt: "amanhã" })).status).toBe(400);
    expect((await sched({})).status).toBe(400);
    expect((await sched({ scheduledAt: "2020-01-01T10:00:00-03:00" })).status).toBe(400);
    expect(h.prisma.scheduledPost.update).not.toHaveBeenCalled();
  });

  it("idempotente: mesmo horário já agendado não grava nem audita de novo; publicar duas vezes não dispara de novo", async () => {
    h.prisma.scheduledPost.findFirst.mockResolvedValue(draft({ status: "SCHEDULED", scheduledAt: new Date(when) }));
    const r = await sched({ scheduledAt: when });
    expect(r.status).toBe(200);
    expect((await r.json()).data.aviso).toContain("Nada foi alterado");
    expect(h.prisma.scheduledPost.update).not.toHaveBeenCalled();
    expect(h.prisma.operationalEvent.create).not.toHaveBeenCalled();

    h.prisma.scheduledPost.findFirst.mockResolvedValue(draft({ status: "PUBLISHING" }));
    const p = await pub();
    expect(p.status).toBe(200);
    expect(h.claim).not.toHaveBeenCalled();
    h.prisma.scheduledPost.findFirst.mockResolvedValue(draft({ status: "PUBLISHED" }));
    expect((await pub()).status).toBe(200);
    expect(h.claim).not.toHaveBeenCalled();
  });

  it("só age em rascunho ou agendado (FAILED/CANCELED/PUBLISHED não)", async () => {
    for (const status of ["FAILED", "CANCELED"]) {
      h.prisma.scheduledPost.findFirst.mockResolvedValue(draft({ status }));
      expect((await sched({ scheduledAt: when })).status).toBe(409);
      expect((await pub()).status).toBe(409);
    }
    h.prisma.scheduledPost.findFirst.mockResolvedValue(draft({ status: "PUBLISHED" }));
    expect((await sched({ scheduledAt: when })).status).toBe(409);
  });

  it("repassa o problema do readyProblem (ex.: YouTube sem a declaração) e não agenda", async () => {
    h.prisma.scheduledPost.findFirst.mockResolvedValue(draft({ platform: "YOUTUBE" }));
    h.ready.mockResolvedValue({ message: "Answer the made-for-kids question", code: "invalid_settings" });
    expect((await sched({ scheduledAt: when })).status).toBe(400);
    expect((await pub()).status).toBe(400);
    expect(h.prisma.scheduledPost.update).not.toHaveBeenCalled();
    expect(h.claim).not.toHaveBeenCalled();
  });

  it("pessoa logada recebe 403 nas rotas do MCP; auditoria é sem legenda", async () => {
    h.prisma.scheduledPost.findFirst.mockResolvedValue(draft());
    h.prisma.scheduledPost.update.mockResolvedValue(draft({ status: "SCHEDULED", scheduledAt: new Date(when) }));
    await sched({ scheduledAt: when });
    const audit = h.prisma.operationalEvent.create.mock.calls[0][0].data;
    expect(audit.payload).toMatchObject({ tokenId: "tok_1", postId: "p_1", platform: "TIKTOK" });
    expect(JSON.stringify(audit)).not.toContain("Legenda do post");
    h.mockCaller.mockResolvedValue({ kind: "session" });
    expect((await sched({ scheduledAt: when })).status).toBe(403);
    expect((await pub()).status).toBe(403);
  });

  it("as rotas HTTP da tela (/api/posts/[id]/schedule e /publish) continuam 403 human_only para a chave", async () => {
    const a = await humanSchedule.POST(req("POST", "/api/posts/p_1/schedule", { scheduledAt: "2035-01-01T10:00:00.000Z" }), params());
    const b = await humanPublish.POST(req("POST", "/api/posts/p_1/publish"), params());
    expect(a.status).toBe(403);
    expect(b.status).toBe(403);
    expect(resolveHandler("POST", "/api/posts/p_1/schedule")).toBeNull();
    expect(resolveHandler("POST", "/api/posts/p_1/publish")).toBeNull();
    expect(isApiKeyRouteAllowed("POST", "/api/posts/p_1/schedule")).toBe(false);
    expect(isApiKeyRouteAllowed("POST", "/api/posts/p_1/publish")).toBe(false);
    expect(h.prisma.scheduledPost.update).not.toHaveBeenCalled();
  });

  it("roteador e lista da chave concordam; nenhuma ferramenta apaga ou cancela", () => {
    for (const path of ["/api/mcp-media/upload-url", "/api/mcp-publish/p_1/schedule", "/api/mcp-publish/p_1/publish"]) {
      expect(resolveHandler("POST", path)).not.toBeNull();
      expect(isApiKeyRouteAllowed("POST", path)).toBe(true);
    }
    expect(isApiKeyRouteAllowed("DELETE", "/api/mcp-publish/p_1/publish")).toBe(false);
    expect(API_KEY_ROUTES.length).toBeGreaterThan(0);
    expect(TOOLS.map((t) => t.name).filter((n) => /apagar|cancelar|deletar/.test(n) && /post/.test(n))).toEqual([]);
  });

  it("as ferramentas passam pelo JSON-RPC e chamam as rotas certas", async () => {
    const calls: [string, string, unknown][] = [];
    const call: InternalCall = async (m, p, b) => {
      calls.push([m, p, b]);
      return { status: 200, json: { success: true, data: { conferencia: "CONFERE" } } };
    };
    await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "agendar_post", arguments: { postId: "p_1", scheduledAt: when } } }, call);
    await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "publicar_post", arguments: { postId: "p_1" } } }, call);
    expect(calls.map((c) => c[1])).toEqual(["/api/mcp-publish/p_1/schedule", "/api/mcp-publish/p_1/publish"]);
  });
});
