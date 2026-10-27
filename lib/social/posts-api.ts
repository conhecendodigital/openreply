/** 23/10/2026: pedaços comuns das rotas /api/posts, para todas as redes. */
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { mediaUrlProblem } from "@/lib/social/common";
import { providerForPost } from "@/lib/social/providers";
import type { ReadyProblem, SocialProvider } from "@/lib/social/types";

export { mediaUrlProblem };
export type { ReadyProblem };

export const POST_INCLUDE = {
  socialAccount: { select: { displayName: true } },
  channel: { select: { username: true, name: true } },
} as const;

/** Maior legenda/descrição entre as redes (YouTube 5000). O limite de cada rede é conferido ao escolher a conta. */
export const CAPTION_ABSOLUTE_MAX = 5000;
/** Maior vídeo aceito no corpo (YouTube 2 GB); o limite de cada rede é conferido depois. */
export const VIDEO_ABSOLUTE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** Vídeos e, só para o carrossel do Instagram, imagens (cada rede confere o que aceita). */
export const VIDEO_ABSOLUTE_TYPES = ["video/mp4", "video/quicktime", "video/webm", "image/jpeg", "image/png"] as const;

export const mediaFields = {
  mediaUrl: z.string().trim().url().max(2000),
  mediaBytes: z.number().int().positive().max(VIDEO_ABSOLUTE_MAX_BYTES),
  mediaContentType: z.enum(VIDEO_ABSOLUTE_TYPES),
};

export const captionField = z.string().max(CAPTION_ABSOLUTE_MAX);

/** As opções variam por rede: o objeto chega livre e é validado pela rede da conta (validateDraftSettings). */
const settingsField = z.record(z.string(), z.unknown());

export const createPostSchema = z
  .object({
    socialAccountId: z.string().min(1).max(64),
    caption: captionField,
    ...mediaFields,
    settings: settingsField.optional(),
    scheduledAt: z.string().datetime().nullish(),
  })
  .strict();

export const updatePostSchema = z
  .object({
    socialAccountId: z.string().min(1).max(64).optional(),
    caption: captionField.optional(),
    mediaUrl: mediaFields.mediaUrl.optional(),
    mediaBytes: mediaFields.mediaBytes.optional(),
    mediaContentType: mediaFields.mediaContentType.optional(),
    settings: settingsField.optional(),
    scheduledAt: z.string().datetime().nullish(),
  })
  .strict();

/** Confere legenda, tipo e tamanho do vídeo contra a rede escolhida (rascunho também). */
export function mediaLimitsProblem(
  provider: SocialProvider,
  media: { caption?: string; mediaBytes?: number; mediaContentType?: string }
): string | null {
  if (media.caption !== undefined && media.caption.length > provider.captionMax) {
    return `The text is over the ${provider.label} limit of ${provider.captionMax} characters`;
  }
  const isImage = media.mediaContentType?.startsWith("image/") ?? false;
  if (isImage) {
    if (!provider.imageTypes?.includes(media.mediaContentType ?? "")) return `${provider.label} does not accept this file format`;
    if (media.mediaBytes !== undefined && media.mediaBytes > (provider.imageMaxBytes ?? 0)) {
      return `${provider.label} image limit is ${Math.round((provider.imageMaxBytes ?? 0) / (1024 * 1024))} MB in the Lead Engine`;
    }
    return null;
  }
  if (media.mediaContentType !== undefined && !provider.videoTypes.includes(media.mediaContentType)) {
    return `${provider.label} does not accept this video format`;
  }
  if (media.mediaBytes !== undefined && media.mediaBytes > provider.maxBytes) {
    return `${provider.label} video limit is ${Math.round(provider.maxBytes / (1024 * 1024))} MB in the Lead Engine`;
  }
  return null;
}

/** Valida as opções do rascunho pela regra da rede. Devolve as opções limpas ou os problemas. */
export function validateDraftSettings(provider: SocialProvider, settings: unknown): { ok: true; data: unknown } | { ok: false; issues: unknown[] } {
  const parsed = provider.draftSettingsSchema.safeParse(settings);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, issues: parsed.error.issues };
}

/**
 * Confere se o post pode ir (agendar ou publicar agora): conta, vídeo, legenda,
 * opções completas e as regras da rede. Com `checkRemote`, confere também o que
 * a rede permite agora (TikTok: privacidade pela conta).
 */
export async function readyProblem(
  post: Parameters<typeof providerForPost>[0] & {
    workspaceId: string;
    caption: string;
    mediaUrl: string;
    mediaBytes?: number;
    mediaContentType?: string;
    settings: unknown;
    id?: string;
  },
  checkRemote: boolean
): Promise<ReadyProblem | null> {
  const provider = providerForPost(post);
  return provider.readyProblem(
    { id: "", mediaBytes: 0, mediaContentType: "video/mp4", ...post } as Parameters<SocialProvider["readyProblem"]>[0],
    { checkRemote }
  );
}

export async function findPost(id: string, workspaceId: string) {
  return prisma.scheduledPost.findFirst({ where: { id, workspaceId }, include: { socialAccount: true, channel: true } });
}

export const EDITABLE = ["DRAFT", "SCHEDULED", "FAILED"] as const;
