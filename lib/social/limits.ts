/**
 * 23/10/2026: limites de cada rede da aba Posts, num arquivo sem servidor para a tela e os
 * providers lerem do mesmo lugar. Mudou a regra da rede: muda aqui.
 */
import { SOCIAL_PLATFORMS, type SocialPlatform } from "@/lib/social/types";

const MB = 1024 * 1024;
const GB = 1024 * MB;

export interface NetworkLimits {
  /** Legenda (TikTok, Instagram, Facebook) ou descrição (YouTube). */
  captionMax: number;
  videoTypes: readonly string[];
  maxBytes: number;
}

export const YOUTUBE_TITLE_MAX = 100;
export const FACEBOOK_TITLE_MAX = 255;

export const NETWORK_LIMITS: Record<SocialPlatform, NetworkLimits> = {
  TIKTOK: { captionMax: 2200, videoTypes: ["video/mp4", "video/quicktime", "video/webm"], maxBytes: 1 * GB },
  // O YouTube aceita até 256 GB, mas o vídeo passa pelo nosso armazenamento.
  YOUTUBE: { captionMax: 5000, videoTypes: ["video/mp4", "video/quicktime", "video/webm"], maxBytes: 2 * GB },
  // Limite do arquivo de Reel na API de publicação (conferir na documentação da Meta se mudar).
  INSTAGRAM: { captionMax: 2200, videoTypes: ["video/mp4", "video/quicktime"], maxBytes: 300 * MB },
  FACEBOOK: { captionMax: 5000, videoTypes: ["video/mp4", "video/quicktime"], maxBytes: 1 * GB },
};

/** Maior arquivo que o envio aceita: cada rede confere o seu limite na hora de agendar. */
export const UPLOAD_MAX_BYTES = Math.max(...SOCIAL_PLATFORMS.map((p) => NETWORK_LIMITS[p].maxBytes));
export const UPLOAD_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;
