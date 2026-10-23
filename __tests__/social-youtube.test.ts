/**
 * YouTube na aba Posts: opções, regras de "pronto", upload resumable, renovação
 * do token, helper youtubeFetch, escopos e credenciais. Tudo com fetch simulado.
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
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => `plain:${t}`, encryptToken: (t: string) => `enc:${t}` }));
vi.mock("@/lib/media/s3", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/media/s3")>();
  return { ...real, readMediaStorageConfig: () => ({ publicBaseUrl: "https://midia.example.com/bucket" }) };
});

import { youtubeProvider, youtubeSettingsSchema, youtubeDraftSettingsSchema } from "../lib/social/providers/youtube";
import { getYouTubeAccessToken, uploadYouTubeVideo, youtubeFetch } from "../lib/youtube/client";
import {
  getMissingYouTubeEnv,
  getYouTubeAuthorizationUrl,
  missingYouTubeScopes,
  youtubeCredentials,
  youtubeErrorFrom,
  youtubeScopes,
  YOUTUBE_SCOPES,
  YOUTUBE_UPLOAD_SCOPE,
  API_DISABLED_MESSAGE,
  YouTubeAuthError,
} from "../lib/youtube/oauth";

const NOW = new Date("2026-10-23T15:00:00.000Z");
const MB = 1024 * 1024;
const GOOD_URL = "https://midia.example.com/bucket/ws_A/posts/video.mp4";
const goodSettings = { title: "Meu vídeo", privacyStatus: "private", containsSyntheticMedia: false, selfDeclaredMadeForKids: false };

const account = (over: Record<string, unknown> = {}) => ({
  id: "a_1",
  status: "ACTIVE",
  scopes: [...YOUTUBE_SCOPES],
  accessToken: "tok",
  refreshToken: "ref",
  tokenExpiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
  ...over,
});
const post = (over: Record<string, unknown> = {}) =>
  ({
    id: "p_1",
    workspaceId: "ws_A",
    platform: "YOUTUBE",
    caption: "descrição",
    mediaUrl: GOOD_URL,
    mediaBytes: 5 * MB,
    mediaContentType: "video/mp4",
    settings: goodSettings,
    socialAccount: account(),
    ...over,
  }) as never;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  h.models.clear();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("GOOGLE_CLIENT_ID", "g_id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "g_secret");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("opções do YouTube", () => {
  it("'feito para crianças' não tem valor padrão: rascunho aceita sem, publicar não", () => {
    const semKids: Record<string, unknown> = { ...goodSettings };
    delete semKids.selfDeclaredMadeForKids;
    expect(youtubeSettingsSchema.safeParse(semKids).success).toBe(false);
    expect(youtubeDraftSettingsSchema.safeParse(semKids).success).toBe(true);
    expect(youtubeSettingsSchema.safeParse(goodSettings).success).toBe(true);
  });

  it("título até 100 caracteres, visibilidade conhecida e nenhum campo extra", () => {
    expect(youtubeSettingsSchema.safeParse({ ...goodSettings, title: "x".repeat(101) }).success).toBe(false);
    expect(youtubeSettingsSchema.safeParse({ ...goodSettings, title: "x".repeat(100) }).success).toBe(true);
    expect(youtubeSettingsSchema.safeParse({ ...goodSettings, privacyStatus: "secret" }).success).toBe(false);
    expect(youtubeSettingsSchema.safeParse({ ...goodSettings, extra: 1 }).success).toBe(false);
  });

  it("o rascunho nasce privado", () => {
    expect(youtubeProvider.defaultSettings).toMatchObject({ privacyStatus: "private" });
  });
});

describe("readyProblem do YouTube", () => {
  it("passa com canal ativo, permissão de upload, vídeo nosso e opções completas", async () => {
    expect(await youtubeProvider.readyProblem(post(), { checkRemote: false })).toBeNull();
  });

  it("pede reconectar quando o canal não está ativo", async () => {
    const p = await youtubeProvider.readyProblem(post({ socialAccount: account({ status: "NEEDS_RECONNECT" }) }), { checkRemote: false });
    expect(p?.code).toBe("needs_reconnect");
  });

  it("avisa quando a pessoa não deu a permissão de upload", async () => {
    const p = await youtubeProvider.readyProblem(
      post({ socialAccount: account({ scopes: ["https://www.googleapis.com/auth/youtube.readonly"] }) }),
      { checkRemote: false }
    );
    expect(p?.code).toBe("missing_scope");
  });

  it("recusa vídeo de fora do armazenamento (SSRF) e formato fora da lista", async () => {
    const ssrf = await youtubeProvider.readyProblem(post({ mediaUrl: "http://169.254.169.254/latest/meta-data" }), { checkRemote: false });
    expect(ssrf?.code).toBe("invalid_media");
    const outroWorkspace = await youtubeProvider.readyProblem(
      post({ mediaUrl: "https://midia.example.com/bucket/ws_B/posts/video.mp4" }),
      { checkRemote: false }
    );
    expect(outroWorkspace?.code).toBe("invalid_media");
    const formato = await youtubeProvider.readyProblem(post({ mediaContentType: "video/x-msvideo" }), { checkRemote: false });
    expect(formato?.code).toBe("invalid_media");
  });

  it("exige responder 'feito para crianças' com mensagem própria", async () => {
    const p = await youtubeProvider.readyProblem(post({ settings: { ...goodSettings, selfDeclaredMadeForKids: undefined } }), { checkRemote: false });
    expect(p).toEqual({ message: "Say whether the video is made for kids", code: "invalid_settings" });
  });

  it("descrição acima de 5000 caracteres não passa", async () => {
    const p = await youtubeProvider.readyProblem(post({ caption: "x".repeat(5001) }), { checkRemote: false });
    expect(p?.code).toBe("invalid_caption");
  });
});

describe("upload resumable", () => {
  const sessionUrl = "https://upload.example.com/session/1";

  it("abre a sessão, manda em partes pelo Range e devolve o id; avisa o id antes de qualquer coisa", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.startsWith("https://www.googleapis.com/upload/youtube/v3/videos")) {
        return json({}, 200, { location: sessionUrl });
      }
      if (url === GOOD_URL) {
        const [, s, e] = /bytes=(\d+)-(\d+)/.exec((init?.headers as Record<string, string>).Range)!;
        return new Response(new Uint8Array(Number(e) - Number(s) + 1), { status: 206 });
      }
      if (url === sessionUrl) {
        const range = (init?.headers as Record<string, string>)["Content-Range"];
        return range.endsWith("-9/10") ? json({ id: "vid_123" }, 200) : new Response(null, { status: 308 });
      }
      throw new Error(`fetch inesperado: ${url}`);
    });
    const onUploaded = vi.fn(async () => {});
    const id = await uploadYouTubeVideo({
      accessToken: "access",
      mediaUrl: GOOD_URL,
      mediaBytes: 10,
      mediaContentType: "video/mp4",
      metadata: { snippet: { title: "t" }, status: { privacyStatus: "private" } },
      onUploaded,
      chunkBytes: 4,
    });
    expect(id).toBe("vid_123");
    expect(onUploaded).toHaveBeenCalledWith("vid_123");
    const init = calls[0];
    expect((init.init?.headers as Record<string, string>).Authorization).toBe("Bearer access");
    const puts = calls.filter((c) => c.url === sessionUrl).map((c) => (c.init?.headers as Record<string, string>)["Content-Range"]);
    expect(puts).toEqual(["bytes 0-3/10", "bytes 4-7/10", "bytes 8-9/10"]);
  });

  it("explica quando a YouTube Data API não está ligada no projeto", async () => {
    fetchMock.mockResolvedValue(
      json({ error: { code: 403, message: "has not been used", errors: [{ reason: "accessNotConfigured" }] } }, 403)
    );
    await expect(
      uploadYouTubeVideo({ accessToken: "a", mediaUrl: GOOD_URL, mediaBytes: 10, mediaContentType: "video/mp4", metadata: { snippet: {}, status: {} } })
    ).rejects.toMatchObject({ message: API_DISABLED_MESSAGE, status: 403 });
  });

  it("não aceita vídeo vazio", async () => {
    await expect(
      uploadYouTubeVideo({ accessToken: "a", mediaUrl: GOOD_URL, mediaBytes: 0, mediaContentType: "video/mp4", metadata: { snippet: {}, status: {} } })
    ).rejects.toThrow("empty");
  });
});

describe("publish do YouTube", () => {
  const happy = () =>
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://www.googleapis.com/upload/youtube/v3/videos")) return json({}, 200, { location: "https://u.example.com/s" });
      if (url === GOOD_URL) return new Response(new Uint8Array(5 * MB), { status: 206 });
      if (url === "https://u.example.com/s") return json({ id: "vid_9" });
      throw new Error(`fetch inesperado: ${url} ${init?.method}`);
    });

  it("publica com os metadados certos e dá o post como PUBLISHED com o id do vídeo", async () => {
    happy();
    const savePublishId = vi.fn(async () => {});
    const result = await youtubeProvider.publish(post({ settings: { ...goodSettings, privacyStatus: "unlisted", tags: ["ia"] } }), { savePublishId });
    expect(result).toEqual({ state: "published", publishId: "vid_9" });
    expect(savePublishId).toHaveBeenCalledWith("vid_9");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.snippet).toMatchObject({ title: "Meu vídeo", description: "descrição", tags: ["ia"], categoryId: "22" });
    expect(body.status).toEqual({ privacyStatus: "unlisted", selfDeclaredMadeForKids: false, containsSyntheticMedia: false });
  });

  it("renova o token vencido antes de enviar e guarda o novo", async () => {
    happy();
    const original = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "https://oauth2.googleapis.com/token") return json({ access_token: "novo", expires_in: 3600, scope: "a b" });
      return original(url, init);
    });
    await youtubeProvider.publish(post({ socialAccount: account({ tokenExpiresAt: new Date(NOW.getTime() - 1000) }) }), { savePublishId: async () => {} });
    const upload = fetchMock.mock.calls.find((c) => String(c[0]).includes("/upload/youtube"))!;
    expect(upload[1].headers.Authorization).toBe("Bearer novo");
    expect(h.prisma.socialAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "a_1" }, data: expect.objectContaining({ accessToken: "enc:novo", status: "ACTIVE" }) })
    );
  });

  it("refresh token recusado marca o canal para reconectar e o post falha com mensagem clara", async () => {
    fetchMock.mockResolvedValue(json({ error: "invalid_grant", error_description: "Token has been revoked" }, 400));
    await expect(
      youtubeProvider.publish(post({ socialAccount: account({ tokenExpiresAt: new Date(NOW.getTime() - 1000) }) }), { savePublishId: async () => {} })
    ).rejects.toThrow("YouTube session expired. Connect the channel again.");
    expect(h.prisma.socialAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "NEEDS_RECONNECT" }) })
    );
  });

  it("permissão negada pelo Google marca o canal para reconectar", async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 403, message: "nope", errors: [{ reason: "insufficientPermissions" }] } }, 403));
    await expect(youtubeProvider.publish(post(), { savePublishId: async () => {} })).rejects.toThrow(/Connect the channel again/);
    expect(h.prisma.socialAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "NEEDS_RECONNECT" }) })
    );
  });

  it("canal desconectado ou opções incompletas não chegam a chamar o Google", async () => {
    await expect(youtubeProvider.publish(post({ socialAccount: null }), { savePublishId: async () => {} })).rejects.toThrow(/not connected/);
    await expect(youtubeProvider.publish(post({ settings: { title: "x" } }), { savePublishId: async () => {} })).rejects.toThrow(/incomplete/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("youtubeFetch", () => {
  it("chama a API com o token do canal e devolve o JSON", async () => {
    fetchMock.mockResolvedValue(json({ items: [{ id: "UC1" }] }));
    const out = await youtubeFetch<{ items: Array<{ id: string }> }>(account(), "/channels?part=snippet&mine=true");
    expect(out.items[0].id).toBe("UC1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true");
    expect(init.headers.Authorization).toBe("Bearer plain:tok");
    expect(init.method).toBe("GET");
  });

  it("manda corpo JSON em POST", async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));
    await youtubeFetch(account(), "/comments", { method: "POST", body: { a: 1 } });
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe('{"a":1}');
  });

  it("se o Google responde 401, renova o token à força e repete uma vez", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ error: { code: 401, message: "expired" } }, 401))
      .mockResolvedValueOnce(json({ access_token: "fresco", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ items: [] }));
    await youtubeFetch(account(), "/channels?part=id&mine=true");
    expect(fetchMock.mock.calls[1][0]).toBe("https://oauth2.googleapis.com/token");
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe("Bearer fresco");
  });

  it("erro do Google vira YouTubeApiError com o motivo", async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 403, message: "quota", errors: [{ reason: "quotaExceeded" }] } }, 403));
    await expect(youtubeFetch(account(), "/videos")).rejects.toMatchObject({ status: 403, reason: "quotaExceeded" });
  });

  it("sem refresh token e com o access vencido pede reconectar", async () => {
    await expect(getYouTubeAccessToken(account({ refreshToken: null, tokenExpiresAt: new Date(0) }))).rejects.toBeInstanceOf(YouTubeAuthError);
  });
});

describe("login do YouTube", () => {
  it("usa as credenciais do login do Google quando as do YouTube não existem", () => {
    expect(youtubeCredentials({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" })).toEqual({ clientId: "a", clientSecret: "b" });
    expect(youtubeCredentials({ YOUTUBE_CLIENT_ID: "y", YOUTUBE_CLIENT_SECRET: "z", GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" })).toEqual({
      clientId: "y",
      clientSecret: "z",
    });
    expect(youtubeCredentials({})).toBeNull();
    expect(getMissingYouTubeEnv({})).toHaveLength(2);
    expect(getMissingYouTubeEnv({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" })).toEqual([]);
  });

  it("pede todas as permissões de uma vez, offline e com consentimento", () => {
    const url = new URL(getYouTubeAuthorizationUrl("https://many.leadenginer.com/api/youtube/callback", "st_1"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")!.split(" ")).toEqual([...YOUTUBE_SCOPES]);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("client_id")).toBe("g_id");
    expect(url.searchParams.get("state")).toBe("st_1");
    expect(YOUTUBE_SCOPES).toContain(YOUTUBE_UPLOAD_SCOPE);
    expect(YOUTUBE_SCOPES).toContain("https://www.googleapis.com/auth/youtube.force-ssl");
  });

  it("YOUTUBE_OAUTH_SCOPES troca a lista (vírgula ou espaço)", () => {
    expect(youtubeScopes({ YOUTUBE_OAUTH_SCOPES: "a, b c" })).toEqual(["a", "b", "c"]);
    expect(youtubeScopes({})).toEqual([...YOUTUBE_SCOPES]);
  });

  it("mostra quais permissões a pessoa não concedeu", () => {
    expect(missingYouTubeScopes([...YOUTUBE_SCOPES])).toEqual([]);
    expect(missingYouTubeScopes([YOUTUBE_UPLOAD_SCOPE])).toEqual(YOUTUBE_SCOPES.filter((s) => s !== YOUTUBE_UPLOAD_SCOPE));
  });

  it("traduz os erros mais comuns do Google", () => {
    expect(youtubeErrorFrom(403, { error: { errors: [{ reason: "quotaExceeded" }] } }).message).toMatch(/daily quota/);
    expect(youtubeErrorFrom(403, { error: { errors: [{ reason: "uploadLimitExceeded" }] } }).message).toMatch(/upload limit/);
    expect(youtubeErrorFrom(403, { error: { status: "SERVICE_DISABLED" } }).apiDisabled).toBe(true);
    expect(youtubeErrorFrom(500, {}).message).toBe("YouTube error (500)");
  });
});
