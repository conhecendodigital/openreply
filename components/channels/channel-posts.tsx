"use client";

/** Posts agendados e recentes de um canal, com o link para a aba Posts. */

import Link from "next/link";
import { useLang, useT } from "@/components/lang-provider";
import type { PostDTO, PostStatus } from "@/lib/tiktok-composer";

const STATUS_LABEL: Record<PostStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  PUBLISHING: "Publishing",
  PUBLISHED: "Published",
  FAILED: "Failed",
  CANCELED: "Canceled",
};

export function ChannelPosts({ posts, loading }: { posts: PostDTO[]; loading: boolean }) {
  const t = useT();
  const { lang } = useLang();
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
  const shown = [...posts]
    .sort((a, b) => (b.scheduledAt ?? b.updatedAt).localeCompare(a.scheduledAt ?? a.updatedAt))
    .slice(0, 8);

  return (
    <section aria-label={t("Posts of this channel")} className="panel space-y-3 rounded-xl p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{t("Posts of this channel")}</h2>
        <Link href="/posts" className="text-sm font-semibold text-accent hover:underline">
          {t("Open Posts")}
        </Link>
      </div>
      {loading ? (
        <div className="h-16 animate-pulse rounded-lg bg-surface-hover" />
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted">{t("No posts for this channel yet.")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{p.caption || <span className="text-muted">{t("No caption")}</span>}</span>
              <span className="shrink-0 text-xs text-muted">
                {t(STATUS_LABEL[p.status])}
                {p.scheduledAt || p.publishedAt ? ` · ${when(p.publishedAt ?? p.scheduledAt)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
