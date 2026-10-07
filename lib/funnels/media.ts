/**
 * Etapa 6: media of a funnel. Image/GIF by https URL, video by YouTube
 * (unlisted too), Vimeo or Panda Video (we build the embed URL ourselves: a
 * pasted <iframe> or any other host is refused) or a file of our own storage.
 *
 * Own storage (S3 compatible, MEDIA_* env): the editor sends the file
 * straight from the browser with a pre-signed PUT (lib/media/s3.ts signs it).
 * A direct video (<video>) is only accepted from MEDIA_PUBLIC_BASE_URL, never
 * from any host. On the server the base comes from the env; in the browser
 * the editor sets it with setMediaPublicBase() (from GET .../media).
 *
 * Browser-safe.
 */
import type { VideoProvider } from "@/lib/funnels/types";

export const MAX_URL_LENGTH = 2048;

export type MediaKind = "image" | "video";

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

/** Accepted types. The extension of the stored file comes from here, never from the name. */
export const MEDIA_TYPES: Readonly<Record<string, { ext: string; kind: MediaKind }>> = {
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/png": { ext: "png", kind: "image" },
  "image/webp": { ext: "webp", kind: "image" },
  "image/gif": { ext: "gif", kind: "image" },
  "video/mp4": { ext: "mp4", kind: "video" },
  "video/webm": { ext: "webm", kind: "video" },
};

/** `accept` of the file input (phones offer camera and gallery). */
export const MEDIA_ACCEPT: Record<MediaKind, string> = {
  image: "image/jpeg,image/png,image/webp,image/gif",
  video: "video/mp4,video/webm",
};

export const maxBytesFor = (kind: MediaKind) => (kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES);

export type MediaFileCheck =
  | { ok: true; ext: string; kind: MediaKind; contentType: string }
  | { ok: false; code: "media_type" | "media_too_large" };

/** Declared type and size of a file. `kind` = what the field takes (image or video). */
export function checkMediaFile(file: { type: string; size: number }, kind?: MediaKind): MediaFileCheck {
  const contentType = String(file.type ?? "").toLowerCase().trim();
  const info = Object.prototype.hasOwnProperty.call(MEDIA_TYPES, contentType) ? MEDIA_TYPES[contentType] : undefined;
  if (!info || (kind && info.kind !== kind)) return { ok: false, code: "media_type" };
  const size = Number(file.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > maxBytesFor(info.kind)) return { ok: false, code: "media_too_large" };
  return { ok: true, ext: info.ext, kind: info.kind, contentType };
}

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

/** "https://host/path" without trailing slash, or null (not https, user/password, query...). */
export function normalizeMediaBase(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim().replace(/\/+$/, "");
  if (!raw) return null;
  const u = parseUrl(raw);
  if (!u || u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

let clientBase: string | null | undefined;

/** Browser: the public base of our storage (null = none, undefined = back to the env). */
export function setMediaPublicBase(value: string | null | undefined): void {
  clientBase = value === undefined ? undefined : normalizeMediaBase(value);
}

/** https://midia.example.com/quiz (no trailing slash), or null when not configured. */
export function mediaPublicBase(): string | null {
  if (clientBase !== undefined) return clientBase;
  const env = typeof process !== "undefined" ? process.env?.MEDIA_PUBLIC_BASE_URL : undefined;
  return normalizeMediaBase(env);
}

/** <dirs>/<name>.<ext>, only letters, numbers, - and _ (our keys: ws/funnel/aaaa-mm/uuid.ext). */
const OWN_KEY = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/[A-Za-z0-9_-]+\.([a-z0-9]{2,5})$/;

/** True for a file of our own storage (under MEDIA_PUBLIC_BASE_URL), optionally of one kind. */
export function isOwnMediaUrl(url: string, kind?: MediaKind): boolean {
  const base = mediaPublicBase();
  const u = parseUrl(url);
  if (!base || !u || u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return false;
  const b = new URL(base);
  const prefix = `${b.pathname.replace(/\/$/, "")}/`;
  if (u.origin !== b.origin || !u.pathname.startsWith(prefix)) return false;
  const m = OWN_KEY.exec(u.pathname.slice(prefix.length));
  if (!m) return false;
  const info = Object.values(MEDIA_TYPES).find((x) => x.ext === m[1]);
  return Boolean(info && (!kind || info.kind === kind));
}

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

/**
 * A path of this site ("/privacy"), never another site. "//host" and "/\host"
 * are refused: browsers read both as a link to another host (auditoria 05/10).
 */
export function isLocalPath(value: string): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!v.startsWith("/") || v.length > MAX_URL_LENGTH) return false;
  if (v.startsWith("//") || v.includes("\\") || /[\u0000-\u001f\u007f\s]/.test(v)) return false;
  return true;
}

/** Valid URL, https:, no user/password, at most 2048 characters. */
export function isHttpsUrl(url: string): boolean {
  const u = parseUrl(url);
  return Boolean(u && u.protocol === "https:" && !u.username && !u.password && u.hostname);
}

/** Image or GIF by https URL (a CDN URL without extension is fine). Our storage always passes. */
export function isAllowedImageUrl(url: string): boolean {
  return isOwnMediaUrl(url, "image") || isHttpsUrl(url);
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

  // Our own file (MP4/WebM under MEDIA_PUBLIC_BASE_URL), played with <video>.
  if (isOwnMediaUrl(u.href, "video")) return { provider: "file", id: u.pathname, embedUrl: u.href };

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

// ─── Upload (editor, browser) ───────────────────────────────────────────────

/** What GET /api/funnels/<id>/media answers (the editor's upload settings). */
export type MediaUploadConfig = {
  enabled: boolean;
  publicBaseUrl: string | null;
  maxImageBytes: number;
  maxVideoBytes: number;
};

/** A file already sent (GET .../media `files`). */
export type FunnelMediaItem = {
  id: string;
  url: string;
  kind: MediaKind;
  contentType: string;
  size: number;
  name: string | null;
  createdAt: string;
};

export type MediaUploadErrorCode = "media_type" | "media_too_large" | "network" | "canceled" | "server";

export class MediaUploadError extends Error {
  code: MediaUploadErrorCode;
  serverCode?: string;
  constructor(code: MediaUploadErrorCode, serverCode?: string) {
    super(code);
    this.code = code;
    this.serverCode = serverCode;
  }
}

export type UploadedMedia = { id: string | null; url: string; kind: MediaKind; contentType: string; size: number };

/** File upload of the editor. */
export interface MediaUploader {
  upload(
    file: Blob & { name?: string },
    opts: { kind: MediaKind; onProgress?: (fraction: number) => void; signal?: AbortSignal }
  ): Promise<UploadedMedia>;
}

type UploadUrlAnswer = { uploadUrl: string; publicUrl: string; headers: Record<string, string>; mediaId: string | null };

/**
 * The uploader of one funnel, or null when the server has no storage
 * configured (then the screens only ask for a link, as before).
 */
export function getMediaUploader(
  config?: (MediaUploadConfig & { funnelId: string; endpoint?: string }) | null
): MediaUploader | null {
  if (!config || !config.enabled || (!config.funnelId && !config.endpoint)) return null;
  // endpoint: another place that signs uploads (07/10/2026: the preview image
  // of a tracked link, /api/links/preview-image). Same answer shape.
  const base = config.endpoint ?? `/api/funnels/${encodeURIComponent(config.funnelId)}/media`;
  return {
    async upload(file, { kind, onProgress, signal }) {
      const check = checkMediaFile(file, kind);
      if (!check.ok) throw new MediaUploadError(check.code);
      if (signal?.aborted) throw new MediaUploadError("canceled");

      let answer: UploadUrlAnswer;
      try {
        const res = await fetch(`${base}/upload-url`, {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: check.contentType, size: file.size, kind, name: file.name?.slice(0, 120) || undefined }),
          signal,
        });
        const payload = (await res.json().catch(() => null)) as
          | { success: true; data: UploadUrlAnswer }
          | { success: false; details?: { code?: string } }
          | null;
        if (!payload || !payload.success) {
          const code = payload && !payload.success ? payload.details?.code : undefined;
          if (code === "media_type" || code === "media_too_large") throw new MediaUploadError(code);
          throw new MediaUploadError("server", code ?? `http_${res.status}`);
        }
        answer = payload.data;
      } catch (error) {
        if (error instanceof MediaUploadError) throw error;
        throw new MediaUploadError(signal?.aborted ? "canceled" : "network");
      }

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const onAbort = () => xhr.abort();
        xhr.open("PUT", answer.uploadUrl);
        for (const [k, v] of Object.entries(answer.headers ?? {})) xhr.setRequestHeader(k, v);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && e.total > 0) onProgress?.(Math.min(1, e.loaded / e.total));
        };
        xhr.onload = () => {
          signal?.removeEventListener("abort", onAbort);
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new MediaUploadError("server", `storage_${xhr.status}`));
        };
        xhr.onerror = () => reject(new MediaUploadError("network"));
        xhr.onabort = () => reject(new MediaUploadError("canceled"));
        if (signal?.aborted) {
          reject(new MediaUploadError("canceled"));
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        xhr.send(file);
      });
      onProgress?.(1);

      // Marks the file as sent (it shows in "already sent"). Failing here does not lose the upload.
      if (answer.mediaId) {
        await fetch(`${base}/${encodeURIComponent(answer.mediaId)}`, { method: "PATCH", cache: "no-store" }).catch(() => null);
      }
      return { id: answer.mediaId, url: answer.publicUrl, kind: check.kind, contentType: check.contentType, size: file.size };
    },
  };
}
