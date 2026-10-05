"use client";

import { useT } from "@/components/lang-provider";
import type { OfferBlock } from "@/lib/funnels/types";
import { CheckIcon, borderColor, mutedStyle, softBg } from "@/components/funnels/blocks/shared";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatCents = (cents: number) => BRL.format(cents / 100);

/**
 * Price card. "From" only when there is a real full price higher than the
 * price; the deadline line only when the owner wrote a real one; the
 * guarantee seal sits right here, next to the buy button that follows.
 */
export default function OfferView({ block }: { block: OfferBlock }) {
  const t = useT();
  const hasCompare = block.compareAtCents != null && block.priceCents != null && block.compareAtCents > block.priceCents;
  return (
    <section className="space-y-4 p-5 text-center" style={{ borderRadius: "var(--fq-radius)", border: `2px solid var(--fq-primary)`, background: softBg }}>
      {block.title && <h2 className="text-xl font-bold [text-wrap:balance]">{block.title}</h2>}
      {block.bonuses && block.bonuses.length > 0 && (
        <div className="space-y-2 text-left">
          <p className="text-sm font-bold uppercase tracking-wide">{t("Bonuses")}</p>
          <ul className="space-y-2">
            {block.bonuses.map((b, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[16px]">
                <CheckIcon className="mt-0.5 h-5 w-5" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-1">
        {hasCompare && (
          <p className="text-base" style={mutedStyle}>
            {t("From (full price)")} <s>{formatCents(block.compareAtCents as number)}</s> {t("for (price)")}
          </p>
        )}
        {block.priceCents != null ? (
          <p className="text-4xl font-extrabold tabular-nums">{formatCents(block.priceCents)}</p>
        ) : (
          <p className="text-lg font-bold" style={mutedStyle}>
            {t("Fill in the price")}
          </p>
        )}
        {block.installmentsText && <p className="text-base">{block.installmentsText}</p>}
      </div>
      {block.deadlineText && <p className="text-sm font-semibold">{block.deadlineText}</p>}
      {(block.guaranteeDays != null || block.guaranteeText) && (
        <div className="flex items-start gap-3 p-3 text-left" style={{ borderRadius: "var(--fq-radius)", border: `1px solid ${borderColor}`, background: "var(--fq-bg)" }}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-8 w-8 shrink-0">
            <path d="M12 2.5 4 5.5v6c0 5 3.4 8.8 8 10 4.6-1.2 8-5 8-10v-6z" fill="none" stroke="var(--fq-primary)" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="m8.5 12 2.5 2.5 4.5-5" fill="none" stroke="var(--fq-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="space-y-0.5">
            {block.guaranteeDays != null && <p className="text-[15px] font-bold">{t("{n}-day guarantee", { n: block.guaranteeDays })}</p>}
            {block.guaranteeText && <p className="text-sm">{block.guaranteeText}</p>}
          </div>
        </div>
      )}
    </section>
  );
}
