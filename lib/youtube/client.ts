/**
 * 23/10/2026: chamadas à YouTube Data API v3. Token com refresh automático,
 * upload resumable em partes (nunca o vídeo inteiro na memória) e o helper
 * `youtubeFetch` que o PR de comentários vai reaproveitar.
 */
import { prisma } from "@/lib/db/client";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import { readVideoRange } from "@/lib/social/common";
import { refreshYouTubeToken, YouTubeApiError, YouTubeAuthError, youtubeErrorFrom } from "@/lib/youtube/oauth";

export const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/youtube/v3/videos";
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** Partes do upload: múltiplo de 256 KiB, como o Google exige. */
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

export type YouTubeAccountRow = {
  id: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  status: string;
};

/** Access token válido (renova pelo refresh token quando falta pouco). */
export async function getYouTubeAccessToken(account: YouTubeAccountRow): Promise<string> {
  const expiring = !account.tokenExpiresAt || account.tokenExpiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS;
  if (!expiring) return decryptToken(account.accessToken);
  if (!account.refreshToken) throw new YouTubeAuthError("YouTube session expired. Connect the channel again.", "invalid_grant");
  try {
    const fresh = await refreshYouTubeToken(decryptToken(account.refreshToken));
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: {
        accessToken: encryptToken(fresh.accessToken),
        // O Google só devolve refresh token novo em alguns casos; senão mantém o antigo.
        ...(fresh.refreshToken ? { refreshToken: encryptToken(fresh.refreshToken) } : {}),
        tokenExpiresAt: new Date(Date.now() + fresh.expiresIn * 1000),
        status: "ACTIVE",
        lastError: null,
      },
    });
    return fresh.accessToken;
  } catch (error) {
    if (error instanceof YouTubeAuthError && error.needsReconnect) {
      await prisma.socialAccount.update({
        where: { id: account.id },
        data: { status: "NEEDS_RECONNECT", lastError: "YouTube session expired. Connect the channel again." },
      });
    }
    throw error;
  }
}

/**
 * GET/POST na YouTube Data API como o canal conectado. `path` começa em "/"
 * (ex.: "/channels?part=snippet&mine=true"). Renova o token se preciso e tenta
 * de novo uma vez se o Google responder 401. Lança YouTubeApiError com o motivo.
 */
export async function youtubeFetch<T = unknown>(
  account: YouTubeAccountRow,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const run = async (token: string) =>
    fetch(`${YOUTUBE_API}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

  let response = await run(await getYouTubeAccessToken(account));
  if (response.status === 401 && account.refreshToken) {
    // Token revogado ou vencido antes do previsto: força a renovação e repete uma vez.
    const forced = await getYouTubeAccessToken({ ...account, tokenExpiresAt: new Date(0) });
    response = await run(forced);
  }
  const text = await response.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!response.ok) throw youtubeErrorFrom(response.status, body);
  return body as T;
}

export interface YouTubeUploadInput {
  accessToken: string;
  mediaUrl: string;
  mediaBytes: number;
  mediaContentType: string;
  metadata: { snippet: Record<string, unknown>; status: Record<string, unknown> };
  /** Chamado assim que o upload termina, antes de qualquer outra coisa (evita publicar em dobro se o servidor cair). */
  onUploaded?: (videoId: string) => Promise<void>;
  chunkBytes?: number;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/** Upload resumable: abre a sessão, manda o vídeo em partes lidas do armazenamento e devolve o id do vídeo. */
export async function uploadYouTubeVideo(input: YouTubeUploadInput): Promise<string> {
  const total = input.mediaBytes;
  if (total <= 0) throw new Error("The video is empty");
  const init = await fetch(`${UPLOAD_API}?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(total),
      "X-Upload-Content-Type": input.mediaContentType,
    },
    body: JSON.stringify(input.metadata),
  });
  if (!init.ok) throw youtubeErrorFrom(init.status, await readJson(init));
  const session = init.headers.get("location");
  if (!session) throw new YouTubeApiError("YouTube did not open the upload session", 502);

  const chunk = input.chunkBytes ?? UPLOAD_CHUNK_BYTES;
  let offset = 0;
  while (offset < total) {
    const end = Math.min(offset + chunk, total) - 1;
    const bytes = await readVideoRange(input.mediaUrl, offset, end, offset === 0 && end === total - 1);
    const put = await fetch(session, {
      method: "PUT",
      headers: {
        "Content-Length": String(bytes.length),
        "Content-Range": `bytes ${offset}-${end}/${total}`,
        "Content-Type": input.mediaContentType,
      },
      body: new Uint8Array(bytes),
    });
    if (put.status === 308) {
      offset = end + 1;
      continue;
    }
    if (put.status === 200 || put.status === 201) {
      const video = (await readJson(put)) as { id?: string };
      if (!video.id) throw new YouTubeApiError("YouTube finished the upload without a video id", 502);
      if (input.onUploaded) await input.onUploaded(video.id);
      return video.id;
    }
    throw youtubeErrorFrom(put.status, await readJson(put));
  }
  throw new YouTubeApiError("YouTube did not confirm the upload", 502);
}
