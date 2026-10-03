"use client";

/**
 * Approvals (2026-10-04, Etapa 2)
 *
 * Every reply the AI (vendedor) proposed and is waiting for a human: who it is,
 * what they wrote, the proposed text (editable), approve and send or discard.
 * A second tab keeps the history (sent, discarded, expired, failed) with who
 * approved and when. Owner's rule: nothing here is sent without your click.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ContactAvatar, contactDisplayName, inboxHref, TagChip, useDateTime, useTimeAgo } from "@/components/contact-ui";
import { useT } from "@/components/lang-provider";
import {
  DRAFT_STATUS_COLORS,
  DRAFT_STATUS_LABELS,
  DraftCard,
  TakeoverChip,
  type Draft,
} from "@/components/messaging-ui";

const POLL_MS = 20_000;
type Tab = "pending" | "history";

function LastMessages({ draft }: { draft: Draft }) {
  const t = useT();
  const timeAgo = useTimeAgo();
  const msgs = draft.contact.lastMessages;
  if (msgs.length === 0) return <p className="text-xs text-muted">{t("No saved messages yet.")}</p>;
  return (
    <div className="space-y-1.5">
      {msgs.map((m) => (
        <div key={m.mid} className={`flex flex-col ${m.fromMe ? "items-end" : "items-start"}`}>
          <p
            className={`max-w-[85%] whitespace-pre-wrap break-words rounded-3xl px-3.5 py-1.5 text-sm ${
              m.fromMe ? "bg-surface-hover text-foreground" : "border border-border bg-surface text-foreground"
            }`}
          >
            {m.storyReply && <span className="mr-1 text-[11px] text-muted">{t("(story reply)")}</span>}
            {m.text || <span className="italic text-muted">{t("(no text)")}</span>}
          </p>
          <span className="px-2 text-[10px] text-muted">{timeAgo(m.sentAt)}</span>
        </div>
      ))}
    </div>
  );
}

export default function ApprovalsPage() {
  const t = useT();
  const timeAgo = useTimeAgo();
  const dateTime = useDateTime();
  const [tab, setTab] = useState<Tab>("pending");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await fetch(`/api/drafts?status=${tab === "pending" ? "PENDING" : "all"}&limit=100`, {
          cache: "no-store",
        });
        const payload = await res.json();
        if (payload.success) {
          const rows = payload.data.drafts as Draft[];
          setDrafts(tab === "pending" ? rows : rows.filter((d) => d.status !== "PENDING"));
          setTotal(tab === "pending" ? payload.data.total : rows.filter((d) => d.status !== "PENDING").length);
          setError(null);
        } else if (!silent) {
          setError(payload.error ?? "Failed to load drafts");
        }
      } catch {
        if (!silent) setError("Failed to load drafts");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [tab]
  );

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(true), POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load]);

  function handleDone(result: { id: string; status: string; message?: string }) {
    setDrafts((prev) => prev.filter((d) => d.id !== result.id));
    setTotal((n) => Math.max(0, n - 1));
    setNotice(
      result.message
        ? t(result.message)
        : result.status === "SENT"
          ? t("Draft approved and sent.")
          : t("Draft discarded. Nothing was sent.")
    );
    window.setTimeout(() => setNotice(null), 5000);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">{t("Approvals")}</h2>
        <p className="text-sm text-muted">
          {t("Replies the AI proposed. Nothing is sent until you approve. You can edit the text first.")}
        </p>
      </div>

      {/* Tabs, Instagram profile style */}
      <div className="flex justify-center gap-10 border-t border-border">
        {(["pending", "history"] as Tab[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            aria-pressed={tab === k}
            className={`-mt-px border-t py-3 text-xs font-semibold uppercase tracking-widest ${
              tab === k ? "border-foreground text-foreground" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {k === "pending" ? t("Waiting") : t("History")}
            {k === "pending" && tab === "pending" && total > 0 && <span className="ml-1.5">({total})</span>}
          </button>
        ))}
      </div>

      {notice && <p className="panel rounded-xl px-4 py-2 text-sm">{notice}</p>}

      {loading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="panel h-40 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <p className="panel rounded-2xl px-4 py-8 text-center text-sm text-error">{t(error)}</p>
      ) : drafts.length === 0 ? (
        <div className="panel rounded-2xl px-4 py-12 text-center">
          <p className="text-sm font-semibold">{tab === "pending" ? t("All caught up") : t("No history yet")}</p>
          <p className="mt-1 text-sm text-muted">
            {tab === "pending"
              ? t("When the AI proposes a reply, it shows up here and in the Direct.")
              : t("Approved, discarded and expired drafts show up here.")}
          </p>
        </div>
      ) : tab === "pending" ? (
        <ul className="space-y-4">
          {drafts.map((d) => (
            <li key={d.id} className="panel space-y-3 rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <ContactAvatar username={d.contact.username} name={d.contact.name} src={d.contact.profilePicUrl} size={40} />
                <div className="min-w-0 flex-1">
                  <Link href={`/contacts/${d.contact.id}`} className="block truncate text-sm font-semibold hover:underline">
                    {contactDisplayName(t, d.contact)}
                  </Link>
                  {d.contact.username && d.contact.name && <p className="truncate text-xs text-muted">{d.contact.name}</p>}
                </div>
                <TakeoverChip takeover={d.contact.takeover} />
                <Link
                  href={inboxHref(d.instagramAccountId, d.contact.igUserId)}
                  className="shrink-0 rounded-lg bg-surface-hover px-3 py-1 text-xs font-semibold hover:bg-border"
                >
                  {t("Open in Direct")}
                </Link>
              </div>
              {d.contact.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {d.contact.tags.slice(0, 8).map((tg) => (
                    <TagChip key={tg} name={tg} />
                  ))}
                </div>
              )}
              <div className="rounded-xl bg-background p-1">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{t("Received")}</p>
                <LastMessages draft={d} />
              </div>
              <DraftCard draft={d} onDone={handleDone} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="panel divide-y divide-border overflow-hidden rounded-2xl">
          {drafts.map((d) => (
            <li key={d.id} className="flex gap-3 px-4 py-3">
              <ContactAvatar username={d.contact.username} name={d.contact.name} src={d.contact.profilePicUrl} size={36} />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-baseline justify-between gap-3">
                  <Link href={`/contacts/${d.contact.id}`} className="truncate text-sm font-semibold hover:underline">
                    {contactDisplayName(t, d.contact)}
                  </Link>
                  <span className={`shrink-0 text-xs font-semibold ${DRAFT_STATUS_COLORS[d.status]}`}>
                    {t(DRAFT_STATUS_LABELS[d.status])}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm">{d.text}</p>
                <p className="text-xs text-muted" title={dateTime(d.sentAt ?? d.approvedAt ?? d.updatedAt)}>
                  {d.status === "SENT" || d.status === "APPROVED"
                    ? d.approvedVia === "mcp"
                      ? t("Approved by {who} via API key · {time}", {
                          who: d.approvedBy ?? "?",
                          time: timeAgo(d.sentAt ?? d.approvedAt),
                        })
                      : t("Approved by you in the Lead Engine · {time}", { time: timeAgo(d.sentAt ?? d.approvedAt) })
                    : timeAgo(d.updatedAt)}
                  {d.editedAt && <span> · {t("edited")}</span>}
                </p>
                {d.error && <p className="text-xs text-error">{d.error}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
