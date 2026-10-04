/**
 * Etapa 5: the workspace report for a period (7 / 30 / 90 days), read only.
 *
 * - DMs sent by origin come from the OutboundMessage ledger (failed sends,
 *   error set, are left out). The ledger exists since 2026-10-04; before that
 *   only the campaigns' DmLog has history (shown apart, campaignsFromDmLog).
 * - Days are São Paulo days (the owner's), not the server's.
 * - CTR = clicks / DMs sent (capped at 100%, like calculateCtr).
 */
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { ctr } from "@/lib/ab/keys";
import type { CsvCell } from "@/lib/utils/csv-write";

export const REPORT_PERIODS = [7, 30, 90] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];
export const REPORT_TIMEZONE = "America/Sao_Paulo";
export const LEDGER_SINCE = "2026-10-04";

export function parsePeriod(value: string | null | undefined): ReportPeriod {
  const n = Number.parseInt(value ?? "", 10);
  return (REPORT_PERIODS as readonly number[]).includes(n) ? (n as ReportPeriod) : 30;
}

/** Origins of the ledger grouped the way the owner reads them. */
export const ORIGIN_GROUPS: Record<string, "campaign" | "flow" | "broadcast" | "inbox" | "draft"> = {
  automation: "campaign",
  private_reply: "campaign",
  followup: "campaign",
  sequence: "campaign",
  flow: "flow",
  broadcast: "broadcast",
  inbox: "inbox",
  draft: "draft",
};

/** YYYY-MM-DD of an instant in São Paulo. */
export function localDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Every São Paulo day from `since` to `now`, oldest first. */
export function dayKeys(since: Date, now: Date): string[] {
  const out: string[] = [];
  const last = localDay(now);
  for (let t = since.getTime(); ; t += 86_400_000) {
    const key = localDay(new Date(t));
    if (out[out.length - 1] !== key) out.push(key);
    if (key >= last || out.length > 400) break;
  }
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

const n = (v: unknown) => Number(v ?? 0);
const countOf = (row: { _count?: unknown }) => {
  const c = row._count as number | { _all?: number } | undefined;
  return typeof c === "number" ? c : n(c?._all);
};

export type PeriodReport = Awaited<ReturnType<typeof buildPeriodReport>>;

export async function buildPeriodReport(workspaceId: string, days: ReportPeriod, now: Date = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const ws = workspaceId;

  const [
    origins,
    campaignSent,
    campaignClicks,
    flowSent,
    flowClicks,
    broadcastSent,
    broadcastClicks,
    newContacts,
    tags,
    posts,
    moderation,
    funnelRows,
    dmLogSent,
  ] = await Promise.all([
    prisma.outboundMessage.groupBy({
      by: ["origin"],
      where: { workspaceId: ws, createdAt: { gte: since }, error: null },
      _count: { _all: true },
    }),
    prisma.dmLog.groupBy({
      by: ["automationId"],
      where: { workspaceId: ws, status: "SENT", dmSentAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.linkClick.groupBy({
      by: ["automationId"],
      where: { workspaceId: ws, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.$queryRaw<{ flowId: string; sent: number }[]>(Prisma.sql`
      SELECT s."flowId", count(*)::int AS "sent" FROM "FlowStep" s
      JOIN "Flow" f ON f."id" = s."flowId"
      WHERE f."workspaceId" = ${ws} AND s."outcome" = 'sent' AND s."occurredAt" >= ${since}
      GROUP BY s."flowId"`),
    prisma.$queryRaw<{ flowId: string; clicks: number }[]>(Prisma.sql`
      SELECT k."flowId", count(*)::int AS "clicks" FROM "FlowLinkClick" k
      JOIN "Flow" f ON f."id" = k."flowId"
      WHERE f."workspaceId" = ${ws} AND k."createdAt" >= ${since}
      GROUP BY k."flowId"`),
    prisma.broadcastRecipient.groupBy({
      by: ["broadcastId"],
      where: { workspaceId: ws, status: "SENT", sentAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.$queryRaw<{ broadcastId: string; clicks: number }[]>(Prisma.sql`
      SELECT k."broadcastId", count(*)::int AS "clicks" FROM "BroadcastLinkClick" k
      JOIN "Broadcast" b ON b."id" = k."broadcastId"
      WHERE b."workspaceId" = ${ws} AND k."createdAt" >= ${since}
      GROUP BY k."broadcastId"`),
    prisma.$queryRaw<{ day: string; count: number }[]>(Prisma.sql`
      SELECT to_char(date_trunc('day', (c."firstSeenAt" AT TIME ZONE 'UTC') AT TIME ZONE ${REPORT_TIMEZONE}), 'YYYY-MM-DD') AS "day",
        count(*)::int AS "count"
      FROM "Contact" c
      WHERE c."workspaceId" = ${ws} AND c."firstSeenAt" >= ${since}
      GROUP BY 1 ORDER BY 1`),
    prisma.$queryRaw<{ tag: string; added: number; removed: number; net: number }[]>(Prisma.sql`
      SELECT e."text" AS "tag",
        count(*) FILTER (WHERE e."type" = 'TAG_ADDED')::int AS "added",
        count(*) FILTER (WHERE e."type" = 'TAG_REMOVED')::int AS "removed",
        (count(*) FILTER (WHERE e."type" = 'TAG_ADDED') - count(*) FILTER (WHERE e."type" = 'TAG_REMOVED'))::int AS "net"
      FROM "ContactEvent" e
      WHERE e."workspaceId" = ${ws} AND e."type" IN ('TAG_ADDED', 'TAG_REMOVED')
        AND e."occurredAt" >= ${since} AND e."text" IS NOT NULL
      GROUP BY e."text"
      ORDER BY "net" DESC, "added" DESC
      LIMIT 15`),
    // A campaign DM answering a comment: its post is on the COMMENT event.
    prisma.$queryRaw<{ mediaId: string; dms: number; people: number }[]>(Prisma.sql`
      SELECT e."mediaId", count(DISTINCT d."id")::int AS "dms", count(DISTINCT d."commenterId")::int AS "people"
      FROM "DmLog" d
      JOIN "ContactEvent" e ON e."workspaceId" = d."workspaceId" AND e."type" = 'COMMENT' AND e."refId" = d."commentId"
      WHERE d."workspaceId" = ${ws} AND d."status" = 'SENT' AND d."dmSentAt" >= ${since}
        AND e."occurredAt" >= ${new Date(since.getTime() - 7 * 86_400_000)} AND e."mediaId" IS NOT NULL
      GROUP BY e."mediaId"
      ORDER BY "dms" DESC
      LIMIT 10`),
    prisma.commentModeration.groupBy({
      by: ["action"],
      where: { workspaceId: ws, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.$queryRaw<{ commented: number; received: number; clicked: number }[]>(Prisma.sql`
      WITH com AS (
        SELECT DISTINCT e."contactId" FROM "ContactEvent" e
        WHERE e."workspaceId" = ${ws} AND e."type" = 'COMMENT' AND e."occurredAt" >= ${since}
      ), rec AS (
        SELECT DISTINCT e."contactId" FROM "ContactEvent" e JOIN com ON com."contactId" = e."contactId"
        WHERE e."workspaceId" = ${ws} AND e."type" = 'CAMPAIGN_SENT' AND e."occurredAt" >= ${since}
      ), cli AS (
        SELECT DISTINCT e."contactId" FROM "ContactEvent" e JOIN rec ON rec."contactId" = e."contactId"
        WHERE e."workspaceId" = ${ws} AND e."type" = 'CLICK' AND e."occurredAt" >= ${since}
      )
      SELECT (SELECT count(*) FROM com)::int AS "commented",
        (SELECT count(*) FROM rec)::int AS "received",
        (SELECT count(*) FROM cli)::int AS "clicked"`),
    prisma.dmLog.count({ where: { workspaceId: ws, status: "SENT", dmSentAt: { gte: since } } }),
  ]);

  // DMs by origin.
  const byOrigin: Record<string, number> = {};
  const groups = { campaign: 0, flow: 0, broadcast: 0, inbox: 0, draft: 0 };
  for (const row of Array.isArray(origins) ? origins : []) {
    const c = countOf(row);
    byOrigin[row.origin] = c;
    const g = ORIGIN_GROUPS[row.origin];
    if (g) groups[g] += c;
  }
  const dmsTotal = Object.values(byOrigin).reduce((s, v) => s + v, 0);

  // Names.
  const campaignIds = [...new Set([...(campaignSent ?? []), ...(campaignClicks ?? [])].map((r) => r.automationId))];
  const flowIds = [...new Set([...(flowSent ?? []), ...(flowClicks ?? [])].map((r) => r.flowId))];
  const broadcastIds = [...new Set([...(broadcastSent ?? []), ...(broadcastClicks ?? [])].map((r) => r.broadcastId))];
  const [automations, flows, broadcasts] = await Promise.all([
    campaignIds.length
      ? prisma.automation.findMany({ where: { id: { in: campaignIds }, workspaceId: ws }, select: { id: true, name: true } })
      : [],
    flowIds.length ? prisma.flow.findMany({ where: { id: { in: flowIds }, workspaceId: ws }, select: { id: true, name: true } }) : [],
    broadcastIds.length
      ? prisma.broadcast.findMany({ where: { id: { in: broadcastIds }, workspaceId: ws }, select: { id: true, name: true } })
      : [],
  ]);
  const nameOf = (list: { id: string; name: string }[] | null | undefined) =>
    new Map((Array.isArray(list) ? list : []).map((x) => [x.id, x.name]));

  const ctrRows = (
    sent: Map<string, number>,
    clicks: Map<string, number>,
    names: Map<string, string>
  ) =>
    [...new Set([...sent.keys(), ...clicks.keys()])]
      .map((id) => {
        const s = sent.get(id) ?? 0;
        const c = clicks.get(id) ?? 0;
        return { id, name: names.get(id) ?? "(apagado)", sent: s, clicks: c, ctr: ctr(c, s) };
      })
      .sort((a, b) => b.sent - a.sent || b.clicks - a.clicks)
      .slice(0, 25);

  const campaigns = ctrRows(
    new Map((campaignSent ?? []).map((r) => [r.automationId, countOf(r)])),
    new Map((campaignClicks ?? []).map((r) => [r.automationId, countOf(r)])),
    nameOf(automations)
  );
  const flowRows = ctrRows(
    new Map((Array.isArray(flowSent) ? flowSent : []).map((r) => [r.flowId, n(r.sent)])),
    new Map((Array.isArray(flowClicks) ? flowClicks : []).map((r) => [r.flowId, n(r.clicks)])),
    nameOf(flows)
  );
  const broadcastRows = ctrRows(
    new Map((broadcastSent ?? []).map((r) => [r.broadcastId, countOf(r)])),
    new Map((Array.isArray(broadcastClicks) ? broadcastClicks : []).map((r) => [r.broadcastId, n(r.clicks)])),
    nameOf(broadcasts)
  );

  // New contacts per São Paulo day, every day present (0 when none).
  const perDay = new Map((Array.isArray(newContacts) ? newContacts : []).map((r) => [r.day, n(r.count)]));
  const newContactsByDay = dayKeys(since, now).map((day) => ({ day, count: perDay.get(day) ?? 0 }));

  const moderationByAction: Record<string, number> = {};
  for (const row of Array.isArray(moderation) ? moderation : []) moderationByAction[row.action] = countOf(row);

  const f = (Array.isArray(funnelRows) ? funnelRows[0] : null) ?? { commented: 0, received: 0, clicked: 0 };
  const funnel = { commented: n(f.commented), received: n(f.received), clicked: n(f.clicked) };

  return {
    days,
    since: since.toISOString(),
    until: now.toISOString(),
    timezone: REPORT_TIMEZONE,
    dms: { total: dmsTotal, groups, byOrigin, ledgerSince: LEDGER_SINCE, campaignsFromDmLog: n(dmLogSent) },
    ctr: { campaigns, flows: flowRows, broadcasts: broadcastRows },
    newContacts: { total: newContactsByDay.reduce((s, d) => s + d.count, 0), byDay: newContactsByDay },
    topTags: (Array.isArray(tags) ? tags : []).map((t) => ({ tag: t.tag, added: n(t.added), removed: n(t.removed), net: n(t.net) })),
    topPosts: (Array.isArray(posts) ? posts : []).map((p) => ({ mediaId: p.mediaId, dms: n(p.dms), people: n(p.people) })),
    moderation: {
      hidden: moderationByAction.HIDDEN ?? 0,
      wouldHide: moderationByAction.WOULD_HIDE ?? 0,
      restored: moderationByAction.RESTORED ?? 0,
      failed: moderationByAction.FAILED ?? 0,
      byAction: moderationByAction,
    },
    funnel: {
      ...funnel,
      receivedRate: funnel.commented > 0 ? Number(((funnel.received / funnel.commented) * 100).toFixed(1)) : 0,
      clickRate: funnel.received > 0 ? Number(((funnel.clicked / funnel.received) * 100).toFixed(1)) : 0,
    },
  };
}

export const REPORT_SECTIONS = ["dms", "campaigns", "flows", "broadcasts", "contacts", "tags", "posts", "moderation", "funnel"] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

/** The report as CSV rows: section, item, metric, value (one long table). */
export function reportCsvRows(report: PeriodReport, section: ReportSection | "all" = "all"): CsvCell[][] {
  const rows: CsvCell[][] = [["secao", "item", "metrica", "valor"]];
  const want = (s: ReportSection) => section === "all" || section === s;
  if (want("dms")) {
    for (const [g, v] of Object.entries(report.dms.groups)) rows.push(["dms_por_origem", g, "enviadas", v]);
    rows.push(["dms_por_origem", "total", "enviadas", report.dms.total]);
  }
  const ctrSection = (name: string, list: { name: string; sent: number; clicks: number; ctr: number }[]) => {
    for (const r of list) {
      rows.push([name, r.name, "enviadas", r.sent]);
      rows.push([name, r.name, "cliques", r.clicks]);
      rows.push([name, r.name, "ctr_%", r.ctr]);
    }
  };
  if (want("campaigns")) ctrSection("campanhas", report.ctr.campaigns);
  if (want("flows")) ctrSection("fluxos", report.ctr.flows);
  if (want("broadcasts")) ctrSection("disparos", report.ctr.broadcasts);
  if (want("contacts")) for (const d of report.newContacts.byDay) rows.push(["novos_contatos", d.day, "contatos", d.count]);
  if (want("tags")) {
    for (const t of report.topTags) {
      rows.push(["etiquetas", t.tag, "adicionadas", t.added]);
      rows.push(["etiquetas", t.tag, "removidas", t.removed]);
      rows.push(["etiquetas", t.tag, "saldo", t.net]);
    }
  }
  if (want("posts")) {
    for (const p of report.topPosts) {
      rows.push(["posts", p.mediaId, "dms", p.dms]);
      rows.push(["posts", p.mediaId, "pessoas", p.people]);
    }
  }
  if (want("moderation")) {
    for (const [a, v] of Object.entries(report.moderation.byAction)) rows.push(["moderacao", a, "comentarios", v]);
  }
  if (want("funnel")) {
    rows.push(["funil", "comentou", "pessoas", report.funnel.commented]);
    rows.push(["funil", "recebeu", "pessoas", report.funnel.received]);
    rows.push(["funil", "clicou", "pessoas", report.funnel.clicked]);
  }
  return rows;
}
