import type { ScheduledPost, SocialAccount } from "@/app/generated/prisma/client";
import type { PostableAccount } from "@/lib/social/accounts";
import { missingYouTubeScopes } from "@/lib/youtube/oauth";

/** Conta de TikTok/YouTube como a tela recebe (nunca token). */
export function socialAccountDto(a: SocialAccount): Omit<PostableAccount, "source" | "canDisconnect"> & { canDisconnect: boolean; source: "social" } {
  return {
    id: a.id,
    source: "social",
    platform: a.platform as PostableAccount["platform"],
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
  };
}

export function postAccountName(post: { socialAccount?: { displayName: string } | null; channel?: { username: string; name?: string | null } | null }): string {
  return post.socialAccount?.displayName ?? post.channel?.name ?? post.channel?.username ?? "";
}

export function postExternalUrl(post: Pick<ScheduledPost, "platform" | "status" | "publishId">): string | null {
  if (post.status !== "PUBLISHED" || !post.publishId) return null;
  if (post.platform === "YOUTUBE") return `https://www.youtube.com/watch?v=${post.publishId}`;
  if (post.platform === "FACEBOOK") return `https://www.facebook.com/${post.publishId}`;
  return null;
}

export type PostWithAccounts = ScheduledPost & {
  socialAccount?: { displayName: string } | null;
  channel?: { username: string; name?: string | null } | null;
};

export function postDto(p: PostWithAccounts) {
  return {
    id: p.id,
    platform: p.platform,
    /** Id da conta, venha da tabela que vier. A tela usa este. */
    accountId: p.socialAccountId ?? p.channelId,
    /** Mantido para quem já lia o campo antigo (só TikTok/YouTube). */
    socialAccountId: p.socialAccountId,
    channelId: p.channelId,
    accountName: postAccountName(p),
    status: p.status,
    caption: p.caption,
    mediaUrl: p.mediaUrl,
    mediaBytes: p.mediaBytes,
    mediaContentType: p.mediaContentType,
    settings: p.settings,
    scheduledAt: p.scheduledAt?.toISOString() ?? null,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    externalUrl: postExternalUrl(p),
    lastError: p.lastError,
    createdVia: p.createdVia,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
