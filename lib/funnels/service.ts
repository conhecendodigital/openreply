/**
 * Etapa 6: funnels in the database (server-only). Create (always DRAFT, free
 * slug), duplicate, MCP patches, publish (draft frozen into published),
 * unpublish, results and leads.
 */
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import type {
  FunnelBlock,
  FunnelDefinition,
  FunnelLeadRow,
  FunnelLeadsPage,
  FunnelResults,
  FunnelValidation,
} from "@/lib/funnels/types";
import { definitionOrNull, emptyFunnelDefinition, funnelDefinitionSchema } from "@/lib/funnels/schema";
import { validateFunnel } from "@/lib/funnels/validate";
import { getFunnelTemplate } from "@/lib/funnels/templates";
import { isValidSlug, slugCandidate, slugify } from "@/lib/funnels/slug";
import { EMPTY_STATS, FUNNEL_SELECT, type FunnelRow, type FunnelStats } from "@/lib/funnels/api";
import type { ReportPeriod } from "@/lib/reports/period";
import type { CsvCell } from "@/lib/utils/csv-write";

export class FunnelError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

const json = (def: FunnelDefinition) => def as unknown as Prisma.InputJsonValue;
const isUniqueError = (error: unknown) => (error as { code?: string } | null)?.code === "P2002";
const MAX_SLUG_TRIES = 50;

async function slugTaken(slug: string, exceptId?: string): Promise<boolean> {
  const row = await prisma.funnel.findUnique({ where: { slug }, select: { id: true } });
  return Boolean(row && row.id !== exceptId);
}

/** First free slug: base, base-2, base-3... */
export async function freeSlug(base: string): Promise<string> {
  for (let n = 1; n <= MAX_SLUG_TRIES; n++) {
    const candidate = slugCandidate(base, n);
    if (!(await slugTaken(candidate))) return candidate;
  }
  return slugCandidate(base, Date.now() % 100_000);
}

/** Checked slug for a PATCH: invalid = 400, taken by another funnel = 409. */
export async function assertSlugAvailable(slug: string, funnelId: string): Promise<void> {
  if (!isValidSlug(slug)) throw new FunnelError("invalid_slug", 400, "Invalid address: use a-z, 0-9 and - (3 to 60)");
  if (await slugTaken(slug, funnelId)) throw new FunnelError("slug_taken", 409, "This address is already in use");
}

async function insertWithFreeSlug(base: string, data: Omit<Prisma.FunnelUncheckedCreateInput, "slug">): Promise<FunnelRow> {
  let slug = await freeSlug(base);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.funnel.create({ data: { ...data, slug }, select: FUNNEL_SELECT });
    } catch (error) {
      if (!isUniqueError(error)) throw error;
      slug = await freeSlug(base);
    }
  }
  throw new FunnelError("slug_taken", 409, "This address is already in use");
}

/** A new funnel: always DRAFT, never published (API keys too). */
export async function createFunnel(input: {
  workspaceId: string;
  userId: string | null;
  name: string;
  slug?: string | null;
  templateId?: string | null;
  definition?: FunnelDefinition | null;
}): Promise<FunnelRow> {
  let definition = input.definition ?? null;
  if (input.templateId) {
    const template = getFunnelTemplate(input.templateId);
    if (!template) throw new FunnelError("invalid_template", 400, "Template not found");
    definition ??= template.build();
  }
  definition ??= emptyFunnelDefinition();
  const base = input.slug ? input.slug : slugify(input.name);
  if (!isValidSlug(base)) throw new FunnelError("invalid_slug", 400, "Invalid address: use a-z, 0-9 and - (3 to 60)");
  return insertWithFreeSlug(base, {
    workspaceId: input.workspaceId,
    name: input.name,
    status: "DRAFT",
    draft: json(definition),
    published: Prisma.DbNull,
    publishedVersion: 0,
    templateId: input.templateId ?? null,
    createdBy: input.userId,
  });
}

/** Copy of the DRAFT: "<name> (cópia)", free slug, DRAFT, no visits. */
export async function duplicateFunnel(input: {
  source: FunnelRow;
  userId: string | null;
  name?: string | null;
  slug?: string | null;
}): Promise<FunnelRow> {
  const definition = definitionOrNull(input.source.draft) ?? emptyFunnelDefinition();
  const name = (input.name?.trim() || `${input.source.name} (cópia)`).slice(0, 80);
  const base = input.slug || slugify(`${input.source.slug}-copia`);
  if (!isValidSlug(base)) throw new FunnelError("invalid_slug", 400, "Invalid address: use a-z, 0-9 and - (3 to 60)");
  return insertWithFreeSlug(base, {
    workspaceId: input.source.workspaceId,
    name,
    status: "DRAFT",
    draft: json(definition),
    published: Prisma.DbNull,
    publishedVersion: 0,
    templateId: input.source.templateId,
    createdBy: input.userId,
  });
}

export type BlockPatch = { stepId: string; blockId?: string; set: Record<string, unknown> };

/**
 * Shallow merge into a block (or into a screen's title/header when there is
 * no blockId), then the whole definition goes through the zod again. For the
 * MCP: "troca o texto do botão" without resending the whole funnel.
 */
export function applyBlockPatches(
  def: FunnelDefinition,
  patches: BlockPatch[]
): { ok: true; definition: FunnelDefinition } | { ok: false; message: string; issues?: unknown } {
  const copy = structuredClone(def) as FunnelDefinition;
  for (const patch of patches) {
    const step = copy.steps.find((s) => s.id === patch.stepId);
    if (!step) return { ok: false, message: `Screen ${patch.stepId} not found` };
    const set = { ...(patch.set ?? {}) };
    if (!patch.blockId) {
      const allowed: Record<string, unknown> = {};
      if ("title" in set) allowed.title = set.title;
      if ("header" in set) allowed.header = set.header;
      if (Object.keys(allowed).length === 0) return { ok: false, message: "On a screen only title and header change" };
      Object.assign(step, allowed);
      continue;
    }
    const index = step.blocks.findIndex((b) => b.id === patch.blockId);
    if (index < 0) return { ok: false, message: `Block ${patch.blockId} not found on screen ${patch.stepId}` };
    // id and type never change through a patch.
    delete set.id;
    delete set.type;
    step.blocks[index] = { ...step.blocks[index], ...set } as FunnelBlock;
  }
  const parsed = funnelDefinitionSchema.safeParse(copy);
  if (!parsed.success) return { ok: false, message: "Invalid funnel after the changes", issues: parsed.error.issues };
  return { ok: true, definition: parsed.data };
}

/** Publish = the draft frozen into what the public page shows. */
export async function publishFunnel(input: {
  funnel: FunnelRow;
  userId: string | null;
  now?: Date;
}): Promise<{ ok: true; row: FunnelRow; validation: FunnelValidation } | { ok: false; validation: FunnelValidation | null; issues?: unknown }> {
  const parsed = funnelDefinitionSchema.safeParse(input.funnel.draft);
  if (!parsed.success) return { ok: false, validation: null, issues: parsed.error.issues };
  const validation = validateFunnel(parsed.data, input.now);
  if (!validation.ok) return { ok: false, validation };
  const row = await prisma.funnel.update({
    where: { id: input.funnel.id },
    data: {
      published: json(parsed.data),
      draft: json(parsed.data),
      publishedVersion: { increment: 1 },
      publishedAt: input.now ?? new Date(),
      publishedBy: input.userId,
      status: "PUBLISHED",
    },
    select: FUNNEL_SELECT,
  });
  return { ok: true, row, validation };
}

/** Off the air (DRAFT or ARCHIVED). `published` stays saved: publishing again brings it back. */
export async function unpublishFunnel(input: { funnel: FunnelRow; archive?: boolean }): Promise<FunnelRow> {
  return prisma.funnel.update({
    where: { id: input.funnel.id },
    data: { status: input.archive ? "ARCHIVED" : "DRAFT" },
    select: FUNNEL_SELECT,
  });
}

// ─── Numbers ────────────────────────────────────────────────────────────────

const n = (v: unknown) => Number(v ?? 0);
const DAY = 86_400_000;

/** Visits / checkouts / leads of the last 7 days per funnel (list screen). */
export async function funnelStats7d(funnelIds: string[], now: Date = new Date()): Promise<Map<string, FunnelStats>> {
  const map = new Map<string, FunnelStats>();
  if (funnelIds.length === 0) return map;
  const since = new Date(now.getTime() - 7 * DAY);
  const rows = await prisma.$queryRaw<{ funnelId: string; visits: number; checkouts: number; leads: number }[]>(Prisma.sql`
    SELECT v."funnelId", count(*)::int AS "visits",
      count(v."checkoutAt")::int AS "checkouts", count(v."leadAt")::int AS "leads"
    FROM "FunnelVisit" v
    WHERE v."funnelId" IN (${Prisma.join(funnelIds)}) AND v."createdAt" >= ${since}
    GROUP BY v."funnelId"`);
  for (const r of Array.isArray(rows) ? rows : []) {
    map.set(r.funnelId, { visits7d: n(r.visits), checkouts7d: n(r.checkouts), leads7d: n(r.leads) });
  }
  for (const id of funnelIds) if (!map.has(id)) map.set(id, { ...EMPTY_STATS });
  return map;
}

const pct = (a: number, b: number) => (b > 0 ? Math.min(100, Math.max(0, Number(((a / b) * 100).toFixed(1)))) : 0);

/** Results of the period. Labels and order come from the PUBLISHED version (draft if never published). */
export async function funnelResults(input: {
  funnel: FunnelRow;
  days: ReportPeriod;
  source: string | null;
  now?: Date;
}): Promise<FunnelResults> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - input.days * DAY);
  const def = definitionOrNull(input.funnel.published) ?? definitionOrNull(input.funnel.draft);
  const fid = input.funnel.id;
  const source = input.source?.trim().toLowerCase() || null;
  const sourceSql = source ? Prisma.sql`AND v."source" = ${source}` : Prisma.empty;

  const [totalsRows, stepRows, answerRows, sourceRows] = await Promise.all([
    prisma.$queryRaw<Record<string, number>[]>(Prisma.sql`
      SELECT count(*)::int AS "visits", count(v."startedAt")::int AS "started",
        count(v."completedAt")::int AS "completed", count(v."checkoutAt")::int AS "checkouts",
        count(v."leadAt")::int AS "leads", count(v."purchasedAt")::int AS "purchases",
        count(v."refundedAt")::int AS "refunds"
      FROM "FunnelVisit" v
      WHERE v."funnelId" = ${fid} AND v."createdAt" >= ${since} ${sourceSql}`),
    prisma.$queryRaw<{ stepId: string; views: number }[]>(Prisma.sql`
      SELECT e."stepId", count(DISTINCT e."visitId")::int AS "views"
      FROM "FunnelEvent" e JOIN "FunnelVisit" v ON v."id" = e."visitId"
      WHERE e."funnelId" = ${fid} AND e."type" = 'view' AND v."createdAt" >= ${since} ${sourceSql}
      GROUP BY e."stepId"`),
    prisma.$queryRaw<{ blockId: string; optionId: string; count: number }[]>(Prisma.sql`
      SELECT e."blockId", o."optionId", count(*)::int AS "count"
      FROM "FunnelEvent" e JOIN "FunnelVisit" v ON v."id" = e."visitId",
        LATERAL jsonb_array_elements_text(COALESCE(e."value"->'optionIds', '[]'::jsonb)) AS o("optionId")
      WHERE e."funnelId" = ${fid} AND e."type" = 'answer' AND v."createdAt" >= ${since} ${sourceSql}
      GROUP BY e."blockId", o."optionId"`),
    prisma.$queryRaw<{ source: string; visits: number; checkouts: number; purchases: number }[]>(Prisma.sql`
      SELECT v."source", count(*)::int AS "visits", count(v."checkoutAt")::int AS "checkouts",
        count(v."purchasedAt")::int AS "purchases"
      FROM "FunnelVisit" v
      WHERE v."funnelId" = ${fid} AND v."createdAt" >= ${since}
      GROUP BY v."source" ORDER BY "visits" DESC LIMIT 30`),
  ]);

  const t = (Array.isArray(totalsRows) ? totalsRows[0] : null) ?? {};
  const views = new Map((Array.isArray(stepRows) ? stepRows : []).map((r) => [r.stepId, n(r.views)]));
  const steps: FunnelResults["steps"] = [];
  let first = 0;
  let prev = 0;
  (def?.steps ?? []).forEach((step, index) => {
    const v = views.get(step.id) ?? 0;
    if (index === 0) first = v;
    steps.push({
      stepId: step.id,
      title: step.title,
      index,
      views: v,
      pctOfFirst: index === 0 ? (v > 0 ? 100 : 0) : pct(v, first),
      dropFromPrev: index === 0 ? 0 : prev > 0 ? Math.max(0, Number((100 - pct(v, prev)).toFixed(1))) : 0,
    });
    prev = v;
  });

  const answerCounts = new Map<string, number>();
  for (const r of Array.isArray(answerRows) ? answerRows : []) answerCounts.set(`${r.blockId}:${r.optionId}`, n(r.count));
  const answers: FunnelResults["answers"] = [];
  for (const step of def?.steps ?? []) {
    for (const block of step.blocks) {
      if (block.type !== "options") continue;
      answers.push({
        name: block.name,
        question: block.question ?? step.title,
        options: block.options.map((o) => ({ id: o.id, label: o.label, count: answerCounts.get(`${block.id}:${o.id}`) ?? 0 })),
      });
    }
  }

  return {
    days: input.days,
    source,
    totals: {
      visits: n(t.visits),
      started: n(t.started),
      completed: n(t.completed),
      checkouts: n(t.checkouts),
      leads: n(t.leads),
      purchases: n(t.purchases),
      refunds: n(t.refunds),
    },
    steps,
    answers,
    sources: (Array.isArray(sourceRows) ? sourceRows : []).map((r) => ({
      source: r.source,
      visits: n(r.visits),
      checkouts: n(r.checkouts),
      purchases: n(r.purchases),
    })),
  };
}

// ─── Leads (personal data: human-only routes) ───────────────────────────────

const LEAD_SELECT = {
  id: true,
  createdAt: true,
  name: true,
  email: true,
  phone: true,
  answers: true,
  tags: true,
  contactId: true,
  purchasedAt: true,
  contact: { select: { username: true } },
  visit: { select: { source: true, purchasedAt: true } },
} as const;

type LeadRecord = {
  id: string;
  createdAt: Date;
  name: string | null;
  email: string | null;
  phone: string | null;
  answers: unknown;
  tags: string[];
  contactId: string | null;
  purchasedAt: Date | null;
  contact?: { username: string | null } | null;
  visit?: { source: string | null; purchasedAt: Date | null } | null;
};

function presentLead(l: LeadRecord): FunnelLeadRow {
  const answers: Record<string, string> = {};
  if (l.answers && typeof l.answers === "object" && !Array.isArray(l.answers)) {
    for (const [k, v] of Object.entries(l.answers as Record<string, unknown>)) if (typeof v === "string") answers[k] = v;
  }
  const purchased = l.purchasedAt ?? l.visit?.purchasedAt ?? null;
  return {
    id: l.id,
    createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : String(l.createdAt),
    name: l.name,
    email: l.email,
    whatsapp: l.phone,
    answers,
    tags: Array.isArray(l.tags) ? l.tags : [],
    source: l.visit?.source ?? null,
    contactId: l.contactId,
    contactUsername: l.contact?.username ?? null,
    purchasedAt: purchased ? (purchased instanceof Date ? purchased.toISOString() : String(purchased)) : null,
  };
}

export async function funnelLeads(input: { funnelId: string; cursor?: string | null; limit?: number }): Promise<FunnelLeadsPage> {
  const limit = Math.min(100, Math.max(1, input.limit ?? 50));
  const [rows, total] = await Promise.all([
    prisma.funnelLead.findMany({
      where: { funnelId: input.funnelId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: LEAD_SELECT,
    }),
    prisma.funnelLead.count({ where: { funnelId: input.funnelId } }),
  ]);
  const list = (Array.isArray(rows) ? rows : []) as LeadRecord[];
  const page = list.slice(0, limit);
  return {
    rows: page.map(presentLead),
    nextCursor: list.length > limit ? (page[page.length - 1]?.id ?? null) : null,
    total: n(total),
  };
}

export const MAX_EXPORT_LEADS = 10_000;

/** CSV rows: data, nome, email, whatsapp, origem, contato, comprou, etiquetas + 1 column per question. */
export async function leadsCsvRows(funnel: FunnelRow): Promise<CsvCell[][]> {
  const def = definitionOrNull(funnel.published) ?? definitionOrNull(funnel.draft);
  const names: string[] = [];
  for (const step of def?.steps ?? []) for (const b of step.blocks) if (b.type === "options") names.push(b.name);
  const rows = (await prisma.funnelLead.findMany({
    where: { funnelId: funnel.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_EXPORT_LEADS,
    select: LEAD_SELECT,
  })) as LeadRecord[];
  const out: CsvCell[][] = [["data", "nome", "email", "whatsapp", "origem", "contato", "comprou", "etiquetas", ...names]];
  for (const raw of Array.isArray(rows) ? rows : []) {
    const l = presentLead(raw);
    out.push([
      l.createdAt,
      l.name,
      l.email,
      l.whatsapp,
      l.source,
      l.contactUsername ? `@${l.contactUsername}` : l.contactId,
      l.purchasedAt ? "sim" : "não",
      l.tags.join(" | "),
      ...names.map((name) => l.answers[name] ?? ""),
    ]);
  }
  return out;
}
