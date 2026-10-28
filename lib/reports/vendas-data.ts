/**
 * Lê o banco pro relatório "Vendas por origem" (somente leitura).
 *
 * Escopo: compras do workspace + (só se pedido, para o admin da plataforma)
 * as que a Hotmart avisou e não casaram com nenhuma visita/lead do quiz
 * (workspaceId nulo). A tabela FunnelPurchase não guarda e-mail: só hash, que
 * este arquivo nem seleciona.
 */
import { prisma } from "@/lib/db/client";
import { parseReportDays, startOfLocalDay } from "@/lib/reports/period";
import {
  buildOriginMap,
  filterByOrigin,
  groupSales,
  stringsOf,
  totalsByOrigin,
  HOTMART_WEBHOOK_URL,
  type Entries,
  type OriginSource,
  type PurchaseInput,
} from "@/lib/reports/vendas";

const DAY = 24 * 60 * 60 * 1000;
const MAX_TRANSACTIONS = 1000;

export type SalesReportOptions = {
  workspaceId: string;
  /** Inclui compras sem workspace (não casaram com visita). Só admin da plataforma. */
  includeUnattributed: boolean;
  days?: string | number | null;
  origem?: string | null;
  now?: Date;
};

export async function buildSalesReport(opts: SalesReportOptions) {
  const now = opts.now ?? new Date();
  const days = parseReportDays(opts.days == null ? null : String(opts.days));
  const since = days === 1 ? startOfLocalDay(now) : new Date(now.getTime() - days * DAY);
  const scope = [{ workspaceId: opts.workspaceId }, ...(opts.includeUnattributed ? [{ workspaceId: null }] : [])];

  const recent = (await prisma.funnelPurchase.findMany({
    where: { provider: "hotmart", occurredAt: { gte: since }, OR: scope },
    select: { transaction: true },
    distinct: ["transaction"],
    orderBy: { occurredAt: "desc" },
    take: MAX_TRANSACTIONS,
  })) as { transaction: string }[];
  const transactions = (Array.isArray(recent) ? recent : []).map((r) => r.transaction);

  const raw = transactions.length
    ? await prisma.funnelPurchase.findMany({
        where: { provider: "hotmart", transaction: { in: transactions }, OR: scope },
        select: {
          transaction: true, event: true, status: true, productName: true, productId: true, amountCents: true,
          currency: true, sck: true, src: true, xcod: true, occurredAt: true, funnelId: true,
          funnel: { select: { name: true } },
          visit: { select: { tracking: true, abVariant: true } },
        },
        orderBy: { occurredAt: "asc" },
      })
    : [];
  const rows: PurchaseInput[] = (Array.isArray(raw) ? raw : []).map((r) => ({
    transaction: r.transaction, event: r.event, status: r.status, productName: r.productName, productId: r.productId,
    amountCents: r.amountCents, currency: r.currency, sck: r.sck, src: r.src, xcod: r.xcod, occurredAt: r.occurredAt,
    funnelId: r.funnelId, funnelName: r.funnel?.name ?? null,
    visitTracking: (r.visit?.tracking as Record<string, unknown> | null) ?? null,
    abVariant: r.visit?.abVariant ?? null,
  }));

  const map = buildOriginMap(await originSources(opts.workspaceId));
  const sales = filterByOrigin(groupSales(rows, map), opts.origem);
  const entries = await entriesFor(
    opts.workspaceId,
    since,
    new Set(sales.map((s) => s.origemChave))
  );
  const origens = totalsByOrigin(sales, entries);

  // Quantas compras existem na tabela no total: separa "nunca chegou nada" de "nada neste período".
  const everReceived = (await prisma.funnelPurchase.count({ where: { provider: "hotmart", OR: scope } })) as number;

  return {
    dias: days,
    desde: since.toISOString(),
    fuso: "America/Sao_Paulo",
    webhookUrl: HOTMART_WEBHOOK_URL,
    nenhumaCompraAindaRecebida: !everReceived,
    aviso: !everReceived
      ? `Nenhuma compra recebida ainda. Conferir se o webhook está cadastrado na Hotmart: ${HOTMART_WEBHOOK_URL}`
      : null,
    truncado: transactions.length >= MAX_TRANSACTIONS,
    etiquetasConhecidas: map.size,
    totais: {
      vendas: sales.filter((s) => s.estado === "paga").length,
      reembolsos: sales.filter((s) => s.estado === "reembolsada").length,
      semOrigem: sales.filter((s) => s.tipo === "none").length,
    },
    origens,
    vendas: sales,
  };
}

export type SalesReport = Awaited<ReturnType<typeof buildSalesReport>>;

async function originSources(workspaceId: string): Promise<OriginSource[]> {
  const [flows, flowLinks, automations, trackedLinks, broadcasts, broadcastLinks, funnels] = await Promise.all([
    prisma.flow.findMany({ where: { workspaceId }, select: { id: true, name: true, published: true, draft: true }, take: 500 }),
    prisma.flowLink.findMany({ where: { workspaceId }, select: { flowId: true, destinationUrl: true }, take: 2000 }),
    prisma.automation.findMany({ where: { workspaceId }, select: { id: true, name: true, dmMessage: true, openingDmMessage: true }, take: 500 }),
    prisma.trackedLink.findMany({ where: { workspaceId }, select: { automationId: true, destinationUrl: true }, take: 2000 }),
    prisma.broadcast.findMany({ where: { workspaceId }, select: { id: true, name: true, text: true, buttons: true }, take: 500 }),
    prisma.broadcastLink.findMany({ where: { workspaceId }, select: { broadcastId: true, destinationUrl: true }, take: 2000 }),
    prisma.funnel.findMany({ where: { workspaceId }, select: { id: true, name: true, published: true, draft: true }, take: 200 }),
  ]);
  const list = <T,>(v: T[] | null | undefined) => (Array.isArray(v) ? v : []);
  const out: OriginSource[] = [];
  const flowUrls = new Map<string, string[]>();
  for (const l of list(flowLinks)) flowUrls.set(l.flowId, [...(flowUrls.get(l.flowId) ?? []), l.destinationUrl]);
  for (const f of list(flows)) {
    out.push({ kind: "flow", refId: f.id, name: f.name, texts: [...(flowUrls.get(f.id) ?? []), ...stringsOf(f.published ?? f.draft)] });
  }
  const autoUrls = new Map<string, string[]>();
  for (const l of list(trackedLinks)) autoUrls.set(l.automationId, [...(autoUrls.get(l.automationId) ?? []), l.destinationUrl]);
  for (const a of list(automations)) {
    out.push({ kind: "campaign", refId: a.id, name: a.name, texts: [...(autoUrls.get(a.id) ?? []), a.dmMessage, a.openingDmMessage ?? ""] });
  }
  const bcUrls = new Map<string, string[]>();
  for (const l of list(broadcastLinks)) bcUrls.set(l.broadcastId, [...(bcUrls.get(l.broadcastId) ?? []), l.destinationUrl]);
  for (const b of list(broadcasts)) {
    out.push({ kind: "broadcast", refId: b.id, name: b.name, texts: [...(bcUrls.get(b.id) ?? []), b.text, ...stringsOf(b.buttons)] });
  }
  for (const q of list(funnels)) {
    out.push({ kind: "quiz", refId: q.id, name: `Quiz: ${q.name}`, texts: stringsOf(q.published ?? q.draft) });
  }
  return out;
}

/** entraram -> clicaram de cada origem que teve venda (quando o sistema conta isso). */
async function entriesFor(workspaceId: string, since: Date, keys: Set<string>): Promise<Map<string, Entries>> {
  const out = new Map<string, Entries>();
  const ids = (kind: string) =>
    [...keys].filter((k) => k.startsWith(`${kind}:`)).map((k) => k.slice(kind.length + 1));
  const counts = <T extends { _count: { _all?: number } | number | undefined }>(rows: T[] | null | undefined, key: keyof T) => {
    const m = new Map<string, number>();
    for (const r of Array.isArray(rows) ? rows : []) {
      const c = r._count;
      m.set(String(r[key]), typeof c === "number" ? c : c?._all ?? 0);
    }
    return m;
  };

  const flowIds = ids("flow");
  if (flowIds.length) {
    const [runs, clicks] = await Promise.all([
      prisma.flowRun.groupBy({ by: ["flowId"], where: { workspaceId, flowId: { in: flowIds }, startedAt: { gte: since } }, _count: { _all: true } }),
      prisma.flowLinkClick.groupBy({ by: ["flowId"], where: { flowId: { in: flowIds }, createdAt: { gte: since } }, _count: { _all: true } }),
    ]);
    const r = counts(runs as never, "flowId" as never);
    const c = counts(clicks as never, "flowId" as never);
    for (const id of flowIds) out.set(`flow:${id}`, { entraram: r.get(id) ?? 0, clicaram: c.get(id) ?? 0 });
  }
  const autoIds = ids("campaign");
  if (autoIds.length) {
    const [dms, clicks] = await Promise.all([
      prisma.dmLog.groupBy({ by: ["automationId"], where: { workspaceId, automationId: { in: autoIds }, createdAt: { gte: since } }, _count: { _all: true } }),
      prisma.linkClick.groupBy({ by: ["automationId"], where: { workspaceId, automationId: { in: autoIds }, createdAt: { gte: since } }, _count: { _all: true } }),
    ]);
    const d = counts(dms as never, "automationId" as never);
    const c = counts(clicks as never, "automationId" as never);
    for (const id of autoIds) out.set(`campaign:${id}`, { entraram: d.get(id) ?? 0, clicaram: c.get(id) ?? 0 });
  }
  const bcIds = ids("broadcast");
  if (bcIds.length) {
    const [rec, clicks] = await Promise.all([
      prisma.broadcastRecipient.groupBy({ by: ["broadcastId"], where: { workspaceId, broadcastId: { in: bcIds }, sentAt: { gte: since } }, _count: { _all: true } }),
      prisma.broadcastLinkClick.groupBy({ by: ["broadcastId"], where: { broadcastId: { in: bcIds }, createdAt: { gte: since } }, _count: { _all: true } }),
    ]);
    const r = counts(rec as never, "broadcastId" as never);
    const c = counts(clicks as never, "broadcastId" as never);
    for (const id of bcIds) out.set(`broadcast:${id}`, { entraram: r.get(id) ?? 0, clicaram: c.get(id) ?? 0 });
  }
  const quizIds = ids("quiz");
  if (quizIds.length) {
    const base = { workspaceId, funnelId: { in: quizIds }, createdAt: { gte: since } };
    const [visits, checkouts] = await Promise.all([
      prisma.funnelVisit.groupBy({ by: ["funnelId"], where: base, _count: { _all: true } }),
      prisma.funnelVisit.groupBy({ by: ["funnelId"], where: { ...base, checkoutAt: { not: null } }, _count: { _all: true } }),
    ]);
    const v = counts(visits as never, "funnelId" as never);
    const c = counts(checkouts as never, "funnelId" as never);
    for (const id of quizIds) out.set(`quiz:${id}`, { entraram: v.get(id) ?? 0, clicaram: c.get(id) ?? 0 });
  }
  return out;
}
