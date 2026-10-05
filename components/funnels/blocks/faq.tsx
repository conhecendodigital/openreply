"use client";

import { useT } from "@/components/lang-provider";
import type { FaqBlock } from "@/lib/funnels/types";
import { RichText, borderColor, type PlayerCtx } from "@/components/funnels/blocks/shared";

export default function FaqView({ block, ctx }: { block: FaqBlock; ctx: PlayerCtx }) {
  const t = useT();
  if (!block.items.length) return null;
  return (
    <section className="space-y-2 text-left" aria-label={t("Questions")}>
      {block.items.map((item, i) => (
        <details key={i} className="group" style={{ borderRadius: "var(--fq-radius)", border: `1px solid ${borderColor}` }}>
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[16px] font-semibold [&::-webkit-details-marker]:hidden">
            <span>{item.q}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform duration-150 group-open:rotate-180">
              <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <RichText text={item.a} labels={ctx.labels} className="px-4 pb-4 text-[15px] leading-relaxed" />
        </details>
      ))}
    </section>
  );
}
