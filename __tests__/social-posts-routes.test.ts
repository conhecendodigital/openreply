/**
 * Aba Posts em várias redes: a conta é achada nas duas tabelas, o rascunho segue
 * a rede da conta, a lista de contas junta tudo, o cron confere o Instagram e
 * MCP/chave de API continuam só lendo e criando rascunho.
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
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => t, encryptToken: (t: string) => t }));
vi.mock("@/lib/media/s3", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/media/s3")>();
  return { ...real, readMediaStorageConfig: () => ({ publicBaseUrl: "https://midia.example.com/bucket" }) };
});

import { findPostableAccount, listPostableAccounts } from "../lib/social/accounts";
import { sweepSocialPosts } from "../lib/social/publish";
import { providerFor, providerForPost } from "../lib/social/providers";
import { isApiKeyRouteAllowed } from "../lib/api-key-routes";
import { resolveHandler } from "../lib/mcp/routes";
import { YOUTUBE_SCOPES } from "../lib/youtube/oauth";
import * as postsRoute from "../app/api/posts/route";
import * as scheduleRoute from "../app/api/posts/[id]/schedule/route";
import * as publishRoute from "../app/api/posts/[id]/publish/route";
import * as accountsRoute from "../app/api/social-accounts/route";
import * as accountRoute from "../app/api/social-accounts/[id]/route";

const OWNER = { userId: "u_owner", workspaceId: "ws_A", role: "OWNER" };
const MB = 1024 * 1024;
const GOOD_URL = "https://midia.example.com/bucket/ws_A/posts/video.mp4";
const NOW = new Date("2026-10-23T15:00:00.000Z");

const req = (method: string, path: string, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const params = (id = "p_1") => ({ params: Promise.resolve({ id }) });
const body = (over: Record<string, unknown> = {}) => ({
  socialAccountId: "acc_1",
  caption: "oi",
  mediaUrl: GOOD_URL,
  mediaBytes: 5 * MB,
  mediaContentType: "video/mp4",
  ...over,
});
const echoCreate = () =>
  h.prisma.scheduledPost.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "p_9",
    ...data,
    socialAccount: null,
    channel: null,
    createdAt: NOW,
    updatedAt: NOW,
  }));

beforeEach(() => {
  vi.clearAllMocks();
  h.models.clear();
  h.mockCaller.mockResolvedValue({ kind: "session" });
  h.mockContext.mockResolvedValue(OWNER);
});

describe("achar a conta nas duas tabelas", () => {
  it("TikTok e YouTube vêm de SocialAccount", async () => {
    h.prisma.socialAccount.findFirst.mockResolvedValue({ id: "acc_1", platform: "YOUTUBE" });
    expect(await findPostableAccount("ws_A", "acc_1")).toEqual({ id: "acc_1", source: "social", platform: "YOUTUBE" });
    expect(h.prisma.instagramAccount.findFirst).not.toHaveBeenCalled();
  });

  it("Instagram e Facebook vêm do canal (InstagramAccount)", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue({ id: "acc_1", platform: "FACEBOOK" });
    expect(await findPostableAccount("ws_A", "acc_1")).toEqual({ id: "acc_1", source: "channel", platform: "FACEBOOK" });
    h.prisma.instagramAccount.findFirst.mockResolvedValue({ id: "acc_1", platform: "INSTAGRAM" });
    expect((await findPostableAccount("ws_A", "acc_1"))?.platform).toBe("INSTAGRAM");
  });

  it("conta de outro workspace ou desconectada não é achada; a busca sempre filtra o workspace", async () => {
    expect(await findPostableAccount("ws_A", "acc_x")).toBeNull();
    for (const model of [h.prisma.socialAccount, h.prisma.instagramAccount]) {
      expect(model.findFirst.mock.calls[0][0].where).toMatchObject({ id: "acc_x", workspaceId: "ws_A", status: { not: "DISCONNECTED" } });
    }
  });
});

describe("POST /api/posts em cada rede", () => {
  it("YouTube: grava socialAccountId, plataforma e o padrão privado", async () => {
    h.prisma.socialAccount.findFirst.mockResolvedValue({ id: "acc_1", platform: "YOUTUBE" });
    echoCreate();
    const res = await postsRoute.POST(req("POST", "/api/posts", body({ settings: { title: "Oi" } })));
    expect(res.status).toBe(201);
    const data = h.prisma.scheduledPost.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ platform: "YOUTUBE", socialAccountId: "acc_1", channelId: null, status: "DRAFT", scheduledAt: null });
    expect(data.settings).toEqual({ title: "Oi" });
  });

  it("YouTube sem opções começa privado, sem resposta sobre crianças", async () => {
    h.prisma.socialAccount.findFirst.mockResolvedValue({ id: "acc_1", platform: "YOUTUBE" });
    echoCreate();
    await postsRoute.POST(req("POST", "/api/posts", body()));
    const settings = h.prisma.scheduledPost.create.mock.calls[0][0].data.settings;
    expect(settings.privacyStatus).toBe("private");
    expect(settings).not.toHaveProperty("selfDeclaredMadeForKids");
  });

  it("Instagram: grava channelId (não socialAccountId)", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue({ id: "acc_1", platform: "INSTAGRAM" });
    echoCreate();
    const res = await postsRoute.POST(req("POST", "/api/posts", body()));
    expect(res.status).toBe(201);
    expect(h.prisma.scheduledPost.create.mock.calls[0][0].data).toMatchObject({ platform: "INSTAGRAM", channelId: "acc_1", socialAccountId: null });
  });

  it("respeita o limite da rede já no rascunho: legenda de 2201 no Instagram é recusada, no YouTube passa", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue({ id: "acc_1", platform: "INSTAGRAM" });
    const longa = body({ caption: "x".repeat(2201) });
    expect((await postsRoute.POST(req("POST", "/api/posts", longa))).status).toBe(400);
    h.prisma.instagramAccount.findFirst.mockResolvedValue(null);
    h.prisma.socialAccount.findFirst.mockResolvedValue({ id: "acc_1", platform: "YOUTUBE" });
    echoCreate();
    expect((await postsRoute.POST(req("POST", "/api/posts", longa))).status).toBe(201);
  });

  it("opções que não são da rede da conta são recusadas", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue({ id: "acc_1", platform: "INSTAGRAM" });
    const res = await postsRoute.POST(req("POST", "/api/posts", body({ settings: { privacyStatus: "public" } })));
    expect(res.status).toBe(400);
    expect(h.prisma.scheduledPost.create).not.toHaveBeenCalled();
  });

  it("vídeo de fora do armazenamento é recusado em qualquer rede", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue({ id: "acc_1", platform: "INSTAGRAM" });
    const res = await postsRoute.POST(req("POST", "/api/posts", body({ mediaUrl: "http://169.254.169.254/x.mp4" })));
    expect(res.status).toBe(400);
    expect(h.prisma.scheduledPost.create).not.toHaveBeenCalled();
  });
});

describe("contas e desconexão", () => {
  it("GET /api/social-accounts junta as quatro redes, sem token", async () => {
    h.prisma.socialAccount.findMany.mockResolvedValue([
      { id: "t1", platform: "TIKTOK", displayName: "Tik", username: "tik", avatarUrl: null, status: "ACTIVE", tokenExpiresAt: null, connectedAt: NOW, lastError: null, scopes: ["user.info.basic"], accessToken: "SEGREDO" },
      { id: "y1", platform: "YOUTUBE", displayName: "Canal", username: "@canal", avatarUrl: null, status: "ACTIVE", tokenExpiresAt: NOW, connectedAt: NOW, lastError: null, scopes: ["https://www.googleapis.com/auth/youtube.upload"], accessToken: "SEGREDO" },
    ]);
    h.prisma.instagramAccount.findMany.mockResolvedValue([
      { id: "i1", platform: "INSTAGRAM", name: "Nome", username: "ig", profilePictureUrl: null, status: "ACTIVE", tokenExpiresAt: null, connectedAt: NOW, lastError: null, accessToken: "SEGREDO" },
      { id: "f1", platform: "FACEBOOK", name: "Página", username: "pg", profilePictureUrl: null, status: "NEEDS_RECONNECT", tokenExpiresAt: null, connectedAt: NOW, lastError: null, accessToken: "SEGREDO" },
    ]);
    const res = await accountsRoute.GET();
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("SEGREDO");
    const list = await listPostableAccounts("ws_A");
    expect(list.map((a) => [a.platform, a.source, a.canDisconnect])).toEqual([
      ["TIKTOK", "social", true],
      ["YOUTUBE", "social", true],
      ["INSTAGRAM", "channel", false],
      ["FACEBOOK", "channel", false],
    ]);
    // O YouTube só concedeu o upload: o resto aparece como faltando.
    expect(list[1].missingScopes).toEqual(YOUTUBE_SCOPES.filter((s) => !s.endsWith("youtube.upload")));
    expect(list[0].missingScopes).toEqual([]);
  });

  it("desconectar canal do Instagram/Facebook por aqui dá 400 e não mexe em nada", async () => {
    h.prisma.socialAccount.findFirst.mockResolvedValue(null);
    h.prisma.instagramAccount.findFirst.mockResolvedValue({ id: "i1" });
    const res = await accountRoute.DELETE(req("DELETE", "/api/social-accounts/i1"), params("i1"));
    expect(res.status).toBe(400);
    expect((await res.json()).details).toEqual({ code: "use_channels" });
    expect(h.prisma.socialAccount.update).not.toHaveBeenCalled();
    expect(h.prisma.instagramAccount.update).not.toHaveBeenCalled();
  });

  it("desconectar o YouTube apaga os tokens e devolve o agendado para rascunho", async () => {
    h.prisma.socialAccount.findFirst.mockResolvedValue({ id: "y1", platform: "YOUTUBE" });
    const res = await accountRoute.DELETE(req("DELETE", "/api/social-accounts/y1"), params("y1"));
    expect(res.status).toBe(200);
    expect(h.prisma.scheduledPost.updateMany.mock.calls[0][0].data.lastError).toBe("The YouTube channel was disconnected");
    expect(h.prisma.socialAccount.update.mock.calls[0][0].data).toMatchObject({ status: "DISCONNECTED", accessToken: "", refreshToken: null });
  });
});

describe("cron para todas as redes", () => {
  it("escolhe o provider pela plataforma do post, ou pela conta se faltar", () => {
    expect(providerFor("INSTAGRAM").platform).toBe("INSTAGRAM");
    expect(providerForPost({ platform: "YOUTUBE", socialAccount: null, channel: null }).platform).toBe("YOUTUBE");
    expect(providerForPost({ socialAccount: { platform: "TIKTOK" } as never, channel: null }).platform).toBe("TIKTOK");
    expect(() => providerFor("MYSPACE")).toThrow();
  });

  it("confere o Reel esperando e fecha o post como publicado", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ status_code: "FINISHED" })))
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: "media_1" })))
    );
    h.prisma.scheduledPost.findMany
      .mockResolvedValueOnce([]) // vencidos
      .mockResolvedValueOnce([]) // travados
      .mockResolvedValueOnce([{ id: "p_1" }]); // esperando a rede
    h.prisma.scheduledPost.findUnique.mockResolvedValue({
      id: "p_1",
      status: "PUBLISHING",
      platform: "INSTAGRAM",
      publishId: "container_1",
      lockedAt: new Date(),
      channel: { id: "c_1", instagramId: "17841", accessToken: "IGAAtok", status: "ACTIVE" },
      socialAccount: null,
    });
    const out = await sweepSocialPosts(NOW);
    expect(out).toEqual({ started: 0, checked: 1, recovered: 0 });
    expect(h.prisma.scheduledPost.update.mock.calls[0][0].data).toMatchObject({ status: "PUBLISHED", publishId: "media_1" });
    vi.unstubAllGlobals();
  });

  it("Reel que a Meta não confirma em 2 horas falha com o nome da rede", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status_code: "IN_PROGRESS" }))));
    h.prisma.scheduledPost.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "p_1" }]);
    h.prisma.scheduledPost.findUnique.mockResolvedValue({
      id: "p_1",
      status: "PUBLISHING",
      platform: "INSTAGRAM",
      publishId: "container_1",
      lockedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      channel: { id: "c_1", instagramId: "17841", accessToken: "IGAAtok", status: "ACTIVE" },
      socialAccount: null,
    });
    await sweepSocialPosts(NOW);
    expect(h.prisma.scheduledPost.update.mock.calls[0][0].data).toMatchObject({ status: "FAILED", lastError: "Instagram did not confirm the publication in 2 hours" });
    vi.unstubAllGlobals();
  });
});

describe("chave de API e MCP seguem só lendo e criando rascunho", () => {
  beforeEach(() => h.mockCaller.mockResolvedValue({ kind: "token" }));

  it.each([
    ["schedule", () => scheduleRoute.POST(req("POST", "/api/posts/p_1/schedule", { scheduledAt: "2035-01-01T10:00:00.000Z" }), params())],
    ["publish", () => publishRoute.POST(req("POST", "/api/posts/p_1/publish"), params())],
    ["desconectar conta", () => accountRoute.DELETE(req("DELETE", "/api/social-accounts/y1"), params("y1"))],
  ])("%s dá 403 human_only", async (_name, run) => {
    const res = await run();
    expect(res.status).toBe(403);
    expect(h.prisma.scheduledPost.update).not.toHaveBeenCalled();
    expect(h.prisma.socialAccount.update).not.toHaveBeenCalled();
  });

  it("a chave de API não alcança o teste de conexão nem o conector do YouTube", () => {
    for (const path of ["/api/social-accounts/y1/test", "/api/youtube/connect", "/api/youtube/callback"]) {
      expect(isApiKeyRouteAllowed("POST", path), path).toBe(false);
      expect(isApiKeyRouteAllowed("GET", path), path).toBe(false);
    }
    expect(isApiKeyRouteAllowed("GET", "/api/social-accounts")).toBe(true);
    expect(isApiKeyRouteAllowed("POST", "/api/posts")).toBe(true);
    expect(resolveHandler("/api/posts/p_1/publish", "POST")).toBeNull();
  });

  it("criar rascunho pela chave no Instagram nasce marcado MCP e sem horário", async () => {
    h.prisma.instagramAccount.findFirst.mockResolvedValue({ id: "acc_1", platform: "INSTAGRAM" });
    echoCreate();
    await postsRoute.POST(req("POST", "/api/posts", body({ scheduledAt: "2035-01-01T10:00:00.000Z" })));
    expect(h.prisma.scheduledPost.create.mock.calls[0][0].data).toMatchObject({ createdVia: "MCP", status: "DRAFT", scheduledAt: null });
  });
});
