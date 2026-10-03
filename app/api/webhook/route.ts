import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getDMQueue } from "@/lib/queue/client";
import {
  parseCommentEvents,
  parseLiveCommentEvents,
  parseMessageEvents,
  parsePostbackEvents,
  parseReadEvents,
  verifyWebhookSignature,
} from "@/lib/meta/webhook";
import {
  CRM_DM_JOB_NAME,
  MESSAGE_JOB_NAME,
  POSTBACK_JOB_NAME,
  REFERRAL_JOB_NAME,
  SAVE_MEDIA_JOB_NAME,
  safeJobKey,
  type CrmDmJob,
} from "@/lib/queue/client";
import { handleCrmDm } from "@/lib/messaging/crm-dm";
import { storeParsedDirectMessages } from "@/lib/messages/store";
import { parseDirectMessages } from "@/lib/messages/parse";
import { parseReferralEvents, referralEventKey } from "@/lib/conversation-links/referral";
import { Prisma } from "@/app/generated/prisma/client";

const OPENING_DM_READ_FALLBACK_DELAY_MS = 5 * 60 * 1000;
const REFERRAL_AFTER_MESSAGE_DELAY_MS = 5_000;
const LAST_WEBHOOK_THROTTLE_MS = 60_000;

/**
 * Stamps InstagramAccount.lastWebhookAt for every account in the payload
 * (entry[].id is the account's instagramId), at most once a minute per
 * account. Recorded whatever the channel status; never throws.
 */
async function touchLastWebhook(payload: unknown): Promise<void> {
  try {
    const entries = (payload as { entry?: unknown })?.entry;
    if (!Array.isArray(entries)) return;
    const ids = [
      ...new Set(
        entries
          .map((e) => (e && typeof e === "object" ? (e as { id?: unknown }).id : null))
          .filter((id): id is string | number => typeof id === "string" || typeof id === "number")
          .map(String)
      ),
    ];
    if (ids.length === 0) return;
    const now = new Date();
    await prisma.instagramAccount.updateMany({
      where: {
        instagramId: { in: ids },
        OR: [{ lastWebhookAt: null }, { lastWebhookAt: { lt: new Date(now.getTime() - LAST_WEBHOOK_THROTTLE_MS) } }],
      },
      data: { lastWebhookAt: now },
    });
  } catch (error) {
    console.warn("[Webhook] lastWebhookAt not updated:", error instanceof Error ? error.message : error);
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json(
    { success: false, error: "Verification failed" },
    { status: 403 }
  );
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyWebhookSignature(rawBody, signature)) {
    // Record the attempt so a signature mismatch is visible rather than a
    // silent 401. This is the common symptom of FACEBOOK_APP_SECRET being
    // set to the wrong app's secret for the webhook's signing key.
    await prisma.operationalEvent
      .create({
        data: {
          source: "SYSTEM",
          level: "WARNING",
          message: "Webhook signature verification failed",
          payload: {
            hadSignatureHeader: Boolean(signature),
            bodyLength: rawBody.length,
            bodyPreview: rawBody.slice(0, 200),
          },
        },
      })
      .catch(() => {});
    return NextResponse.json(
      { success: false, error: "Invalid signature" },
      { status: 401 }
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 }
    );
  }

  const webhookEvent = await prisma.webhookEvent.create({
    data: {
      object:
        typeof payload === "object" && payload && "object" in payload
          ? String(payload.object)
          : null,
      payload: payload as Prisma.InputJsonValue,
      status: "PENDING",
    },
  });

  // "Last webhook received" per account, for the Channels page.
  await touchLastWebhook(payload);

  // 2026-10-03: keep every DM (and download its media right away) so the inbox
  // shows the full conversation like the Instagram app. Never blocks the rest.
  // 2026-10-04: only the cheap part stays here (store the message). The CRM
  // (contact, timeline, tags, echo -> takeover, sequence stop) runs in the
  // worker as CRM_DM_JOB, deduped by mid, so it survives a crash and never
  // holds Meta's request.
  let crmLost = false;
  const directMessages = (() => {
    try {
      return parseDirectMessages(payload);
    } catch {
      return [];
    }
  })();
  try {
    const mediaIds = await storeParsedDirectMessages(directMessages);
    const q = getDMQueue();
    for (const id of mediaIds) {
      await q.add(SAVE_MEDIA_JOB_NAME, { instagramAccountId: "", mediaId: id }, { jobId: `media_${id}` });
    }
  } catch (err) {
    console.error("[Webhook] Could not store DM:", err);
  }
  for (const m of directMessages) {
    if (m.deleted) continue;
    const crmJob: CrmDmJob = {
      instagramAccountId: m.accountId,
      igUserId: m.contactId,
      mid: m.mid,
      fromMe: m.fromMe,
      text: m.text,
      sentAt: m.sentAt.toISOString(),
      storyReply: m.storyReply,
      ...(m.storyKind ? { storyKind: m.storyKind } : {}),
      metadata: m.metadata,
      appId: m.appId,
      hasTemplate: Boolean(m.template),
    };
    try {
      await getDMQueue().add(CRM_DM_JOB_NAME, crmJob, { jobId: `crm_${safeJobKey(m.mid)}` });
    } catch (err) {
      // Queue unreachable: run the CRM here rather than lose the event
      // (contact, timeline, takeover, sequence stop). Idempotent by mid.
      console.error("[Webhook] Could not queue DM CRM, running it inline:", err);
      try {
        await handleCrmDm(crmJob, { inline: true });
      } catch (inlineErr) {
        console.error("[Webhook] Inline DM CRM failed:", inlineErr);
        crmLost = true;
      }
    }
  }

  try {
    const commentEvents = parseCommentEvents(
      payload as Parameters<typeof parseCommentEvents>[0]
    );
    const queue = getDMQueue();

    for (const event of commentEvents) {
      const account = await prisma.instagramAccount.findUnique({
        where: { instagramId: event.instagramAccountId },
        select: { workspaceId: true },
      });

      await queue.add(
        "process-comment",
        {
          instagramAccountId: event.instagramAccountId,
          commentId: event.commentId,
          commentText: event.commentText,
          commenterId: event.commenterId,
          commenterName: event.commenterName,
          mediaId: event.mediaId,
          originalMediaId: event.originalMediaId,
          source: "WEBHOOK",
        },
        {
          jobId: `comment_${event.instagramAccountId}_${event.commentId}`,
        }
      );

      if (account) {
        await prisma.webhookEvent.update({
          where: { id: webhookEvent.id },
          data: { workspaceId: account.workspaceId },
        });
      }
    }

    // Comments during a live (field live_comments) → LIVE_COMMENT campaigns.
    // Same job as a post comment, marked surface "live"; its own job id so a
    // live comment never collides with a post comment's dedupe.
    for (const event of parseLiveCommentEvents(
      payload as Parameters<typeof parseLiveCommentEvents>[0]
    )) {
      await queue.add(
        "process-comment",
        {
          instagramAccountId: event.instagramAccountId,
          commentId: event.commentId,
          commentText: event.commentText,
          commenterId: event.commenterId,
          commenterName: event.commenterName,
          mediaId: event.mediaId,
          source: "WEBHOOK",
          surface: "live",
        },
        { jobId: `live_${event.instagramAccountId}_${event.commentId}` }
      );
    }

    // Button taps from opening DMs → deliver the reveal message.
    const postbackEvents = parsePostbackEvents(
      payload as Parameters<typeof parsePostbackEvents>[0]
    );

    for (const event of postbackEvents) {
      await queue.add(
        POSTBACK_JOB_NAME,
        {
          instagramAccountId: event.instagramAccountId,
          userId: event.userId,
          payload: event.payload,
          mid: event.mid,
        },
        {
          // BullMQ forbids ":" in custom job ids, and the payload is
          // "reveal:<id>", so build with underscores and strip any colons.
          jobId: `postback_${event.instagramAccountId}_${event.userId}_${(
            event.mid ?? event.payload
          ).replace(/:/g, "_")}`,
        }
      );
    }

    // Inbound DMs → keyword-triggered autoreply.
    const messageEvents = parseMessageEvents(
      payload as Parameters<typeof parseMessageEvents>[0]
    );

    // Etapa 3: a DM typed after opening an ig.me link is also that link's
    // event (the REFERRAL job, delayed). The ref travels with the message so
    // flows never answer it on top of the link's campaign. Campaigns ignore it.
    const linkRefByMid = new Map<string, string>();
    for (const r of parseReferralEvents(payload)) {
      if (r.kind === "message" && r.mid) linkRefByMid.set(r.mid, r.ref);
    }

    // Etapa 3: mids whose message job decides the flows (text DM, not a
    // mention). Their REFERRAL job then leaves flows alone, because a DM
    // campaign may have answered that same message (never two answers).
    const flowMidsViaMessage = new Set(
      messageEvents
        .filter((e) => e.storyKind !== "mention" && Boolean(e.messageText?.trim()))
        .map((e) => e.messageId)
    );

    for (const event of messageEvents) {
      const account = await prisma.instagramAccount.findUnique({
        where: { instagramId: event.instagramAccountId },
        select: { workspaceId: true },
      });

      await queue.add(
        MESSAGE_JOB_NAME,
        {
          instagramAccountId: event.instagramAccountId,
          messageId: event.messageId,
          messageText: event.messageText,
          senderId: event.senderId,
          // Story reply / story mention (their own campaign triggers).
          ...(event.storyKind ? { storyKind: event.storyKind } : {}),
          ...(event.storyId ? { storyId: event.storyId } : {}),
          ...(event.storyUrl ? { storyUrl: event.storyUrl } : {}),
          ...(event.timestamp ? { timestamp: event.timestamp } : {}),
          ...(linkRefByMid.has(event.messageId) ? { linkRef: linkRefByMid.get(event.messageId) } : {}),
        },
        {
          // Message ids can contain characters BullMQ rejects in a job id (":"
          // in particular). base64url encodes into exactly the allowed alphabet
          // and stays injective — substituting invalid characters would let two
          // distinct mids collapse onto one job id, silently dropping a reply.
          jobId: `message_${event.instagramAccountId}_${Buffer.from(
            event.messageId
          ).toString("base64url")}`,
        }
      );

      if (account) {
        await prisma.webhookEvent.update({
          where: { id: webhookEvent.id },
          data: { workspaceId: account.workspaceId },
        });
      }
    }

    // ig.me?ref= links: someone opened the DM through a conversation link.
    for (const event of parseReferralEvents(payload)) {
      await queue.add(
        REFERRAL_JOB_NAME,
        {
          instagramAccountId: event.instagramAccountId,
          igUserId: event.igUserId,
          ref: event.ref,
          kind: event.kind,
          ...(event.mid ? { mid: event.mid } : {}),
          ...(event.kind === "message" && event.mid && flowMidsViaMessage.has(event.mid) ? { flowsViaMessage: true } : {}),
          timestamp: event.timestamp,
        },
        {
          jobId: `ref_${event.instagramAccountId}_${event.igUserId}_${safeJobKey(referralEventKey(event))}`,
          // A link opened by a typed message is also a DM-keyword trigger
          // (MESSAGE_JOB, same DmLog key): let that one go first.
          ...(event.kind === "message" ? { delay: REFERRAL_AFTER_MESSAGE_DELAY_MS } : {}),
        }
      );
    }

    // If a user reads the opening DM and never taps the button, deliver the
    // same next-step DM after five minutes. The worker no-ops this delayed job
    // if a real button tap has already delivered the reveal.
    const readEvents = parseReadEvents(
      payload as Parameters<typeof parseReadEvents>[0]
    );

    for (const event of readEvents) {
      const openingLogs = await prisma.dmLog.findMany({
        where: {
          commenterId: event.userId,
          status: "SENT",
          automation: {
            isActive: true,
            openingDmEnabled: true,
            instagramAccount: {
              instagramId: event.instagramAccountId,
              status: "ACTIVE",
            },
          },
        },
        select: {
          automation: {
            select: {
              id: true,
            },
          },
        },
      });

      const scheduledAutomationIds = new Set<string>();
      for (const log of openingLogs) {
        const automation = log.automation;
        if (scheduledAutomationIds.has(automation.id)) continue;
        scheduledAutomationIds.add(automation.id);

        await queue.add(
          POSTBACK_JOB_NAME,
          {
            instagramAccountId: event.instagramAccountId,
            userId: event.userId,
            payload: `reveal:${automation.id}`,
            fallback: true,
          },
          {
            delay: OPENING_DM_READ_FALLBACK_DELAY_MS,
            jobId: `read_fallback_${event.instagramAccountId}_${event.userId}_${automation.id}`,
          }
        );
      }
    }

    // Neither queued nor run inline: answer 500 so Meta delivers the payload
    // again (storing and every job are idempotent by id).
    if (crmLost) throw new Error("DM CRM could not be queued nor run inline");

    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: {
        status: "PROCESSED",
        processedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: {
        status: "FAILED",
        errorMessage: message,
        processedAt: new Date(),
      },
    });

    return NextResponse.json(
      { success: false, error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
