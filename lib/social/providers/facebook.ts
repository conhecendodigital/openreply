/** Vídeo em Página do Facebook: POST /{page-id}/videos com file_url (a Meta baixa o nosso endereço público). */
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import { commonMediaProblem } from "@/lib/social/common";
import { FACEBOOK_TITLE_MAX, NETWORK_LIMITS } from "@/lib/social/limits";
import { explainMetaError, graphCall } from "@/lib/social/meta-graph";
import type { CheckResult, ProviderPost, PublishResult, ReadyProblem, SocialProvider } from "@/lib/social/types";

export { FACEBOOK_TITLE_MAX };
export const FACEBOOK_CAPTION_MAX = NETWORK_LIMITS.FACEBOOK.captionMax;
export const FACEBOOK_VIDEO_TYPES = NETWORK_LIMITS.FACEBOOK.videoTypes;
export const FACEBOOK_VIDEO_MAX_BYTES = NETWORK_LIMITS.FACEBOOK.maxBytes;

export const facebookSettingsSchema = z.object({ title: z.string().max(FACEBOOK_TITLE_MAX) }).strict();

function needChannel(post: ProviderPost) {
  const channel = post.channel;
  if (!channel || channel.status !== "ACTIVE") throw new Error("The Facebook Page is not connected. Connect it again in Channels.");
  return channel;
}

async function markNeedsReconnect(channelId: string) {
  await prisma.instagramAccount.update({ where: { id: channelId }, data: { status: "NEEDS_RECONNECT" } });
}

export const facebookProvider: SocialProvider = {
  platform: "FACEBOOK",
  label: "Facebook",
  accountKind: "channel",
  captionMax: FACEBOOK_CAPTION_MAX,
  videoTypes: FACEBOOK_VIDEO_TYPES,
  maxBytes: FACEBOOK_VIDEO_MAX_BYTES,
  defaultSettings: { title: "" },
  draftSettingsSchema: facebookSettingsSchema,

  async readyProblem(post): Promise<ReadyProblem | null> {
    if (!post.channel || post.channel.status !== "ACTIVE") return { message: "Connect the Facebook Page again first", code: "needs_reconnect" };
    const media = commonMediaProblem(this, post);
    if (media) return media;
    if (!facebookSettingsSchema.safeParse(post.settings).success) return { message: "Finish the video options", code: "invalid_settings" };
    return null;
  },

  async publish(post, ctx): Promise<PublishResult> {
    const channel = needChannel(post);
    const parsed = facebookSettingsSchema.safeParse(post.settings);
    if (!parsed.success) throw new Error("The post options are incomplete.");
    const token = decryptToken(channel.accessToken);
    try {
      const video = await graphCall<{ id: string }>(token, "POST", `/${channel.instagramId}/videos`, {
        file_url: post.mediaUrl,
        description: post.caption,
        title: parsed.data.title.trim() || undefined,
        published: true,
      });
      await ctx.savePublishId(video.id);
      // O Facebook ainda processa o vídeo; o cron confere até ficar pronto.
      return { state: "waiting", publishId: video.id };
    } catch (error) {
      const failure = explainMetaError(error, "Facebook");
      if (failure.needsReconnect) await markNeedsReconnect(channel.id);
      throw new Error(failure.message);
    }
  },

  async check(post): Promise<CheckResult> {
    const channel = needChannel(post);
    const token = decryptToken(channel.accessToken);
    try {
      const video = await graphCall<{ status?: { video_status?: string } }>(token, "GET", `/${post.publishId}`, { fields: "status" });
      const state = video.status?.video_status;
      if (state === "ready") return { state: "published" };
      if (state === "error") return { state: "failed", message: "Facebook could not process the video" };
      return { state: "waiting" };
    } catch (error) {
      const failure = explainMetaError(error, "Facebook");
      if (failure.needsReconnect) {
        await markNeedsReconnect(channel.id);
        return { state: "failed", message: failure.message };
      }
      throw error;
    }
  },
};
