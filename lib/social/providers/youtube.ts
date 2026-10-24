/**
 * YouTube: upload resumable pela Data API v3. O upload termina = publicado (o
 * YouTube segue processando a qualidade do vídeo por conta própria).
 */
import { z } from "zod";
import { commonMediaProblem } from "@/lib/social/common";
import { shortSettingsProblem } from "@/lib/social/channels";
import { NETWORK_LIMITS, YOUTUBE_TITLE_MAX } from "@/lib/social/limits";
import type { ProviderPost, PublishResult, ReadyProblem, SocialProvider } from "@/lib/social/types";
import { getYouTubeAccessToken, uploadYouTubeVideo } from "@/lib/youtube/client";
import { YOUTUBE_UPLOAD_SCOPE, YouTubeAuthError } from "@/lib/youtube/oauth";
import { prisma } from "@/lib/db/client";

export { YOUTUBE_TITLE_MAX };
export const YOUTUBE_DESCRIPTION_MAX = NETWORK_LIMITS.YOUTUBE.captionMax;
export const YOUTUBE_VIDEO_TYPES = NETWORK_LIMITS.YOUTUBE.videoTypes;
/** Limite de arquivo no Lead Engine (o YouTube aceita até 256 GB, mas o vídeo passa pelo nosso armazenamento). */
export const YOUTUBE_VIDEO_MAX_BYTES = NETWORK_LIMITS.YOUTUBE.maxBytes;
export const YOUTUBE_DEFAULT_CATEGORY = "22";

export const YOUTUBE_PRIVACY = ["private", "unlisted", "public"] as const;

const base = {
  title: z.string().trim().min(1).max(YOUTUBE_TITLE_MAX),
  privacyStatus: z.enum(YOUTUBE_PRIVACY),
  containsSyntheticMedia: z.boolean(),
  tags: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  categoryId: z.string().regex(/^\d{1,3}$/).optional(),
  /** "short" = YouTube Shorts (a API é a mesma; o YouTube classifica pelo vídeo). */
  format: z.enum(["video", "short"]).optional(),
  mediaWidth: z.number().int().positive().max(20000).optional(),
  mediaHeight: z.number().int().positive().max(20000).optional(),
  mediaSeconds: z.number().int().positive().max(86400).optional(),
};

/** Completo: sem valor padrão para "feito para crianças" (o criador precisa responder na tela). */
export const youtubeSettingsSchema = z.object({ ...base, selfDeclaredMadeForKids: z.boolean() }).strict();
export type YouTubeSettings = z.infer<typeof youtubeSettingsSchema>;

/** Rascunho: tudo opcional. */
export const youtubeDraftSettingsSchema = z
  .object({
    title: base.title.optional(),
    privacyStatus: base.privacyStatus.optional(),
    containsSyntheticMedia: base.containsSyntheticMedia.optional(),
    tags: base.tags,
    categoryId: base.categoryId,
    format: base.format,
    mediaWidth: base.mediaWidth,
    mediaHeight: base.mediaHeight,
    mediaSeconds: base.mediaSeconds,
    selfDeclaredMadeForKids: z.boolean().optional(),
  })
  .strict();

export const youtubeProvider: SocialProvider = {
  platform: "YOUTUBE",
  label: "YouTube",
  accountKind: "social",
  captionMax: YOUTUBE_DESCRIPTION_MAX,
  videoTypes: YOUTUBE_VIDEO_TYPES,
  maxBytes: YOUTUBE_VIDEO_MAX_BYTES,
  defaultSettings: { privacyStatus: "private", containsSyntheticMedia: false },
  draftSettingsSchema: youtubeDraftSettingsSchema,

  async readyProblem(post): Promise<ReadyProblem | null> {
    if (!post.socialAccount || post.socialAccount.status !== "ACTIVE") {
      return { message: "Connect the YouTube channel again first", code: "needs_reconnect" };
    }
    if (!post.socialAccount.scopes.includes(YOUTUBE_UPLOAD_SCOPE)) {
      return { message: "The YouTube channel did not allow uploads. Connect it again and accept every permission.", code: "missing_scope" };
    }
    const media = commonMediaProblem(this, post);
    if (media) return media;
    const parsed = youtubeSettingsSchema.safeParse(post.settings);
    if (!parsed.success) {
      const missingKids = !(post.settings as { selfDeclaredMadeForKids?: unknown } | null)?.selfDeclaredMadeForKids &&
        (post.settings as { selfDeclaredMadeForKids?: unknown } | null)?.selfDeclaredMadeForKids !== false;
      if (missingKids) return { message: "Say whether the video is made for kids", code: "invalid_settings" };
      return { message: "Finish the YouTube options (title and visibility)", code: "invalid_settings" };
    }
    const short = shortSettingsProblem(parsed.data);
    if (short) return { message: short, code: "invalid_settings" };
    return null;
  },

  async publish(post: ProviderPost, ctx): Promise<PublishResult> {
    const account = post.socialAccount;
    if (!account || account.status !== "ACTIVE") throw new Error("The YouTube channel is not connected. Connect it again.");
    const parsed = youtubeSettingsSchema.safeParse(post.settings);
    if (!parsed.success) throw new Error("The post options are incomplete.");
    const s = parsed.data;
    let accessToken: string;
    try {
      accessToken = await getYouTubeAccessToken(account);
    } catch (error) {
      if (error instanceof YouTubeAuthError) throw new Error("YouTube session expired. Connect the channel again.");
      throw error;
    }
    try {
      const videoId = await uploadYouTubeVideo({
        accessToken,
        mediaUrl: post.mediaUrl,
        mediaBytes: post.mediaBytes,
        mediaContentType: post.mediaContentType,
        metadata: {
          snippet: {
            title: s.title,
            description: post.caption,
            ...(s.tags && s.tags.length > 0 ? { tags: s.tags } : {}),
            categoryId: s.categoryId ?? YOUTUBE_DEFAULT_CATEGORY,
          },
          status: {
            privacyStatus: s.privacyStatus,
            selfDeclaredMadeForKids: s.selfDeclaredMadeForKids,
            containsSyntheticMedia: s.containsSyntheticMedia,
          },
        },
        onUploaded: (videoId) => ctx.savePublishId(videoId),
      });
      return { state: "published", publishId: videoId };
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403) {
        const reason = (error as { reason?: string }).reason;
        if (reason === "insufficientPermissions" || status === 401) {
          await prisma.socialAccount.update({
            where: { id: account.id },
            data: { status: "NEEDS_RECONNECT", lastError: "YouTube refused the access. Connect the channel again." },
          });
        }
      }
      throw error;
    }
  },
};
