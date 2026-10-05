"use client";

/**
 * Quizzes (Etapa 6): interactive funnels, one screen at a time, ending on the
 * checkout. Each card shows the status, the public link (/q/<slug>), the
 * number of screens and the last 7 days. A quiz is born as a draft and only
 * goes live when someone signed in publishes it in the editor.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTimeAgo } from "@/components/contact-ui";
import { useT } from "@/components/lang-provider";
import { funnelApi, funnelErrorText } from "@/components/funnels/funnel-api";
import { FunnelStatusChip } from "@/components/funnels/status-chip";
import type { FunnelDetail, FunnelSummary } from "@/lib/funnels/types";

export default function QuizzesPage() {
  const t = useT();
  const router = useRouter();
  const timeAgo = useTimeAgo();
  const [funnels, setFunnels] = useState<FunnelSummary[] | null>(null);
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await funnelApi<FunnelSummary[]>(archived ? "/api/funnels?status=ARCHIVED" : "/api/funnels");
    if (r.success) {
      setFunnels(r.data);
      setError(null);
    } else {
      setFunnels([]);
      setError(funnelErrorText(t, r));
    }
  }, [archived, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function duplicate(f: FunnelSummary) {
    setBusyId(f.id);
    const r = await funnelApi<FunnelDetail>(`/api/funnels/${encodeURIComponent(f.id)}/duplicate`, { method: "POST", json: {} });
    setBusyId(null);
    if (!r.success) return setError(funnelErrorText(t, r));
    router.push(`/quizzes/${r.data.id}`);
  }

  async function copy(f: FunnelSummary) {
    const url = `${window.location.origin}${f.publicPath || `/q/${f.slug}`}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(f.id);
      window.setTimeout(() => setCopiedId((c) => (c === f.id ? null : c)), 1500);
    } catch {
      window.prompt(t("Copy the link"), url);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{t("Quizzes")}</h2>
          <p className="max-w-2xl text-sm text-muted">
            {t("Interactive pages, one screen at a time, that warm up who comes from a Reel or an ad and lead to the checkout. Every quiz starts as a draft; it only goes live when you publish it.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} className="h-4 w-4 accent-[#0095f6]" />
            {t("Show archived")}
          </label>
          <Link href="/quizzes/new" className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover">
            {t("New quiz")}
          </Link>
        </div>
      </div>

      {error && <p className="rounded-xl bg-error/10 px-4 py-2.5 text-sm text-error">{error}</p>}

      {funnels === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="panel h-24 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : funnels.length === 0 ? (
        <div className="panel space-y-3 rounded-2xl p-8 text-center">
          <p className="text-sm font-semibold">{archived ? t("No archived quizzes") : t("No quizzes yet")}</p>
          {!archived && (
            <>
              <p className="mx-auto max-w-md text-sm text-muted">
                {t("Start with the “Yes ladder + video offer” template: 6 screens with one button each and the video offer with the checkout on the last one.")}
              </p>
              <div className="flex justify-center gap-2">
                <Link
                  href="/quizzes/new?template=escada-sim-vsl"
                  className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover"
                >
                  {t("Use this template")}
                </Link>
                <Link href="/quizzes/new" className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-semibold hover:bg-surface-hover">
                  {t("See all templates")}
                </Link>
              </div>
            </>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {funnels.map((f) => {
            const path = f.publicPath || `/q/${f.slug}`;
            const live = f.status === "PUBLISHED";
            return (
              <li key={f.id} className="panel flex flex-col gap-3 rounded-2xl p-4 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1 space-y-1">
                  <Link href={`/quizzes/${f.id}`} className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold hover:underline">{f.name}</span>
                    <FunnelStatusChip status={f.status} unpublished={f.hasUnpublishedChanges} />
                  </Link>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted">
                    <code className="truncate">{path}</code>
                    <button type="button" onClick={() => void copy(f)} className="min-h-8 font-semibold text-accent">
                      {copiedId === f.id ? t("Copied") : t("Copy link")}
                    </button>
                  </span>
                  <span className="block text-xs text-muted">
                    {t("{n} screens", { n: f.stepCount })} · {t("edited {when}", { when: timeAgo(f.updatedAt) })}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <Count label={t("Visits 7d")} value={f.stats.visits7d} />
                  <Count label={t("Checkouts 7d")} value={f.stats.checkouts7d} />
                  <Count label={t("Leads 7d")} value={f.stats.leads7d} />
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Link href={`/quizzes/${f.id}`} className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm font-semibold hover:bg-surface-hover">
                    {t("Edit")}
                  </Link>
                  <Link href={`/quizzes/${f.id}/results`} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold hover:bg-surface-hover">
                    {t("Results")}
                  </Link>
                  <button
                    type="button"
                    onClick={() => void duplicate(f)}
                    disabled={busyId === f.id}
                    className="min-h-11 rounded-lg px-3 text-sm font-semibold hover:bg-surface-hover disabled:opacity-50"
                  >
                    {busyId === f.id ? t("Duplicating…") : t("Duplicate")}
                  </button>
                  {live && (
                    <a href={path} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-accent hover:bg-surface-hover">
                      {t("Open page")}
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-16">
      <p className="text-base font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted">{label}</p>
    </div>
  );
}
