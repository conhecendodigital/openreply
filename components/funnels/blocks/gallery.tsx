"use client";

/* eslint-disable @next/next/no-img-element -- gallery prints come from any https host the owner pastes */

import { useT } from "@/components/lang-provider";
import type { GalleryBlock } from "@/lib/funnels/types";
import { MediaPlaceholder, isPlaceholderMedia } from "@/components/funnels/blocks/shared";

export default function GalleryView({ block }: { block: GalleryBlock }) {
  const t = useT();
  if (!block.images.length) return null;
  const single = block.images.length === 1;
  return (
    <div className={single ? "" : "grid grid-cols-2 gap-2"}>
      {block.images.map((img, i) =>
        isPlaceholderMedia(img.url) ? (
          <MediaPlaceholder key={i} label={t("Add your image")} ratio="1 / 1" />
        ) : (
          <img
            key={i}
            src={img.url}
            alt={img.alt}
            loading="lazy"
            decoding="async"
            className="h-auto w-full object-cover"
            style={{ borderRadius: "var(--fq-radius)" }}
          />
        )
      )}
    </div>
  );
}
