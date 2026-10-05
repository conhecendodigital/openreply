"use client";

/**
 * Etapa 6 (Quiz): results of a funnel, /quizzes/[id]/results.
 * Period 7/30/90 days and source filter (utm_source). Totals, visits per
 * screen with the drop-off from the previous one (the biggest drop is
 * highlighted), answers per question, sources and the leads (signed in only,
 * with CSV download). Purchases only come from the Hotmart webhook.
 * Bars are plain CSS (no chart library).
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useDateTime } from "@/components/contact-ui";
import { useT } from "@/components/lang-provider";
import type { FunnelDetail, FunnelLeadsPage, FunnelResults } from "@/lib/funnels/types";
import { funnelApi, funnelErrorText } from "@/components/funnels/funnel-api";
import { FunnelStatusChip } from "@/components/funnels/status-chip";

const DAYS = [7, 30, 90] as const;
const pct = (n: number) => `${Number.isFinite(n) ? n.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : "0"}%`;

export default function ResultsView({ funnelId }: { funnelId: string }) {
  const t = useT();
  const dateTime = useDateTime();
  const [meta, setMeta] = useState<FunnelDetail | null>(null);
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [source, setSource] = useState("");
  const [results, setResults] = useState<FunnelResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leads, setLeads] = useState<FunnelLeadsPage | null>(null);
  const [leadsError, setLeadsError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const enc = encodeURIComponent(funnelId);

  useEffect(() => {
    let alive = true;
    void funnelApi<FunnelDetail>(`/api/funnels/${enc}`).then((r) => {
      if (!alive) return;
      if (r.success) setMeta(r.data);
      else setError(funnelErrorText(t, r));
    });
    return () => {
      alive = false;
    };
  }, [enc, t]);

  const loadResults = useCallback(async () => {
    const q = new URLSearchParams({ days: String(days) });
    if (source) q.set("source", source);
    const r = await funnelApi<FunnelResults>(`/api/funnels/${enc}/results?${q}`);
    if (r.success) {
      setResults(r.data);
      setError(null);
    } else setError(funnelErrorText(t, r));
  }, [enc, days, source, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadResults(), 0);
    return () => window.clearTimeout(timer);
  }, [loadResults]);

  const loadLeads = useCallback(
    async (cursor: string | null) => {
      const q = new URLSearchParams({ limit: "50" });
      if (cursor) q.set("cursor", cursor);
      const r = await funnelApi<FunnelLeadsPage>(`/api/funnels/${enc}/leads?${q}`);
      if (r.success) {
        setLeads((prev) => (cursor && prev ? { ...r.data, rows: [...prev.rows, ...r.data.rows] } : r.data));
        setLeadsError(null);
      } else setLeadsError(funnelErrorText(t, r));
    },
    [enc, t]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void loadLeads(null), 0);
    return () => window.clearTimeout(timer);
  }, [loadLeads]);

  const totals = results?.totals;
  const steps = results?.steps ?? [];
  const biggestDrop = steps.slice(1).reduce<{ id: string | null; drop: number }>(
    (best, s) => (s.dropFromPrev > best.drop ? { id: s.stepId, drop: s.dropFromPrev } : best),
    { id: null, drop: 0 }
  );
  const maxViews = Math.max(1, ...steps.map((s) => s.views));
  const answerColumns = leads ? Array.from(new Set(leads.rows.flatMap((r) => Object.keys(r.answers)))) : [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <Link href={`/quizzes/${funnelId}`} className="inline-flex min-h-11 items-center text-sm text-muted hover:text-foreground">
          {t("← Back to the editor")}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">{t("Results")}</h2>
          {meta && (
            <>
              <span className="text-xl text-muted">·</span>
              <span className="text-xl font-semibold">{meta.name}</span>
              <FunnelStatusChip status={meta.status} unpublished={meta.hasUnpublishedChanges} />
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="inline-flex rounded-lg border border-border p-0.5 text-sm font-semibold" role="group" aria-label={t("Period")}>
          {DAYS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={`min-h-10 rounded-md px-3 ${days === d ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`}
            >
              {t("{n} days", { n: d })}
            </button>
          ))}
        </div>
        <label className="space-y-1 text-xs font-semibold">
          <span className="block">{t("Source")}</span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm font-normal outline-none focus:border-border-hover"
          >
            <option value="">{t("All sources")}</option>
            {(results?.sources ?? []).map((s) => (
              <option key={s.source} value={s.source}>
                {s.source === "direto" ? t("Direct (no UTM)") : s.source}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="rounded-xl bg-error/10 px-4 py-2.5 text-sm text-error">{error}</p>}

      {!results ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="panel h-20 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <Stat label={t("Visitors")} value={totals!.visits} />
            <Stat label={t("Started")} value={totals!.started} />
            <Stat label={t("Reached the end")} value={totals!.completed} />
            <Stat label={t("Checkout clicks")} value={totals!.checkouts} />
            <Stat label={t("Leads")} value={totals!.leads} />
            <Stat label={t("Purchases")} value={totals!.purchases} />
            <Stat label={t("Refunds")} value={totals!.refunds} />
          </div>
          <p className="text-xs text-muted">{t("Purchases and refunds come from the Hotmart webhook, never from the browser.")}</p>

          <section className="panel space-y-3 rounded-2xl p-4">
            <h3 className="text-sm font-semibold">{t("Funnel by screen")}</h3>
            {steps.length === 0 ? (
              <p className="text-sm text-muted">{t("No visits in this period yet.")}</p>
            ) : (
              <ol className="space-y-3">
                {steps.map((s) => {
                  const worst = s.stepId === biggestDrop.id && biggestDrop.drop > 0;
                  return (
                    <li key={s.stepId} className="space-y-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate font-semibold">
                          {s.index + 1}. {s.title || t("Untitled screen")}
                        </span>
                        <span className="text-xs text-muted">
                          {t("{n} visits", { n: s.views })} · {t("{p} of the start", { p: pct(s.pctOfFirst) })}
                          {s.index > 0 && (
                            <>
                              {" · "}
                              <span className={worst ? "font-semibold text-error" : ""}>{t("{p} left here", { p: pct(s.dropFromPrev) })}</span>
                            </>
                          )}
                        </span>
                      </div>
                      <div className="h-3 overflow-hidden rounded-full bg-surface-hover">
                        <div className={`h-full rounded-full ${worst ? "bg-error" : "bg-accent"}`} style={{ width: `${(s.views / maxViews) * 100}%` }} />
                      </div>
                      {worst && <p className="text-xs font-semibold text-error">{t("Biggest drop: start improving here.")}</p>}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {results.answers.length > 0 && (
            <section className="panel space-y-4 rounded-2xl p-4">
              <h3 className="text-sm font-semibold">{t("Answers")}</h3>
              {results.answers.map((q) => {
                const total = q.options.reduce((a, o) => a + o.count, 0);
                return (
                  <div key={q.name} className="space-y-2">
                    <p className="text-sm font-semibold">{q.question || q.name}</p>
                    <ul className="space-y-1.5">
                      {q.options.map((o) => {
                        const share = total ? (o.count / total) * 100 : 0;
                        return (
                          <li key={o.id} className="space-y-0.5">
                            <div className="flex justify-between gap-2 text-xs">
                              <span className="min-w-0 truncate">{o.label}</span>
                              <span className="shrink-0 text-muted">
                                {o.count} · {pct(Math.round(share * 10) / 10)}
                              </span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-surface-hover">
                              <div className="h-full rounded-full bg-accent" style={{ width: `${share}%` }} />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </section>
          )}

          {results.sources.length > 0 && (
            <section className="panel space-y-3 rounded-2xl p-4">
              <h3 className="text-sm font-semibold">{t("Sources")}</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[22rem] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="py-1.5 pr-3 font-semibold">{t("Source")}</th>
                      <th className="py-1.5 pr-3 text-right font-semibold">{t("Visitors")}</th>
                      <th className="py-1.5 pr-3 text-right font-semibold">{t("Checkout clicks")}</th>
                      <th className="py-1.5 text-right font-semibold">{t("Purchases")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.sources.map((s) => (
                      <tr key={s.source} className="border-t border-border">
                        <td className="py-2 pr-3">{s.source === "direto" ? t("Direct (no UTM)") : s.source}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{s.visits}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{s.checkouts}</td>
                        <td className="py-2 text-right tabular-nums">{s.purchases}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      <section className="panel space-y-3 rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {t("Leads")}
            {leads ? ` (${leads.total})` : ""}
          </h3>
          {leads && leads.total > 0 && (
            <a href={`/api/funnels/${enc}/leads/export`} className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm font-semibold hover:bg-surface-hover">
              {t("Download CSV")}
            </a>
          )}
        </div>
        {leadsError && <p className="text-sm text-error">{leadsError}</p>}
        {!leads ? (
          <div className="h-16 animate-pulse rounded-xl bg-surface-hover" />
        ) : leads.rows.length === 0 ? (
          <p className="text-sm text-muted">{t("No leads yet. Leads only appear when a screen has data fields.")}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-1.5 pr-3 font-semibold">{t("Date")}</th>
                    <th className="py-1.5 pr-3 font-semibold">{t("Name")}</th>
                    <th className="py-1.5 pr-3 font-semibold">{t("Email")}</th>
                    <th className="py-1.5 pr-3 font-semibold">{t("WhatsApp")}</th>
                    <th className="py-1.5 pr-3 font-semibold">{t("Source")}</th>
                    {answerColumns.map((c) => (
                      <th key={c} className="py-1.5 pr-3 font-semibold">
                        {c}
                      </th>
                    ))}
                    <th className="py-1.5 font-semibold">{t("Bought")}</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.rows.map((row) => (
                    <tr key={row.id} className="border-t border-border align-top">
                      <td className="whitespace-nowrap py-2 pr-3 text-xs text-muted">{dateTime(row.createdAt)}</td>
                      <td className="py-2 pr-3">
                        {row.contactId ? (
                          <Link href={`/contacts/${row.contactId}`} className="font-semibold text-accent">
                            {row.name || (row.contactUsername ? `@${row.contactUsername}` : t("Contact"))}
                          </Link>
                        ) : (
                          row.name || "·"
                        )}
                      </td>
                      <td className="py-2 pr-3">{row.email || "·"}</td>
                      <td className="py-2 pr-3">{row.whatsapp || "·"}</td>
                      <td className="py-2 pr-3">{row.source || "·"}</td>
                      {answerColumns.map((c) => (
                        <td key={c} className="py-2 pr-3">
                          {row.answers[c] || "·"}
                        </td>
                      ))}
                      <td className="py-2">{row.purchasedAt ? t("Yes") : t("No")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {leads.nextCursor && (
              <button
                type="button"
                disabled={loadingMore}
                onClick={async () => {
                  setLoadingMore(true);
                  await loadLeads(leads.nextCursor);
                  setLoadingMore(false);
                }}
                className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-surface-hover disabled:opacity-50"
              >
                {loadingMore ? t("Loading…") : t("Load more")}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="panel rounded-2xl p-3">
      <p className="text-2xl font-semibold tabular-nums">{value.toLocaleString("pt-BR")}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}
