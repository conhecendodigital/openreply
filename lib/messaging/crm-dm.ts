/**
 * CRM for one DM (both directions), out of the webhook request. Runs as
 * CRM_DM_JOB in the worker; the webhook calls it inline only as a fallback
 * when the queue is unreachable, so no DM is ever lost from the CRM.
 *
 *  - contact + timeline + tags (onDirectMessage). A database failure THROWS
 *    here (BullMQ retries; recordEvent dedupes by mid), instead of completing
 *    the job with the event silently dropped;
 *  - inbound: the person answered, so their running sequences stop (or the
 *    one waiting for this first reply starts), and the pending draft's
 *    expiry follows the reopened window;
 *  - echo: ours (metadata / ledger / template / same text) or typed by the
 *    owner on the phone, which turns human takeover on.
 */
import { prisma } from "@/lib/db/client";
import { onDirectMessage, resolveAccountByInstagramId } from "@/lib/contacts/record";
import { classifyEcho, ECHO_RECHECK_DELAY_MS } from "@/lib/messaging/echo";
import { startTakeover } from "@/lib/messaging/takeover";
import { onPersonReplied } from "@/lib/sequences/engine";
import { isOptOutText, recordOptOut } from "@/lib/broadcasts/optout";
import { CRM_DM_JOB_NAME, getDMQueue, safeJobKey, type CrmDmJob } from "@/lib/queue/client";

export type CrmDmOutcome = "no_account" | "no_contact" | "inbound" | "ours" | "recheck" | "takeover";

export async function handleCrmDm(
  data: CrmDmJob,
  options: {
    /**
     * Inline fallback (queue down): the 20 s re-check of an unproven echo
     * cannot be scheduled, so the late pass (text match against our ledger,
     * which is written before every send) runs right away.
     */
    inline?: boolean;
  } = {}
): Promise<CrmDmOutcome> {
  const account = await resolveAccountByInstagramId(data.instagramAccountId);
  if (!account) return "no_account";
  const sentAt = new Date(data.sentAt);

  const tracked = await onDirectMessage(
    {
      account,
      igUserId: data.igUserId,
      mid: data.mid,
      fromMe: data.fromMe,
      text: data.text,
      sentAt,
      storyReply: data.storyReply,
      storyKind: data.storyKind ?? null,
    },
    { throwOnError: true }
  );
  const contactId = tracked?.contact.id;
  if (!contactId) return "no_contact";

  if (!data.fromMe) {
    // Etapa 5: PARAR / SAIR / STOP = out of future broadcasts (only that;
    // campaigns and flows still answer the word). Never throws.
    if (tracked?.contact && isOptOutText(data.text)) {
      await recordOptOut(tracked.contact, { text: data.text, mid: data.mid, at: sentAt });
    }
    await onPersonReplied({ contactId, instagramId: account.instagramId, at: sentAt });
    // A new DM extends the window of the pending draft too.
    const expiresAt = new Date(sentAt.getTime() + 24 * 3_600_000);
    await prisma.draftReply
      .updateMany({
        where: { contactId, status: "PENDING", OR: [{ expiresAt: null }, { expiresAt: { lt: expiresAt } }] },
        data: { expiresAt },
      })
      .catch(() => undefined);
    return "inbound";
  }

  const late = Boolean(data.late) || Boolean(options.inline);
  const verdict = await classifyEcho(
    {
      instagramAccountId: account.id,
      contactIgUserId: data.igUserId,
      mid: data.mid,
      text: data.text,
      metadata: data.metadata,
      hasTemplate: data.hasTemplate,
      sentAt,
    },
    { late }
  );
  if (verdict.kind === "ours") return "ours";
  if (verdict.kind === "unknown") {
    // The echo can arrive before our POST returns the mid: look again later.
    await getDMQueue().add(
      CRM_DM_JOB_NAME,
      { ...data, late: true },
      { delay: ECHO_RECHECK_DELAY_MS, jobId: `crm_late_${safeJobKey(data.mid)}` }
    );
    return "recheck";
  }
  // Typed on the phone / Business Suite: the owner is answering.
  await startTakeover({ contactId, by: "echo", reason: "phone_echo", now: new Date() });
  return "takeover";
}
