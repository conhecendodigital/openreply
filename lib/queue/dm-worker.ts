import { UnrecoverableError, Worker, type Job } from "bullmq";
import {
  getDMQueue,
  getRedisConnection,
  MESSAGE_JOB_NAME,
  POSTBACK_JOB_NAME,
  FOLLOWUP_JOB_NAME,
  SAVE_MEDIA_JOB_NAME,
  CRM_DM_JOB_NAME,
  REFERRAL_JOB_NAME,
  SEQUENCE_STEP_JOB_NAME,
  type DmQueueJob,
  type SaveMediaJob,
  type ProcessCommentJob,
  type ProcessMessageJob,
  type ProcessPostbackJob,
  type ProcessFollowUpJob,
  type CrmDmJob,
  type ReferralJob,
  type SequenceStepJob,
} from "./client";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { downloadDirectMedia } from "@/lib/messages/store";
import {
  MetaApiError,
  RateLimitError,
  TokenExpiredError,
  getUserFollowStatus,
  sendCommentReply,
  sendDirectMessage,
  sendDirectMessageWithButton,
  sendDirectMessageWithLinkButton,
  sendPrivateReply,
  sendPrivateReplyWithButton,
  sendPrivateReplyWithLinkButton,
  type SendOptions,
} from "@/lib/meta/client";
import { sendTracked, type OutboundOrigin } from "@/lib/meta/send";
import { checkAutomation } from "@/lib/messaging/guard";
import { handleCrmDm } from "@/lib/messaging/crm-dm";
import { isAmbiguousDeliveryError } from "@/lib/messaging/errors";
import { enrollInSequence, runSequenceStep } from "@/lib/sequences/engine";
import { decryptToken } from "@/lib/meta/oauth";
import { matchKeywords } from "@/lib/utils/keyword-matcher";
import { reserveDMSlot } from "@/lib/utils/rate-limiter";
import {
  releaseWorkspaceDMReservation,
  reserveWorkspaceDMSend,
} from "@/lib/billing/usage";
import { recordWorkerAlert } from "@/lib/ops/worker-health";
import {
  buildTrackedUrl,
  renderMessageWithTracking,
  renderMessageWithoutLink,
} from "@/lib/tracking/message";
import { recipientQuery } from "@/lib/tracking/recipient";
import {
  AUTO_TAGS,
  addTagSafe,
  onDmLogSent,
  trackInteraction,
} from "@/lib/contacts/record";
import { moderateComment } from "@/lib/moderation/moderate";

const BACKOFF_DELAYS = [5 * 60 * 1000, 15 * 60 * 1000, 45 * 60 * 1000];

function formatError(error: unknown): string {
  if (error instanceof MetaApiError) {
    return `Meta API Error ${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

// Meta rejections that a plain-text retry cannot fix: the send was refused for
// the conversation, not for the button template. Retrying as text just burns
// the attempt and — worse — overwrites the real error with a misleading one
// ("invalid for a private reply", because the first attempt already used up the
// comment's single allowed private reply).
const NON_TEMPLATE_REJECTIONS = [
  /outside of allowed window/i,
  /invalid for a private reply/i,
  /requested user cannot be found/i,
];

// Moved to lib/messaging/errors.ts (sequences and drafts use it too).
export { isAmbiguousDeliveryError };

/**
 * Every send goes through the OutboundMessage ledger (lib/meta/send.ts) so
 * its echo is recognised as ours and never turns human takeover on.
 */
type Ledger = <T extends { message_id?: string }>(
  text: string | null,
  send: (options?: SendOptions) => Promise<T>
) => Promise<T>;

function ledgerFor(
  automation: { workspaceId: string; instagramAccountId: string },
  igUserId: string,
  origin: OutboundOrigin,
  refId?: string | null
): Ledger {
  return (text, send) =>
    sendTracked(
      {
        workspaceId: automation.workspaceId,
        instagramAccountId: automation.instagramAccountId,
        contactIgUserId: igUserId,
        origin,
        refId: refId ?? null,
        text,
      },
      send
    );
}

function isTemplateRejection(error: unknown): boolean {
  if (error instanceof TokenExpiredError || error instanceof RateLimitError) {
    return false;
  }
  if (isAmbiguousDeliveryError(error)) return false;
  const message = error instanceof Error ? error.message : "";
  return !NON_TEMPLATE_REJECTIONS.some((pattern) => pattern.test(message));
}

type WorkerTrackedLink = {
  slug: string;
  label: string | null;
  destinationUrl: string;
};

/**
 * Build the tappable link buttons for a DM. The first link uses the campaign's
 * `linkButtonLabel`; each additional link uses its own stored `label`. Capped at
 * Meta's 3-button limit for a button template.
 */
function buildLinkButtons(
  trackedLinks: WorkerTrackedLink[],
  primaryLabel: string | null,
  recipientId?: string | null
): { title: string; url: string }[] {
  return trackedLinks.slice(0, 3).map((link, index) => ({
    // The signed recipient lets /r/<slug> credit the click to this person.
    url: buildTrackedUrl(link.slug, undefined, recipientQuery(link.slug, recipientId)),
    title: (index === 0 ? primaryLabel : link.label) || link.label || "Open link",
  }));
}

/**
 * Fallback text when Meta rejects the button template: render the primary link
 * inline, then append any extra tracked URLs on their own lines so no link is
 * lost.
 */
function buildInlineLinkFallback(
  message: string,
  commenterName: string | null | undefined,
  trackedLinks: WorkerTrackedLink[],
  bodyText: string,
  recipientId?: string | null
): string {
  const linkQuery = (slug: string) => recipientQuery(slug, recipientId);
  const base =
    renderMessageWithTracking({ message, commenterName, trackedLinks, linkQuery }) ||
    bodyText;
  const extraUrls = trackedLinks
    .slice(1)
    .map((link) => buildTrackedUrl(link.slug, undefined, linkQuery(link.slug)));
  return extraUrls.length > 0 ? `${base}\n${extraUrls.join("\n")}` : base;
}

type RevealAutomation = {
  dmMessage: string;
  linkButtonLabel: string | null;
  trackedLinks: WorkerTrackedLink[];
  instagramAccount: { instagramId: string };
};

/**
 * Deliver a campaign's reveal message as a direct message. Shared by the
 * button-tap (postback) path and the DM keyword-trigger path — both already
 * have an open conversation with the user, so neither uses a private reply.
 */
async function sendRevealDirectMessage(
  accessToken: string,
  automation: RevealAutomation,
  userId: string,
  commenterName: string | null,
  context: string,
  ledger: Ledger
): Promise<void> {
  if (automation.trackedLinks.length === 0) {
    const text = renderMessageWithTracking({
      message: automation.dmMessage,
      commenterName,
      trackedLinks: automation.trackedLinks,
    });
    await ledger(text, (o) =>
      sendDirectMessage(accessToken, automation.instagramAccount.instagramId, userId, text, o)
    );
    return;
  }

  // Try button template first; if Meta rejects it, fall back to inline links.
  const bodyText =
    renderMessageWithoutLink({
      message: automation.dmMessage,
      commenterName,
    }) || "Here's your link:";
  const buttons = buildLinkButtons(
    automation.trackedLinks,
    automation.linkButtonLabel,
    userId
  );

  try {
    await ledger(bodyText, (o) =>
      sendDirectMessageWithLinkButton(
        accessToken,
        automation.instagramAccount.instagramId,
        userId,
        bodyText,
        buttons,
        o
      )
    );
  } catch (buttonError) {
    // A closed messaging window rejects the text retry too, so don't let it
    // overwrite the original error with a misleading one.
    if (!isTemplateRejection(buttonError)) throw buttonError;

    console.log(
      `[DM Worker] Button template rejected in ${context}, falling back to inline link:`,
      formatError(buttonError)
    );
    const fallbackText = buildInlineLinkFallback(
      automation.dmMessage,
      commenterName,
      automation.trackedLinks,
      bodyText,
      userId
    );
    try {
      await ledger(fallbackText, (o) =>
        sendDirectMessage(
          accessToken,
          automation.instagramAccount.instagramId,
          userId,
          fallbackText,
          o
        )
      );
    } catch {
      throw buttonError;
    }
  }
}

async function processComment(job: Job<ProcessCommentJob>): Promise<void> {
  const {
    instagramAccountId,
    commentId,
    commentText,
    commenterId,
    commenterName,
    mediaId,
    originalMediaId,
  } = job.data;
  const requeueAttempt = job.data.requeueAttempt ?? 0;

  const automations = await prisma.automation.findMany({
    where: {
      // Match campaigns bound to this specific post, plus any-post campaigns.
      // A comment left on an ad carries the ad's own media id, while the
      // campaign is bound to the post the ad was created from, so both ids
      // have to be considered or the comment is dropped without a trace.
      OR: [
        { postId: mediaId },
        ...(originalMediaId ? [{ postId: originalMediaId }] : []),
        { matchAnyPost: true },
      ],
      isActive: true,
      instagramAccount: {
        instagramId: instagramAccountId,
      },
    },
    include: {
      instagramAccount: true,
      workspace: true,
      trackedLinks: {
        select: {
          slug: true,
          label: true,
          destinationUrl: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // CRM: the commenter becomes (or updates) a Contact. Never throws.
  const tracked = await trackInteraction({
    account: { instagramId: instagramAccountId },
    igUserId: commenterId,
    username: commenterName,
    event: {
      type: "COMMENT",
      refId: commentId,
      occurredAt: new Date(),
      text: commentText,
      mediaId,
    },
  });

  // Moderation runs here (not in the webhook) so the polling sweep is covered
  // too. A comment matching a campaign keyword is protected inside, so the
  // campaign below still answers it. Never throws.
  const moderation = await moderateComment(job.data, {
    campaigns: automations.map((a) => ({
      keywords: a.keywords,
      wholeWordMatch: a.wholeWordMatch,
      matchAnyWord: a.matchAnyWord,
    })),
  });
  // A hidden comment is spam: don't let an "any word" campaign DM it.
  if (moderation?.action === "HIDDEN") return;

  for (const automation of automations) {
    // "Any word" campaigns fire on every comment; otherwise require a keyword hit.
    const matchResult = automation.matchAnyWord
      ? { matched: true, matchedKeyword: null }
      : matchKeywords(
          commentText,
          automation.keywords,
          automation.wholeWordMatch
        );

    if (!matchResult.matched) {
      continue;
    }

    await addTagSafe(
      tracked?.contact,
      AUTO_TAGS.commented(matchResult.matchedKeyword ?? automation.keywords[0])
    );

    const existingLog = await prisma.dmLog.findUnique({
      where: {
        automationId_commentId: {
          automationId: automation.id,
          commentId,
        },
      },
    });

    const alreadyDmd = existingLog?.status === "SENT";
    const alreadyPublicReplied = Boolean(existingLog?.publicReplySentAt);
    const needsDm = !alreadyDmd;

    // Skip only when there is genuinely nothing left to do. A comment whose DM
    // already sent but whose public reply never posted (e.g. it hit a rate
    // limit) must still come back so the public reply can be retried.
    if (existingLog?.status === "SKIPPED_PLAN_LIMIT") continue;
    if (alreadyDmd && (alreadyPublicReplied || !automation.publicReplyEnabled)) {
      continue;
    }

    if (!automation.instagramAccount.accessToken) {
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        create: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId,
          commenterName,
          commentText,
          commentId,
          matchedKeyword: matchResult.matchedKeyword,
          status: "FAILED",
          errorMessage: "No Instagram access token available",
        },
        update: {
          status: "FAILED",
          errorMessage: "No Instagram access token available",
        },
      });
      continue;
    }

    let accessToken: string;
    try {
      accessToken = decryptToken(automation.instagramAccount.accessToken);
    } catch {
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        create: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId,
          commenterName,
          commentText,
          commentId,
          matchedKeyword: matchResult.matchedKeyword,
          status: "FAILED",
          errorMessage: "Failed to decrypt Instagram access token",
        },
        update: {
          status: "FAILED",
          errorMessage: "Failed to decrypt Instagram access token",
        },
      });
      continue;
    }

    // Ensure a log row exists before the public reply leg (which updates it).
    // Only (re)set PENDING when the DM will actually be attempted, so a prior
    // SENT is never clobbered while we come back just to retry the public reply.
    if (!existingLog) {
      await prisma.dmLog.create({
        data: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId,
          commenterName,
          commentText,
          commentId,
          matchedKeyword: matchResult.matchedKeyword,
          status: "PENDING",
          attempts: job.attemptsMade + 1,
        },
      });
    } else if (needsDm) {
      await prisma.dmLog.update({
        where: {
          automationId_commentId: { automationId: automation.id, commentId },
        },
        data: {
          status: "PENDING",
          attempts: job.attemptsMade + 1,
          matchedKeyword: matchResult.matchedKeyword,
          errorMessage: null,
        },
      });
    }

    // Public reply leg — decoupled from the DM and posted first so a DM failure
    // (e.g. a non-follower whose messaging is restricted) never suppresses it.
    // Idempotent across retries via publicReplySentAt.
    const replyPool =
      automation.publicReplyMessages.length > 0
        ? automation.publicReplyMessages
        : automation.publicReplyMessage
          ? [automation.publicReplyMessage]
          : [];
    if (
      automation.publicReplyEnabled &&
      replyPool.length > 0 &&
      !existingLog?.publicReplySentAt
    ) {
      try {
        const chosen = replyPool[Math.floor(Math.random() * replyPool.length)];
        const publicReply = renderMessageWithTracking({
          message: chosen,
          commenterName,
          trackedLinks: automation.trackedLinks,
        });
        await sendCommentReply(accessToken, commentId, publicReply);
        await prisma.dmLog.update({
          where: {
            automationId_commentId: { automationId: automation.id, commentId },
          },
          data: { publicReplySentAt: new Date(), publicReplyError: null },
        });
      } catch (error) {
        console.error(
          "[DM Worker] Public comment reply failed:",
          formatError(error)
        );
        await prisma.dmLog
          .update({
            where: {
              automationId_commentId: { automationId: automation.id, commentId },
            },
            data: { publicReplyError: formatError(error) },
          })
          .catch(() => {});
      }
    }

    // DM already sent on an earlier pass; the public reply retry above was all
    // this run needed. Don't re-send the DM.
    if (!needsDm) continue;

    // Meta allows exactly ONE private reply per comment, ever — across every
    // campaign. When several campaigns match the same comment (duplicated
    // campaigns, or an any-post campaign overlapping a post-specific one), only
    // the first can deliver; the rest would fail with "The comment is invalid
    // for a private reply". Skip them explicitly instead of burning an API call
    // and logging a failure the user can do nothing about. The public reply
    // above still goes out per campaign — only the DM leg is deduped.
    const privateReplyUsedBy = await prisma.dmLog.findFirst({
      where: {
        commentId,
        status: "SENT",
        automationId: { not: automation.id },
      },
      select: { automation: { select: { name: true } } },
    });
    if (privateReplyUsedBy) {
      await prisma.dmLog.update({
        where: {
          automationId_commentId: { automationId: automation.id, commentId },
        },
        data: {
          status: "SKIPPED_DEDUP",
          matchedKeyword: matchResult.matchedKeyword,
          errorMessage: `Another campaign (${privateReplyUsedBy.automation?.name ?? "unknown"}) already sent the one private reply Instagram allows for this comment`,
        },
      });
      continue;
    }

    // A human took over this person: the robot stays quiet, private reply
    // included. (The window does not apply to the first private reply.)
    const gate = await checkAutomation({
      instagramId: instagramAccountId,
      igUserId: commenterId,
      requireWindow: false,
    });
    if (!gate.ok) {
      await prisma.dmLog.update({
        where: { automationId_commentId: { automationId: automation.id, commentId } },
        data: {
          status: "SKIPPED_TAKEOVER",
          matchedKeyword: matchResult.matchedKeyword,
          errorMessage: "A human took over this conversation",
        },
      });
      continue;
    }

    const usage = await reserveWorkspaceDMSend(automation.workspaceId);
    if (!usage.allowed) {
      await prisma.dmLog.update({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        data: {
          status: "SKIPPED_PLAN_LIMIT",
          matchedKeyword: matchResult.matchedKeyword,
          errorMessage: `Monthly DM limit reached (${usage.limit})`,
        },
      });
      continue;
    }

    let rateLimit;
    try {
      rateLimit = await reserveDMSlot(instagramAccountId, requeueAttempt);
    } catch (error) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );
      await prisma.dmLog.update({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        data: {
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
        },
      });
      throw error;
    }

    if (!rateLimit.allowed) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );

      if (rateLimit.shouldSkip) {
        await prisma.dmLog.update({
          where: {
            automationId_commentId: {
              automationId: automation.id,
              commentId,
            },
          },
          data: {
            status: "SKIPPED_RATE_LIMIT",
            matchedKeyword: matchResult.matchedKeyword,
            errorMessage: "Hourly Instagram DM rate limit reached",
          },
        });
        continue;
      }

      if (rateLimit.shouldRequeue) {
        await prisma.dmLog.update({
          where: {
            automationId_commentId: {
              automationId: automation.id,
              commentId,
            },
          },
          data: {
            status: "PENDING",
            matchedKeyword: matchResult.matchedKeyword,
            errorMessage: "Hourly rate limit hit; retry scheduled",
          },
        });

        await getDMQueue().add(
          "process-comment",
          {
            ...job.data,
            requeueAttempt: requeueAttempt + 1,
          },
          {
            delay: rateLimit.requeueDelayMs,
            jobId: `comment_${instagramAccountId}_${commentId}_retry_${requeueAttempt + 1}`,
          }
        );
        continue;
      }
    }

    // With an opening DM, the private reply is a button message; tapping it
    // fires a postback that delivers the reveal (see processPostback). Without
    // one, we send the reveal text directly as today.
    const useOpeningDm =
      automation.openingDmEnabled &&
      Boolean(automation.openingDmMessage) &&
      Boolean(automation.openingDmButtonLabel);

    // Follow-gating: the link is revealed only after a follow. When an opening
    // DM is enabled it comes FIRST, and its button routes into the follow check
    // (opening DM → follow gate → link). Without an opening DM, we check follow
    // status at comment time: confirmed followers get the link now, everyone
    // else gets the "follow me first" prompt (re-verified on tap).
    let sendFollowPrompt = false;
    if (automation.requireFollow && !useOpeningDm) {
      const alreadyFollows = await getUserFollowStatus(accessToken, commenterId);
      sendFollowPrompt = alreadyFollows !== true;
    }

    const ledger = ledgerFor(automation, commenterId, "private_reply", commentId);

    try {
      if (useOpeningDm) {
        const openingText = renderMessageWithTracking({
          message: automation.openingDmMessage as string,
          commenterName,
          trackedLinks: [],
        });
        await ledger(openingText, (o) =>
          sendPrivateReplyWithButton(
            accessToken,
            automation.instagramAccount.instagramId,
            commentId,
            openingText,
            automation.openingDmButtonLabel as string,
            automation.requireFollow
              ? `followcheck:${automation.id}`
              : `reveal:${automation.id}`,
            o
          )
        );
      } else if (sendFollowPrompt) {
        const promptText = renderMessageWithoutLink({
          message:
            automation.followPromptMessage ||
            "quick favor before i send your link. i don't make any money from this, it's free. if you want to support me, just don't unfollow after, and star the repo on github if it helps you. tap the button once you're following and i'll send it over",
          commenterName,
        });
        await ledger(promptText, (o) =>
          sendPrivateReplyWithButton(
            accessToken,
            automation.instagramAccount.instagramId,
            commentId,
            promptText,
            automation.followPromptButtonLabel || "i'm following",
            `followcheck:${automation.id}`,
            o
          )
        );
      } else if (automation.trackedLinks.length > 0) {
        // Try button template first; if Meta rejects it, fall back to inline links.
        const bodyText =
          renderMessageWithoutLink({
            message: automation.dmMessage,
            commenterName,
          }) || "Here's your link:";
        const buttons = buildLinkButtons(
          automation.trackedLinks,
          automation.linkButtonLabel,
          commenterId
        );

        try {
          await ledger(bodyText, (o) =>
            sendPrivateReplyWithLinkButton(
              accessToken,
              automation.instagramAccount.instagramId,
              commentId,
              bodyText,
              buttons,
              o
            )
          );
        } catch (buttonError) {
          // Only a template rejection is worth retrying as text. Anything else
          // (closed window, comment already replied to) fails the same way and
          // would replace the real error with a misleading one.
          if (!isTemplateRejection(buttonError)) throw buttonError;

          console.log(
            "[DM Worker] Button template rejected, falling back to inline link:",
            formatError(buttonError)
          );
          const fallbackMessage = buildInlineLinkFallback(
            automation.dmMessage,
            commenterName,
            automation.trackedLinks,
            bodyText,
            commenterId
          );
          try {
            await ledger(fallbackMessage, (o) =>
              sendPrivateReply(
                accessToken,
                automation.instagramAccount.instagramId,
                commentId,
                fallbackMessage,
                o
              )
            );
          } catch {
            // The first attempt consumed the comment's single private reply, so
            // this one reports "invalid for a private reply" no matter what the
            // underlying problem was. Surface the original rejection instead.
            throw buttonError;
          }
        }
      } else {
        const dmMessage = renderMessageWithTracking({
          message: automation.dmMessage,
          commenterName,
          trackedLinks: automation.trackedLinks,
        });
        await ledger(dmMessage, (o) =>
          sendPrivateReply(
            accessToken,
            automation.instagramAccount.instagramId,
            commentId,
            dmMessage,
            o
          )
        );
      }

      const sentLog = await prisma.dmLog.update({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        data: {
          status: "SENT",
          dmSentAt: new Date(),
          errorMessage: null,
        },
      });
      if (sentLog?.id) await onDmLogSent(sentLog, automation);

      // 2026-10-03: the follow-up was only scheduled on the button-tap and DM
      // keyword paths, so campaigns that reply straight from a comment never
      // sent it. Schedule it here too. Meta may refuse it if the person never
      // replied (private-reply limit); processFollowUp just logs that.
      if (automation.followUpEnabled && automation.followUpMessage?.trim()) {
        try {
          await getDMQueue().add(
            FOLLOWUP_JOB_NAME,
            {
              instagramAccountId: automation.instagramAccount.instagramId,
              userId: commenterId,
              automationId: automation.id,
              commenterName,
            },
            {
              delay: Math.max(0, automation.followUpDelayMinutes ?? 0) * 60_000,
              jobId: `followup_${automation.id}_${commenterId}`,
            }
          );
        } catch (err) {
          // The DM already went out; a missed follow-up must not fail the job.
          console.warn("[DM Worker] Could not schedule follow-up:", formatError(err));
        }
      }
      // Sequence: the link went as a private reply, so the window is not open
      // yet; the enrollment waits for the person's first reply. Not for the
      // opening DM / follow prompt (no link yet: the tap path enrolls).
      if (!useOpeningDm && !sendFollowPrompt) {
        await enrollInSequence({ automation, igUserId: commenterId, username: commenterName });
      }
    } catch (error) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );

      await prisma.dmLog.update({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        data: {
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
        },
      });
      throw error;
    }
  }
}

/**
 * Deliver the reveal message after a user taps an opening DM's button.
 * The postback payload is `reveal:<automationId>`; the sender is the user's
 * IGSID (same id as their comment author id), which we DM directly.
 */
async function processPostback(job: Job<ProcessPostbackJob>): Promise<void> {
  const { instagramAccountId, userId, payload, fallback } = job.data;
  const tappedAt = new Date();

  // A real tap opens the 24-hour window (Meta lists it next to a DM). Any
  // payload counts, Ice Breakers included. The read fallback is not a tap.
  if (!fallback) {
    await trackInteraction({
      account: { instagramId: instagramAccountId },
      igUserId: userId,
      event: {
        type: "POSTBACK_IN",
        refId: job.data.mid ?? `${payload}@${job.id ?? tappedAt.getTime()}`,
        occurredAt: tappedAt,
        text: payload.slice(0, 200),
      },
    });
  }

  const isFollowCheck = payload.startsWith("followcheck:");
  if (!isFollowCheck && !payload.startsWith("reveal:")) return;
  const automationId = payload.slice(
    isFollowCheck ? "followcheck:".length : "reveal:".length
  );

  const automation = await prisma.automation.findFirst({
    where: { id: automationId, isActive: true },
    include: {
      instagramAccount: true,
      workspace: true,
      trackedLinks: {
        select: { slug: true, label: true, destinationUrl: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (
    !automation ||
    automation.instagramAccount.instagramId !== instagramAccountId ||
    !automation.instagramAccount.accessToken
  ) {
    return;
  }

  // Duplicate sends are enabled: every button tap re-sends the reveal
  // instead of only firing once per person.
  const dedupeId = `reveal:${userId}`;

  if (fallback) {
    const existingReveal = await prisma.dmLog.findUnique({
      where: {
        automationId_commentId: {
          automationId: automation.id,
          commentId: dedupeId,
        },
      },
    });
    if (existingReveal?.status === "SENT") return;
  }

  // Takeover and the 24-hour window, before anything is spent. A tap opens the
  // window by itself; the read fallback needs one opened by the person.
  const gate = await checkAutomation({
    instagramId: instagramAccountId,
    igUserId: userId,
    inboundAt: fallback ? null : tappedAt,
  });
  if (!gate.ok) {
    if (gate.reason === "takeover" && !fallback) {
      await prisma.dmLog.upsert({
        where: { automationId_commentId: { automationId: automation.id, commentId: dedupeId } },
        create: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId: userId,
          commentText: "(button tap)",
          commentId: dedupeId,
          status: "SKIPPED_TAKEOVER",
          errorMessage: "A human took over this conversation",
        },
        update: { status: "SKIPPED_TAKEOVER", errorMessage: "A human took over this conversation" },
      });
    } else {
      console.log(`[DM Worker] Postback not answered (${gate.reason})`);
    }
    return;
  }

  // Personalize {username} from the opening DM log for this user, if present.
  const openingLog = await prisma.dmLog.findFirst({
    where: { automationId: automation.id, commenterId: userId },
    select: { commenterName: true },
  });
  const commenterName = openingLog?.commenterName ?? null;

  let accessToken: string;
  try {
    accessToken = decryptToken(automation.instagramAccount.accessToken);
  } catch {
    return;
  }

  const ledger = ledgerFor(automation, userId, "automation", dedupeId);

  // Follow-gate: before revealing the link, verify the user follows. On a
  // `followcheck:` tap a non-follower gets the prompt again (no quota spent);
  // on a read fallback a non-follower is silently skipped — the gate must not
  // be bypassable by just reading the DM and waiting. Following, or
  // unverifiable (null), falls through and delivers the link — fail-open so a
  // real follower is never trapped.
  if ((isFollowCheck || fallback) && automation.requireFollow) {
    const follows = await getUserFollowStatus(accessToken, userId);
    if (follows === false) {
      if (fallback) return;
      const promptText = renderMessageWithoutLink({
        message:
          automation.followPromptMessage ||
          "quick favor before i send your link. i don't make any money from this, it's free. if you want to support me, just don't unfollow after, and star the repo on github if it helps you. tap the button once you're following and i'll send it over",
        commenterName,
      });
      try {
        await ledger(promptText, (o) =>
          sendDirectMessageWithButton(
            accessToken,
            automation.instagramAccount.instagramId,
            userId,
            promptText,
            automation.followPromptButtonLabel || "i'm following",
            `followcheck:${automation.id}`,
            o
          )
        );
      } catch (error) {
        console.log(
          "[DM Worker] Failed to re-send follow prompt:",
          formatError(error)
        );
      }
      return;
    }
  }

  const usage = await reserveWorkspaceDMSend(automation.workspaceId);
  if (!usage.allowed) {
    await prisma.dmLog.upsert({
      where: {
        automationId_commentId: { automationId: automation.id, commentId: dedupeId },
      },
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId: userId,
        commenterName,
        commentText: "(button tap)",
        commentId: dedupeId,
        status: "SKIPPED_PLAN_LIMIT",
        errorMessage: `Monthly DM limit reached (${usage.limit})`,
      },
      update: { status: "SKIPPED_PLAN_LIMIT" },
    });
    return;
  }

  try {
    await sendRevealDirectMessage(
      accessToken,
      automation,
      userId,
      commenterName,
      "postback",
      ledger
    );
    // Optional appreciation follow-up: once the link has been delivered, send a
    // short thank-you. It is scheduled as its own delayed job so it can go out
    // some minutes later (followUpDelayMinutes) rather than immediately. The
    // deterministic job id dedupes repeat button taps to one follow-up per user.
    if (automation.followUpEnabled && automation.followUpMessage?.trim()) {
      const delayMs =
        Math.max(0, automation.followUpDelayMinutes ?? 0) * 60_000;
      await getDMQueue().add(
        FOLLOWUP_JOB_NAME,
        {
          instagramAccountId: automation.instagramAccount.instagramId,
          userId,
          automationId: automation.id,
          commenterName,
        },
        {
          delay: delayMs,
          jobId: `followup_${automation.id}_${userId}`,
        }
      );
    }
    const sentLog = await prisma.dmLog.upsert({
      where: {
        automationId_commentId: { automationId: automation.id, commentId: dedupeId },
      },
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId: userId,
        commenterName,
        commentText: "(button tap)",
        commentId: dedupeId,
        status: "SENT",
        dmSentAt: new Date(),
      },
      update: { status: "SENT", dmSentAt: new Date(), errorMessage: null },
    });
    if (sentLog?.id) await onDmLogSent(sentLog, automation);
    await enrollInSequence({
      automation,
      igUserId: userId,
      username: commenterName,
      inboundAt: fallback ? null : tappedAt,
    });
  } catch (error) {
    await releaseWorkspaceDMReservation(automation.workspaceId, usage.periodStart);

    // The read fallback is speculative: it only runs when the user read the
    // opening DM and never tapped the button, which means they never messaged
    // us, which means the 24-hour window is closed and Meta rejects the send
    // ("outside of allowed window"). That is the expected outcome here, not a
    // failure the user can act on — so don't log it as FAILED and don't retry
    // it against a window that cannot reopen on its own. It still delivers in
    // the case that does work: the user replied by typing instead of tapping.
    if (fallback) {
      console.log(
        "[DM Worker] Read fallback not delivered (messaging window closed):",
        formatError(error)
      );
      return;
    }

    await prisma.dmLog.upsert({
      where: {
        automationId_commentId: { automationId: automation.id, commentId: dedupeId },
      },
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId: userId,
        commenterName,
        commentText: "(button tap)",
        commentId: dedupeId,
        status: "FAILED",
        errorMessage: formatError(error),
      },
      update: { status: "FAILED", errorMessage: formatError(error) },
    });
    throw error;
  }
}

/**
 * Send the scheduled appreciation follow-up. Runs after its delay elapses.
 * 2026-10-04: checks takeover and the 24-hour window first (it used to send
 * blind and fail silently when the delay was long).
 */
async function processFollowUp(job: Job<ProcessFollowUpJob>): Promise<void> {
  const { instagramAccountId, userId, automationId, commenterName } = job.data;

  const automation = await prisma.automation.findFirst({
    where: { id: automationId, isActive: true },
    include: { instagramAccount: true },
  });

  if (
    !automation ||
    !automation.followUpEnabled ||
    !automation.followUpMessage?.trim() ||
    automation.instagramAccount.instagramId !== instagramAccountId ||
    !automation.instagramAccount.accessToken
  ) {
    return;
  }

  const gate = await checkAutomation({ instagramId: instagramAccountId, igUserId: userId });
  if (!gate.ok) {
    console.log(`[DM Worker] Follow-up not sent (${gate.reason})`);
    return;
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(automation.instagramAccount.accessToken);
  } catch {
    return;
  }

  const text = renderMessageWithoutLink({
    message: automation.followUpMessage,
    commenterName: commenterName ?? null,
  });
  try {
    await ledgerFor(automation, userId, "followup", automation.id)(text, (o) =>
      sendDirectMessage(accessToken, automation.instagramAccount.instagramId, userId, text, o)
    );
  } catch (error) {
    console.log(
      "[DM Worker] Failed to send follow-up message:",
      formatError(error)
    );
  }
}

const CAMPAIGN_INCLUDE = {
  instagramAccount: true,
  workspace: true,
  trackedLinks: {
    select: { slug: true, label: true, destinationUrl: true },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.AutomationInclude;

type CampaignAutomation = Prisma.AutomationGetPayload<{ include: typeof CAMPAIGN_INCLUDE }>;

/**
 * Deliver a campaign to someone who is already talking to us (DM keyword,
 * ig.me link). Dedup per trigger id (DmLog @@unique automationId+commentId).
 * Respects takeover and the window, and enrolls the sequence afterwards.
 */
async function deliverCampaignToDm(input: {
  automation: CampaignAutomation;
  senderId: string;
  dedupeId: string;
  triggerText: string;
  matchedKeyword: string | null;
  attemptsMade: number;
  /** The person's DM / tap / link that opened the window. */
  inboundAt: Date;
  context: string;
}): Promise<void> {
  const { automation, senderId, dedupeId } = input;

  const existingLog = await prisma.dmLog.findUnique({
    where: {
      automationId_commentId: {
        automationId: automation.id,
        commentId: dedupeId,
      },
    },
  });

  // Already replied to this message (or deliberately skipped it) — a retry
  // of the job must not send a second DM.
  if (
    existingLog?.status === "SENT" ||
    existingLog?.status === "SKIPPED_PLAN_LIMIT" ||
    existingLog?.status === "SKIPPED_TAKEOVER"
  ) {
    return;
  }

  const logBase = {
    workspaceId: automation.workspaceId,
    automationId: automation.id,
    instagramAccountId: automation.instagramAccountId,
    commenterId: senderId,
    commentText: input.triggerText,
    commentId: dedupeId,
    matchedKeyword: input.matchedKeyword,
  };
  const logWhere = {
    automationId_commentId: { automationId: automation.id, commentId: dedupeId },
  };

  const gate = await checkAutomation({
    instagramId: automation.instagramAccount.instagramId,
    igUserId: senderId,
    inboundAt: input.inboundAt,
  });
  if (!gate.ok) {
    if (gate.reason === "takeover") {
      await prisma.dmLog.upsert({
        where: logWhere,
        create: { ...logBase, status: "SKIPPED_TAKEOVER", errorMessage: "A human took over this conversation" },
        update: { status: "SKIPPED_TAKEOVER", errorMessage: "A human took over this conversation" },
      });
    } else {
      console.log(`[DM Worker] ${input.context}: not answered (${gate.reason})`);
    }
    return;
  }

  if (!automation.instagramAccount.accessToken) {
    await prisma.dmLog.upsert({
      where: logWhere,
      create: {
        ...logBase,
        status: "FAILED",
        errorMessage: "No Instagram access token available",
      },
      update: {
        status: "FAILED",
        errorMessage: "No Instagram access token available",
      },
    });
    return;
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(automation.instagramAccount.accessToken);
  } catch {
    await prisma.dmLog.upsert({
      where: logWhere,
      create: {
        ...logBase,
        status: "FAILED",
        errorMessage: "Failed to decrypt Instagram access token",
      },
      update: {
        status: "FAILED",
        errorMessage: "Failed to decrypt Instagram access token",
      },
    });
    return;
  }

  // Reuse a name captured on an earlier interaction so {username} still
  // renders — the messages webhook carries only the sender's IGSID.
  const priorLog = await prisma.dmLog.findFirst({
    where: { automationId: automation.id, commenterId: senderId },
    select: { commenterName: true },
  });
  const commenterName = priorLog?.commenterName ?? null;

  // Follow gate: anyone not confirmed as a follower gets the prompt instead of
  // the link, with the same `followcheck:` button that re-verifies on tap.
  // `null` (unverifiable) prompts too — this is first contact, exactly like a
  // comment, so it follows processComment's fail-closed rule rather than the
  // postback path's fail-open one. Fail-open is only safe after a tap, where
  // the user has already claimed to follow; here it would hand the link to
  // anyone whose status the API happens not to resolve.
  let sendFollowPrompt = false;
  if (automation.requireFollow) {
    const follows = await getUserFollowStatus(accessToken, senderId);
    sendFollowPrompt = follows !== true;
  }

  const usage = await reserveWorkspaceDMSend(automation.workspaceId);
  if (!usage.allowed) {
    await prisma.dmLog.upsert({
      where: logWhere,
      create: {
        ...logBase,
        status: "SKIPPED_PLAN_LIMIT",
        errorMessage: `Monthly DM limit reached (${usage.limit})`,
      },
      update: {
        status: "SKIPPED_PLAN_LIMIT",
        errorMessage: `Monthly DM limit reached (${usage.limit})`,
      },
    });
    return;
  }

  const ledger = ledgerFor(automation, senderId, "automation", dedupeId);

  try {
    if (sendFollowPrompt) {
      const promptText = renderMessageWithoutLink({
        message:
          automation.followPromptMessage ||
          "Almost there! Follow me and tap the button below to grab your link 💛",
        commenterName,
      });
      await ledger(promptText, (o) =>
        sendDirectMessageWithButton(
          accessToken,
          automation.instagramAccount.instagramId,
          senderId,
          promptText,
          automation.followPromptButtonLabel || "I'm following ✅",
          `followcheck:${automation.id}`,
          o
        )
      );
    } else {
      await sendRevealDirectMessage(
        accessToken,
        automation,
        senderId,
        commenterName,
        input.context,
        ledger
      );

      // The link has been delivered, so the appreciation follow-up applies
      // here exactly as it does after a button tap. Not scheduled behind the
      // follow prompt — no link went out yet in that branch.
      if (automation.followUpEnabled && automation.followUpMessage?.trim()) {
        await getDMQueue().add(
          FOLLOWUP_JOB_NAME,
          {
            instagramAccountId: automation.instagramAccount.instagramId,
            userId: senderId,
            automationId: automation.id,
            commenterName,
          },
          {
            delay: Math.max(0, automation.followUpDelayMinutes ?? 0) * 60_000,
            jobId: `followup_${automation.id}_${senderId}`,
          }
        );
      }
    }

    const sentLog = await prisma.dmLog.upsert({
      where: logWhere,
      create: {
        ...logBase,
        commenterName,
        status: "SENT",
        dmSentAt: new Date(),
      },
      update: {
        status: "SENT",
        dmSentAt: new Date(),
        errorMessage: null,
      },
    });
    // The follow prompt is not the campaign yet; only the reveal counts.
    if (sentLog?.id && !sendFollowPrompt) {
      await onDmLogSent(sentLog, automation);
      await enrollInSequence({
        automation,
        igUserId: senderId,
        username: commenterName,
        inboundAt: input.inboundAt,
      });
    }
  } catch (error) {
    await releaseWorkspaceDMReservation(
      automation.workspaceId,
      usage.periodStart
    );
    await prisma.dmLog.upsert({
      where: logWhere,
      create: {
        ...logBase,
        commenterName,
        status: "FAILED",
        attempts: input.attemptsMade + 1,
        errorMessage: formatError(error),
      },
      update: {
        status: "FAILED",
        attempts: input.attemptsMade + 1,
        errorMessage: formatError(error),
      },
    });
    throw error;
  }
}

/**
 * Reply to an inbound DM whose text matches a campaign's keywords.
 *
 * The user has messaged us, so the conversation is already open: this path
 * skips the opening DM (which exists to work around private-reply limits from
 * comments) and delivers the reveal directly, honouring the follow gate.
 * Dedup is per inbound message id, so each message triggers at most one reply.
 */
async function processMessage(job: Job<ProcessMessageJob>): Promise<void> {
  const { instagramAccountId, messageId, messageText, senderId } = job.data;
  const receivedAt = new Date(job.timestamp || Date.now());

  const automations = await prisma.automation.findMany({
    where: {
      dmTriggerEnabled: true,
      isActive: true,
      instagramAccount: { instagramId: instagramAccountId },
    },
    include: CAMPAIGN_INCLUDE,
    orderBy: { createdAt: "asc" },
  });

  const dedupeId = `dm:${messageId}`;

  for (const automation of automations) {
    const matchResult = automation.matchAnyWord
      ? { matched: true, matchedKeyword: null }
      : matchKeywords(
          messageText,
          automation.keywords,
          automation.wholeWordMatch
        );

    if (!matchResult.matched) continue;

    await deliverCampaignToDm({
      automation,
      senderId,
      dedupeId,
      triggerText: messageText,
      matchedKeyword: matchResult.matchedKeyword,
      attemptsMade: job.attemptsMade,
      inboundAt: receivedAt,
      context: "message trigger",
    });
  }
}

/**
 * CRM for one DM, out of the webhook request: contact + timeline + tags
 * (onDirectMessage), lastOutboundAt, and then
 *  - inbound: the person answered, so their running sequences stop (or the
 *    one waiting for this first reply starts);
 *  - echo: ours (metadata / ledger / template / same text) or typed by the
 *    owner on the phone, which turns human takeover on.
 */
async function processCrmDm(job: Job<CrmDmJob>): Promise<void> {
  await handleCrmDm(job.data);
}

/**
 * Someone opened the DM through ig.me/m/<user>?ref=<code>: tag where they came
 * from, count the open once per event, reopen the window (thread already
 * existed) and, when the link has a campaign, deliver it.
 */
async function processReferral(job: Job<ReferralJob>): Promise<void> {
  const data = job.data;
  const link = await prisma.conversationLink.findFirst({
    where: { code: data.ref, isActive: true, instagramAccount: { instagramId: data.instagramAccountId } },
    select: { id: true, code: true, origin: true, tagName: true, automationId: true },
  });
  if (!link) return;

  const occurredAt = new Date(data.timestamp || Date.now());
  const eventKey = data.mid ?? `ref:${data.timestamp}`;
  const tracked = await trackInteraction({
    account: { instagramId: data.instagramAccountId },
    igUserId: data.igUserId,
    event: {
      type: "REFERRAL",
      refId: `${link.id}:${eventKey}`,
      occurredAt,
      text: link.code,
      meta: { code: link.code, origin: link.origin, kind: data.kind },
    },
    tags: [link.tagName || AUTO_TAGS.cameFrom(link.origin)],
  }, { throwOnError: true });
  if (!tracked) return;

  const { count } = await prisma.conversationLinkOpen.createMany({
    data: [
      {
        linkId: link.id,
        contactId: tracked.contact.id,
        eventKey,
        kind: data.kind,
        isNewThread: data.kind !== "referral",
        occurredAt,
      },
    ],
    skipDuplicates: true,
  });
  // Count the open once per event. A retried job (the campaign send threw)
  // still goes on to the delivery: DmLog dedupes it, so nothing is sent twice.
  if (count === 1) {
    await prisma.conversationLink.update({ where: { id: link.id }, data: { opens: { increment: 1 } } });
  }

  if (!link.automationId) return;
  const automation = await prisma.automation.findFirst({
    where: { id: link.automationId, isActive: true },
    include: CAMPAIGN_INCLUDE,
  });
  if (!automation || automation.instagramAccount.instagramId !== data.instagramAccountId) return;

  await deliverCampaignToDm({
    automation,
    senderId: data.igUserId,
    // A link opened by a typed message is also that message: same DmLog key
    // as the DM-keyword path (processMessage), so one campaign never answers
    // the same message twice.
    dedupeId: data.kind === "message" && data.mid ? `dm:${data.mid}` : `ref:${eventKey}`,
    triggerText: `(link ${link.code})`,
    matchedKeyword: null,
    attemptsMade: job.attemptsMade,
    inboundAt: occurredAt,
    context: "conversation link",
  });
}

async function processSequenceStep(job: Job<SequenceStepJob>): Promise<void> {
  const outcome = await runSequenceStep(job.data);
  if (outcome !== "sent" && outcome !== "noop") {
    console.log(`[DM Worker] Sequence ${job.data.enrollmentId} step ${job.data.order}: ${outcome}`);
  }
}

async function runJob(job: Job<DmQueueJob>): Promise<void> {
  if (job.name === POSTBACK_JOB_NAME) {
    return processPostback(job as Job<ProcessPostbackJob>);
  }
  if (job.name === FOLLOWUP_JOB_NAME) {
    return processFollowUp(job as Job<ProcessFollowUpJob>);
  }
  if (job.name === MESSAGE_JOB_NAME) {
    return processMessage(job as Job<ProcessMessageJob>);
  }
  if (job.name === SAVE_MEDIA_JOB_NAME) {
    await downloadDirectMedia((job.data as SaveMediaJob).mediaId);
    return;
  }
  if (job.name === CRM_DM_JOB_NAME) {
    return processCrmDm(job as Job<CrmDmJob>);
  }
  if (job.name === REFERRAL_JOB_NAME) {
    return processReferral(job as Job<ReferralJob>);
  }
  if (job.name === SEQUENCE_STEP_JOB_NAME) {
    return processSequenceStep(job as Job<SequenceStepJob>);
  }
  return processComment(job as Job<ProcessCommentJob>);
}

async function processJob(job: Job<DmQueueJob>): Promise<void> {
  try {
    await runJob(job);
  } catch (error) {
    // Meta's "unknown error" often comes back for a message it DID deliver.
    // Retrying re-sends it: on 2026-10-02 one person got the same DM 6 times
    // (3 attempts x button + text fallback). Better to miss one DM than spam.
    if (isAmbiguousDeliveryError(error)) {
      throw new UnrecoverableError(
        `Not retried (Meta may have delivered it): ${formatError(error)}`
      );
    }
    throw error;
  }
}

async function recordWorkerFailure(
  job: Job<DmQueueJob> | undefined,
  error: Error
) {
  try {
    const instagramAccountId = job?.data.instagramAccountId;
    const commentId =
      job && "commentId" in job.data ? job.data.commentId : null;
    const account = instagramAccountId
      ? await prisma.instagramAccount.findUnique({
          where: { instagramId: instagramAccountId },
          select: { workspaceId: true },
        })
      : null;

    await prisma.operationalEvent.create({
      data: {
        workspaceId: account?.workspaceId ?? null,
        source: "WORKER",
        level: "ERROR",
        message: `DM worker job ${job?.id ?? "unknown"} failed: ${error.message}`,
        payload: {
          jobId: job?.id ?? null,
          attemptsMade: job?.attemptsMade ?? null,
          instagramAccountId: instagramAccountId ?? null,
          commentId,
        },
      },
    });

    await recordWorkerAlert({
      level: "error",
      message: error.message,
      jobId: job?.id,
      instagramAccountId,
      commentId: commentId ?? undefined,
    });
  } catch (recordError) {
    console.error(
      "[DM Worker] Failed to record worker failure:",
      formatError(recordError)
    );
  }
}

export function createDMWorker(): Worker<DmQueueJob> {
  const worker = new Worker<DmQueueJob>(
    "dm-processing",
    processJob,
    {
      connection: getRedisConnection(),
      concurrency: 5,
      settings: {
        backoffStrategy: (attemptsMade: number) =>
          BACKOFF_DELAYS[Math.min(attemptsMade - 1, BACKOFF_DELAYS.length - 1)],
      },
    }
  );

  worker.on("completed", (job) => {
    console.log(`[DM Worker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(
      `[DM Worker] Job ${job?.id} failed (attempt ${job?.attemptsMade}):`,
      err.message
    );
    void recordWorkerFailure(job, err);
  });

  worker.on("error", (err) => {
    console.error("[DM Worker] Worker error:", err.message);
    void prisma.operationalEvent
      .create({
        data: {
          source: "WORKER",
          level: "ERROR",
          message: `DM worker process error: ${err.message}`,
          payload: { name: err.name },
        },
      })
      .catch((recordError) => {
        console.error(
          "[DM Worker] Failed to record worker process error:",
          formatError(recordError)
        );
      });
  });

  return worker;
}

