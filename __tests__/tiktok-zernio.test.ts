/**
 * TikTok via Zernio: fetch SEMPRE mockado (nenhuma chamada real, chave falsa).
 * Cobre publicação direta, dryRun, 400 de privacidade, 409, rede, status assíncrono,
 * idempotência, ausência de chave, vazamento da chave e a chave de liga/desliga.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db/client", () => ({ prisma: {} }));
import { providerFor } from "../lib/social/providers";
import { tiktokProvider } from "../lib/social/providers/tiktok";
import { tiktokZernioProvider } from "../lib/social/providers/tiktok-zernio";
import type { ProviderPost } from "../lib/social/types";
import { normalizeSettings, privacyLabel, validateComposer, emptySettings, type CreatorInfo } from "../lib/tiktok-composer";

const KEY = "zk_test_SECRET_1234567890abcdef";
const BASE = "https://midia.example.com/bucket";
const ENV_KEYS = ["TIKTOK_VIA_ZERNIO", "ZERNIO_API_KEY", "ZERNIO_TIKTOK_ACCOUNT_ID", "ZERNIO_OWNER_WORKSPACE_ID", "ZERNIO_TIKTOK_ACCOUNT_MAP", "ZERNIO_FORCE_PRESIGN", "MEDIA_S3_ENDPOINT", "MEDIA_S3_BUCKET", "MEDIA_S3_ACCESS_KEY", "MEDIA_S3_SECRET_KEY", "MEDIA_PUBLIC_BASE_URL"];
const saved: Record<string, string | undefined> = {};

const settings = (over: Record<string, unknown> = {}) => ({
  privacyLevel: "PUBLIC_TO_EVERYONE",
  allowComment: true,
  allowDuet: false,
  allowStitch: false,
  commercial: { enabled: false, yourBrand: false, brandedContent: false },
  isAigc: false,
  ...over,
});

const post = (over: Partial<ProviderPost> = {}): ProviderPost =>
  ({
    id: "p1",
    workspaceId: "w1",
    platform: "TIKTOK",
    caption: "Legenda #ia #chatgpt",
    mediaUrl: `${BASE}/w1/posts/v.mp4`,
    mediaBytes: 5_000_000,
    mediaContentType: "video/mp4",
    settings: settings(),
    publishId: null,
    socialAccount: { id: "sa1", username: "omatheus.ai", status: "ACTIVE", platform: "TIKTOK" },
    ...over,
  }) as unknown as ProviderPost;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchMock = vi.fn();
const ctx = () => ({ savePublishId: vi.fn(async () => {}) });
const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), method: (init?.method as string) ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined, headers: init?.headers as Record<string, string> }));

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.TIKTOK_VIA_ZERNIO = "1";
  process.env.ZERNIO_API_KEY = KEY;
  process.env.ZERNIO_TIKTOK_ACCOUNT_ID = "acc_zernio_1";
  process.env.ZERNIO_OWNER_WORKSPACE_ID = "w1";
  delete process.env.ZERNIO_TIKTOK_ACCOUNT_MAP;
  delete process.env.ZERNIO_FORCE_PRESIGN;
  process.env.MEDIA_S3_ENDPOINT = "https://s3.example.com";
  process.env.MEDIA_S3_BUCKET = "bucket";
  process.env.MEDIA_S3_ACCESS_KEY = "ak";
  process.env.MEDIA_S3_SECRET_KEY = "sk";
  process.env.MEDIA_PUBLIC_BASE_URL = BASE;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("flag TIKTOK_VIA_ZERNIO", () => {
  it("ligada usa o provider da Zernio; desligada, o de sempre", () => {
    expect(providerFor("TIKTOK")).toBe(tiktokZernioProvider);
    process.env.TIKTOK_VIA_ZERNIO = "0";
    expect(providerFor("TIKTOK")).toBe(tiktokProvider);
    delete process.env.TIKTOK_VIA_ZERNIO;
    expect(providerFor("TIKTOK")).toBe(tiktokProvider);
    expect(providerFor("YOUTUBE").platform).toBe("YOUTUBE");
  });
});

describe("publish", () => {
  it("publicação direta: POST /posts público, salva o publishId e fica aguardando", async () => {
    fetchMock.mockResolvedValueOnce(json(201, { post: { _id: "zp_1", status: "publishing" } }));
    const c = ctx();
    const r = await tiktokZernioProvider.publish(post(), c);
    expect(r).toEqual({ state: "waiting", publishId: "zp_1" });
    expect(c.savePublishId).toHaveBeenCalledWith("zp_1");
    const [call] = calls();
    expect(call.url).toBe("https://zernio.com/api/v1/posts");
    expect(call.method).toBe("POST");
    expect(call.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(call.body).toMatchObject({
      content: "Legenda #ia #chatgpt",
      platforms: [{ platform: "tiktok", accountId: "acc_zernio_1" }],
      mediaItems: [{ type: "video", url: `${BASE}/w1/posts/v.mp4` }],
      publishNow: true,
      tiktokSettings: { privacy_level: "PUBLIC_TO_EVERYONE", allow_comment: true, allow_duet: false },
    });
    expect(call.body.dryRun).toBeUndefined();
  });

  it("rascunho (SELF_ONLY) manda tiktokSettings.draft e não manda privacy_level", async () => {
    fetchMock.mockResolvedValueOnce(json(201, { _id: "zp_2" }));
    await tiktokZernioProvider.publish(post({ settings: settings({ privacyLevel: "SELF_ONLY" }) }), ctx());
    expect(calls()[0].body.tiktokSettings).toEqual({ draft: true });
  });

  it("usa o mapa de contas quando existe", async () => {
    process.env.ZERNIO_TIKTOK_ACCOUNT_MAP = JSON.stringify({ sa1: "acc_mapa" });
    fetchMock.mockResolvedValueOnce(json(201, { id: "zp_3" }));
    await tiktokZernioProvider.publish(post(), ctx());
    expect(calls()[0].body.platforms[0].accountId).toBe("acc_mapa");
  });

  it("400 de privacidade vira erro claro e não tenta o upload", async () => {
    fetchMock.mockResolvedValueOnce(json(400, { error: "invalid_field_value", message: "privacy_level SELF_ONLY is not allowed" }));
    await expect(tiktokZernioProvider.publish(post(), ctx())).rejects.toThrow(/privacy option/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("409 duplicado: erro claro com o post existente, sem reenviar", async () => {
    fetchMock.mockResolvedValueOnce(json(409, { error: "duplicate_content", existingPostId: "zp_old" }));
    const c = ctx();
    await expect(tiktokZernioProvider.publish(post(), c)).rejects.toThrow(/last 24 hours.*zp_old/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(c.savePublishId).not.toHaveBeenCalled();
  });

  it("erro de rede vira erro claro e não salva publishId", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const c = ctx();
    await expect(tiktokZernioProvider.publish(post(), c)).rejects.toThrow(/Could not reach Zernio/);
    expect(c.savePublishId).not.toHaveBeenCalled();
  });

  it("401 aponta para a chave sem mostrá-la", async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: `bad key ${KEY}` }));
    await expect(tiktokZernioProvider.publish(post(), ctx())).rejects.toThrow(/Check ZERNIO_API_KEY/);
  });

  it("se a Zernio recusar a URL do vídeo, envia por presign e tenta de novo", async () => {
    fetchMock
      .mockResolvedValueOnce(json(400, { error: "invalid_media", message: "could not download media url" }))
      .mockResolvedValueOnce(json(200, { uploadUrl: "https://up.example.com/put", publicUrl: "https://media.zernio.com/temp/v.mp4", key: "k" }))
      .mockResolvedValueOnce(new Response("bytes", { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(json(201, { post: { _id: "zp_4" } }));
    const r = await tiktokZernioProvider.publish(post(), ctx());
    expect(r.publishId).toBe("zp_4");
    const c = calls();
    expect(c[1].url).toContain("/media/presign");
    expect(c[1].body).toEqual({ filename: "v.mp4", contentType: "video/mp4" });
    expect(c[3]).toMatchObject({ url: "https://up.example.com/put", method: "PUT" });
    expect(c[4].body.mediaItems[0].url).toBe("https://media.zernio.com/temp/v.mp4");
  });

  it("idempotência: com publishId salvo e post vivo na Zernio, não cria outro", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { post: { status: "publishing", platforms: [{ status: "uploading" }] } }));
    const c = ctx();
    const r = await tiktokZernioProvider.publish(post({ publishId: "zp_1" }), c);
    expect(r).toEqual({ state: "waiting", publishId: "zp_1" });
    expect(calls().every((x) => x.method === "GET")).toBe(true);
    expect(c.savePublishId).not.toHaveBeenCalled();
  });

  it("idempotência: já publicado na Zernio fecha como publicado, sem POST", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { post: { platforms: [{ status: "published", platformPostId: "v_pub_url~1" }] } }));
    const r = await tiktokZernioProvider.publish(post({ publishId: "zp_1" }), ctx());
    expect(r).toEqual({ state: "published", publishId: "zp_1" });
    expect(calls().some((x) => x.method === "POST")).toBe(false);
  });

  it("idempotência: se não dá pra consultar o post antigo, não cria um novo", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(tiktokZernioProvider.publish(post({ publishId: "zp_1" }), ctx())).rejects.toThrow();
    expect(calls().some((x) => x.method === "POST")).toBe(false);
  });

  it("idempotência: post antigo que FALHOU na Zernio permite criar um novo", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { post: { platforms: [{ status: "failed", errorMessage: "x" }] } }))
      .mockResolvedValueOnce(json(201, { post: { _id: "zp_new" } }));
    const r = await tiktokZernioProvider.publish(post({ publishId: "zp_old" }), ctx());
    expect(r.publishId).toBe("zp_new");
  });

  it("sem chave: falha antes de qualquer chamada", async () => {
    delete process.env.ZERNIO_API_KEY;
    await expect(tiktokZernioProvider.publish(post(), ctx())).rejects.toThrow(/ZERNIO_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("check (rede assíncrona)", () => {
  it("uploading -> waiting; published público -> published", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { post: { status: "publishing", platforms: [{ status: "uploading" }] } }));
    expect(await tiktokZernioProvider.check!(post({ publishId: "zp_1" }))).toEqual({ state: "waiting" });
    fetchMock.mockResolvedValueOnce(json(200, { post: { status: "published", platforms: [{ status: "published", platformPostId: "v_pub_url~abc" }] } }));
    expect(await tiktokZernioProvider.check!(post({ publishId: "zp_1" }))).toEqual({ state: "published", publishId: "zp_1" });
    expect(calls()[0].url).toBe("https://zernio.com/api/v1/posts/zp_1");
  });

  it("failed traz a mensagem da Zernio", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { post: { platforms: [{ status: "failed", errorMessage: "TikTok rejected the video" }] } }));
    expect(await tiktokZernioProvider.check!(post({ publishId: "zp_1" }))).toEqual({ state: "failed", message: "TikTok rejected the video" });
  });

  it("caixa de entrada num post que devia ser público é falha; num rascunho é sucesso", async () => {
    const inbox = { post: { platforms: [{ status: "published", platformPostId: "v_inbox_url~x" }] } };
    fetchMock.mockResolvedValueOnce(json(200, inbox));
    const r1 = await tiktokZernioProvider.check!(post({ publishId: "zp_1" }));
    expect(r1.state).toBe("failed");
    fetchMock.mockResolvedValueOnce(json(200, inbox));
    const r2 = await tiktokZernioProvider.check!(post({ publishId: "zp_1", settings: settings({ privacyLevel: "SELF_ONLY" }) }));
    expect(r2.state).toBe("published");
  });

  it("erro de rede ao conferir lança (o cron tenta de novo no próximo ciclo)", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(tiktokZernioProvider.check!(post({ publishId: "zp_1" }))).rejects.toThrow(/Could not reach Zernio/);
  });
});

describe("readyProblem", () => {
  it("post válido passa; dryRun ok não bloqueia", async () => {
    expect(await tiktokZernioProvider.readyProblem(post(), { checkRemote: false })).toBeNull();
    fetchMock.mockResolvedValueOnce(json(200, { canPublish: true }));
    expect(await tiktokZernioProvider.readyProblem(post(), { checkRemote: true })).toBeNull();
    expect(calls()[0].body.dryRun).toBe(true);
  });

  it("dryRun com canPublish false bloqueia; 400 de privacidade e 409 viram mensagem", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { canPublish: false }));
    expect((await tiktokZernioProvider.readyProblem(post(), { checkRemote: true }))?.code).toBe("zernio_rejected");
    fetchMock.mockResolvedValueOnce(json(400, { error: "invalid_field_value", message: "privacy" }));
    expect((await tiktokZernioProvider.readyProblem(post(), { checkRemote: true }))?.code).toBe("zernio_rejected");
    fetchMock.mockResolvedValueOnce(json(409, { error: "duplicate" }));
    expect((await tiktokZernioProvider.readyProblem(post(), { checkRemote: true }))?.code).toBe("duplicate");
  });

  it("falha passageira do dryRun (rede, 500) não trava o agendamento", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await tiktokZernioProvider.readyProblem(post(), { checkRemote: true })).toBeNull();
    fetchMock.mockResolvedValueOnce(json(500, { error: "boom" }));
    expect(await tiktokZernioProvider.readyProblem(post(), { checkRemote: true })).toBeNull();
  });

  it("sem chave, sem conta mapeada, privacidade e vídeo inválidos", async () => {
    delete process.env.ZERNIO_API_KEY;
    expect((await tiktokZernioProvider.readyProblem(post(), { checkRemote: false }))?.code).toBe("zernio_not_configured");
    process.env.ZERNIO_API_KEY = KEY;
    delete process.env.ZERNIO_TIKTOK_ACCOUNT_ID;
    expect((await tiktokZernioProvider.readyProblem(post(), { checkRemote: false }))?.code).toBe("zernio_account_missing");
    process.env.ZERNIO_TIKTOK_ACCOUNT_ID = "acc";
    process.env.ZERNIO_OWNER_WORKSPACE_ID = "w1";
    expect((await tiktokZernioProvider.readyProblem(post({ settings: settings({ privacyLevel: "FOLLOWER_OF_CREATOR" }) }), { checkRemote: false }))?.code).toBe("privacy_not_allowed");
    expect((await tiktokZernioProvider.readyProblem(post({ settings: settings({ commercial: { enabled: true, yourBrand: true, brandedContent: false } }) }), { checkRemote: false }))?.code).toBe("invalid_settings");
    expect((await tiktokZernioProvider.readyProblem(post({ mediaContentType: "video/webm" }), { checkRemote: false }))?.code).toBe("invalid_media");
    expect((await tiktokZernioProvider.readyProblem(post({ mediaUrl: "https://evil.example.com/v.mp4" }), { checkRemote: false }))?.code).toBe("invalid_media");
    expect((await tiktokZernioProvider.readyProblem(post({ socialAccount: null }), { checkRemote: false }))?.code).toBe("needs_reconnect");
  });
});

describe("isolamento por workspace", () => {
  it("dono (w1) usa a conta única", async () => {
    fetchMock.mockResolvedValueOnce(json(201, { id: "zp_o" }));
    await tiktokZernioProvider.publish(post(), ctx());
    expect(calls()[0].body.platforms[0].accountId).toBe("acc_zernio_1");
  });
  it("outro workspace NÃO cai na conta do dono: erro 'conecte seu TikTok' e nenhuma chamada", async () => {
    const other = post({ workspaceId: "w2" });
    expect((await tiktokZernioProvider.readyProblem(other, { checkRemote: false }))?.code).toBe("zernio_account_missing");
    expect((await tiktokZernioProvider.readyProblem(other, { checkRemote: false }))?.message).toMatch(/Conecte seu TikTok/);
    await expect(tiktokZernioProvider.publish(other, ctx())).rejects.toThrow(/Conecte seu TikTok/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sem ZERNIO_OWNER_WORKSPACE_ID falha fechado até para w1", async () => {
    delete process.env.ZERNIO_OWNER_WORKSPACE_ID;
    expect((await tiktokZernioProvider.readyProblem(post(), { checkRemote: false }))?.code).toBe("zernio_account_missing");
  });
  it("outro workspace com mapeamento próprio publica na conta mapeada", async () => {
    process.env.ZERNIO_TIKTOK_ACCOUNT_MAP = JSON.stringify({ sa9: "acc_cliente" });
    fetchMock.mockResolvedValueOnce(json(201, { id: "zp_c" }));
    await tiktokZernioProvider.publish(post({ workspaceId: "w2", socialAccount: { id: "sa9", username: "cliente", status: "ACTIVE", platform: "TIKTOK" } as never }), ctx());
    expect(calls()[0].body.platforms[0].accountId).toBe("acc_cliente");
  });
  it("mapa inválido não vira fallback para outro workspace", async () => {
    process.env.ZERNIO_TIKTOK_ACCOUNT_MAP = "{quebrado";
    expect((await tiktokZernioProvider.readyProblem(post({ workspaceId: "w2" }), { checkRemote: false }))?.code).toBe("zernio_account_missing");
  });
});

describe("a chave não vaza", () => {
  it("nenhuma mensagem de erro nem log contém a chave", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")].map((s) => s.mockImplementation(() => {}));
    const texts: string[] = [];
    const cases: Array<() => Promise<unknown>> = [
      async () => {
        fetchMock.mockResolvedValueOnce(json(500, { error: `internal ${KEY} Bearer ${KEY}` }));
        return tiktokZernioProvider.publish(post(), ctx());
      },
      async () => {
        fetchMock.mockRejectedValueOnce(new Error(`socket hang up Authorization: Bearer ${KEY}`));
        return tiktokZernioProvider.publish(post(), ctx());
      },
      async () => {
        fetchMock.mockResolvedValueOnce(new Response(`<html>${KEY}</html>`, { status: 502 }));
        return tiktokZernioProvider.check!(post({ publishId: "zp" }));
      },
      async () => {
        fetchMock.mockResolvedValueOnce(json(200, { post: { platforms: [{ status: "failed", errorMessage: `bad ${KEY}` }] } }));
        const r = await tiktokZernioProvider.check!(post({ publishId: "zp" }));
        if (r.state === "failed") throw new Error(r.message);
        return r;
      },
    ];
    for (const run of cases) {
      try {
        await run();
        throw new Error("devia falhar");
      } catch (e) {
        texts.push(String((e as Error).message));
      }
    }
    expect(texts).toHaveLength(4);
    for (const t of texts) expect(t).not.toContain(KEY);
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain(KEY);
    spies.forEach((s) => s.mockRestore());
  });
});

describe("tela (regras puras)", () => {
  const info: CreatorInfo = { nickname: "n", username: "u", avatarUrl: null, privacyLevelOptions: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"], commentDisabled: false, duetDisabled: false, stitchDisabled: false, maxVideoPostDurationSec: 3600, via: "zernio" };

  it("rótulos: Público / Rascunho no app só pela Zernio", () => {
    expect(privacyLabel("PUBLIC_TO_EVERYONE", info)).toBe("Public");
    expect(privacyLabel("SELF_ONLY", info)).toBe("Draft in the TikTok app");
    expect(privacyLabel("SELF_ONLY", { ...info, via: undefined })).toBe("Only me");
    expect(privacyLabel("SELF_ONLY", null)).toBe("Only me");
  });

  it("pela Zernio, conteúdo comercial é desligado e barrado; sem ela, nada muda", () => {
    const comm = { ...emptySettings(), privacyLevel: "PUBLIC_TO_EVERYONE", commercial: { enabled: true, yourBrand: true, brandedContent: false } };
    expect(normalizeSettings(comm, info).commercial.enabled).toBe(false);
    expect(normalizeSettings(comm, { ...info, via: undefined }).commercial.enabled).toBe(true);
    const input = { accountId: "a", caption: "x", mediaUrl: "u", mediaContentType: "video/mp4", durationSec: 10, settings: comm };
    expect(validateComposer(input, info, "publish")).toContain("Commercial content is not available when publishing through Zernio.");
    expect(validateComposer(input, { ...info, via: undefined }, "publish")).not.toContain("Commercial content is not available when publishing through Zernio.");
  });
});
