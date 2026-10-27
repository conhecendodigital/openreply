/**
 * 27/10/2026: login do Instagram com todas as permissões (incluindo publicar), painel de permissões
 * do canal, carrossel (filhos + pai + publish, conversão PNG para JPEG, ordem, limites) e Reel sem
 * regressão. Tudo com fetch simulado: nada aqui fala com a Meta de verdade.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";

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
vi.mock("@/lib/media/s3", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/media/s3")>();
  return {
    ...real,
    readMediaStorageConfig: () => ({
      endpoint: "https://s3.example.com",
      bucket: "bucket",
      region: "us-east-1",
      accessKey: "AKFAKE",
      secretKey: "SKFAKE",
      publicBaseUrl: "https://midia.example.com/bucket",
    }),
  };
});

import { encryptToken, getAuthorizationUrl, getRequestedInstagramScopes, exchangeCodeForToken, parseGrantedScopes, INSTAGRAM_PUBLISH_SCOPE } from "../lib/meta/oauth";
import { buildPermissionPanel } from "../lib/meta/permissions";
import { PermissionsPanel } from "../components/channels/instagram-detail";
import { translate } from "../lib/i18n";
import { carouselPolling, instagramProvider, instagramSettingsSchema } from "../lib/social/providers/instagram";
import { convertToJpeg } from "../lib/social/instagram-images";
import { slideProblems, slideWarnings, type InstagramSlide } from "../lib/social/instagram-carousel";
import { instagramFormFromSettings, instagramSettingsPayload, validateSocialComposer, emptyInstagramForm, emptyYouTubeForm, emptyFacebookForm } from "../lib/social-composer";
import { mediaLimitsProblem } from "../lib/social/posts-api";
import { tiktokProvider } from "../lib/social/providers/tiktok";

const BASE = "https://midia.example.com/bucket/ws_A/posts";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const metaError = (code: number, message = "erro") => json({ error: { message, code, fbtrace_id: "tr" } }, 400);
const formOf = (call: unknown[]) => new URLSearchParams(String((call[1] as RequestInit).body));
const slide = (n: number, over: Partial<InstagramSlide> = {}): InstagramSlide => ({
  url: `${BASE}/s${n}.jpg`,
  bytes: 300_000,
  contentType: "image/jpeg",
  width: 1080,
  height: 1350,
  ...over,
});
// Token cifrado como no banco (a chave de teste é sorteada no beforeEach).
const channelOf = () => ({ id: "c_1", instagramId: "17841", accessToken: encryptToken("IGAAtoken"), status: "ACTIVE" });
const carouselPost = (slides: InstagramSlide[], over: Record<string, unknown> = {}) =>
  ({
    id: "p_1",
    workspaceId: "ws_A",
    platform: "INSTAGRAM",
    caption: "legenda #ia",
    mediaUrl: slides[0]?.url ?? "",
    mediaBytes: slides[0]?.bytes ?? 0,
    mediaContentType: slides[0]?.contentType ?? "image/jpeg",
    settings: { shareToFeed: true, format: "CAROUSEL", slides },
    publishId: null,
    channel: channelOf(),
    ...over,
  }) as never;
const reelPost = (over: Record<string, unknown> = {}) =>
  ({
    id: "p_2",
    workspaceId: "ws_A",
    platform: "INSTAGRAM",
    caption: "legenda",
    mediaUrl: `${BASE}/video.mp4`,
    mediaBytes: 5 * 1024 * 1024,
    mediaContentType: "video/mp4",
    settings: { shareToFeed: true },
    publishId: null,
    channel: channelOf(),
    ...over,
  }) as never;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  h.models.clear();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  carouselPolling.attempts = 3;
  carouselPolling.delayMs = 0;
  vi.stubEnv("INSTAGRAM_APP_ID", "app_1");
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret-with-enough-length");
  vi.stubEnv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const scopesOf = (url: string) => new URL(url).searchParams.get("scope")!.split(",");

describe("A. permissões pedidas no login do Instagram", () => {
  it("por padrão pede as cinco, com publicar", () => {
    const scopes = scopesOf(getAuthorizationUrl("https://app/cb", "st"));
    expect(scopes).toEqual([
      "instagram_business_basic",
      "instagram_business_manage_messages",
      "instagram_business_manage_comments",
      "instagram_business_manage_insights",
      INSTAGRAM_PUBLISH_SCOPE,
    ]);
  });

  it("INSTAGRAM_PUBLISH_DISABLED=1 volta ao pedido antigo, sem publicar", () => {
    vi.stubEnv("INSTAGRAM_PUBLISH_DISABLED", "1");
    expect(scopesOf(getAuthorizationUrl("https://app/cb", "st"))).not.toContain(INSTAGRAM_PUBLISH_SCOPE);
    expect(scopesOf(getAuthorizationUrl("https://app/cb", "st"))).toHaveLength(4);
  });

  it("INSTAGRAM_PUBLISH_ENABLED=0 (nome antigo) também desliga; =1 continua ligado", () => {
    expect(getRequestedInstagramScopes({ INSTAGRAM_PUBLISH_ENABLED: "0" })).not.toContain(INSTAGRAM_PUBLISH_SCOPE);
    expect(getRequestedInstagramScopes({ INSTAGRAM_PUBLISH_ENABLED: "1" })).toContain(INSTAGRAM_PUBLISH_SCOPE);
    expect(getRequestedInstagramScopes({})).toContain(INSTAGRAM_PUBLISH_SCOPE);
    expect(getRequestedInstagramScopes({ INSTAGRAM_PUBLISH_DISABLED: "0" })).toContain(INSTAGRAM_PUBLISH_SCOPE);
  });

  it("lê as permissões concedidas nos dois formatos de resposta da Meta", async () => {
    expect(parseGrantedScopes("instagram_business_basic,instagram_business_content_publish")).toEqual(["instagram_business_basic", "instagram_business_content_publish"]);
    expect(parseGrantedScopes(["instagram_business_basic", "lixo com espaço"])).toEqual(["instagram_business_basic"]);
    expect(parseGrantedScopes(undefined)).toEqual([]);
    vi.stubEnv("INSTAGRAM_APP_SECRET", "segredo-falso");
    fetchMock.mockResolvedValueOnce(json({ data: [{ access_token: "short", user_id: 123, permissions: "instagram_business_basic,instagram_business_content_publish" }] }));
    expect(await exchangeCodeForToken("c", "https://app/cb")).toEqual({ accessToken: "short", userId: "123", permissions: ["instagram_business_basic", "instagram_business_content_publish"] });
    fetchMock.mockResolvedValueOnce(json({ access_token: "short2", user_id: 9 }));
    expect(await exchangeCodeForToken("c", "https://app/cb")).toEqual({ accessToken: "short2", userId: "9", permissions: [] });
  });
});

describe("B. painel de permissões", () => {
  const all = ["instagram_business_basic", "instagram_business_manage_messages", "instagram_business_manage_comments", "instagram_business_manage_insights", INSTAGRAM_PUBLISH_SCOPE];

  it("marca ativo e faltando, e avisa quando falta publicar", () => {
    const panel = buildPermissionPanel(all.filter((s) => s !== INSTAGRAM_PUBLISH_SCOPE), []);
    expect(panel.unknown).toBe(false);
    expect(panel.missingPublish).toBe(true);
    expect(panel.rows.find((r) => r.scope === INSTAGRAM_PUBLISH_SCOPE)?.state).toBe("missing");
    expect(panel.rows.find((r) => r.scope === "instagram_business_basic")?.state).toBe("granted");
  });

  it("sem lista guardada é 'não confirmada', sem alarme falso", () => {
    const panel = buildPermissionPanel([], []);
    expect(panel.unknown).toBe(true);
    expect(panel.missingPublish).toBe(false);
    expect(panel.rows.every((r) => r.state === "unknown")).toBe(true);
  });

  const card = (grantedScopes: string[]) => ({ platform: "instagram", id: "c", grantedScopes }) as never;
  const tPt = (k: string, v?: Record<string, string | number>) => translate("pt", k, v);

  it("a tela mostra em português e o aviso de publicar", () => {
    const html = renderToStaticMarkup(createElement(PermissionsPanel, { card: card(all.slice(0, 4)), t: tPt }));
    expect(html).toContain("Permissões autorizadas");
    expect(html).toContain("Faltando");
    expect(html).toContain("Falta a permissão de publicar");
    expect(html).toContain("instagram_business_content_publish");
  });

  it("com tudo concedido não tem aviso", () => {
    const html = renderToStaticMarkup(createElement(PermissionsPanel, { card: card(all), t: tPt }));
    expect(html).not.toContain("Falta a permissão");
    expect(html).not.toContain("Faltando");
  });

  it("sem lista, diz que a Meta não informou", () => {
    const html = renderToStaticMarkup(createElement(PermissionsPanel, { card: card([]), t: tPt }));
    expect(html).toContain("A Meta não informou");
  });
});

describe("C. carrossel: regras e validação", () => {
  it("2 a 20 itens", () => {
    expect(slideProblems([slide(1)])).toEqual(["Add at least 2 images to the carousel."]);
    expect(slideProblems([slide(1), slide(2)])).toEqual([]);
    expect(slideProblems(Array.from({ length: 20 }, (_, i) => slide(i)))).toEqual([]);
    expect(slideProblems(Array.from({ length: 21 }, (_, i) => slide(i)))).toEqual(["A carousel has up to 20 images."]);
    expect(instagramSettingsSchema.safeParse({ shareToFeed: true, format: "CAROUSEL", slides: Array.from({ length: 21 }, (_, i) => slide(i)) }).success).toBe(false);
  });

  it("avisa tamanho diferente de 1080x1350 e formato diferente do primeiro", () => {
    const warnings = slideWarnings([slide(1), slide(2, { width: 1080, height: 1080 }), slide(3, { width: 800, height: 1000 })]);
    expect(warnings.some((w) => w.text.includes("recommended size") && w.params.n === 2)).toBe(true);
    expect(warnings.some((w) => w.text.includes("different shape") && w.params.n === 2)).toBe(true);
    expect(slideWarnings([slide(1), slide(2)])).toEqual([]);
  });

  it("o corpo aceita só JPEG ou PNG e só o Instagram aceita imagem", () => {
    expect(instagramSettingsSchema.safeParse({ shareToFeed: true, slides: [{ ...slide(1), contentType: "image/gif" }] }).success).toBe(false);
    expect(mediaLimitsProblem(instagramProvider, { mediaContentType: "image/png", mediaBytes: 1000 })).toBeNull();
    expect(mediaLimitsProblem(instagramProvider, { mediaContentType: "image/png", mediaBytes: 9 * 1024 * 1024 })).not.toBeNull();
    expect(mediaLimitsProblem(tiktokProvider, { mediaContentType: "image/png", mediaBytes: 1000 })).not.toBeNull();
  });

  it("readyProblem do carrossel", async () => {
    expect(await instagramProvider.readyProblem(carouselPost([slide(1), slide(2)]), { checkRemote: false })).toBeNull();
    expect((await instagramProvider.readyProblem(carouselPost([slide(1)]), { checkRemote: false }))?.message).toMatch(/at least 2/);
    expect((await instagramProvider.readyProblem(carouselPost([slide(1), slide(2, { url: "http://10.0.0.1/x.jpg" })]), { checkRemote: false }))?.message).toMatch(/Slide 2/);
    const withTrial = carouselPost([slide(1), slide(2)], { settings: { shareToFeed: true, format: "CAROUSEL", slides: [slide(1), slide(2)], trial: "MANUAL" } });
    expect((await instagramProvider.readyProblem(withTrial, { checkRemote: false }))?.code).toBe("invalid_settings");
    // Reel com imagem não passa.
    expect((await instagramProvider.readyProblem(reelPost({ mediaContentType: "image/png", mediaUrl: `${BASE}/a.png` }), { checkRemote: false }))?.code).toBe("invalid_media");
  });

  it("o compositor valida carrossel e a tela monta as opções", () => {
    const input = (slides: InstagramSlide[], extra = {}) => ({
      network: "INSTAGRAM" as const,
      accountId: "a",
      caption: "x",
      mediaUrl: slides[0]?.url ?? "",
      mediaBytes: slides[0]?.bytes ?? 0,
      mediaContentType: slides[0]?.contentType ?? "",
      youtube: emptyYouTubeForm(),
      facebook: emptyFacebookForm(),
      instagram: { ...emptyInstagramForm(), format: "CAROUSEL" as const, slides },
      ...extra,
    });
    expect(validateSocialComposer(input([slide(1), slide(2)]), "draft")).toEqual([]);
    expect(validateSocialComposer(input([slide(1)]), "draft")).toContain("Add at least 2 images to the carousel.");
    expect(validateSocialComposer(input([slide(1), slide(2)], { otherNetworks: true }), "draft")).toContain("A carousel only goes to Instagram. Unmark the other networks or pick Reel.");
    expect(instagramSettingsPayload({ ...emptyInstagramForm() })).toEqual({ shareToFeed: true });
    expect(instagramSettingsPayload({ ...emptyInstagramForm(), format: "CAROUSEL", slides: [slide(1), slide(2)] })).toEqual({ shareToFeed: true, format: "CAROUSEL", slides: [slide(1), slide(2)] });
    expect(instagramFormFromSettings({ shareToFeed: true, format: "CAROUSEL", slides: [slide(1)] }).format).toBe("CAROUSEL");
    expect(instagramFormFromSettings({ shareToFeed: true }).format).toBe("REELS");
  });
});

/** Meta de mentira: devolve ids na ordem de criação e responde o status de cada container. */
function fakeMeta(opts: { failChild?: number; status?: (id: string) => string } = {}) {
  let child = 0;
  const created: string[] = [];
  fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://midia.example.com/") && (!init || !init.method || init.method === "GET")) {
      const png = await sharp({ create: { width: 1080, height: 1350, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 0.5 } } }).png().toBuffer();
      return new Response(new Uint8Array(png), { status: 200 });
    }
    if (url.startsWith("https://s3.example.com/")) return new Response("", { status: 200 });
    if (url.includes("/media_publish")) return json({ id: "media_final" });
    if (url.includes("/media") && init?.method === "POST") {
      const f = new URLSearchParams(String(init.body));
      if (f.get("is_carousel_item") === "true") {
        child += 1;
        if (opts.failChild === child) return metaError(100, "Invalid image");
        created.push(f.get("image_url")!);
        return json({ id: `child_${child}` });
      }
      return json({ id: "parent_1" });
    }
    if (init?.method === undefined || init.method === "GET") {
      const id = url.split("?")[0].split("/").pop()!;
      return json({ status_code: opts.status ? opts.status(id) : "FINISHED" });
    }
    return json({});
  });
  return { created };
}

const graphCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes("graph.instagram.com"));

describe("C. carrossel: publicação", () => {
  it("cria um filho por imagem na ordem, depois o pai CAROUSEL, e fica esperando", async () => {
    fakeMeta();
    const savePublishId = vi.fn(async () => {});
    const slides = [slide(1), slide(2), slide(3)];
    const result = await instagramProvider.publish(carouselPost(slides), { savePublishId });
    expect(result).toEqual({ state: "waiting", publishId: "parent_1" });
    expect(savePublishId).toHaveBeenCalledWith("parent_1");
    const posts = graphCalls().filter((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(posts).toHaveLength(4);
    posts.slice(0, 3).forEach((call, i) => {
      expect(String(call[0])).toMatch(/graph\.instagram\.com\/v[\d.]+\/17841\/media$/);
      const f = formOf(call);
      expect(f.get("is_carousel_item")).toBe("true");
      expect(f.get("image_url")).toBe(slides[i].url);
      expect(f.get("media_type")).toBeNull();
    });
    const parent = formOf(posts[3]);
    expect(parent.get("media_type")).toBe("CAROUSEL");
    expect(parent.get("children")).toBe("child_1,child_2,child_3");
    expect(parent.get("caption")).toBe("legenda #ia");
    // Nada foi publicado ainda: o media_publish só sai no check.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("media_publish"))).toBe(false);
  });

  it("a ordem dos slides é a ordem dos filhos mesmo depois de reordenar", async () => {
    fakeMeta();
    const slides = [slide(3), slide(1), slide(2)];
    await instagramProvider.publish(carouselPost(slides), { savePublishId: async () => {} });
    const posts = graphCalls().filter((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(posts.slice(0, 3).map((c) => formOf(c).get("image_url"))).toEqual(slides.map((s) => s.url));
  });

  it("PNG é convertido para JPEG e guardado de novo; o JPEG segue direto", async () => {
    const meta = fakeMeta();
    const slides = [slide(1), slide(2, { url: `${BASE}/s2.png`, contentType: "image/png" })];
    await instagramProvider.publish(carouselPost(slides), { savePublishId: async () => {} });
    const puts = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(String(puts[0][0])).toMatch(/^https:\/\/s3\.example\.com\/bucket\/ws_A\/posts\/[\d-]+\/[0-9a-f-]+\.jpg\?/);
    const sent = (puts[0][1] as RequestInit).body as Uint8Array;
    const info = await sharp(Buffer.from(sent)).metadata();
    expect(info.format).toBe("jpeg");
    expect(info.width).toBe(1080);
    expect(info.height).toBe(1350);
    expect(meta.created[0]).toBe(slides[0].url);
    expect(meta.created[1]).toMatch(/^https:\/\/midia\.example\.com\/bucket\/ws_A\/posts\/[\d-]+\/[0-9a-f-]+\.jpg$/);
    expect(meta.created[1]).not.toContain(".png");
  });

  it("convertToJpeg devolve JPEG de verdade", async () => {
    const png = await sharp({ create: { width: 20, height: 30, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const out = await convertToJpeg(png);
    expect((await sharp(out).metadata()).format).toBe("jpeg");
  });

  it("erro num filho para tudo, diz qual slide e não cria o pai", async () => {
    fakeMeta({ failChild: 2 });
    await expect(instagramProvider.publish(carouselPost([slide(1), slide(2), slide(3)]), { savePublishId: async () => {} })).rejects.toThrow(/Slide 2:/);
    const bodies = graphCalls().filter((c) => (c[1] as RequestInit | undefined)?.method === "POST").map((c) => formOf(c).get("media_type"));
    expect(bodies).not.toContain("CAROUSEL");
  });

  it("filho com status ERROR para tudo; ainda processando depois das tentativas também", async () => {
    fakeMeta({ status: (id) => (id === "child_2" ? "ERROR" : "FINISHED") });
    await expect(instagramProvider.publish(carouselPost([slide(1), slide(2)]), { savePublishId: async () => {} })).rejects.toThrow(/Slide 2: Instagram could not process the image/);
    fetchMock.mockReset();
    fakeMeta({ status: () => "IN_PROGRESS" });
    await expect(instagramProvider.publish(carouselPost([slide(1), slide(2)]), { savePublishId: async () => {} })).rejects.toThrow(/still processing/);
  });

  it("check do carrossel: pai FINISHED publica; ERROR avisa 'carrossel'", async () => {
    fakeMeta();
    const done = await instagramProvider.check!(carouselPost([slide(1), slide(2)], { publishId: "parent_1" }));
    expect(done).toEqual({ state: "published", publishId: "media_final" });
    expect(String(fetchMock.mock.calls.find((c) => String(c[0]).includes("media_publish"))![0])).toContain("/17841/media_publish");
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(json({ status_code: "ERROR", status: "x" }));
    const failed = await instagramProvider.check!(carouselPost([slide(1), slide(2)], { publishId: "parent_1" }));
    expect(failed).toMatchObject({ state: "failed" });
    expect((failed as { message: string }).message).toMatch(/the carousel/);
  });

  it("sem a permissão de publicar a mensagem manda reconectar", async () => {
    fetchMock.mockResolvedValue(metaError(10, "Application does not have permission"));
    await expect(instagramProvider.publish(carouselPost([slide(1), slide(2)]), { savePublishId: async () => {} })).rejects.toThrow(/Slide 1:.*accept the publishing permission/);
  });
});

describe("D e Reel: sem regressão e reel de teste", () => {
  it("Reel antigo (só shareToFeed) continua igual", async () => {
    fetchMock.mockResolvedValue(json({ id: "container_1" }));
    const result = await instagramProvider.publish(reelPost(), { savePublishId: async () => {} });
    expect(result).toEqual({ state: "waiting", publishId: "container_1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const f = formOf(fetchMock.mock.calls[0]);
    expect(f.get("media_type")).toBe("REELS");
    expect(f.get("video_url")).toBe(`${BASE}/video.mp4`);
    expect(f.get("share_to_feed")).toBe("true");
    expect(f.get("trial_params")).toBeNull();
    expect(await instagramProvider.readyProblem(reelPost(), { checkRemote: false })).toBeNull();
  });

  it("reel de teste manda trial_params só quando escolhido", async () => {
    fetchMock.mockResolvedValue(json({ id: "container_1" }));
    await instagramProvider.publish(reelPost({ settings: { shareToFeed: true, format: "REELS", trial: "SS_PERFORMANCE" } }), { savePublishId: async () => {} });
    expect(JSON.parse(formOf(fetchMock.mock.calls[0]).get("trial_params")!)).toEqual({ graduation_strategy: "SS_PERFORMANCE" });
    expect(instagramSettingsSchema.safeParse({ shareToFeed: true, trial: "OUTRO" }).success).toBe(false);
  });

  it("check do Reel segue com a mensagem do vídeo", async () => {
    fetchMock.mockResolvedValue(json({ status_code: "ERROR" }));
    const r = await instagramProvider.check!(reelPost({ publishId: "c1" }));
    expect((r as { message: string }).message).toMatch(/the video/);
  });
});
