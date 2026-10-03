/**
 * Data for the Channels page (one card per channel) and the dashboard alert
 * banner. Read-only: nothing here calls Meta or changes a row.
 */
import type { InstagramAccountStatus, ModerationMode } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { TOKEN_EXPIRY_WARNING_DAYS, WEBHOOK_STALE_HOURS } from "@/lib/channels/status";

const DAY_MS = 24 * 60 * 60 * 1000;

export type ChannelAlertCode =
  | "needs_reconnect"
  | "token_expired"
  | "token_expiring"
  | "webhooks_stale"
  | "webhooks_not_subscribed";

export type ChannelAlert = {
  code: ChannelAlertCode;
  instagramAccountId: string;
  username: string;
  /** English text; the UI translates it with t(). */
  message: string;
  /** token_expiring: whole days left. */
  days?: number;
  /** webhooks_stale: the threshold in hours. */
  hours?: number;
};

export type InstagramChannelCard = {
  platform: "instagram";
  id: string;
  instagramId: string;
  username: string;
  name: string | null;
  profilePictureUrl: string | null;
  status: InstagramAccountStatus;
  connectedAt: string;
  reconnectedAt: string | null;
  disconnectedAt: string | null;
  tokenExpiresAt: string | null;
  /** Whole days left (negative = expired); null when unknown or not connected. */
  tokenExpiresInDays: number | null;
  webhookSubscribed: boolean;
  webhookFields: string[];
  /** Last webhook Meta delivered for this account. */
  lastWebhookAt: string | null;
  webhooksStale: boolean;
  lastError: string | null;
  lastErrorAt: string | null;
  campaigns: { active: number; total: number };
  moderationMode: ModerationMode;
  contacts: number;
  pendingDrafts: number;
  alerts: ChannelAlert[];
};

export type ComingSoonChannel = {
  platform: "telegram" | "whatsapp" | "messenger" | "threads";
  name: string;
  status: "COMING_SOON";
  /** What is missing to turn it on (English; the UI translates it). */
  requirements: string[];
};

export const COMING_SOON_CHANNELS: ComingSoonChannel[] = [
  {
    platform: "telegram",
    name: "Telegram",
    status: "COMING_SOON",
    requirements: ["A bot token from @BotFather"],
  },
  {
    platform: "whatsapp",
    name: "WhatsApp",
    status: "COMING_SOON",
    requirements: ["WhatsApp Cloud API", "Business verification on Meta"],
  },
  {
    platform: "messenger",
    name: "Messenger",
    status: "COMING_SOON",
    requirements: ["Same Meta app as Instagram (Facebook Page permission)"],
  },
  {
    platform: "threads",
    name: "Threads",
    status: "COMING_SOON",
    requirements: ["Same Meta app as Instagram (Threads API permission)"],
  },
];

export type ChannelsOverview = {
  instagram: InstagramChannelCard[];
  comingSoon: ComingSoonChannel[];
  alerts: ChannelAlert[];
  needsAttention: boolean;
  generatedAt: string;
};

type AccountForAlerts = {
  id: string;
  username: string;
  status: InstagramAccountStatus;
  tokenExpiresAt: Date | null;
  webhookSubscribed: boolean;
  lastWebhookAt: Date | null;
  connectedAt: Date;
  reconnectedAt: Date | null;
};

function daysLeft(expiresAt: Date | null, now: Date): number | null {
  if (!expiresAt) return null;
  return Math.floor((expiresAt.getTime() - now.getTime()) / DAY_MS);
}

/**
 * Webhooks are "stale" when an ACTIVE account has not received one in
 * WEBHOOK_STALE_HOURS. A freshly (re)connected account gets the same grace.
 */
export function isWebhookStale(account: AccountForAlerts, now: Date): boolean {
  if (account.status !== "ACTIVE") return false;
  const staleBefore = now.getTime() - WEBHOOK_STALE_HOURS * 60 * 60 * 1000;
  const since = Math.max(account.connectedAt.getTime(), account.reconnectedAt?.getTime() ?? 0);
  if (since > staleBefore) return false;
  return !account.lastWebhookAt || account.lastWebhookAt.getTime() < staleBefore;
}

/** Alerts for one account. A DISCONNECTED channel was turned off on purpose: none. */
export function channelAlerts(account: AccountForAlerts, now = new Date()): ChannelAlert[] {
  const base = { instagramAccountId: account.id, username: account.username };
  if (account.status === "DISCONNECTED") return [];
  if (account.status === "NEEDS_RECONNECT") {
    return [{ ...base, code: "needs_reconnect", message: `@${account.username} needs to be reconnected` }];
  }
  const alerts: ChannelAlert[] = [];
  const left = daysLeft(account.tokenExpiresAt, now);
  if (left !== null && account.tokenExpiresAt && account.tokenExpiresAt.getTime() <= now.getTime()) {
    alerts.push({ ...base, code: "token_expired", message: `@${account.username}: the token expired` });
  } else if (left !== null && left < TOKEN_EXPIRY_WARNING_DAYS) {
    alerts.push({
      ...base,
      code: "token_expiring",
      days: left,
      message: `@${account.username}: the token expires in ${left} day(s)`,
    });
  }
  if (!account.webhookSubscribed) {
    alerts.push({
      ...base,
      code: "webhooks_not_subscribed",
      message: `@${account.username}: webhooks are not subscribed`,
    });
  } else if (isWebhookStale(account, now)) {
    alerts.push({
      ...base,
      code: "webhooks_stale",
      hours: WEBHOOK_STALE_HOURS,
      message: `@${account.username}: no webhook received in over ${WEBHOOK_STALE_HOURS}h`,
    });
  }
  return alerts;
}

const ALERT_SELECT = {
  id: true,
  username: true,
  status: true,
  tokenExpiresAt: true,
  webhookSubscribed: true,
  lastWebhookAt: true,
  connectedAt: true,
  reconnectedAt: true,
} as const;

/**
 * Light query for the dashboard banner. Uses the same WebhookEvent fallback as
 * the Channels page, so an account connected before lastWebhookAt existed is
 * not flagged "webhooks stalled" in the banner while its card says it is fine.
 */
export async function getChannelAlerts(workspaceId: string, now = new Date()): Promise<ChannelAlert[]> {
  const accounts = await prisma.instagramAccount.findMany({
    where: { workspaceId },
    select: { ...ALERT_SELECT, instagramId: true },
    orderBy: { connectedAt: "desc" },
  });
  const withFallback = await Promise.all(
    accounts.map(async (account) => {
      if (account.lastWebhookAt || !isWebhookStale(account, now)) return account;
      const fallback = await latestWebhookEventAt(workspaceId, account.instagramId);
      return fallback ? { ...account, lastWebhookAt: fallback } : account;
    })
  );
  return withFallback.flatMap((a) => channelAlerts(a, now));
}

/** Everything that stays when a channel is disconnected (shown as "nothing is deleted"). */
export async function countKeptChannelData(accountId: string, instagramId: string) {
  const [campaigns, contacts, conversations, drafts, links, moderation, dmLogs, followerSnapshots] =
    await Promise.all([
      prisma.automation.count({ where: { instagramAccountId: accountId } }),
      prisma.contact.count({ where: { instagramAccountId: accountId } }),
      prisma.directMessage.count({ where: { accountId: instagramId } }),
      prisma.draftReply.count({ where: { instagramAccountId: accountId } }),
      prisma.conversationLink.count({ where: { instagramAccountId: accountId } }),
      prisma.commentModeration.count({ where: { instagramAccountId: accountId } }),
      prisma.dmLog.count({ where: { instagramAccountId: accountId } }),
      prisma.followerSnapshot.count({ where: { instagramAccountId: accountId } }),
    ]);
  return { campaigns, contacts, messages: conversations, drafts, links, moderation, dmLogs, followerSnapshots };
}

/**
 * Fallback for accounts that never got lastWebhookAt (connected before it
 * existed): the newest stored WebhookEvent whose payload names the account.
 */
async function latestWebhookEventAt(workspaceId: string, instagramId: string): Promise<Date | null> {
  try {
    const containment = JSON.stringify({ entry: [{ id: instagramId }] });
    const since = new Date(Date.now() - 30 * DAY_MS);
    const rows = await prisma.$queryRaw<{ createdAt: Date }[]>`
      SELECT "createdAt" FROM "WebhookEvent"
      WHERE ("workspaceId" = ${workspaceId} OR "workspaceId" IS NULL)
        AND "createdAt" > ${since}
        AND payload @> ${containment}::jsonb
      ORDER BY "createdAt" DESC
      LIMIT 1`;
    return rows[0]?.createdAt ?? null;
  } catch {
    return null;
  }
}

export async function getChannelsOverview(workspaceId: string, now = new Date()): Promise<ChannelsOverview> {
  const accounts = await prisma.instagramAccount.findMany({
    where: { workspaceId },
    orderBy: [{ connectedAt: "desc" }],
    select: {
      ...ALERT_SELECT,
      instagramId: true,
      name: true,
      profilePictureUrl: true,
      disconnectedAt: true,
      webhookFields: true,
      lastError: true,
      lastErrorAt: true,
      moderationSettings: { select: { mode: true } },
    },
  });

  const instagram = await Promise.all(
    accounts.map(async (account): Promise<InstagramChannelCard> => {
      const [activeCampaigns, totalCampaigns, contacts, pendingDrafts, fallbackWebhookAt] = await Promise.all([
        prisma.automation.count({ where: { instagramAccountId: account.id, isActive: true } }),
        prisma.automation.count({ where: { instagramAccountId: account.id } }),
        prisma.contact.count({ where: { instagramAccountId: account.id } }),
        prisma.draftReply.count({ where: { instagramAccountId: account.id, status: "PENDING" } }),
        account.lastWebhookAt ? Promise.resolve(null) : latestWebhookEventAt(workspaceId, account.instagramId),
      ]);
      const lastWebhookAt = account.lastWebhookAt ?? fallbackWebhookAt;
      const forAlerts = { ...account, lastWebhookAt };
      const connected = account.status !== "DISCONNECTED";
      return {
        platform: "instagram",
        id: account.id,
        instagramId: account.instagramId,
        username: account.username,
        name: account.name,
        profilePictureUrl: account.profilePictureUrl,
        status: account.status,
        connectedAt: account.connectedAt.toISOString(),
        reconnectedAt: account.reconnectedAt?.toISOString() ?? null,
        disconnectedAt: account.disconnectedAt?.toISOString() ?? null,
        tokenExpiresAt: connected ? account.tokenExpiresAt?.toISOString() ?? null : null,
        tokenExpiresInDays: connected ? daysLeft(account.tokenExpiresAt, now) : null,
        webhookSubscribed: account.webhookSubscribed,
        webhookFields: account.webhookFields,
        lastWebhookAt: lastWebhookAt?.toISOString() ?? null,
        webhooksStale: isWebhookStale(forAlerts, now),
        lastError: account.lastError,
        lastErrorAt: account.lastErrorAt?.toISOString() ?? null,
        campaigns: { active: activeCampaigns, total: totalCampaigns },
        // No row yet = the default (OBSERVE), same as the worker.
        moderationMode: account.moderationSettings?.mode ?? "OBSERVE",
        contacts,
        pendingDrafts,
        alerts: channelAlerts(forAlerts, now),
      };
    })
  );

  const alerts = instagram.flatMap((card) => card.alerts);
  return {
    instagram,
    comingSoon: COMING_SOON_CHANNELS,
    alerts,
    needsAttention: alerts.length > 0,
    generatedAt: now.toISOString(),
  };
}
