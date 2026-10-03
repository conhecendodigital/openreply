/**
 * Comment moderation: classify each new comment and, when the account is in
 * HIDE mode, hide spam/scam/offense through the official API. Runs inside the
 * worker's processComment, so both the webhook and the polling sweep go
 * through it, deduped by the job id and by CommentModeration.commentId.
 *
 * Safety rules:
 * - The account starts in OBSERVE: decisions are only recorded.
 * - Never hides our own comments, a comment that matches an active campaign
 *   keyword on that post, or one containing an "allowed" term.
 * - Never throws: a Meta error becomes a FAILED row, so the job is not retried
 *   (a retry would re-run the DM leg).
 */
import type {
  ModerationAction,
  ModerationMode,
} from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { hideComment } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { channelOffCode, channelOffMessage, noteMetaError } from "@/lib/channels/status";
import { matchKeywords } from "@/lib/utils/keyword-matcher";
import {
  AUTO_TAGS,
  removeTag,
  trackInteraction,
  type ContactRef,
} from "@/lib/contacts/record";
import {
  classify,
  DEFAULT_CATEGORIES,
  findAllowedTerm,
  wordCount,
  type ModerationVerdict,
} from "@/lib/moderation/rules";
import { askJev, isJevAvailable } from "@/lib/moderation/jev";

export type ModerationSettingsValues = {
  mode: ModerationMode;
  categories: string[];
  blockedTerms: string[];
  allowedTerms: string[];
  useJev: boolean;
  jevMinConfidence: number;
  /** Ceiling of automatic hides per hour per account (default 30). */
  maxHidesPerHour?: number;
};

export const DEFAULT_MAX_HIDES_PER_HOUR = 30;
export const CAP_RULE = "teto";

export const DEFAULT_MODERATION_SETTINGS: ModerationSettingsValues = {
  mode: "OBSERVE",
  categories: [...DEFAULT_CATEGORIES],
  blockedTerms: [],
  allowedTerms: [],
  useJev: false,
  jevMinConfidence: 0.8,
  maxHidesPerHour: DEFAULT_MAX_HIDES_PER_HOUR,
};

/**
 * Take one automatic-hide slot for this account in the last hour. Runs under
 * a per-account advisory lock, so the worker's parallel jobs cannot all pass
 * the count at once. The slot is the row itself (hiddenBy "auto" + hiddenAt),
 * written before the API call. Manual hides (owner / MCP) never count.
 */
export async function reserveHideSlot(input: {
  instagramAccountId: string;
  moderationId: string;
  cap: number;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const hourAgo = new Date(now.getTime() - 3_600_000);
  return prisma.$transaction(async (tx) => {
    const lockKey = `modhide:${input.instagramAccountId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const used = await tx.commentModeration.count({
      where: { instagramAccountId: input.instagramAccountId, hiddenBy: "auto", hiddenAt: { gt: hourAgo } },
    });
    if (used >= input.cap) return false;
    await tx.commentModeration.update({
      where: { id: input.moderationId },
      data: { hiddenBy: "auto", hiddenAt: now },
    });
    return true;
  });
}

/** Comments this short are never sent to Jev (they are almost never spam). */
const JEV_MIN_WORDS = 4;

export type ModerationJob = {
  /** Our account's instagramId (webhook entry.id). */
  instagramAccountId: string;
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterName?: string | null;
  mediaId: string;
  originalMediaId?: string | null;
};

export type CampaignMatcher = {
  keywords: string[];
  wholeWordMatch: boolean;
  matchAnyWord: boolean;
};

export type Evaluation = {
  verdict: ModerationVerdict;
  matchedRule: string | null;
  reason: string | null;
  jevConfidence: number | null;
  /** False when only Jev flagged it below the confidence bar. */
  confident: boolean;
};

/**
 * Rules first; Jev only when the rules found nothing, Jev is on and the key
 * exists. Shared by the worker and the "test a comment" route.
 */
export async function evaluateComment(
  text: string,
  settings: ModerationSettingsValues,
  options: { allowJev?: boolean } = {}
): Promise<Evaluation> {
  const rules = classify(text, settings);
  if (rules.verdict !== "ok") {
    return { ...rules, jevConfidence: null, confident: true };
  }

  const jevEligible =
    options.allowJev !== false &&
    settings.useJev &&
    isJevAvailable() &&
    wordCount(text) >= JEV_MIN_WORDS;
  if (!jevEligible) return { ...rules, jevConfidence: null, confident: true };

  const answer = await askJev(text);
  if (!answer || answer.category === "ok" || !settings.categories.includes(answer.category)) {
    return {
      verdict: "ok",
      matchedRule: null,
      reason: null,
      jevConfidence: answer?.confidence ?? null,
      confident: true,
    };
  }
  return {
    verdict: answer.category,
    matchedRule: "jev",
    reason: `Jev: ${answer.choice} ${answer.confidence.toFixed(2)}`,
    jevConfidence: answer.confidence,
    confident: answer.confidence >= settings.jevMinConfidence,
  };
}

export function matchesCampaign(text: string, campaigns: CampaignMatcher[]): boolean {
  // "Any word" campaigns are not a protection: they match everything, which
  // would switch moderation off on that post.
  return campaigns.some(
    (c) => !c.matchAnyWord && matchKeywords(text, c.keywords, c.wholeWordMatch).matched
  );
}

async function loadCampaigns(job: ModerationJob): Promise<CampaignMatcher[]> {
  return prisma.automation.findMany({
    where: {
      isActive: true,
      instagramAccount: { instagramId: job.instagramAccountId },
      OR: [
        { postId: job.mediaId },
        ...(job.originalMediaId ? [{ postId: job.originalMediaId }] : []),
        { matchAnyPost: true },
      ],
    },
    select: { keywords: true, wholeWordMatch: true, matchAnyWord: true },
  });
}

export type ModerationOutcome = {
  action: ModerationAction | "OFF" | "CLEAN" | "DUPLICATE";
  moderationId?: string;
  verdict?: ModerationVerdict;
  protectedReason?: string;
  /** True when the hourly ceiling turned a hide into WOULD_HIDE. */
  capped?: boolean;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "P2002");
}

export async function moderateComment(
  job: ModerationJob,
  options: { campaigns?: CampaignMatcher[] } = {}
): Promise<ModerationOutcome> {
  try {
    const account = await prisma.instagramAccount.findUnique({
      where: { instagramId: job.instagramAccountId },
      select: {
        id: true,
        workspaceId: true,
        instagramId: true,
        accessToken: true,
        status: true,
        moderationSettings: true,
      },
    });
    // Channel off (disconnected / needs reconnect): moderation does nothing.
    if (!account || account.status !== "ACTIVE") return { action: "OFF" };

    const settings: ModerationSettingsValues = account.moderationSettings ?? DEFAULT_MODERATION_SETTINGS;
    if (settings.mode === "OFF") return { action: "OFF" };

    const text = job.commentText ?? "";
    let protectedReason: string | null = null;
    if (job.commenterId === account.instagramId) protectedReason = "own_account";
    else if (findAllowedTerm(text, settings.allowedTerms)) protectedReason = "allowed_term";
    else if (matchesCampaign(text, options.campaigns ?? (await loadCampaigns(job)))) {
      protectedReason = "campaign_keyword";
    }

    // A protected comment never goes to Jev (no point paying for it).
    const evaluation = await evaluateComment(text, settings, { allowJev: !protectedReason });
    if (evaluation.verdict === "ok") return { action: "CLEAN" };

    const existing = await prisma.commentModeration.findUnique({
      where: { commentId: job.commentId },
      select: { id: true },
    });
    if (existing) return { action: "DUPLICATE", moderationId: existing.id };

    const willHide = !protectedReason && settings.mode === "HIDE" && evaluation.confident;
    const initialAction: ModerationAction = protectedReason ? "SKIPPED_PROTECTED" : "WOULD_HIDE";

    let row: { id: string };
    try {
      row = await prisma.commentModeration.create({
        data: {
          workspaceId: account.workspaceId,
          instagramAccountId: account.id,
          commentId: job.commentId,
          mediaId: job.mediaId,
          commenterIgId: job.commenterId,
          commenterUsername: job.commenterName ?? null,
          commentText: text.slice(0, 2200),
          verdict: evaluation.verdict,
          reason: evaluation.reason,
          matchedRule: evaluation.matchedRule,
          jevConfidence: evaluation.jevConfidence,
          action: initialAction,
          protectedReason,
          mode: settings.mode,
        },
        select: { id: true },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return { action: "DUPLICATE" };
      throw error;
    }

    if (!willHide) {
      return {
        action: initialAction,
        moderationId: row.id,
        verdict: evaluation.verdict,
        ...(protectedReason ? { protectedReason } : {}),
      };
    }

    // Hourly ceiling: above it the match is only recorded (WOULD_HIDE "teto").
    const cap = settings.maxHidesPerHour ?? DEFAULT_MAX_HIDES_PER_HOUR;
    const hasSlot = await reserveHideSlot({
      instagramAccountId: account.id,
      moderationId: row.id,
      cap,
    });
    if (!hasSlot) {
      await prisma.commentModeration.update({
        where: { id: row.id },
        data: {
          matchedRule: CAP_RULE,
          reason: `${evaluation.reason ? `${evaluation.reason} · ` : ""}teto de ${cap}/h atingido`.slice(0, 500),
        },
      });
      return { action: "WOULD_HIDE", moderationId: row.id, verdict: evaluation.verdict, capped: true };
    }

    try {
      if (!account.accessToken) throw new Error("No Instagram access token available");
      await hideComment(decryptToken(account.accessToken), job.commentId, true);
    } catch (error) {
      await noteMetaError({ id: account.id }, error);
      await prisma.commentModeration.update({
        where: { id: row.id },
        // Give the slot back: nothing was hidden.
        data: { action: "FAILED", error: errorText(error).slice(0, 500), hiddenBy: null, hiddenAt: null },
      });
      return { action: "FAILED", moderationId: row.id, verdict: evaluation.verdict };
    }

    const hiddenAt = new Date();
    await prisma.commentModeration.update({
      where: { id: row.id },
      data: { action: "HIDDEN", hiddenAt, hiddenBy: "auto" },
    });
    await trackInteraction({
      account,
      igUserId: job.commenterId,
      username: job.commenterName,
      event: {
        type: "COMMENT_HIDDEN",
        refId: row.id,
        occurredAt: hiddenAt,
        text: text,
        mediaId: job.mediaId,
        meta: { commentId: job.commentId, verdict: evaluation.verdict, reason: evaluation.reason },
      },
      tags: [AUTO_TAGS.moderated(evaluation.verdict)],
    });
    return { action: "HIDDEN", moderationId: row.id, verdict: evaluation.verdict };
  } catch (error) {
    console.warn("[Moderation] Skipped comment:", errorText(error));
    return { action: "OFF" };
  }
}

export type ManualResult =
  | { ok: true; row: Awaited<ReturnType<typeof prisma.commentModeration.update>> }
  | { ok: false; status: number; error: string };

/**
 * Restore (hidden=false) or hide now (hidden=true) a recorded decision. Only
 * acts on comments that already have a moderation row: never on a free-form
 * comment id.
 */
export async function setModerationHidden(input: {
  moderationId: string;
  workspaceId: string;
  hidden: boolean;
  actor: string;
}): Promise<ManualResult> {
  const row = await prisma.commentModeration.findFirst({
    where: { id: input.moderationId, workspaceId: input.workspaceId },
    include: {
      instagramAccount: {
        select: { id: true, workspaceId: true, instagramId: true, accessToken: true, status: true },
      },
    },
  });
  if (!row) return { ok: false, status: 404, error: "Moderation record not found" };
  if (row.instagramAccount.status !== "ACTIVE") {
    return { ok: false, status: 409, error: channelOffMessage(channelOffCode(row.instagramAccount.status)) };
  }

  const allowed: ModerationAction[] = input.hidden
    ? ["WOULD_HIDE", "FAILED", "RESTORED", "SKIPPED_PROTECTED"]
    : ["HIDDEN"];
  if (!allowed.includes(row.action)) {
    return {
      ok: false,
      status: 409,
      error: input.hidden ? "Comment is already hidden" : "Comment is not hidden",
    };
  }
  if (row.commenterIgId === row.instagramAccount.instagramId) {
    return { ok: false, status: 409, error: "Own comments cannot be hidden" };
  }
  if (!row.instagramAccount.accessToken) {
    return { ok: false, status: 400, error: "No Instagram access token available" };
  }

  try {
    await hideComment(decryptToken(row.instagramAccount.accessToken), row.commentId, input.hidden);
  } catch (error) {
    await noteMetaError({ id: row.instagramAccount.id }, error);
    if (input.hidden) {
      await prisma.commentModeration
        .update({ where: { id: row.id }, data: { error: errorText(error).slice(0, 500) } })
        .catch(() => {});
    }
    return { ok: false, status: 502, error: errorText(error) };
  }

  const now = new Date();
  const updated = await prisma.commentModeration.update({
    where: { id: row.id },
    data: input.hidden
      ? { action: "HIDDEN", hiddenAt: now, hiddenBy: input.actor, error: null, restoredAt: null, restoredBy: null }
      : { action: "RESTORED", restoredAt: now, restoredBy: input.actor },
  });

  const result = await trackInteraction({
    account: row.instagramAccount,
    igUserId: row.commenterIgId,
    username: row.commenterUsername,
    event: {
      type: input.hidden ? "COMMENT_HIDDEN" : "COMMENT_RESTORED",
      refId: `${row.id}@${now.getTime()}`,
      occurredAt: now,
      text: row.commentText,
      mediaId: row.mediaId,
      meta: { commentId: row.commentId, verdict: row.verdict, by: input.actor },
    },
    tags: input.hidden ? [AUTO_TAGS.moderated(row.verdict)] : [],
  });
  if (!input.hidden && result) {
    await removeTagSafe(result.contact, AUTO_TAGS.moderated(row.verdict));
  }
  return { ok: true, row: updated };
}

async function removeTagSafe(contact: ContactRef, name: string) {
  try {
    await removeTag(contact, name);
  } catch {
    // The restore already happened on Instagram; a stale tag is harmless.
  }
}
