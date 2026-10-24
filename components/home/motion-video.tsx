"use client";

import { useEffect, useRef } from "react";

/** Vídeo de movimento sem som. Com "reduzir movimento" ligado, fica parado no primeiro quadro. */
export default function MotionVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.pause();
      el.removeAttribute("autoplay");
    }
  }, []);
  return (
    <video
      ref={ref}
      src={src}
      className="h-full w-full object-cover"
      muted
      loop
      playsInline
      autoPlay
      preload="metadata"
      aria-hidden="true"
    />
  );
}
