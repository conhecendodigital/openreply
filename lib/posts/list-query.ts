/**
 * 28/10/2026: parâmetros novos (aditivos) de GET /api/posts para o calendário:
 * `from`/`to` (data ISO ou "AAAA-MM-DD", `to` exclusivo) e `limit`. Sem eles a rota
 * se comporta como antes. Devolve datas já validadas ou o motivo da recusa.
 */
export const MAX_LIST_LIMIT = 500;
export const DEFAULT_LIST_LIMIT = 200;
/** Janela máxima: mês visível ±7 dias cabe folgado. */
export const MAX_RANGE_DAYS = 100;

export type ListQuery = { ok: true; from: Date | null; to: Date | null; limit: number } | { ok: false; message: string };

function parseDate(raw: string): Date | null {
  const isDay = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const isIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(raw);
  if (!isDay && !isIso) return null;
  const d = new Date(isDay ? `${raw}T00:00:00.000-03:00` : raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseListQuery(params: URLSearchParams): ListQuery {
  const rawFrom = params.get("from");
  const rawTo = params.get("to");
  const rawLimit = params.get("limit");
  if ((rawFrom === null) !== (rawTo === null)) return { ok: false, message: "Send both from and to" };
  let from: Date | null = null;
  let to: Date | null = null;
  if (rawFrom !== null && rawTo !== null) {
    from = parseDate(rawFrom);
    to = parseDate(rawTo);
    if (!from || !to) return { ok: false, message: "Invalid date range" };
    if (to.getTime() <= from.getTime()) return { ok: false, message: "Invalid date range" };
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) return { ok: false, message: "Date range too long" };
  }
  let limit = DEFAULT_LIST_LIMIT;
  if (rawLimit !== null) {
    if (!/^\d{1,4}$/.test(rawLimit)) return { ok: false, message: "Invalid limit" };
    limit = Number(rawLimit);
    if (limit < 1 || limit > MAX_LIST_LIMIT) return { ok: false, message: "Invalid limit" };
  }
  return { ok: true, from, to, limit };
}
