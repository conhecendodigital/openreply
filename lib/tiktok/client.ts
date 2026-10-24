/**
 * 23/10/2026: Content Posting API do TikTok (Direct Post, envio do arquivo em
 * partes). Implementação própria a partir da documentação pública.
 * Contas ainda não auditadas só publicam como SELF_ONLY.
 */
const API = "https://open.tiktokapis.com";

export class TikTokApiError extends Error {
  constructor(message: string, readonly code: string | undefined, readonly status: number) {
    super(message);
    this.name = "TikTokApiError";
  }
  /** Token recusado: refresh ou reconectar resolve. */
  get isAuth(): boolean {
    return this.status === 401 || this.code === "access_token_invalid" || this.code === "scope_not_authorized";
  }
}

interface ApiEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string; log_id?: string };
}

async function call<T>(path: string, accessToken: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  const code = json.error?.code;
  if (!response.ok || (code && code !== "ok")) {
    throw new TikTokApiError(json.error?.message || `TikTok API error (${response.status})`, code, response.status);
  }
  return (json.data ?? ({} as T)) as T;
}

export interface TikTokCreatorInfo {
  nickname: string;
  username: string;
  avatarUrl: string | null;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
}

export async function queryCreatorInfo(accessToken: string): Promise<TikTokCreatorInfo> {
  const data = await call<{
    creator_nickname?: string;
    creator_username?: string;
    creator_avatar_url?: string;
    privacy_level_options?: string[];
    comment_disabled?: boolean;
    duet_disabled?: boolean;
    stitch_disabled?: boolean;
    max_video_post_duration_sec?: number;
  }>("/v2/post/publish/creator_info/query/", accessToken);
  return {
    nickname: data.creator_nickname ?? "",
    username: data.creator_username ?? "",
    avatarUrl: data.creator_avatar_url ?? null,
    privacyLevelOptions: data.privacy_level_options ?? [],
    commentDisabled: Boolean(data.comment_disabled),
    duetDisabled: Boolean(data.duet_disabled),
    stitchDisabled: Boolean(data.stitch_disabled),
    maxVideoPostDurationSec: data.max_video_post_duration_sec ?? 0,
  };
}

const MB = 1024 * 1024;

/** Partes do arquivo: 5 a 64 MB cada (a última pode ter até 128 MB). Arquivo até 64 MB vai de uma vez. */
export function planChunks(videoSize: number): { chunkSize: number; totalChunks: number } {
  if (videoSize <= 64 * MB) return { chunkSize: videoSize, totalChunks: 1 };
  const chunkSize = 32 * MB;
  return { chunkSize, totalChunks: Math.floor(videoSize / chunkSize) };
}

export interface DirectPostInput {
  title: string;
  privacyLevel: string;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  brandContentToggle: boolean;
  brandOrganicToggle: boolean;
  isAigc: boolean;
  videoSize: number;
}

export async function initDirectPost(
  accessToken: string,
  input: DirectPostInput
): Promise<{ publishId: string; uploadUrl: string; chunkSize: number; totalChunks: number }> {
  const { chunkSize, totalChunks } = planChunks(input.videoSize);
  const data = await call<{ publish_id?: string; upload_url?: string }>("/v2/post/publish/video/init/", accessToken, {
    post_info: {
      title: input.title,
      privacy_level: input.privacyLevel,
      disable_duet: input.disableDuet,
      disable_comment: input.disableComment,
      disable_stitch: input.disableStitch,
      brand_content_toggle: input.brandContentToggle,
      brand_organic_toggle: input.brandOrganicToggle,
      is_aigc: input.isAigc,
    },
    source_info: {
      source: "FILE_UPLOAD",
      video_size: input.videoSize,
      chunk_size: chunkSize,
      total_chunk_count: totalChunks,
    },
  });
  if (!data.publish_id || !data.upload_url) throw new TikTokApiError("TikTok did not return an upload address", undefined, 502);
  return { publishId: data.publish_id, uploadUrl: data.upload_url, chunkSize, totalChunks };
}

/**
 * Baixa o vídeo do nosso armazenamento e manda em partes pro TikTok. Uma
 * parte por vez na memória (32 MB), nunca o arquivo inteiro.
 */
export async function uploadVideoInChunks(opts: {
  uploadUrl: string;
  mediaUrl: string;
  contentType: string;
  videoSize: number;
  chunkSize: number;
  totalChunks: number;
}): Promise<void> {
  for (let index = 0; index < opts.totalChunks; index += 1) {
    const start = index * opts.chunkSize;
    const isLast = index === opts.totalChunks - 1;
    const end = isLast ? opts.videoSize - 1 : start + opts.chunkSize - 1;
    const source = await fetch(opts.mediaUrl, { headers: { Range: `bytes=${start}-${end}` } });
    if (source.status !== 206 && !(source.status === 200 && opts.totalChunks === 1)) {
      throw new TikTokApiError(`Could not read the video from storage (${source.status})`, undefined, 502);
    }
    const bytes = Buffer.from(await source.arrayBuffer());
    if (bytes.length !== end - start + 1) {
      throw new TikTokApiError("The video from storage has a different size than expected", undefined, 502);
    }
    const put = await fetch(opts.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": opts.contentType,
        "Content-Length": String(bytes.length),
        "Content-Range": `bytes ${start}-${end}/${opts.videoSize}`,
      },
      body: bytes,
    });
    // 206 = parte aceita, falta mais; 201 = última parte aceita.
    if (put.status !== 206 && put.status !== 201 && put.status !== 200) {
      throw new TikTokApiError(`TikTok rejected the upload (${put.status})`, undefined, put.status);
    }
  }
}

export type TikTokPublishState = "PROCESSING_UPLOAD" | "PROCESSING_DOWNLOAD" | "SEND_TO_USER_INBOX" | "PUBLISH_COMPLETE" | "FAILED";

export async function fetchPublishStatus(
  accessToken: string,
  publishId: string
): Promise<{ state: TikTokPublishState; failReason: string | null; postId: string | null }> {
  const data = await call<{ status?: string; fail_reason?: string; publicaly_available_post_id?: Array<string | number> }>(
    "/v2/post/publish/status/fetch/",
    accessToken,
    { publish_id: publishId }
  );
  return {
    state: (data.status as TikTokPublishState) ?? "PROCESSING_UPLOAD",
    failReason: data.fail_reason ?? null,
    postId: data.publicaly_available_post_id?.[0] != null ? String(data.publicaly_available_post_id[0]) : null,
  };
}
