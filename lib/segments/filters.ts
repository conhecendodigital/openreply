/**
 * Etapa 5: segments = combinable filters over the CRM (Contact + tags +
 * timeline + DmLog + clicks), compiled to ONE parameterised SQL WHERE.
 *
 * Safety:
 * - every value goes in as a bind parameter (Prisma.sql); the only literals
 *   in the SQL text are ours (column names, enum values);
 * - the workspace is always the first condition, so a filter can never reach
 *   another workspace's contacts (an automation id from elsewhere just
 *   matches nothing).
 *
 * "Who receives a broadcast" is decided by eligibility, on top of the filters
 * and at the moment of sending: the 24 h window open (Instagram's rule for
 * promotional messages; same 30 min margin as isWindowOpen), not opted out,
 * no human takeover, and (by default) not in the middle of a flow/sequence.
 */
import { Prisma } from "@/app/generated/prisma/client";
import type { SegmentFilters } from "@/lib/segments/schema";
import { prisma } from "@/lib/db/client";
import { DEFAULT_WINDOW_MARGIN_MIN, WINDOW_MS } from "@/lib/messaging/window";

export {
  segmentFiltersSchema,
  SEGMENT_SOURCES,
  EMPTY_FILTERS,
  parseFilters,
  describeFilters,
  type SegmentFilters,
  type SegmentSource,
} from "@/lib/segments/schema";

export type SegmentScope = {
  workspaceId: string;
  /** Internal InstagramAccount.id; null = every account of the workspace. */
  instagramAccountId?: string | null;
};

const and = (parts: Prisma.Sql[]) => (parts.length > 0 ? Prisma.join(parts, " AND ") : Prisma.sql`TRUE`);

/** WHERE for the filters (alias c = "Contact"). */
export function compileSegmentWhere(scope: SegmentScope, filters: SegmentFilters, now: Date = new Date()): Prisma.Sql {
  const ws = scope.workspaceId;
  const parts: Prisma.Sql[] = [Prisma.sql`c."workspaceId" = ${ws}`];
  if (scope.instagramAccountId) parts.push(Prisma.sql`c."instagramAccountId" = ${scope.instagramAccountId}`);

  for (const name of filters.hasTags) {
    parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "ContactTag" t WHERE t."contactId" = c."id" AND t."name" = ${name})`);
  }
  if (filters.anyTags.length > 0) {
    parts.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "ContactTag" t WHERE t."contactId" = c."id" AND t."name" IN (${Prisma.join(filters.anyTags)}))`
    );
  }
  if (filters.notTags.length > 0) {
    parts.push(
      Prisma.sql`NOT EXISTS (SELECT 1 FROM "ContactTag" t WHERE t."contactId" = c."id" AND t."name" IN (${Prisma.join(filters.notTags)}))`
    );
  }
  if (filters.commentedCampaignIds.length > 0) {
    // Real comment ids are numeric; reveal:/dm:/mention:/ref: keys are not comments.
    parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "DmLog" d WHERE d."workspaceId" = ${ws}
      AND d."instagramAccountId" = c."instagramAccountId" AND d."commenterId" = c."igUserId"
      AND d."automationId" IN (${Prisma.join(filters.commentedCampaignIds)}) AND strpos(d."commentId", ':') = 0)`);
  }
  if (filters.receivedCampaignIds.length > 0) {
    parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "DmLog" d WHERE d."workspaceId" = ${ws}
      AND d."instagramAccountId" = c."instagramAccountId" AND d."commenterId" = c."igUserId"
      AND d."automationId" IN (${Prisma.join(filters.receivedCampaignIds)}) AND d."status" = 'SENT')`);
  }
  if (filters.clicked === "yes") parts.push(Prisma.sql`c."clicksCount" > 0`);
  if (filters.clicked === "none") parts.push(Prisma.sql`c."clicksCount" = 0`);
  if (filters.clickedCampaignIds.length > 0) {
    parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "LinkClick" lc WHERE lc."workspaceId" = ${ws}
      AND lc."instagramAccountId" = c."instagramAccountId" AND lc."contactIgUserId" = c."igUserId"
      AND lc."automationId" IN (${Prisma.join(filters.clickedCampaignIds)}))`);
  }
  if (filters.follows === "yes") parts.push(Prisma.sql`c."followsBusiness" = TRUE`);
  if (filters.follows === "no") parts.push(Prisma.sql`c."followsBusiness" = FALSE`);
  if (filters.follows === "unknown") parts.push(Prisma.sql`c."followsBusiness" IS NULL`);
  if (filters.lastInteractionDays) {
    const since = new Date(now.getTime() - filters.lastInteractionDays * 86_400_000);
    parts.push(Prisma.sql`c."lastSeenAt" >= ${since}`);
  }
  if (filters.sources.length > 0) {
    const any: Prisma.Sql[] = [];
    if (filters.sources.includes("comment")) any.push(Prisma.sql`c."commentsCount" > 0`);
    if (filters.sources.includes("dm")) any.push(Prisma.sql`c."dmsInCount" > 0`);
    if (filters.sources.includes("story")) {
      any.push(Prisma.sql`EXISTS (SELECT 1 FROM "ContactEvent" e WHERE e."contactId" = c."id" AND e."type" = 'DM_IN' AND e."meta"->>'storyReply' = 'true')`);
    }
    if (filters.sources.includes("link")) {
      any.push(Prisma.sql`(EXISTS (SELECT 1 FROM "ContactEvent" e WHERE e."contactId" = c."id" AND e."type" = 'REFERRAL')
        OR EXISTS (SELECT 1 FROM "ContactTag" t WHERE t."contactId" = c."id" AND t."name" LIKE 'veio:%'))`);
    }
    parts.push(Prisma.sql`(${Prisma.join(any, " OR ")})`);
  }
  return and(parts);
}

/** Window open with the same margin as isWindowOpen (lib/messaging/window.ts). */
export function windowOpenSince(now: Date = new Date()): Date {
  return new Date(now.getTime() - WINDOW_MS + DEFAULT_WINDOW_MARGIN_MIN * 60_000);
}

export function eligibilitySql(now: Date, options: { skipBusy?: boolean } = {}) {
  const windowOpen = Prisma.sql`(c."lastInboundAt" IS NOT NULL AND c."lastInboundAt" > ${windowOpenSince(now)})`;
  const optedOut = Prisma.sql`(c."broadcastOptOutAt" IS NOT NULL)`;
  const takeover = Prisma.sql`(c."humanTakeover" = TRUE AND (c."humanTakeoverUntil" IS NULL OR c."humanTakeoverUntil" > ${now}))`;
  // A run waiting for the person's reply is mid-flow too: their answer to the
  // broadcast would be taken as the flow's reply. Only while it still waits
  // (WAITING_TAP has no end, so it does not count).
  const busy = Prisma.sql`(EXISTS (SELECT 1 FROM "FlowRun" fr WHERE fr."contactId" = c."id"
      AND (fr."status" IN ('ACTIVE', 'WAITING_DELAY') OR (fr."status" = 'WAITING_REPLY' AND fr."waitingUntil" > ${now})))
    OR EXISTS (SELECT 1 FROM "SequenceEnrollment" se WHERE se."contactId" = c."id" AND se."status" = 'ACTIVE'))`;
  const eligible =
    options.skipBusy === false
      ? Prisma.sql`(${windowOpen} AND NOT ${optedOut} AND NOT ${takeover})`
      : Prisma.sql`(${windowOpen} AND NOT ${optedOut} AND NOT ${takeover} AND NOT ${busy})`;
  return { windowOpen, optedOut, takeover, busy, eligible };
}

export type SegmentCount = {
  /** People matching the filters. */
  total: number;
  /** Of those, with the 24 h conversation open right now. */
  windowOpen: number;
  /** Wrote PARAR / SAIR / STOP. */
  optedOut: number;
  /** A human took over. */
  takeover: number;
  /** In the middle of a flow or sequence. */
  busy: number;
  /** Who would receive a broadcast right now (only these). */
  eligible: number;
};

type CountRow = Partial<Record<keyof SegmentCount, number | bigint | null>>;

const num = (v: number | bigint | null | undefined) => Number(v ?? 0);

/** Live count. Never lists people (cheap enough for every keystroke). */
export async function countSegment(
  scope: SegmentScope,
  filters: SegmentFilters,
  options: { now?: Date; skipBusy?: boolean } = {}
): Promise<SegmentCount> {
  const now = options.now ?? new Date();
  const where = compileSegmentWhere(scope, filters, now);
  const e = eligibilitySql(now, { skipBusy: options.skipBusy });
  const rows = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT count(*)::int AS "total",
      count(*) FILTER (WHERE ${e.windowOpen})::int AS "windowOpen",
      count(*) FILTER (WHERE ${e.optedOut})::int AS "optedOut",
      count(*) FILTER (WHERE ${e.takeover})::int AS "takeover",
      count(*) FILTER (WHERE ${e.busy})::int AS "busy",
      count(*) FILTER (WHERE ${e.eligible})::int AS "eligible"
    FROM "Contact" c WHERE ${where}`);
  const row = (Array.isArray(rows) ? rows[0] : null) ?? {};
  return {
    total: num(row.total),
    windowOpen: num(row.windowOpen),
    optedOut: num(row.optedOut),
    takeover: num(row.takeover),
    busy: num(row.busy),
    eligible: num(row.eligible),
  };
}

export const MAX_BROADCAST_RECIPIENTS = 5_000;

/** The people who may receive a broadcast NOW (one account), freshest window first. */
export async function eligibleContacts(
  scope: SegmentScope & { instagramAccountId: string },
  filters: SegmentFilters,
  options: { now?: Date; skipBusy?: boolean; limit?: number } = {}
): Promise<{ id: string; igUserId: string }[]> {
  const now = options.now ?? new Date();
  const where = compileSegmentWhere(scope, filters, now);
  const e = eligibilitySql(now, { skipBusy: options.skipBusy });
  const limit = Math.min(options.limit ?? MAX_BROADCAST_RECIPIENTS, MAX_BROADCAST_RECIPIENTS);
  const rows = await prisma.$queryRaw<{ id: string; igUserId: string }[]>(Prisma.sql`
    SELECT c."id", c."igUserId" FROM "Contact" c
    WHERE ${where} AND ${e.eligible}
    ORDER BY c."lastInboundAt" DESC
    LIMIT ${limit}`);
  return Array.isArray(rows) ? rows : [];
}
