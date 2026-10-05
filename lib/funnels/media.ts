/**
 * Etapa 6: media of a funnel. v1 only takes URLs: image/GIF by https URL and
 * video by YouTube (unlisted too), Vimeo or Panda Video. We build the embed
 * URL ourselves: a pasted <iframe> or any other host is refused.
 *
 * Upload is a single plug point (getMediaUploader). Storage is not decided
 * yet (maybe another VPS), so v1 returns null and the screens ask for a link.
 *
 * Browser-safe.
 */
import type { VideoProvider } from "@/lib/funnels/types";

export const MAX_URL_LENGTH = 2048;

export const VIDEO_HOSTS: readonly string[] = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "vimeo.com",
  "player.vimeo.com",
  "*.pandavideo.com.br",
];

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{1,15}$/;
const VIMEO_HASH = /^[a-f0-9]{6,20}$/;
const PANDA_HOST = /^([a-z0-9-]+\.)+pandavideo\.com\.br$/;
const PANDA_ID = /^[a-f0-9-]{36}$/;

function parseUrl(value: string): URL | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > MAX_URL_LENGTH || /\s|[<>"']/.test(raw)) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** Valid URL, https:, no user/password, at most 2048 characters. */
export function isHttpsUrl(url: string): boolean {
  const u = parseUrl(url);
  return Boolean(u && u.protocol === "https:" && !u.username && !u.password && u.hostname);
}

/** Image or GIF by https URL (a CDN URL without extension is fine). */
export function isAllowedImageUrl(url: string): boolean {
  return isHttpsUrl(url);
}

/** Template placeholder host (".invalid" never resolves): the owner still has to put a real image. */
export function isPlaceholderUrl(url: string | null | undefined): boolean {
  const u = url ? parseUrl(url) : null;
  return Boolean(u && (u.hostname === "invalid" || u.hostname.endsWith(".invalid")));
}

/** Placeholder video id used by the templates ("[cole o link do vídeo]"). */
export const PLACEHOLDER_VIDEO_ID = "XXXXXXXXXXX";

export type ParsedVideo = { provider: VideoProvider; id: string; embedUrl: string };

export function parseVideoUrl(url: string): ParsedVideo | null {
  const u = parseUrl(url);
  if (!u || u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);

  if (host === "youtu.be" || YOUTUBE_HOSTS.has(host)) {
    let id: string | null = null;
    if (host === "youtu.be") id = parts.length === 1 ? parts[0] : null;
    else if (parts[0] === "watch" && parts.length === 1) id = u.searchParams.get("v");
    else if (["embed", "shorts", "live"].includes(parts[0] ?? "") && parts.length === 2) id = parts[1];
    if (!id || !YOUTUBE_ID.test(id)) return null;
    return {
      provider: "youtube",
      id,
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1&modestbranding=1`,
    };
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    let id: string | undefined;
    let hash: string | null = null;
    if (host === "vimeo.com") {
      if (parts.length < 1 || parts.length > 2) return null;
      id = parts[0];
      hash = parts[1] ?? u.searchParams.get("h");
    } else {
      if (parts[0] !== "video" || parts.length !== 2) return null;
      id = parts[1];
      hash = u.searchParams.get("h");
    }
    if (!id || !VIMEO_ID.test(id)) return null;
    if (hash !== null && hash !== "" && !VIMEO_HASH.test(hash)) return null;
    const h = hash ? `h=${hash}&` : "";
    return { provider: "vimeo", id, embedUrl: `https://player.vimeo.com/video/${id}?${h}playsinline=1` };
  }

  if (PANDA_HOST.test(host)) {
    if (parts.length !== 1 || parts[0] !== "embed") return null;
    const v = u.searchParams.get("v");
    if (!v || !PANDA_ID.test(v)) return null;
    return { provider: "panda", id: v, embedUrl: `https://${host}/embed/?v=${v}` };
  }

  return null;
}

/** Plug point for file upload, once storage is decided. */
export interface MediaUploader {
  upload(file: Blob, opts: { workspaceId: string; kind: "image" | "video" }): Promise<{ url: string }>;
}

/** v1: always null (storage not decided yet; the screens ask for a link). */
export function getMediaUploader(): MediaUploader | null {
  return null;
}
