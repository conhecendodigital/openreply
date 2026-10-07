/**
 * Prévia dos links rastreados (07/10/2026). Pedido do dono: "a prévia desse
 * link não teria como ser uma capa do quiz [...] porque isso aí também tá
 * feio". Sem rede de verdade: fetch e DNS são falsos.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPreviewCache,
  isPreviewBot,
  lookupDestination,
  parseMetaTags,
  previewHtml,
  quizSlugFromUrl,
  resolveLinkPreview,
  type FetchLike,
} from "../lib/links/preview";
import { funnelShareMeta, type ShareableFunnel } from "../lib/funnels/share";
import { normalizeLinkDomain } from "../lib/links/domain";

const APP_ENV = { NEXTAUTH_URL: "https://many.leadenginer.com", QUIZ_DOMAINS: "quiz.cloudmatheus.com.br" };
const publicDns = async () => [{ address: "104.21.12.34" }];

const QUIZ: ShareableFunnel = {
  name: "Chat Sem Frescura (diagnóstico)",
  settings: { seo: { title: "Qual é o seu nível no Chat?", description: "Responda 5 perguntas e descubra." } },
  steps: [{ blocks: [{ type: "heading", text: "Bem-vindo" }, { type: "image", url: "https://midia.zapcriativo.com/quiz/ws/f/capa.gif" }] }],
};

const html = (head: string) => new Response(`<!doctype html><html><head>${head}</head><body></body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });

beforeEach(() => clearPreviewCache());
afterEach(() => vi.unstubAllEnvs());

describe("quem é robô de prévia", () => {
  it("robôs das redes e apps de mensagem", () => {
    for (const ua of [
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Facebot",
      "meta-externalagent/1.1",
      "WhatsApp/2.23.20.0 A",
      "Instagram 219.0.0.12.117 Android",
      "TelegramBot (like TwitterBot)",
      "Twitterbot/1.0",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
      "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
    ]) {
      expect(isPreviewBot(ua), ua).toBe(true);
    }
  });

  it("gente: navegador do Instagram, Chrome, Safari e sem UA", () => {
    for (const ua of [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0 (iPhone14,2; iOS 17_0; pt_BR)",
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
      "Mozilla/5.0 (Linux; Android 13; WhatsApp) AppleWebKit/537.36 Chrome/120 Mobile",
      "",
      null,
    ]) {
      expect(isPreviewBot(ua), String(ua)).toBe(false);
    }
  });
});

describe("capa do quiz", () => {
  it("título e descrição do SEO, imagem de compartilhamento", () => {
    const meta = funnelShareMeta({ ...QUIZ, settings: { seo: { ...QUIZ.settings.seo, imageUrl: "https://midia.zapcriativo.com/quiz/og.png" } } });
    expect(meta).toEqual({ title: "Qual é o seu nível no Chat?", description: "Responda 5 perguntas e descubra.", imageUrl: "https://midia.zapcriativo.com/quiz/og.png" });
  });

  it("sem imagem de compartilhamento: a primeira imagem da capa (GIF vai como está)", () => {
    expect(funnelShareMeta(QUIZ).imageUrl).toBe("https://midia.zapcriativo.com/quiz/ws/f/capa.gif");
  });

  it("sem SEO: nome do quiz e o primeiro texto da capa; imagem de exemplo (.invalid) não vale", () => {
    const meta = funnelShareMeta({
      name: "Diag",
      settings: { seo: { imageUrl: "https://exemplo.invalid/foto.png" } },
      steps: [{ blocks: [{ type: "text", text: "**Descubra** em 1 minuto {resposta.nome}" }] }],
    });
    expect(meta).toEqual({ title: "Diag", description: "Descubra em 1 minuto" });
  });

  it("acha o quiz pelo link: /q/<slug> no app e /<slug> no domínio do quiz", () => {
    expect(quizSlugFromUrl("https://many.leadenginer.com/q/diag", APP_ENV)).toBe("diag");
    expect(quizSlugFromUrl("https://quiz.cloudmatheus.com.br/diag", APP_ENV)).toBe("diag");
    expect(quizSlugFromUrl("https://quiz.cloudmatheus.com.br/diag/", APP_ENV)).toBe("diag");
    expect(quizSlugFromUrl("https://example.com/diag", APP_ENV)).toBeNull();
    expect(quizSlugFromUrl("https://many.leadenginer.com/dashboard", APP_ENV)).toBeNull();
  });
});

describe("de onde vem a prévia", () => {
  const loadQuiz = vi.fn(async (slug: string) => (slug === "diag" ? QUIZ : null));

  it("quiz pelo slug, sem rede", async () => {
    const fetch = vi.fn<FetchLike>();
    const p = await resolveLinkPreview({ destinationUrl: "https://many.leadenginer.com/q/diag", label: "Primary campaign link" }, { env: APP_ENV, fetch, loadQuiz });
    expect(p).toEqual({ title: "Qual é o seu nível no Chat?", description: "Responda 5 perguntas e descubra.", imageUrl: "https://midia.zapcriativo.com/quiz/ws/f/capa.gif" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("quiz pelo domínio do quiz", async () => {
    const p = await resolveLinkPreview({ destinationUrl: "https://quiz.cloudmatheus.com.br/diag" }, { env: APP_ENV, fetch: vi.fn<FetchLike>(), loadQuiz });
    expect(p.title).toBe("Qual é o seu nível no Chat?");
  });

  it("comando.../diag que o Cloudflare manda pro quiz: segue o redirecionamento e usa a capa", async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response(null, { status: 301, headers: { location: "https://quiz.cloudmatheus.com.br/diag" } }));
    const p = await resolveLinkPreview({ destinationUrl: "https://comando.cloudmatheus.com.br/diag" }, { env: APP_ENV, fetch, lookup: publicDns, loadQuiz });
    expect(p.title).toBe("Qual é o seu nível no Chat?");
    expect(p.imageUrl).toBe("https://midia.zapcriativo.com/quiz/ws/f/capa.gif");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("campos próprios do link vencem, campo por campo", async () => {
    const p = await resolveLinkPreview(
      { destinationUrl: "https://many.leadenginer.com/q/diag", previewTitle: "  Seu diagnóstico grátis ", previewImageUrl: "https://midia.zapcriativo.com/quiz/minha.png" },
      { env: APP_ENV, loadQuiz }
    );
    expect(p).toEqual({ title: "Seu diagnóstico grátis", description: "Responda 5 perguntas e descubra.", imageUrl: "https://midia.zapcriativo.com/quiz/minha.png" });
  });

  it("os três campos próprios: nem lê o destino", async () => {
    const fetch = vi.fn<FetchLike>();
    const p = await resolveLinkPreview(
      { destinationUrl: "https://hotmart.example.com/x", previewTitle: "T", previewDescription: "D", previewImageUrl: "https://cdn.example.com/i.png" },
      { env: APP_ENV, fetch, lookup: publicDns, loadQuiz }
    );
    expect(p).toEqual({ title: "T", description: "D", imageUrl: "https://cdn.example.com/i.png" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("página de destino: og:* (imagem relativa vira absoluta https)", async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      html(`<title>Fallback</title><meta property="og:title" content="Chat Sem Frescura &amp; Cia"><meta name="description" content="Desc"><meta property="og:image" content="/capa.jpg">`)
    );
    const p = await resolveLinkPreview({ destinationUrl: "https://pay.hotmart.com/A107839499R" }, { env: APP_ENV, fetch, lookup: publicDns, loadQuiz });
    expect(p).toEqual({ title: "Chat Sem Frescura & Cia", description: "Desc", imageUrl: "https://pay.hotmart.com/capa.jpg" });
  });

  it("cache: a mesma página não é lida de novo", async () => {
    const fetch = vi.fn<FetchLike>(async () => html(`<meta property="og:title" content="X">`));
    await lookupDestination("https://site.example.com/a", { env: APP_ENV, fetch, lookup: publicDns });
    await lookupDestination("https://site.example.com/a", { env: APP_ENV, fetch, lookup: publicDns });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("SSRF: destino em rede interna, http e redirecionamento pra metadados da nuvem não são lidos", async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } }));
    const internal = async (host: string) => [{ address: host === "interno.example.com" ? "10.0.0.5" : "104.21.12.34" }];

    const a = await resolveLinkPreview({ destinationUrl: "https://interno.example.com/x", label: "Meu material" }, { env: APP_ENV, fetch, lookup: internal });
    expect(a).toEqual({ title: "Meu material" });
    expect(fetch).not.toHaveBeenCalled();

    await resolveLinkPreview({ destinationUrl: "http://site.example.com/x" }, { env: APP_ENV, fetch, lookup: internal });
    expect(fetch).not.toHaveBeenCalled();

    const c = await resolveLinkPreview({ destinationUrl: "https://encurtador.example.com/x" }, { env: APP_ENV, fetch, lookup: internal });
    expect(fetch).toHaveBeenCalledTimes(1); // só o primeiro salto; o IP da nuvem nunca é chamado
    expect(c.title).toBe("encurtador.example.com");
  });

  it("padrão neutro: só o nome do link (ou o domínio), nunca a marca do Lead Engine", async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response("erro", { status: 500 }));
    const named = await resolveLinkPreview({ destinationUrl: "https://www.site.example.com/x", label: "Grupo VIP" }, { env: APP_ENV, fetch, lookup: publicDns });
    expect(named).toEqual({ title: "Grupo VIP" });
    const unnamed = await resolveLinkPreview({ destinationUrl: "https://www.outro.example.com/x", label: "Primary campaign link" }, { env: APP_ENV, fetch, lookup: publicDns });
    expect(unnamed).toEqual({ title: "outro.example.com" });
    const page = previewHtml(unnamed, "https://comando.cloudmatheus.com.br/r/abc");
    expect(page).not.toMatch(/Lead Engine|og-lead-engine/);
    expect(page).toContain('<meta name="twitter:card" content="summary">');
    expect(page).not.toContain("og:image");
  });

  it("HTML da prévia: escapa o texto e traz og:title, og:description, og:image, og:url e twitter:card", () => {
    const page = previewHtml({ title: 'Quiz "top" <b>', description: "a & b", imageUrl: "https://cdn.example.com/i.png" }, "https://comando.cloudmatheus.com.br/r/abc");
    expect(page).toContain('<meta property="og:title" content="Quiz &quot;top&quot; &lt;b&gt;">');
    expect(page).toContain('<meta property="og:description" content="a &amp; b">');
    expect(page).toContain('<meta property="og:image" content="https://cdn.example.com/i.png">');
    expect(page).toContain('<meta property="og:url" content="https://comando.cloudmatheus.com.br/r/abc">');
    expect(page).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(page).not.toMatch(/<script|http-equiv/i);
  });

  it("parseMetaTags lê aspas simples, sem aspas e twitter:*", () => {
    const meta = parseMetaTags(`<meta content='Oi' property='og:title'><meta name=twitter:image content=https://x.example.com/a.png>`, "https://x.example.com/");
    expect(meta).toEqual({ title: "Oi", imageUrl: "https://x.example.com/a.png" });
  });
});

describe("domínio do link: o que o dono digita", () => {
  it("aceita host, com https:// e com caminho; recusa o resto", () => {
    const env = { NEXTAUTH_URL: "https://many.leadenginer.com" };
    expect(normalizeLinkDomain("comando.cloudmatheus.com.br", env)).toEqual({ ok: true, domain: "comando.cloudmatheus.com.br" });
    expect(normalizeLinkDomain(" HTTPS://Comando.CloudMatheus.com.br/r/x ", env)).toEqual({ ok: true, domain: "comando.cloudmatheus.com.br" });
    expect(normalizeLinkDomain("many.leadenginer.com", env)).toEqual({ ok: false, code: "domain_app" });
    expect(normalizeLinkDomain("comando.cloudmatheus.com.br:8443", env)).toEqual({ ok: false, code: "domain_invalid" });
    expect(normalizeLinkDomain("192.168.0.1", env)).toEqual({ ok: false, code: "domain_invalid" });
    expect(normalizeLinkDomain("web", env)).toEqual({ ok: false, code: "domain_internal" });
    expect(normalizeLinkDomain("x.internal", env)).toEqual({ ok: false, code: "domain_internal" });
    expect(normalizeLinkDomain("user:pw@site.com.br", env)).toEqual({ ok: false, code: "domain_invalid" });
    expect(normalizeLinkDomain("sem_underline.com.br", env)).toEqual({ ok: false, code: "domain_invalid" });
    expect(normalizeLinkDomain(42, env)).toEqual({ ok: false, code: "domain_invalid" });
  });
});
