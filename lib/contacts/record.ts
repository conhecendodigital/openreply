/**
 * Contacts (CRM): everyone who comments, sends a DM or clicks a link becomes a
 * Contact per connected Instagram account, with counters, tags and a timeline.
 *
 * Idempotency: ContactEvent is unique on (contactId, type, refId) and written
 * with createMany + skipDuplicates. Counters only move when that insert really
 * added a row, so webhook retries, the polling sweep and the backfill never
 * double count. (Same idea as ChatbotX's sentCount/missedCount, which only
 * increment when INSERT ... ON CONFLICT DO NOTHING inserted.)
 *
 * Nothing here may break a DM or a webhook: callers go through the *Safe
 * helpers, which log and swallow every error.
 */
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { needsProfileLookup, queueProfileLookup } from "@/lib/contacts/profile-queue";

export const CONTACT_EVENT_TYPES = [
  "COMMENT",
  "DM_IN",
  "DM_OUT",
  "CAMPAIGN_SENT",
  "CLICK",
  "TAG_ADDED",
  "TAG_REMOVED",
  "COMMENT_HIDDEN",
  "COMMENT_RESTORED",
  // Etapa 2
  "POSTBACK_IN",
  "REFERRAL",
  "DRAFT_SENT",
  "TAKEOVER_ON",
  "TAKEOVER_OFF",
  "SEQUENCE_STEP",
  // Etapa 3 (flows)
  "FLOW_STARTED",
  "FLOW_STEP",
  "FLOW_DONE",
] as const;
export type ContactEventType = (typeof CONTACT_EVENT_TYPES)[number];

type CounterField =
  | "commentsCount"
  | "dmsInCount"
  | "dmsOutCount"
  | "campaignsCount"
  | "clicksCount"
  | "hiddenCommentsCount";

const COUNTERS: Partial<Record<ContactEventType, CounterField>> = {
  COMMENT: "commentsCount",
  DM_IN: "dmsInCount",
  DM_OUT: "dmsOutCount",
  CAMPAIGN_SENT: "campaignsCount",
  CLICK: "clicksCount",
  COMMENT_HIDDEN: "hiddenCommentsCount",
};

/**
 * What the person did that opens (or resets) Instagram's 24-hour window: a
 * DM, a button tap, and an ig.me link into a thread (Meta's send-policy list).
 * A comment does NOT count: from a comment only the one private reply is
 * allowed until the person answers.
 */
export const WINDOW_OPENING_EVENTS: ReadonlySet<ContactEventType> = new Set([
  "DM_IN",
  "POSTBACK_IN",
  "REFERRAL",
]);

export const MAX_TAG_LENGTH = 60;
const MAX_EVENT_TEXT = 500;

/** Auto tag names, kept in one place so screens and filters agree. */
export const AUTO_TAGS = {
  commented: (keyword: string | null | undefined) =>
    `comentou:${(keyword ?? "qualquer").trim() || "qualquer"}`,
  received: (campaign: string) => `recebeu:${campaign.trim()}`,
  clicked: "clicou",
  clickedCampaign: (campaign: string) => `clicou:${campaign.trim()}`,
  repliedDm: "respondeu DM",
  sentDm: "mandou DM",
  moderated: (verdict: string) => `moderado:${verdict}`,
  cameFrom: (origin: string) => `veio:${origin.trim() || "link"}`,
};

export function normalizeTagName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, MAX_TAG_LENGTH);
}

export type ContactRef = { id: string; workspaceId: string };

export async function upsertContact(input: {
  workspaceId: string;
  instagramAccountId: string;
  igUserId: string;
  username?: string | null;
  name?: string | null;
  at: Date;
}): Promise<
  ContactRef & {
    firstSeenAt: Date;
    lastSeenAt: Date;
    username: string | null;
    profileStatus: string | null;
    profileFetchedAt: Date | null;
    profileAttempts: number;
  }
> {
  const username = input.username?.trim() || undefined;
  const contact = await prisma.contact.upsert({
    where: {
      instagramAccountId_igUserId: {
        instagramAccountId: input.instagramAccountId,
        igUserId: input.igUserId,
      },
    },
    create: {
      workspaceId: input.workspaceId,
      instagramAccountId: input.instagramAccountId,
      igUserId: input.igUserId,
      username: username ?? null,
      name: input.name ?? null,
      firstSeenAt: input.at,
      lastSeenAt: input.at,
    },
    // The username is only a label (it can change); the IGSID is the key.
    update: {
      ...(username ? { username } : {}),
      ...(input.name ? { name: input.name } : {}),
    },
    select: {
      id: true,
      workspaceId: true,
      firstSeenAt: true,
      lastSeenAt: true,
      username: true,
      profileStatus: true,
      profileFetchedAt: true,
      profileAttempts: true,
    },
  });

  // The backfill feeds old events, so first/last seen move both ways.
  const patch: Prisma.ContactUpdateInput = {};
  if (input.at > contact.lastSeenAt) patch.lastSeenAt = input.at;
  if (input.at < contact.firstSeenAt) patch.firstSeenAt = input.at;
  if (Object.keys(patch).length > 0) {
    await prisma.contact.update({ where: { id: contact.id }, data: patch });
  }
  return contact;
}

export type ContactEventInput = {
  type: ContactEventType;
  refId: string;
  occurredAt: Date;
  text?: string | null;
  automationId?: string | null;
  mediaId?: string | null;
  meta?: Record<string, unknown> | null;
};

/** Insert one timeline event. Returns true only when it was new. */
export async function recordEvent(
  contact: ContactRef,
  event: ContactEventInput
): Promise<boolean> {
  const { count } = await prisma.contactEvent.createMany({
    data: [
      {
        workspaceId: contact.workspaceId,
        contactId: contact.id,
        type: event.type,
        refId: event.refId,
        occurredAt: event.occurredAt,
        text: event.text ? event.text.slice(0, MAX_EVENT_TEXT) : null,
        automationId: event.automationId ?? null,
        mediaId: event.mediaId ?? null,
        meta: event.meta ? (event.meta as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    ],
    skipDuplicates: true,
  });
  if (count !== 1) return false;

  const counter = COUNTERS[event.type];
  const data: Prisma.ContactUpdateInput = counter ? { [counter]: { increment: 1 } } : {};
  if (WINDOW_OPENING_EVENTS.has(event.type)) {
    // Only move forward: an old DM from the backfill must not shrink the window.
    await prisma.contact.updateMany({
      where: {
        id: contact.id,
        OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: event.occurredAt } }],
      },
      data: { lastInboundAt: event.occurredAt },
    });
  }
  if (event.type === "DM_OUT") {
    await prisma.contact.updateMany({
      where: {
        id: contact.id,
        OR: [{ lastOutboundAt: null }, { lastOutboundAt: { lt: event.occurredAt } }],
      },
      data: { lastOutboundAt: event.occurredAt },
    });
  }
  if (Object.keys(data).length > 0) {
    await prisma.contact.update({ where: { id: contact.id }, data });
  }
  return true;
}

/** Add a tag. Returns true when the contact did not have it yet. */
export async function addTag(
  contact: ContactRef,
  rawName: string,
  source: "auto" | "manual",
  at: Date = new Date()
): Promise<boolean> {
  const name = normalizeTagName(rawName);
  if (!name) return false;
  const { count } = await prisma.contactTag.createMany({
    data: [{ contactId: contact.id, workspaceId: contact.workspaceId, name, source }],
    skipDuplicates: true,
  });
  if (count !== 1) return false;
  await recordEvent(contact, {
    type: "TAG_ADDED",
    // A tag can be removed and added again, so the ref carries the moment.
    refId: `${name}@${at.getTime()}`,
    occurredAt: at,
    text: name,
    meta: { source },
  });
  return true;
}

export async function removeTag(
  contact: ContactRef,
  rawName: string,
  at: Date = new Date()
): Promise<boolean> {
  const name = normalizeTagName(rawName);
  if (!name) return false;
  const { count } = await prisma.contactTag.deleteMany({
    where: { contactId: contact.id, name },
  });
  if (count === 0) return false;
  await recordEvent(contact, {
    type: "TAG_REMOVED",
    refId: `${name}@${at.getTime()}`,
    occurredAt: at,
    text: name,
  });
  return true;
}

// ─── Account resolution ──────────────────────────────────────────────────────

type AccountRow = { id: string; workspaceId: string; instagramId: string };
const accountCache = new Map<string, { row: AccountRow | null; at: number }>();
const ACCOUNT_CACHE_MS = 60_000;

/** Our connected account by its instagramId (webhook entry.id), cached 60 s. */
export async function resolveAccountByInstagramId(
  instagramId: string
): Promise<AccountRow | null> {
  const cached = accountCache.get(instagramId);
  if (cached && Date.now() - cached.at < ACCOUNT_CACHE_MS) return cached.row;
  const row = await prisma.instagramAccount.findUnique({
    where: { instagramId },
    select: { id: true, workspaceId: true, instagramId: true },
  });
  accountCache.set(instagramId, { row, at: Date.now() });
  return row;
}

export function clearAccountCache() {
  accountCache.clear();
}

// ─── Safe entry points used by the webhook, worker and redirect ─────────────

export type TrackInput = {
  /** Either the internal account (id + workspaceId) or its instagramId. */
  account: AccountRow | { instagramId: string };
  igUserId: string;
  username?: string | null;
  /** Display name, when the source has one. */
  name?: string | null;
  event: ContactEventInput;
  tags?: string[];
  /** Don't queue a profile lookup (the username backfill does its own). */
  skipProfile?: boolean;
};

export type TrackResult = { contact: ContactRef; inserted: boolean } | null;

/**
 * Upsert the contact, record the event and add auto tags. Never throws: a CRM
 * failure must not cost a DM.
 */
export async function trackInteraction(
  input: TrackInput,
  options: { throwOnError?: boolean } = {}
): Promise<TrackResult> {
  try {
    const account =
      "id" in input.account
        ? input.account
        : await resolveAccountByInstagramId(input.account.instagramId);
    if (!account || !input.igUserId) return null;
    // Our own account is not a contact.
    if (input.igUserId === account.instagramId) return null;

    const contact = await upsertContact({
      workspaceId: account.workspaceId,
      instagramAccountId: account.id,
      igUserId: input.igUserId,
      username: input.username,
      name: input.name,
      at: input.event.occurredAt,
    });
    const ref = { id: contact.id, workspaceId: contact.workspaceId };
    // No username yet (DM, ig.me link, button tap carry only the IGSID): look
    // the profile up in the worker. Never blocks nor throws.
    if (
      !input.skipProfile &&
      !input.username?.trim() &&
      needsProfileLookup(contact, input.event)
    ) {
      await queueProfileLookup({
        instagramId: account.instagramId,
        contactId: contact.id,
        attempts: contact.profileAttempts,
      });
    }
    const inserted = await recordEvent(ref, input.event);
    for (const tag of input.tags ?? []) {
      await addTag(ref, tag, "auto", input.event.occurredAt);
    }
    return { contact: ref, inserted };
  } catch (error) {
    // A queued CRM job wants the error (BullMQ retries, idempotent by refId).
    if (options.throwOnError) throw error;
    console.warn(
      "[CRM] Could not record interaction:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

/** addTag that never throws. */
export async function addTagSafe(
  contact: ContactRef | null | undefined,
  name: string,
  source: "auto" | "manual" = "auto"
): Promise<void> {
  if (!contact) return;
  try {
    await addTag(contact, name, source);
  } catch (error) {
    console.warn("[CRM] Could not tag contact:", error instanceof Error ? error.message : error);
  }
}

/** A campaign DM went out (DmLog became SENT). */
export async function onDmLogSent(
  dmLog: {
    id: string;
    commenterId: string;
    commenterName?: string | null;
    dmSentAt?: Date | null;
  },
  automation: {
    id: string;
    name: string;
    instagramAccountId: string;
    workspaceId: string;
    instagramAccount: { instagramId: string };
  }
): Promise<TrackResult> {
  return trackInteraction({
    account: {
      id: automation.instagramAccountId,
      workspaceId: automation.workspaceId,
      instagramId: automation.instagramAccount.instagramId,
    },
    igUserId: dmLog.commenterId,
    username: dmLog.commenterName,
    event: {
      type: "CAMPAIGN_SENT",
      refId: dmLog.id,
      occurredAt: dmLog.dmSentAt ?? new Date(),
      automationId: automation.id,
      text: automation.name,
    },
    tags: [AUTO_TAGS.received(automation.name)],
  });
}

/**
 * A DM in either direction. Inbound DMs tag the person "respondeu DM" when a
 * campaign already reached them, otherwise "mandou DM".
 */
export async function onDirectMessage(input: {
  account: AccountRow;
  igUserId: string;
  mid: string;
  fromMe: boolean;
  text?: string | null;
  sentAt: Date;
  storyReply?: boolean;
  storyKind?: "reply" | "mention" | null;
}, options: { throwOnError?: boolean } = {}): Promise<TrackResult> {
  const result = await trackInteraction({
    account: input.account,
    igUserId: input.igUserId,
    event: {
      type: input.fromMe ? "DM_OUT" : "DM_IN",
      refId: input.mid,
      occurredAt: input.sentAt,
      text: input.text ?? null,
      meta: input.storyReply
        ? { storyReply: true, ...(input.storyKind ? { storyKind: input.storyKind } : {}) }
        : null,
    },
  }, options);
  if (!result || input.fromMe || !result.inserted) return result;

  try {
    const hadCampaign = await prisma.contactEvent.findFirst({
      where: {
        contactId: result.contact.id,
        type: "CAMPAIGN_SENT",
        occurredAt: { lte: input.sentAt },
      },
      select: { id: true },
    });
    await addTag(result.contact, hadCampaign ? AUTO_TAGS.repliedDm : AUTO_TAGS.sentDm, "auto", input.sentAt);
  } catch (error) {
    console.warn("[CRM] Could not tag DM:", error instanceof Error ? error.message : error);
  }
  return result;
}
