/**
 * Etapa 6: vídeo só por URL de host permitido (embed montado por nós) e o
 * link do checkout com as UTMs da visita, sem duplicar, com xcod na Hotmart.
 */
import { describe, expect, it } from "vitest";
import { getMediaUploader, isHttpsUrl, isPlaceholderUrl, parseVideoUrl } from "../lib/funnels/media";
import { buildCheckoutUrl, pickTrackingParams } from "../lib/funnels/checkout";

const YT = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&playsinline=1&modestbranding=1";
const UUID = "0b7c6b3e-1a2b-4c5d-8e9f-0123456789ab";

describe("parseVideoUrl", () => {
  it.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQ&t=10s",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  ])("YouTube %s", (url) => {
    expect(parseVideoUrl(url)).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ", embedUrl: YT });
  });

  it("Vimeo público e não listado", () => {
    expect(parseVideoUrl("https://vimeo.com/123456789")).toEqual({
      provider: "vimeo",
      id: "123456789",
      embedUrl: "https://player.vimeo.com/video/123456789?playsinline=1",
    });
    expect(parseVideoUrl("https://vimeo.com/123456789/abcdef1234")?.embedUrl).toBe(
      "https://player.vimeo.com/video/123456789?h=abcdef1234&playsinline=1"
    );
    expect(parseVideoUrl("https://player.vimeo.com/video/123456789?h=abcdef1234")?.embedUrl).toBe(
      "https://player.vimeo.com/video/123456789?h=abcdef1234&playsinline=1"
    );
  });

  it("Panda Video", () => {
    const url = `https://player-vz-abc123-45.tv.pandavideo.com.br/embed/?v=${UUID}`;
    expect(parseVideoUrl(url)).toEqual({ provider: "panda", id: UUID, embedUrl: url });
  });

  it.each([
    '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>',
    "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "https://www.youtube.com/watch?v=curto",
    "https://evil.pandavideo.com.br.evil.com/embed/?v=" + UUID,
    "https://player-vz-x.tv.pandavideo.com.br/outra/?v=" + UUID,
    "https://vimeo.com/abc",
    "",
  ])("recusa %s", (url) => {
    expect(parseVideoUrl(url)).toBeNull();
  });

  it("https e marcador de modelo", () => {
    expect(isHttpsUrl("https://cdn.x.com/img")).toBe(true);
    expect(isHttpsUrl("https://user:pw@x.com/a.png")).toBe(false);
    expect(isHttpsUrl("http://x.com/a.png")).toBe(false);
    expect(isPlaceholderUrl("https://troque.invalid/capa.jpg")).toBe(true);
    expect(isPlaceholderUrl("https://cdn.x.com/capa.jpg")).toBe(false);
  });

  it("sem armazenamento configurado não há envio de arquivo (só link)", () => {
    expect(getMediaUploader()).toBeNull();
  });
});

describe("buildCheckoutUrl", () => {
  it("repassa utm/fbclid/src/sck sem duplicar (visita vence) e mantém os params do destino", () => {
    const url = buildCheckoutUrl(
      "https://pay.hotmart.com/X123?off=abc&checkoutMode=10&utm_source=antigo",
      { utm_source: "instagram", utm_campaign: "reel_1", fbclid: "FB1", src: "bio", sck: "meu_sck" },
      { visitorId: "a".repeat(32) }
    )!;
    const u = new URL(url);
    expect(u.searchParams.getAll("utm_source")).toEqual(["instagram"]);
    expect(u.searchParams.get("utm_campaign")).toBe("reel_1");
    expect(u.searchParams.get("fbclid")).toBe("FB1");
    expect(u.searchParams.get("src")).toBe("bio");
    expect(u.searchParams.get("sck")).toBe("meu_sck");
    expect(u.searchParams.get("off")).toBe("abc");
    expect(u.searchParams.get("checkoutMode")).toBe("10");
    expect(u.searchParams.get("xcod")).toBe("a".repeat(32));
  });

  it("nunca repassa c nem params fora da lista", () => {
    const url = buildCheckoutUrl("https://pay.hotmart.com/X", { utm_source: "ig", c: "123.sig", foo: "bar" } as never, {})!;
    const u = new URL(url);
    expect(u.searchParams.has("c")).toBe(false);
    expect(u.searchParams.has("foo")).toBe(false);
  });

  it("xcod só em Hotmart e mantém o do destino", () => {
    expect(new URL(buildCheckoutUrl("https://pay.kiwify.com.br/X", {}, { visitorId: "b".repeat(32) })!).searchParams.has("xcod")).toBe(false);
    expect(new URL(buildCheckoutUrl("https://go.hotmart.com/X?xcod=dono", {}, { visitorId: "b".repeat(32) })!).searchParams.get("xcod")).toBe("dono");
  });

  it("gera sck de utm_source + utm_campaign quando falta (só Hotmart)", () => {
    const u = new URL(buildCheckoutUrl("https://pay.hotmart.com/X", { utm_source: "insta gram", utm_campaign: "reel#2" }, {})!);
    expect(u.searchParams.get("sck")).toBe("instagram_reel2");
    const v = new URL(buildCheckoutUrl("https://pay.hotmart.com/X", { utm_source: "ig" }, {})!);
    expect(v.searchParams.get("sck")).toBe("ig");
    const k = new URL(buildCheckoutUrl("https://pay.kiwify.com.br/X", { utm_source: "ig" }, {})!);
    expect(k.searchParams.has("sck")).toBe(false);
  });

  it("recusa http e vazio; corta valores em 200", () => {
    expect(buildCheckoutUrl("http://pay.hotmart.com/X", {}, {})).toBeNull();
    expect(buildCheckoutUrl("", {}, {})).toBeNull();
    const u = new URL(buildCheckoutUrl("https://pay.hotmart.com/X", { utm_content: "x".repeat(500) }, {})!);
    expect(u.searchParams.get("utm_content")).toHaveLength(200);
  });

  it("pickTrackingParams só pega a lista", () => {
    expect(pickTrackingParams(new URLSearchParams("utm_source=a&c=tok&x=1&gclid=g"))).toEqual({ utm_source: "a", gclid: "g" });
  });
});
