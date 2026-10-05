"use client";

/* eslint-disable @next/next/no-img-element -- photo comes from any https host the owner pastes */

import type { TestimonialBlock } from "@/lib/funnels/types";
import { borderColor, isPlaceholderMedia, mutedStyle } from "@/components/funnels/blocks/shared";

/** Shown only when the owner ticked "real and authorized" (the server drops it otherwise). */
export default function TestimonialView({ block }: { block: TestimonialBlock }) {
  const photo = block.imageUrl && !isPlaceholderMedia(block.imageUrl) ? block.imageUrl : null;
  return (
    <figure className="space-y-3 p-4 text-left" style={{ borderRadius: "var(--fq-radius)", border: `1px solid ${borderColor}` }}>
      <blockquote className="text-[17px] leading-relaxed">“{block.quote}”</blockquote>
      <figcaption className="flex items-center gap-3">
        {photo && <img src={photo} alt="" aria-hidden="true" loading="lazy" className="h-10 w-10 rounded-full object-cover" />}
        <span>
          <span className="block text-sm font-bold">{block.author}</span>
          {block.role && (
            <span className="block text-sm" style={mutedStyle}>
              {block.role}
            </span>
          )}
        </span>
      </figcaption>
    </figure>
  );
}
