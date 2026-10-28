/**
 * "Vendas por origem" (28/10/2026): junta as compras que a Hotmart avisou
 * (FunnelPurchase) com a etiqueta de origem (sck, src, utm) e traduz a etiqueta
 * pro nome do fluxo, campanha, disparo ou quiz que usa aquele link.
 * Funções puras: nada aqui lê o banco nem mostra e-mail.
 *
 * Regras:
 * - Uma venda = uma transação (a Hotmart manda vários eventos por venda).
 * - Reembolso/chargeback vence aprovada; cancelada só se nunca foi paga.
 * - Compra sem etiqueta nunca é descartada: vai pra "Sem origem".
 * - Etiqueta que não casa com nada conhecido aparece crua.
 */

export const VENDAS_TIMEZONE = "America/Sao_Paulo";
export const HOTMART_WEBHOOK_URL = "https://many.leadenginer.com/api/webhooks/hotmart";
export const NO_ORIGIN_LABEL = "Sem origem";

const APPROVED = new Set(["PURCHASE_APPROVED", "PURCHASE_COMPLETE"]);
const REFUNDED = new Set(["PURCHASE_REFUNDED", "PURCHASE_CHARGEBACK"]);
const CANCELED = new Set(["PURCHASE_CANCELED"]);

export type OriginKind = "flow" | "campaign" | "broadcast" | "quiz" | "unknown" | "none";
export type SaleState = "paga" | "reembolsada" | "cancelada" | "pendente";

export type OriginEntry = { tag: string; kind: Exclude<OriginKind, "unknown" | "none">; refId: string; name: string };

export type OriginSource = {
  kind: OriginEntry["kind"];
  refId: string;
  name: string;
  /** Links e textos do fluxo/campanha/disparo/quiz onde a etiqueta pode estar. */
  texts: string[];
};

const URL_RE = /https?:\/\/[^\s"'<>)\]\\]+/gi;

/** Etiquetas (sck, src e utm_campaign) de todos os links achados no texto. */
export function tagsFromText(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.match(URL_RE) ?? []) {
    let url: URL;
    try {
      url = new URL(raw.replace(/[.,;]+$/, ""));
    } catch {
      continue;
    }
    for (const key of ["sck", "src", "utm_campaign"]) {
      const v = url.searchParams.get(key)?.trim().toLowerCase();
      if (v) out.add(v.slice(0, 200));
    }
  }
  return [...out];
}

/** Todas as strings de um JSON (fluxo, quiz), pra procurar links dentro. */
export function stringsOf(value: unknown, limit = 5000): string[] {
  const out: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (out.length >= limit || depth > 12) return;
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) for (const x of v) walk(x, depth + 1);
    else if (v && typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) walk(x, depth + 1);
  };
  walk(value, 0);
  return out;
}

/** etiqueta -> fluxo/campanha/disparo/quiz. Se duas coisas usam a mesma etiqueta, vira "A ou B". */
export function buildOriginMap(sources: OriginSource[]): Map<string, OriginEntry> {
  const map = new Map<string, OriginEntry>();
  for (const s of sources) {
    for (const text of s.texts) {
      for (const tag of tagsFromText(text)) {
        const prev = map.get(tag);
        if (!prev) map.set(tag, { tag, kind: s.kind, refId: s.refId, name: s.name });
        else if (prev.refId !== s.refId && !prev.name.split(" ou ").includes(s.name)) {
          map.set(tag, { ...prev, name: `${prev.name} ou ${s.name}` });
        }
      }
    }
  }
  return map;
}

/** "a" ou "b" quando a etiqueta tem o lado como palavra solta (ex.: quero-b-pagina). */
export function sideOfTag(tag: string): "A" | "B" | null {
  const m = /(?:^|[-_])(a|b)(?:[-_]|$)/i.exec(tag);
  return m ? (m[1].toUpperCase() as "A" | "B") : null;
}

/** Acha a etiqueta no mapa: inteira, ou por pedaço (o checkout monta sck = utm_source + "_" + utm_campaign). */
export function lookupTag(tag: string, map: Map<string, OriginEntry>): OriginEntry | null {
  const t = tag.trim().toLowerCase();
  const direct = map.get(t);
  if (direct) return direct;
  for (const piece of t.split("_").slice(1)) {
    const hit = map.get(piece);
    if (hit) return hit;
  }
  return null;
}

export type PurchaseInput = {
  transaction: string;
  event: string;
  status: string | null;
  productName: string | null;
  productId: string | null;
  amountCents: number | null;
  currency: string | null;
  sck: string | null;
  src: string | null;
  xcod: string | null;
  occurredAt: Date;
  funnelId: string | null;
  funnelName: string | null;
  /** tracking da visita do quiz (utm_*, sck) quando a compra casou com uma visita. */
  visitTracking: Record<string, unknown> | null;
  abVariant: string | null;
};

export type Sale = {
  transaction: string;
  occurredAt: string;
  quando: string;
  produto: string;
  amountCents: number | null;
  currency: string | null;
  estado: SaleState;
  etiqueta: string | null;
  origemChave: string;
  origem: string;
  tipo: OriginKind;
  lado: "A" | "B" | null;
};

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "ter 28/10/2026 14:03" no horário de Brasília. */
export function formatBrasilia(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: VENDAS_TIMEZONE, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${WEEKDAYS[wd] ?? ""} ${get("day")}/${get("month")}/${get("year")} ${hour}:${get("minute")}`;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** A etiqueta crua de uma compra: sck, depois src, depois o que a visita do quiz guardou. */
export function rawTagOf(rows: PurchaseInput[]): string | null {
  for (const key of ["sck", "src"] as const) {
    for (const r of rows) {
      const v = str(r[key]);
      if (v) return v;
    }
  }
  for (const r of rows) {
    const t = r.visitTracking;
    const v = str(t?.sck) ?? str(t?.utm_campaign);
    if (v) return v;
  }
  return null;
}

export function groupSales(rows: PurchaseInput[], map: Map<string, OriginEntry>): Sale[] {
  const byTx = new Map<string, PurchaseInput[]>();
  for (const r of rows) {
    const list = byTx.get(r.transaction) ?? [];
    list.push(r);
    byTx.set(r.transaction, list);
  }
  const sales: Sale[] = [];
  for (const [transaction, list] of byTx) {
    const sorted = [...list].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const approved = sorted.find((r) => APPROVED.has(r.event));
    const estado: SaleState = sorted.some((r) => REFUNDED.has(r.event))
      ? "reembolsada"
      : approved
        ? "paga"
        : sorted.some((r) => CANCELED.has(r.event))
          ? "cancelada"
          : "pendente";
    const main = approved ?? sorted[0];
    const withAmount = approved?.amountCents != null ? approved : sorted.find((r) => r.amountCents != null) ?? main;
    const etiqueta = rawTagOf(sorted);
    const hit = etiqueta ? lookupTag(etiqueta, map) : null;
    let origemChave: string;
    let origem: string;
    let tipo: OriginKind;
    if (hit) {
      origemChave = `${hit.kind}:${hit.refId}`;
      origem = hit.name;
      tipo = hit.kind;
    } else if (etiqueta) {
      origemChave = `raw:${etiqueta.toLowerCase()}`;
      origem = etiqueta;
      tipo = "unknown";
    } else {
      const quiz = sorted.find((r) => r.funnelId);
      if (quiz?.funnelId) {
        origemChave = `quiz:${quiz.funnelId}`;
        origem = quiz.funnelName ? `Quiz: ${quiz.funnelName}` : "Quiz";
        tipo = "quiz";
      } else {
        origemChave = "none";
        origem = NO_ORIGIN_LABEL;
        tipo = "none";
      }
    }
    const ab = sorted.find((r) => r.abVariant)?.abVariant;
    sales.push({
      transaction,
      occurredAt: main.occurredAt.toISOString(),
      quando: formatBrasilia(main.occurredAt),
      produto: main.productName || main.productId || "produto",
      amountCents: withAmount.amountCents,
      currency: withAmount.currency,
      estado,
      etiqueta,
      origemChave,
      origem,
      tipo,
      lado: (hit ? sideOfTag(etiqueta!) : etiqueta ? sideOfTag(etiqueta) : null) ?? (ab === "A" || ab === "B" ? ab : null),
    });
  }
  return sales.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

export type Entries = { entraram: number | null; clicaram: number | null };

export type OriginTotal = {
  chave: string;
  origem: string;
  tipo: OriginKind;
  etiquetas: string[];
  vendas: number;
  reembolsos: number;
  canceladas: number;
  pendentes: number;
  receitaCents: Record<string, number>;
  reembolsadoCents: Record<string, number>;
  entraram: number | null;
  clicaram: number | null;
  /** % de vendas pagas sobre quem entrou (null = sem base). */
  conversaoEntrada: number | null;
  /** % de vendas pagas sobre quem clicou (null = sem base). */
  conversaoClique: number | null;
};

const pct = (a: number, b: number | null) => (b && b > 0 ? Number(((a / b) * 100).toFixed(1)) : null);

export function totalsByOrigin(sales: Sale[], entries: Map<string, Entries> = new Map()): OriginTotal[] {
  const map = new Map<string, OriginTotal>();
  for (const s of sales) {
    let t = map.get(s.origemChave);
    if (!t) {
      const e = entries.get(s.origemChave);
      t = {
        chave: s.origemChave, origem: s.origem, tipo: s.tipo, etiquetas: [], vendas: 0, reembolsos: 0, canceladas: 0,
        pendentes: 0, receitaCents: {}, reembolsadoCents: {}, entraram: e?.entraram ?? null, clicaram: e?.clicaram ?? null,
        conversaoEntrada: null, conversaoClique: null,
      };
      map.set(s.origemChave, t);
    }
    if (s.etiqueta && !t.etiquetas.includes(s.etiqueta)) t.etiquetas.push(s.etiqueta);
    const cur = (s.currency ?? "BRL").toUpperCase();
    if (s.estado === "paga") {
      t.vendas += 1;
      t.receitaCents[cur] = (t.receitaCents[cur] ?? 0) + (s.amountCents ?? 0);
    } else if (s.estado === "reembolsada") {
      t.reembolsos += 1;
      t.reembolsadoCents[cur] = (t.reembolsadoCents[cur] ?? 0) + (s.amountCents ?? 0);
    } else if (s.estado === "cancelada") t.canceladas += 1;
    else t.pendentes += 1;
  }
  const out = [...map.values()];
  for (const t of out) {
    t.conversaoEntrada = pct(t.vendas, t.entraram);
    t.conversaoClique = pct(t.vendas, t.clicaram);
  }
  return out.sort((a, b) => b.vendas - a.vendas || b.reembolsos - a.reembolsos || a.origem.localeCompare(b.origem));
}

export function filterByOrigin(sales: Sale[], origem: string | null | undefined): Sale[] {
  const q = origem?.trim().toLowerCase();
  if (!q) return sales;
  return sales.filter(
    (s) =>
      s.origem.toLowerCase().includes(q) ||
      (s.etiqueta ?? "").toLowerCase().includes(q) ||
      (q === "sem origem" && s.tipo === "none")
  );
}
