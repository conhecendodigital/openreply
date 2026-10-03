/**
 * "Assumir conversa": while a human is answering one person, nothing automatic
 * talks to them (campaign by DM, follow-up, sequence, link campaign) and the AI
 * does not propose drafts. Turns on by itself when the owner answers by hand
 * (Lead Engine inbox, or the phone app: an echo we did not send) and turns off
 * by itself after the account's takeoverHours (default 24) or by the button.
 *
 * Expiry is lazy: isTakeoverActive() checks the deadline on every read, and the
 * sweep only tidies the flag up and writes TAKEOVER_OFF on the timeline.
 */
import { prisma } from "@/lib/db/client";
import { recordEvent } from "@/lib/contacts/record";

export const DEFAULT_TAKEOVER_HOURS = 24;
export const MAX_TAKEOVER_HOURS = 24 * 7;

export type TakeoverReason = "inbox_send" | "phone_echo" | "manual";

export type TakeoverFields = {
  humanTakeover: boolean;
  humanTakeoverUntil: Date | null;
};

export function isTakeoverActive(
  contact: Partial<TakeoverFields> | null | undefined,
  now: Date = new Date()
): boolean {
  if (!contact?.humanTakeover) return false;
  return !contact.humanTakeoverUntil || contact.humanTakeoverUntil.getTime() > now.getTime();
}

export function clampTakeoverHours(hours: number | null | undefined, fallback = DEFAULT_TAKEOVER_HOURS): number {
  const n = Number(hours);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_TAKEOVER_HOURS, Math.max(1, Math.round(n)));
}

/**
 * Turn takeover on (or push its deadline further). Stops the person's active
 * sequences. Pending AI drafts stay, but the vendedor's lists hide them while
 * takeover is on. Never throws.
 */
export async function startTakeover(input: {
  contactId: string;
  by: string;
  reason: TakeoverReason;
  hours?: number | null;
  now?: Date;
}): Promise<{ until: Date } | null> {
  const now = input.now ?? new Date();
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: input.contactId },
      select: {
        id: true,
        workspaceId: true,
        humanTakeover: true,
        humanTakeoverUntil: true,
        instagramAccount: { select: { takeoverHours: true } },
      },
    });
    if (!contact) return null;
    const hours = clampTakeoverHours(input.hours, contact.instagramAccount?.takeoverHours ?? DEFAULT_TAKEOVER_HOURS);
    const until = new Date(now.getTime() + hours * 3_600_000);
    const wasActive = isTakeoverActive(contact, now);

    await prisma.contact.update({
      where: { id: contact.id },
      data: {
        humanTakeover: true,
        humanTakeoverUntil: until,
        humanTakeoverBy: input.by,
        humanTakeoverReason: input.reason,
      },
    });
    // Timeline only when it really turned on (a renewal is not news).
    if (!wasActive) {
      await recordEvent(
        { id: contact.id, workspaceId: contact.workspaceId },
        {
          type: "TAKEOVER_ON",
          refId: `on@${now.getTime()}`,
          occurredAt: now,
          text: input.reason,
          meta: { by: input.by, reason: input.reason, until: until.toISOString(), hours },
        }
      );
    }
    await prisma.sequenceEnrollment.updateMany({
      where: { contactId: contact.id, status: "ACTIVE" },
      data: { status: "STOPPED_TAKEOVER", stoppedAt: now },
    });
    return { until };
  } catch (error) {
    console.warn("[Takeover] Could not start:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Give the conversation back to the robot. Returns false when it was not on. */
export async function endTakeover(input: {
  contactId: string;
  by: string;
  now?: Date;
  /** "manual" (button) or "expired" (sweep). */
  why?: "manual" | "expired";
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const contact = await prisma.contact.findUnique({
    where: { id: input.contactId },
    select: { id: true, workspaceId: true, humanTakeover: true, humanTakeoverUntil: true },
  });
  if (!contact || !contact.humanTakeover) return false;
  const { count } = await prisma.contact.updateMany({
    where: { id: contact.id, humanTakeover: true },
    data: { humanTakeover: false, humanTakeoverUntil: null, humanTakeoverBy: null, humanTakeoverReason: null },
  });
  if (count === 0) return false;
  await recordEvent(
    { id: contact.id, workspaceId: contact.workspaceId },
    {
      type: "TAKEOVER_OFF",
      refId: `off@${now.getTime()}`,
      occurredAt: input.why === "expired" && contact.humanTakeoverUntil ? contact.humanTakeoverUntil : now,
      text: input.why ?? "manual",
      meta: { by: input.by },
    }
  ).catch(() => false);
  return true;
}

/** Sweep: flags whose deadline passed go off (with TAKEOVER_OFF on the timeline). */
export async function expireTakeovers(now: Date = new Date(), limit = 500): Promise<number> {
  const due = await prisma.contact.findMany({
    where: { humanTakeover: true, humanTakeoverUntil: { lte: now } },
    select: { id: true },
    take: limit,
  });
  let n = 0;
  for (const c of due) {
    if (await endTakeover({ contactId: c.id, by: "system", now, why: "expired" })) n += 1;
  }
  return n;
}
