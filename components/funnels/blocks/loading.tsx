"use client";

import { useEffect, useEffectEvent } from "react";
import { useT } from "@/components/lang-provider";
import type { LoadingBlock } from "@/lib/funnels/types";
import { borderColor, type PlayerCtx } from "@/components/funnels/blocks/shared";

/**
 * Short and honest wait ("from your answers"), then moves on by itself (by
 * points when the block has routes). In the editor it waits for a tap, so the
 * preview does not jump away from the screen being edited.
 */
export default function LoadingView({ block, ctx }: { block: LoadingBlock; ctx: PlayerCtx }) {
  const t = useT();
  const seconds = Math.min(8, Math.max(1, block.durationSec ?? 3));
  const auto = ctx.mode !== "editor";
  const finish = useEffectEvent(() => ctx.loadingDone(block.id));

  useEffect(() => {
    if (!auto) return;
    const timer = window.setTimeout(() => finish(), seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [auto, block.id, seconds]);

  return (
    <div className="space-y-4 text-center" aria-busy={auto ? true : undefined}>
      <p className="text-lg font-semibold" role="status">
        {block.text}
      </p>
      <div className="h-3 w-full overflow-hidden rounded-full" style={{ background: borderColor }}>
        <div
          className="fq-fill h-full w-full origin-left rounded-full"
          style={{ background: "var(--fq-primary)", animationDuration: `${seconds}s`, animationPlayState: auto ? "running" : "paused" }}
        />
      </div>
      {!auto && (
        <button
          type="button"
          onClick={() => ctx.loadingDone(block.id)}
          className="min-h-11 rounded-full px-4 text-sm font-semibold underline underline-offset-4"
        >
          {t("Go to the next screen")}
        </button>
      )}
    </div>
  );
}
