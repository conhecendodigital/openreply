/**
 * Fill Contacts from history. Safe to re-run: every event is unique on
 * (contact, type, refId), so counters never double.
 *
 * Sources, in this order (so "respondeu DM" can see the campaign first):
 *   1. WebhookEvent comment payloads → COMMENT (every comment, with @username)
 *   2. DmLog → COMMENT + "comentou:<palavra>"; SENT → CAMPAIGN_SENT + "recebeu:<campanha>"
 *   3. DirectMessage → DM_IN / DM_OUT
 *   4. LinkClick with a known recipient → CLICK + "clicou"
 * Old LinkClicks have no person (only an IP hash), so they stay out.
 */
import { prisma } from "@/lib/db/client";
import { parseCommentEvents } from "@/lib/meta/webhook";
import {
  AUTO_TAGS,
  onDirectMessage,
  trackInteraction,
} from "@/lib/contacts/record";

export type BackfillOptions = {
  dryRun?: boolean;
  workspaceId?: string;
  batchSize?: number;
  log?: (line: string) => void;
};

export type BackfillStats = {
  webhookComments: number;
  dmLogComments: number;
  campaignsSent: number;
  directMessages: number;
  clicks: number;
  clicksWithoutPerson: number;
  newEvents: number;
  dryRun: boolean;
};

type AccountRow = { id: string; workspaceId: string; instagramId: string };

const DMLOG_SYNTHETIC = /^(reveal|dm):/;

export async function backfillContacts(options: BackfillOptions = {}): Promise<BackfillStats> {
  const dryRun = Boolean(options.dryRun);
  const take = options.batchSize ?? 500;
  const log = options.log ?? (() => {});
  const stats: BackfillStats = {
    webhookComments: 0,
    dmLogComments: 0,
    campaignsSent: 0,
    directMessages: 0,
    clicks: 0,
    clicksWithoutPerson: 0,
    newEvents: 0,
    dryRun,
  };

  const accounts = await prisma.instagramAccount.findMany({
    where: options.workspaceId ? { workspaceId: options.workspaceId } : {},
    select: { id: true, workspaceId: true, instagramId: true },
  });
  const byInstagramId = new Map<string, AccountRow>(accounts.map((a) => [a.instagramId, a]));
  const byId = new Map<string, AccountRow>(accounts.map((a) => [a.id, a]));
  const count = (inserted: boolean | undefined) => {
    if (inserted) stats.newEvents += 1;
  };

  // 1. Webhook comment payloads.
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.webhookEvent.findMany({
      where: {
        object: "instagram",
        ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      },
      orderBy: { id: "asc" },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, payload: true, createdAt: true },
    });
    if (batch.length === 0) break;
    for (const ev of batch) {
      let events: ReturnType<typeof parseCommentEvents> = [];
      try {
        events = parseCommentEvents(ev.payload as unknown as Parameters<typeof parseCommentEvents>[0]);
      } catch {
        continue;
      }
      for (const c of events) {
        const account = byInstagramId.get(c.instagramAccountId);
        if (!account) continue;
        stats.webhookComments += 1;
        if (dryRun) continue;
        const r = await trackInteraction({
          account,
          igUserId: c.commenterId,
          username: c.commenterName,
          event: {
            type: "COMMENT",
            refId: c.commentId,
            occurredAt: ev.createdAt,
            text: c.commentText,
            mediaId: c.mediaId,
          },
        });
        count(r?.inserted);
      }
    }
    cursor = batch[batch.length - 1].id;
    log(`[backfill] webhooks até ${cursor}: ${stats.webhookComments} comentários`);
  }

  // 2. DmLog (comments that matched a campaign, and the campaigns sent).
  let logCursor: string | undefined;
  for (;;) {
    const batch = await prisma.dmLog.findMany({
      where: options.workspaceId ? { workspaceId: options.workspaceId } : {},
      orderBy: { id: "asc" },
      take,
      ...(logCursor ? { skip: 1, cursor: { id: logCursor } } : {}),
      select: {
        id: true,
        instagramAccountId: true,
        commenterId: true,
        commenterName: true,
        commentId: true,
        commentText: true,
        matchedKeyword: true,
        status: true,
        dmSentAt: true,
        createdAt: true,
        automation: { select: { id: true, name: true, keywords: true } },
      },
    });
    if (batch.length === 0) break;
    for (const row of batch) {
      const account = byId.get(row.instagramAccountId);
      if (!account) continue;
      const isComment = !DMLOG_SYNTHETIC.test(row.commentId);
      if (isComment) stats.dmLogComments += 1;
      if (row.status === "SENT") stats.campaignsSent += 1;
      if (dryRun) continue;

      if (isComment) {
        const r = await trackInteraction({
          account,
          igUserId: row.commenterId,
          username: row.commenterName,
          event: {
            type: "COMMENT",
            refId: row.commentId,
            occurredAt: row.createdAt,
            text: row.commentText,
          },
          tags: [AUTO_TAGS.commented(row.matchedKeyword ?? row.automation.keywords[0])],
        });
        count(r?.inserted);
      }
      if (row.status === "SENT") {
        const r = await trackInteraction({
          account,
          igUserId: row.commenterId,
          username: row.commenterName,
          event: {
            type: "CAMPAIGN_SENT",
            refId: row.id,
            occurredAt: row.dmSentAt ?? row.createdAt,
            automationId: row.automation.id,
            text: row.automation.name,
          },
          tags: [AUTO_TAGS.received(row.automation.name)],
        });
        count(r?.inserted);
      }
    }
    logCursor = batch[batch.length - 1].id;
    log(`[backfill] DmLog até ${logCursor}: ${stats.dmLogComments} comentários, ${stats.campaignsSent} campanhas`);
  }

  // 3. DirectMessage history.
  let dmCursor: string | undefined;
  for (;;) {
    const batch = await prisma.directMessage.findMany({
      where: {
        deleted: false,
        ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      },
      orderBy: { id: "asc" },
      take,
      ...(dmCursor ? { skip: 1, cursor: { id: dmCursor } } : {}),
      select: {
        id: true,
        accountId: true,
        contactId: true,
        mid: true,
        fromMe: true,
        text: true,
        sentAt: true,
        storyReply: true,
      },
    });
    if (batch.length === 0) break;
    for (const m of batch) {
      const account = byInstagramId.get(m.accountId);
      if (!account) continue;
      stats.directMessages += 1;
      if (dryRun) continue;
      const r = await onDirectMessage({
        account,
        igUserId: m.contactId,
        mid: m.mid,
        fromMe: m.fromMe,
        text: m.text,
        sentAt: m.sentAt,
        storyReply: m.storyReply,
      });
      count(r?.inserted);
    }
    dmCursor = batch[batch.length - 1].id;
    log(`[backfill] DMs até ${dmCursor}: ${stats.directMessages}`);
  }

  // 4. Clicks with a known recipient (only links sent after this release).
  stats.clicksWithoutPerson = await prisma.linkClick.count({
    where: {
      contactIgUserId: null,
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    },
  });
  let clickCursor: string | undefined;
  for (;;) {
    const batch = await prisma.linkClick.findMany({
      where: {
        contactIgUserId: { not: null },
        ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      },
      orderBy: { id: "asc" },
      take,
      ...(clickCursor ? { skip: 1, cursor: { id: clickCursor } } : {}),
      select: {
        id: true,
        instagramAccountId: true,
        contactIgUserId: true,
        createdAt: true,
        automation: { select: { id: true, name: true } },
      },
    });
    if (batch.length === 0) break;
    for (const click of batch) {
      const account = byId.get(click.instagramAccountId);
      if (!account || !click.contactIgUserId) continue;
      stats.clicks += 1;
      if (dryRun) continue;
      const r = await trackInteraction({
        account,
        igUserId: click.contactIgUserId,
        event: {
          type: "CLICK",
          refId: click.id,
          occurredAt: click.createdAt,
          automationId: click.automation.id,
          text: click.automation.name,
        },
        tags: [AUTO_TAGS.clicked, AUTO_TAGS.clickedCampaign(click.automation.name)],
      });
      count(r?.inserted);
    }
    clickCursor = batch[batch.length - 1].id;
  }

  return stats;
}
