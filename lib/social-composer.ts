/**
 * 23/10/2026: regras do compositor para YouTube, Instagram (Reels) e Facebook (Página).
 * Lógica pura, sem importar servidor. O TikTok mantém as suas em lib/tiktok-composer.ts
 * (regras de UX do Direct Post). Mensagens em inglês: a tela passa cada uma por t().
 */
import { brasiliaLocalToIso } from "@/lib/tiktok-composer";
import { FACEBOOK_TITLE_MAX, NETWORK_LIMITS, YOUTUBE_TITLE_MAX } from "@/lib/social/limits";
import type { SocialPlatform } from "@/lib/social/types";
import { slideProblems, type InstagramSlide } from "@/lib/social/instagram-carousel";
import { countHashtags, INSTAGRAM_HASHTAG_MAX, YOUTUBE_TAGS_TOTAL_MAX, youtubeTagsLength } from "@/lib/social/text-fields";

export type { SocialPlatform };
export type ComposerAction = "draft" | "schedule" | "publish";

export const NETWORK_NAME: Record<SocialPlatform, string> = {
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
};

export type YouTubePrivacy = "private" | "unlisted" | "public";
export const YOUTUBE_PRIVACY_LABELS: Record<YouTubePrivacy, string> = {
  private: "Private",
  unlisted: "Unlisted",
  public: "Public",
};

export interface YouTubeForm {
  title: string;
  /** Descrição do vídeo: é a "legenda" do post do YouTube, separada da legenda das outras redes. */
  description: string;
  /** Tags do YouTube, sem "#". */
  tags: string[];
  privacyStatus: YouTubePrivacy;
  /** null = a pessoa ainda não respondeu. Sem valor padrão: a regra do YouTube exige a resposta dela. */
  madeForKids: boolean | null;
  containsSyntheticMedia: boolean;
}

export type InstagramFormat = "REELS" | "CAROUSEL";
export type InstagramTrial = "" | "MANUAL" | "SS_PERFORMANCE";

export interface InstagramForm {
  shareToFeed: boolean;
  /** Reel (vídeo) ou carrossel (2 a 20 imagens, na ordem). */
  format: InstagramFormat;
  slides: InstagramSlide[];
  /** Reel de teste: só a quem não segue. Vazio = Reel normal. */
  trial: InstagramTrial;
}

export interface FacebookForm {
  title: string;
}

export function emptyYouTubeForm(): YouTubeForm {
  return { title: "", description: "", tags: [], privacyStatus: "private", madeForKids: null, containsSyntheticMedia: false };
}

export function emptyInstagramForm(): InstagramForm {
  return { shareToFeed: true, format: "REELS", slides: [], trial: "" };
}

export function emptyFacebookForm(): FacebookForm {
  return { title: "" };
}

export function youTubeFormFromSettings(settings: Record<string, unknown> | null | undefined, description = ""): YouTubeForm {
  const s = settings ?? {};
  const privacy = s.privacyStatus;
  return {
    title: typeof s.title === "string" ? s.title : "",
    description,
    tags: Array.isArray(s.tags) ? s.tags.filter((x): x is string => typeof x === "string") : [],
    privacyStatus: privacy === "public" || privacy === "unlisted" || privacy === "private" ? privacy : "private",
    madeForKids: typeof s.selfDeclaredMadeForKids === "boolean" ? s.selfDeclaredMadeForKids : null,
    containsSyntheticMedia: s.containsSyntheticMedia === true,
  };
}

export function instagramFormFromSettings(settings: Record<string, unknown> | null | undefined): InstagramForm {
  const trial = settings?.trial;
  return {
    shareToFeed: settings?.shareToFeed !== false,
    format: settings?.format === "CAROUSEL" ? "CAROUSEL" : "REELS",
    slides: Array.isArray(settings?.slides) ? (settings.slides as InstagramSlide[]) : [],
    trial: trial === "MANUAL" || trial === "SS_PERFORMANCE" ? trial : "",
  };
}

/** Opções do Instagram como a API recebe. Reel comum continua só com shareToFeed (igual a antes). */
export function instagramSettingsPayload(form: InstagramForm): Record<string, unknown> {
  if (form.format === "CAROUSEL") return { shareToFeed: form.shareToFeed, format: "CAROUSEL", slides: form.slides };
  return form.trial ? { shareToFeed: form.shareToFeed, format: "REELS", trial: form.trial } : { shareToFeed: form.shareToFeed };
}

export function facebookFormFromSettings(settings: Record<string, unknown> | null | undefined): FacebookForm {
  return { title: typeof settings?.title === "string" ? settings.title : "" };
}

/** Opções como a API recebe. Rascunho sem a resposta de "feito para crianças" segue sem o campo. */
export function youTubeSettingsPayload(form: YouTubeForm): Record<string, unknown> {
  const out: Record<string, unknown> = {
    title: form.title.trim(),
    privacyStatus: form.privacyStatus,
    containsSyntheticMedia: form.containsSyntheticMedia,
  };
  if (form.madeForKids !== null) out.selfDeclaredMadeForKids = form.madeForKids;
  if (form.tags.length > 0) out.tags = form.tags;
  return out;
}

export function facebookSettingsPayload(form: FacebookForm): Record<string, unknown> {
  return { title: form.title.trim() };
}

export interface SocialComposerInput {
  network: Exclude<SocialPlatform, "TIKTOK">;
  accountId: string;
  caption: string;
  mediaUrl: string;
  mediaBytes: number;
  mediaContentType: string;
  youtube: YouTubeForm;
  facebook: FacebookForm;
  /** Opções do Instagram (formato, slides do carrossel, reel de teste). */
  instagram?: InstagramForm;
  /** Mais de uma rede marcada: carrossel só vale para o Instagram sozinho. */
  otherNetworks?: boolean;
  /** Só quando for agendar. */
  scheduledLocal?: string;
}

/** Lista vazia = pode seguir. */
export function validateSocialComposer(input: SocialComposerInput, action: ComposerAction, now: Date = new Date()): string[] {
  const errors: string[] = [];
  const limits = NETWORK_LIMITS[input.network];
  const name = NETWORK_NAME[input.network];
  if (!input.accountId) errors.push(`Pick the ${name} account.`);
  const carousel = input.network === "INSTAGRAM" && input.instagram?.format === "CAROUSEL";
  if (carousel) {
    if (input.otherNetworks) errors.push("A carousel only goes to Instagram. Unmark the other networks or pick Reel.");
    errors.push(...slideProblems(input.instagram?.slides));
  } else if (!input.mediaUrl) errors.push("Add the video.");
  if (input.network === "INSTAGRAM" && !carousel && input.mediaContentType.startsWith("image/")) {
    errors.push("Reels need a video. Pick the carousel format to post images.");
  }
  if (input.caption.length > limits.captionMax) errors.push("The caption is too long.");
  if (input.network === "YOUTUBE" && input.youtube.title.length > YOUTUBE_TITLE_MAX) errors.push("The title is too long.");
  if (input.network === "YOUTUBE" && youtubeTagsLength(input.youtube.tags) > YOUTUBE_TAGS_TOTAL_MAX) errors.push("The tags are too long.");
  if (input.network === "INSTAGRAM" && countHashtags(input.caption) > INSTAGRAM_HASHTAG_MAX) errors.push("Instagram accepts up to 30 hashtags.");
  if (input.network === "FACEBOOK" && input.facebook.title.length > FACEBOOK_TITLE_MAX) errors.push("The title is too long.");
  if (!carousel && input.mediaUrl && input.mediaContentType && !limits.videoTypes.includes(input.mediaContentType)) {
    errors.push(`${name} does not accept this video format. Use an MP4 or MOV video.`);
  }
  if (!carousel && input.mediaUrl && input.mediaBytes > limits.maxBytes) errors.push(`The video is larger than ${name} allows.`);
  if (action === "draft") return errors;

  if (input.network === "YOUTUBE") {
    if (!input.youtube.title.trim()) errors.push("Write the video title.");
    if (input.youtube.madeForKids === null) errors.push("Answer if the video is made for kids.");
  }
  if (action === "schedule") {
    const iso = brasiliaLocalToIso(input.scheduledLocal ?? "");
    if (!iso) errors.push("Pick the date and time.");
    else if (new Date(iso).getTime() <= now.getTime()) errors.push("Pick a time in the future.");
  }
  return errors;
}

/** Tipos de arquivo que o seletor deixa escolher para a rede. */
export function acceptForNetwork(network: SocialPlatform | null): string {
  const types = network ? NETWORK_LIMITS[network].videoTypes : NETWORK_LIMITS.TIKTOK.videoTypes;
  return types.join(",");
}
