/**
 * BullMQ Queue Client
 *
 * Provides the DM processing queue and Redis connection for BullMQ.
 */

import { Queue } from "bullmq";
import Redis from "ioredis";
import type { FlowJob } from "@/lib/flows/jobs";

let connection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!connection) {
    connection = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null, // Required by BullMQ
    });
  }
  return connection;
}

// ─── DM Queue ───────────────────────────────────────────────────────────────────

export type CommentSource = "WEBHOOK" | "POLLING";

export interface ProcessCommentJob {
  instagramAccountId: string;
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterName?: string;
  mediaId: string;
  // Set when the comment came from an ad: the organic post the ad was made
  // from. Campaigns are bound to that post, so both ids have to be matched.
  originalMediaId?: string;
  requeueAttempt?: number;
  // Which path enqueued this comment. Recorded in the shared ProcessedComment
  // dedup store so the reconciler can tell webhook- from polling-caught comments.
  source?: CommentSource;
  // "live" = a comment during one of our lives (webhook field live_comments):
  // only LIVE_COMMENT campaigns answer it. Absent = a post comment.
  surface?: "post" | "live";
}

// Delivered when a user taps an opening DM's button — carries the reveal target.
export interface ProcessPostbackJob {
  instagramAccountId: string;
  userId: string;
  payload: string;
  mid?: string;
  fallback?: boolean;
}

// Scheduled after the link is delivered, to send the appreciation follow-up.
// Enqueued with a delay (followUpDelayMinutes) so it can fire later, not just
// immediately.
export interface ProcessFollowUpJob {
  instagramAccountId: string;
  userId: string;
  automationId: string;
  commenterName?: string | null;
}

// An inbound DM from a user. Campaigns with `dmTriggerEnabled` whose keywords
// match the text reply to the sender.
export interface ProcessMessageJob {
  instagramAccountId: string;
  messageId: string;
  messageText: string;
  senderId: string;
  // 2026-10-06: a reply to one of our stories (STORY_REPLY campaigns) or a
  // mention of us in someone's story (STORY_MENTION, no text).
  storyKind?: "reply" | "mention";
  storyId?: string;
  storyUrl?: string;
  /** Event time in ms (opens the 24 h window). */
  timestamp?: number;
  /** Etapa 3: the ig.me ref when this DM opened a conversation link (flows only). */
  linkRef?: string;
}

// Download a DM photo/video/audio as soon as it arrives (Meta links expire).
export interface SaveMediaJob {
  instagramAccountId: string;
  mediaId: string;
}

// CRM for one DM (both directions), taken out of the webhook request. Also
// classifies echoes (ours vs typed on the phone -> human takeover) and stops
// sequences when the person replies.
export interface CrmDmJob {
  /** Our account's instagramId (webhook entry.id). */
  instagramAccountId: string;
  igUserId: string;
  mid: string;
  fromMe: boolean;
  text: string | null;
  /** ISO string. */
  sentAt: string;
  storyReply: boolean;
  storyKind?: "reply" | "mention" | null;
  metadata: string | null;
  appId: string | null;
  hasTemplate: boolean;
  /** Set on the delayed re-check of an echo we could not classify yet. */
  late?: boolean;
}

// Someone opened the DM through an ig.me?ref= link.
export interface ReferralJob {
  instagramAccountId: string;
  igUserId: string;
  ref: string;
  kind: "referral" | "postback" | "message";
  mid?: string;
  /**
   * Etapa 3: the typed DM's own message job already offered this event to
   * the flows (after the DM campaigns), so this job must not (flows only).
   */
  flowsViaMessage?: boolean;
  /** Milliseconds. */
  timestamp: number;
}

// One step of a campaign's sequence, scheduled with the step's delay.
export interface SequenceStepJob {
  instagramAccountId: string;
  enrollmentId: string;
  order: number;
}

// Look up a contact's username / name / photo (User Profile API), out of the
// webhook. jobId profile_<contactId>_<attempts> (lib/contacts/profile.ts).
export interface ProfileJob {
  /** Our account's instagramId, like every other job (noteMetaError). */
  instagramAccountId: string;
  contactId: string;
  /** How many times the budget pushed it back. */
  requeue?: number;
}

export type DmQueueJob =
  | ProcessCommentJob
  | ProcessPostbackJob
  | ProcessFollowUpJob
  | ProcessMessageJob
  | SaveMediaJob
  | CrmDmJob
  | ReferralJob
  | SequenceStepJob
  | ProfileJob
  // Etapa 3: names and shapes in lib/flows/jobs.ts.
  | FlowJob;

export const SAVE_MEDIA_JOB_NAME = "save-media";
export const POSTBACK_JOB_NAME = "process-postback";
export const FOLLOWUP_JOB_NAME = "process-followup";
export const MESSAGE_JOB_NAME = "process-message";
export const CRM_DM_JOB_NAME = "crm-dm";
export const REFERRAL_JOB_NAME = "process-referral";
export const SEQUENCE_STEP_JOB_NAME = "sequence-step";
export const PROFILE_JOB_NAME = "fetch-profile";

/** BullMQ job ids cannot contain ":"; base64url keeps them injective. */
export function safeJobKey(value: string): string {
  return Buffer.from(value).toString("base64url");
}

let dmQueue: Queue<DmQueueJob> | null = null;

export function getDMQueue(): Queue<DmQueueJob> {
  if (!dmQueue) {
    dmQueue = new Queue<DmQueueJob>("dm-processing", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 1000 }, // Keep last 1000 completed jobs
        // Clear failed jobs shortly after they exhaust retries. Job ids are
        // deterministic (comment_<acct>_<id>), so a retained failed job would
        // block the polling reconciler from ever retrying that comment. Clearing
        // them lets a later sweep re-enqueue and try again once a transient
        // failure (e.g. an Instagram rate-limit window) has passed. Failure
        // detail is still preserved in DmLog.
        removeOnFail: { age: 300, count: 2000 },
        attempts: 3,
        backoff: {
          type: "custom",
        },
      },
    });
  }
  return dmQueue;
}
