/**
 * 27/10/2026: cliente mínimo da API da Zernio (https://zernio.com/api/v1).
 * Só o que o TikTok precisa: criar post (POST /posts), ler post (GET /posts/{id})
 * e enviar arquivo grande (POST /media/presign + PUT). A chave vem de
 * process.env.ZERNIO_API_KEY e é varrida de qualquer mensagem de erro.
 */
import { ZERNIO_BASE_URL, zernioApiKey } from "@/lib/zernio/config";

const TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

export class ZernioApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly existingPostId?: string
  ) {
    super(message);
    this.name = "ZernioApiError";
  }
}

/** Tira a chave (e qualquer "Bearer xxx") de um texto antes de ele virar erro ou log. */
export function scrub(text: string): string {
  let out = text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***");
  const key = zernioApiKey();
  if (key) out = out.split(key).join("***");
  return out;
}

function requireKey(): string {
  const key = zernioApiKey();
  if (!key) throw new ZernioApiError("ZERNIO_API_KEY is not set on the server", 0, "no_api_key");
  return key;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

/** A Zernio devolve o erro em formatos variados; pega o texto mais útil sem confiar no formato. */
function errorFrom(body: unknown): { message: string; code?: string; existingPostId?: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const inner = (b.error && typeof b.error === "object" ? b.error : {}) as Record<string, unknown>;
  const details = (b.details && typeof b.details === "object" ? b.details : {}) as Record<string, unknown>;
  const message = str(b.message) ?? str(inner.message) ?? str(b.error) ?? str(inner.error) ?? str(b.detail) ?? "";
  const code = str(b.code) ?? str(inner.code) ?? (typeof b.error === "string" ? b.error : undefined);
  const existingPostId = str(b.existingPostId) ?? str(details.existingPostId) ?? str(inner.existingPostId);
  return { message, code, existingPostId };
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = requireKey();
  let res: Response;
  try {
    res = await fetch(`${ZERNIO_BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "leadengine-zernio/1" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new ZernioApiError(scrub(`Could not reach Zernio: ${error instanceof Error ? error.message : String(error)}`).slice(0, 300), 0, "network");
  }
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const e = errorFrom(json);
    const detail = scrub(e.message || text.slice(0, 200)).slice(0, 300);
    throw new ZernioApiError(`Zernio ${res.status}${e.code ? ` (${scrub(e.code)})` : ""}: ${detail}`.trim(), res.status, e.code, e.existingPostId);
  }
  return json as T;
}

export interface ZernioTikTokPostInput {
  content: string;
  accountId: string;
  mediaUrl: string;
  draft: boolean;
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  isAigc: boolean;
  dryRun?: boolean;
}

function postBody(input: ZernioTikTokPostInput): Record<string, unknown> {
  const tiktokSettings: Record<string, unknown> = input.draft
    ? { draft: true }
    : {
        privacy_level: "PUBLIC_TO_EVERYONE",
        allow_comment: input.allowComment,
        allow_duet: input.allowDuet,
        allow_stitch: input.allowStitch,
        commercial_content_type: "none",
        content_preview_confirmed: true,
        express_consent_given: true,
        media_type: "video",
        video_made_with_ai: input.isAigc,
      };
  return {
    content: input.content,
    platforms: [{ platform: "tiktok", accountId: input.accountId }],
    mediaItems: [{ type: "video", url: input.mediaUrl }],
    publishNow: true,
    tiktokSettings,
    ...(input.dryRun ? { dryRun: true } : {}),
  };
}

function pick(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Cria o post. Devolve o id da Zernio (guardado como publishId). */
export async function createTikTokPost(input: ZernioTikTokPostInput): Promise<{ postId: string }> {
  const res = await call<unknown>("POST", "/posts", postBody(input));
  const id = str(pick(res, "post", "_id")) ?? str(pick(res, "post", "id")) ?? str(pick(res, "_id")) ?? str(pick(res, "id")) ?? str(pick(res, "data", "_id")) ?? str(pick(res, "data", "id"));
  if (!id) throw new ZernioApiError("Zernio accepted the post but did not return its id", 200, "no_post_id");
  return { postId: id };
}

/** dryRun: valida sem publicar. */
export async function dryRunTikTokPost(input: ZernioTikTokPostInput): Promise<{ canPublish: boolean }> {
  const res = await call<unknown>("POST", "/posts", postBody({ ...input, dryRun: true }));
  const can = pick(res, "canPublish") ?? pick(res, "data", "canPublish");
  // Só bloqueia quando a Zernio diz explicitamente que não dá; formato desconhecido não trava o post.
  return { canPublish: can !== false };
}

export type ZernioPostState =
  | { state: "published"; platformPostId?: string; inbox: boolean }
  | { state: "failed"; message: string }
  | { state: "waiting" };

/** GET /posts/{id}: platforms[0].status (uploading -> published) e platformPostId (v_pub_url~ público, v_inbox_url~ rascunho). */
export async function getPostState(postId: string): Promise<ZernioPostState> {
  const res = await call<unknown>("GET", `/posts/${encodeURIComponent(postId)}`);
  const post = (pick(res, "post") ?? pick(res, "data") ?? res) as Record<string, unknown>;
  const platforms = Array.isArray(post?.platforms) ? (post.platforms as Record<string, unknown>[]) : [];
  const p = platforms[0] ?? {};
  const platformStatus = (str(p.status) ?? "").toLowerCase();
  const postStatus = (str(post?.status) ?? "").toLowerCase();
  const platformPostId = str(p.platformPostId);
  const errorText = str(p.errorMessage) ?? str(p.error) ?? str(p.message) ?? str(post?.errorMessage) ?? str(post?.error);

  if (platformStatus === "failed" || (!platformStatus && postStatus === "failed")) {
    return { state: "failed", message: scrub(errorText ?? "Zernio could not publish the video to TikTok").slice(0, 400) };
  }
  if (platformStatus === "published") {
    return { state: "published", platformPostId, inbox: Boolean(platformPostId?.startsWith("v_inbox_url")) };
  }
  return { state: "waiting" };
}

/** Arquivo grande: pede um endereço de envio, manda o vídeo (em fluxo, sem carregar tudo na memória) e devolve a URL pública (vale 1 h). */
export async function uploadViaPresign(source: { url: string; filename: string; contentType: string; bytes: number }): Promise<string> {
  const presign = await call<unknown>("POST", "/media/presign", { filename: source.filename, contentType: source.contentType });
  const uploadUrl = str(pick(presign, "uploadUrl"));
  const publicUrl = str(pick(presign, "publicUrl"));
  if (!uploadUrl || !publicUrl) throw new ZernioApiError("Zernio did not return an upload address", 200, "no_upload_url");
  let video: Response;
  try {
    video = await fetch(source.url, { signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
  } catch (error) {
    throw new ZernioApiError(scrub(`Could not read the video from storage: ${error instanceof Error ? error.message : String(error)}`).slice(0, 300), 0, "storage_read");
  }
  if (!video.ok || !video.body) throw new ZernioApiError(`Could not read the video from storage (${video.status})`, video.status, "storage_read");
  let put: Response;
  try {
    put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": source.contentType, "Content-Length": String(source.bytes) },
      body: video.body,
      // @ts-expect-error duplex é exigido pelo Node para corpo em fluxo e ainda não está nos tipos do DOM.
      duplex: "half",
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ZernioApiError(scrub(`Could not send the video to Zernio: ${error instanceof Error ? error.message : String(error)}`).slice(0, 300), 0, "network");
  }
  if (!put.ok) throw new ZernioApiError(`Zernio upload failed (${put.status})`, put.status, "upload_failed");
  return publicUrl;
}
