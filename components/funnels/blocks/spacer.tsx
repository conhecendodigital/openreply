"use client";

import type { SpacerBlock } from "@/lib/funnels/types";

const H = { sm: "h-2", md: "h-6", lg: "h-12" } as const;

export default function SpacerView({ block }: { block: SpacerBlock }) {
  return <div aria-hidden="true" className={H[block.size] ?? H.md} />;
}
