/**
 * What a human (or the vendedor) needs to answer one person: the last DMs from
 * the stored inbox history (DirectMessage, written inline by the webhook, so
 * it is never behind the CRM), the window and the takeover state.
 */
import { prisma } from "@/lib/db/client";
import { isTakeoverActive } from "@/lib/messaging/takeover";
import { windowClosesAt, windowRemainingMs } from "@/lib/messaging/window";

export type ContextContact = {
  id: string;
  igUserId: string;
  username: string | null;
  name: string | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  humanTakeover: boolean;
  humanTakeoverUntil: Date | null;
  humanTakeoverReason?: string | null;
  notes?: string | null;
  instagramAccount: { instagramId: string; username: string };
  tags: { name: string }[];
};

export const CONTEXT_CONTACT_SELECT = {
  id: true,
  igUserId: true,
  username: true,
  name: true,
  lastInboundAt: true,
  lastOutboundAt: true,
  humanTakeover: true,
  humanTakeoverUntil: true,
  humanTakeoverReason: true,
  notes: true,
  instagramAccount: { select: { instagramId: true, username: true } },
  tags: { select: { name: true }, orderBy: { createdAt: "asc" } },
} as const;

export type StoredMessage = { mid: string; fromMe: boolean; text: string | null; sentAt: Date; storyReply: boolean };

export async function lastMessages(
  instagramId: string,
  igUserId: string,
  take = 5
): Promise<StoredMessage[]> {
  const rows = await prisma.directMessage.findMany({
    where: { accountId: instagramId, contactId: igUserId, deleted: false },
    orderBy: { sentAt: "desc" },
    take,
    select: { mid: true, fromMe: true, text: true, sentAt: true, storyReply: true },
  });
  return rows.reverse();
}

export function describeWindow(contact: { lastInboundAt: Date | null }, now: Date = new Date()) {
  const remainingMs = windowRemainingMs(contact, now);
  return {
    open: remainingMs > 0,
    closesAt: windowClosesAt(contact),
    hoursLeft: Math.round((remainingMs / 3_600_000) * 10) / 10,
  };
}

export function describeTakeover(contact: Pick<ContextContact, "humanTakeover" | "humanTakeoverUntil" | "humanTakeoverReason">, now: Date = new Date()) {
  const active = isTakeoverActive(contact, now);
  return {
    active,
    until: active ? contact.humanTakeoverUntil : null,
    reason: active ? contact.humanTakeoverReason ?? null : null,
  };
}

export async function presentContact(contact: ContextContact, options: { messages?: number; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const messages = await lastMessages(contact.instagramAccount.instagramId, contact.igUserId, options.messages ?? 5);
  return {
    id: contact.id,
    igUserId: contact.igUserId,
    username: contact.username,
    name: contact.name,
    tags: contact.tags.map((t) => t.name),
    notes: contact.notes ?? null,
    lastInboundAt: contact.lastInboundAt,
    lastOutboundAt: contact.lastOutboundAt,
    window: describeWindow(contact, now),
    takeover: describeTakeover(contact, now),
    lastMessages: messages,
  };
}
