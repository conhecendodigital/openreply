import type { ScheduledPost, SocialAccount } from "@/app/generated/prisma/client";

export function socialAccountDto(a: SocialAccount) {
  return {
    id: a.id,
    platform: a.platform,
    displayName: a.displayName,
    username: a.username,
    avatarUrl: a.avatarUrl,
    status: a.status,
    tokenExpiresAt: a.tokenExpiresAt?.toISOString() ?? null,
    connectedAt: a.connectedAt.toISOString(),
    lastError: a.lastError,
  };
}

export function postDto(p: ScheduledPost & { socialAccount: { displayName: string } }) {
  return {
    id: p.id,
    platform: p.platform,
    socialAccountId: p.socialAccountId,
    accountName: p.socialAccount.displayName,
    status: p.status,
    caption: p.caption,
    mediaUrl: p.mediaUrl,
    mediaBytes: p.mediaBytes,
    mediaContentType: p.mediaContentType,
    settings: p.settings,
    scheduledAt: p.scheduledAt?.toISOString() ?? null,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    lastError: p.lastError,
    createdVia: p.createdVia,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
