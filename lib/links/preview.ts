/**
 * Preview of a tracked link (07/10/2026). Pedido do dono: a DM em texto
 * mostrava o cartão do Lead Engine em vez da capa do quiz.
 *
 * When /r/... is opened by a link preview robot (Instagram, WhatsApp,
 * Telegram...) or by a HEAD request, the route answers 200 with a tiny page
 * that only has the Open Graph tags. No click is counted and nothing
 * redirects. People keep getting the 302 and are counted as before.
 *
 * Where the tags come from, field by field, first that has it:
 *   (a) the link's own preview (TrackedLink.preview*, set on the campaign);
 *   (b) a quiz of this Lead Engine: its cover (lib/funnels/share.ts), found by
 *       the destination URL or by any redirect on the way (e.g.
 *       comando.../diag -> quiz.../diag, a Cloudflare rule);
 *   (c) the og:* tags of the destination page (SSRF guard, 3 s, cache);
 *   (d) a neutral default: only the link's name. Never the Lead Engine brand.
 *
 * Server-only.
 */
import { checkPublicHttpsUrl, assertResolvesPublic, type LookupAll } from "@/lib/integrations/url-guard";
import { appHostname, hostOf, listedQuizDomains } from "@/lib/links/hosts";
import { absoluteHttpsUrl, funnelShareMeta, type ShareableFunnel, type ShareMeta } from "@/lib/funnels/share";
import { isValidSlug } from "@/lib/funnels/slug";

// ─── Who is asking ──────────────────────────────────────────────────────────

/** Always robots, wherever the word shows. */
const BOT_TOKENS = /facebookexternalhit|facebot|meta-externalagent|meta-externalfetcher|twitterbot|telegrambot|slackbot|linkedinbot|discordbot|skypeuripreview|pinterestbot|redditbot|applebot|embedly|iframely|vkshare|bingpreview/i;
/**
 * Robots only when the UA is not a browser: the Instagram in-app browser says
 * "Mozilla/5.0 ... Instagram 300.0", and that is a PERSON tapping the link.
 * The WhatsApp preview fetcher says just "WhatsApp/2.23.20.0 A".
 */
const APP_TOKENS = /\b(instagram|whatsapp)\b/i;

export function isPreviewBot(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").trim();
  if (!ua) return false;
  if (BOT_TOKENS.test(ua)) return true;
  return APP_TOKENS.test(ua) && !/mozilla\//i.test(ua);
}

/** HEAD never counts and never needs the redirect. */
export function wantsPreview(request: Request): boolean {
  return request.method === "HEAD" || isPreviewBot(request.headers.get("user-agent"));
}

// ─── The quiz behind a URL ──────────────────────────────────────────────────

type Env = Record<string, string | undefined>;

/**
 * Slug of a quiz of this app at `url`, or null: <app>/q/<slug>, or
 * <quiz domain listed in QUIZ_DOMAINS>/<slug>. A quiz domain that is not
 * listed is found by step (c): the quiz page has the same tags.
 */
export function quizSlugFromUrl(url: string, env: Env = process.env): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = hostOf(u.host);
  const path = u.pathname.replace(/\/+$/, "");
  const app = appHostname(env);
  if (app && host === app) {
    const m = /^\/q\/([a-z0-9-]+)$/.exec(path);
    return m && isValidSlug(m[1]) ? m[1] : null;
  }
  if (listedQuizDomains(env).includes(host)) {
    const m = /^\/(?:q\/)?([a-z0-9-]+)$/.exec(path);
    return m && isValidSlug(m[1]) ? m[1] : null;
  }
  return null;
}

// ─── The destination page ───────────────────────────────────────────────────

export type PageMeta = { title?: string; description?: string; imageUrl?: string };
/** What reading the destination found: its tags, or a quiz of ours on the way. */
export type PageLookup = { meta: PageMeta | null; quizSlug: string | null };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type PreviewDeps = {
  fetch?: FetchLike;
  lookup?: LookupAll;
  /** Published quiz by slug (lib/funnels/public.ts). */
  loadQuiz?: (slug: string) => Promise<ShareableFunnel | null>;
  env?: Env;
};

const FETCH_TIMEOUT_MS = 3000;
const MAX_HOPS = 3;
const MAX_HTML_BYTES = 256 * 1024;
const CACHE_OK_MS = 10 * 60_000;
const CACHE_FAIL_MS = 2 * 60_000;
const CACHE_MAX = 500;
const pageCache = new Map<string, { at: number; ttl: number; value: PageLookup }>();

export function clearPreviewCache(): void {
  pageCache.clear();
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  if (!m) return undefined;
  return decodeEntities(m[2] ?? m[3] ?? m[4] ?? "").trim();
}

/** og:* (then twitter:*, then <title> and description) of an HTML page. */
export function parseMetaTags(html: string, pageUrl: string): PageMeta {
  const found: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = (attr(tag, "property") ?? attr(tag, "name") ?? "").toLowerCase();
    const content = attr(tag, "content");
    if (key && content && !(key in found)) found[key] = content;
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const title = found["og:title"] ?? found["twitter:title"] ?? (titleTag ? decodeEntities(titleTag).replace(/\s+/g, " ").trim() : undefined);
  const description = found["og:description"] ?? found["twitter:description"] ?? found["description"];
  const image = found["og:image:secure_url"] ?? found["og:image"] ?? found["og:image:url"] ?? found["twitter:image"] ?? found["twitter:image:src"];
  const imageUrl = absoluteHttpsUrl(image, pageUrl);
  return {
    ...(title ? { title: title.slice(0, 200) } : {}),
    ...(description ? { description: description.slice(0, 400) } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };
}

async function readLimited(res: Response, limit: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const all = new Uint8Array(Math.min(size, limit));
  let offset = 0;
  for (const c of chunks) {
    const part = c.subarray(0, Math.max(0, all.length - offset));
    all.set(part, offset);
    offset += part.length;
    if (offset >= all.length) break;
  }
  return new TextDecoder("utf-8").decode(all);
}

/**
 * Reads the destination: follows up to 3 redirects by hand, each one checked
 * by the SSRF guard (https, public host, every IP public). Stops early when a
 * hop is a quiz of ours. Never throws.
 */
export async function lookupDestination(url: string, deps: PreviewDeps = {}): Promise<PageLookup> {
  const env = deps.env ?? process.env;
  const hit = pageCache.get(url);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;

  const doFetch: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  let current = url;
  let value: PageLookup = { meta: null, quizSlug: null };
  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const quizSlug = quizSlugFromUrl(current, env);
      if (quizSlug) {
        value = { meta: null, quizSlug };
        break;
      }
      const check = checkPublicHttpsUrl(current);
      if (!check.ok) break;
      if (await assertResolvesPublic(check.hostname, deps.lookup)) break;
      const res = await doFetch(current, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "user-agent": "Mozilla/5.0 (compatible; LinkPreview/1.0)", accept: "text/html,application/xhtml+xml" },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => undefined);
        if (!location) break;
        current = new URL(location, current).toString();
        continue;
      }
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !/html/i.test(type)) {
        await res.body?.cancel().catch(() => undefined);
        break;
      }
      const meta = parseMetaTags(await readLimited(res, MAX_HTML_BYTES), current);
      value = { meta: Object.keys(meta).length ? meta : null, quizSlug: null };
      break;
    }
  } catch {
    value = { meta: null, quizSlug: null };
  }
  if (pageCache.size >= CACHE_MAX) pageCache.clear();
  pageCache.set(url, { at: Date.now(), ttl: value.meta || value.quizSlug ? CACHE_OK_MS : CACHE_FAIL_MS, value });
  return value;
}

// ─── Putting it together ────────────────────────────────────────────────────

/** Labels the app stores for a link nobody named. Never the title of a card. */
const DEFAULT_LINK_LABELS = new Set(["open link", "primary campaign link"]);

export type PreviewSource = {
  destinationUrl: string;
  label?: string | null;
  previewTitle?: string | null;
  previewDescription?: string | null;
  previewImageUrl?: string | null;
};

export type LinkPreview = ShareMeta;

function neutralTitle(source: PreviewSource): string {
  const label = source.label?.trim();
  if (label && !DEFAULT_LINK_LABELS.has(label.toLowerCase())) return label;
  try {
    return new URL(source.destinationUrl).hostname.replace(/^www\./, "");
  } catch {
    return "Link";
  }
}

const clean = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

export async function resolveLinkPreview(source: PreviewSource, deps: PreviewDeps = {}): Promise<LinkPreview> {
  const env = deps.env ?? process.env;
  const own: Partial<ShareMeta> = {
    title: clean(source.previewTitle) || undefined,
    description: clean(source.previewDescription) || undefined,
    imageUrl: absoluteHttpsUrl(source.previewImageUrl),
  };
  const complete = own.title && own.description && own.imageUrl;

  let found: Partial<ShareMeta> = {};
  if (!complete) {
    let quizSlug = quizSlugFromUrl(source.destinationUrl, env);
    let page: PageMeta | null = null;
    if (!quizSlug) {
      const lookup = await lookupDestination(source.destinationUrl, deps);
      quizSlug = lookup.quizSlug;
      page = lookup.meta;
    }
    if (quizSlug && deps.loadQuiz) {
      const quiz = await deps.loadQuiz(quizSlug).catch(() => null);
      if (quiz) found = funnelShareMeta(quiz, env.NEXTAUTH_URL);
    }
    if (!found.title && page) found = page;
  }

  const title = (own.title ?? found.title ?? neutralTitle(source)).slice(0, 120);
  const description = (own.description ?? found.description)?.slice(0, 300);
  const imageUrl = own.imageUrl ?? found.imageUrl;
  return { title, ...(description ? { description } : {}), ...(imageUrl ? { imageUrl } : {}) };
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** The tiny page the robots read. No script, no redirect, no brand. */
export function previewHtml(preview: LinkPreview, url: string): string {
  const tags = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(preview.title)}">`,
    preview.description ? `<meta property="og:description" content="${esc(preview.description)}">` : "",
    preview.description ? `<meta name="description" content="${esc(preview.description)}">` : "",
    preview.imageUrl ? `<meta property="og:image" content="${esc(preview.imageUrl)}">` : "",
    preview.imageUrl ? `<meta property="og:image:secure_url" content="${esc(preview.imageUrl)}">` : "",
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta name="twitter:card" content="${preview.imageUrl ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${esc(preview.title)}">`,
    preview.description ? `<meta name="twitter:description" content="${esc(preview.description)}">` : "",
    preview.imageUrl ? `<meta name="twitter:image" content="${esc(preview.imageUrl)}">` : "",
    `<meta name="robots" content="noindex, nofollow">`,
  ].filter(Boolean);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(preview.title)}</title>${tags.join("")}</head><body><p>${esc(preview.title)}</p></body></html>`;
}

export function previewResponse(preview: LinkPreview, url: string, method: string): Response {
  const body = previewHtml(preview, url);
  return new Response(method === "HEAD" ? null : body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Same URL, other answer for people: no cache in between (Cloudflare).
      "cache-control": "no-store",
      vary: "User-Agent",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
