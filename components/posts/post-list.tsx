"use client";

/** Lista de posts por status, com as ações que cada status permite. */

import { useState } from "react";
import { useLang, useT } from "@/components/lang-provider";
import { callApi } from "@/components/posts/api";
import { btnDanger, btnPrimary, btnSecondary } from "@/components/posts/accounts-bar";
import { PRIVACY_LABELS, type PostDTO, type PostStatus } from "@/lib/tiktok-composer";

const GROUPS: { status: PostStatus; title: string; tone: string }[] = [
  { status: "SCHEDULED", title: "Scheduled", tone: "bg-accent/10 text-accent" },
  { status: "PUBLISHING", title: "Publishing", tone: "bg-warning/10 text-warning" },
  { status: "DRAFT", title: "Draft", tone: "bg-surface-hover text-muted" },
  { status: "FAILED", title: "Failed", tone: "bg-error/10 text-error" },
  { status: "PUBLISHED", title: "Published", tone: "bg-success/10 text-success" },
  { status: "CANCELED", title: "Canceled", tone: "bg-surface-hover text-muted" },
];

const small = "px-3 py-1.5 text-xs";

export function PostList({
  posts,
  loading,
  error,
  onEdit,
  onChanged,
}: {
  posts: PostDTO[];
  loading: boolean;
  error: boolean;
  onEdit: (post: PostDTO, mode: "draft" | "schedule") => void;
  onChanged: () => Promise<void> | void;
}) {
  const t = useT();
  const { lang } = useLang();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; kind: "publish" | "delete" } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const when = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(lang === "pt" ? "pt-BR" : "en", {
          timeZone: "America/Sao_Paulo",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

  async function run(id: string, path: string, init: RequestInit) {
    setBusy(id);
    setMessage(null);
    const res = await callApi(path, init);
    setBusy(null);
    setConfirm(null);
    if (!res.ok) setMessage(t("That did not work. Try again in a moment."));
    await onChanged();
  }

  if (loading) return <div className="panel h-40 animate-pulse rounded-xl border border-border" />;
  if (error) {
    return (
      <div className="rounded-xl border border-error/20 bg-error/10 p-4 text-sm text-error">
        {t("Could not load the posts. Try again in a moment.")}
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="panel rounded-xl border border-border p-6">
        <p className="text-sm font-semibold">{t("No posts yet")}</p>
        <ol className="mt-3 space-y-2 text-sm text-muted">
          <li>1. {t("Connect your TikTok account.")}</li>
          <li>2. {t("Click New post and add your video.")}</li>
          <li>3. {t("Schedule it or publish now.")}</li>
        </ol>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {message && <p className="rounded-xl bg-error/10 px-4 py-2.5 text-sm text-error">{message}</p>}
      {GROUPS.map((g) => {
        const items = posts
          .filter((p) => p.status === g.status)
          .sort((a, b) => (a.scheduledAt ?? a.updatedAt).localeCompare(b.scheduledAt ?? b.updatedAt) * (g.status === "SCHEDULED" ? 1 : -1));
        if (items.length === 0) return null;
        return (
          <section key={g.status} aria-label={t(g.title)} className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              {t(g.title)}
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${g.tone}`}>{items.length}</span>
            </h3>
            <div className="space-y-3">
              {items.map((p) => {
                const editable = p.status === "DRAFT" || p.status === "SCHEDULED" || p.status === "FAILED";
                const canPublish = editable;
                const canSchedule = p.status === "DRAFT" || p.status === "FAILED";
                const canDelete = p.status !== "PUBLISHING";
                const dateText =
                  p.status === "PUBLISHED" ? when(p.publishedAt) : p.scheduledAt ? when(p.scheduledAt) : "";
                const asking = confirm?.id === p.id ? confirm.kind : null;
                return (
                  <article key={p.id} className="panel flex flex-wrap gap-4 rounded-xl border border-border p-4">
                    <video
                      src={p.mediaUrl ? `${p.mediaUrl}#t=0.1` : undefined}
                      preload="metadata"
                      muted
                      playsInline
                      aria-hidden
                      className="h-24 w-[54px] shrink-0 rounded-lg bg-surface-hover object-cover"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="line-clamp-2 break-words text-sm font-medium">
                        {p.caption || <span className="text-muted">{t("No caption")}</span>}
                      </p>
                      <p className="text-xs text-muted">
                        TikTok · {p.accountName}
                        {p.settings?.privacyLevel && PRIVACY_LABELS[p.settings.privacyLevel]
                          ? ` · ${t(PRIVACY_LABELS[p.settings.privacyLevel])}`
                          : ""}
                        {dateText ? ` · ${dateText}` : ""}
                      </p>
                      {p.createdVia !== "UI" && (
                        <p className="text-xs text-muted">{t("Created by the assistant. Review it before scheduling.")}</p>
                      )}
                      {p.lastError && p.status === "FAILED" && (
                        <p className="break-words text-xs text-error">{p.lastError}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-start gap-2">
                      {asking === "publish" ? (
                        <>
                          <button
                            type="button"
                            disabled={busy === p.id}
                            onClick={() => void run(p.id, `/api/posts/${p.id}/publish`, { method: "POST" })}
                            className={`${btnPrimary} ${small}`}
                          >
                            {t("Yes, publish now")}
                          </button>
                          <button type="button" onClick={() => setConfirm(null)} className={`${btnSecondary} ${small}`}>
                            {t("Cancel")}
                          </button>
                        </>
                      ) : asking === "delete" ? (
                        <>
                          <button
                            type="button"
                            disabled={busy === p.id}
                            onClick={() => void run(p.id, `/api/posts/${p.id}`, { method: "DELETE" })}
                            className={`${btnDanger} ${small}`}
                          >
                            {t("Yes, delete")}
                          </button>
                          <button type="button" onClick={() => setConfirm(null)} className={`${btnSecondary} ${small}`}>
                            {t("Cancel")}
                          </button>
                        </>
                      ) : (
                        <>
                          {editable && (
                            <button type="button" onClick={() => onEdit(p, "draft")} className={`${btnSecondary} ${small}`}>
                              {t("Edit")}
                            </button>
                          )}
                          {canSchedule && (
                            <button type="button" onClick={() => onEdit(p, "schedule")} className={`${btnSecondary} ${small}`}>
                              {t("Schedule")}
                            </button>
                          )}
                          {canPublish && (
                            <button
                              type="button"
                              onClick={() => setConfirm({ id: p.id, kind: "publish" })}
                              className={`${btnPrimary} ${small}`}
                            >
                              {t("Publish now")}
                            </button>
                          )}
                          {p.status === "SCHEDULED" && (
                            <button
                              type="button"
                              disabled={busy === p.id}
                              onClick={() => void run(p.id, `/api/posts/${p.id}/cancel`, { method: "POST" })}
                              className={`${btnSecondary} ${small}`}
                            >
                              {t("Cancel schedule")}
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => setConfirm({ id: p.id, kind: "delete" })}
                              className={`${btnDanger} ${small}`}
                            >
                              {t("Delete")}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
