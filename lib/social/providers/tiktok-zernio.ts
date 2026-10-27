/**
 * 27/10/2026: TikTok publicado pela Zernio (zernio.com), ligado por TIKTOK_VIA_ZERNIO=1.
 * O app próprio do Lead Engine não é auditado pelo TikTok (só publica "Só eu" em conta
 * privada). A conta conectada pela Zernio publica vídeo PÚBLICO ou manda RASCUNHO pro
 * app do TikTok. Mesmas colunas do post: reaproveita o formato de settings do TikTok,
 * onde privacyLevel "PUBLIC_TO_EVERYONE" = público e "SELF_ONLY" = rascunho no app.
 */
import { commonMediaProblem } from "@/lib/social/common";
import type { CheckResult, ProviderPost, PublishResult, ReadyProblem, SocialProvider } from "@/lib/social/types";
import { CAPTION_MAX, DEFAULT_TIKTOK_SETTINGS, VIDEO_MAX_BYTES, draftSettingsSchema, tiktokSettingsSchema, type TikTokSettings } from "@/lib/tiktok/settings";
import { zernioAccountIdFor, zernioApiKey } from "@/lib/zernio/config";
import {
  createTikTokPost,
  dryRunTikTokPost,
  getPostState,
  uploadViaPresign,
  ZernioApiError,
  type ZernioTikTokPostInput,
} from "@/lib/zernio/client";

export const ZERNIO_VIDEO_TYPES = ["video/mp4", "video/quicktime"] as const;

/** Rascunho = SELF_ONLY: o vídeo vai pra caixa de entrada do app do TikTok e a pessoa escolhe o público lá. */
function isDraft(settings: TikTokSettings): boolean {
  return settings.privacyLevel === "SELF_ONLY";
}

function setupProblem(post: ProviderPost): ReadyProblem | null {
  const account = post.socialAccount;
  if (!account || account.status === "DISCONNECTED") return { message: "Pick a connected TikTok account first", code: "needs_reconnect" };
  if (!zernioApiKey()) return { message: "TikTok publishing through Zernio is not configured on this server (ZERNIO_API_KEY)", code: "zernio_not_configured" };
  if (!zernioAccountIdFor(account)) return { message: "This TikTok account is not linked to a Zernio account (ZERNIO_TIKTOK_ACCOUNT_ID)", code: "zernio_account_missing" };
  return null;
}

function settingsProblemZernio(raw: unknown): { problem: ReadyProblem } | { settings: TikTokSettings } {
  const parsed = tiktokSettingsSchema.safeParse(raw);
  if (!parsed.success) return { problem: { message: "Pick who can see the video and finish the options", code: "invalid_settings" } };
  const s = parsed.data;
  if (s.privacyLevel !== "PUBLIC_TO_EVERYONE" && s.privacyLevel !== "SELF_ONLY") {
    return { problem: { message: "Through Zernio the video can only be Public or a draft in the TikTok app", code: "privacy_not_allowed" } };
  }
  if (s.commercial.enabled) {
    return { problem: { message: "Commercial content is not supported when publishing through Zernio", code: "invalid_settings" } };
  }
  return { settings: s };
}

function inputFor(post: ProviderPost, settings: TikTokSettings, mediaUrl: string, accountId: string): ZernioTikTokPostInput {
  return {
    content: post.caption,
    accountId,
    mediaUrl,
    draft: isDraft(settings),
    allowComment: settings.allowComment,
    allowDuet: settings.allowDuet,
    allowStitch: settings.allowStitch,
    isAigc: settings.isAigc,
  };
}

const MEDIA_REJECTED = /media|video|url|download|fetch/i;

export const tiktokZernioProvider: SocialProvider = {
  platform: "TIKTOK",
  label: "TikTok",
  accountKind: "social",
  captionMax: CAPTION_MAX,
  videoTypes: ZERNIO_VIDEO_TYPES,
  maxBytes: VIDEO_MAX_BYTES,
  // Padrão do MCP: SELF_ONLY = rascunho no app, nunca vai a público sem alguém escolher.
  defaultSettings: DEFAULT_TIKTOK_SETTINGS,
  draftSettingsSchema,
  confirmTimeoutMs: 30 * 60 * 1000,

  async readyProblem(post, { checkRemote }): Promise<ReadyProblem | null> {
    const setup = setupProblem(post);
    if (setup) return setup;
    const media = commonMediaProblem(this, post);
    if (media) return media;
    const checked = settingsProblemZernio(post.settings);
    if ("problem" in checked) return checked.problem;
    if (checkRemote) {
      try {
        const accountId = zernioAccountIdFor(post.socialAccount)!;
        const dry = await dryRunTikTokPost(inputFor(post, checked.settings, post.mediaUrl, accountId));
        if (!dry.canPublish) return { message: "Zernio says this post cannot be published right now", code: "zernio_rejected" };
      } catch (error) {
        if (error instanceof ZernioApiError && error.status === 409) return { message: error.message, code: "duplicate" };
        if (error instanceof ZernioApiError && error.status === 400) return { message: error.message, code: "zernio_rejected" };
        // Falha passageira (rede, 5xx) não trava o agendamento.
      }
    }
    return null;
  },

  async publish(post, ctx): Promise<PublishResult> {
    // Idempotência: se este registro já tem post na Zernio, só cria outro quando aquele FALHOU de vez
    // (nada foi publicado). Em qualquer outro caso (ou se não der pra consultar) nunca cria um segundo.
    if (post.publishId) {
      const previous = await getPostState(post.publishId);
      if (previous.state === "published") return { state: "published", publishId: post.publishId };
      if (previous.state === "waiting") return { state: "waiting", publishId: post.publishId };
    }

    const setup = setupProblem(post);
    if (setup) throw new Error(setup.message);
    const checked = settingsProblemZernio(post.settings);
    if ("problem" in checked) throw new Error(checked.problem.message);
    const accountId = zernioAccountIdFor(post.socialAccount)!;

    let mediaUrl = post.mediaUrl;
    const filename = mediaUrl.split("?")[0].split("/").pop() || "video.mp4";
    const presign = () => uploadViaPresign({ url: post.mediaUrl, filename, contentType: post.mediaContentType, bytes: post.mediaBytes });
    if ((process.env.ZERNIO_FORCE_PRESIGN ?? "") === "1") mediaUrl = await presign();

    let created: { postId: string };
    try {
      created = await createTikTokPost(inputFor(post, checked.settings, mediaUrl, accountId));
    } catch (error) {
      // A Zernio não aceitou/baixou a URL do nosso armazenamento: manda o arquivo por upload e tenta uma vez mais.
      const retry =
        mediaUrl === post.mediaUrl &&
        error instanceof ZernioApiError &&
        (error.status === 400 || error.status === 422) &&
        MEDIA_REJECTED.test(error.message) &&
        !/privacy|invalid_field_value/i.test(`${error.code ?? ""} ${error.message}`);
      if (!retry) throw explain(error);
      mediaUrl = await presign();
      try {
        created = await createTikTokPost(inputFor(post, checked.settings, mediaUrl, accountId));
      } catch (second) {
        throw explain(second);
      }
    }
    // Grava antes de esperar: se o cron repetir, o publishId impede um segundo post.
    await ctx.savePublishId(created.postId);
    return { state: "waiting", publishId: created.postId };
  },

  async check(post): Promise<CheckResult> {
    if (!post.publishId) return { state: "waiting" };
    const result = await getPostState(post.publishId);
    if (result.state === "failed") return { state: "failed", message: result.message };
    if (result.state === "waiting") return { state: "waiting" };
    const parsed = tiktokSettingsSchema.safeParse(post.settings);
    const wantedDraft = parsed.success && isDraft(parsed.data);
    if (result.inbox && !wantedDraft) {
      return { state: "failed", message: "The video went to the TikTok app inbox as a draft instead of being published publicly" };
    }
    return { state: "published", publishId: post.publishId };
  },
};

/** Mensagens claras para os erros que a gente conhece. Sem reenviar. */
function explain(error: unknown): Error {
  if (error instanceof ZernioApiError) {
    if (error.status === 409) {
      return new Error(`Zernio blocked a repeated post: this same content was already posted to this account in the last 24 hours${error.existingPostId ? ` (post ${error.existingPostId})` : ""}`);
    }
    if (error.status === 400 && /privacy|invalid_field_value/i.test(`${error.code ?? ""} ${error.message}`)) {
      return new Error(`Zernio refused the privacy option (only Public or a draft in the app are allowed): ${error.message}`);
    }
    if (error.status === 401 || error.status === 403) return new Error("Zernio refused the access key. Check ZERNIO_API_KEY on the server.");
  }
  return error instanceof Error ? error : new Error(String(error));
}
