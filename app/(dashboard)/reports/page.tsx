"use client";

/**
 * Reports (Etapa 5, 2026-10-08): the workspace in 7, 30 or 90 days. Read
 * only. Charts are plain SVG/CSS (no chart library). Every section exports
 * to CSV (one long table: section, item, metric, value).
 *
 * The public share links of a campaign report stay at /reports/<slug>.
 */

import { useEffect, useMemo, useState } from "react";
import { useLang, useT } from "@/components/lang-provider";
import { flowApi } from "@/components/flows/flow-shared";
import { apiErrorText } from "@/components/segment-builder";

type CtrRow = { id: string; name: string; sent: number; clicks: number; ctr: number };

type Report = {
  days: number;
  since: string;
  until: string;
  dms: {
    total: number;
    groups: { campaign: number; flow: number; broadcast: number; inbox: number; draft: number };
    byOrigin: Record<string, number>;
    ledgerSince: string;
    campaignsFromDmLog: number;
  };
  ctr: { campaigns: CtrRow[]; flows: CtrRow[]; broadcasts: CtrRow[] };
  newContacts: { total: number; byDay: { day: string; count: number }[] };
  topTags: { tag: string; added: number; removed: number; net: number }[];
  topPosts: { mediaId: string; dms: number; people: number }[];
  moderation: { hidden: number; wouldHide: number; restored: number; failed: number };
  funnel: { commented: number; received: number; clicked: number; receivedRate: number; clickRate: number };
};

type Post = { id: string; permalink?: string; thumbnail_url?: string; media_url?: string; caption?: string };

const PERIODS = [7, 30, 90] as const;

const ORIGINS: { key: keyof Report["dms"]["groups"]; label: string; color: string }[] = [
  { key: "campaign", label: "Campaigns", color: "#0095f6" },
  { key: "flow", label: "Flows", color: "#8a3ab9" },
  { key: "broadcast", label: "Broadcasts", color: "#d62976" },
  { key: "inbox", label: "Direct (by hand)", color: "#58c322" },
  { key: "draft", label: "Approved drafts", color: "#f2a33a" },
];

function exportHref(days: number, section: string) {
  return `/api/reports/export?days=${days}&section=${section}`;
}

function Card({
  title,
  csv,
  children,
  hint,
}: {
  title: string;
  csv?: string;
  children: React.ReactNode;
  hint?: string;
}) {
  const t = useT();
  return (
    <section className="panel min-w-0 space-y-3 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
        {csv && (
          <a href={csv} className="shrink-0 rounded-lg border border-border px-2 py-0.5 text-xs font-semibold text-muted hover:text-foreground" download>
            {t("CSV")}
          </a>
        )}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="panel rounded-2xl p-4">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted">{label}</p>
      {sub && <p className="mt-1 text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

/** Horizontal bars (CSS). */
function Bars({ rows }: { rows: { label: string; value: number; color?: string; note?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums font-semibold">
              {r.value}
              {r.note && <span className="ml-1 text-xs font-normal text-muted">{r.note}</span>}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
            <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? "#0095f6" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Columns per day (SVG), with a few date labels under it. */
function DayColumns({ data, locale }: { data: { day: string; count: number }[]; locale: string }) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.count));
  const w = 600;
  const h = 160;
  const gap = data.length > 60 ? 1 : 2;
  const bw = Math.max(1, (w - gap * (data.length - 1)) / Math.max(1, data.length));
  const label = (day: string) =>
    new Date(`${day}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" });
  const ticks = data.length <= 7 ? data.map((_, i) => i) : [0, Math.floor((data.length - 1) / 2), data.length - 1];
  const shown = hover !== null ? data[hover] : null;
  return (
    <div className="space-y-1">
      <p className="h-4 text-xs text-muted">
        {shown ? t("{day}: {n} new", { day: label(shown.day), n: shown.count }) : t("Peak: {n} in a day", { n: max === 1 && data.every((d) => d.count === 0) ? 0 : max })}
      </p>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-40 w-full" preserveAspectRatio="none" role="img" aria-label={t("New contacts per day")} onMouseLeave={() => setHover(null)}>
        <line x1="0" y1={h - 0.5} x2={w} y2={h - 0.5} stroke="currentColor" strokeOpacity="0.15" />
        {data.map((d, i) => {
          const bh = d.count > 0 ? Math.max(2, (d.count / max) * (h - 8)) : 0;
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)}>
              <rect x={i * (bw + gap)} y={0} width={bw} height={h} fill="transparent" />
              <rect
                x={i * (bw + gap)}
                y={h - bh}
                width={bw}
                height={bh}
                rx={Math.min(3, bw / 2)}
                fill={hover === i ? "#1877f2" : "#0095f6"}
              />
            </g>
          );
        })}
      </svg>
      <div className="relative h-4 text-[11px] text-muted">
        {ticks.map((i) => (
          <span
            key={i}
            className="absolute -translate-x-1/2 whitespace-nowrap first:translate-x-0 last:-translate-x-full"
            style={{ left: `${((i + 0.5) / data.length) * 100}%` }}
          >
            {data[i] ? label(data[i].day) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Commented → got the DM → clicked, as shrinking bars. */
function Funnel({ f }: { f: Report["funnel"] }) {
  const t = useT();
  const steps = [
    { label: t("Commented"), value: f.commented, rate: null as number | null },
    { label: t("Got the DM"), value: f.received, rate: f.receivedRate },
    { label: t("Clicked the link"), value: f.clicked, rate: f.clickRate },
  ];
  const max = Math.max(1, f.commented);
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => (
        <li key={s.label} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span>
              {i + 1}. {s.label}
            </span>
            <span className="tabular-nums">
              <span className="font-semibold">{s.value}</span>
              {s.rate !== null && <span className="ml-1.5 text-xs text-muted">{t("{pct}% of the step before", { pct: s.rate })}</span>}
            </span>
          </div>
          <div className="flex h-7 justify-center overflow-hidden rounded-lg bg-surface-hover">
            <div className="ig-gradient h-full rounded-lg" style={{ width: `${Math.max(s.value > 0 ? 2 : 0, (s.value / max) * 100)}%`, opacity: 1 - i * 0.2 }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function CtrTable({ rows }: { rows: CtrRow[] }) {
  const t = useT();
  if (rows.length === 0) return <p className="text-sm text-muted">{t("Nothing sent in this period.")}</p>;
  const maxCtr = Math.max(1, ...rows.map((r) => r.ctr));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-1.5 pr-2 font-medium">{t("Name")}</th>
            <th className="px-2 py-1.5 text-right font-medium">{t("Sent")}</th>
            <th className="px-2 py-1.5 text-right font-medium">{t("Clicks")}</th>
            <th className="py-1.5 pl-2 font-medium">CTR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="max-w-[200px] truncate py-2 pr-2">{r.name === "(apagado)" ? t("(deleted)") : r.name}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.sent}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.clicks}</td>
              <td className="py-2 pl-2">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-16 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${(r.ctr / maxCtr) * 100}%` }} />
                  </span>
                  <span className="tabular-nums">{r.ctr}%</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReportsPage() {
  const t = useT();
  const { lang } = useLang();
  const locale = lang === "pt" ? "pt-BR" : "en";
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ctrTab, setCtrTab] = useState<"campaigns" | "flows" | "broadcasts">("campaigns");
  const [posts, setPosts] = useState<Map<string, Post>>(new Map());

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void flowApi<Report>(`/api/reports?days=${days}`).then((r) => {
        if (!alive) return;
        setLoading(false);
        if (r.success) {
          setReport(r.data);
          setError(null);
        } else setError(apiErrorText(t, r));
      });
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [days, t]);

  // Thumbnails of the top posts (best effort: the latest posts of each account).
  useEffect(() => {
    let alive = true;
    void flowApi<{ instagramAccounts: { id: string }[] }>("/api/instagram/accounts").then(async (r) => {
      if (!r.success) return;
      const map = new Map<string, Post>();
      for (const a of r.data.instagramAccounts ?? []) {
        const p = await flowApi<Post[]>(`/api/instagram/posts?instagramAccountId=${encodeURIComponent(a.id)}&limit=50`);
        if (p.success && Array.isArray(p.data)) for (const post of p.data) map.set(post.id, post);
      }
      if (alive) setPosts(map);
    });
    return () => {
      alive = false;
    };
  }, []);

  const totalClicks = useMemo(
    () => (report ? [...report.ctr.campaigns, ...report.ctr.flows, ...report.ctr.broadcasts].reduce((s, r) => s + r.clicks, 0) : 0),
    [report]
  );

  const rangeText = report
    ? `${new Date(report.since).toLocaleDateString(locale, { day: "numeric", month: "short" })} – ${new Date(report.until).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}`
    : "";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{t("Reports")}</h2>
          <p className="text-sm text-muted">{rangeText || t("Your account in numbers.")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label={t("Period")} className="inline-flex gap-1 rounded-xl bg-surface-hover p-1">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={days === p}
                onClick={() => setDays(p)}
                className={`rounded-lg px-3 py-1.5 text-sm ${days === p ? "bg-background font-semibold shadow-sm" : "text-muted"}`}
              >
                {t("{n} days", { n: p })}
              </button>
            ))}
          </div>
          <a href={exportHref(days, "all")} download className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-surface-hover">
            {t("Export CSV")}
          </a>
        </div>
      </div>

      {error && <p className="rounded-xl bg-error/10 px-4 py-2.5 text-sm text-error">{error}</p>}

      {!report ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="panel h-24 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label={t("DMs sent")} value={report.dms.total} />
            <Kpi label={t("Link clicks")} value={totalClicks} />
            <Kpi label={t("New contacts")} value={report.newContacts.total} />
            <Kpi label={t("Hidden comments")} value={report.moderation.hidden} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card
              title={t("DMs sent by origin")}
              csv={exportHref(days, "dms")}
              hint={t("Counted since {date}, when every send started being logged. Failed sends are left out.", {
                date: new Date(`${report.dms.ledgerSince}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }),
              })}
            >
              <Bars rows={ORIGINS.map((o) => ({ label: t(o.label), value: report.dms.groups[o.key], color: o.color }))} />
              <p className="text-xs text-muted">
                {t("Campaign DMs in the campaign history for this period: {n}.", { n: report.dms.campaignsFromDmLog })}
              </p>
            </Card>

            <Card title={t("Funnel: commented → got the DM → clicked")} csv={exportHref(days, "funnel")} hint={t("People, not messages.")}>
              <Funnel f={report.funnel} />
            </Card>
          </div>

          <Card title={t("New contacts per day")} csv={exportHref(days, "contacts")} hint={t("São Paulo time.")}>
            <DayColumns data={report.newContacts.byDay} locale={locale} />
          </Card>

          <Card title={t("Clicks and CTR")} csv={exportHref(days, ctrTab)} hint={t("CTR = clicks ÷ DMs sent.")}>
            <div role="tablist" className="flex gap-4 border-b border-border">
              {(["campaigns", "flows", "broadcasts"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={ctrTab === k}
                  onClick={() => setCtrTab(k)}
                  className={`-mb-px border-b-2 pb-2 text-sm ${ctrTab === k ? "border-foreground font-semibold" : "border-transparent text-muted"}`}
                >
                  {k === "campaigns" ? t("Campaigns") : k === "flows" ? t("Flows") : t("Broadcasts")}
                  <span className="ml-1 text-xs text-muted">{report.ctr[k].length}</span>
                </button>
              ))}
            </div>
            <CtrTable rows={report.ctr[ctrTab]} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={t("Tags that grew the most")} csv={exportHref(days, "tags")} hint={t("Added minus removed in the period.")}>
              {report.topTags.length === 0 ? (
                <p className="text-sm text-muted">{t("No tag changes in this period.")}</p>
              ) : (
                <Bars
                  rows={report.topTags
                    .filter((x) => x.net > 0)
                    .slice(0, 10)
                    .map((x) => ({ label: x.tag, value: x.net, color: "#8a3ab9", note: x.removed ? t("(+{a} −{r})", { a: x.added, r: x.removed }) : undefined }))}
                />
              )}
            </Card>

            <Card title={t("Top posts by DMs")} csv={exportHref(days, "posts")} hint={t("Campaign DMs that answered a comment on the post.")}>
              {report.topPosts.length === 0 ? (
                <p className="text-sm text-muted">{t("No post DMs in this period.")}</p>
              ) : (
                <ul className="space-y-2">
                  {report.topPosts.map((p, i) => {
                    const post = posts.get(p.mediaId);
                    const thumb = post?.thumbnail_url ?? post?.media_url;
                    return (
                      <li key={p.mediaId} className="flex items-center gap-3">
                        <span className="w-4 text-xs text-muted">{i + 1}</span>
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element -- Meta CDN thumbnail
                          <img src={thumb} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
                        ) : (
                          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-surface-hover text-[10px] text-muted">{t("Post")}</span>
                        )}
                        <span className="min-w-0 flex-1">
                          {post?.permalink ? (
                            <a href={post.permalink} target="_blank" rel="noreferrer" className="block truncate text-sm hover:underline">
                              {post.caption?.split("\n")[0] || t("Open on Instagram")}
                            </a>
                          ) : (
                            <span className="block truncate font-mono text-xs text-muted">{p.mediaId}</span>
                          )}
                          <span className="text-xs text-muted">{t("{n} people", { n: p.people })}</span>
                        </span>
                        <span className="text-sm font-semibold tabular-nums">{t("{n} DMs", { n: p.dms })}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <Card title={t("Moderation")} csv={exportHref(days, "moderation")}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi label={t("Hidden")} value={report.moderation.hidden} />
              <Kpi label={t("Would hide (test mode)")} value={report.moderation.wouldHide} />
              <Kpi label={t("Restored")} value={report.moderation.restored} />
              <Kpi label={t("Failed")} value={report.moderation.failed} />
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
