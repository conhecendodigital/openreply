/**
 * 23/10/2026: contas onde a aba Posts publica. TikTok e YouTube moram em
 * SocialAccount; Instagram e Facebook já existem como InstagramAccount (canais),
 * sem copiar token. Para a tela e a API tudo é uma lista só, com `platform`.
 */
import { prisma } from "@/lib/db/client";
import { isSocialPlatform, type SocialPlatform } from "@/lib/social/types";
import { missingYouTubeScopes } from "@/lib/youtube/oauth";

export interface PostableAccount {
  id: string;
  /** De qual tabela vem: decide se o post usa socialAccountId ou channelId. */
  source: "social" | "channel";
  platform: SocialPlatform;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  status: string;
  tokenExpiresAt: string | null;
  connectedAt: string;
  lastError: string | null;
  /** Só contas "social" se desconectam pela aba Posts; Instagram/Facebook, em Canais. */
  canDisconnect: boolean;
  /** Permissões que a pessoa concedeu (só contas "social"). */
  scopes: string[];
  /** YouTube: permissões pedidas que a pessoa não concedeu. Vazio = tudo certo. */
  missingScopes: string[];
  /** YouTube: padrão "meus vídeos não são para crianças" ligado pelo dono na tela. */
  youtubeNotForKidsDefault: boolean;
  youtubeNotForKidsDefaultAt: string | null;
}

export async function listPostableAccounts(workspaceId: string): Promise<PostableAccount[]> {
  const [social, channels] = await Promise.all([
    prisma.socialAccount.findMany({ where: { workspaceId, status: { not: "DISCONNECTED" } }, orderBy: { connectedAt: "desc" } }),
    prisma.instagramAccount.findMany({ where: { workspaceId, status: { not: "DISCONNECTED" } }, orderBy: { connectedAt: "desc" } }),
  ]);
  const out: PostableAccount[] = [];
  for (const a of social ?? []) {
    if (!isSocialPlatform(a.platform)) continue;
    out.push({
      id: a.id,
      source: "social",
      platform: a.platform,
      displayName: a.displayName,
      username: a.username,
      avatarUrl: a.avatarUrl,
      status: a.status,
      tokenExpiresAt: a.tokenExpiresAt?.toISOString() ?? null,
      connectedAt: a.connectedAt.toISOString(),
      lastError: a.lastError,
      canDisconnect: true,
      scopes: a.scopes ?? [],
      missingScopes: a.platform === "YOUTUBE" ? missingYouTubeScopes(a.scopes ?? []) : [],
      youtubeNotForKidsDefault: a.platform === "YOUTUBE" && a.youtubeNotForKidsDefault === true,
      youtubeNotForKidsDefaultAt: a.youtubeNotForKidsDefaultAt?.toISOString() ?? null,
    });
  }
  for (const c of channels ?? []) {
    const platform = c.platform === "FACEBOOK" ? "FACEBOOK" : "INSTAGRAM";
    out.push({
      id: c.id,
      source: "channel",
      platform,
      displayName: c.name || c.username,
      username: c.username,
      avatarUrl: c.profilePictureUrl,
      status: c.status,
      tokenExpiresAt: c.tokenExpiresAt?.toISOString() ?? null,
      connectedAt: c.connectedAt.toISOString(),
      lastError: c.lastError,
      canDisconnect: false,
      scopes: [],
      missingScopes: [],
      youtubeNotForKidsDefault: false,
      youtubeNotForKidsDefaultAt: null,
    });
  }
  return out;
}

/** Conta do workspace (conectada ou precisando reconectar) pelo id, nas duas tabelas. */
export async function findPostableAccount(workspaceId: string, id: string): Promise<{ id: string; source: "social" | "channel"; platform: SocialPlatform; youtubeNotForKidsDefault: boolean } | null> {
  const social = await prisma.socialAccount.findFirst({
    where: { id, workspaceId, status: { not: "DISCONNECTED" } },
    select: { id: true, platform: true, youtubeNotForKidsDefault: true },
  });
  if (social && isSocialPlatform(social.platform)) {
    return { id: social.id, source: "social", platform: social.platform, youtubeNotForKidsDefault: social.youtubeNotForKidsDefault === true };
  }
  const channel = await prisma.instagramAccount.findFirst({
    where: { id, workspaceId, status: { not: "DISCONNECTED" } },
    select: { id: true, platform: true },
  });
  if (channel) return { id: channel.id, source: "channel", platform: channel.platform === "FACEBOOK" ? "FACEBOOK" : "INSTAGRAM", youtubeNotForKidsDefault: false };
  return null;
}
