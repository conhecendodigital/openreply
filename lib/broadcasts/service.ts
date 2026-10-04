/**
 * Broadcasts as the routes see them: create a DRAFT (people and API keys),
 * send / schedule (signed-in OWNER/ADMIN only, enforced in the route), the
 * history numbers (sent, failed, clicks, replies, per A/B variant).
 */
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { ctr } from "@/lib/ab/keys";
import { parseFilters, countSegment, type SegmentFilters } from "@/lib/segments/filters";
import { parseButtons, parseVariants } from "@/lib/broadcasts/schema";
import { syncBroadcastLinks } from "@/lib/broadcasts/links";
import { queueBroadcastStart } from "@/lib/broadcasts/engine";

/** Replies are counted when the person writes within this long after the send. */
export const REPLY_WINDOW_HOURS = 72;
export const MAX_SCHEDULE_DAYS = 30;

export const BROADCAST_SELECT = {
  id: true,
  workspaceId: true,
  instagramAccountId: true,
  segmentId: true,
  filtersSnapshot: true,
  name: true,
  text: true,
  buttons: true,
  variants: true,
  abWinnerKey: true,
  skipBusy: true,
  status: true,
  stopReason: true,
  scheduledAt: true,
  startedAt: true,
  finishedAt: true,
  canceledAt: true,
  canceledBy: true,
  createdBy: true,
  createdVia: true,
  sentBy: true,
  batchSize: true,
  pauseSeconds: true,
  segmentCount: true,
  eligibleCount: true,
  sentCount: true,
  failedCount: true,
  skippedCount: true,
  createdAt: true,
  updatedAt: true,
  segment: { select: { id: true, name: true } },
  instagramAccount: { select: { username: true, status: true } },
} as const;

export type BroadcastRow = Prisma.BroadcastGetPayload<{ select: typeof BROADCAST_SELECT }>;

export function presentBroadcast(b: BroadcastRow) {
  return {
    id: b.id,
    name: b.name,
    status: b.status,
    stopReason: b.stopReason,
    instagramAccountId: b.instagramAccountId,
    account: b.instagramAccount ? { username: b.instagramAccount.username, status: b.instagramAccount.status } : null,
    segmentId: b.segmentId,
    segmentName: b.segment?.name ?? null,
    filters: parseFilters(b.filtersSnapshot),
    text: b.text,
    buttons: parseButtons(b.buttons),
    variants: parseVariants(b.variants),
    abWinnerKey: b.abWinnerKey,
    skipBusy: b.skipBusy,
    scheduledAt: b.scheduledAt,
    startedAt: b.startedAt,
    finishedAt: b.finishedAt,
    canceledAt: b.canceledAt,
    createdVia: b.createdVia,
    createdBy: b.createdBy,
    sentBy: b.sentBy,
    batchSize: b.batchSize,
    pauseSeconds: b.pauseSeconds,
    counts: {
      segment: b.segmentCount,
      eligible: b.eligibleCount,
      sent: b.sentCount,
      failed: b.failedCount,
      skipped: b.skippedCount,
    },
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

export async function findBroadcast(id: string, workspaceId: string) {
  return prisma.broadcast.findFirst({ where: { id, workspaceId }, select: BROADCAST_SELECT });
}

/** Filters of a broadcast: its segment's (now), else its own snapshot. */
export async function broadcastFilters(b: { workspaceId: string; segmentId: string | null; filtersSnapshot: unknown }): Promise<SegmentFilters> {
  if (b.segmentId) {
    const segment = await prisma.segment.findFirst({
      where: { id: b.segmentId, workspaceId: b.workspaceId },
      select: { filters: true },
    });
    if (segment) return parseFilters(segment.filters);
  }
  return parseFilters(b.filtersSnapshot);
}

/** "X in the segment, Y with the conversation open now (only those get it)". */
export async function broadcastAudience(b: BroadcastRow, now: Date = new Date()) {
  const filters = await broadcastFilters(b);
  return countSegment({ workspaceId: b.workspaceId, instagramAccountId: b.instagramAccountId }, filters, {
    now,
    skipBusy: b.skipBusy,
  });
}

export type VariantStats = {
  key: string | null;
  sent: number;
  failed: number;
  skipped: number;
  clicked: number;
  replied: number;
  ctr: number;
};

type StatRow = { key: string | null; sent: number; failed: number; skipped: number; clicked: number; replied: number };

export async function broadcastStats(broadcastId: string) {
  const [rows, statusRows, clicksTotal] = await Promise.all([
    prisma.$queryRaw<StatRow[]>(Prisma.sql`
      SELECT r."variantKey" AS "key",
        count(*) FILTER (WHERE r."status" = 'SENT')::int AS "sent",
        count(*) FILTER (WHERE r."status" IN ('FAILED', 'MAYBE_SENT'))::int AS "failed",
        count(*) FILTER (WHERE r."status"::text LIKE 'SKIPPED_%')::int AS "skipped",
        count(*) FILTER (WHERE r."status" = 'SENT' AND EXISTS (
          SELECT 1 FROM "BroadcastLinkClick" lc WHERE lc."recipientId" = r."id"))::int AS "clicked",
        count(*) FILTER (WHERE r."status" = 'SENT' AND EXISTS (
          SELECT 1 FROM "ContactEvent" e WHERE e."contactId" = r."contactId" AND e."type" = 'DM_IN'
            AND e."occurredAt" > r."sentAt"
            AND e."occurredAt" <= r."sentAt" + make_interval(hours => ${REPLY_WINDOW_HOURS}::int)))::int AS "replied"
      FROM "BroadcastRecipient" r
      WHERE r."broadcastId" = ${broadcastId}
      GROUP BY r."variantKey"
      ORDER BY r."variantKey" NULLS FIRST`),
    prisma.broadcastRecipient.groupBy({ by: ["status"], where: { broadcastId }, _count: { _all: true } }),
    prisma.broadcastLinkClick.count({ where: { broadcastId } }),
  ]);
  const variants: VariantStats[] = (Array.isArray(rows) ? rows : []).map((r) => ({
    key: r.key,
    sent: Number(r.sent ?? 0),
    failed: Number(r.failed ?? 0),
    skipped: Number(r.skipped ?? 0),
    clicked: Number(r.clicked ?? 0),
    replied: Number(r.replied ?? 0),
    ctr: ctr(Number(r.clicked ?? 0), Number(r.sent ?? 0)),
  }));
  const sum = (k: keyof Omit<VariantStats, "key" | "ctr">) => variants.reduce((s, v) => s + v[k], 0);
  const byStatus: Record<string, number> = {};
  for (const s of Array.isArray(statusRows) ? statusRows : []) byStatus[s.status] = s._count?._all ?? 0;
  const totals = {
    sent: sum("sent"),
    failed: sum("failed"),
    skipped: sum("skipped"),
    clicked: sum("clicked"),
    replied: sum("replied"),
    clicks: Number(clicksTotal ?? 0),
    pending: (byStatus.PENDING ?? 0) + (byStatus.SENDING ?? 0),
    maybeSent: byStatus.MAYBE_SENT ?? 0,
  };
  return {
    totals: { ...totals, ctr: ctr(totals.clicked, totals.sent) },
    byStatus,
    variants: variants.filter((v) => v.key !== null),
    replyWindowHours: REPLY_WINDOW_HOURS,
  };
}

export class BroadcastSendError extends Error {
  constructor(
    readonly code: "not_draft" | "channel_off" | "flow_off" | "too_far" | "no_text",
    message: string
  ) {
    super(message);
  }
}

/**
 * DRAFT -> SCHEDULED (now or later). Creates the tracked links and queues the
 * start job; the recipients are picked when it starts. Flow buttons must point
 * at a published flow that is ON (re-checked again on every tap).
 */
export async function sendBroadcast(
  b: BroadcastRow,
  input: { userId: string; scheduledAt?: Date | null; now?: Date }
) {
  const now = input.now ?? new Date();
  if (b.status !== "DRAFT") throw new BroadcastSendError("not_draft", "Only a draft can be sent");
  if (!b.instagramAccount || b.instagramAccount.status !== "ACTIVE") {
    throw new BroadcastSendError("channel_off", "The Instagram channel is off");
  }
  const scheduledAt = input.scheduledAt && input.scheduledAt.getTime() > now.getTime() ? input.scheduledAt : now;
  if (scheduledAt.getTime() - now.getTime() > MAX_SCHEDULE_DAYS * 86_400_000) {
    throw new BroadcastSendError("too_far", `Schedule at most ${MAX_SCHEDULE_DAYS} days ahead`);
  }
  const buttons = parseButtons(b.buttons);
  const flowIds = buttons.flatMap((x) => (x.kind === "flow" ? [x.flowId] : []));
  if (flowIds.length > 0) {
    const flows = await prisma.flow.findMany({
      where: { id: { in: flowIds }, workspaceId: b.workspaceId, instagramAccountId: b.instagramAccountId, isActive: true },
      select: { id: true, published: true },
    });
    const ok = new Set((Array.isArray(flows) ? flows : []).filter((f) => f.published).map((f) => f.id));
    if (flowIds.some((id) => !ok.has(id))) {
      throw new BroadcastSendError("flow_off", "A button points to a flow that is not published and on");
    }
  }
  await syncBroadcastLinks({ id: b.id, workspaceId: b.workspaceId }, buttons);
  const filters = await broadcastFilters(b);
  const { count } = await prisma.broadcast.updateMany({
    where: { id: b.id, status: "DRAFT" },
    data: {
      status: "SCHEDULED",
      scheduledAt,
      sentBy: input.userId,
      filtersSnapshot: filters as unknown as Prisma.InputJsonValue,
    },
  });
  if (count === 0) throw new BroadcastSendError("not_draft", "Only a draft can be sent");
  const account = await prisma.instagramAccount.findUnique({
    where: { id: b.instagramAccountId },
    select: { instagramId: true },
  });
  if (account) {
    // A lost job is picked up by the sweep (SCHEDULED past due).
    await queueBroadcastStart({ id: b.id, instagramId: account.instagramId, scheduledAt }, now).catch((error) =>
      console.warn("[Broadcasts] start not queued (the sweep will):", error instanceof Error ? error.message : error)
    );
  }
  return { scheduledAt };
}
