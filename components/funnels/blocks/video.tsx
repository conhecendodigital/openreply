"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import type { PublicBlock } from "@/lib/funnels/types";
import { MediaPlaceholder, isPlaceholderMedia, isPlaceholderVideo } from "@/components/funnels/blocks/shared";

type PublicVideo = Extract<PublicBlock, { type: "video" }>;

/**
 * The embed URL was built by our server from a closed list of hosts
 * (lib/funnels/media.ts). A "file" video is an MP4/WebM of our own storage
 * (only MEDIA_PUBLIC_BASE_URL passes) and plays with the native <video>.
 * Only the active screen renders, so the VSL only loads on its own screen.
 */
export default function VideoView({ block }: { block: PublicVideo }) {
  const t = useT();
  const ratio = block.vertical ? "9 / 16" : "16 / 9";
  if (!block.embedUrl || isPlaceholderVideo(block.embedUrl)) return <MediaPlaceholder label={t("Paste your video link")} ratio={ratio} />;
  const frame = `relative w-full overflow-hidden bg-black ${block.vertical ? "mx-auto max-w-[20rem]" : ""}`;
  if (block.provider === "file") {
    return (
      <div className={frame} style={{ aspectRatio: ratio, borderRadius: "var(--fq-radius)" }}>
        <FileVideo block={block} />
      </div>
    );
  }
  return (
    <div className={frame} style={{ aspectRatio: ratio, borderRadius: "var(--fq-radius)" }}>
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

/**
 * Own video. With autoplay it starts muted by itself (browsers only allow
 * that) and shows "tap to turn on the sound": the tap restarts it from the
 * beginning with sound, like a VSL. Without autoplay it waits for play.
 */
function FileVideo({ block }: { block: PublicVideo }) {
  const t = useT();
  const ref = useRef<HTMLVideoElement>(null);
  const autoplay = block.autoplay === true;
  const [soundOn, setSoundOn] = useState(false);
  const muted = autoplay && !soundOn;
  const poster = block.posterUrl && !isPlaceholderMedia(block.posterUrl) ? block.posterUrl : undefined;

  // React does not write the `muted` attribute in the server HTML, so the
  // browser may refuse the autoplay before hydration: start it here.
  useEffect(() => {
    const v = ref.current;
    if (!v || !autoplay) return;
    v.muted = true;
    void v.play().catch(() => undefined);
  }, [autoplay, block.embedUrl]);

  const unmute = () => {
    const v = ref.current;
    setSoundOn(true);
    if (!v) return;
    v.muted = false;
    v.currentTime = 0;
    void v.play().catch(() => undefined);
  };

  return (
    <>
      <video
        ref={ref}
        src={block.embedUrl}
        poster={poster}
        title={block.title || t("Video")}
        aria-label={block.title || t("Video")}
        playsInline
        preload="metadata"
        autoPlay={autoplay}
        muted={muted}
        loop={autoplay && muted}
        controls={!muted}
        controlsList="nodownload"
        className="absolute inset-0 h-full w-full object-contain"
      />
      {muted && (
        <button
          type="button"
          onClick={unmute}
          className="absolute inset-0 flex items-center justify-center bg-black/30 text-white"
          aria-label={t("Tap to turn on the sound")}
        >
          <span className="flex flex-col items-center gap-2 rounded-2xl bg-black/70 px-5 py-4 text-center text-base font-bold">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 5 6 9H2v6h4l5 4V5Z" />
              <path d="M15.5 8.5a5 5 0 0 1 0 7" />
              <path d="M19 5a10 10 0 0 1 0 14" />
            </svg>
            {t("Your video already started")}
            <span className="text-sm font-semibold">{t("Tap to turn on the sound")}</span>
          </span>
        </button>
      )}
    </>
  );
}
