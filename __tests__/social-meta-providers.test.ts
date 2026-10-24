/**
 * Instagram Reels e Página do Facebook na aba Posts: opções, regras de "pronto",
 * criação do container, conferência assíncrona (cron), falha de permissão e SSRF.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

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
  return { prisma: prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>, models };
});

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => t, encryptToken: (t: string) => t }));
vi.mock("@/lib/media/s3", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/media/s3")>();
  return { ...real, readMediaStorageConfig: () => ({ publicBaseUrl: "https://midia.example.com/bucket" }) };
});

import { instagramProvider, instagramSettingsSchema } from "../lib/social/providers/instagram";
import { facebookProvider, facebookSettingsSchema, FACEBOOK_TITLE_MAX } from "../lib/social/providers/facebook";
import { explainMetaError, graphCall } from "../lib/social/meta-graph";
import { PermissionError, RateLimitError, TokenExpiredError } from "../lib/meta/client";

const MB = 1024 * 1024;
const GOOD_URL = "https://midia.example.com/bucket/ws_A/posts/video.mp4";
const IG_TOKEN = "IGAAtoken";
const PAGE_TOKEN = "EAAtoken";

const channel = (token: string, over: Record<string, unknown> = {}) => ({ id: "c_1", instagramId: "17841", accessToken: token, status: "ACTIVE", ...over });
const post = (platform: "INSTAGRAM" | "FACEBOOK", over: Record<string, unknown> = {}) =>
  ({
    id: "p_1",
    workspaceId: "ws_A",
    platform,
    caption: "legenda",
    mediaUrl: GOOD_URL,
    mediaBytes: 5 * MB,
    mediaContentType: "video/mp4",
    settings: platform === "INSTAGRAM" ? { shareToFeed: true } : { title: "Título" },
    publishId: null,
    channel: channel(platform === "INSTAGRAM" ? IG_TOKEN : PAGE_TOKEN),
    ...over,
  }) as never;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const metaError = (code: number, message = "erro") => json({ error: { message, code, fbtrace_id: "tr" } }, 400);
const form = (call: unknown[]) => new URLSearchParams(String((call[1] as RequestInit).body));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  h.models.clear();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("Instagram Reels", () => {
  it("passa com conta ativa, vídeo nosso e opções completas", async () => {
    expect(await instagramProvider.readyProblem(post("INSTAGRAM"), { checkRemote: false })).toBeNull();
  });

  it("recusa conta a reconectar, vídeo de fora (SSRF), webm e arquivo grande demais", async () => {
    expect((await instagramProvider.readyProblem(post("INSTAGRAM", { channel: channel(IG_TOKEN, { status: "NEEDS_RECONNECT" }) }), { checkRemote: false }))?.code).toBe("needs_reconnect");
    expect((await instagramProvider.readyProblem(post("INSTAGRAM", { mediaUrl: "http://10.0.0.1/v.mp4" }), { checkRemote: false }))?.code).toBe("invalid_media");
    expect((await instagramProvider.readyProblem(post("INSTAGRAM", { mediaContentType: "video/webm" }), { checkRemote: false }))?.code).toBe("invalid_media");
    expect((await instagramProvider.readyProblem(post("INSTAGRAM", { mediaBytes: 301 * MB }), { checkRemote: false }))?.code).toBe("invalid_media");
    expect((await instagramProvider.readyProblem(post("INSTAGRAM", { caption: "x".repeat(2201) }), { checkRemote: false }))?.code).toBe("invalid_caption");
  });

  it("as opções são estritas", () => {
    expect(instagramSettingsSchema.safeParse({ shareToFeed: false }).success).toBe(true);
    expect(instagramSettingsSchema.safeParse({}).success).toBe(false);
    expect(instagramSettingsSchema.safeParse({ shareToFeed: true, x: 1 }).success).toBe(false);
  });

  it("publish cria o container de REELS na API do Instagram e fica esperando", async () => {
    fetchMock.mockResolvedValue(json({ id: "container_1" }));
    const savePublishId = vi.fn(async () => {});
    const result = await instagramProvider.publish(post("INSTAGRAM"), { savePublishId });
    expect(result).toEqual({ state: "waiting", publishId: "container_1" });
    expect(savePublishId).toHaveBeenCalledWith("container_1");
    const call = fetchMock.mock.calls[0];
    expect(String(call[0])).toMatch(/^https:\/\/graph\.instagram\.com\/v[\d.]+\/17841\/media$/);
    const f = form(call);
    expect(f.get("media_type")).toBe("REELS");
    expect(f.get("video_url")).toBe(GOOD_URL);
    expect(f.get("caption")).toBe("legenda");
    expect(f.get("share_to_feed")).toBe("true");
  });

  it("sem a permissão de publicar a mensagem manda reconectar e não marca a conta como caída", async () => {
    fetchMock.mockResolvedValue(metaError(10, "Application does not have permission"));
    await expect(instagramProvider.publish(post("INSTAGRAM"), { savePublishId: async () => {} })).rejects.toThrow(/Connect the account again in Channels and accept the publishing permission/);
    expect(h.prisma.instagramAccount.update).not.toHaveBeenCalled();
  });

  it("token vencido marca a conta para reconectar", async () => {
    fetchMock.mockResolvedValue(metaError(190, "expired"));
    await expect(instagramProvider.publish(post("INSTAGRAM"), { savePublishId: async () => {} })).rejects.toThrow(/refused the access/);
    expect(h.prisma.instagramAccount.update).toHaveBeenCalledWith({ where: { id: "c_1" }, data: { status: "NEEDS_RECONNECT" } });
  });

  it("check: IN_PROGRESS segue esperando", async () => {
    fetchMock.mockResolvedValue(json({ status_code: "IN_PROGRESS" }));
    expect(await instagramProvider.check!(post("INSTAGRAM", { publishId: "container_1" }))).toEqual({ state: "waiting" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("check: FINISHED publica o container e devolve o id da mídia", async () => {
    fetchMock.mockResolvedValueOnce(json({ status_code: "FINISHED" })).mockResolvedValueOnce(json({ id: "media_77" }));
    const result = await instagramProvider.check!(post("INSTAGRAM", { publishId: "container_1" }));
    expect(result).toEqual({ state: "published", publishId: "media_77" });
    const publishCall = fetchMock.mock.calls[1];
    expect(String(publishCall[0])).toContain("/17841/media_publish");
    expect(form(publishCall).get("creation_id")).toBe("container_1");
  });

  it("check: ERROR e EXPIRED falham com a mensagem da Meta", async () => {
    fetchMock.mockResolvedValue(json({ status_code: "ERROR", status: "Error: 2207026" }));
    const r = await instagramProvider.check!(post("INSTAGRAM", { publishId: "c" }));
    expect(r).toMatchObject({ state: "failed" });
    expect((r as { message: string }).message).toContain("2207026");
    fetchMock.mockResolvedValue(json({ status_code: "EXPIRED" }));
    expect((await instagramProvider.check!(post("INSTAGRAM", { publishId: "c" }))).state).toBe("failed");
  });

  it("check: falta de permissão falha o post; erro passageiro volta para o cron tentar de novo", async () => {
    fetchMock.mockResolvedValue(metaError(200, "permission"));
    expect((await instagramProvider.check!(post("INSTAGRAM", { publishId: "c" }))).state).toBe("failed");
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(instagramProvider.check!(post("INSTAGRAM", { publishId: "c" }))).rejects.toThrow("network down");
  });
});

describe("hashtags no Instagram (24/10)", () => {
  it("até 30 hashtags passa; 31 é barrado antes de chamar a Meta", async () => {
    const tags = (n: number) => Array.from({ length: n }, (_, i) => `#tag${i}`).join(" ");
    expect(await instagramProvider.readyProblem(post("INSTAGRAM", { caption: `legenda\n\n${tags(30)}` }), { checkRemote: false })).toBeNull();
    expect(await instagramProvider.readyProblem(post("INSTAGRAM", { caption: `legenda\n\n${tags(31)}` }), { checkRemote: false })).toMatchObject({ code: "invalid_settings" });
  });

  it("a legenda com as hashtags no fim é a que vai para a Meta", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "cont_1" }));
    await instagramProvider.publish(post("INSTAGRAM", { caption: "Comandos do Gemini\n\n#gemini #ia" }), { savePublishId: vi.fn(async () => {}) });
    expect(form(fetchMock.mock.calls[0]).get("caption")).toBe("Comandos do Gemini\n\n#gemini #ia");
  });
});

describe("Página do Facebook", () => {
  it("passa com Página ativa e opções completas; título até 255", async () => {
    expect(await facebookProvider.readyProblem(post("FACEBOOK"), { checkRemote: false })).toBeNull();
    expect(facebookSettingsSchema.safeParse({ title: "x".repeat(FACEBOOK_TITLE_MAX) }).success).toBe(true);
    expect(facebookSettingsSchema.safeParse({ title: "x".repeat(FACEBOOK_TITLE_MAX + 1) }).success).toBe(false);
  });

  it("recusa Página caída e vídeo de fora", async () => {
    expect((await facebookProvider.readyProblem(post("FACEBOOK", { channel: null }), { checkRemote: false }))?.code).toBe("needs_reconnect");
    expect((await facebookProvider.readyProblem(post("FACEBOOK", { mediaUrl: "https://evil.example.com/v.mp4" }), { checkRemote: false }))?.code).toBe("invalid_media");
  });

  it("publish manda file_url para /{page-id}/videos na API do Facebook (token de Página)", async () => {
    fetchMock.mockResolvedValue(json({ id: "video_5" }));
    const result = await facebookProvider.publish(post("FACEBOOK"), { savePublishId: async () => {} });
    expect(result).toEqual({ state: "waiting", publishId: "video_5" });
    const call = fetchMock.mock.calls[0];
    expect(String(call[0])).toMatch(/^https:\/\/graph\.facebook\.com\/v[\d.]+\/17841\/videos$/);
    const f = form(call);
    expect(f.get("file_url")).toBe(GOOD_URL);
    expect(f.get("description")).toBe("legenda");
    expect(f.get("title")).toBe("Título");
    expect(f.get("published")).toBe("true");
  });

  it("título vazio não é enviado", async () => {
    fetchMock.mockResolvedValue(json({ id: "video_5" }));
    await facebookProvider.publish(post("FACEBOOK", { settings: { title: "  " } }), { savePublishId: async () => {} });
    expect(form(fetchMock.mock.calls[0]).has("title")).toBe(false);
  });

  it("sem permissão a mensagem manda aceitar a permissão de publicar", async () => {
    fetchMock.mockResolvedValue(metaError(200, "(#200) requires pages_manage_posts"));
    await expect(facebookProvider.publish(post("FACEBOOK"), { savePublishId: async () => {} })).rejects.toThrow(/accept the publishing permission/);
  });

  it("check: ready publica, error falha, o resto espera", async () => {
    fetchMock.mockResolvedValueOnce(json({ status: { video_status: "ready" } }));
    expect((await facebookProvider.check!(post("FACEBOOK", { publishId: "v" }))).state).toBe("published");
    fetchMock.mockResolvedValueOnce(json({ status: { video_status: "error" } }));
    expect((await facebookProvider.check!(post("FACEBOOK", { publishId: "v" }))).state).toBe("failed");
    fetchMock.mockResolvedValueOnce(json({ status: { video_status: "processing" } }));
    expect((await facebookProvider.check!(post("FACEBOOK", { publishId: "v" }))).state).toBe("waiting");
  });
});

describe("chamadas à Meta", () => {
  it("escolhe o host pelo tipo de token", async () => {
    fetchMock.mockResolvedValue(json({ ok: 1 }));
    await graphCall(IG_TOKEN, "GET", "/x");
    await graphCall(PAGE_TOKEN, "GET", "/x");
    expect(String(fetchMock.mock.calls[0][0])).toContain("graph.instagram.com");
    expect(String(fetchMock.mock.calls[1][0])).toContain("graph.facebook.com");
  });

  it("classifica os erros e traduz cada um", async () => {
    fetchMock.mockResolvedValueOnce(metaError(190));
    await expect(graphCall(IG_TOKEN, "GET", "/x")).rejects.toBeInstanceOf(TokenExpiredError);
    fetchMock.mockResolvedValueOnce(metaError(4));
    await expect(graphCall(IG_TOKEN, "GET", "/x")).rejects.toBeInstanceOf(RateLimitError);
    fetchMock.mockResolvedValueOnce(metaError(10));
    await expect(graphCall(IG_TOKEN, "GET", "/x")).rejects.toBeInstanceOf(PermissionError);
    expect(explainMetaError(new TokenExpiredError("x"), "Instagram").needsReconnect).toBe(true);
    expect(explainMetaError(new RateLimitError("x"), "Facebook").message).toMatch(/limit reached/);
    expect(explainMetaError(new Error("outro"), "Facebook")).toEqual({ message: "outro", needsReconnect: false });
  });
});
