import { readMediaStorageConfig } from "@/lib/media/s3";
import type { ReadyProblem, SocialProvider, ProviderPost } from "@/lib/social/types";

export function describe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

/** O vídeo tem que estar no nosso armazenamento, na pasta deste workspace (o servidor baixa esse endereço). */
export function mediaUrlProblem(workspaceId: string, mediaUrl: string): string | null {
  const config = readMediaStorageConfig();
  if (!config) return "Video storage is not configured on this server";
  const prefix = `${config.publicBaseUrl}/${workspaceId}/posts/`;
  return mediaUrl.startsWith(prefix) ? null : "The video must be uploaded through the Lead Engine";
}

/** Regras comuns a toda rede: vídeo nosso, tipo e tamanho aceitos, legenda dentro do limite. */
export function commonMediaProblem(provider: SocialProvider, post: ProviderPost): ReadyProblem | null {
  const urlProblem = mediaUrlProblem(post.workspaceId, post.mediaUrl);
  if (urlProblem) return { message: urlProblem, code: "invalid_media" };
  if (!provider.videoTypes.includes(post.mediaContentType)) {
    return { message: `${provider.label} does not accept this video format`, code: "invalid_media" };
  }
  if (post.mediaBytes > provider.maxBytes) {
    return { message: `${provider.label} video limit is ${Math.round(provider.maxBytes / (1024 * 1024))} MB in the Lead Engine`, code: "invalid_media" };
  }
  if (post.caption.length > provider.captionMax) {
    return { message: `The text is over the ${provider.label} limit of ${provider.captionMax} characters`, code: "invalid_caption" };
  }
  return null;
}

/** Quem pediu a conexão de novo: o aviso na conta e a mensagem do post dizem a mesma coisa. */
export function reconnectMessage(provider: SocialProvider): string {
  return `${provider.label} refused the access. Connect the account again.`;
}

export class VideoReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoReadError";
  }
}

/** Lê um pedaço do vídeo guardado (Range). Uma parte por vez na memória, nunca o arquivo inteiro. */
export async function readVideoRange(mediaUrl: string, start: number, end: number, wholeFile: boolean): Promise<Buffer> {
  const source = await fetch(mediaUrl, { headers: { Range: `bytes=${start}-${end}` } });
  if (source.status !== 206 && !(source.status === 200 && wholeFile)) {
    throw new VideoReadError(`Could not read the video from storage (${source.status})`);
  }
  const bytes = Buffer.from(await source.arrayBuffer());
  if (bytes.length !== end - start + 1) throw new VideoReadError("The video from storage has a different size than expected");
  return bytes;
}
