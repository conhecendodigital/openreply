/**
 * Instagram pela API oficial de publicação (Instagram Login, graph.instagram.com).
 * Reels: cria o container com o vídeo (a Meta baixa o nosso endereço público), espera ficar
 * FINISHED (o cron confere a cada 5 minutos) e só então publica. Reel de teste (trial reel):
 * mesmo caminho com `trial_params`.
 * Carrossel (27/10/2026): um container filho por imagem (is_carousel_item), espera os filhos
 * ficarem FINISHED, cria o container CAROUSEL com os ids na ordem dos slides e o cron confere o
 * pai antes do media_publish. A Meta só aceita JPEG: PNG é convertido (lib/social/instagram-images.ts).
 */
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { PermissionError } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { commonMediaProblem, mediaUrlProblem } from "@/lib/social/common";
import { instagramSlideSchema, slideProblems, type InstagramSlide } from "@/lib/social/instagram-carousel";
import { jpegUrlForSlide } from "@/lib/social/instagram-images";
import { countHashtags, INSTAGRAM_HASHTAG_MAX } from "@/lib/social/text-fields";
import { INSTAGRAM_CAROUSEL_MAX, NETWORK_LIMITS } from "@/lib/social/limits";
import { explainMetaError, graphCall } from "@/lib/social/meta-graph";
import type { CheckResult, ProviderPost, PublishResult, ReadyProblem, SocialProvider } from "@/lib/social/types";

export const INSTAGRAM_CAPTION_MAX = NETWORK_LIMITS.INSTAGRAM.captionMax;
export const INSTAGRAM_VIDEO_TYPES = NETWORK_LIMITS.INSTAGRAM.videoTypes;
/** Limite do arquivo de Reel na API de publicação (conferir na documentação da Meta se mudar). */
export const INSTAGRAM_VIDEO_MAX_BYTES = NETWORK_LIMITS.INSTAGRAM.maxBytes;

export const INSTAGRAM_TRIAL_STRATEGIES = ["MANUAL", "SS_PERFORMANCE"] as const;

/**
 * `format` e `slides` são novos e opcionais: posts antigos (só shareToFeed) continuam sendo Reel.
 * `slides` guarda o carrossel na ordem; mediaUrl/mediaBytes/mediaContentType do post = o 1º slide.
 * `trial` (só Reel): reel de teste, mostrado só a quem não segue, com graduação MANUAL ou SS_PERFORMANCE.
 */
export const instagramSettingsSchema = z
  .object({
    shareToFeed: z.boolean(),
    format: z.enum(["REELS", "CAROUSEL"]).optional(),
    slides: z.array(instagramSlideSchema).max(INSTAGRAM_CAROUSEL_MAX).optional(),
    trial: z.enum(INSTAGRAM_TRIAL_STRATEGIES).nullish(),
  })
  .strict();
export type InstagramSettings = z.infer<typeof instagramSettingsSchema>;

/** Esperas do carrossel: quantas vezes e de quanto em quanto tempo conferir os filhos (os testes zeram). */
export const carouselPolling = { attempts: 10, delayMs: 2000 };

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

function isCarousel(settings: unknown): boolean {
  return (settings as { format?: string } | null)?.format === "CAROUSEL";
}

class SlideError extends Error {}

async function waitForChild(token: string, id: string, slideNumber: number): Promise<void> {
  for (let attempt = 0; attempt < carouselPolling.attempts; attempt += 1) {
    const status = await graphCall<{ status_code?: string; status?: string }>(token, "GET", `/${id}`, { fields: "status_code,status" });
    if (status.status_code === "FINISHED") return;
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
      throw new SlideError(`Slide ${slideNumber}: Instagram could not process the image${status.status ? ` (${status.status})` : ""}`);
    }
    await sleep(carouselPolling.delayMs);
  }
  throw new SlideError(`Slide ${slideNumber}: Instagram is still processing the image. Try again in a few minutes.`);
}

function needChannel(post: ProviderPost) {
  const channel = post.channel;
  if (!channel || channel.status !== "ACTIVE") throw new Error("The Instagram account is not connected. Connect it again in Channels.");
  return channel;
}

async function markNeedsReconnect(channelId: string) {
  await prisma.instagramAccount.update({ where: { id: channelId }, data: { status: "NEEDS_RECONNECT" } });
}

/** Cria os filhos (um por imagem, na ordem), espera ficarem prontos e cria o container CAROUSEL. Devolve o id do pai. */
async function createCarouselContainer(post: ProviderPost, instagramId: string, token: string, slides: InstagramSlide[]): Promise<string> {
  if (slides.length === 0) throw new Error("The carousel has no images.");
  // Em ordem e uma por vez: a ordem dos ids do pai é a ordem dos slides.
  const urls: string[] = [];
  for (const [index, slide] of slides.entries()) urls.push(await jpegUrlForSlide(post.workspaceId, slide, index + 1));
  const children: string[] = [];
  for (const [index, imageUrl] of urls.entries()) {
    try {
      const child = await graphCall<{ id: string }>(token, "POST", `/${instagramId}/media`, { image_url: imageUrl, is_carousel_item: true });
      children.push(child.id);
    } catch (error) {
      const failure = explainMetaError(error, "Instagram");
      if (failure.needsReconnect) throw error;
      throw new SlideError(`Slide ${index + 1}: ${failure.message}`);
    }
  }
  for (const [index, id] of children.entries()) await waitForChild(token, id, index + 1);
  const parent = await graphCall<{ id: string }>(token, "POST", `/${instagramId}/media`, {
    media_type: "CAROUSEL",
    children: children.join(","),
    caption: post.caption,
  });
  return parent.id;
}

export const instagramProvider: SocialProvider = {
  platform: "INSTAGRAM",
  label: "Instagram",
  accountKind: "channel",
  captionMax: INSTAGRAM_CAPTION_MAX,
  videoTypes: INSTAGRAM_VIDEO_TYPES,
  maxBytes: INSTAGRAM_VIDEO_MAX_BYTES,
  imageTypes: NETWORK_LIMITS.INSTAGRAM.imageTypes,
  imageMaxBytes: NETWORK_LIMITS.INSTAGRAM.imageMaxBytes,
  defaultSettings: { shareToFeed: true },
  draftSettingsSchema: instagramSettingsSchema,

  async readyProblem(post): Promise<ReadyProblem | null> {
    if (!post.channel || post.channel.status !== "ACTIVE") return { message: "Connect the Instagram account again first", code: "needs_reconnect" };
    const media = commonMediaProblem(this, post);
    if (media) return media;
    const parsedSettings = instagramSettingsSchema.safeParse(post.settings);
    if (!parsedSettings.success) return { message: "Finish the Reels options", code: "invalid_settings" };
    const carousel = parsedSettings.data.format === "CAROUSEL";
    const isImage = post.mediaContentType.startsWith("image/");
    if (!carousel && isImage) return { message: "Reels need a video. Pick the carousel format to post images.", code: "invalid_media" };
    if (carousel) {
      if (parsedSettings.data.trial) return { message: "Trial reels are only for Reels.", code: "invalid_settings" };
      const slides = parsedSettings.data.slides ?? [];
      const problems = slideProblems(slides);
      if (problems.length) return { message: problems[0], code: "invalid_media" };
      for (const [index, slide] of slides.entries()) {
        const urlProblem = mediaUrlProblem(post.workspaceId, slide.url);
        if (urlProblem) return { message: `Slide ${index + 1}: ${urlProblem}`, code: "invalid_media" };
      }
    }
    if (countHashtags(post.caption ?? "") > INSTAGRAM_HASHTAG_MAX) {
      return { message: "Instagram accepts up to 30 hashtags.", code: "invalid_settings" };
    }
    return null;
  },

  async publish(post, ctx): Promise<PublishResult> {
    const channel = needChannel(post);
    const parsed = instagramSettingsSchema.safeParse(post.settings);
    if (!parsed.success) throw new Error("The post options are incomplete.");
    const token = decryptToken(channel.accessToken);
    try {
      if (parsed.data.format === "CAROUSEL") {
        const parentId = await createCarouselContainer(post, channel.instagramId, token, parsed.data.slides ?? []);
        await ctx.savePublishId(parentId);
        // A Meta junta os filhos; a conferência do pai e o media_publish saem no check.
        return { state: "waiting", publishId: parentId };
      }
      const container = await graphCall<{ id: string }>(token, "POST", `/${channel.instagramId}/media`, {
        media_type: "REELS",
        video_url: post.mediaUrl,
        caption: post.caption,
        share_to_feed: parsed.data.shareToFeed,
        // Reel de teste: só a quem não segue. JSON no campo, como no exemplo da documentação da Meta.
        trial_params: parsed.data.trial ? JSON.stringify({ graduation_strategy: parsed.data.trial }) : undefined,
      });
      await ctx.savePublishId(container.id);
      // A Meta baixa e processa o vídeo; a confirmação e a publicação saem no check.
      return { state: "waiting", publishId: container.id };
    } catch (error) {
      if (error instanceof SlideError) throw error;
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
        const what = isCarousel(post.settings) ? "the carousel" : "the video";
        return { state: "failed", message: `Instagram could not process ${what}${status.status ? `: ${status.status}` : ""}`.slice(0, 500) };
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
