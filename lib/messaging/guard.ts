/**
 * One gate for every automatic DM (campaign by DM, button reveal, follow-up,
 * sequence step, ig.me link campaign): nothing goes out while a human has
 * taken over the conversation, and nothing goes out outside the 24-hour
 * window. Called BEFORE reserveWorkspaceDMSend, so a refusal costs nothing.
 *
 * The first answer to a comment (private reply) is not a window send, so it
 * calls this with requireWindow: false; takeover still blocks it.
 */
import { prisma } from "@/lib/db/client";
import { isTakeoverActive } from "@/lib/messaging/takeover";
import { isWindowOpen, latest } from "@/lib/messaging/window";

export type GuardContact = {
  id: string;
  workspaceId: string;
  lastInboundAt: Date | null;
  humanTakeover: boolean;
  humanTakeoverUntil: Date | null;
  /** The person's @, so a campaign DM can render {username}. */
  username?: string | null;
};

export type GuardResult =
  | { ok: true; contact: GuardContact | null }
  | { ok: false; reason: "takeover" | "window_closed"; contact: GuardContact | null };

export function canAutomate(
  contact: GuardContact | null,
  options: { now?: Date; inboundAt?: Date | null; requireWindow?: boolean; marginMin?: number } = {}
): GuardResult {
  const now = options.now ?? new Date();
  if (isTakeoverActive(contact, now)) return { ok: false, reason: "takeover", contact };
  if (options.requireWindow !== false) {
    // The event being handled (a DM or a tap that just arrived) may be newer
    // than what the CRM job has written so far.
    const lastInboundAt = latest(contact?.lastInboundAt, options.inboundAt ?? null);
    if (!isWindowOpen({ lastInboundAt }, now, options.marginMin)) {
      return { ok: false, reason: "window_closed", contact };
    }
  }
  return { ok: true, contact };
}

const GUARD_SELECT = {
  id: true,
  workspaceId: true,
  lastInboundAt: true,
  humanTakeover: true,
  humanTakeoverUntil: true,
  username: true,
} as const;

/** Contact of one person on our account (by the account's instagramId). */
export async function loadGuardContact(
  instagramId: string,
  igUserId: string
): Promise<GuardContact | null> {
  return prisma.contact.findFirst({
    where: { igUserId, instagramAccount: { instagramId } },
    select: GUARD_SELECT,
  });
}

export async function checkAutomation(input: {
  instagramId: string;
  igUserId: string;
  inboundAt?: Date | null;
  requireWindow?: boolean;
  now?: Date;
}): Promise<GuardResult> {
  const contact = await loadGuardContact(input.instagramId, input.igUserId);
  return canAutomate(contact, {
    now: input.now,
    inboundAt: input.inboundAt,
    requireWindow: input.requireWindow,
  });
}
