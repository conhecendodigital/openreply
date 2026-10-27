/**
 * Aba Posts (TikTok): regras do servidor que valem mesmo sem a tela.
 * MCP e chave de API só leem e criam rascunho; agendar, publicar, cancelar,
 * apagar e subir vídeo são ações da pessoa logada.
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
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: h.mockContext,
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));
vi.mock("@/lib/auth", () => ({ getApiCaller: h.mockCaller }));
vi.mock("@/lib/media/s3", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/media/s3")>();
  return {
    ...real,
    readMediaStorageConfig: () => ({ publicBaseUrl: "https://midia.example.com/bucket" }),
  };
});

import { draftSettingsSchema, tiktokSettingsSchema, DEFAULT_TIKTOK_SETTINGS } from "../lib/tiktok/settings";
import { planChunks } from "../lib/tiktok/client";
import { getTikTokAuthorizationUrl, getMissingTikTokEnv } from "../lib/tiktok/oauth";
import { createPostSchema, mediaLimitsProblem, mediaUrlProblem } from "../lib/tiktok/posts-api";
import { tiktokProvider } from "../lib/social/providers/tiktok";
import { isApiKeyRouteAllowed } from "../lib/api-key-routes";
import { resolveHandler } from "../lib/mcp/routes";
import { handleMcpMessage, TOOLS, type InternalCall } from "../lib/mcp/server";
import * as postsRoute from "../app/api/posts/route";
import * as scheduleRoute from "../app/api/posts/[id]/schedule/route";
import * as publishRoute from "../app/api/posts/[id]/publish/route";
import * as cancelRoute from "../app/api/posts/[id]/cancel/route";
import * as postRoute from "../app/api/posts/[id]/route";
import * as uploadRoute from "../app/api/posts/upload-url/route";

const OWNER = { userId: "u_owner", workspaceId: "ws_A", role: "OWNER" };
const MB = 1024 * 1024;
const GOOD_URL = "https://midia.example.com/bucket/ws_A/posts/video.mp4";

const req = (method: string, path: string, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const params = (id = "p_1") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.models.clear();
  h.mockCaller.mockResolvedValue({ kind: "session" });
  h.mockContext.mockResolvedValue(OWNER);
});

describe("opções do TikTok", () => {
  it("o padrão do rascunho é privado, tudo desligado, e passa na regra estrita", () => {
    expect(DEFAULT_TIKTOK_SETTINGS.privacyLevel).toBe("SELF_ONLY");
    expect(tiktokSettingsSchema.safeParse(DEFAULT_TIKTOK_SETTINGS).success).toBe(true);
  });

  it("rascunho aceita privacidade ainda não escolhida, publicar não", () => {
    const vazio = { ...DEFAULT_TIKTOK_SETTINGS, privacyLevel: "" };
    expect(draftSettingsSchema.safeParse(vazio).success).toBe(true);
    expect(tiktokSettingsSchema.safeParse(vazio).success).toBe(false);
  });

  it("recusa campo desconhecido", () => {
    expect(tiktokSettingsSchema.safeParse({ ...DEFAULT_TIKTOK_SETTINGS, extra: 1 }).success).toBe(false);
  });
});

describe("envio do vídeo em partes", () => {
  it("até 64 MB vai de uma vez", () => {
    expect(planChunks(10 * MB)).toEqual({ chunkSize: 10 * MB, totalChunks: 1 });
    expect(planChunks(64 * MB)).toEqual({ chunkSize: 64 * MB, totalChunks: 1 });
  });

  it("acima disso usa partes de 32 MB e a última leva o resto", () => {
    const size = 100 * MB;
    const { chunkSize, totalChunks } = planChunks(size);
    expect(chunkSize).toBe(32 * MB);
    expect(totalChunks).toBe(3);
    const last = size - chunkSize * (totalChunks - 1);
    expect(last).toBeGreaterThanOrEqual(5 * MB);
    expect(last).toBeLessThanOrEqual(128 * MB);
  });
});

describe("login do TikTok", () => {
  it("monta o endereço com os três escopos e o state", () => {
    vi.stubEnv("TIKTOK_CLIENT_KEY", "ck_test");
    const url = new URL(getTikTokAuthorizationUrl("https://many.leadenginer.com/api/tiktok/callback", "st_1"));
    expect(url.origin + url.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(url.searchParams.get("client_key")).toBe("ck_test");
    expect(url.searchParams.get("scope")).toBe("user.info.basic,video.upload,video.publish");
    expect(url.searchParams.get("state")).toBe("st_1");
    expect(url.searchParams.get("response_type")).toBe("code");
    vi.unstubAllEnvs();
  });

  it("diz quais variáveis faltam", () => {
    expect(getMissingTikTokEnv({}).sort()).toEqual(["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"]);
    expect(getMissingTikTokEnv({ TIKTOK_CLIENT_KEY: "a", TIKTOK_CLIENT_SECRET: "b" })).toEqual([]);
  });
});

describe("endereço do vídeo (o servidor baixa esse endereço)", () => {
  it("aceita só a pasta posts deste workspace", () => {
    expect(mediaUrlProblem("ws_A", GOOD_URL)).toBeNull();
    expect(mediaUrlProblem("ws_A", "https://midia.example.com/bucket/ws_B/posts/video.mp4")).not.toBeNull();
    expect(mediaUrlProblem("ws_A", "http://169.254.169.254/latest/meta-data")).not.toBeNull();
    expect(mediaUrlProblem("ws_A", "https://midia.example.com/bucket/ws_A/outro/video.mp4")).not.toBeNull();
  });

  it("o corpo de criação é estrito e limita legenda e tipo de vídeo", () => {
    const base = { socialAccountId: "a_1", caption: "oi", mediaUrl: GOOD_URL, mediaBytes: 5 * MB, mediaContentType: "video/mp4" };
    expect(createPostSchema.safeParse(base).success).toBe(true);
    // O corpo aceita até a maior legenda das redes (YouTube, 5000); o limite do TikTok (2200) vale ao escolher a conta.
    expect(createPostSchema.safeParse({ ...base, caption: "x".repeat(5001) }).success).toBe(false);
    expect(mediaLimitsProblem(tiktokProvider, { caption: "x".repeat(2201) })).not.toBeNull();
    expect(mediaLimitsProblem(tiktokProvider, { caption: "x".repeat(2200) })).toBeNull();
    // 27/10/2026: o corpo aceita imagem (slide de carrossel do Instagram), mas o TikTok recusa ao escolher a conta.
    expect(createPostSchema.safeParse({ ...base, mediaContentType: "image/png" }).success).toBe(true);
    expect(mediaLimitsProblem(tiktokProvider, { mediaContentType: "image/png" })).not.toBeNull();
    expect(createPostSchema.safeParse({ ...base, mediaContentType: "image/gif" }).success).toBe(false);
    expect(createPostSchema.safeParse({ ...base, status: "SCHEDULED" }).success).toBe(false);
  });
});

describe("POST /api/posts cria só rascunho", () => {
  const body = { socialAccountId: "a_1", caption: "oi", mediaUrl: GOOD_URL, mediaBytes: 5 * MB, mediaContentType: "video/mp4" };

  it("nasce rascunho sem horário, privado por padrão, marcado MCP quando vem de chave", async () => {
    h.mockCaller.mockResolvedValue({ kind: "token" });
    h.prisma.socialAccount.findFirst.mockResolvedValue({ id: "a_1", platform: "TIKTOK", displayName: "Matheus" });
    h.prisma.scheduledPost.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "p_9",
      ...data,
      socialAccount: { displayName: "Matheus" },
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    const res = await postsRoute.POST(req("POST", "/api/posts", { ...body, scheduledAt: "2030-01-01T10:00:00.000Z" }));
    // Mesmo com horário no corpo, nasce rascunho sem horário: agendar é ação da tela.
    expect(res.status).toBe(201);
    const data = h.prisma.scheduledPost.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "DRAFT", scheduledAt: null, createdVia: "MCP", workspaceId: "ws_A" });
    expect(data.settings).toEqual(DEFAULT_TIKTOK_SETTINGS);
  });

  it("recusa vídeo de fora do armazenamento", async () => {
    h.prisma.socialAccount.findFirst.mockResolvedValue({ id: "a_1", platform: "TIKTOK", displayName: "Matheus" });
    const res = await postsRoute.POST(req("POST", "/api/posts", { ...body, mediaUrl: "https://evil.example.com/v.mp4" }));
    expect(res.status).toBe(400);
    expect(h.prisma.scheduledPost.create).not.toHaveBeenCalled();
  });

  it("conta de outro workspace ou desconectada dá 404", async () => {
    h.prisma.socialAccount.findFirst.mockResolvedValue(null);
    const res = await postsRoute.POST(req("POST", "/api/posts", body));
    expect(res.status).toBe(404);
    const where = h.prisma.socialAccount.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ workspaceId: "ws_A", status: { not: "DISCONNECTED" } });
  });
});

describe("chave de API e MCP não agendam nem publicam", () => {
  beforeEach(() => h.mockCaller.mockResolvedValue({ kind: "token" }));

  it.each([
    ["schedule", () => scheduleRoute.POST(req("POST", "/api/posts/p_1/schedule", { scheduledAt: "2035-01-01T10:00:00.000Z" }), params())],
    ["publish", () => publishRoute.POST(req("POST", "/api/posts/p_1/publish"), params())],
    ["cancel", () => cancelRoute.POST(req("POST", "/api/posts/p_1/cancel"), params())],
    ["delete", () => postRoute.DELETE(req("DELETE", "/api/posts/p_1"), params())],
    ["upload", () => uploadRoute.POST(req("POST", "/api/posts/upload-url", { contentType: "video/mp4", size: 1000 }))],
  ])("%s dá 403 human_only e não mexe em nada", async (_name, run) => {
    const res = await run();
    expect(res.status).toBe(403);
    expect((await res.json()).code ?? "human_only").toBe("human_only");
    expect(h.prisma.scheduledPost.update).not.toHaveBeenCalled();
    expect(h.prisma.scheduledPost.updateMany).not.toHaveBeenCalled();
    expect(h.prisma.scheduledPost.delete).not.toHaveBeenCalled();
  });

  it("PATCH com horário (agendar por outro caminho) também é recusado", async () => {
    h.prisma.scheduledPost.findFirst.mockResolvedValue({ id: "p_1", status: "DRAFT", workspaceId: "ws_A" });
    const res = await postRoute.PATCH(req("PATCH", "/api/posts/p_1", { scheduledAt: "2035-01-01T10:00:00.000Z" }), params());
    expect(res.status).toBe(403);
    expect(h.prisma.scheduledPost.update).not.toHaveBeenCalled();
  });
});

describe("PATCH pela tela", () => {
  const uiBody = (extra: Record<string, unknown> = {}) => ({
    socialAccountId: "a_1",
    caption: "Legenda nova",
    mediaUrl: GOOD_URL,
    mediaBytes: 5 * MB,
    mediaContentType: "video/mp4",
    settings: { ...DEFAULT_TIKTOK_SETTINGS },
    ...extra,
  });

  it("aceita o mesmo corpo que a tela manda ao salvar (com a conta) e não troca a conta se for a mesma", async () => {
    h.prisma.scheduledPost.findFirst.mockResolvedValue({ id: "p_1", status: "DRAFT", workspaceId: "ws_A", socialAccountId: "a_1" });
    const now = new Date();
    h.prisma.scheduledPost.update.mockResolvedValue({
      id: "p_1", platform: "TIKTOK", status: "DRAFT", workspaceId: "ws_A", socialAccountId: "a_1",
      socialAccount: { displayName: "Matheus" }, caption: "Legenda nova", mediaUrl: GOOD_URL, mediaBytes: 5 * MB,
      mediaContentType: "video/mp4", settings: {}, scheduledAt: null, publishedAt: null, lastError: null,
      createdVia: "UI", createdAt: now, updatedAt: now,
    });
    const res = await postRoute.PATCH(req("PATCH", "/api/posts/p_1", uiBody()), params());
    expect(res.status).not.toBe(400);
    expect(h.prisma.socialAccount.findFirst).not.toHaveBeenCalled();
    const data = h.prisma.scheduledPost.update.mock.calls[0][0].data;
    expect(data.socialAccountId).toBeUndefined();
    expect(data.caption).toBe("Legenda nova");
  });

  it("troca a conta só por uma conta conectada deste workspace", async () => {
    h.prisma.scheduledPost.findFirst.mockResolvedValue({ id: "p_1", status: "DRAFT", workspaceId: "ws_A", socialAccountId: "a_1" });
    h.prisma.socialAccount.findFirst.mockResolvedValue(null);
    const res = await postRoute.PATCH(req("PATCH", "/api/posts/p_1", uiBody({ socialAccountId: "a_de_outro" })), params());
    expect(res.status).toBe(404);
    expect(h.prisma.socialAccount.findFirst.mock.calls[0][0].where).toMatchObject({ id: "a_de_outro", workspaceId: "ws_A" });
    expect(h.prisma.scheduledPost.update).not.toHaveBeenCalled();
  });
});

describe("lista de rotas da chave de API", () => {
  it("libera ler e criar posts, ler contas; nada de agendar, publicar, cancelar, subir vídeo", () => {
    expect(isApiKeyRouteAllowed("GET", "/api/posts")).toBe(true);
    expect(isApiKeyRouteAllowed("POST", "/api/posts")).toBe(true);
    expect(isApiKeyRouteAllowed("GET", "/api/posts/p_1")).toBe(true);
    expect(isApiKeyRouteAllowed("GET", "/api/social-accounts")).toBe(true);
    expect(isApiKeyRouteAllowed("POST", "/api/social-accounts")).toBe(false);
    expect(isApiKeyRouteAllowed("POST", "/api/posts/p_1/schedule")).toBe(false);
    expect(isApiKeyRouteAllowed("POST", "/api/posts/p_1/publish")).toBe(false);
    expect(isApiKeyRouteAllowed("POST", "/api/posts/p_1/cancel")).toBe(false);
    expect(isApiKeyRouteAllowed("POST", "/api/posts/upload-url")).toBe(false);
    expect(isApiKeyRouteAllowed("GET", "/api/social-accounts/a_1/creator-info")).toBe(false);
    expect(isApiKeyRouteAllowed("DELETE", "/api/social-accounts/a_1")).toBe(false);
  });
});

describe("MCP", () => {
  it("roteia contas e posts; agendar e publicar não existem no roteador", () => {
    expect(resolveHandler("GET", "/api/social-accounts")).not.toBeNull();
    expect(resolveHandler("GET", "/api/posts")).not.toBeNull();
    expect(resolveHandler("POST", "/api/posts")).not.toBeNull();
    expect(resolveHandler("GET", "/api/posts/p_1")?.id).toBe("p_1");
    expect(resolveHandler("POST", "/api/posts/p_1/schedule")).toBeNull();
    expect(resolveHandler("POST", "/api/posts/p_1/publish")).toBeNull();
    expect(resolveHandler("POST", "/api/posts/p_1/cancel")).toBeNull();
    expect(resolveHandler("POST", "/api/posts/upload-url")).toBeNull();
  });

  it("tem as 4 ferramentas e nenhuma agenda ou publica", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["listar_contas_sociais", "listar_posts_agendados", "ver_post_agendado", "criar_rascunho_post"])
    );
    expect(names.filter((n) => /agendar_post|publicar_post|cancelar_post|apagar_post/.test(n))).toEqual([]);
  });

  it("criar_rascunho_post só faz POST /api/posts", async () => {
    const calls: [string, string, unknown][] = [];
    const call: InternalCall = async (method, path, body) => {
      calls.push([method, path, body]);
      return { status: 201, json: { success: true, data: { id: "p_9", status: "DRAFT" } } };
    };
    const res = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "criar_rascunho_post",
          arguments: { socialAccountId: "a_1", caption: "oi", mediaUrl: GOOD_URL, mediaBytes: 1000, mediaContentType: "video/mp4" },
        },
      },
      call
    );
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("POST");
    expect(calls[0][1]).toBe("/api/posts");
    expect(JSON.stringify(res)).toContain("DRAFT");
  });

  it("criar_rascunho_post sem vídeo não chama a API", async () => {
    const call = vi.fn();
    const tool = TOOLS.find((t) => t.name === "criar_rascunho_post")!;
    const out = await tool.run({ socialAccountId: "a_1", caption: "oi" }, call as unknown as InternalCall);
    expect(call).not.toHaveBeenCalled();
    expect(JSON.stringify(out)).toContain("mediaUrl");
  });

  it("listar_posts_agendados repassa o filtro de status", async () => {
    const call = vi.fn(async () => ({ status: 200, json: { success: true, data: [] } }));
    const tool = TOOLS.find((t) => t.name === "listar_posts_agendados")!;
    await tool.run({ status: "FAILED" }, call as unknown as InternalCall);
    expect(call).toHaveBeenCalledWith("GET", "/api/posts?status=FAILED", undefined);
  });
});
