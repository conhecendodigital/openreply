/**
 * 28/10/2026: lógica pura do calendário da aba Posts. Sem React, sem servidor.
 * Tudo em horário de Brasília (UTC-3 fixo, sem horário de verão desde 2019).
 * Chave de dia = "AAAA-MM-DD" no horário de Brasília. Semana começa no domingo.
 */
import { brasiliaLocalToIso } from "@/lib/tiktok-composer";
import type { PostDTO } from "@/lib/tiktok-composer";

const BRT_SHIFT_MS = 3 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
/** Horários sugeridos (Brasília), na ordem em que são tentados. */
export const SUGGESTED_SLOTS = ["12:00", "17:00", "20:30"] as const;
/** Mesma folga que o /schedule exige. */
export const MIN_LEAD_MS = 60_000;

const pad = (n: number) => String(n).padStart(2, "0");

export interface BrtParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

/** Data/hora de Brasília de um instante. */
export function brtParts(input: Date | string): BrtParts {
  const d = typeof input === "string" ? new Date(input) : input;
  const s = new Date(d.getTime() - BRT_SHIFT_MS);
  return { year: s.getUTCFullYear(), month: s.getUTCMonth() + 1, day: s.getUTCDate(), hour: s.getUTCHours(), minute: s.getUTCMinutes() };
}

export function dayKeyOf(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Dia (chave) de Brasília de um instante. */
export function dayKey(input: Date | string): string {
  const p = brtParts(input);
  return dayKeyOf(p.year, p.month, p.day);
}

export function timeOf(input: Date | string): string {
  const p = brtParts(input);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function parseDayKey(key: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function addDays(key: string, days: number): string {
  const p = parseDayKey(key);
  if (!p) return key;
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day) + days * DAY_MS);
  return dayKeyOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** 0 = domingo. Calculado pela data, nunca à mão. */
export function weekdayOf(key: string): number {
  const p = parseDayKey(key);
  return p ? new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() : 0;
}

export interface DayCell {
  key: string;
  day: number;
  inMonth: boolean;
}

/** Grade do mês: semanas completas de domingo a sábado (4 a 6 semanas). month = 1-12. */
export function monthGrid(year: number, month: number): DayCell[][] {
  const first = Date.UTC(year, month - 1, 1);
  const lead = new Date(first).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weeks = Math.ceil((lead + daysInMonth) / 7);
  const rows: DayCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const row: DayCell[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(first + (w * 7 + i - lead) * DAY_MS);
      row.push({ key: dayKeyOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), day: d.getUTCDate(), inMonth: d.getUTCMonth() === month - 1 });
    }
    rows.push(row);
  }
  return rows;
}

/** Os 7 dias (domingo a sábado) da semana que contém `key`. */
export function weekDays(key: string): DayCell[] {
  const start = addDays(key, -weekdayOf(key));
  return Array.from({ length: 7 }, (_, i) => {
    const k = addDays(start, i);
    return { key: k, day: Number(k.slice(8)), inMonth: true };
  });
}

/** Mês seguinte/anterior (delta pode ser negativo). month = 1-12. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/** Intervalo a consultar: mês visível ±7 dias, em ISO (meia-noite de Brasília). `to` é exclusivo. */
export function visibleRange(year: number, month: number): { from: string; to: string } {
  const from = new Date(Date.UTC(year, month - 1, 1 - 7, 3, 0, 0));
  const to = new Date(Date.UTC(year, month, 1 + 7, 3, 0, 0));
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Quando o post "mora" no calendário. Rascunho sem data e cancelado ficam de fora. */
export function postInstant(p: Pick<PostDTO, "status" | "scheduledAt" | "publishedAt">): string | null {
  if (p.status === "CANCELED") return null;
  if (p.status === "PUBLISHED") return p.publishedAt ?? p.scheduledAt;
  return p.scheduledAt;
}

/** Posts por dia de Brasília, em ordem de horário. */
export function groupByDay<T extends Pick<PostDTO, "status" | "scheduledAt" | "publishedAt" | "id">>(posts: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const p of posts) {
    const at = postInstant(p);
    if (!at || Number.isNaN(new Date(at).getTime())) continue;
    const key = dayKey(at);
    const list = map.get(key);
    if (list) list.push(p);
    else map.set(key, [p]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => new Date(postInstant(a)!).getTime() - new Date(postInstant(b)!).getTime() || a.id.localeCompare(b.id));
  }
  return map;
}

/** Rascunhos sem horário (faixa "Rascunhos"), do mais novo para o mais antigo. */
export function undatedDrafts<T extends Pick<PostDTO, "status" | "scheduledAt" | "updatedAt">>(posts: T[]): T[] {
  return posts.filter((p) => p.status === "DRAFT" && !p.scheduledAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** ISO (UTC) de um dia + hora de Brasília ("HH:MM"). null se algo for inválido. */
export function slotIso(key: string, time: string): string | null {
  if (!parseDayKey(key) || !/^\d{2}:\d{2}$/.test(time)) return null;
  return brasiliaLocalToIso(`${key}T${time}`);
}

/**
 * Próximo horário sugerido livre (12:00, 17:00, 20:30) naquele dia, ainda no futuro (>= agora + 60 s).
 * Se todos estão ocupados, devolve o primeiro que ainda dá. null = o dia não tem mais horário sugerido.
 */
export function nextFreeSlot(key: string, takenIsos: string[], now: Date = new Date()): string | null {
  const taken = new Set(takenIsos.filter((iso) => dayKey(iso) === key).map((iso) => timeOf(iso)));
  const valid = SUGGESTED_SLOTS.filter((s) => {
    const iso = slotIso(key, s);
    return iso !== null && new Date(iso).getTime() >= now.getTime() + MIN_LEAD_MS;
  });
  return valid.find((s) => !taken.has(s)) ?? valid[0] ?? null;
}

export type ScheduleProblem = "past_day" | "past_time";

/** Dia no passado é recusado. */
export function dayProblem(key: string, now: Date = new Date()): ScheduleProblem | null {
  return key < dayKey(now) ? "past_day" : null;
}

/** Mesma regra do /schedule: horário >= agora + 60 s. */
export function timeProblem(iso: string | null, now: Date = new Date()): ScheduleProblem | null {
  if (!iso) return "past_time";
  return new Date(iso).getTime() < now.getTime() + MIN_LEAD_MS ? "past_time" : null;
}

/** Leva um instante para outro dia mantendo a hora de Brasília. */
export function moveToDay(iso: string, targetKey: string): string | null {
  return slotIso(targetKey, timeOf(iso));
}

/** Valor "AAAA-MM-DDTHH:mm" para o campo de data/hora do compositor. */
export function localValue(key: string, time: string): string {
  return `${key}T${time}`;
}

/** Hoje sem horário sugerido sobrando: próximo múltiplo de 5 min, pelo menos 2 min à frente. */
export function soonestTime(now: Date = new Date()): string {
  const t = new Date(Math.ceil((now.getTime() + 2 * 60_000) / 300_000) * 300_000);
  return timeOf(t);
}
