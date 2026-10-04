/**
 * A/B of a campaign as the routes see it: the variants, their numbers and the
 * "declare winner" step. Nothing here runs on the DM path (the worker only
 * reads the variants through lib/ab/variant.ts, and only with the test on).
 */
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { ctr } from "@/lib/ab/keys";

export const REPLY_WINDOW_HOURS = 72;

export const AB_AUTOMATION_SELECT = {
  id: true,
  workspaceId: true,
  name: true,
  abTestEnabled: true,
  abWinnerKey: true,
  openingDmEnabled: true,
  openingDmMessage: true,
  dmMessage: true,
} as const;

export async function findAbAutomation(id: string, workspaceId: string) {
  return prisma.automation.findFirst({ where: { id, workspaceId }, select: AB_AUTOMATION_SELECT });
}

export const VARIANT_SELECT = {
  id: true,
  key: true,
  weight: true,
  openingDmMessage: true,
  dmMessage: true,
  isActive: true,
  winnerAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type CampaignVariantStats = {
  key: string;
  /** People who got the campaign DM in this variant. */
  sent: number;
  /** People who clicked the link after it. */
  clicked: number;
  /** People who wrote back within REPLY_WINDOW_HOURS. */
  replied: number;
  ctr: number;
};

type Row = { key: string; sent: number | bigint; clicked: number | bigint; replied: number | bigint };

/** Per variant, counted in people (an opening DM + its reveal is one person). */
export async function campaignVariantStats(automationId: string): Promise<CampaignVariantStats[]> {
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT d."variantKey" AS "key",
      count(DISTINCT d."commenterId")::int AS "sent",
      count(DISTINCT lc."contactIgUserId")::int AS "clicked",
      count(DISTINCT CASE WHEN EXISTS (
        SELECT 1 FROM "Contact" c JOIN "ContactEvent" e ON e."contactId" = c."id"
        WHERE c."instagramAccountId" = d."instagramAccountId" AND c."igUserId" = d."commenterId"
          AND e."type" = 'DM_IN' AND e."occurredAt" > d."dmSentAt"
          AND e."occurredAt" <= d."dmSentAt" + make_interval(hours => ${REPLY_WINDOW_HOURS}::int)
      ) THEN d."commenterId" END)::int AS "replied"
    FROM "DmLog" d
    LEFT JOIN "LinkClick" lc ON lc."dmLogId" = d."id"
    WHERE d."automationId" = ${automationId} AND d."status" = 'SENT' AND d."variantKey" IS NOT NULL
    GROUP BY d."variantKey"
    ORDER BY d."variantKey"`);
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const sent = Number(r.sent ?? 0);
    const clicked = Number(r.clicked ?? 0);
    return { key: r.key, sent, clicked, replied: Number(r.replied ?? 0), ctr: ctr(clicked, sent) };
  });
}

export type VariantInput = {
  key: string;
  weight: number;
  openingDmMessage?: string | null;
  dmMessage?: string | null;
};

/** Replace the variant set: the listed keys are active, any other is retired. */
export async function saveCampaignVariants(
  automation: { id: string; workspaceId: string },
  variants: VariantInput[],
  userId: string
) {
  const keys = variants.map((v) => v.key);
  await prisma.$transaction(async (tx) => {
    for (const v of variants) {
      const data = {
        weight: v.weight,
        openingDmMessage: v.openingDmMessage?.trim() || null,
        dmMessage: v.dmMessage?.trim() || null,
        isActive: true,
        winnerAt: null,
      };
      await tx.campaignVariant.upsert({
        where: { automationId_key: { automationId: automation.id, key: v.key } },
        create: { workspaceId: automation.workspaceId, automationId: automation.id, key: v.key, createdBy: userId, ...data },
        update: data,
      });
    }
    await tx.campaignVariant.updateMany({
      where: { automationId: automation.id, key: { notIn: keys } },
      data: { isActive: false },
    });
  });
}

export async function activeVariants(automationId: string) {
  const rows = await prisma.campaignVariant.findMany({
    where: { automationId, isActive: true },
    select: VARIANT_SELECT,
    orderBy: { key: "asc" },
  });
  return Array.isArray(rows) ? rows : [];
}

/**
 * The winner's texts become the campaign's (only the ones it set), the test
 * goes off and the variants stay as history. From then on the campaign runs
 * without A/B, exactly like a campaign that never had one.
 */
export async function declareCampaignWinner(
  automation: { id: string; openingDmMessage: string | null; dmMessage: string },
  winner: { id: string; key: string; openingDmMessage: string | null; dmMessage: string | null },
  now: Date = new Date()
) {
  await prisma.$transaction(async (tx) => {
    await tx.automation.update({
      where: { id: automation.id },
      data: {
        abTestEnabled: false,
        abWinnerKey: winner.key,
        ...(winner.dmMessage?.trim() ? { dmMessage: winner.dmMessage } : {}),
        ...(winner.openingDmMessage?.trim() ? { openingDmMessage: winner.openingDmMessage } : {}),
      },
    });
    await tx.campaignVariant.update({ where: { id: winner.id }, data: { winnerAt: now } });
    await tx.campaignVariant.updateMany({
      where: { automationId: automation.id, id: { not: winner.id } },
      data: { isActive: false },
    });
  });
}
