"use client";

/* eslint-disable @next/next/no-img-element -- funnel images come from any https host the owner pastes */

import type { ImageBlock } from "@/lib/funnels/types";
import { MediaPlaceholder, isPlaceholderMedia, useImageLabel, type PlayerCtx } from "@/components/funnels/blocks/shared";

export default function ImageView({ block, ctx }: { block: ImageBlock; ctx: PlayerCtx }) {
  const label = useImageLabel();
  if (isPlaceholderMedia(block.url)) return <MediaPlaceholder label={label} ratio="4 / 3" />;
  const priority = ctx.priorityImageId === block.id;
  return (
    <img
      src={block.url}
      alt={block.alt}
      aria-hidden={block.alt === "" ? true : undefined}
      width={block.width}
      height={block.height}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className="mx-auto h-auto w-full max-w-full object-contain"
      style={{ borderRadius: block.rounded === false ? 0 : "var(--fq-radius)" }}
    />
  );
}
