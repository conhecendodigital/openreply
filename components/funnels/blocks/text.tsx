"use client";

import type { TextBlock } from "@/lib/funnels/types";
import { RichText, type PlayerCtx } from "@/components/funnels/blocks/shared";

const SIZE = { sm: "text-[15px]", md: "text-[17px]", lg: "text-xl" } as const;

export default function TextView({ block, ctx }: { block: TextBlock; ctx: PlayerCtx }) {
  return (
    <RichText
      text={block.text}
      labels={ctx.labels}
      className={`leading-relaxed ${SIZE[block.size ?? "md"]} ${block.align === "left" ? "text-left" : "text-center"}`}
    />
  );
}
