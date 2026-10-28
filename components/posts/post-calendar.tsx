"use client";

/**
 * 28/10/2026: calendário da aba Posts (mês e semana, horário de Brasília). Mostra os posts da pessoa
 * e os que o assistente (MCP) criou ou agendou, com um selo "agente". Clicar num dia abre o compositor
 * com a data preenchida; arrastar um post para outro dia reagenda pela MESMA rota humana (/schedule).
 * A lógica de datas está em lib/posts/calendar.ts.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLang, useT } from "@/components/lang-provider";
import { callApi } from "@/components/posts/api";
import { btnSecondary } from "@/components/posts/accounts-bar";
import { BrandIcon } from "@/components/social/brand-icon";
import {
  addDays,
  dayKey,
  dayProblem,
  groupByDay,
  monthGrid,
  moveToDay,
  nextFreeSlot,
  parseDayKey,
  postInstant,
  shiftMonth,
  slotIso,
  timeOf,
  timeProblem,
  undatedDrafts,
  visibleRange,
  weekDays,
  type DayCell,
} from "@/lib/posts/calendar";
import { NETWORK_NAME } from "@/lib/social-composer";
import type { PostDTO, PostStatus } from "@/lib/tiktok-composer";

const POLL_MS = 30_000;
const MAX_CHIPS = 3;
const EDITABLE: PostStatus[] = ["DRAFT", "SCHEDULED", "FAILED"];

const TONE: Record<PostStatus, string> = {
  DRAFT: "border-border bg-surface-hover text-muted",
  SCHEDULED: "border-accent/30 bg-accent/10 text-accent",
  PUBLISHING: "border-warning/30 bg-warning/10 text-warning",
  PUBLISHED: "border-success/30 bg-success/10 text-success",
  FAILED: "border-error/30 bg-error/10 text-error",
  CANCELED: "border-border bg-surface-hover text-muted",
};
const STATUS_LABEL: Record<PostStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  PUBLISHING: "Publishing",
  PUBLISHED: "Published",
  FAILED: "Failed",
  CANCELED: "Canceled",
};
const LEGEND: PostStatus[] = ["DRAFT", "SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED"];

function snippet(p: PostDTO): string {
  const text = (p.caption ?? "").replace(/\s+/g, " ").trim();
  return text.length > 28 ? `${text.slice(0, 27)}…` : text;
}

export function PostCalendar({
  reloadToken,
  canCreate,
  onCreate,
  onEdit,
  onChanged,
}: {
  reloadToken: number;
  canCreate: boolean;
  onCreate: (key: string, time: string | null) => void;
  onEdit: (post: PostDTO) => void;
  onChanged: () => Promise<void> | void;
}) {
  const t = useT();
  const { lang } = useLang();
  const locale = lang === "pt" ? "pt-BR" : "en";
  const [anchor, setAnchor] = useState(() => dayKey(new Date()));
  const [view, setView] = useState<"month" | "week">("month");
  const [dated, setDated] = useState<PostDTO[]>([]);
  const [drafts, setDrafts] = useState<PostDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);

  const cur = parseDayKey(anchor) ?? { year: 2026, month: 1, day: 1 };
  const range = useMemo(() => visibleRange(cur.year, cur.month), [cur.year, cur.month]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Carrega o intervalo visível e os rascunhos sem data. Refaz a cada 30 s, ao focar a aba e quando a página pede.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [a, b] = await Promise.all([
        callApi<PostDTO[]>(`/api/posts?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&limit=500`),
        callApi<PostDTO[]>("/api/posts?status=DRAFT&limit=200"),
      ]);
      if (cancelled) return;
      if (a.ok && a.data) setDated(a.data);
      if (b.ok && b.data) setDrafts(b.data);
      setFailed(!(a.ok && b.ok));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, reloadToken, tick]);

  useEffect(() => {
    const bump = () => {
      if (document.visibilityState === "visible") setTick((n) => n + 1);
    };
    const timer = window.setInterval(bump, POLL_MS);
    window.addEventListener("focus", bump);
    document.addEventListener("visibilitychange", bump);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", bump);
      document.removeEventListener("visibilitychange", bump);
    };
  }, []);

  const byDay = useMemo(() => groupByDay(dated), [dated]);
  const loose = useMemo(() => undatedDrafts(drafts), [drafts]);
  const todayKey = dayKey(new Date());

  const weekdayNames = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + i)))),
    [locale]
  );
  const longDay = (key: string) => {
    const p = parseDayKey(key);
    return p ? new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(p.year, p.month - 1, p.day))) : key;
  };
  const monthTitle = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(cur.year, cur.month - 1, 1)));
  const weekTitle = (() => {
    const days = weekDays(anchor);
    const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
    const f = (k: string) => {
      const p = parseDayKey(k)!;
      return fmt.format(new Date(Date.UTC(p.year, p.month - 1, p.day)));
    };
    return `${f(days[0].key)} - ${f(days[6].key)}`;
  })();

  function go(delta: number) {
    setNotice(null);
    if (view === "week") setAnchor((a) => addDays(a, delta * 7));
    else {
      const next = shiftMonth(cur.year, cur.month, delta);
      const todayP = parseDayKey(todayKey)!;
      setAnchor(next.year === todayP.year && next.month === todayP.month ? todayKey : `${next.year}-${String(next.month).padStart(2, "0")}-01`);
    }
  }

  function pickDay(key: string) {
    const problem = dayProblem(key);
    if (problem) {
      setNotice({ tone: "error", text: t("That day has already passed. Pick today or a later day.") });
      return;
    }
    const taken = (byDay.get(key) ?? []).flatMap((p) => (p.scheduledAt ? [p.scheduledAt] : []));
    const slot = nextFreeSlot(key, taken);
    setNotice(slot ? null : { tone: "info", text: t("No suggested time is left today. Pick a time in the form.") });
    onCreate(key, slot);
  }

  async function move(post: PostDTO, key: string) {
    setOverKey(null);
    setDragId(null);
    if (!EDITABLE.includes(post.status) || busy) return;
    if (dayProblem(key)) {
      setNotice({ tone: "error", text: t("That day has already passed. Pick today or a later day.") });
      return;
    }
    let iso: string | null = null;
    if (post.scheduledAt) {
      if (dayKey(post.scheduledAt) === key) return;
      iso = moveToDay(post.scheduledAt, key);
    } else {
      const slot = nextFreeSlot(key, (byDay.get(key) ?? []).flatMap((p) => (p.scheduledAt ? [p.scheduledAt] : [])));
      iso = slot ? slotIso(key, slot) : null;
    }
    if (!iso || timeProblem(iso)) {
      setNotice({ tone: "error", text: t("That time has passed or no time is free that day. Open the post and pick a time.") });
      return;
    }
    setBusy(true);
    const res = await callApi(`/api/posts/${post.id}/schedule`, { method: "POST", body: JSON.stringify({ scheduledAt: iso }) });
    setBusy(false);
    if (!alive.current) return;
    setNotice(res.ok ? { tone: "info", text: t("Post moved.") } : { tone: "error", text: t("Could not move the post. Open it and check the fields.") });
    await onChanged();
    setTick((n) => n + 1);
  }

  const find = (id: string | null) => (id ? [...dated, ...drafts].find((p) => p.id === id) ?? null : null);

  function chip(p: PostDTO, compact: boolean) {
    const editable = EDITABLE.includes(p.status);
    const at = postInstant(p);
    const time = at ? timeOf(at) : "";
    const text = snippet(p) || t("No caption");
    const agent = p.createdVia !== "UI";
    const label = `${NETWORK_NAME[p.platform]}, ${p.accountName}, ${time ? `${time}, ` : ""}${t(STATUS_LABEL[p.status])}${agent ? `, ${t("Agent")}` : ""}, ${text}`;
    return (
      <button
        key={p.id}
        type="button"
        draggable={editable}
        aria-label={label}
        title={label}
        aria-disabled={!editable}
        onDragStart={(e) => {
          if (!editable) return;
          e.dataTransfer.setData("text/plain", p.id);
          e.dataTransfer.effectAllowed = "move";
          setDragId(p.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setOverKey(null);
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (editable) onEdit(p);
          else if (p.externalUrl) window.open(p.externalUrl, "_blank", "noopener,noreferrer");
        }}
        className={`flex w-full min-w-0 items-center gap-0.5 overflow-hidden rounded-md border px-0.5 py-0.5 text-left text-[9px] leading-tight sm:gap-1 sm:px-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent sm:text-xs ${TONE[p.status]} ${editable ? "cursor-grab" : "cursor-default"} ${dragId === p.id ? "opacity-40" : ""}`}
      >
        <BrandIcon brand={p.platform} size={compact ? 12 : 14} />
        {time && (
          <span className="shrink-0 font-semibold tabular-nums">
            {compact && <span className="sm:hidden">{time.endsWith(":00") ? `${time.slice(0, 2)}h` : time.replace(":", "h")}</span>}
            <span className={compact ? "hidden sm:inline" : ""}>{time}</span>
          </span>
        )}
        <span className={`min-w-0 flex-1 truncate ${compact ? "hidden sm:inline" : ""}`}>{text}</span>
        {agent && <span className="hidden shrink-0 rounded bg-foreground/10 px-1 text-[9px] font-semibold uppercase sm:inline">{t("Agent")}</span>}
      </button>
    );
  }

  function cell(c: DayCell, mode: "month" | "week") {
    const items = byDay.get(c.key) ?? [];
    const past = c.key < todayKey;
    const shown = mode === "month" ? items.slice(0, MAX_CHIPS) : items;
    const extra = items.length - shown.length;
    return (
      <div
        key={c.key}
        role="gridcell"
        aria-label={longDay(c.key)}
        onClick={() => canCreate && pickDay(c.key)}
        onDragOver={(e) => {
          if (dragId) {
            e.preventDefault();
            setOverKey(c.key);
          }
        }}
        onDragLeave={() => setOverKey((k) => (k === c.key ? null : k))}
        onDrop={(e) => {
          e.preventDefault();
          const post = find(e.dataTransfer.getData("text/plain") || dragId);
          if (post) void move(post, c.key);
        }}
        className={`flex min-h-24 min-w-0 flex-col gap-1 rounded-lg border p-1 sm:min-h-28 sm:p-1.5 ${mode === "week" ? "min-h-0 sm:min-h-40" : ""} ${
          overKey === c.key ? "border-accent bg-accent/10" : c.key === todayKey ? "border-accent/60" : "border-border"
        } ${c.inMonth ? "bg-surface" : "bg-surface-hover/40"} ${past ? "opacity-70" : ""} ${canCreate ? "cursor-pointer" : ""}`}
      >
        <div className="flex items-center justify-between">
          <span className={`text-xs font-semibold ${c.key === todayKey ? "rounded-full bg-accent px-1.5 text-white" : c.inMonth ? "" : "text-muted"}`}>
            {mode === "week" ? <span className="mr-1 font-normal sm:hidden">{longDay(c.key).split(",")[0]}</span> : null}
            {c.day}
          </span>
          {canCreate && !past && (
            <button
              type="button"
              aria-label={t("Schedule a post on {day}", { day: longDay(c.key) })}
              onClick={(e) => {
                e.stopPropagation();
                pickDay(c.key);
              }}
              className="flex h-5 w-5 items-center justify-center rounded text-sm leading-none text-muted hover:bg-surface-hover hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              +
            </button>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          {shown.map((p) => chip(p, mode === "month"))}
          {extra > 0 && (
            <button
              type="button"
              aria-label={t("Show {n} more posts on {day}", { n: extra, day: longDay(c.key) })}
              onClick={(e) => {
                e.stopPropagation();
                setAnchor(c.key);
                setView("week");
              }}
              className="rounded-md px-1 text-left text-[10px] font-semibold text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent sm:text-xs"
            >
              +{extra}
            </button>
          )}
        </div>
      </div>
    );
  }

  const rows = view === "month" ? monthGrid(cur.year, cur.month) : [weekDays(anchor)];

  return (
    <section aria-label={t("Calendar")} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button type="button" aria-label={view === "week" ? t("Previous week") : t("Previous month")} onClick={() => go(-1)} className={`${btnSecondary} px-3`}>
            ‹
          </button>
          <h2 className="min-w-36 text-center text-sm font-semibold first-letter:uppercase" aria-live="polite">
            {view === "week" ? weekTitle : monthTitle}
          </h2>
          <button type="button" aria-label={view === "week" ? t("Next week") : t("Next month")} onClick={() => go(1)} className={`${btnSecondary} px-3`}>
            ›
          </button>
          <button type="button" onClick={() => setAnchor(todayKey)} className={btnSecondary}>
            {t("Today")}
          </button>
        </div>
        <div role="group" aria-label={t("Calendar view")} className="inline-flex rounded-lg border border-border p-0.5 text-xs font-semibold">
          {(["month", "week"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${view === v ? "bg-accent text-white" : "text-muted hover:text-foreground"}`}
            >
              {v === "month" ? t("Month") : t("Week")}
            </button>
          ))}
        </div>
      </div>

      {failed && <p role="alert" className="rounded-xl bg-error/10 px-4 py-2.5 text-sm text-error">{t("Could not load the posts. Try again in a moment.")}</p>}
      {notice && (
        <p role="status" className={`rounded-xl px-4 py-2.5 text-sm ${notice.tone === "error" ? "bg-error/10 text-error" : "bg-accent/10 text-accent"}`}>
          {notice.text}
        </p>
      )}

      {loose.length > 0 && (
        <div className="panel space-y-2 rounded-xl border border-border p-3">
          <p className="text-xs font-semibold">
            {t("Drafts")} <span className="font-normal text-muted">{t("Drag a draft to a day to schedule it, or click it to edit.")}</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {loose.map((p) => (
              <div key={p.id} className="max-w-full sm:max-w-64">{chip(p, false)}</div>
            ))}
          </div>
        </div>
      )}

      <div role="grid" aria-label={view === "week" ? weekTitle : monthTitle} aria-busy={loading} className="space-y-1">
        <div role="row" className="hidden grid-cols-7 gap-1 text-center text-xs font-semibold text-muted sm:grid">
          {weekdayNames.map((n) => (
            <div key={n} role="columnheader" className="capitalize">
              {n}
            </div>
          ))}
        </div>
        {view === "month" && (
          <div role="row" className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-muted sm:hidden">
            {weekdayNames.map((n) => (
              <div key={n} role="columnheader" className="capitalize">
                {n.slice(0, 3)}
              </div>
            ))}
          </div>
        )}
        {rows.map((row, i) => (
          <div key={row[0].key + i} role="row" className={`grid gap-1 ${view === "week" ? "grid-cols-1 sm:grid-cols-7" : "grid-cols-7"}`}>
            {row.map((c) => cell(c, view))}
          </div>
        ))}
      </div>

      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted" aria-label={t("Legend")}>
        {LEGEND.map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm border ${TONE[s]}`} aria-hidden />
            {t(STATUS_LABEL[s])}
          </li>
        ))}
        <li>{t("Times are in Brasília.")}</li>
      </ul>
    </section>
  );
}

