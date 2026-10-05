"use client";

/* eslint-disable @next/next/no-img-element -- before/after prints come from any https host the owner pastes */

import { useT } from "@/components/lang-provider";
import type { CompareBlock, CompareSide } from "@/lib/funnels/types";
import { CheckIcon, MediaPlaceholder, borderColor, isPlaceholderMedia } from "@/components/funnels/blocks/shared";

/** Before and after. The server drops it from the live page when the owner did not confirm it is real. */
export default function CompareView({ block }: { block: CompareBlock }) {
  const t = useT();
  const side = (s: CompareSide, after: boolean) => (
    <div
      className="min-w-0 space-y-2 p-3"
      style={{
        borderRadius: "var(--fq-radius)",
        border: after ? "2px solid var(--fq-primary)" : `1px solid ${borderColor}`,
      }}
    >
      <p className="text-center text-sm font-bold uppercase tracking-wide">{s.title}</p>
      {s.imageUrl !== undefined &&
        s.imageUrl !== "" &&
        (isPlaceholderMedia(s.imageUrl) ? (
          <MediaPlaceholder label={t("Add your image")} ratio="3 / 4" />
        ) : (
          <img
            src={s.imageUrl}
            alt={after ? t("After: {title}", { title: s.title }) : t("Before: {title}", { title: s.title })}
            loading="lazy"
            decoding="async"
            className="aspect-[3/4] w-full object-cover"
            style={{ borderRadius: "calc(var(--fq-radius) - 4px)" }}
          />
        ))}
      {s.items.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {s.items.map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              {after ? (
                <CheckIcon className="mt-0.5 h-4 w-4" />
              ) : (
                <span aria-hidden="true" className="mt-0.5 font-bold">
                  ×
                </span>
              )}
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-3">
      {side(block.before, false)}
      {side(block.after, true)}
    </div>
  );
}
