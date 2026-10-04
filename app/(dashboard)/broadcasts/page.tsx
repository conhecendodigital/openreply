"use client";

/**
 * Broadcasts (Etapa 5, 2026-10-08): one message to a segment, in batches.
 * Instagram's rule: only people who wrote to the account in the last 24 hours
 * receive it, so each row shows "X in the segment, Y reached".
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/lang-provider";
import { useDateTime, useTimeAgo } from "@/components/contact-ui";
import { flowApi } from "@/components/flows/flow-shared";
import { apiErrorText } from "@/components/segment-builder";
import { BroadcastStatusChip, type Broadcast, type BroadcastStatus } from "@/components/broadcast-ui";

const FILTERS: ("" | BroadcastStatus)[] = ["", "DRAFT", "SCHEDULED", "SENDING", "DONE", "CANCELED"];
const FILTER_LABEL: Record<string, string> = {
  "": "All",
  DRAFT: "Drafts",
  SCHEDULED: "Scheduled",
  SENDING: "Sending",
  DONE: "Completed",
  CANCELED: "Canceled",
};

export default function BroadcastsPage() {
  const t = useT();
  const timeAgo = useTimeAgo();
  const dateTime = useDateTime();
  const [status, setStatus] = useState<"" | BroadcastStatus>("");
  const [rows, setRows] = useState<Broadcast[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await flowApi<Broadcast[]>(`/api/broadcasts${status ? `?status=${status}` : ""}`);
    if (r.success) {
      setRows(r.data);
      setError(null);
    } else {
      setRows([]);
      setError(apiErrorText(t, r));
    }
  }, [status, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Keep the numbers of running broadcasts fresh.
  const running = rows?.some((b) => b.status === "SENDING" || b.status === "SCHEDULED") ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(timer);
  }, [running, load]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{t("Broadcasts")}</h2>
          <p className="max-w-2xl text-sm text-muted">
            {t("Send one message to a segment. Instagram only allows it for people who wrote to you in the last 24 hours, so only they receive it. Whoever writes PARAR or SAIR leaves every future broadcast.")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/segments" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-surface-hover">
            {t("Segments")}
          </Link>
          <Link href="/broadcasts/new" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">
            {t("New broadcast")}
          </Link>
        </div>
      </div>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f || "all"}
            type="button"
            onClick={() => setStatus(f)}
            aria-pressed={status === f}
            className={`shrink-0 rounded-full border px-3 py-1 text-sm ${
              status === f ? "border-foreground bg-foreground text-background" : "border-border text-muted hover:text-foreground"
            }`}
          >
            {t(FILTER_LABEL[f])}
          </button>
        ))}
      </div>

      {error && <p className="rounded-xl bg-error/10 px-4 py-2.5 text-sm text-error">{error}</p>}

      {rows === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="panel h-20 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="panel space-y-3 rounded-2xl p-8 text-center">
          <p className="text-sm font-semibold">{status ? t("Nothing here.") : t("No broadcasts yet")}</p>
          <p className="mx-auto max-w-md text-sm text-muted">
            {t("Make a segment, write the message and send it to whoever has the conversation open. A broadcast made by the AI arrives here as a draft for you to review.")}
          </p>
          <Link href="/broadcasts/new" className="inline-block rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">
            {t("New broadcast")}
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((b) => {
            const when =
              b.status === "SCHEDULED" && b.scheduledAt
                ? t("for {when}", { when: dateTime(b.scheduledAt) })
                : b.finishedAt
                  ? t("finished {when}", { when: timeAgo(b.finishedAt) })
                  : t("edited {when}", { when: timeAgo(b.updatedAt) });
            return (
              <li key={b.id}>
                <Link href={`/broadcasts/${b.id}`} className="panel flex flex-col gap-3 rounded-2xl p-4 hover:border-border-hover sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1 space-y-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold">{b.name}</span>
                      <BroadcastStatusChip status={b.status} />
                      {b.variants.length >= 2 && (
                        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">A/B</span>
                      )}
                      {b.createdVia === "mcp" && b.status === "DRAFT" && (
                        <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-[#8a560c]">{t("made by the AI")}</span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted">{b.text}</span>
                    <span className="block text-xs text-muted">
                      {b.account ? `@${b.account.username} · ` : ""}
                      {b.segmentName ? `${b.segmentName} · ` : ""}
                      {when}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="min-w-14">
                      <p className="text-base font-semibold tabular-nums">{b.counts.segment ?? "–"}</p>
                      <p className="text-[11px] text-muted">{t("In the segment")}</p>
                    </div>
                    <div className="min-w-14">
                      <p className="text-base font-semibold tabular-nums">{b.counts.eligible ?? "–"}</p>
                      <p className="text-[11px] text-muted">{t("Open")}</p>
                    </div>
                    <div className="min-w-14">
                      <p className="text-base font-semibold tabular-nums text-[#3a8a12]">{b.counts.sent}</p>
                      <p className="text-[11px] text-muted">{t("Sent")}</p>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
