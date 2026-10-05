"use client";

/** Etapa 6 (Quiz): status of a funnel (Draft / Live / Archived) and "Unpublished changes". */

import { useT } from "@/components/lang-provider";
import type { FunnelStatus } from "@/lib/funnels/types";

export function FunnelStatusChip({ status, unpublished }: { status: FunnelStatus; unpublished?: boolean }) {
  const t = useT();
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {status === "PUBLISHED" ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-semibold text-[#2f6f0e]">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#3a8a12]" />
          {t("On the air")}
        </span>
      ) : status === "ARCHIVED" ? (
        <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-semibold text-muted">{t("Archived")}</span>
      ) : (
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">{t("Draft")}</span>
      )}
      {status === "PUBLISHED" && unpublished && (
        <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-[#8a560c]">{t("Unpublished changes")}</span>
      )}
    </span>
  );
}
