"use client";

/**
 * Aba "Funis" do admin (10/10/2026). Em cima, o caminho real do período:
 * comentou → recebeu a DM → clicou → abriu o quiz → viu a oferta → checkout →
 * compra, com a % de cada passagem e o maior vazamento destacado. Embaixo,
 * os modelos de funil com a peça do Lead Engine que monta cada etapa.
 * Só leitura: nada aqui envia, liga ou apaga.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLang, useT } from "@/components/lang-provider";
import { flowApi } from "@/components/flows/flow-shared";
import { funnelApi } from "@/components/funnels/funnel-api";
import { biggestLeak, buildStages, sumQuizzes, type BoardStage } from "@/lib/admin-funnels/board";
import { FUNNEL_TEMPLATES, templateText } from "@/lib/admin-funnels/templates";
import type { FunnelResults, FunnelSummary } from "@/lib/funnels/types";

type ReportFunnel = { funnel: { commented: number; received: number; clicked: number } };
type QuizRow = { id: string; name: string; results: FunnelResults["totals"] };

const PERIODS = [7, 30, 90] as const;

export function FunisBoard() {
  const t = useT();
  const { lang } = useLang();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [report, setReport] = useState<ReportFunnel["funnel"] | null>(null);
  const [quizzes, setQuizzes] = useState<QuizRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(async () => {
      setError(null);
      const [r, list] = await Promise.all([
        flowApi<ReportFunnel>(`/api/reports?days=${days}`),
        funnelApi<FunnelSummary[]>("/api/funnels"),
      ]);
      if (!alive) return;
      if (!r.success || !list.success) {
        setError(t("Could not load the numbers. Try again."));
        setReport(null);
        setQuizzes([]);
        return;
      }
      setReport(r.data.funnel);
      const live = list.data.filter((f) => f.status === "PUBLISHED");
      const rows = await Promise.all(
        live.map(async (f) => {
          const res = await funnelApi<FunnelResults>(`/api/funnels/${encodeURIComponent(f.id)}/results?days=${days}`);
          return res.success ? { id: f.id, name: f.name, results: res.data.totals } : null;
        })
      );
      if (alive) setQuizzes(rows.filter((x): x is QuizRow => x !== null));
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [days, t]);

  const stages = useMemo(() => {
    if (!report || !quizzes) return null;
    const q = sumQuizzes(quizzes.map((x) => x.results));
    return buildStages({ commented: report.commented, received: report.received, clicked: report.clicked, ...q });
  }, [report, quizzes]);
  const leak = stages ? biggestLeak(stages) : null;

  const label: Record<BoardStage["key"], string> = {
    commented: t("People who commented"),
    received: t("Got the DM"),
    clicked: t("Clicked the link"),
    quizVisits: t("Opened the quiz"),
    offerViews: t("Saw the offer"),
    checkouts: t("Clicked checkout"),
    purchases: t("Bought"),
  };

  return (
    <div className="space-y-6">
      <section className="panel space-y-3 rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t("Your funnel today")}</h2>
            <p className="text-xs text-muted">{t("From the comment to the sale, with the real numbers of the period.")}</p>
          </div>
          <div className="flex gap-1" role="group" aria-label={t("Period")}>
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setDays(p)}
                aria-pressed={days === p}
                className={`min-h-11 rounded-lg border px-3 text-sm font-semibold ${days === p ? "border-foreground" : "border-border text-muted hover:text-foreground"}`}
              >
                {t("{n} days", { n: p })}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="rounded-lg bg-error/10 px-3 py-2 text-sm text-error" role="status">{error}</p>}
        {!stages && !error && <p className="text-sm text-muted">{t("Loading…")}</p>}

        {stages && (
          <ol className="space-y-2">
            {stages.map((s) => {
              const isLeak = leak?.key === s.key;
              return (
                <li key={s.key} className={`flex items-baseline justify-between gap-2 rounded-lg px-3 py-2 text-sm ${isLeak ? "bg-error/10" : ""}`}>
                  <span className="min-w-0 truncate">
                    {label[s.key]}
                    {isLeak && <span className="ml-2 text-xs font-semibold text-error">{t("biggest leak")}</span>}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    <span className="font-semibold">{s.count.toLocaleString(lang === "pt" ? "pt-BR" : "en-US")}</span>
                    {s.rateFromPrev !== null && s.key !== "quizVisits" && (
                      <span className="ml-2 text-xs text-muted">{t("{p}% of the previous", { p: s.rateFromPrev })}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        <p className="text-[11px] text-muted">
          {t("Quiz numbers add up the live quizzes. Purchases only count when Hotmart notifies the Lead Engine.")}
        </p>

        {quizzes && quizzes.length > 0 && (
          <div className="space-y-1">
            {quizzes.map((q) => (
              <div key={q.id} className="flex items-baseline justify-between gap-2 text-xs text-muted">
                <Link href={`/quizzes/${q.id}/results`} className="min-w-0 truncate hover:text-foreground">{q.name}</Link>
                <span className="shrink-0 tabular-nums">
                  {t("{v} visits · {c} checkouts · {b} purchases", { v: q.results.visits, c: q.results.checkouts, b: q.results.purchases })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">{t("Funnel models")}</h2>
          <p className="text-xs text-muted">{t("Known strategies, built with the pieces the Lead Engine already has.")}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {FUNNEL_TEMPLATES.map((m) => (
            <article key={m.id} className="panel min-w-0 space-y-3 rounded-2xl p-4">
              <div>
                <h3 className="text-sm font-semibold">{templateText(m.name, lang)}</h3>
                <p className="text-xs text-muted">{templateText(m.goal, lang)}</p>
                <p className="mt-1 text-[11px] text-muted">{t("Fits:")} {templateText(m.fits, lang)}</p>
              </div>
              <ol className="space-y-2">
                {m.steps.map((s, i) => (
                  <li key={i} className="space-y-0.5 text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 font-semibold">{i + 1}. {templateText(s.title, lang)}</span>
                      {s.tool && (
                        <Link href={s.tool.href} className="shrink-0 rounded-lg border border-border px-2 py-0.5 text-xs font-semibold text-muted hover:text-foreground">
                          {templateText(s.tool.label, lang)}
                        </Link>
                      )}
                    </div>
                    <p className="text-xs text-muted">{templateText(s.detail, lang)}</p>
                  </li>
                ))}
              </ol>
              <p className="text-xs"><span className="font-semibold">{t("Watch:")}</span> {templateText(m.watch, lang)}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
