"use client";

import type { PlayerCtx, PublicButtonBlock } from "@/components/funnels/blocks/shared";

export default function ButtonView({ block, ctx }: { block: PublicButtonBlock; ctx: PlayerCtx }) {
  const primary = block.style !== "secondary";
  return (
    <button
      type="button"
      onClick={() => ctx.pressButton(block)}
      disabled={ctx.busy}
      className={`fq-press min-h-14 w-full px-5 py-3 text-[17px] font-bold leading-snug [touch-action:manipulation] disabled:opacity-60 ${
        block.pulse ? "fq-pulse" : ""
      }`}
      style={{
        borderRadius: "var(--fq-radius)",
        background: primary ? "var(--fq-primary)" : "transparent",
        color: primary ? "var(--fq-on-primary)" : "var(--fq-text)",
        border: primary ? "2px solid var(--fq-primary)" : "2px solid color-mix(in srgb, var(--fq-text) 30%, transparent)",
      }}
    >
      {block.label}
    </button>
  );
}
