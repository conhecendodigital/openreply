"use client";

import { useT } from "@/components/lang-provider";
import type { PublicBlock } from "@/lib/funnels/types";
import { MediaPlaceholder, isPlaceholderVideo } from "@/components/funnels/blocks/shared";

type PublicVideo = Extract<PublicBlock, { type: "video" }>;

/**
 * The embed URL was built by our server from a closed list of hosts
 * (lib/funnels/media.ts). Only the active screen renders, so the VSL only
 * loads on its own screen.
 */
export default function VideoView({ block }: { block: PublicVideo }) {
  const t = useT();
  const ratio = block.vertical ? "9 / 16" : "16 / 9";
  if (!block.embedUrl || isPlaceholderVideo(block.embedUrl)) return <MediaPlaceholder label={t("Paste your video link")} ratio={ratio} />;
  return (
    <div
      className={`relative w-full overflow-hidden bg-black ${block.vertical ? "mx-auto max-w-[20rem]" : ""}`}
      style={{ aspectRatio: ratio, borderRadius: "var(--fq-radius)" }}
    >
      <iframe
        src={block.embedUrl}
        title={block.title || t("Video")}
        loading="lazy"
        allow="fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        className="absolute inset-0 h-full w-full border-0"
      />
    </div>
  );
}
