"use client";

import { interpolate } from "@/lib/funnels/text";
import type { ChecklistBlock } from "@/lib/funnels/types";
import { CheckIcon, type PlayerCtx } from "@/components/funnels/blocks/shared";

export default function ChecklistView({ block, ctx }: { block: ChecklistBlock; ctx: PlayerCtx }) {
  return (
    <div className="space-y-3 text-left">
      {block.title && <p className="text-lg font-bold">{interpolate(block.title, ctx.labels)}</p>}
      <ul className="space-y-2.5">
        {block.items.map((item, i) => (
          <li key={i} className="flex items-start gap-3 text-[17px] leading-snug">
            <CheckIcon className="mt-0.5 h-5 w-5" />
            <span>{interpolate(item, ctx.labels)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
