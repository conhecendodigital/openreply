"use client";

import { interpolate } from "@/lib/funnels/text";
import type { HeadingBlock } from "@/lib/funnels/types";
import type { PlayerCtx } from "@/components/funnels/blocks/shared";

/** The first heading of a screen is its h1 and takes the focus when the screen opens. */
export default function HeadingView({ block, ctx }: { block: HeadingBlock; ctx: PlayerCtx }) {
  const isTitle = ctx.titleBlockId === block.id;
  const level = block.level === 2 || !isTitle ? 2 : 1;
  const Tag = level === 1 ? "h1" : "h2";
  return (
    <Tag
      tabIndex={isTitle ? -1 : undefined}
      data-fq-title={isTitle ? "" : undefined}
      className={`font-bold leading-tight outline-none [text-wrap:balance] ${level === 1 ? "text-[1.7rem]" : "text-xl"} ${
        block.align === "left" ? "text-left" : "text-center"
      }`}
    >
      {interpolate(block.text, ctx.labels)}
    </Tag>
  );
}
