"use client";

import { useT } from "@/components/lang-provider";
import type { CountdownBlock } from "@/lib/funnels/types";
import { borderColor, type PlayerCtx } from "@/components/funnels/blocks/shared";

/** Real deadline only. When it reaches zero the block is gone (no fake per-visit timer exists). */
export default function CountdownView({ block, ctx }: { block: CountdownBlock; ctx: PlayerCtx }) {
  const t = useT();
  const end = Date.parse(block.deadline);
  if (!Number.isFinite(end)) return null;
  const left = Math.floor((end - ctx.now) / 1000);
  if (left <= 0) return null;
  const parts = [
    { n: Math.floor(left / 86400), label: t("days") },
    { n: Math.floor((left % 86400) / 3600), label: t("hours") },
    { n: Math.floor((left % 3600) / 60), label: t("min") },
    { n: left % 60, label: t("sec") },
  ];
  return (
    <div className="space-y-2 text-center">
      <p className="text-sm font-semibold">{block.label}</p>
      <div className="flex justify-center gap-2" role="timer" aria-live="off">
        {parts.map((p) => (
          <span key={p.label} className="min-w-14 px-2 py-1.5" style={{ borderRadius: "var(--fq-radius)", border: `1px solid ${borderColor}` }}>
            <span className="block text-xl font-bold tabular-nums">{String(p.n).padStart(2, "0")}</span>
            <span className="block text-xs">{p.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
