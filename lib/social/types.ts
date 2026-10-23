/**
 * 23/10/2026: camada comum das redes que a aba Posts publica (TikTok, YouTube,
 * Instagram Reels, Facebook Page). Cada rede é um provider: valida as opções,
 * diz se o post está pronto, publica e, nas redes assíncronas, confere depois.
 */
import type { ZodType } from "zod";
import type { InstagramAccount, SocialAccount } from "@/app/generated/prisma/client";

export const SOCIAL_PLATFORMS = ["TIKTOK", "YOUTUBE", "INSTAGRAM", "FACEBOOK"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return typeof value === "string" && (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

/** Post como o provider recebe: com a conta de onde sai (uma das duas vem preenchida). */
export interface ProviderPost {
  id: string;
  workspaceId: string;
  platform?: string;
  caption: string;
  mediaUrl: string;
  mediaBytes: number;
  mediaContentType: string;
  settings: unknown;
  publishId?: string | null;
  lockedAt?: Date | null;
  socialAccount?: SocialAccount | null;
  channel?: InstagramAccount | null;
}

export type ReadyProblem = { message: string; code: string };

export interface PublishContext {
  /** Grava o id da publicação na hora, para o cron conseguir conferir mesmo se o envio cair no meio. */
  savePublishId(publishId: string): Promise<void>;
}

/** `published`: já está no ar. `waiting`: a rede ainda processa e o cron confere depois. */
export type PublishResult = { state: "published"; publishId?: string } | { state: "waiting"; publishId?: string };

export type CheckResult =
  | { state: "published"; publishId?: string }
  | { state: "failed"; message: string }
  | { state: "waiting" };

export interface SocialProvider {
  platform: SocialPlatform;
  /** Nome para mensagens ("TikTok", "YouTube", "Instagram", "Facebook"). */
  label: string;
  /** Onde fica a conta: SocialAccount (TikTok, YouTube) ou InstagramAccount (Instagram, Facebook). */
  accountKind: "social" | "channel";
  captionMax: number;
  videoTypes: readonly string[];
  maxBytes: number;
  /** Opções de um rascunho criado sem tela (MCP). */
  defaultSettings: Record<string, unknown>;
  /** Rascunho aceita opções incompletas; agendar e publicar exigem as completas (readyProblem). */
  draftSettingsSchema: ZodType<unknown>;
  /** Quanto esperar a confirmação de uma rede assíncrona antes de dar o post como falho. */
  confirmTimeoutMs?: number;
  /** Regras da rede além das comuns (conta conectada, vídeo nosso, tipo, tamanho, legenda). */
  readyProblem(post: ProviderPost, opts: { checkRemote: boolean }): Promise<ReadyProblem | null>;
  /** O post já está PUBLISHING (claimPost). Lança erro com mensagem clara se falhar. */
  publish(post: ProviderPost, ctx: PublishContext): Promise<PublishResult>;
  /** Só para redes assíncronas: o cron chama enquanto o post está PUBLISHING com publishId. */
  check?(post: ProviderPost): Promise<CheckResult>;
}
