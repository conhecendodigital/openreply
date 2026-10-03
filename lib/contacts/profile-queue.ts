/**
 * When to look up a contact's profile (username, name, photo) and how to queue
 * it. Kept tiny and free of the Graph client so lib/contacts/record.ts (used
 * by the webhook, the redirect and the worker) can call it cheaply.
 *
 * People who arrive by DM, ig.me link or button tap carry only their IGSID,
 * so they show as "unknown". The lookup runs in the worker (PROFILE_JOB),
 * never in the webhook request.
 *
 * Retry rule: a contact is looked up once. When Meta denies it (no consent)
 * or it fails, it is only tried again after a NEWER DM from the person, and
 * only once 7 days (denied) / 1 day (error) went by, up to 5 attempts. The
 * real guard is profileStatus in the database: BullMQ job ids are only kept
 * for the last 1000 completed jobs.
 */
import type { ContactEventType } from "@/lib/contacts/record";

export const PROFILE_MAX_ATTEMPTS = 5;
export const PROFILE_RETRY_DENIED_MS = 7 * 24 * 3_600_000;
export const PROFILE_RETRY_ERROR_MS = 24 * 3_600_000;
const ENQUEUE_TIMEOUT_MS = 2_000;
/**
 * After a failed enqueue, skip the next ones for a while: one webhook payload
 * can carry many DMs, and with Redis down (the inline CRM fallback) each one
 * would otherwise wait the full 2 s and push the answer past Meta's timeout.
 * Nothing is lost: the person's next DM queues the lookup again.
 */
const ENQUEUE_COOLDOWN_MS = 30_000;
let enqueueFailedAt = 0;

/** For tests: forget the last failed enqueue. */
export function resetProfileQueueCooldown(): void {
  enqueueFailedAt = 0;
}

export type ProfileState = {
  username?: string | null;
  profileStatus?: string | null;
  profileFetchedAt?: Date | null;
  profileAttempts?: number | null;
};

export function needsProfileLookup(
  contact: ProfileState,
  event?: { type: ContactEventType; occurredAt: Date } | null,
  now: Date = new Date()
): boolean {
  if (contact.username) return false;
  // Never tried (the column is NULL, not just missing from a select).
  if (contact.profileStatus === null) return true;
  if (contact.profileStatus !== "denied" && contact.profileStatus !== "error") return false;
  // Denied / failed: only a newer DM from the person earns another try.
  if (!event || event.type !== "DM_IN") return false;
  if ((contact.profileAttempts ?? 0) >= PROFILE_MAX_ATTEMPTS) return false;
  const fetchedAt = contact.profileFetchedAt;
  if (!fetchedAt) return true;
  if (event.occurredAt <= fetchedAt) return false;
  const wait = contact.profileStatus === "denied" ? PROFILE_RETRY_DENIED_MS : PROFILE_RETRY_ERROR_MS;
  return now.getTime() - fetchedAt.getTime() >= wait;
}

export function profileJobId(contactId: string, attempts: number): string {
  return `profile_${contactId}_${attempts}`;
}

/**
 * Queue the lookup. Never throws and never waits more than 2 s (the CRM job
 * and the inline webhook fallback must not hang on Redis).
 */
export async function queueProfileLookup(input: {
  instagramId: string;
  contactId: string;
  attempts?: number | null;
}): Promise<boolean> {
  if (!process.env.REDIS_URL) return false;
  if (enqueueFailedAt && Date.now() - enqueueFailedAt < ENQUEUE_COOLDOWN_MS) return false;
  try {
    const { getDMQueue, PROFILE_JOB_NAME } = await import("@/lib/queue/client");
    const add = getDMQueue().add(
      PROFILE_JOB_NAME,
      { instagramAccountId: input.instagramId, contactId: input.contactId },
      { jobId: profileJobId(input.contactId, input.attempts ?? 0), attempts: 1 }
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("queue timeout")), ENQUEUE_TIMEOUT_MS);
    });
    try {
      await Promise.race([add, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    enqueueFailedAt = 0;
    return true;
  } catch (error) {
    enqueueFailedAt = Date.now();
    console.warn("[CRM] Could not queue profile lookup:", error instanceof Error ? error.message : error);
    return false;
  }
}
