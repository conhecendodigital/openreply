/** TikTok (Direct Post): as regras de privacidade, consentimento e conteúdo comercial não mudam. */
import { prisma } from "@/lib/db/client";
import { commonMediaProblem } from "@/lib/social/common";
import type { CheckResult, ProviderPost, PublishResult, ReadyProblem, SocialProvider } from "@/lib/social/types";
import { fetchPublishStatus, initDirectPost, queryCreatorInfo, TikTokApiError, uploadVideoInChunks } from "@/lib/tiktok/client";
import {
  CAPTION_MAX,
  DEFAULT_TIKTOK_SETTINGS,
  VIDEO_MAX_BYTES,
  VIDEO_TYPES,
  draftSettingsSchema,
  settingsProblem,
  tiktokSettingsSchema,
  type TikTokSettings,
} from "@/lib/tiktok/settings";
import { getValidAccessToken } from "@/lib/tiktok/token";

function needAccount(post: ProviderPost) {
  if (!post.socialAccount) throw new Error("The TikTok account is not connected. Connect it again.");
  return post.socialAccount;
}

export const tiktokProvider: SocialProvider = {
  platform: "TIKTOK",
  label: "TikTok",
  accountKind: "social",
  captionMax: CAPTION_MAX,
  videoTypes: VIDEO_TYPES,
  maxBytes: VIDEO_MAX_BYTES,
  defaultSettings: DEFAULT_TIKTOK_SETTINGS,
  draftSettingsSchema,
  confirmTimeoutMs: 2 * 60 * 60 * 1000,

  async readyProblem(post, { checkRemote }): Promise<ReadyProblem | null> {
    const account = post.socialAccount;
    if (!account || account.status !== "ACTIVE") return { message: "Connect the TikTok account again first", code: "needs_reconnect" };
    const media = commonMediaProblem(this, post);
    if (media) return media;
    const parsed = tiktokSettingsSchema.safeParse(post.settings);
    if (!parsed.success) return { message: "Pick who can see the video and finish the options", code: "invalid_settings" };
    const settings: TikTokSettings = parsed.data;
    const problem = settingsProblem(settings);
    if (problem) return { message: problem, code: "invalid_settings" };
    if (checkRemote) {
      try {
        const token = await getValidAccessToken(account);
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
  },

  async publish(post, ctx): Promise<PublishResult> {
    const account = needAccount(post);
    if (account.status !== "ACTIVE") throw new Error("The TikTok account is not connected. Connect it again.");
    const parsed = tiktokSettingsSchema.safeParse(post.settings);
    if (!parsed.success) throw new Error("The post options are incomplete.");
    const problem = settingsProblem(parsed.data);
    if (problem) throw new Error(problem);
    const settings = parsed.data;
    try {
      const accessToken = await getValidAccessToken(account);
      const init = await initDirectPost(accessToken, {
        title: post.caption,
        privacyLevel: settings.privacyLevel,
        disableComment: !settings.allowComment,
        disableDuet: !settings.allowDuet,
        disableStitch: !settings.allowStitch,
        brandContentToggle: settings.commercial.enabled && settings.commercial.brandedContent,
        brandOrganicToggle: settings.commercial.enabled && settings.commercial.yourBrand,
        isAigc: settings.isAigc,
        videoSize: post.mediaBytes,
      });
      await ctx.savePublishId(init.publishId);
      await uploadVideoInChunks({
        uploadUrl: init.uploadUrl,
        mediaUrl: post.mediaUrl,
        contentType: post.mediaContentType,
        videoSize: post.mediaBytes,
        chunkSize: init.chunkSize,
        totalChunks: init.totalChunks,
      });
      // A confirmação final chega pelo cron (check).
      return { state: "waiting", publishId: init.publishId };
    } catch (error) {
      if (error instanceof TikTokApiError && error.isAuth) {
        await prisma.socialAccount.update({
          where: { id: account.id },
          data: { status: "NEEDS_RECONNECT", lastError: "TikTok refused the access. Connect the account again." },
        });
      }
      throw error;
    }
  },

  async check(post): Promise<CheckResult> {
    const account = needAccount(post);
    const accessToken = await getValidAccessToken(account);
    const result = await fetchPublishStatus(accessToken, post.publishId ?? "");
    if (result.state === "PUBLISH_COMPLETE") return { state: "published" };
    if (result.state === "FAILED") return { state: "failed", message: result.failReason || "TikTok could not publish the video" };
    return { state: "waiting" };
  },
};
