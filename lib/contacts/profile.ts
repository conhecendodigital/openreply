/**
 * Fill a contact's username, name and photo (2026-10-06: 45 of 259 contacts
 * showed as "Usuário desconhecido": they came by DM, ig.me link or button tap,
 * and those webhooks only carry the IGSID).
 *
 * Order: what we already have locally (campaign logs, moderation rows) first,
 * then the User Profile API (GET /<IGSID>?fields=username,name,profile_pic),
 * with an hourly budget of its own per account (rate:profile:<acct>), never
 * the private-reply bucket. Only for ACTIVE channels; nothing is deleted.
 *
 *  - ok:       username / name / photo saved, profileStatus = "ok";
 *  - denied:   Meta refused (no consent, code 100/10/200/230): "denied",
 *              attempts + 1, not tried again on every event (profile-queue.ts);
 *  - rate limited by Meta or out of budget: nothing marked, try later;
 *  - token rejected: the channel is flagged NEEDS_RECONNECT (noteMetaError);
 *  - anything else: "error", attempts + 1.
 */
import { prisma } from "@/lib/db/client";
import { getUserProfile } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { isTokenRejected, noteMetaError } from "@/lib/channels/status";
import { reserveProfileSlot } from "@/lib/utils/rate-limiter";

export const META_RATE_LIMIT_RETRY_MS = 30 * 60_000;

export type ProfileOutcome =
  | "no_contact"
  | "has_username"
  | "channel_off"
  | "local"
  | "ok"
  | "denied"
  | "error"
  | "rate_limited"
  | "no_budget"
  | "token_rejected"
  | "no_token"
  /** localOnly (dry run): nothing local, the API would be called. */
  | "needs_api";

export type ProfileResult = { outcome: ProfileOutcome; retryInMs?: number; username?: string | null };

const DENIED_CODES = new Set([10, 100, 200, 230]);

/** Meta said no for this person (no conversation / consent), not a fault. */
export function isProfileDenied(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "PermissionError") return true;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" && DENIED_CODES.has(code);
}

function isMetaRateLimit(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "RateLimitError") return true;
  const code = (error as { code?: unknown }).code;
  return code === 4 || code === 17 || code === 32 || code === 368 || code === 613;
}

function cleanUsername(value: string | null | undefined): string | null {
  const v = value?.trim().replace(/^@/, "");
  return v ? v : null;
}

/**
 * A username we already saw for this person on this account, without calling
 * Meta: campaign logs (DmLog.commenterName) and moderated comments
 * (CommentModeration.commenterUsername).
 */
export async function findLocalUsername(contact: {
  instagramAccountId: string;
  igUserId: string;
}): Promise<string | null> {
  const log = await prisma.dmLog.findFirst({
    where: {
      instagramAccountId: contact.instagramAccountId,
      commenterId: contact.igUserId,
      commenterName: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { commenterName: true },
  });
  const fromLog = cleanUsername(log?.commenterName);
  if (fromLog) return fromLog;

  const moderated = await prisma.commentModeration.findFirst({
    where: {
      instagramAccountId: contact.instagramAccountId,
      commenterIgId: contact.igUserId,
      commenterUsername: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { commenterUsername: true },
  });
  return cleanUsername(moderated?.commenterUsername);
}

/**
 * Save usernames that already came in an API answer (Conversations API
 * participants, conversation messages' from.username). Only fills contacts
 * that have none; one query when nothing is missing. Never throws.
 */
export async function saveKnownUsernames(
  instagramAccountId: string,
  people: { igUserId: string | null | undefined; username: string | null | undefined }[]
): Promise<number> {
  try {
    const byId = new Map<string, string>();
    for (const p of people) {
      const username = cleanUsername(p.username);
      if (p.igUserId && username) byId.set(p.igUserId, username);
    }
    if (byId.size === 0) return 0;
    const missing = await prisma.contact.findMany({
      where: { instagramAccountId, igUserId: { in: [...byId.keys()] }, username: null },
      select: { id: true, igUserId: true },
    });
    let saved = 0;
    for (const c of missing) {
      const username = byId.get(c.igUserId);
      if (!username) continue;
      const { count } = await prisma.contact.updateMany({
        where: { id: c.id, username: null },
        data: { username, profileStatus: "ok", profileFetchedAt: new Date() },
      });
      saved += count;
    }
    return saved;
  } catch (error) {
    console.warn("[CRM] Could not save known usernames:", error instanceof Error ? error.message : error);
    return 0;
  }
}

/**
 * Look one contact up. `useBudget: false` skips the Redis budget (tests);
 * the worker and the backfill keep it on.
 */
export async function lookupContactProfile(
  contactId: string,
  options: { now?: Date; useBudget?: boolean; localOnly?: boolean } = {}
): Promise<ProfileResult> {
  const now = options.now ?? new Date();
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: {
      id: true,
      igUserId: true,
      username: true,
      name: true,
      profileAttempts: true,
      instagramAccountId: true,
      instagramAccount: { select: { id: true, instagramId: true, status: true, accessToken: true } },
    },
  });
  if (!contact) return { outcome: "no_contact" };
  if (contact.username) return { outcome: "has_username", username: contact.username };
  const account = contact.instagramAccount;
  if (!account || account.status !== "ACTIVE") return { outcome: "channel_off" };

  const local = await findLocalUsername(contact);
  if (local) {
    if (!options.localOnly) {
      await prisma.contact.updateMany({
        where: { id: contact.id, username: null },
        data: { username: local, profileStatus: "ok", profileFetchedAt: now },
      });
    }
    return { outcome: "local", username: local };
  }
  if (options.localOnly) return { outcome: "needs_api" };

  if (!account.accessToken) return { outcome: "no_token" };
  let token: string;
  try {
    token = decryptToken(account.accessToken);
  } catch {
    return { outcome: "no_token" };
  }

  if (options.useBudget !== false) {
    const slot = await reserveProfileSlot(account.instagramId);
    if (!slot.allowed) return { outcome: "no_budget", retryInMs: slot.retryInMs };
  }

  const attempts = (contact.profileAttempts ?? 0) + 1;
  try {
    const profile = await getUserProfile(token, contact.igUserId);
    const username = cleanUsername(profile.username);
    await prisma.contact.update({
      where: { id: contact.id },
      data: {
        ...(username ? { username } : {}),
        ...(profile.name && !contact.name ? { name: profile.name } : {}),
        ...(profile.profilePic ? { profilePicUrl: profile.profilePic } : {}),
        profileStatus: "ok",
        profileFetchedAt: now,
        profileAttempts: attempts,
      },
    });
    return { outcome: "ok", username };
  } catch (error) {
    if (isTokenRejected(error)) {
      await noteMetaError({ id: account.id }, error);
      return { outcome: "token_rejected" };
    }
    if (isMetaRateLimit(error)) {
      return { outcome: "rate_limited", retryInMs: META_RATE_LIMIT_RETRY_MS };
    }
    const denied = isProfileDenied(error);
    await prisma.contact.update({
      where: { id: contact.id },
      data: {
        profileStatus: denied ? "denied" : "error",
        profileFetchedAt: now,
        profileAttempts: attempts,
      },
    });
    if (!denied) {
      console.warn(
        `[CRM] Profile lookup failed for contact ${contact.id}:`,
        error instanceof Error ? error.message : error
      );
    }
    return { outcome: denied ? "denied" : "error" };
  }
}
