/**
 * Instagram Reels pela API oficial de publicação: cria o container com o
 * vídeo (a Meta baixa o nosso endereço público), espera ficar FINISHED (o cron
 * confere a cada 5 minutos) e só então publica.
 */
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { PermissionError } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { commonMediaProblem } from "@/lib/social/common";
import { NETWORK_LIMITS } from "@/lib/social/limits";
import { explainMetaError, graphCall } from "@/lib/social/meta-graph";
import type { CheckResult, ProviderPost, PublishResult, ReadyProblem, SocialProvider } from "@/lib/social/types";

export const INSTAGRAM_CAPTION_MAX = NETWORK_LIMITS.INSTAGRAM.captionMax;
export const INSTAGRAM_VIDEO_TYPES = NETWORK_LIMITS.INSTAGRAM.videoTypes;
/** Limite do arquivo de Reel na API de publicação (conferir na documentação da Meta se mudar). */
export const INSTAGRAM_VIDEO_MAX_BYTES = NETWORK_LIMITS.INSTAGRAM.maxBytes;

export const instagramSettingsSchema = z.object({ shareToFeed: z.boolean() }).strict();
export type InstagramSettings = z.infer<typeof instagramSettingsSchema>;

function needChannel(post: ProviderPost) {
  const channel = post.channel;
  if (!channel || channel.status !== "ACTIVE") throw new Error("The Instagram account is not connected. Connect it again in Channels.");
  return channel;
}

async function markNeedsReconnect(channelId: string) {
  await prisma.instagramAccount.update({ where: { id: channelId }, data: { status: "NEEDS_RECONNECT" } });
}

export const instagramProvider: SocialProvider = {
  platform: "INSTAGRAM",
  label: "Instagram",
  accountKind: "channel",
  captionMax: INSTAGRAM_CAPTION_MAX,
  videoTypes: INSTAGRAM_VIDEO_TYPES,
  maxBytes: INSTAGRAM_VIDEO_MAX_BYTES,
  defaultSettings: { shareToFeed: true },
  draftSettingsSchema: instagramSettingsSchema,

  async readyProblem(post): Promise<ReadyProblem | null> {
    if (!post.channel || post.channel.status !== "ACTIVE") return { message: "Connect the Instagram account again first", code: "needs_reconnect" };
    const media = commonMediaProblem(this, post);
    if (media) return media;
    if (!instagramSettingsSchema.safeParse(post.settings).success) return { message: "Finish the Reels options", code: "invalid_settings" };
    return null;
  },

  async publish(post, ctx): Promise<PublishResult> {
    const channel = needChannel(post);
    const parsed = instagramSettingsSchema.safeParse(post.settings);
    if (!parsed.success) throw new Error("The post options are incomplete.");
    const token = decryptToken(channel.accessToken);
    try {
      const container = await graphCall<{ id: string }>(token, "POST", `/${channel.instagramId}/media`, {
        media_type: "REELS",
        video_url: post.mediaUrl,
        caption: post.caption,
        share_to_feed: parsed.data.shareToFeed,
      });
      await ctx.savePublishId(container.id);
      // A Meta baixa e processa o vídeo; a confirmação e a publicação saem no check.
      return { state: "waiting", publishId: container.id };
    } catch (error) {
      const failure = explainMetaError(error, "Instagram");
      if (failure.needsReconnect) await markNeedsReconnect(channel.id);
      throw new Error(failure.message);
    }
  },

  async check(post): Promise<CheckResult> {
    const channel = needChannel(post);
    const token = decryptToken(channel.accessToken);
    try {
      const status = await graphCall<{ status_code?: string; status?: string }>(token, "GET", `/${post.publishId}`, {
        fields: "status_code,status",
      });
      if (status.status_code === "FINISHED") {
        const published = await graphCall<{ id: string }>(token, "POST", `/${channel.instagramId}/media_publish`, {
          creation_id: post.publishId ?? "",
        });
        return { state: "published", publishId: published.id };
      }
      if (status.status_code === "PUBLISHED") return { state: "published" };
      if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
        return { state: "failed", message: `Instagram could not process the video${status.status ? `: ${status.status}` : ""}`.slice(0, 500) };
      }
      return { state: "waiting" };
    } catch (error) {
      const failure = explainMetaError(error, "Instagram");
      if (failure.needsReconnect) {
        await markNeedsReconnect(channel.id);
        return { state: "failed", message: failure.message };
      }
      if (error instanceof PermissionError) return { state: "failed", message: failure.message };
      throw error;
    }
  },
};
