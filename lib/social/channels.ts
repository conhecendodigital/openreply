/**
 * Canais do compositor de posts: cada conta conectada vira um canal, e o YouTube vira dois
 * (vídeo normal e Shorts). Lógica pura, sem React, para poder ser testada.
 */
import type { SocialPlatform } from "@/lib/social/types";

export type YouTubeFormat = "video" | "short";

/** O YouTube trata como Short o vídeo vertical ou quadrado de até 3 minutos. */
export const SHORT_MAX_SECONDS = 180;

export interface MediaFacts {
  width: number | null;
  height: number | null;
  durationSec: number | null;
}

/** Texto do problema (chave de tradução) ou null se o vídeo serve como Short. */
export function shortProblem(media: MediaFacts): string | null {
  const { width, height, durationSec } = media;
  if (!width || !height || !durationSec) return "Wait for the video to load so we can check the Shorts rules.";
  if (width > height) return "A YouTube Short must be vertical or square.";
  if (durationSec > SHORT_MAX_SECONDS) return "A YouTube Short can be at most 3 minutes long.";
  return null;
}

export interface ChannelAccount {
  id: string;
  platform: SocialPlatform;
}

export interface Channel {
  /** accountId para as redes normais; accountId + ":short" para o YouTube Shorts. */
  key: string;
  accountId: string;
  platform: SocialPlatform;
  format: YouTubeFormat | null;
}

export function channelKey(accountId: string, format: YouTubeFormat | null): string {
  return format === "short" ? `${accountId}:short` : accountId;
}

/** Todos os canais possíveis: o YouTube aparece duas vezes (vídeo e Shorts). */
export function channelsFor(accounts: ChannelAccount[]): Channel[] {
  return accounts.flatMap((a): Channel[] =>
    a.platform === "YOUTUBE"
      ? [
          { key: channelKey(a.id, "video"), accountId: a.id, platform: a.platform, format: "video" },
          { key: channelKey(a.id, "short"), accountId: a.id, platform: a.platform, format: "short" },
        ]
      : [{ key: a.id, accountId: a.id, platform: a.platform, format: null }]
  );
}

/** Marca ou desmarca um canal. Vídeo normal e Shorts da mesma conta não valem juntos? Valem: são dois posts. */
export function toggleChannel(picked: string[], key: string): string[] {
  return picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key];
}

export function pickedChannels(all: Channel[], picked: string[]): Channel[] {
  return all.filter((c) => picked.includes(c.key));
}

/** Configurações do YouTube de um canal, com o formato e os dados que o servidor confere. */
export function withYouTubeFormat(settings: Record<string, unknown>, format: YouTubeFormat, media: MediaFacts): Record<string, unknown> {
  if (format === "video") return { ...settings, format };
  return {
    ...settings,
    format,
    mediaWidth: media.width ?? undefined,
    mediaHeight: media.height ?? undefined,
    mediaSeconds: media.durationSec != null ? Math.ceil(media.durationSec) : undefined,
  };
}

export function formatFromSettings(settings: Record<string, unknown> | null | undefined): YouTubeFormat {
  return settings?.format === "short" ? "short" : "video";
}

/** Confere no servidor o que o cliente declarou para um Short. null = ok. */
export function shortSettingsProblem(settings: { format?: string; mediaWidth?: number; mediaHeight?: number; mediaSeconds?: number }): string | null {
  if (settings.format !== "short") return null;
  return shortProblem({ width: settings.mediaWidth ?? null, height: settings.mediaHeight ?? null, durationSec: settings.mediaSeconds ?? null });
}
