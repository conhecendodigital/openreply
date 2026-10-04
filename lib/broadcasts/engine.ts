/**
 * Etapa 5: broadcast delivery, on the "dm-processing" queue.
 *
 * Instagram (API with Instagram Login) only lets us send a promotional
 * message to someone who talked to the account in the last 24 h, and we never
 * use a message tag (no HUMAN_AGENT). So:
 *
 * - broadcast-start (at scheduledAt): claims SCHEDULED -> SENDING and picks
 *   the recipients THEN (window open, not opted out, no takeover, not mid-flow
 *   / sequence by default). The unique (broadcastId, contactId) is the dedupe.
 * - broadcast-batch (seq): claims Broadcast.batchSeq == seq (a duplicated job
 *   finds nothing), sends up to batchSize, then schedules seq+1 after
 *   pauseSeconds. Before EACH send: broadcast still SENDING (cancel stops it),
 *   channel ACTIVE (sendTracked asserts it again), opt-out, takeover, window,
 *   busy, the hourly bucket (rate:broadcast; a "no" re-queues the batch for
 *   when it frees, nobody is skipped) and the monthly quota; then the row is
 *   claimed PENDING -> SENDING so two workers can never send it twice.
 * - Meta's ambiguous "unknown error" = MAYBE_SENT: never resent.
 * - The sweep (messaging-sweep, every 5 min) starts a SCHEDULED one whose job
 *   was lost, resumes a SENDING one whose next batch is 10 min late, and turns
 *   a recipient stuck in SENDING into MAYBE_SENT.
 */
import { prisma } from "@/lib/db/client";
import { getDMQueue, type DmQueueJob } from "@/lib/queue/client";
import { sendFlowMessage, type FlowMessageButton } from "@/lib/meta/client";
import { sendTracked } from "@/lib/meta/send";
import { decryptToken } from "@/lib/meta/oauth";
import { isChannelOffError } from "@/lib/channels/status";
import { isTakeoverActive } from "@/lib/messaging/takeover";
import { isWindowClosedError, isWindowOpen } from "@/lib/messaging/window";
import { errorMessage, isAmbiguousDeliveryError } from "@/lib/messaging/errors";
import { recordEvent } from "@/lib/contacts/record";
import { releaseWorkspaceDMReservation, reserveWorkspaceDMSend } from "@/lib/billing/usage";
import { reserveBroadcastSlot } from "@/lib/utils/rate-limiter";
import { buildTrackedUrl } from "@/lib/tracking/message";
import { recipientQuery } from "@/lib/tracking/recipient";
import { renderFlowText } from "@/lib/flows/render";
import { broadcastSeed, pickVariant } from "@/lib/ab/variant";
import { countSegment, eligibleContacts, parseFilters } from "@/lib/segments/filters";
import { parseButtons, parseVariants, type BroadcastButton, type BroadcastVariant } from "@/lib/broadcasts/schema";
import {
  BROADCAST_BATCH_JOB_NAME,
  BROADCAST_START_JOB_NAME,
  broadcastJobIds,
  broadcastPayload,
  type BroadcastBatchJob,
  type BroadcastStartJob,
} from "@/lib/broadcasts/jobs";
import type { BroadcastRecipientStatus, BroadcastStatus } from "@/app/generated/prisma/client";

export const STUCK_MS = 10 * 60_000;
const CHUNK = 500;

export type Clock = () => Date;
const systemClock: Clock = () => new Date();

async function enqueue(name: string, data: unknown, jobId: string, delayMs = 0) {
  await getDMQueue().add(name, data as DmQueueJob, {
    jobId,
    attempts: 1,
    ...(delayMs > 0 ? { delay: delayMs } : {}),
  });
}

/** Queue the start job for scheduledAt (also used by the sweep). */
export async function queueBroadcastStart(
  broadcast: { id: string; instagramId: string; scheduledAt: Date | null },
  now: Date = new Date(),
  tag?: string
): Promise<void> {
  const at = broadcast.scheduledAt ?? now;
  const job: BroadcastStartJob = { instagramAccountId: broadcast.instagramId, broadcastId: broadcast.id };
  await enqueue(
    BROADCAST_START_JOB_NAME,
    job,
    broadcastJobIds.start(broadcast.id, tag ?? at.getTime()),
    Math.max(0, at.getTime() - now.getTime())
  );
}

async function queueBatch(
  broadcast: { id: string; instagramId: string },
  seq: number,
  delayMs: number,
  now: Date,
  tag?: string
): Promise<void> {
  await prisma.broadcast.updateMany({
    where: { id: broadcast.id, status: "SENDING" },
    data: { nextBatchAt: new Date(now.getTime() + Math.max(0, delayMs)) },
  });
  const job: BroadcastBatchJob = { instagramAccountId: broadcast.instagramId, broadcastId: broadcast.id, seq };
  try {
    await enqueue(BROADCAST_BATCH_JOB_NAME, job, broadcastJobIds.batch(broadcast.id, seq, tag), delayMs);
  } catch (error) {
    // Redis down: the sweep re-queues it once nextBatchAt is 10 min late.
    console.warn("[Broadcasts] next batch not queued:", errorMessage(error));
  }
}

async function finish(id: string, status: Extract<BroadcastStatus, "DONE" | "FAILED">, reason: string, now: Date) {
  await prisma.broadcast.updateMany({
    where: { id, status: { in: ["SCHEDULED", "SENDING"] } },
    data: { status, stopReason: reason, finishedAt: now, nextBatchAt: null },
  });
}

async function skipPending(broadcastId: string, status: BroadcastRecipientStatus, error?: string) {
  await prisma.broadcastRecipient.updateMany({
    where: { broadcastId, status: "PENDING" },
    data: { status, ...(error ? { error } : {}) },
  });
}

const FAILED_STATUSES = new Set<string>(["FAILED", "MAYBE_SENT"]);

/** Counters from the recipients (never drift with retries). */
export async function refreshBroadcastCounts(broadcastId: string) {
  const rows = await prisma.broadcastRecipient.groupBy({
    by: ["status"],
    where: { broadcastId },
    _count: { _all: true },
  });
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    const n = r._count?._all ?? 0;
    if (r.status === "SENT") sent += n;
    else if (FAILED_STATUSES.has(r.status)) failed += n;
    else if (String(r.status).startsWith("SKIPPED_")) skipped += n;
  }
  await prisma.broadcast.updateMany({
    where: { id: broadcastId },
    data: { sentCount: sent, failedCount: failed, skippedCount: skipped },
  });
  return { sent, failed, skipped };
}

// ─── Start ──────────────────────────────────────────────────────────────────

export type StartOutcome = "noop" | "early" | "started" | "empty" | "channel_off";

export async function runBroadcastStart(data: BroadcastStartJob, clock: Clock = systemClock): Promise<StartOutcome> {
  const now = clock();
  const b = await prisma.broadcast.findUnique({
    where: { id: data.broadcastId },
    include: { instagramAccount: { select: { id: true, instagramId: true, status: true } } },
  });
  if (!b || b.status !== "SCHEDULED") return "noop";
  if (b.instagramAccount.instagramId !== data.instagramAccountId) return "noop";
  if (b.scheduledAt && b.scheduledAt.getTime() > now.getTime() + 5_000) {
    // Rescheduled to later (or a sweep fired early): wait for the right time.
    // Own job id: this job is still active, and BullMQ ignores an add whose
    // id it already holds (the start would then wait for the sweep).
    await queueBroadcastStart(
      { id: b.id, instagramId: b.instagramAccount.instagramId, scheduledAt: b.scheduledAt },
      now,
      `early${now.getTime()}`
    );
    return "early";
  }
  const claimed = await prisma.broadcast.updateMany({
    where: { id: b.id, status: "SCHEDULED" },
    data: { status: "SENDING", startedAt: now, batchSeq: 0, nextBatchAt: now },
  });
  if (claimed.count === 0) return "noop";

  if (b.instagramAccount.status !== "ACTIVE") {
    await finish(b.id, "FAILED", "channel_off", now);
    return "channel_off";
  }

  // The segment as it is NOW (the person approved the segment, not a list).
  let filtersJson: unknown = b.filtersSnapshot;
  if (b.segmentId) {
    const segment = await prisma.segment.findFirst({
      where: { id: b.segmentId, workspaceId: b.workspaceId },
      select: { filters: true },
    });
    if (segment) filtersJson = segment.filters;
  }
  const filters = parseFilters(filtersJson);
  const scope = { workspaceId: b.workspaceId, instagramAccountId: b.instagramAccountId };
  const counts = await countSegment(scope, filters, { now, skipBusy: b.skipBusy });
  const people = await eligibleContacts(scope, filters, { now, skipBusy: b.skipBusy });
  const variants = parseVariants(b.variants);

  const rows = people.map((p) => ({
    broadcastId: b.id,
    workspaceId: b.workspaceId,
    contactId: p.id,
    igUserId: p.igUserId,
    variantKey: variants.length > 0 ? (pickVariant(broadcastSeed(b.id, p.igUserId), variants)?.key ?? null) : null,
  }));
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.broadcastRecipient.createMany({ data: rows.slice(i, i + CHUNK), skipDuplicates: true });
  }
  await prisma.broadcast.update({
    where: { id: b.id },
    data: {
      filtersSnapshot: filters as unknown as object,
      segmentCount: counts.total,
      eligibleCount: rows.length,
    },
  });

  if (rows.length === 0) {
    await finish(b.id, "DONE", "no_open_window", now);
    return "empty";
  }
  await queueBatch({ id: b.id, instagramId: b.instagramAccount.instagramId }, 0, 0, now);
  return "started";
}

// ─── Batch ──────────────────────────────────────────────────────────────────

export type BatchOutcome =
  | "noop"
  | "duplicate"
  | "canceled"
  | "rate_limited"
  | "monthly_limit"
  | "channel_off"
  | "next"
  | "done";

type RecipientContact = {
  lastInboundAt: Date | null;
  humanTakeover: boolean;
  humanTakeoverUntil: Date | null;
  broadcastOptOutAt: Date | null;
  username: string | null;
  name: string | null;
};

/** Why this person must NOT get it right now (null = may send). */
export function recipientBlock(
  contact: RecipientContact | null | undefined,
  now: Date
): Extract<BroadcastRecipientStatus, "SKIPPED_OPTOUT" | "SKIPPED_TAKEOVER" | "SKIPPED_WINDOW"> | null {
  if (!contact) return "SKIPPED_WINDOW";
  if (contact.broadcastOptOutAt) return "SKIPPED_OPTOUT";
  if (isTakeoverActive(contact, now)) return "SKIPPED_TAKEOVER";
  if (!isWindowOpen(contact, now)) return "SKIPPED_WINDOW";
  return null;
}

/** Same rule as eligibilitySql's busy (lib/segments/filters.ts). */
async function isBusy(contactId: string, now: Date): Promise<boolean> {
  const [run, enrollment] = await Promise.all([
    prisma.flowRun.findFirst({
      where: {
        contactId,
        OR: [
          { status: { in: ["ACTIVE", "WAITING_DELAY"] } },
          { status: "WAITING_REPLY", waitingUntil: { gt: now } },
        ],
      },
      select: { id: true },
    }),
    prisma.sequenceEnrollment.findFirst({ where: { contactId, status: "ACTIVE" }, select: { id: true } }),
  ]);
  return Boolean(run || enrollment);
}

/** The text this person gets: the winner, their variant, or the broadcast's. */
export function textFor(
  broadcast: { text: string; abWinnerKey: string | null },
  variants: BroadcastVariant[],
  variantKey: string | null
): string {
  if (variants.length > 0) {
    const key = broadcast.abWinnerKey ?? variantKey;
    const v = key ? variants.find((x) => x.key === key) : null;
    if (v) return v.text;
  }
  return broadcast.text;
}

export function buttonsFor(
  buttons: BroadcastButton[],
  slugs: Map<string, string>,
  recipient: { id: string; igUserId: string }
): FlowMessageButton[] {
  return buttons.map((b) => {
    if (b.kind === "flow") {
      return { kind: "postback", title: b.label, payload: broadcastPayload(recipient.id, b.id) };
    }
    const slug = slugs.get(b.id);
    return {
      kind: "link",
      title: b.label,
      url: slug ? buildTrackedUrl(slug, undefined, recipientQuery(slug, recipient.igUserId)) : b.url,
    };
  });
}

export async function runBroadcastBatch(data: BroadcastBatchJob, clock: Clock = systemClock): Promise<BatchOutcome> {
  const started = clock();
  const b = await prisma.broadcast.findUnique({
    where: { id: data.broadcastId },
    include: {
      instagramAccount: { select: { id: true, instagramId: true, status: true, accessToken: true } },
      links: { select: { buttonId: true, slug: true } },
    },
  });
  if (!b || b.status !== "SENDING") return "noop";
  if (b.instagramAccount.instagramId !== data.instagramAccountId) return "noop";
  const claim = await prisma.broadcast.updateMany({
    where: { id: b.id, status: "SENDING", batchSeq: data.seq },
    data: { batchSeq: data.seq + 1, nextBatchAt: null },
  });
  if (claim.count === 0) return "duplicate";
  const nextSeq = data.seq + 1;
  const ref = { id: b.id, instagramId: b.instagramAccount.instagramId };

  if (b.instagramAccount.status !== "ACTIVE") {
    await skipPending(b.id, "SKIPPED_CHANNEL");
    await refreshBroadcastCounts(b.id);
    await finish(b.id, "FAILED", "channel_off", started);
    return "channel_off";
  }
  let accessToken: string;
  try {
    accessToken = decryptToken(b.instagramAccount.accessToken);
  } catch {
    await skipPending(b.id, "SKIPPED_CHANNEL", "token");
    await refreshBroadcastCounts(b.id);
    await finish(b.id, "FAILED", "token", started);
    return "channel_off";
  }

  const buttons = parseButtons(b.buttons);
  const variants = parseVariants(b.variants);
  const slugs = new Map((Array.isArray(b.links) ? b.links : []).map((l) => [l.buttonId, l.slug]));

  const pending = await prisma.broadcastRecipient.findMany({
    where: { broadcastId: b.id, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: b.batchSize,
    include: {
      contact: {
        select: {
          lastInboundAt: true,
          humanTakeover: true,
          humanTakeoverUntil: true,
          broadcastOptOutAt: true,
          username: true,
          name: true,
        },
      },
    },
  });

  for (const r of Array.isArray(pending) ? pending : []) {
    const now = clock();
    // Cancel stops the batch between two people (cancel already marked the rest).
    const current = await prisma.broadcast.findUnique({ where: { id: b.id }, select: { status: true, abWinnerKey: true } });
    if (!current || current.status !== "SENDING") {
      // Cancel counted before the send in flight finished: count again.
      await refreshBroadcastCounts(b.id);
      return "canceled";
    }

    const block = recipientBlock(r.contact, now);
    if (block) {
      await prisma.broadcastRecipient.updateMany({ where: { id: r.id, status: "PENDING" }, data: { status: block } });
      continue;
    }
    if (b.skipBusy && (await isBusy(r.contactId, now))) {
      await prisma.broadcastRecipient.updateMany({ where: { id: r.id, status: "PENDING" }, data: { status: "SKIPPED_BUSY" } });
      continue;
    }

    const rate = await reserveBroadcastSlot(ref.instagramId);
    if (!rate.allowed) {
      // Nobody is skipped: the batch comes back when the bucket frees.
      await refreshBroadcastCounts(b.id);
      await queueBatch(ref, nextSeq, rate.retryInMs, now);
      return "rate_limited";
    }
    const usage = await reserveWorkspaceDMSend(b.workspaceId);
    if (!usage.allowed) {
      await skipPending(b.id, "SKIPPED_LIMIT", "monthly_limit");
      await refreshBroadcastCounts(b.id);
      await finish(b.id, "DONE", "monthly_limit", now);
      return "monthly_limit";
    }
    const claimed = await prisma.broadcastRecipient.updateMany({
      where: { id: r.id, status: "PENDING" },
      data: { status: "SENDING" },
    });
    if (claimed.count === 0) {
      await releaseWorkspaceDMReservation(b.workspaceId, usage.periodStart).catch(() => undefined);
      continue;
    }

    const raw = textFor({ text: b.text, abWinnerKey: current.abWinnerKey ?? b.abWinnerKey }, variants, r.variantKey);
    const text = renderFlowText(raw, { username: r.contact?.username, name: r.contact?.name }) || raw.trim();
    const messageButtons = buttonsFor(buttons, slugs, r);
    try {
      const result = await sendTracked(
        {
          workspaceId: b.workspaceId,
          instagramAccountId: b.instagramAccountId,
          contactIgUserId: r.igUserId,
          origin: "broadcast",
          refId: r.id,
          text,
        },
        (o) => sendFlowMessage(accessToken, ref.instagramId, { id: r.igUserId }, text, messageButtons, o)
      );
      const sentAt = clock();
      await prisma.broadcastRecipient.updateMany({
        where: { id: r.id },
        data: { status: "SENT", mid: result?.message_id ?? null, sentAt, error: null },
      });
      await recordEvent(
        { id: r.contactId, workspaceId: b.workspaceId },
        {
          type: "BROADCAST_SENT",
          refId: r.id,
          occurredAt: sentAt,
          text: b.name,
          meta: { broadcastId: b.id, ...(r.variantKey ? { variantKey: r.variantKey } : {}) },
        }
      ).catch(() => undefined);
    } catch (error) {
      await releaseWorkspaceDMReservation(b.workspaceId, usage.periodStart).catch(() => undefined);
      if (isChannelOffError(error)) {
        await prisma.broadcastRecipient.updateMany({ where: { id: r.id }, data: { status: "SKIPPED_CHANNEL" } });
        await skipPending(b.id, "SKIPPED_CHANNEL");
        await refreshBroadcastCounts(b.id);
        await finish(b.id, "FAILED", "channel_off", clock());
        return "channel_off";
      }
      const status: BroadcastRecipientStatus = isAmbiguousDeliveryError(error)
        ? "MAYBE_SENT"
        : isWindowClosedError(error)
          ? "SKIPPED_WINDOW"
          : "FAILED";
      await prisma.broadcastRecipient.updateMany({
        where: { id: r.id },
        data: { status, error: errorMessage(error).slice(0, 500) },
      });
    }
  }

  await refreshBroadcastCounts(b.id);
  const left = await prisma.broadcastRecipient.count({ where: { broadcastId: b.id, status: "PENDING" } });
  if (left > 0) {
    await queueBatch(ref, nextSeq, b.pauseSeconds * 1000, clock());
    return "next";
  }
  await finish(b.id, "DONE", "done", clock());
  return "done";
}

// ─── Cancel / sweep ─────────────────────────────────────────────────────────

/** Stop it: no new send starts (the one in flight, if any, finishes). */
export async function cancelBroadcast(id: string, workspaceId: string, by: string, now: Date = new Date()) {
  const { count } = await prisma.broadcast.updateMany({
    where: { id, workspaceId, status: { in: ["DRAFT", "SCHEDULED", "SENDING"] } },
    data: { status: "CANCELED", canceledAt: now, canceledBy: by, finishedAt: now, nextBatchAt: null },
  });
  if (count === 0) return false;
  await skipPending(id, "SKIPPED_CANCELED");
  await refreshBroadcastCounts(id);
  return true;
}

export async function sweepBroadcasts(now: Date = new Date()) {
  const stale = new Date(now.getTime() - STUCK_MS);
  const tag = `sweep${Math.floor(now.getTime() / 60_000)}`;
  let started = 0;
  let resumed = 0;

  const due = await prisma.broadcast.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date(now.getTime() - 2 * 60_000) } },
    select: { id: true, scheduledAt: true, instagramAccount: { select: { instagramId: true } } },
    take: 50,
  });
  for (const b of Array.isArray(due) ? due : []) {
    await queueBroadcastStart({ id: b.id, instagramId: b.instagramAccount.instagramId, scheduledAt: b.scheduledAt }, now, tag)
      .then(() => {
        started += 1;
      })
      .catch(() => undefined);
  }

  const stuck = await prisma.broadcast.findMany({
    where: {
      status: "SENDING",
      OR: [{ nextBatchAt: { lt: stale } }, { nextBatchAt: null, updatedAt: { lt: stale } }],
    },
    select: { id: true, batchSeq: true, instagramAccount: { select: { instagramId: true } } },
    take: 50,
  });
  for (const b of Array.isArray(stuck) ? stuck : []) {
    await queueBatch({ id: b.id, instagramId: b.instagramAccount.instagramId }, b.batchSeq, 0, now, tag);
    resumed += 1;
  }

  // A send that never came back (worker died mid-POST): maybe delivered.
  const maybe = await prisma.broadcastRecipient.updateMany({
    where: { status: "SENDING", updatedAt: { lt: stale } },
    data: { status: "MAYBE_SENT", error: "stuck in sending (worker stopped)" },
  });
  return { started, resumed, maybeSent: maybe?.count ?? 0 };
}
