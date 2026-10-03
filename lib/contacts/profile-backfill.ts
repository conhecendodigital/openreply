/**
 * Fill the usernames of contacts that have none (scripts/backfill-usernames.ts).
 * Idempotent: only contacts with username NULL, and by default only the ones
 * never tried (profileStatus NULL). Small batches with a pause between Meta
 * calls, inside the same hourly budget the worker uses. Only ACTIVE channels.
 * Local sources first (campaign logs, moderation), then the User Profile API.
 */
import { prisma } from "@/lib/db/client";
import { lookupContactProfile, type ProfileOutcome } from "@/lib/contacts/profile";

export type UsernameBackfillOptions = {
  dryRun?: boolean;
  /** Max contacts looked at, across accounts. */
  limit?: number;
  workspaceId?: string;
  /** Also try again the ones Meta denied / that failed before. */
  retryDenied?: boolean;
  batchSize?: number;
  /** Pause after each Meta call. */
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  now?: () => Date;
};

export type UsernameBackfillStats = {
  accounts: number;
  looked: number;
  apiCalls: number;
  stoppedEarly: string | null;
} & Partial<Record<ProfileOutcome, number>>;

const API_OUTCOMES: ReadonlySet<ProfileOutcome> = new Set([
  "ok",
  "denied",
  "error",
  "rate_limited",
  "token_rejected",
]);

export async function backfillUsernames(options: UsernameBackfillOptions = {}): Promise<UsernameBackfillStats> {
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 10, 50));
  const pauseMs = options.pauseMs ?? 1_500;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = options.log ?? (() => undefined);
  const limit = options.limit && options.limit > 0 ? options.limit : Infinity;

  const stats: UsernameBackfillStats = { accounts: 0, looked: 0, apiCalls: 0, stoppedEarly: null };
  const bump = (o: ProfileOutcome) => {
    stats[o] = (stats[o] ?? 0) + 1;
  };

  const accounts = await prisma.instagramAccount.findMany({
    // A channel that is off is never called (and nothing is touched there).
    where: { status: "ACTIVE", ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}) },
    select: { id: true, username: true },
    orderBy: { connectedAt: "asc" },
  });

  outer: for (const account of accounts) {
    stats.accounts += 1;
    let cursor: string | undefined;
    for (;;) {
      if (stats.looked >= limit) break outer;
      const take = Math.min(batchSize, limit - stats.looked);
      const contacts = await prisma.contact.findMany({
        where: {
          instagramAccountId: account.id,
          username: null,
          ...(options.retryDenied
            ? { OR: [{ profileStatus: null }, { profileStatus: { in: ["denied", "error"] } }] }
            : { profileStatus: null }),
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: "asc" },
        take,
        select: { id: true, igUserId: true },
      });
      if (contacts.length === 0) break;
      cursor = contacts[contacts.length - 1].id;

      for (const c of contacts) {
        stats.looked += 1;
        const result = await lookupContactProfile(c.id, {
          localOnly: Boolean(options.dryRun),
          now: options.now?.(),
        });
        bump(result.outcome);
        if (result.outcome === "local" || result.outcome === "ok") {
          log(`  @${account.username}: ${c.igUserId} -> @${result.username ?? "(sem @)"} (${result.outcome})`);
        }
        if (API_OUTCOMES.has(result.outcome)) {
          stats.apiCalls += 1;
          await sleep(pauseMs);
        }
        if (result.outcome === "no_budget" || result.outcome === "rate_limited") {
          stats.stoppedEarly = `limite de consultas (@${account.username}); rode de novo daqui a 1 hora`;
          break outer;
        }
        if (result.outcome === "token_rejected" || result.outcome === "channel_off" || result.outcome === "no_token") {
          log(`  @${account.username}: canal sem token válido, pulando a conta`);
          continue outer;
        }
      }
      if (contacts.length < take) break;
    }
  }
  return stats;
}
