/**
 * Campaign sequences inside the 24-hour window.
 *
 * - Enrollment happens right after a campaign delivered its link (button tap,
 *   DM keyword, comment, ig.me link). One per (sequence, person), ever: a
 *   person who triggers the campaign again does not get the sequence twice.
 * - Every step re-checks, at send time: enrollment still ACTIVE and at the
 *   previous step, sequence and campaign on, no human takeover, and the window
 *   open (with the 30 min margin). A closed window stops the sequence; nothing
 *   is ever sent outside it, so nothing promotional can leave the window.
 * - The person replying stops it (they are talking now: a human or the
 *   vendedor answers). Exception: when the link went as a private reply to a
 *   comment the window is not open yet, so the enrollment waits for that
 *   first reply (waitingReply), which opens the window and starts the steps.
 * - Idempotent: the step is claimed with UPDATE ... WHERE lastStepOrder =
 *   order - 1 before sending, so a retried or duplicated job never re-sends.
 */
import { prisma } from "@/lib/db/client";
import { getDMQueue, SEQUENCE_STEP_JOB_NAME } from "@/lib/queue/client";
import { recordEvent, upsertContact } from "@/lib/contacts/record";
import { isTakeoverActive } from "@/lib/messaging/takeover";
import { isWindowOpen, isWindowClosedError, latest } from "@/lib/messaging/window";
import { isAmbiguousDeliveryError, errorMessage } from "@/lib/messaging/errors";
import { sendDirectMessage } from "@/lib/meta/client";
import { sendTracked } from "@/lib/meta/send";
import { decryptToken } from "@/lib/meta/oauth";
import { releaseWorkspaceDMReservation, reserveWorkspaceDMSend } from "@/lib/billing/usage";
import { renderMessageWithTracking } from "@/lib/tracking/message";
import { recipientQuery } from "@/lib/tracking/recipient";

/** A private reply opens no window; the person has 7 days to answer it. */
const WAITING_REPLY_MAX_MS = 7 * 24 * 3_600_000;

export type EnrollAutomation = {
  id: string;
  workspaceId: string;
  instagramAccountId: string;
  instagramAccount: { instagramId: string; status?: string };
};

function stepJobId(enrollmentId: string, order: number, suffix = "") {
  return `seq_${enrollmentId}_${order}${suffix}`;
}

async function scheduleStep(
  instagramId: string,
  enrollmentId: string,
  order: number,
  delayMinutes: number,
  suffix = ""
) {
  await getDMQueue().add(
    SEQUENCE_STEP_JOB_NAME,
    { instagramAccountId: instagramId, enrollmentId, order },
    { delay: Math.max(0, delayMinutes) * 60_000, jobId: stepJobId(enrollmentId, order, suffix) }
  );
}

/** Enroll the person in the campaign's sequence, if it has one. Never throws. */
export async function enrollInSequence(input: {
  automation: EnrollAutomation;
  igUserId: string;
  username?: string | null;
  /** The person's own interaction that opened the window (tap / DM), if any. */
  inboundAt?: Date | null;
  now?: Date;
}): Promise<{ enrollmentId: string; waitingReply: boolean } | null> {
  const now = input.now ?? new Date();
  // Channel off: nobody new is enrolled (nothing could be sent).
  const status = input.automation.instagramAccount.status;
  if (status && status !== "ACTIVE") return null;
  try {
    const sequence = await prisma.sequence.findUnique({
      where: { automationId: input.automation.id },
      include: { steps: { orderBy: { order: "asc" } } },
    });
    if (!sequence || !sequence.isActive || sequence.steps.length === 0) return null;

    const ref = await upsertContact({
      workspaceId: input.automation.workspaceId,
      instagramAccountId: input.automation.instagramAccountId,
      igUserId: input.igUserId,
      username: input.username,
      at: now,
    });
    const contact = await prisma.contact.findUnique({
      where: { id: ref.id },
      select: { id: true, lastInboundAt: true, humanTakeover: true, humanTakeoverUntil: true },
    });
    if (!contact || isTakeoverActive(contact, now)) return null;

    const waitingReply = !isWindowOpen({ lastInboundAt: latest(contact.lastInboundAt, input.inboundAt) }, now);

    let enrollmentId: string;
    try {
      const created = await prisma.sequenceEnrollment.create({
        data: {
          workspaceId: input.automation.workspaceId,
          sequenceId: sequence.id,
          contactId: contact.id,
          startedAt: now,
          waitingReply,
        },
        select: { id: true },
      });
      enrollmentId = created.id;
    } catch (error) {
      // Already enrolled once in this sequence: never twice.
      if ((error as { code?: string })?.code === "P2002") return null;
      throw error;
    }

    await scheduleStep(input.automation.instagramAccount.instagramId, enrollmentId, 1, sequence.steps[0].delayMinutes);
    return { enrollmentId, waitingReply };
  } catch (error) {
    console.warn("[Sequence] Could not enroll:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * The person sent a DM. Active sequences started before it stop
 * (STOPPED_REPLY), except those waiting for exactly this first reply, which
 * start their next step now.
 */
export async function onPersonReplied(input: {
  contactId: string;
  instagramId: string;
  at: Date;
}): Promise<{ stopped: number; resumed: number }> {
  const active = await prisma.sequenceEnrollment.findMany({
    where: { contactId: input.contactId, status: "ACTIVE", startedAt: { lt: input.at } },
    include: { sequence: { include: { steps: { orderBy: { order: "asc" } } } } },
  });
  let stopped = 0;
  let resumed = 0;
  for (const e of active) {
    if (e.waitingReply) {
      // The steps count from this first reply: a later DM stops them.
      const { count } = await prisma.sequenceEnrollment.updateMany({
        where: { id: e.id, status: "ACTIVE", waitingReply: true },
        data: { waitingReply: false, startedAt: input.at },
      });
      if (count === 0) continue;
      const next = e.sequence.steps.find((s) => s.order === e.lastStepOrder + 1);
      if (next) {
        await scheduleStep(input.instagramId, e.id, next.order, next.delayMinutes, `_r${input.at.getTime()}`);
        resumed += 1;
      }
      continue;
    }
    const { count } = await prisma.sequenceEnrollment.updateMany({
      where: { id: e.id, status: "ACTIVE" },
      data: { status: "STOPPED_REPLY", stoppedAt: input.at },
    });
    stopped += count;
  }
  return { stopped, resumed };
}

export type StepOutcome =
  | "sent"
  | "noop"
  | "done"
  | "waiting_reply"
  | "stopped_window"
  | "stopped_takeover"
  | "stopped_reply"
  | "stopped_off";

async function stop(
  id: string,
  status: "DONE" | "STOPPED_WINDOW" | "STOPPED_TAKEOVER" | "STOPPED_OFF" | "STOPPED_REPLY",
  now: Date
) {
  await prisma.sequenceEnrollment.updateMany({
    where: { id, status: "ACTIVE" },
    data: { status, stoppedAt: now },
  });
}

export async function runSequenceStep(
  data: { enrollmentId: string; order: number },
  now: Date = new Date()
): Promise<StepOutcome> {
  const enrollment = await prisma.sequenceEnrollment.findUnique({
    where: { id: data.enrollmentId },
    include: {
      contact: {
        select: {
          id: true,
          workspaceId: true,
          igUserId: true,
          username: true,
          lastInboundAt: true,
          humanTakeover: true,
          humanTakeoverUntil: true,
        },
      },
      sequence: {
        include: {
          steps: { orderBy: { order: "asc" } },
          automation: {
            include: {
              instagramAccount: true,
              trackedLinks: { select: { slug: true, destinationUrl: true }, orderBy: { createdAt: "asc" } },
            },
          },
        },
      },
    },
  });
  if (!enrollment || enrollment.status !== "ACTIVE") return "noop";
  if (enrollment.lastStepOrder !== data.order - 1) return "noop";

  const step = enrollment.sequence.steps.find((s) => s.order === data.order);
  if (!step) {
    await stop(enrollment.id, "DONE", now);
    return "done";
  }
  const automation = enrollment.sequence.automation;
  // Channel off (disconnected / needs reconnect) stops it like a paused
  // campaign: the 24h window would not survive a reconnect anyway.
  if (
    !enrollment.sequence.isActive ||
    !automation.isActive ||
    automation.instagramAccount.status !== "ACTIVE" ||
    !automation.instagramAccount.accessToken
  ) {
    await stop(enrollment.id, "STOPPED_OFF", now);
    return "stopped_off";
  }
  if (isTakeoverActive(enrollment.contact, now)) {
    await stop(enrollment.id, "STOPPED_TAKEOVER", now);
    return "stopped_takeover";
  }
  if (enrollment.waitingReply) {
    // Only the person's first reply starts the steps (onPersonReplied
    // reschedules this one); a step job that runs before it does nothing.
    if (now.getTime() - enrollment.startedAt.getTime() < WAITING_REPLY_MAX_MS) return "waiting_reply";
    await stop(enrollment.id, "STOPPED_WINDOW", now);
    return "stopped_window";
  }
  if (!isWindowOpen(enrollment.contact, now)) {
    await stop(enrollment.id, "STOPPED_WINDOW", now);
    return "stopped_window";
  }
  // The CRM job may lag a few seconds behind the stored DM: check the inbox
  // copy too, so a step never goes out right after the person answered.
  const replied = await prisma.directMessage.findFirst({
    where: {
      accountId: automation.instagramAccount.instagramId,
      contactId: enrollment.contact.igUserId,
      fromMe: false,
      sentAt: { gt: enrollment.startedAt },
    },
    select: { id: true },
  });
  if (replied) {
    await stop(enrollment.id, "STOPPED_REPLY", now);
    return "stopped_reply";
  }

  // Claim the step before sending: a duplicate job finds nothing to claim.
  const claim = await prisma.sequenceEnrollment.updateMany({
    where: { id: enrollment.id, status: "ACTIVE", waitingReply: false, lastStepOrder: data.order - 1 },
    data: { lastStepOrder: data.order },
  });
  if (claim.count === 0) return "noop";

  const usage = await reserveWorkspaceDMSend(automation.workspaceId);
  if (!usage.allowed) {
    await prisma.sequenceEnrollment.updateMany({
      where: { id: enrollment.id, lastStepOrder: data.order },
      data: { lastStepOrder: data.order - 1 },
    });
    await stop(enrollment.id, "STOPPED_OFF", now);
    return "stopped_off";
  }

  const igUserId = enrollment.contact.igUserId;
  const text = renderMessageWithTracking({
    message: step.message,
    commenterName: enrollment.contact.username,
    trackedLinks: automation.trackedLinks,
    linkQuery: (slug) => recipientQuery(slug, igUserId),
  });

  let mid: string | undefined;
  try {
    const accessToken = decryptToken(automation.instagramAccount.accessToken);
    const result = await sendTracked(
      {
        workspaceId: automation.workspaceId,
        instagramAccountId: automation.instagramAccountId,
        contactIgUserId: igUserId,
        origin: "sequence",
        refId: enrollment.id,
        text,
      },
      (options) => sendDirectMessage(accessToken, automation.instagramAccount.instagramId, igUserId, text, options)
    );
    mid = result?.message_id;
  } catch (error) {
    await releaseWorkspaceDMReservation(automation.workspaceId, usage.periodStart);
    if (isWindowClosedError(error)) {
      await stop(enrollment.id, "STOPPED_WINDOW", now);
      return "stopped_window";
    }
    if (isAmbiguousDeliveryError(error)) {
      // Maybe delivered and never retried (the worker makes it unrecoverable):
      // end the enrollment so it does not sit ACTIVE forever with no next step.
      await stop(enrollment.id, "STOPPED_OFF", now);
    } else {
      // Not sent: give the step back so the job retry can try again.
      await prisma.sequenceEnrollment.updateMany({
        where: { id: enrollment.id, lastStepOrder: data.order },
        data: { lastStepOrder: data.order - 1 },
      });
    }
    throw new Error(`Sequence step ${data.order} failed: ${errorMessage(error)}`, { cause: error });
  }

  await recordEvent(
    { id: enrollment.contact.id, workspaceId: enrollment.contact.workspaceId },
    {
      type: "SEQUENCE_STEP",
      refId: `${enrollment.id}:${data.order}`,
      occurredAt: now,
      automationId: automation.id,
      text,
      meta: { order: data.order, mid: mid ?? null },
    }
  ).catch(() => false);

  const next = enrollment.sequence.steps.find((s) => s.order === data.order + 1);
  if (next) {
    await scheduleStep(automation.instagramAccount.instagramId, enrollment.id, next.order, next.delayMinutes);
  } else {
    await stop(enrollment.id, "DONE", now);
  }
  return "sent";
}

/** Sweep: enrollments still waiting for a first reply after 7 days give up. */
export async function expireWaitingEnrollments(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.sequenceEnrollment.updateMany({
    where: { status: "ACTIVE", waitingReply: true, startedAt: { lt: new Date(now.getTime() - WAITING_REPLY_MAX_MS) } },
    data: { status: "STOPPED_WINDOW", stoppedAt: now },
  });
  return count;
}
