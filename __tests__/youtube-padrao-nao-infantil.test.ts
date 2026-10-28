/**
 * 28/10/2026: padrão do canal do YouTube "meus vídeos NÃO são para crianças".
 * Declaração do dono ao YouTube: só a tela (sessão humana) liga. Desligado, nada muda;
 * ligado, rascunho novo (tela e MCP) e agendar/publicar rascunho antigo herdam false;
 * a resposta própria do vídeo sempre prevalece.
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
    claim: vi.fn(),
    run: vi.fn(),
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
  return { ...real, readMediaStorageConfig: () => ({ publicBaseUrl: "https://midia.example.com/bucket" }) };
});
vi.mock("@/lib/social/publish", () => ({ claimPost: h.claim, runClaimedPost: h.run }));
vi.mock("next/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("next/server")>();
  return { ...real, after: () => {} };
});

import { schedulePostAction, publishPostAction } from "../lib/social/post-actions";
import { TOOLS } from "../lib/mcp/server";
import { resolveHandler } from "../lib/mcp/routes";
import { isApiKeyRouteAllowed } from "../lib/api-key-routes";
import { YOUTUBE_SCOPES } from "../lib/youtube/oauth";
import { hasOwnKidsAnswer, stripKidsAnswer, withKidsDefault } from "../lib/social/youtube-kids-default";
import * as postsRoute from "../app/api/posts/route";
import * as postRoute from "../app/api/posts/[id]/route";
import * as defaultRoute from "../app/api/social-accounts/[id]/youtube-kids-default/route";

const OWNER = { userId: "u_owner", workspaceId: "ws_A", role: "OWNER" };
const MB = 1024 * 1024;
const GOOD_URL = "https://midia.example.com/bucket/ws_A/posts/video.mp4";
const NOW = new Date("2026-10-28T15:00:00.000Z");
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);

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
const ytAccount = (on: boolean) => ({ id: "acc_1", platform: "YOUTUBE", youtubeNotForKidsDefault: on });
const channel = (on: boolean) => ({
  id: "acc_1",
  status: "ACTIVE",
  scopes: [...YOUTUBE_SCOPES],
  accessToken: "tok",
  youtubeNotForKidsDefault: on,
});
const baseSettings = { title: "Meu short", privacyStatus: "unlisted", containsSyntheticMedia: false };
const draft = (on: boolean, settings: Record<string, unknown> = baseSettings) => ({
  id: "p_1",
  workspaceId: "ws_A",
  platform: "YOUTUBE",
  status: "DRAFT",
  caption: "descrição",
  mediaUrl: GOOD_URL,
  mediaBytes: 5 * MB,
  mediaContentType: "video/mp4",
  mediaSeconds: 30,
  settings,
  socialAccountId: "acc_1",
  channelId: null,
  socialAccount: channel(on),
  channel: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.models.clear();
  h.mockCaller.mockResolvedValue({ kind: "session" });
  h.mockContext.mockResolvedValue(OWNER);
  h.claim.mockResolvedValue(true);
});

describe("funções puras", () => {
  it("só aplica com o padrão ligado e sem resposta própria", () => {
    expect(withKidsDefault({ title: "a" }, false)).toEqual({ title: "a" });
    expect(withKidsDefault({ title: "a" }, true)).toEqual({ title: "a", selfDeclaredMadeForKids: false });
    expect(withKidsDefault({ selfDeclaredMadeForKids: true }, true)).toEqual({ selfDeclaredMadeForKids: true });
    expect(withKidsDefault(null, true)).toEqual({ selfDeclaredMadeForKids: false });
    expect(hasOwnKidsAnswer({ selfDeclaredMadeForKids: false })).toBe(true);
    expect(hasOwnKidsAnswer({})).toBe(false);
    expect(stripKidsAnswer({ a: 1, selfDeclaredMadeForKids: false })).toEqual({ a: 1 });
  });
});

describe("rascunho novo pela tela (POST /api/posts)", () => {
  it("padrão DESLIGADO: continua sem resposta sobre crianças", async () => {
    h.prisma.socialAccount.findFirst.mockResolvedValue(ytAccount(false));
    echoCreate();
    await postsRoute.POST(req("POST", "/api/posts", body({ settings: { title: "Oi" } })));
    const settings = h.prisma.scheduledPost.create.mock.calls[0][0].data.settings;
    expect(settings).toEqual({ title: "Oi" });
    expect(settings).not.toHaveProperty("selfDeclaredMadeForKids");
  });

  it("padrão LIGADO: nasce com selfDeclaredMadeForKids false (com e sem opções)", async () => {
    h.prisma.socialAccount.findFirst.mockResolvedValue(ytAccount(true));
    echoCreate();
    await postsRoute.POST(req("POST", "/api/posts", body({ settings: { title: "Oi" } })));
    expect(h.prisma.scheduledPost.create.mock.calls[0][0].data.settings).toMatchObject({ title: "Oi", selfDeclaredMadeForKids: false });
    await postsRoute.POST(req("POST", "/api/posts", body()));
    expect(h.prisma.scheduledPost.create.mock.calls[1][0].data.settings).toMatchObject({ privacyStatus: "private", selfDeclaredMadeForKids: false });
  });

  it("padrão LIGADO: a resposta própria da pessoa (é para crianças) prevalece", async () => {
    h.prisma.socialAccount.findFirst.mockResolvedValue(ytAccount(true));
    echoCreate();
    await postsRoute.POST(req("POST", "/api/posts", body({ settings: { title: "Oi", selfDeclaredMadeForKids: true } })));
    expect(h.prisma.scheduledPost.create.mock.calls[0][0].data.settings.selfDeclaredMadeForKids).toBe(true);
  });

  it("padrão ligado no YouTube não vaza para TikTok", async () => {
    h.prisma.socialAccount.findFirst.mockResolvedValue({ id: "acc_1", platform: "TIKTOK", youtubeNotForKidsDefault: true });
    echoCreate();
    await postsRoute.POST(req("POST", "/api/posts", body()));
    expect(h.prisma.scheduledPost.create.mock.calls[0][0].data.settings).not.toHaveProperty("selfDeclaredMadeForKids");
  });
});

describe("rascunho novo pelo MCP (chave de API)", () => {
  beforeEach(() => h.mockCaller.mockResolvedValue({ kind: "token", tokenId: "tok_1", scopes: [] }));

  it("padrão ligado: herda false sem o MCP mandar nada", async () => {
    h.prisma.socialAccount.findFirst.mockResolvedValue(ytAccount(true));
    echoCreate();
    await postsRoute.POST(req("POST", "/api/posts", body({ settings: { title: "Oi" } })));
    const data = h.prisma.scheduledPost.create.mock.calls[0][0].data;
    expect(data.createdVia).toBe("MCP");
    expect(data.settings).toMatchObject({ selfDeclaredMadeForKids: false });
  });

  it("padrão desligado: o MCP não consegue declarar nada (campo é ignorado)", async () => {
    h.prisma.socialAccount.findFirst.mockResolvedValue(ytAccount(false));
    echoCreate();
    await postsRoute.POST(req("POST", "/api/posts", body({ settings: { title: "Oi", selfDeclaredMadeForKids: false } })));
    expect(h.prisma.scheduledPost.create.mock.calls[0][0].data.settings).not.toHaveProperty("selfDeclaredMadeForKids");
  });

  it("padrão ligado: o MCP não consegue marcar 'é para crianças' (vale o padrão)", async () => {
    h.prisma.socialAccount.findFirst.mockResolvedValue(ytAccount(true));
    echoCreate();
    await postsRoute.POST(req("POST", "/api/posts", body({ settings: { title: "Oi", selfDeclaredMadeForKids: true } })));
    expect(h.prisma.scheduledPost.create.mock.calls[0][0].data.settings.selfDeclaredMadeForKids).toBe(false);
  });

  it("editar rascunho pelo MCP não troca a resposta que a pessoa deu na tela", async () => {
    h.prisma.scheduledPost.findFirst.mockResolvedValue(draft(true, { ...baseSettings, selfDeclaredMadeForKids: true }));
    h.prisma.scheduledPost.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...draft(true), ...data, createdAt: NOW, updatedAt: NOW }));
    h.mockCaller.mockResolvedValue({ kind: "token", tokenId: "tok_1", scopes: [] });
    await postRoute.PATCH(req("PATCH", "/api/posts/p_1", { settings: { title: "Novo", selfDeclaredMadeForKids: false } }), params());
    expect(h.prisma.scheduledPost.update.mock.calls[0][0].data.settings).toMatchObject({ title: "Novo", selfDeclaredMadeForKids: true });
  });

  it("a descrição do criar_rascunho_post explica o padrão e que o MCP não declara", () => {
    const tool = TOOLS.find((t) => t.name === "criar_rascunho_post")!;
    expect(tool.description).toContain("não é para crianças");
    expect(tool.description).toContain("O MCP não liga nem desliga esse padrão");
    expect(JSON.stringify(tool.inputSchema)).toContain("NÃO se manda");
  });
});

describe("agendar e publicar rascunho que já existe", () => {
  it("DESLIGADO: continua exigindo a resposta na tela", async () => {
    h.prisma.scheduledPost.findFirst.mockResolvedValue(draft(false));
    const r = await schedulePostAction("p_1", "ws_A", FUTURE);
    expect(r).toMatchObject({ ok: false, status: 400, code: "invalid_settings", message: "Say whether the video is made for kids" });
    const p = await publishPostAction("p_1", "ws_A");
    expect(p).toMatchObject({ ok: false, status: 400, message: "Say whether the video is made for kids" });
    expect(h.prisma.scheduledPost.update).not.toHaveBeenCalled();
  });

  it("LIGADO + sem resposta: agenda e grava false nas opções (o cron lê do banco)", async () => {
    h.prisma.scheduledPost.findFirst.mockResolvedValue(draft(true));
    h.prisma.scheduledPost.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...draft(true), ...data }));
    const r = await schedulePostAction("p_1", "ws_A", FUTURE);
    expect(r.ok).toBe(true);
    const data = h.prisma.scheduledPost.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "SCHEDULED", settings: { title: "Meu short", selfDeclaredMadeForKids: false } });
  });

  it("LIGADO + sem resposta: publicar grava false ANTES de pegar o post", async () => {
    h.prisma.scheduledPost.findFirst.mockResolvedValue(draft(true));
    h.claim.mockImplementation(async () => {
      expect(h.prisma.scheduledPost.update.mock.calls[0][0].data.settings.selfDeclaredMadeForKids).toBe(false);
      return true;
    });
    const r = await publishPostAction("p_1", "ws_A");
    expect(r.ok).toBe(true);
    expect(h.claim).toHaveBeenCalledTimes(1);
  });

  it("LIGADO + resposta própria 'é para crianças': prevalece e não é sobrescrita", async () => {
    h.prisma.scheduledPost.findFirst.mockResolvedValue(draft(true, { ...baseSettings, selfDeclaredMadeForKids: true }));
    h.prisma.scheduledPost.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...draft(true), ...data }));
    const r = await schedulePostAction("p_1", "ws_A", FUTURE);
    expect(r.ok).toBe(true);
    expect(h.prisma.scheduledPost.update.mock.calls[0][0].data).not.toHaveProperty("settings");
  });

  it("LIGADO: o padrão só tapa a resposta; título faltando ainda barra", async () => {
    h.prisma.scheduledPost.findFirst.mockResolvedValue(draft(true, { privacyStatus: "unlisted" }));
    const r = await schedulePostAction("p_1", "ws_A", FUTURE);
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(h.prisma.scheduledPost.update).not.toHaveBeenCalled();
  });
});

describe("ligar o padrão: só pela tela", () => {
  const put = (enabled: unknown = true) => defaultRoute.PUT(req("PUT", "/api/social-accounts/acc_1/youtube-kids-default", { enabled }), params("acc_1"));

  it("pessoa logada liga, grava quem e quando, e registra o evento sem dado sensível", async () => {
    h.prisma.socialAccount.findFirst.mockResolvedValue({ id: "acc_1" });
    const res = await put(true);
    expect(res.status).toBe(200);
    expect(h.prisma.socialAccount.findFirst.mock.calls[0][0].where).toMatchObject({ id: "acc_1", workspaceId: "ws_A", platform: "YOUTUBE" });
    expect(h.prisma.socialAccount.update.mock.calls[0][0].data).toMatchObject({
      youtubeNotForKidsDefault: true,
      youtubeNotForKidsDefaultBy: "u_owner",
    });
    expect(h.prisma.socialAccount.update.mock.calls[0][0].data.youtubeNotForKidsDefaultAt).toBeInstanceOf(Date);
    const ev = h.prisma.operationalEvent.create.mock.calls[0][0].data;
    expect(ev.payload).toMatchObject({ socialAccountId: "acc_1", userId: "u_owner", enabled: true });
    expect(JSON.stringify(ev)).not.toMatch(/token/i);
  });

  it("pessoa logada desliga", async () => {
    h.prisma.socialAccount.findFirst.mockResolvedValue({ id: "acc_1" });
    await put(false);
    expect(h.prisma.socialAccount.update.mock.calls[0][0].data.youtubeNotForKidsDefault).toBe(false);
  });

  it("chave de API recebe 403 human_only e nada é gravado", async () => {
    h.mockCaller.mockResolvedValue({ kind: "token", tokenId: "tok_1", scopes: [] });
    const res = await put(true);
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toContain("human_only");
    expect(h.prisma.socialAccount.update).not.toHaveBeenCalled();
    expect(h.prisma.operationalEvent.create).not.toHaveBeenCalled();
  });

  it("papel sem permissão de gerenciar não liga", async () => {
    h.mockContext.mockResolvedValue({ ...OWNER, role: "MEMBER" });
    const res = await put(true);
    expect([401, 403]).toContain(res.status);
    expect(h.prisma.socialAccount.update).not.toHaveBeenCalled();
  });

  it("corpo inválido e canal que não é YouTube/do workspace são recusados", async () => {
    expect((await put("sim")).status).toBe(400);
    h.prisma.socialAccount.findFirst.mockResolvedValue(null);
    expect((await put(true)).status).toBe(404);
    expect(h.prisma.socialAccount.update).not.toHaveBeenCalled();
  });

  it("o MCP não tem ferramenta nem rota para isso", () => {
    const path = "/api/social-accounts/acc_1/youtube-kids-default";
    for (const method of ["GET", "POST", "PUT", "PATCH"]) expect(isApiKeyRouteAllowed(method, path), method).toBe(false);
    expect(resolveHandler(path, "PUT")).toBeNull();
    expect(TOOLS.map((t) => t.name).filter((n) => /crian|kids|padrao/i.test(n))).toEqual([]);
  });
});
