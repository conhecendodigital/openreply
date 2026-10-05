/**
 * Etapa 6: envio de arquivo (fotos, GIFs e vídeos) do editor do quiz pro
 * armazenamento próprio. Assinatura SigV4 (vetor oficial da AWS), chave do
 * objeto sem o nome original, rota só com sessão humana do workspace dono,
 * tipo e tamanho conferidos, vídeo direto só do nosso domínio e botão que
 * some sem as variáveis de ambiente.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({
  prisma: {
    funnel: { findFirst: vi.fn() },
    funnelMedia: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
  },
  mockContext: vi.fn(),
  mockCaller: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: h.mockContext,
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));
vi.mock("@/lib/auth", () => ({ getApiCaller: h.mockCaller }));
vi.mock("@/lib/http-rate-limit", () => ({ hitRateLimit: h.rateLimit }));

import * as uploadRoute from "../app/api/funnels/[id]/media/upload-url/route";
import * as mediaRoute from "../app/api/funnels/[id]/media/route";
import * as mediaItemRoute from "../app/api/funnels/[id]/media/[mediaId]/route";
import { amzDate, buildObjectKey, presignPut, presignUrl, readMediaStorageConfig } from "../lib/media/s3";
import {
  checkMediaFile,
  getMediaUploader,
  isAllowedImageUrl,
  isOwnMediaUrl,
  parseVideoUrl,
  setMediaPublicBase,
} from "../lib/funnels/media";
import { funnelDefinitionSchema } from "../lib/funnels/schema";
import { toPublicFunnel } from "../lib/funnels/render";
import { isApiKeyRouteAllowed } from "../lib/api-key-routes";
import { MediaUploadControl, MediaUploadProvider } from "../components/funnels/media-upload";
import type { FunnelDefinition } from "../lib/funnels/types";

const ENV = {
  MEDIA_S3_ENDPOINT: "https://midia.zapcriativo.com",
  MEDIA_S3_BUCKET: "quiz",
  MEDIA_S3_ACCESS_KEY: "AKIDEXAMPLE",
  MEDIA_S3_SECRET_KEY: "segredo/123+abc",
  MEDIA_PUBLIC_BASE_URL: "https://midia.zapcriativo.com/quiz",
};
const BASE = ENV.MEDIA_PUBLIC_BASE_URL;
const OWN_MP4 = `${BASE}/ws_A/f_1/2026-10/0b7c1c9e-1d2a-4c55-9a77-3f0e2f1b9a10.mp4`;
const OWN_JPG = `${BASE}/ws_A/f_1/2026-10/0b7c1c9e-1d2a-4c55-9a77-3f0e2f1b9a10.jpg`;

const CTX = { userId: "u_A", workspaceId: "ws_A", workspace: { id: "ws_A" }, role: "OWNER" };
const SESSION = { kind: "session" };
const TOKEN = { kind: "token", tokenId: "tok_1", scopes: [] };

function setEnv(values: Partial<typeof ENV> | null) {
  for (const k of Object.keys(ENV)) delete process.env[k];
  if (values) Object.assign(process.env, values);
}

function req(path: string, method = "GET", body?: unknown) {
  return new NextRequest(new URL(path, "http://localhost"), {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
const params = (id = "f_1") => ({ params: Promise.resolve({ id }) });
const post = (body: unknown, id = "f_1") => uploadRoute.POST(req(`/api/funnels/${id}/media/upload-url`, "POST", body), params(id));

beforeEach(() => {
  vi.clearAllMocks();
  setEnv(ENV);
  setMediaPublicBase(undefined);
  h.mockContext.mockResolvedValue(CTX);
  h.mockCaller.mockResolvedValue(SESSION);
  h.rateLimit.mockResolvedValue({ allowed: true, count: 1, limit: 60 });
  // findFunnel(id, workspaceId): only ws_A owns f_1.
  h.prisma.funnel.findFirst.mockImplementation(async ({ where }: { where: { id: string; workspaceId: string } }) =>
    where.id === "f_1" && where.workspaceId === "ws_A"
      ? { id: "f_1", workspaceId: "ws_A", name: "Q", slug: "q", status: "DRAFT", draft: {}, published: null, publishedVersion: 0, publishedAt: null, templateId: null, createdAt: new Date(), updatedAt: new Date() }
      : null
  );
  h.prisma.funnelMedia.create.mockResolvedValue({ id: "m_1" });
  h.prisma.funnelMedia.findMany.mockResolvedValue([]);
});
afterEach(() => {
  setEnv(null);
  setMediaPublicBase(undefined);
});

describe("assinatura SigV4 (URL pré-assinada)", () => {
  it("bate com o vetor oficial da AWS (GET examplebucket/test.txt)", () => {
    const url = presignUrl({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      region: "us-east-1",
      accessKey: "AKIAIOSFODNN7EXAMPLE",
      secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      date: new Date("2013-05-24T00:00:00Z"),
      expiresSeconds: 86400,
      headers: { host: "examplebucket.s3.amazonaws.com" },
    });
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
        "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
        "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host" +
        "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"
    );
  });

  it("PUT path-style assina Content-Type e Content-Length, expira em 10 min (recalculado à parte)", () => {
    const config = readMediaStorageConfig(ENV)!;
    const now = new Date("2026-10-05T12:34:56Z");
    const key = "ws_A/f_1/2026-10/abc.mp4";
    const out = presignPut(config, { key, contentType: "video/mp4", size: 1234, now });
    const u = new URL(out.uploadUrl);
    expect(`${u.origin}${u.pathname}`).toBe("https://midia.zapcriativo.com/quiz/ws_A/f_1/2026-10/abc.mp4");
    expect(u.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect(u.searchParams.get("X-Amz-Credential")).toBe("AKIDEXAMPLE/20261005/us-east-1/s3/aws4_request");
    expect(out.publicUrl).toBe(`${BASE}/${key}`);
    expect(out.headers).toEqual({ "Content-Type": "video/mp4" });

    // Independent recomputation of the signature.
    const query = out.uploadUrl.split("?")[1].replace(/&X-Amz-Signature=[0-9a-f]+$/, "");
    const canonical = [
      "PUT",
      "/quiz/ws_A/f_1/2026-10/abc.mp4",
      query,
      "content-length:1234\ncontent-type:video/mp4\nhost:midia.zapcriativo.com\n",
      "content-length;content-type;host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const sts = ["AWS4-HMAC-SHA256", amzDate(now), "20261005/us-east-1/s3/aws4_request", createHash("sha256").update(canonical).digest("hex")].join("\n");
    let k: Buffer = createHmac("sha256", `AWS4${ENV.MEDIA_S3_SECRET_KEY}`).update("20261005").digest();
    for (const part of ["us-east-1", "s3", "aws4_request"]) k = createHmac("sha256", k).update(part).digest();
    expect(u.searchParams.get("X-Amz-Signature")).toBe(createHmac("sha256", k).update(sts).digest("hex"));
  });

  it("sem qualquer uma das 5 variáveis, o armazenamento fica desligado", () => {
    expect(readMediaStorageConfig(ENV)).not.toBeNull();
    for (const k of Object.keys(ENV)) {
      expect(readMediaStorageConfig({ ...ENV, [k]: "" }), k).toBeNull();
    }
    expect(readMediaStorageConfig({ ...ENV, MEDIA_S3_ENDPOINT: "http://midia.zapcriativo.com" })).toBeNull();
  });
});

describe("chave do objeto e tipos", () => {
  it("é <workspace>/<funil>/<aaaa-mm>/<uuid>.<ext> e nunca leva o nome original", () => {
    const key = buildObjectKey({ workspaceId: "ws_A", funnelId: "f_1", ext: "jpg", now: new Date("2026-03-09T10:00:00Z") });
    expect(key).toMatch(/^ws_A\/f_1\/2026-03\/[0-9a-f-]{36}\.jpg$/);
    expect(() => buildObjectKey({ workspaceId: "../x", funnelId: "f_1", ext: "jpg" })).toThrow();
  });

  it("confere tipo e tamanho declarados; extensão vem do tipo", () => {
    expect(checkMediaFile({ type: "image/jpeg", size: 10 })).toMatchObject({ ok: true, ext: "jpg", kind: "image" });
    expect(checkMediaFile({ type: "image/gif", size: 15 * 1024 * 1024 })).toMatchObject({ ok: true, ext: "gif" });
    expect(checkMediaFile({ type: "image/gif", size: 15 * 1024 * 1024 + 1 })).toEqual({ ok: false, code: "media_too_large" });
    expect(checkMediaFile({ type: "video/webm", size: 500 * 1024 * 1024 })).toMatchObject({ ok: true, ext: "webm", kind: "video" });
    expect(checkMediaFile({ type: "video/mp4", size: 500 * 1024 * 1024 + 1 })).toEqual({ ok: false, code: "media_too_large" });
    expect(checkMediaFile({ type: "video/quicktime", size: 10 })).toEqual({ ok: false, code: "media_type" });
    expect(checkMediaFile({ type: "image/svg+xml", size: 10 })).toEqual({ ok: false, code: "media_type" });
    expect(checkMediaFile({ type: "text/html", size: 10 })).toEqual({ ok: false, code: "media_type" });
    expect(checkMediaFile({ type: "video/mp4", size: 10 }, "image")).toEqual({ ok: false, code: "media_type" });
    expect(checkMediaFile({ type: "image/png", size: 0 })).toEqual({ ok: false, code: "media_too_large" });
  });
});

describe("POST /api/funnels/[id]/media/upload-url", () => {
  const good = { contentType: "image/png", size: 2048, kind: "image", name: "minha-foto-secreta.png" };

  it("sessão do workspace dono: devolve uploadUrl, publicUrl e headers; chave sem o nome original", async () => {
    const res = await post(good);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.uploadUrl).toMatch(/^https:\/\/midia\.zapcriativo\.com\/quiz\/ws_A\/f_1\/\d{4}-\d{2}\/[0-9a-f-]{36}\.png\?X-Amz-Algorithm=/);
    expect(data.publicUrl).toMatch(/^https:\/\/midia\.zapcriativo\.com\/quiz\/ws_A\/f_1\/\d{4}-\d{2}\/[0-9a-f-]{36}\.png$/);
    expect(data.headers).toEqual({ "Content-Type": "image/png" });
    expect(data.uploadUrl).not.toContain("minha-foto");
    expect(data.publicUrl).not.toContain("minha-foto");
    const created = h.prisma.funnelMedia.create.mock.calls[0][0].data;
    expect(created).toMatchObject({ workspaceId: "ws_A", funnelId: "f_1", kind: "image", contentType: "image/png", size: 2048, createdBy: "u_A" });
    expect(created.key).not.toContain("minha-foto");
    expect(h.rateLimit).toHaveBeenCalledWith("funnel-media", "u_A", 60, 3600);
  });

  it("recusa chave de API (403 human_only) e o proxy nem deixa a chave chegar", async () => {
    h.mockCaller.mockResolvedValue(TOKEN);
    const res = await post(good);
    expect(res.status).toBe(403);
    expect((await res.json()).details.code).toBe("human_only");
    expect(h.prisma.funnelMedia.create).not.toHaveBeenCalled();
    expect(isApiKeyRouteAllowed("POST", "/api/funnels/f_1/media/upload-url")).toBe(false);
    expect(isApiKeyRouteAllowed("GET", "/api/funnels/f_1/media")).toBe(false);
    expect(isApiKeyRouteAllowed("PATCH", "/api/funnels/f_1/media/m_1")).toBe(false);
  });

  it("recusa funil de outro workspace (404) e sem login (401)", async () => {
    h.mockContext.mockResolvedValue({ ...CTX, workspaceId: "ws_B", workspace: { id: "ws_B" } });
    expect((await post(good)).status).toBe(404);
    h.mockContext.mockResolvedValue(null);
    expect((await post(good)).status).toBe(401);
    expect(h.prisma.funnelMedia.create).not.toHaveBeenCalled();
  });

  it("recusa tipo e tamanho inválidos", async () => {
    const bad = async (body: unknown) => {
      const res = await post(body);
      return [res.status, (await res.json()).details?.code];
    };
    expect(await bad({ ...good, contentType: "image/svg+xml" })).toEqual([400, "media_type"]);
    expect(await bad({ ...good, contentType: "video/mp4", kind: "image" })).toEqual([400, "media_type"]);
    expect(await bad({ ...good, size: 16 * 1024 * 1024 })).toEqual([400, "media_too_large"]);
    expect(await bad({ contentType: "video/mp4", size: 501 * 1024 * 1024 })).toEqual([400, "media_too_large"]);
    expect(await bad({ ...good, size: -1 })).toEqual([400, "invalid_funnel"]);
    expect(await bad({ ...good, key: "ws_B/x.png" })).toEqual([400, "invalid_funnel"]);
    expect(h.prisma.funnelMedia.create).not.toHaveBeenCalled();
  });

  it("limite por usuário (429) e servidor sem armazenamento (503 not_configured)", async () => {
    h.rateLimit.mockResolvedValue({ allowed: false, count: 61, limit: 60 });
    const limited = await post(good);
    expect(limited.status).toBe(429);
    expect((await limited.json()).details.code).toBe("rate_limited");
    setEnv(null);
    const off = await post(good);
    expect(off.status).toBe(503);
    expect((await off.json()).details.code).toBe("not_configured");
  });
});

describe("GET .../media e PATCH .../media/[mediaId]", () => {
  it("lista só arquivos enviados do workspace de quem chama", async () => {
    const res = await mediaRoute.GET(req("/api/funnels/f_1/media"), params());
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ enabled: true, publicBaseUrl: BASE, files: [] });
    expect(h.prisma.funnelMedia.findMany.mock.calls[0][0].where).toEqual({ workspaceId: "ws_A", uploadedAt: { not: null } });
  });

  it("sem as variáveis: enabled false (o botão some)", async () => {
    setEnv(null);
    const { data } = await (await mediaRoute.GET(req("/api/funnels/f_1/media"), params())).json();
    expect(data.enabled).toBe(false);
    expect(data.publicBaseUrl).toBeNull();
  });

  it("confirmar envio só no próprio workspace", async () => {
    h.prisma.funnelMedia.updateMany.mockResolvedValue({ count: 0 });
    h.prisma.funnelMedia.findFirst.mockResolvedValue(null);
    const res = await mediaItemRoute.PATCH(req("/api/funnels/f_1/media/m_9", "PATCH"), { params: Promise.resolve({ id: "f_1", mediaId: "m_9" }) });
    expect(res.status).toBe(404);
    expect(h.prisma.funnelMedia.updateMany.mock.calls[0][0].where).toMatchObject({ id: "m_9", funnelId: "f_1", workspaceId: "ws_A" });
    h.mockCaller.mockResolvedValue(TOKEN);
    const key = await mediaItemRoute.PATCH(req("/api/funnels/f_1/media/m_1", "PATCH"), { params: Promise.resolve({ id: "f_1", mediaId: "m_1" }) });
    expect(key.status).toBe(403);
  });
});

describe("vídeo direto só do nosso domínio", () => {
  it("aceita MP4/WebM sob MEDIA_PUBLIC_BASE_URL e toca como arquivo", () => {
    expect(parseVideoUrl(OWN_MP4)).toEqual({ provider: "file", id: new URL(OWN_MP4).pathname, embedUrl: OWN_MP4 });
    expect(parseVideoUrl(OWN_MP4.replace(".mp4", ".webm"))?.provider).toBe("file");
  });

  it("recusa qualquer outro host, sósia de domínio, outro caminho, query ou imagem", () => {
    for (const url of [
      "https://cdn.exemplo.com/video.mp4",
      "https://midia.zapcriativo.com.evil.com/quiz/ws_A/f_1/2026-10/a.mp4",
      "https://evil.com/https://midia.zapcriativo.com/quiz/a/b.mp4",
      "https://midia.zapcriativo.com/quizz/ws_A/a.mp4",
      "https://midia.zapcriativo.com/outro/ws_A/a.mp4",
      "http://midia.zapcriativo.com/quiz/ws_A/a.mp4",
      `${OWN_MP4}?x=1`,
      "https://midia.zapcriativo.com/quiz/ws_A/../../a.mp4",
      OWN_JPG,
      "https://midia.zapcriativo.com/quiz/ws_A/a.mov",
    ]) {
      expect(parseVideoUrl(url), url).toBeNull();
    }
  });

  it("sem MEDIA_PUBLIC_BASE_URL nenhum vídeo direto passa", () => {
    setEnv(null);
    expect(parseVideoUrl(OWN_MP4)).toBeNull();
  });

  it("no navegador a base vem do editor (setMediaPublicBase)", () => {
    setEnv(null);
    setMediaPublicBase(BASE);
    expect(parseVideoUrl(OWN_MP4)?.provider).toBe("file");
    setMediaPublicBase(null);
    expect(parseVideoUrl(OWN_MP4)).toBeNull();
  });

  it("imagem do nosso domínio sempre passa; as regras das outras continuam", () => {
    expect(isOwnMediaUrl(OWN_JPG, "image")).toBe(true);
    expect(isAllowedImageUrl(OWN_JPG)).toBe(true);
    expect(isAllowedImageUrl("https://cdn.x.com/a")).toBe(true);
    expect(isAllowedImageUrl("http://cdn.x.com/a.png")).toBe(false);
  });

  it("o bloco de vídeo com arquivo próprio passa no zod e chega ao player como file", () => {
    const def: FunnelDefinition = {
      schemaVersion: 1,
      settings: { theme: { mode: "light", primary: "#0095f6", background: "#ffffff", text: "#000000" } },
      steps: [
        {
          id: "s1",
          title: "VSL",
          blocks: [{ id: "v1", type: "video", url: OWN_MP4, title: "VSL", autoplay: true, posterUrl: OWN_JPG }],
        },
      ],
    };
    expect(funnelDefinitionSchema.safeParse(def).success).toBe(true);
    const block = toPublicFunnel({ id: "f", slug: "s", name: "n", version: 1, definition: def }).steps[0].blocks[0];
    expect(block).toMatchObject({ type: "video", provider: "file", embedUrl: OWN_MP4, autoplay: true, posterUrl: OWN_JPG });
    const other = { ...def, steps: [{ ...def.steps[0], blocks: [{ id: "v1", type: "video" as const, url: "https://cdn.x.com/v.mp4", title: "x" }] }] };
    expect(funnelDefinitionSchema.safeParse(other).success).toBe(false);
  });
});

describe("botão Enviar arquivo", () => {
  const render = (uploader: ReturnType<typeof getMediaUploader>) =>
    renderToStaticMarkup(
      createElement(
        MediaUploadProvider,
        { value: { uploader, files: [], addFile: () => undefined } },
        createElement(MediaUploadControl, { kind: "image", onUploaded: () => undefined })
      )
    );

  it("some sem armazenamento configurado", () => {
    expect(getMediaUploader()).toBeNull();
    expect(getMediaUploader(null)).toBeNull();
    expect(getMediaUploader({ enabled: false, publicBaseUrl: null, maxImageBytes: 1, maxVideoBytes: 1, funnelId: "f_1" })).toBeNull();
    expect(render(null)).toBe("");
  });

  it("aparece com armazenamento, com accept que abre câmera/galeria no celular", () => {
    const uploader = getMediaUploader({ enabled: true, publicBaseUrl: BASE, maxImageBytes: 1, maxVideoBytes: 1, funnelId: "f_1" });
    expect(uploader).not.toBeNull();
    const html = render(uploader);
    expect(html).toContain("Enviar arquivo");
    expect(html).toContain('accept="image/jpeg,image/png,image/webp,image/gif"');
  });
});
