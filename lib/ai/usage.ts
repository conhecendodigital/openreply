/**
 * Gasto de IA (06/10/2026, pedido do dono: "quero relatório de gasto das APIs
 * e de clientes"). Só no servidor.
 *
 * Toda chamada paga (Anthropic, OpenAI conversa e embeddings, TypeSafe/Jev)
 * grava uma linha em whatsapp."WaAiUsage" por recordAiUsage. O custo é
 * calculado na hora com a tabela de preços do /admin e fica gravado (preço
 * que muda depois não reescreve o passado). Chamada que o teto barrou também
 * grava, com blocked = true e custo 0.
 *
 * Mesmos nomes da tabela do branch feat/wa-cerebro (ownerUserId, workspaceId,
 * kind, provider, model, tokensIn, tokensOut, costMicroUsd, refId, createdAt),
 * mais agent, contactId, conversationId, cacheRead, cacheWrite e blocked. O
 * SqlUsageRecorder do cérebro continua funcionando com esta tabela.
 *
 * Leitura: cada usuário vê só as linhas dele (RLS); o admin vê todas.
 */
import { Prisma, type PrismaClient } from "@/app/generated/prisma/client";
import { getPrisma } from "@/lib/db/client";
import { getAppPrisma, withRls, withSystemRole } from "@/lib/db/rls";
import { getAiSettings } from "@/lib/ai/credentials";
import {
  AI_AGENTS,
  CAP_ALERT_RATIO,
  isAiProvider,
  isUsageAgent,
  type AiProvider,
  type AiSettings,
  type ModelPrice,
  type UsageAgent,
} from "@/lib/ai/catalog";
import { toCsv, type CsvCell } from "@/lib/utils/csv-write";

export const USAGE_TIME_ZONE = "America/Sao_Paulo";
const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------------- */
/* Custo                                                                     */
/* ------------------------------------------------------------------------- */

export type TokenUsage = { tokensIn: number; tokensOut?: number; cacheRead?: number; cacheWrite?: number };

function tokens(n: number | undefined): number {
  return Number.isFinite(n) && (n as number) > 0 ? Math.round(n as number) : 0;
}

/**
 * Custo em micro dólar (1 dólar = 1.000.000), inteiro. Preço é dólar por 1
 * milhão de tokens, então preço * tokens já dá micro dólar. Arredonda pra cima.
 * tokensIn não inclui os tokens de cache (mesma convenção da Anthropic).
 */
export function costMicroUsd(price: ModelPrice | undefined, usage: TokenUsage): number {
  if (!price) return 0;
  const total =
    price.input * tokens(usage.tokensIn) +
    price.output * tokens(usage.tokensOut) +
    price.cacheRead * tokens(usage.cacheRead) +
    price.cacheWrite * tokens(usage.cacheWrite);
  return Math.ceil(total - 1e-9);
}

export function microToUsd(micro: number): number {
  return micro / 1_000_000;
}

/* ------------------------------------------------------------------------- */
/* Registro (agentes, cérebro, triagem)                                      */
/* ------------------------------------------------------------------------- */

export type AiUsageEntry = {
  ownerUserId: string;
  workspaceId: string;
  /** embedding | memory | agent | triage (mesmos valores do cérebro). */
  kind: string;
  agent?: UsageAgent | null;
  provider: AiProvider;
  model: string;
  /** Só o id do contato e da conversa, nenhum dado pessoal. */
  contactId?: string | null;
  conversationId?: string | null;
  tokensIn?: number;
  tokensOut?: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** true = o teto barrou e o modelo não foi chamado. */
  blocked?: boolean;
  refId?: string | null;
};

const KIND = /^[a-z_]{2,20}$/;

/**
 * Grava uma chamada. Devolve o custo calculado. Usa o papel de sistema: quem
 * chama é o worker, sem sessão. Não joga erro pra cima (gasto não pode
 * derrubar a resposta ao cliente): em falha devolve recorded = false.
 */
export async function recordAiUsage(
  entry: AiUsageEntry,
  deps: { base?: PrismaClient; settings?: AiSettings } = {}
): Promise<{ recorded: boolean; costMicroUsd: number; priced: boolean }> {
  const base = deps.base ?? getPrisma();
  const settings = deps.settings ?? (await getAiSettings(base).catch(() => null));
  const price = settings?.prices[entry.model];
  const blocked = Boolean(entry.blocked);
  const usage = {
    tokensIn: tokens(entry.tokensIn),
    tokensOut: tokens(entry.tokensOut),
    cacheRead: tokens(entry.cacheRead),
    cacheWrite: tokens(entry.cacheWrite),
  };
  const cost = blocked ? 0 : costMicroUsd(price, usage);
  if (!isAiProvider(entry.provider) || !KIND.test(entry.kind) || !entry.ownerUserId || !entry.workspaceId) {
    return { recorded: false, costMicroUsd: cost, priced: Boolean(price) };
  }
  try {
    await withSystemRole(
      (tx) =>
        tx.waAiUsage.create({
          data: {
            ownerUserId: entry.ownerUserId,
            workspaceId: entry.workspaceId,
            kind: entry.kind,
            agent: entry.agent && isUsageAgent(entry.agent) ? entry.agent : null,
            provider: entry.provider,
            model: entry.model.slice(0, 80),
            contactId: entry.contactId ?? null,
            conversationId: entry.conversationId ?? null,
            ...usage,
            costMicroUsd: BigInt(cost),
            blocked,
            refId: entry.refId ?? null,
          },
          select: { id: true },
        }),
      base
    );
    return { recorded: true, costMicroUsd: cost, priced: Boolean(price) };
  } catch (e) {
    console.error("[ai] não gravou o gasto:", (e as Error)?.message?.slice(0, 200));
    return { recorded: false, costMicroUsd: cost, priced: Boolean(price) };
  }
}

/* ------------------------------------------------------------------------- */
/* Dia e período (fuso de Brasília)                                          */
/* ------------------------------------------------------------------------- */

function zonedParts(t: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(t);
  const p = (k: string) => Number(parts.find((x) => x.type === k)?.value ?? 0);
  return { y: p("year"), m: p("month"), d: p("day"), h: p("hour"), min: p("minute"), s: p("second") };
}

function offsetMs(t: Date, timeZone: string): number {
  const z = zonedParts(t, timeZone);
  return Date.UTC(z.y, z.m - 1, z.d, z.h, z.min, z.s) - Math.floor(t.getTime() / 1000) * 1000;
}

/** Meia-noite do dia y-m-d no fuso, como Date em UTC. */
export function zonedMidnight(y: number, m: number, d: number, timeZone = USAGE_TIME_ZONE): Date {
  const guess = Date.UTC(y, m - 1, d);
  return new Date(guess - offsetMs(new Date(guess), timeZone));
}

export function startOfDay(now: Date, timeZone = USAGE_TIME_ZONE): Date {
  const z = zonedParts(now, timeZone);
  return zonedMidnight(z.y, z.m, z.d, timeZone);
}

export const USAGE_PERIODS = ["today", "7d", "30d", "month", "custom"] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDay(value: string | null | undefined): { y: number; m: number; d: number } | null {
  const match = ISO_DAY.exec(value ?? "");
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** [from, to) do período. Erro em inglês (a tela traduz). */
export function resolvePeriod(
  period: string | null | undefined,
  custom: { from?: string | null; to?: string | null },
  now: Date = new Date()
): { ok: true; period: UsagePeriod; from: Date; to: Date } | { ok: false; error: string } {
  const p = (USAGE_PERIODS as readonly string[]).includes(period ?? "") ? (period as UsagePeriod) : "7d";
  const today = startOfDay(now);
  const z = zonedParts(now, USAGE_TIME_ZONE);
  const tomorrow = zonedMidnight(z.y, z.m, z.d + 1);
  if (p === "today") return { ok: true, period: p, from: today, to: tomorrow };
  if (p === "7d") return { ok: true, period: p, from: zonedMidnight(z.y, z.m, z.d - 6), to: tomorrow };
  if (p === "30d") return { ok: true, period: p, from: zonedMidnight(z.y, z.m, z.d - 29), to: tomorrow };
  if (p === "month") return { ok: true, period: p, from: zonedMidnight(z.y, z.m, 1), to: tomorrow };
  const a = parseDay(custom.from);
  const b = parseDay(custom.to);
  if (!a || !b) return { ok: false, error: "Choose the start and end dates." };
  const from = zonedMidnight(a.y, a.m, a.d);
  const to = zonedMidnight(b.y, b.m, b.d + 1);
  if (to <= from) return { ok: false, error: "The end date must be after the start date." };
  if (to.getTime() - from.getTime() > 367 * DAY_MS) return { ok: false, error: "Choose up to one year." };
  return { ok: true, period: p, from, to };
}

/* ------------------------------------------------------------------------- */
/* Filtros                                                                   */
/* ------------------------------------------------------------------------- */

export type UsageFilters = {
  period: UsagePeriod;
  from: Date;
  to: Date;
  userId: string | null;
  workspaceId: string | null;
  agent: UsageAgent | null;
  provider: AiProvider | null;
  model: string | null;
};

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MODEL = /^[A-Za-z0-9._:-]{1,80}$/;

export function parseUsageFilters(
  params: URLSearchParams,
  now: Date = new Date()
): { ok: true; filters: UsageFilters } | { ok: false; error: string } {
  const range = resolvePeriod(params.get("period"), { from: params.get("from"), to: params.get("to") }, now);
  if (!range.ok) return range;
  const id = (k: string) => {
    const v = params.get(k);
    return v && ID.test(v) ? v : null;
  };
  const agent = params.get("agent");
  const provider = params.get("provider");
  const model = params.get("model");
  return {
    ok: true,
    filters: {
      period: range.period,
      from: range.from,
      to: range.to,
      userId: id("userId"),
      workspaceId: id("workspaceId"),
      agent: isUsageAgent(agent) ? agent : null,
      provider: isAiProvider(provider) ? provider : null,
      model: model && MODEL.test(model) ? model : null,
    },
  };
}

export type UsageViewer = { userId: string; admin: boolean };

/** WHERE do relatório. Quem não é admin só vê as próprias linhas (e a RLS confere de novo). */
export function usageConditions(filters: UsageFilters, viewer: UsageViewer): Prisma.Sql[] {
  const conds: Prisma.Sql[] = [
    Prisma.sql`"createdAt" >= ${filters.from}`,
    Prisma.sql`"createdAt" < ${filters.to}`,
  ];
  if (!viewer.admin) conds.push(Prisma.sql`"ownerUserId" = ${viewer.userId}`);
  else if (filters.userId) conds.push(Prisma.sql`"ownerUserId" = ${filters.userId}`);
  if (filters.workspaceId) conds.push(Prisma.sql`"workspaceId" = ${filters.workspaceId}`);
  if (filters.agent) conds.push(Prisma.sql`"agent" = ${filters.agent}`);
  if (filters.provider) conds.push(Prisma.sql`"provider" = ${filters.provider}`);
  if (filters.model) conds.push(Prisma.sql`"model" = ${filters.model}`);
  return conds;
}

/* ------------------------------------------------------------------------- */
/* Teto diário                                                               */
/* ------------------------------------------------------------------------- */

/** Gasto de hoje (fuso de Brasília) do usuário ou do workspace, em micro dólar. */
export async function spentTodayMicroUsd(
  scope: { ownerUserId: string } | { workspaceId: string },
  now: Date = new Date(),
  base: PrismaClient = getPrisma()
): Promise<number> {
  const since = startOfDay(now);
  const where =
    "ownerUserId" in scope
      ? Prisma.sql`"ownerUserId" = ${scope.ownerUserId}`
      : Prisma.sql`"workspaceId" = ${scope.workspaceId}`;
  const rows = await withSystemRole(
    (tx) =>
      tx.$queryRaw<{ total: number }[]>`SELECT COALESCE(SUM("costMicroUsd"), 0)::float8 AS total
        FROM whatsapp."WaAiUsage" WHERE ${where} AND "createdAt" >= ${since}`,
    base
  );
  return Number(rows[0]?.total ?? 0);
}

export type CapCheck =
  | { ok: true; userSpentMicroUsd: number; workspaceSpentMicroUsd: number }
  | { ok: false; reason: "teto_usuario" | "teto_workspace"; spentMicroUsd: number; capMicroUsd: number };

/**
 * Antes de chamar o modelo: o gasto de hoje + o pior caso desta chamada cabe
 * no teto do usuário e no do workspace? (mesmos motivos de teto.ts do
 * feat/wa-agentes). Se não couber, grave com recordAiUsage({ blocked: true }).
 */
export async function checkDailyCap(
  input: { ownerUserId: string; workspaceId: string; expectedCostMicroUsd: number; now?: Date },
  deps: { base?: PrismaClient; settings?: AiSettings } = {}
): Promise<CapCheck> {
  const base = deps.base ?? getPrisma();
  const settings = deps.settings ?? (await getAiSettings(base));
  const now = input.now ?? new Date();
  const expected = Math.max(0, Math.ceil(input.expectedCostMicroUsd));
  const user = await spentTodayMicroUsd({ ownerUserId: input.ownerUserId }, now, base);
  const userCap = Math.round(settings.dailyCapUserUsd * 1_000_000);
  if (user + expected > userCap) return { ok: false, reason: "teto_usuario", spentMicroUsd: user, capMicroUsd: userCap };
  const ws = await spentTodayMicroUsd({ workspaceId: input.workspaceId }, now, base);
  const wsCap = Math.round(settings.dailyCapWorkspaceUsd * 1_000_000);
  if (ws + expected > wsCap) return { ok: false, reason: "teto_workspace", spentMicroUsd: ws, capMicroUsd: wsCap };
  return { ok: true, userSpentMicroUsd: user, workspaceSpentMicroUsd: ws };
}

export type CapUse = { id: string; label: string | null; spentMicroUsd: number; capUsd: number; ratio: number };
export type CapAlert = CapUse & { kind: "user" | "workspace" };

/** % do teto de cada um (0 a 1+), do maior pro menor. */
export function capUse(
  rows: { id: string; spentMicroUsd: number }[],
  capUsd: number,
  labels: Record<string, string | null> = {}
): CapUse[] {
  const cap = capUsd * 1_000_000;
  return rows
    .map((r) => ({
      id: r.id,
      label: labels[r.id] ?? null,
      spentMicroUsd: r.spentMicroUsd,
      capUsd,
      ratio: cap > 0 ? r.spentMicroUsd / cap : r.spentMicroUsd > 0 ? Infinity : 0,
    }))
    .sort((a, b) => b.ratio - a.ratio);
}

/** Quem passou de 80% do teto diário. */
export function capAlerts(users: CapUse[], workspaces: CapUse[], threshold = CAP_ALERT_RATIO): CapAlert[] {
  return [
    ...users.filter((u) => u.ratio >= threshold).map((u) => ({ ...u, kind: "user" as const })),
    ...workspaces.filter((w) => w.ratio >= threshold).map((w) => ({ ...w, kind: "workspace" as const })),
  ];
}

/* ------------------------------------------------------------------------- */
/* Relatório                                                                 */
/* ------------------------------------------------------------------------- */

const RESPONSE_AGENTS = Prisma.join(AI_AGENTS.map((a) => Prisma.sql`${a}`));

export type UsageTotals = {
  costMicroUsd: number;
  calls: number;
  blockedCalls: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  conversations: number;
  responses: number;
  avgPerConversationMicroUsd: number | null;
  avgPerResponseMicroUsd: number | null;
};

export type UsageGroupRow = { key: string; label: string | null; costMicroUsd: number; calls: number; tokensIn: number; tokensOut: number };

export type UsageReport = {
  period: UsagePeriod;
  from: string;
  to: string;
  totals: UsageTotals;
  byDay: { day: string; costMicroUsd: number; calls: number }[];
  byUser: UsageGroupRow[];
  byWorkspace: UsageGroupRow[];
  byModel: (UsageGroupRow & { provider: string; model: string })[];
  byAgent: UsageGroupRow[];
  today: { users: CapUse[]; workspaces: CapUse[] };
  alerts: CapAlert[];
  caps: { dailyCapUserUsd: number; dailyCapWorkspaceUsd: number };
  usdToBrl: number | null;
};

type Agg = { key: string | null; cost: number; calls: number; tin: number; tout: number };

function group(rows: Agg[], labels: Record<string, string | null> = {}): UsageGroupRow[] {
  return rows.map((r) => ({
    key: r.key ?? "",
    label: r.key ? labels[r.key] ?? null : null,
    costMicroUsd: Number(r.cost),
    calls: Number(r.calls),
    tokensIn: Number(r.tin),
    tokensOut: Number(r.tout),
  }));
}

async function userLabels(ids: string[]): Promise<Record<string, string | null>> {
  if (!ids.length) return {};
  const rows = await getPrisma().user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } });
  return Object.fromEntries(rows.map((r) => [r.id, r.email]));
}

async function workspaceLabels(ids: string[]): Promise<Record<string, string | null>> {
  if (!ids.length) return {};
  const rows = await getPrisma().workspace.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

export type ReportDeps = {
  base?: PrismaClient;
  settings?: AiSettings;
  now?: Date;
  /** Nome/e-mail pra mostrar (só o admin). Padrão: busca no banco. */
  labels?: { users(ids: string[]): Promise<Record<string, string | null>>; workspaces(ids: string[]): Promise<Record<string, string | null>> };
};

export async function getUsageReport(viewer: UsageViewer, filters: UsageFilters, deps: ReportDeps = {}): Promise<UsageReport> {
  const base = deps.base ?? getAppPrisma();
  const settings = deps.settings ?? (await getAiSettings(deps.base ?? getPrisma()));
  const now = deps.now ?? new Date();
  const where = Prisma.join(usageConditions(filters, viewer), " AND ");
  const todayStart = startOfDay(now);
  const todayWhere = viewer.admin
    ? Prisma.sql`"createdAt" >= ${todayStart} AND NOT "blocked"`
    : Prisma.sql`"createdAt" >= ${todayStart} AND NOT "blocked" AND "ownerUserId" = ${viewer.userId}`;
  const T = Prisma.sql`whatsapp."WaAiUsage"`;
  const AGG = Prisma.sql`COALESCE(SUM("costMicroUsd"), 0)::float8 AS cost, COUNT(*)::int AS calls,
    COALESCE(SUM("tokensIn"), 0)::float8 AS tin, COALESCE(SUM("tokensOut"), 0)::float8 AS tout`;

  const r = await withRls({ userId: viewer.userId, workspaceId: null }, async (tx) => {
    const totals = await tx.$queryRaw<Record<string, number>[]>`SELECT
        COALESCE(SUM("costMicroUsd"), 0)::float8 AS cost,
        COUNT(*)::int AS calls,
        (COUNT(*) FILTER (WHERE "blocked"))::int AS blocked,
        COALESCE(SUM("tokensIn"), 0)::float8 AS tin,
        COALESCE(SUM("tokensOut"), 0)::float8 AS tout,
        COALESCE(SUM("cacheRead"), 0)::float8 AS cread,
        COALESCE(SUM("cacheWrite"), 0)::float8 AS cwrite,
        (COUNT(DISTINCT "conversationId"))::int AS conversations,
        COALESCE(SUM("costMicroUsd") FILTER (WHERE "conversationId" IS NOT NULL), 0)::float8 AS convcost,
        (COUNT(*) FILTER (WHERE "agent" IN (${RESPONSE_AGENTS}) AND NOT "blocked"))::int AS responses,
        COALESCE(SUM("costMicroUsd") FILTER (WHERE "agent" IN (${RESPONSE_AGENTS}) AND NOT "blocked"), 0)::float8 AS respcost
      FROM ${T} WHERE ${where}`;
    const byDay = await tx.$queryRaw<{ day: string; cost: number; calls: number }[]>`SELECT
        to_char(("createdAt" AT TIME ZONE ${USAGE_TIME_ZONE})::date, 'YYYY-MM-DD') AS day,
        COALESCE(SUM("costMicroUsd"), 0)::float8 AS cost, COUNT(*)::int AS calls
      FROM ${T} WHERE ${where} GROUP BY 1 ORDER BY 1`;
    const byUser = await tx.$queryRaw<Agg[]>`SELECT "ownerUserId" AS key, ${AGG}
      FROM ${T} WHERE ${where} GROUP BY 1 ORDER BY cost DESC LIMIT 20`;
    const byWorkspace = await tx.$queryRaw<Agg[]>`SELECT "workspaceId" AS key, ${AGG}
      FROM ${T} WHERE ${where} GROUP BY 1 ORDER BY cost DESC LIMIT 20`;
    const byModel = await tx.$queryRaw<(Agg & { provider: string; model: string })[]>`SELECT
        "provider" || ':' || "model" AS key, "provider", "model", ${AGG}
      FROM ${T} WHERE ${where} GROUP BY "provider", "model" ORDER BY cost DESC`;
    const byAgent = await tx.$queryRaw<Agg[]>`SELECT COALESCE("agent", "kind") AS key, ${AGG}
      FROM ${T} WHERE ${where} GROUP BY 1 ORDER BY cost DESC`;
    const todayUsers = await tx.$queryRaw<{ id: string; spent: number }[]>`SELECT "ownerUserId" AS id,
        COALESCE(SUM("costMicroUsd"), 0)::float8 AS spent FROM ${T} WHERE ${todayWhere} GROUP BY 1`;
    const todayWs = viewer.admin
      ? await tx.$queryRaw<{ id: string; spent: number }[]>`SELECT "workspaceId" AS id,
          COALESCE(SUM("costMicroUsd"), 0)::float8 AS spent FROM ${T} WHERE ${todayWhere} GROUP BY 1`
      : [];
    return { totals: totals[0], byDay, byUser, byWorkspace, byModel, byAgent, todayUsers, todayWs };
  }, base);

  const labels = viewer.admin ? deps.labels ?? { users: userLabels, workspaces: workspaceLabels } : null;
  const userIds = [...new Set([...r.byUser.map((u) => u.key), ...r.todayUsers.map((u) => u.id)].filter(Boolean))] as string[];
  const wsIds = [...new Set([...r.byWorkspace.map((w) => w.key), ...r.todayWs.map((w) => w.id)].filter(Boolean))] as string[];
  const [uLabels, wLabels] = labels
    ? await Promise.all([labels.users(userIds).catch(() => ({})), labels.workspaces(wsIds).catch(() => ({}))])
    : [{}, {}];

  const t = r.totals ?? {};
  const totals: UsageTotals = {
    costMicroUsd: Number(t.cost ?? 0),
    calls: Number(t.calls ?? 0),
    blockedCalls: Number(t.blocked ?? 0),
    tokensIn: Number(t.tin ?? 0),
    tokensOut: Number(t.tout ?? 0),
    cacheRead: Number(t.cread ?? 0),
    cacheWrite: Number(t.cwrite ?? 0),
    conversations: Number(t.conversations ?? 0),
    responses: Number(t.responses ?? 0),
    avgPerConversationMicroUsd: Number(t.conversations) > 0 ? Number(t.convcost) / Number(t.conversations) : null,
    avgPerResponseMicroUsd: Number(t.responses) > 0 ? Number(t.respcost) / Number(t.responses) : null,
  };
  const users = capUse(
    r.todayUsers.map((u) => ({ id: u.id, spentMicroUsd: Number(u.spent) })),
    settings.dailyCapUserUsd,
    uLabels
  );
  const workspaces = capUse(
    r.todayWs.map((w) => ({ id: w.id, spentMicroUsd: Number(w.spent) })),
    settings.dailyCapWorkspaceUsd,
    wLabels
  );
  return {
    period: filters.period,
    from: filters.from.toISOString(),
    to: filters.to.toISOString(),
    totals,
    byDay: r.byDay.map((d) => ({ day: d.day, costMicroUsd: Number(d.cost), calls: Number(d.calls) })),
    byUser: group(r.byUser, uLabels),
    byWorkspace: group(r.byWorkspace, wLabels),
    byModel: r.byModel.map((m) => ({ ...group([m])[0], provider: m.provider, model: m.model })),
    byAgent: group(r.byAgent),
    today: { users, workspaces },
    alerts: capAlerts(users, workspaces),
    caps: { dailyCapUserUsd: settings.dailyCapUserUsd, dailyCapWorkspaceUsd: settings.dailyCapWorkspaceUsd },
    usdToBrl: settings.usdToBrl,
  };
}

/* ------------------------------------------------------------------------- */
/* CSV                                                                       */
/* ------------------------------------------------------------------------- */

export const CSV_MAX_ROWS = 50_000;

type CsvRow = {
  createdAt: Date;
  ownerUserId: string;
  workspaceId: string;
  kind: string;
  agent: string | null;
  provider: string;
  model: string;
  contactId: string | null;
  conversationId: string | null;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  costMicroUsd: bigint | number;
  blocked: boolean;
};

/** Linhas do CSV (texto protegido contra fórmula em lib/utils/csv-write.ts). */
export function usageCsv(rows: CsvRow[], options: { usdToBrl: number | null; emails?: Record<string, string | null> }): string {
  const header: CsvCell[] = [
    "data_hora",
    "usuario_id",
    ...(options.emails ? ["usuario_email"] : []),
    "workspace_id",
    "agente",
    "tipo",
    "provedor",
    "modelo",
    "contato_id",
    "conversa_id",
    "tokens_entrada",
    "tokens_saida",
    "tokens_cache_leitura",
    "tokens_cache_escrita",
    "custo_usd",
    ...(options.usdToBrl ? ["custo_brl"] : []),
    "bloqueada_pelo_teto",
  ];
  const body = rows.map((r): CsvCell[] => {
    const usd = Number(r.costMicroUsd) / 1_000_000;
    return [
      r.createdAt,
      r.ownerUserId,
      ...(options.emails ? [options.emails[r.ownerUserId] ?? ""] : []),
      r.workspaceId,
      r.agent ?? "",
      r.kind,
      r.provider,
      r.model,
      r.contactId ?? "",
      r.conversationId ?? "",
      r.tokensIn,
      r.tokensOut,
      r.cacheRead,
      r.cacheWrite,
      Math.round(usd * 1_000_000) / 1_000_000,
      ...(options.usdToBrl ? [Math.round(usd * options.usdToBrl * 1_000_000) / 1_000_000] : []),
      r.blocked ? "sim" : "nao",
    ];
  });
  return toCsv([header, ...body]);
}

export async function getUsageCsv(viewer: UsageViewer, filters: UsageFilters, deps: ReportDeps = {}): Promise<string> {
  const base = deps.base ?? getAppPrisma();
  const settings = deps.settings ?? (await getAiSettings(deps.base ?? getPrisma()));
  const where = Prisma.join(usageConditions(filters, viewer), " AND ");
  const rows = await withRls(
    { userId: viewer.userId, workspaceId: null },
    (tx) =>
      tx.$queryRaw<CsvRow[]>`SELECT "createdAt", "ownerUserId", "workspaceId", "kind", "agent", "provider", "model",
          "contactId", "conversationId", "tokensIn", "tokensOut", "cacheRead", "cacheWrite", "costMicroUsd", "blocked"
        FROM whatsapp."WaAiUsage" WHERE ${where} ORDER BY "createdAt" DESC LIMIT ${CSV_MAX_ROWS}`,
    base
  );
  const emails = viewer.admin
    ? await (deps.labels?.users ?? userLabels)([...new Set(rows.map((r) => r.ownerUserId))]).catch(() => ({}))
    : undefined;
  return usageCsv(
    rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt) })),
    { usdToBrl: settings.usdToBrl, emails }
  );
}
