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

const LOG10 = Math.log(10);
/** Same bar as the sales page VSL: log(1+9p)/log(10), so 10% shows as 28% and half as 74%. */
function quickBar(p: number): number {
  const q = Math.min(1, Math.max(0, p));
  return Math.log(1 + 9 * q) / LOG10;
}

const PULSE_CSS = `
@keyframes fq-vsl-pulse { 0% { box-shadow: 0 0 0 0 rgb(90 168 255 / 0.55); } 100% { box-shadow: 0 0 0 24px rgb(90 168 255 / 0); } }
.fq-vsl-pulse { animation: fq-vsl-pulse 1.9s ease-out infinite; }
@media (prefers-reduced-motion: reduce) { .fq-vsl-pulse { animation: none; } }
`;

/**
 * Own video.
 * - autoplay (the VSL, same as the sales page; owner's rule 05/10): starts
 *   muted in a loop with "it is playing without sound / tap here to listen".
 *   The tap turns the sound on and restarts from 0:00. From then on there are
 *   NO controls: no pause, no mute, no skipping; only a thin blue bar shows
 *   the progress. Muted, it pauses when less than 20% is on screen; with
 *   sound it keeps playing on scroll. A hidden tab always pauses it.
 * - without autoplay: a normal video with the browser controls.
 */
function FileVideo({ block }: { block: PublicVideo }) {
  const t = useT();
  const ref = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const autoplay = block.autoplay === true;
  const [soundOn, setSoundOn] = useState(false);
  const soundRef = useRef(false);
  const onScreen = useRef(true);
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

  // Plays or pauses by tab and screen visibility (VSL only).
  useEffect(() => {
    const v = ref.current;
    if (!v || !autoplay) return;
    const sync = () => {
      if (document.hidden) return void v.pause();
      if (!soundRef.current && !onScreen.current) return void v.pause();
      if (v.ended) return;
      void v.play().catch(() => undefined);
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen.current = entry.intersectionRatio >= 0.2;
        sync();
      },
      { threshold: [0, 0.2, 0.5] }
    );
    io.observe(v);
    document.addEventListener("visibilitychange", sync);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [autoplay, block.embedUrl]);

  // The thin progress bar, only after the sound is on.
  useEffect(() => {
    const v = ref.current;
    if (!v || !autoplay || !soundOn) return;
    let frame = 0;
    const draw = () => {
      if (barRef.current && v.duration > 0) barRef.current.style.transform = `scaleX(${quickBar(v.currentTime / v.duration)})`;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [autoplay, soundOn]);

  const unmute = () => {
    const v = ref.current;
    soundRef.current = true;
    setSoundOn(true);
    if (!v) return;
    v.loop = false;
    v.muted = false;
    v.currentTime = 0;
    void v.play().catch(() => undefined);
  };

  if (!autoplay) {
    return (
      <video
        ref={ref}
        src={block.embedUrl}
        poster={poster}
        title={block.title || t("Video")}
        aria-label={block.title || t("Video")}
        playsInline
        preload="metadata"
        controls
        controlsList="nodownload"
        className="absolute inset-0 h-full w-full object-contain"
      />
    );
  }

  return (
    <>
      <style>{PULSE_CSS}</style>
      <video
        ref={ref}
        src={block.embedUrl}
        poster={poster}
        title={block.title || t("Video")}
        aria-label={block.title || t("Video")}
        playsInline
        preload="auto"
        autoPlay
        muted={muted}
        loop={muted}
        controls={false}
        disablePictureInPicture
        disableRemotePlayback
        controlsList="nodownload nofullscreen noremoteplayback noplaybackrate"
        onContextMenu={(e) => e.preventDefault()}
        className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
      />
      {muted ? (
        <button
          type="button"
          onClick={unmute}
          className="absolute inset-0 flex items-center justify-center bg-black/25 text-white"
          aria-label={t("Tap here to listen")}
        >
          <span className="fq-vsl-pulse flex flex-col items-center gap-2 rounded-2xl bg-[#0a77fe]/90 px-6 py-4 text-center">
            <span className="text-sm font-semibold opacity-90">{t("It is playing without sound")}</span>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M11 5L6 9H3v6h3l5 4V5z" fill="currentColor" stroke="none" />
              <path d="M16 9l5 6M21 9l-5 6" strokeLinecap="round" />
            </svg>
            <span className="text-lg font-bold">{t("Tap here to listen")}</span>
          </span>
        </button>
      ) : (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-white/15">
          <div ref={barRef} className="h-full origin-left bg-[#0a77fe]" style={{ transform: "scaleX(0)" }} />
        </div>
      )}
    </>
  );
}
