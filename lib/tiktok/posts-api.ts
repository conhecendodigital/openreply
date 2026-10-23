/** 23/10/2026: pedaços comuns das rotas /api/posts. */
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { readMediaStorageConfig } from "@/lib/media/s3";
import { getValidAccessToken } from "@/lib/tiktok/publish";
import { queryCreatorInfo } from "@/lib/tiktok/client";
import {
  CAPTION_MAX,
  VIDEO_MAX_BYTES,
  VIDEO_TYPES,
  draftSettingsSchema,
  settingsProblem,
  tiktokSettingsSchema,
  type TikTokSettings,
} from "@/lib/tiktok/settings";

export const POST_INCLUDE = { socialAccount: { select: { displayName: true } } } as const;

export const mediaFields = {
  mediaUrl: z.string().trim().url().max(2000),
  mediaBytes: z.number().int().positive().max(VIDEO_MAX_BYTES),
  mediaContentType: z.enum(VIDEO_TYPES),
};

export const captionField = z.string().max(CAPTION_MAX);

export const createPostSchema = z
  .object({
    socialAccountId: z.string().min(1).max(64),
    caption: captionField,
    ...mediaFields,
    settings: draftSettingsSchema.optional(),
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
    settings: draftSettingsSchema.optional(),
    scheduledAt: z.string().datetime().nullish(),
  })
  .strict();

/** O vídeo tem que estar no nosso armazenamento, na pasta deste workspace (o servidor baixa esse endereço). */
export function mediaUrlProblem(workspaceId: string, mediaUrl: string): string | null {
  const config = readMediaStorageConfig();
  if (!config) return "Video storage is not configured on this server";
  const prefix = `${config.publicBaseUrl}/${workspaceId}/posts/`;
  return mediaUrl.startsWith(prefix) ? null : "The video must be uploaded through the Lead Engine";
}

export type ReadyProblem = { message: string; code: string };

/**
 * Confere se o post pode ir (agendar ou publicar agora): legenda, vídeo,
 * opções completas e as regras do TikTok. Com `checkCreator`, confere também
 * a privacidade contra o que a conta do TikTok permite agora.
 */
export async function readyProblem(
  post: { caption: string; mediaUrl: string; settings: unknown; workspaceId: string; socialAccount: Parameters<typeof getValidAccessToken>[0] & { status: string } },
  checkCreator: boolean
): Promise<ReadyProblem | null> {
  if (post.socialAccount.status !== "ACTIVE") return { message: "Connect the TikTok account again first", code: "needs_reconnect" };
  const urlProblem = mediaUrlProblem(post.workspaceId, post.mediaUrl);
  if (urlProblem) return { message: urlProblem, code: "invalid_media" };
  const parsed = tiktokSettingsSchema.safeParse(post.settings);
  if (!parsed.success) return { message: "Pick who can see the video and finish the options", code: "invalid_settings" };
  const settings: TikTokSettings = parsed.data;
  const problem = settingsProblem(settings);
  if (problem) return { message: problem, code: "invalid_settings" };
  if (checkCreator) {
    try {
      const token = await getValidAccessToken(post.socialAccount);
      const info = await queryCreatorInfo(token);
      if (!info.privacyLevelOptions.includes(settings.privacyLevel)) {
        return { message: "The TikTok account does not allow this privacy option now", code: "privacy_not_allowed" };
      }
      if ((settings.allowComment && info.commentDisabled) || (settings.allowDuet && info.duetDisabled) || (settings.allowStitch && info.stitchDisabled)) {
        return { message: "The TikTok account turned off comments, duet or stitch", code: "interaction_disabled" };
      }
    } catch (error) {
      // Conta recusou o acesso: o aviso é claro. Falha passageira da API não trava o agendamento.
      const code = (error as { isAuth?: boolean; needsReconnect?: boolean })?.isAuth || (error as { needsReconnect?: boolean })?.needsReconnect;
      if (code) return { message: "Connect the TikTok account again first", code: "needs_reconnect" };
    }
  }
  return null;
}

export async function findPost(id: string, workspaceId: string) {
  return prisma.scheduledPost.findFirst({ where: { id, workspaceId }, include: { socialAccount: true } });
}

export const EDITABLE = ["DRAFT", "SCHEDULED", "FAILED"] as const;
