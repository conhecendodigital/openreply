/**
 * 23/10/2026: opções de publicação do TikTok guardadas no post (coluna
 * `settings`). Mesmas regras de UX do Direct Post que a tela /posts aplica;
 * aqui o servidor confere de novo, porque o MCP e a API não passam pela tela.
 */
import { z } from "zod";

export const PRIVACY_LEVELS = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
] as const;

export const CAPTION_MAX = 2200;
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;
/** Limite de tamanho do vídeo: 1 GB (o TikTok aceita até 4 GB; aqui o upload é do navegador). */
export const VIDEO_MAX_BYTES = 1024 * 1024 * 1024;

export const tiktokSettingsSchema = z
  .object({
    privacyLevel: z.enum(PRIVACY_LEVELS),
    allowComment: z.boolean(),
    allowDuet: z.boolean(),
    allowStitch: z.boolean(),
    commercial: z.object({
      enabled: z.boolean(),
      yourBrand: z.boolean(),
      brandedContent: z.boolean(),
    }),
    isAigc: z.boolean(),
  })
  .strict();

export type TikTokSettings = z.infer<typeof tiktokSettingsSchema>;

/** Valor inicial de um rascunho criado sem tela (MCP): tudo desligado, só a própria pessoa vê. */
export const DEFAULT_TIKTOK_SETTINGS: TikTokSettings = {
  privacyLevel: "SELF_ONLY",
  allowComment: false,
  allowDuet: false,
  allowStitch: false,
  commercial: { enabled: false, yourBrand: false, brandedContent: false },
  isAigc: false,
};

/** Erro de regra do TikTok, ou null. Usado antes de agendar ou publicar. */
export function settingsProblem(settings: TikTokSettings): string | null {
  if (settings.commercial.enabled && !settings.commercial.yourBrand && !settings.commercial.brandedContent) {
    return "Commercial content is on: pick Your brand or Branded content";
  }
  if (settings.commercial.enabled && settings.commercial.brandedContent && settings.privacyLevel === "SELF_ONLY") {
    return "Branded content cannot be private (Only me)";
  }
  if (!settings.commercial.enabled && (settings.commercial.yourBrand || settings.commercial.brandedContent)) {
    return "Turn commercial content on to pick a brand option";
  }
  return null;
}

/**
 * Rascunho aceita opções incompletas (a tela salva antes de a pessoa escolher a
 * privacidade, que não tem valor padrão). Agendar e publicar exigem o schema completo.
 */
export const draftSettingsSchema = tiktokSettingsSchema.extend({
  privacyLevel: z.union([z.enum(PRIVACY_LEVELS), z.literal("")]),
});
export type DraftSettings = z.infer<typeof draftSettingsSchema>;
