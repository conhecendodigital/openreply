"use client";

/**
 * Etapa 6 (Quiz): live phone preview of the draft (390 x 844, scaled to the
 * column). It renders the same FunnelPlayer as the public page, in "editor"
 * mode: nothing is recorded, the checkout never opens, delayed blocks show
 * right away. Moving through the preview selects the screen in the editor,
 * and tapping a block selects it.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { toPublicFunnel } from "@/lib/funnels/render";
import type { FunnelDefinition } from "@/lib/funnels/types";
import FunnelPlayer from "@/components/funnels/funnel-player";

const W = 390;
const H = 844;

export default function PhonePreview({
  def,
  id,
  slug,
  name,
  stepId,
  onStepChange,
  onBlockClick,
}: {
  def: FunnelDefinition;
  id: string;
  slug: string;
  name: string;
  stepId: string;
  onStepChange: (stepId: string) => void;
  onBlockClick?: (blockId: string) => void;
}) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.8);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? W;
      setScale(Math.min(1, Math.max(0.5, width / (W + 16))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const funnel = useMemo(() => toPublicFunnel({ id, slug, name, version: 0, definition: def }), [def, id, slug, name]);

  return (
    <div ref={boxRef} className="w-full">
      <div className="mx-auto" style={{ width: (W + 16) * scale, height: (H + 16) * scale }}>
        <div
          className="origin-top-left overflow-hidden rounded-[44px] border-[8px] border-[#1f1f1f] bg-[#1f1f1f] shadow-lg"
          style={{ width: W + 16, height: H + 16, transform: `scale(${scale})` }}
        >
          <div
            data-fq-scroll=""
            role="region"
            aria-label={t("Phone preview")}
            className="h-full w-full overflow-y-auto overflow-x-hidden rounded-[36px] bg-white"
            onClickCapture={(e) => {
              const el = (e.target as HTMLElement).closest<HTMLElement>("[data-block-id]");
              if (el?.dataset.blockId) onBlockClick?.(el.dataset.blockId);
            }}
          >
            <FunnelPlayer funnel={funnel} mode="editor" initialStepId={stepId} onStepChange={onStepChange} />
          </div>
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-muted">{t("Preview with your unsaved changes. Nothing is recorded here.")}</p>
    </div>
  );
}
