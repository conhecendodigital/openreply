/**
 * Draft replies with human approval. Owner's rule: no DM written by AI leaves
 * without explicit human approval. The AI ("vendedor", over MCP) only creates
 * drafts; a draft is sent only by approveAndSend, which records who approved
 * it and how (session = the owner in the Lead Engine; mcp = an API key that
 * carries the drafts:approve scope plus a declared approver).
 *
 * Status machine: PENDING -> APPROVED -> SENT | EXPIRED | FAILED, or
 * PENDING -> REJECTED | EXPIRED. The PENDING -> APPROVED step is a conditional
 * UPDATE, so two clicks (or two bots) can never send the same draft twice. A
 * failed send is never retried automatically.
 */
import { prisma } from "@/lib/db/client";
import { recordEvent } from "@/lib/contacts/record";
import { isTakeoverActive } from "@/lib/messaging/takeover";
import { isWindowOpen, isWindowClosedError, windowClosesAt } from "@/lib/messaging/window";
import { isAmbiguousDeliveryError } from "@/lib/messaging/errors";
import { sendDirectMessage } from "@/lib/meta/client";
import { sendTracked } from "@/lib/meta/send";
import { decryptToken } from "@/lib/meta/oauth";

export const MAX_DRAFT_TEXT = 1000;
export const MAX_DRAFT_REASON = 1000;
export const DRAFT_ORIGINS = ["vendedor", "manual"] as const;
export type DraftOrigin = (typeof DRAFT_ORIGINS)[number];

export type DraftFailure = {
  ok: false;
  status: number;
  code:
    | "not_found"
    | "takeover"
    | "window_closed"
    | "pending_exists"
    | "not_pending"
    | "invalid"
    | "send_failed"
    | "maybe_sent"
    | "changed"
    | "no_token";
  error: string;
  details?: Record<string, unknown>;
};

export function windowClosedMessage(closedAt: Date | null): string {
  return closedAt
    ? `The 24-hour window closed at ${closedAt.toISOString()}. The person needs to message again.`
    : "The 24-hour window is closed. The person needs to message again.";
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "P2002";
}

export async function createDraft(input: {
  workspaceId: string;
  contactId: string;
  text: string;
  reason?: string | null;
  origin: DraftOrigin;
  basedOnMid?: string | null;
  createdBy?: string | null;
  now?: Date;
}): Promise<{ ok: true; draft: { id: string; status: string; expiresAt: Date | null } } | DraftFailure> {
  const now = input.now ?? new Date();
  const text = input.text.trim();
  if (!text || text.length > MAX_DRAFT_TEXT) {
    return { ok: false, status: 400, code: "invalid", error: `Text must have 1 to ${MAX_DRAFT_TEXT} characters` };
  }

  const contact = await prisma.contact.findFirst({
    where: { id: input.contactId, workspaceId: input.workspaceId },
    select: {
      id: true,
      instagramAccountId: true,
      lastInboundAt: true,
      humanTakeover: true,
      humanTakeoverUntil: true,
    },
  });
  if (!contact) return { ok: false, status: 404, code: "not_found", error: "Contact not found" };

  // The AI stays out of a conversation a human took over.
  if (input.origin === "vendedor" && isTakeoverActive(contact, now)) {
    return {
      ok: false,
      status: 409,
      code: "takeover",
      error: "A human took over this conversation; the vendedor does not propose here",
      details: { until: contact.humanTakeoverUntil },
    };
  }
  if (!isWindowOpen(contact, now)) {
    const closedAt = windowClosesAt(contact);
    return { ok: false, status: 409, code: "window_closed", error: windowClosedMessage(closedAt), details: { closedAt } };
  }

  try {
    const draft = await prisma.draftReply.create({
      data: {
        workspaceId: input.workspaceId,
        instagramAccountId: contact.instagramAccountId,
        contactId: contact.id,
        text,
        reason: input.reason?.trim().slice(0, MAX_DRAFT_REASON) || null,
        origin: input.origin,
        basedOnMid: input.basedOnMid ?? null,
        createdBy: input.createdBy ?? null,
        expiresAt: windowClosesAt(contact),
      },
      select: { id: true, status: true, expiresAt: true },
    });
    return { ok: true, draft };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await prisma.draftReply.findFirst({
      where: { contactId: contact.id, status: "PENDING" },
      select: { id: true },
    });
    return {
      ok: false,
      status: 409,
      code: "pending_exists",
      error: "This person already has a pending draft; edit or discard it first",
      details: { draftId: existing?.id ?? null },
    };
  }
}

export async function editDraft(input: {
  workspaceId: string;
  id: string;
  text?: string;
  reason?: string | null;
  now?: Date;
}): Promise<{ ok: true } | DraftFailure> {
  const data: { text?: string; reason?: string | null; editedAt: Date } = { editedAt: input.now ?? new Date() };
  if (input.text !== undefined) {
    const text = input.text.trim();
    if (!text || text.length > MAX_DRAFT_TEXT) {
      return { ok: false, status: 400, code: "invalid", error: `Text must have 1 to ${MAX_DRAFT_TEXT} characters` };
    }
    data.text = text;
  }
  if (input.reason !== undefined) data.reason = input.reason?.trim().slice(0, MAX_DRAFT_REASON) || null;

  const { count } = await prisma.draftReply.updateMany({
    where: { id: input.id, workspaceId: input.workspaceId, status: "PENDING" },
    data,
  });
  if (count === 1) return { ok: true };
  const exists = await prisma.draftReply.findFirst({
    where: { id: input.id, workspaceId: input.workspaceId },
    select: { status: true },
  });
  return exists
    ? { ok: false, status: 409, code: "not_pending", error: `Draft is ${exists.status}, not PENDING` }
    : { ok: false, status: 404, code: "not_found", error: "Draft not found" };
}

export async function rejectDraft(input: {
  workspaceId: string;
  id: string;
  by: string;
}): Promise<{ ok: true } | DraftFailure> {
  const { count } = await prisma.draftReply.updateMany({
    where: { id: input.id, workspaceId: input.workspaceId, status: "PENDING" },
    data: { status: "REJECTED", approvedBy: input.by, error: null },
  });
  if (count === 1) return { ok: true };
  const exists = await prisma.draftReply.findFirst({
    where: { id: input.id, workspaceId: input.workspaceId },
    select: { status: true },
  });
  return exists
    ? { ok: false, status: 409, code: "not_pending", error: `Draft is ${exists.status}, not PENDING` }
    : { ok: false, status: 404, code: "not_found", error: "Draft not found" };
}

export type Approval = {
  workspaceId: string;
  id: string;
  /** userId (session) or the declared approver (API key). */
  approvedBy: string;
  approvedVia: "session" | "mcp";
  tokenId?: string | null;
  /** Optional last-second edit by the approver. */
  text?: string;
  /**
   * The text the approver actually saw. When given, the draft must still hold
   * exactly it: if the AI edited the draft after the human looked at it, the
   * approval is refused ("changed") and nothing is sent.
   */
  expectedText?: string;
  now?: Date;
};

function sameText(a: string, b: string): boolean {
  return a.replace(/\r\n/g, "\n").trim() === b.replace(/\r\n/g, "\n").trim();
}

function changedFailure(): DraftFailure {
  return {
    ok: false,
    status: 409,
    code: "changed",
    error: "The draft changed after you saw it. Nothing was sent; read it again and approve the new text.",
  };
}

export async function approveAndSend(
  input: Approval
): Promise<{ ok: true; draft: { id: string; status: "SENT"; sentMid: string | null } } | DraftFailure> {
  const now = input.now ?? new Date();
  const draft = await prisma.draftReply.findFirst({
    where: { id: input.id, workspaceId: input.workspaceId },
    include: {
      contact: { select: { id: true, workspaceId: true, igUserId: true, lastInboundAt: true } },
      instagramAccount: { select: { id: true, instagramId: true, accessToken: true } },
    },
  });
  if (!draft) return { ok: false, status: 404, code: "not_found", error: "Draft not found" };

  if (input.expectedText !== undefined && !sameText(input.expectedText, draft.text)) return changedFailure();

  let text = draft.text;
  if (input.text !== undefined) {
    text = input.text.trim();
    if (!text || text.length > MAX_DRAFT_TEXT) {
      return { ok: false, status: 400, code: "invalid", error: `Text must have 1 to ${MAX_DRAFT_TEXT} characters` };
    }
  }

  // Claim: only one approval can ever move PENDING forward.
  // The text is part of the claim: an edit that lands between the read above
  // and this UPDATE makes it miss, so the approver never sends unseen text.
  const claim = await prisma.draftReply.updateMany({
    where: { id: draft.id, status: "PENDING", text: draft.text },
    data: {
      status: "APPROVED",
      approvedBy: input.approvedBy,
      approvedVia: input.approvedVia,
      approvedTokenId: input.tokenId ?? null,
      approvedAt: now,
      ...(text !== draft.text ? { text, editedAt: now } : {}),
    },
  });
  if (claim.count === 0) {
    const current = await prisma.draftReply.findUnique({ where: { id: draft.id }, select: { status: true } });
    if (current?.status === "PENDING") return changedFailure();
    return {
      ok: false,
      status: 409,
      code: "not_pending",
      error: `Draft is ${current?.status ?? draft.status}, not PENDING (already handled)`,
    };
  }

  if (!isWindowOpen(draft.contact, now)) {
    const closedAt = windowClosesAt(draft.contact);
    const error = windowClosedMessage(closedAt);
    await prisma.draftReply.update({ where: { id: draft.id }, data: { status: "EXPIRED", error } });
    return { ok: false, status: 409, code: "window_closed", error, details: { closedAt } };
  }
  if (!draft.instagramAccount.accessToken) {
    const error = "No Instagram access token available";
    await prisma.draftReply.update({ where: { id: draft.id }, data: { status: "FAILED", error } });
    return { ok: false, status: 400, code: "no_token", error };
  }

  let sentMid: string | null = null;
  try {
    const accessToken = decryptToken(draft.instagramAccount.accessToken);
    const result = await sendTracked(
      {
        workspaceId: draft.workspaceId,
        instagramAccountId: draft.instagramAccountId,
        contactIgUserId: draft.contact.igUserId,
        origin: "draft",
        refId: draft.id,
        text,
      },
      (options) =>
        sendDirectMessage(accessToken, draft.instagramAccount.instagramId, draft.contact.igUserId, text, options)
    );
    sentMid = result?.message_id ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Send failed";
    if (isWindowClosedError(error)) {
      const text = `${windowClosedMessage(windowClosesAt(draft.contact))} (Meta: ${message})`.slice(0, 1000);
      await prisma.draftReply.update({ where: { id: draft.id }, data: { status: "EXPIRED", error: text } });
      return { ok: false, status: 409, code: "window_closed", error: text };
    }
    if (isAmbiguousDeliveryError(error)) {
      const text = "Meta answered with an unknown error; the message may have been delivered. Check the Direct before sending again.";
      await prisma.draftReply.update({ where: { id: draft.id }, data: { status: "FAILED", error: text } });
      return { ok: false, status: 502, code: "maybe_sent", error: text };
    }
    await prisma.draftReply.update({
      where: { id: draft.id },
      data: { status: "FAILED", error: message.slice(0, 1000) },
    });
    return { ok: false, status: 502, code: "send_failed", error: message };
  }

  await prisma.draftReply.update({
    where: { id: draft.id },
    data: { status: "SENT", sentAt: now, sentMid, error: null },
  });
  await prisma.contact
    .updateMany({
      where: { id: draft.contact.id, OR: [{ lastOutboundAt: null }, { lastOutboundAt: { lt: now } }] },
      data: { lastOutboundAt: now },
    })
    .catch(() => undefined);
  await recordEvent(
    { id: draft.contact.id, workspaceId: draft.contact.workspaceId },
    {
      type: "DRAFT_SENT",
      refId: draft.id,
      occurredAt: now,
      text,
      meta: { origin: draft.origin, approvedBy: input.approvedBy, approvedVia: input.approvedVia, mid: sentMid },
    }
  ).catch(() => false);
  return { ok: true, draft: { id: draft.id, status: "SENT", sentMid } };
}

/**
 * Sweep: pending drafts whose window really closed become EXPIRED. Checked on
 * the contact (not the stored expiresAt), because a new DM from the person
 * reopens the window and keeps the draft alive.
 */
export async function expireDrafts(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 3_600_000);
  const { count } = await prisma.draftReply.updateMany({
    where: {
      status: "PENDING",
      contact: { OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: cutoff } }] },
    },
    data: { status: "EXPIRED", error: windowClosedMessage(null) },
  });
  return count;
}
